// 저장 비밀 봉투 암호화 — 개인키·차량 루트 비밀은 KEK로 감싼 봉인본만 DB 파일에 있다.
// readiness: RD-SEC-06
// 평문 → 봉인 변환(이전 판 DB), KEK 교체(DEK 다시 감싸기), 잘못된 KEK·변조·행 바꿔치기 거부, 운영 모드 KEK 필수를 확인한다.
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { aesCmac, hkdf16 } from '../../src/kernel/crypto';
import { DB, SqliteDb, migrate, type Db } from '../../src/kernel/db';
import { isSealed, KeyProtectionError, LocalKek, SecretVault, kekConfigProblems, vaultFromEnv } from '../../src/kernel/kms/key-protection';
import { SECRET_COLUMNS, aadOf } from '../../src/kernel/kms/secret-columns';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';

const K1 = randomBytes(32).toString('base64');
const K2 = randomBytes(32).toString('base64');
const K3 = randomBytes(32).toString('base64');
const ROOT = randomBytes(32);

const dir = mkdtempSync(join(tmpdir(), 'ff-kms-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const ENV_KEYS = ['FF_DB', 'FF_SEED', 'FF_KEK', 'FF_KEK_FILE', 'FF_KEK_PREVIOUS', 'FF_KEK_PREVIOUS_FILE', 'FF_HSM_VEHICLE_ROOT', 'FF_ENV'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
});

async function boot(dbFile: string, env: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { FF_DB: dbFile, FF_SEED: 'none' }, env);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  return { app, db: app.get<Db>(DB), vault: app.get(SecretVault), pki: app.get(PkiService), hsm: app.get(HsmService) };
}

/** DB 파일과 WAL·저널까지 — 어디에도 평문 조각이 없어야 한다 */
const fileBytes = (f: string) => Buffer.concat(['', '-wal', '-journal', '-shm'].map((s) => f + s).filter(existsSync).map((p) => readFileSync(p)));
/** PEM 본문 줄(64자 base64)·원시 비밀 — 길이가 있어 우연히 겹치지 않는다 */
const fragments = (pem: string) => pem.split('\n').filter((l) => l && !l.startsWith('-----'));

const rows = (db: Db) => SECRET_COLUMNS.flatMap((c) => db.all<{ rid: string; v: string }>(`SELECT ${c.id} AS rid, ${c.column} AS v FROM ${c.table}`).map((r) => ({ c, rid: String(r.rid), v: r.v })));
const expectedCmac = (vin: string, frame: Buffer) => aesCmac(hkdf16(ROOT, 'epoch:1', `ffp-vehicle-key|${vin}`), frame).toString('base64url');

describe('봉인 형식 — AES-256-GCM 데이터 키 + KEK 감싸기', () => {
  const v1 = new SecretVault(new LocalKek(Buffer.from(K1, 'base64')));
  it('봉인 → 열기, 같은 값도 매번 다른 봉인(레코드별 DEK·IV)', () => {
    const a = v1.seal('top-secret', 'pki_key.private_pem|KEY-0001');
    expect(a).toMatch(/^ffenc1\.local-[0-9a-f]{12}\./);
    expect(a).not.toContain('top-secret');
    expect(v1.seal('top-secret', 'pki_key.private_pem|KEY-0001')).not.toBe(a);
    expect(v1.open(a, 'pki_key.private_pem|KEY-0001')).toBe('top-secret');
  });

  it('다른 행으로 옮긴 봉인(AAD 불일치)·변조·평문은 열지 않는다', () => {
    const a = v1.seal('top-secret', 'pki_key.private_pem|KEY-0001');
    expect(() => v1.open(a, 'pki_key.private_pem|KEY-0002')).toThrow(/다른 행에서 옮겨/);
    const p = a.split('.');
    p[4] = Buffer.from('tampered!!').toString('base64url');
    expect(() => v1.open(p.join('.'), 'pki_key.private_pem|KEY-0001')).toThrow(KeyProtectionError);
    expect(() => v1.open('-----BEGIN PRIVATE KEY-----', 'x')).toThrow(/봉인\(암호화\)되어 있지 않습니다/);
  });

  it('잘못된 KEK — 어떤 키로 감쌌는지 알려 주고 이전 키(FF_KEK_PREVIOUS)를 안내한다', () => {
    const a = v1.seal('s', 'x');
    const v3 = new SecretVault(new LocalKek(Buffer.from(K3, 'base64')));
    let err: unknown;
    try {
      v3.open(a, 'x');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KeyProtectionError);
    expect((err as KeyProtectionError).code).toBe('KEK_MISMATCH');
    expect(String((err as Error).message)).toMatch(new RegExp(`${v1.current.id}[\\s\\S]*${v3.current.id}[\\s\\S]*FF_KEK_PREVIOUS`));
  });

  it('KEK 교체 — DEK만 다시 감싸고 암호문은 그대로, 교체 뒤에는 새 KEK만으로 열린다', () => {
    const a = v1.seal('s', 'x');
    const v2 = new SecretVault(new LocalKek(Buffer.from(K2, 'base64')), [new LocalKek(Buffer.from(K1, 'base64'))]);
    const b = v2.rewrap(a);
    expect(b.split('.')[1]).toBe(v2.current.id);
    expect(b.split('.').slice(3)).toEqual(a.split('.').slice(3));
    expect(new SecretVault(new LocalKek(Buffer.from(K2, 'base64'))).open(b, 'x')).toBe('s');
  });

  it('설정 — 운영 모드는 KEK 필수, 형식·파일·동시 지정·교체 키 동일을 거부, 값은 메시지에 없다', () => {
    expect(kekConfigProblems({}, true).join()).toMatch(/FF_KEK\(또는 FF_KEK_FILE\)가 없습니다/);
    expect(kekConfigProblems({}, false)).toEqual([]);
    expect(kekConfigProblems({ FF_KEK: 'short' }, false).join()).toMatch(/32바이트/);
    expect(kekConfigProblems({ FF_KEK: K1, FF_KEK_FILE: '/x' }, true).join()).toMatch(/함께 줄 수 없습니다/);
    expect(kekConfigProblems({ FF_KEK_FILE: join(dir, 'none.key') }, true).join()).toMatch(/파일이 없습니다/);
    expect(kekConfigProblems({ FF_KEK: K1, FF_KEK_PREVIOUS: K1 }, true).join()).toMatch(/같습니다/);
    expect(runtimeConfigProblems({ FF_KEK: 'bad-value-xyz' }).join()).not.toContain('bad-value-xyz');
    const file = join(dir, 'kek.key');
    writeFileSync(file, K1 + '\n');
    expect(kekConfigProblems({ FF_KEK_FILE: file }, true)).toEqual([]);
    expect(vaultFromEnv({ FF_KEK_FILE: file }).current.id).toBe(new LocalKek(Buffer.from(K1, 'base64')).id);
    writeFileSync(file, Buffer.from(K2, 'base64')); // 원시 32바이트 파일도 받는다
    expect(vaultFromEnv({ FF_KEK_FILE: file }).current.id).toBe(new LocalKek(Buffer.from(K2, 'base64')).id);
    // 운영 모드가 아닐 때만 고정 개발 KEK(공개 값) — 운영 모드는 시작 검사가 막는다
    expect(vaultFromEnv({}).insecureDev).toBe(true);
    expect(() => vaultFromEnv({ FF_ENV: 'production' })).toThrow(/FF_KEK/);
  });
});

describe('DB 파일 — 봉인본만 남는다', () => {
  it('새 키(서명 키·승인자 키·차량 루트)는 봉인되어 저장되고, 파일·WAL 어디에도 평문 조각이 없다', async () => {
    const f = join(dir, 'fresh.db');
    const b = await boot(f, { FF_KEK: K1, FF_HSM_VEHICLE_ROOT: ROOT.toString('base64') });
    b.hsm.approve('usr-approver', 'canonical-bytes');
    expect(b.hsm.epoch()).toBe(1);
    b.pki.sign({ hello: 'world' }, 'kill');
    const all = rows(b.db);
    expect(new Set(all.map((r) => r.c.table))).toEqual(new Set(['approver_key', 'hsm_secret', 'pki_key']));
    expect(all.length).toBeGreaterThanOrEqual(4); // 정책·차단 서명 키 + 승인자 키 + 차량 루트
    const plain = all.map((r) => b.vault.open(r.v, aadOf(r.c, r.rid)));
    for (const r of all) expect(isSealed(r.v)).toBe(true);
    // 서명·CMAC는 그대로 동작(봉인본을 풀어 쓴다)
    expect(b.hsm.cmac('VIN-1', 1, Buffer.from('frame'))).toBe(expectedCmac('VIN-1', Buffer.from('frame')));
    await b.app.close();
    const bytes = fileBytes(f);
    expect(bytes.includes('PRIVATE KEY')).toBe(false);
    expect(bytes.includes(ROOT)).toBe(false);
    expect(bytes.includes(ROOT.toString('base64'))).toBe(false);
    for (const p of plain) for (const frag of p.includes('-----') ? fragments(p) : [p]) expect(bytes.includes(frag), frag.slice(0, 12)).toBe(false);
  });

  it('이전 판 DB의 평문 비밀은 시작 때 봉인되고(빈 페이지까지 지움), 그 키로 계속 서명·CMAC', async () => {
    const f = join(dir, 'legacy.db');
    const old = new SqliteDb(f);
    migrate(old, MIGRATIONS);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    old.run("INSERT INTO pki_key (key_id, status, created_at, not_after, public_pem, private_pem, purpose) VALUES ('KEY-0001', 'ACTIVE', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z', ?, ?, 'policy')", publicKey.export({ type: 'spki', format: 'pem' }).toString(), pem);
    old.run("INSERT INTO hsm_secret (name, epoch, secret, created_at) VALUES ('vehicle_root', 1, ?, '2026-01-01T00:00:00Z')", ROOT.toString('base64'));
    old.close();
    expect(fileBytes(f).includes(fragments(pem)[0])).toBe(true); // 변환 전에는 평문이 있다(시험이 빈 검사가 아님을 보인다)

    const b = await boot(f, { FF_KEK: K1 });
    expect(rows(b.db).every((r) => isSealed(r.v))).toBe(true);
    const sig = b.pki.sign({ a: 1 }, 'policy');
    expect(sig.keyId).toBe('KEY-0001');
    expect(b.pki.verify({ a: 1 }, sig).valid).toBe(true);
    expect(b.hsm.cmac('VIN-9', 1, Buffer.from('x'))).toBe(expectedCmac('VIN-9', Buffer.from('x')));
    await b.app.close();
    const bytes = fileBytes(f);
    for (const frag of fragments(pem)) expect(bytes.includes(frag)).toBe(false);
    expect(bytes.includes(ROOT.toString('base64'))).toBe(false);
  });

  it('KEK 교체 — 새 FF_KEK + 이전 키 FF_KEK_PREVIOUS로 시작하면 다시 감싸고, 그 뒤 옛 키만으로는 시작하지 않는다', async () => {
    const f = join(dir, 'rotate.db');
    let b = await boot(f, { FF_KEK: K1, FF_HSM_VEHICLE_ROOT: ROOT.toString('base64') });
    b.hsm.epoch();
    const id1 = b.vault.current.id;
    await b.app.close();

    b = await boot(f, { FF_KEK: K2, FF_KEK_PREVIOUS: K1 });
    const id2 = b.vault.current.id;
    expect(id2).not.toBe(id1);
    expect(rows(b.db).every((r) => r.v.split('.')[1] === id2)).toBe(true);
    expect(b.hsm.cmac('VIN-1', 1, Buffer.from('frame'))).toBe(expectedCmac('VIN-1', Buffer.from('frame')));
    await b.app.close();

    // 교체 완료 — 새 키만으로 시작된다
    b = await boot(f, { FF_KEK: K2 });
    expect(b.hsm.cmac('VIN-1', 1, Buffer.from('frame'))).toBe(expectedCmac('VIN-1', Buffer.from('frame')));
    await b.app.close();
    // 옛 키로는 시작하지 않는다(어느 KEK인지 알려 준다)
    await expect(boot(f, { FF_KEK: K1 })).rejects.toThrow(new RegExp(`KEK ${id2}`));
  });

  it('잘못된 KEK로는 시작하지 않는다 — 첫 서명 때가 아니라 부팅 때', async () => {
    const f = join(dir, 'wrong.db');
    const b = await boot(f, { FF_KEK: K1 });
    await b.app.close();
    await expect(boot(f, { FF_KEK: K3 })).rejects.toThrow(/다른 키 암호화 키[\s\S]*FF_KEK_PREVIOUS/);
    // 운영 모드는 KEK 없이 시작 검사에서 막힌다(production-mode.spec의 GOOD 설정에 FF_KEK가 있다)
    expect(runtimeConfigProblems({ FF_ENV: 'production' }).join('\n')).toMatch(/FF_KEK/);
  });
});

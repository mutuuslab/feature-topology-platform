// 감사 이력 추가 전용·해시 체인 (FFG-PLT-015 — 합격: 주입한 변조 100% 검출)
// 체인 끝 고정(출시 준비 RD-SEC-13, ADS FFP-F060 결함 기록을 고친 회귀 시험): 끝 행 삭제·체인 다시 계산·고정점 위조·운영 모드 보충 금지
// readiness: RD-SEC-13
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { AuditService, chainHash, AUDIT_GENESIS, fieldDigest } from '../../src/kernel/audit.service';
import { actor, bootApp } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => close?.());

async function boot() {
  const b = await bootApp({ at: '2026-10-13T00:00:00Z' });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB), audit: b.get(AuditService) };
}

describe('감사 해시 체인 (FFG-PLT-015)', () => {
  it('변경 API가 남긴 감사 행이 체인으로 이어지고 API가 무결을 보고한다', async () => {
    const { http, db } = await boot();
    await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: '정기 교체' }).expect(201);
    const rows = db.all<any>('SELECT id, prev_hash, hash FROM audit ORDER BY id');
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
    const r = await http().get('/api/audit/chain').expect(200);
    expect(r.body).toMatchObject({ ok: true, verified: rows.length, head: rows.at(-1).hash, broken: null });
  });

  it('DB에서 감사 행을 지우거나 고칠 수 없다(트리거)', async () => {
    const { http, db } = await boot();
    await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: '정기 교체' }).expect(201);
    expect(() => db.run('DELETE FROM audit')).toThrow(/append-only/);
    expect(() => db.run("UPDATE audit SET reason = '조작'")).toThrow(/append-only/);
  });

  it('트리거를 우회한 변조(내용 수정·행 삭제)를 체인 검증이 모두 잡는다', async () => {
    const { http, db, audit } = await boot();
    for (let i = 0; i < 3; i++) await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: `교체 ${i}` }).expect(201);
    const ids = db.all<{ id: number }>('SELECT id FROM audit ORDER BY id').map((r) => r.id);
    // 공격자가 DB 권한으로 트리거를 지우고 조작했다고 가정
    db.run('DROP TRIGGER audit_no_update');
    db.run('DROP TRIGGER audit_no_delete');
    db.run("UPDATE audit SET reason = '조작' WHERE id = ?", ids[1]);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: ids[1], kind: 'hash' } });
    db.run('DELETE FROM audit WHERE id = ?', ids[1]);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: ids[2], kind: 'prev' } });
  });

  it('체인 도입 전 행(hash 없음)은 부팅 때 순서대로 채운다', async () => {
    const { db, audit } = await boot();
    db.run('DROP TRIGGER audit_no_update');
    db.run("INSERT INTO audit (at, actor_id, actor_role, action, target, result) VALUES ('2026-01-01T00:00:00Z', 'legacy', 'SYSTEM', 'OLD', 'X', 'ALLOWED')");
    audit.onModuleInit();
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('FFP-F060 트리거를 우회해 마지막 감사 행을 지워도 잡는다 — 프로세스가 기억한 끝과 다르다', async () => {
    const { http, db, audit } = await boot();
    for (let i = 0; i < 3; i++) await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: `교체 ${i}` }).expect(201);
    const last = db.get<{ id: number }>('SELECT id FROM audit ORDER BY id DESC LIMIT 1')!.id;
    db.run('DROP TRIGGER audit_no_delete');
    db.run('DELETE FROM audit WHERE id = ?', last);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: last, kind: 'head' } });
  });
});

describe('감사 체인 고정점 — DB 밖 서명(FF_AUDIT_KEY · FF_AUDIT_ANCHOR_FILE)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-anchor-'));
  afterEach(() => {
    delete process.env.FF_AUDIT_KEY;
    delete process.env.FF_AUDIT_ANCHOR_FILE;
    delete process.env.FF_ENV;
  });
  const withAnchors = async (name: string) => {
    const file = join(dir, `${name}.jsonl`);
    Object.assign(process.env, { FF_AUDIT_KEY: 'k'.repeat(40), FF_AUDIT_ANCHOR_FILE: file });
    const b = await boot();
    for (let i = 0; i < 3; i++) await b.http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: `교체 ${i}` }).expect(201);
    expect(b.audit.anchor()).toMatchObject({ id: expect.any(Number), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    return { ...b, file };
  };
  /** 재시작으로 프로세스 기억이 사라진 상태 — 고정점만 남는다 */
  const forget = (audit: AuditService) => ((audit as unknown as { head: unknown }).head = null);

  it('끝을 서명해 남기고(빈 체인은 고정하지 않는다), 그대로면 검증이 통과한다', async () => {
    const { audit, file } = await withAnchors('ok');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    // 부팅 때는 감사 행이 없어(시드는 감사를 남기지 않는다) 고정점도 없다 — 빈 체인은 고정하지 않는다. 호출 1건
    expect(lines).toHaveLength(1);
    expect(audit.verifyChain()).toMatchObject({ ok: true, anchors: { configured: true, checked: lines.length } });
    // 비밀값·서명 키는 고정점에 없다
    expect(readFileSync(file, 'utf8')).not.toContain('k'.repeat(40));
  });

  it('재시작 뒤 DB 권한자가 끝 행을 지우고 체인을 다시 계산해도 고정점이 잡는다', async () => {
    const { db, audit } = await withAnchors('recompute');
    db.run('DROP TRIGGER audit_no_update');
    db.run('DROP TRIGGER audit_no_delete');
    const rows = db.all<any>('SELECT * FROM audit ORDER BY id');
    db.run('DELETE FROM audit WHERE id = ?', rows.at(-1).id);
    // 남은 행 내용 하나를 고치고 체인 전체를 다시 계산 — 체인만 보면 멀쩡하다.
    // 체인 v2(RD-P2-05)는 칸 해시를 소금으로 묶는데, DB 권한자는 소금도 읽는다 — 칸 해시까지 다시 맞춘 공격자를 가정한다
    const salt = db.get<{ salt: string }>('SELECT salt FROM audit_salt WHERE audit_id = ?', rows[1].id)!.salt;
    db.run("UPDATE audit SET reason = '조작', reason_d = ? WHERE id = ?", fieldDigest(salt, 'reason', '조작'), rows[1].id);
    let prev = AUDIT_GENESIS;
    for (const r of db.all<any>('SELECT * FROM audit ORDER BY id')) {
      const hash = chainHash(prev, r);
      db.run('UPDATE audit SET prev_hash = ?, hash = ? WHERE id = ?', prev, hash, r.id);
      prev = hash;
    }
    forget(audit);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { kind: 'anchor' } });
  });

  it('고정점 파일의 서명을 바꾸면(키 없이 위조) 잡는다', async () => {
    const { audit, file } = await withAnchors('forged');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const a = JSON.parse(lines[0]);
    lines[0] = JSON.stringify({ ...a, hash: '0'.repeat(64) });
    writeFileSync(file, lines.join('\n') + '\n');
    forget(audit);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: a.id, kind: 'anchor' } });
  });

  it('운영 모드는 hash 없는 행을 채우지 않는다 — 끼워 넣은 행을 정상으로 만들지 않고 어긋남으로 보고', async () => {
    const { db, audit } = await boot();
    db.run('DROP TRIGGER audit_no_update');
    db.run("INSERT INTO audit (at, actor_id, actor_role, action, target, result) VALUES ('2026-01-01T00:00:00Z', 'intruder', 'SYSTEM', 'FAKE', 'X', 'ALLOWED')");
    process.env.FF_ENV = 'production';
    audit.onModuleInit();
    expect(db.get<{ hash: string | null }>("SELECT hash FROM audit WHERE actor_id = 'intruder'")!.hash).toBeNull();
    expect(audit.verifyChain().ok).toBe(false);
  });
});

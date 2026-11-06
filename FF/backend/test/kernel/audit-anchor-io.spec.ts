// 감사 쓰기마다 고정(ADS-BE19)의 파일 쓰기 — 하네스 리뷰(2026-11-06)에서 찾은 결함의 회귀 시험
// ① 쓰기마다 파일을 다시 열면(appendFileSync) Windows에서 감사 쓰기가 약 24배 느려졌다(1만 건 2.5 s → 60 s) — 연 파일을 이어 쓴다
// ② 고정점 쓰기가 실패하면(디스크·권한) 이미 커밋된 요청이 500으로 끝나고, 같은 커밋의 다른 후속(이벤트 전달)이 사라졌다
// ③ 쓰는 중 끊긴 마지막 줄 뒤에 다음 고정점을 붙여 써서 그 고정점까지 읽을 수 없게 됐다
// readiness: RD-SEC-13
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  return { ...real, appendFileSync: vi.fn(real.appendFileSync), openSync: vi.fn(real.openSync) };
});

import { DB, type Db } from '../../src/kernel/db';
import { AuditService } from '../../src/kernel/audit.service';
import { EventService } from '../../src/kernel/event.service';
import { actor, bootApp } from '../helpers';

let close: (() => Promise<void>) | null = null;
const dir = mkdtempSync(join(tmpdir(), 'ff-anchor-io-'));
afterEach(async () => {
  await close?.();
  close = null;
  for (const k of ['FF_AUDIT_KEY', 'FF_AUDIT_ANCHOR_FILE', 'FF_AUDIT_ANCHOR_ROWS', 'FF_AUDIT_KEY_ID']) delete process.env[k];
  vi.mocked(fs.appendFileSync).mockClear();
  vi.mocked(fs.openSync).mockClear();
});

async function boot(file: string) {
  Object.assign(process.env, { FF_AUDIT_KEY: 'k'.repeat(40), FF_AUDIT_ANCHOR_FILE: file });
  const b = await bootApp({ at: '2026-10-13T00:00:00Z' });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB), audit: b.get(AuditService) };
}
const SYS = { id: 'u-test', role: 'OPERATOR' } as never;
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const tailOf = (db: Db) => db.get<{ id: number; hash: string }>('SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1')!;
const opensOf = (file: string) => vi.mocked(fs.openSync).mock.calls.filter((c) => String(c[0]) === file).length;
const appendsOf = (file: string) => vi.mocked(fs.appendFileSync).mock.calls.filter((c) => String(c[0]) === file).length;

describe('감사 고정점 파일 쓰기 (ADS-BE19 · 쓰기마다)', () => {
  it('쓰기마다 고정해도 고정점 파일을 쓰기마다 다시 열지 않는다(연 파일에 이어 쓴다) — 모든 쓰기의 끝이 고정되고 행 수가 맞다', async () => {
    const file = join(dir, 'reuse.jsonl');
    const { db, audit } = await boot(file);
    vi.mocked(fs.appendFileSync).mockClear();
    vi.mocked(fs.openSync).mockClear();
    const before = lines(file).length;
    for (let i = 0; i < 200; i++) audit.failed(SYS, 'TEST', `t${i}`, '측정');
    const after = lines(file).map((l) => JSON.parse(l));
    expect(after.length - before).toBe(200);
    expect(after.at(-1)).toMatchObject({ id: tailOf(db).id, hash: tailOf(db).hash, count: db.get<{ n: number }>('SELECT count(*) AS n FROM audit')!.n });
    expect(appendsOf(file)).toBe(0);
    expect(opensOf(file)).toBeLessThanOrEqual(1);
    expect(audit.verifyChain()).toMatchObject({ ok: true, anchors: { lastMatched: { id: tailOf(db).id } } });
  });

  it('고정점 쓰기가 실패해도 커밋된 요청은 성공으로 끝나고 같은 커밋의 이벤트도 전달된다 — 실패는 체인 보고에 남고, 다음 쓰기에서 다시 고정한다', async () => {
    const file = join(dir, 'fail.jsonl');
    const { http, db, audit, get } = await boot(file);
    const seen: string[] = [];
    const sub = get(EventService).stream(['pki.key.rotated']).subscribe((e) => seen.push(e.type));
    // 고정점 파일 자리를 쓸 수 없게(읽기 전용 파일) — 운영 중 볼륨·권한 문제
    const broken = join(dir, 'read-only.jsonl');
    writeFileSync(broken, readFileSync(file));
    chmodSync(broken, 0o444);
    process.env.FF_AUDIT_ANCHOR_FILE = broken;
    const before = tailOf(db).id;
    await http().post('/api/pki/rotate').set(actor('u-safety', 'SAFETY_OFFICER')).send({ reason: '정기 교체' }).expect(201);
    expect(tailOf(db).id).toBeGreaterThan(before); // 변경·감사는 커밋됐다
    expect(seen).toEqual(['pki.key.rotated']); // 같은 커밋의 이벤트 전달이 고정 실패로 끊기지 않는다
    const r = audit.verifyChain();
    expect(r.ok).toBe(true); // 체인 자체는 멀쩡 — 고정만 못 했다
    expect(r.anchors.failing).toMatchObject({ at: expect.any(String), message: expect.any(String) });
    // 자리가 돌아오면 다음 쓰기에서 끝을 고정하고 실패 표시를 지운다
    process.env.FF_AUDIT_ANCHOR_FILE = file;
    audit.failed(SYS, 'TEST', 'after', '복구 뒤');
    expect(JSON.parse(lines(file).at(-1)!)).toMatchObject({ id: tailOf(db).id });
    expect(audit.verifyChain().anchors.failing ?? null).toBeNull();
    sub.unsubscribe();
  });

  it('두 프로세스(인스턴스)가 같은 고정점 파일에 번갈아 써도 줄이 섞이거나 붙지 않는다 — 각자 연 파일에 끝으로만 이어 쓴다', async () => {
    const file = join(dir, 'shared.jsonl');
    const a = await boot(file);
    const closeA = close!;
    const b = await boot(file);
    const closeB = close!;
    close = async () => {
      await closeA();
      await closeB();
    };
    const before = lines(file).length;
    for (let i = 0; i < 50; i++) {
      a.audit.failed(SYS, 'TEST', `a${i}`, '인스턴스 A');
      b.audit.failed(SYS, 'TEST', `b${i}`, '인스턴스 B');
    }
    const all = lines(file);
    expect(all).toHaveLength(before + 100);
    const parsed = all.slice(before).map((l) => JSON.parse(l));
    expect(parsed.filter((x, i) => i % 2 === 0).at(-1)).toMatchObject({ id: tailOf(a.db).id, hash: tailOf(a.db).hash });
    expect(parsed.filter((x, i) => i % 2 === 1).at(-1)).toMatchObject({ id: tailOf(b.db).id, hash: tailOf(b.db).hash });
  });

  it('쓰는 중 끊긴 마지막 줄(줄바꿈 없음) 뒤의 고정점은 새 줄에 남아 읽힌다 — 끊긴 줄은 위변조 흔적으로 그대로 보고', async () => {
    const first = join(dir, 'torn-first.jsonl');
    const { db, audit } = await boot(first);
    audit.failed(SYS, 'TEST', 'before-crash', '중단 전');
    // 다른 프로세스가 같은 파일에 쓰다 전원이 끊겼다 — 줄 중간에서 멈춤(줄바꿈 없음). 이 프로세스는 그 파일을 처음 연다
    const file = join(dir, 'torn.jsonl');
    writeFileSync(file, readFileSync(first, 'utf8') + '{"at":"2026-10-13T00:00:00.000Z","id":9');
    process.env.FF_AUDIT_ANCHOR_FILE = file;
    const valid = lines(file).length - 1;
    audit.failed(SYS, 'TEST', 'after-crash', '재시작 뒤');
    const all = lines(file);
    expect(all).toHaveLength(valid + 2); // 끊긴 줄은 그대로, 새 고정점은 따로 한 줄
    expect(() => JSON.parse(all.at(-1)!)).not.toThrow();
    expect(JSON.parse(all.at(-1)!)).toMatchObject({ id: tailOf(db).id, hash: tailOf(db).hash });
    // 읽을 수 없는 줄은 위변조 흔적으로 남겨 보고하되(백업도 그대로 옮긴다), 맞는 마지막 고정점은 새 끝이다
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { kind: 'anchor' }, anchors: { lastMatched: { id: tailOf(db).id } } });
  });
});

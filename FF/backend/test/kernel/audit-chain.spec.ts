// 감사 이력 추가 전용·해시 체인 (FFG-PLT-015 — 합격: 주입한 변조 100% 검출)
import { afterEach, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { AuditService } from '../../src/kernel/audit.service';
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
});

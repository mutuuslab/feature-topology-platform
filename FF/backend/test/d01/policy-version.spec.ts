// 정책 버전 이력 (D01-06) — 개정본마다 내용 보존·버전 목록·버전 내용·변경 이력(변경 전후)·버전 복원.
// 회귀: 예전에는 PATCH가 같은 행을 덮어써 이전 개정본 내용이 사라졌다(revision만 올라감).
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteDb, migrate } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');

describe('정책 버전 이력', () => {
  let app: INestApplication;
  let http: () => any;
  let pid: string;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    const c = await http()
      .post('/api/policies')
      .set(AUTHOR)
      .send({ featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'ivi_00024_guide_ver', description: '처음 내용', safeDefault: false })
      .expect(201);
    pid = c.body.policyId;
  });
  afterAll(() => app.close());

  it('작성하면 r1이 남고, 없는 정책·없는 버전은 NOT_FOUND', async () => {
    const r = await http().get(`/api/policies/${pid}/revisions`).expect(200);
    expect(r.body).toMatchObject({ policyId: pid, current: 1, status: 'DRAFT', restorable: true });
    expect(r.body.items).toEqual([expect.objectContaining({ revision: 1, kind: 'CREATE', changedBy: 'kim.author', current: true, restoredFrom: null })]);
    const v = await http().get(`/api/policies/${pid}/revisions/1`).expect(200);
    expect(v.body.spec).toMatchObject({ flagKey: 'ivi_00024_guide_ver', description: '처음 내용' });
    expect(v.body.spec.status).toBeUndefined();
    expect((await http().get(`/api/policies/${pid}/revisions/9`).expect(404)).body.error.code).toBe('NOT_FOUND');
    await http().get(`/api/policies/${pid}/revisions/abc`).expect(404);
    await http().get('/api/policies/POL-99999/revisions').expect(404);
    await http().get('/api/policies/POL-99999/changes').expect(404);
  });

  it('수정하면 새 개정본으로 저장되고 이전 개정본 내용은 그대로 남는다 (덮어쓰기 회귀)', async () => {
    await http().patch(`/api/policies/${pid}`).set(AUTHOR).send({ description: '고친 내용', rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-2' } }).expect(200);
    const r1 = await http().get(`/api/policies/${pid}/revisions/1`).expect(200);
    expect(r1.body.spec).toMatchObject({ description: '처음 내용', rollout: { salt: 'FF-COHORT-SALT-1' } });
    expect(r1.body.changesFromCurrent).toEqual([
      { path: 'description', before: '고친 내용', after: '처음 내용' },
      { path: 'rollout.salt', before: 'FF-COHORT-SALT-2', after: 'FF-COHORT-SALT-1' },
    ]);
    const r2 = await http().get(`/api/policies/${pid}/revisions/2`).expect(200);
    expect(r2.body).toMatchObject({ kind: 'UPDATE', changedBy: 'kim.author', current: true, spec: { description: '고친 내용', rollout: { salt: 'FF-COHORT-SALT-2' } } });
  });

  it('변경 이력 — 최신 순, 변경자·시각·변경 전·변경 후', async () => {
    const c = await http().get(`/api/policies/${pid}/changes`).expect(200);
    expect(c.body.items.map((e: any) => [e.revision, e.kind])).toEqual([
      [2, 'UPDATE'],
      [1, 'CREATE'],
    ]);
    const [upd, created] = c.body.items;
    expect(upd).toMatchObject({ changedBy: 'kim.author', changedAt: expect.any(String), before: { description: '처음 내용' }, after: { description: '고친 내용' } });
    expect(upd.changes.map((x: any) => x.path)).toEqual(['description', 'rollout.salt']);
    expect(created.before).toBeNull();
  });

  it('복원 — 고른 버전 내용으로 새 개정본(DRAFT), 해시는 그 버전과 같고 감사·이력에 남는다', async () => {
    await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
    expect((await http().get(`/api/policies/${pid}`).expect(200)).body.policy.status).toBe('VALIDATED');
    await http().post(`/api/policies/${pid}/revisions/1/restore`).set(APPROVER).send({ reason: '되돌림' }).expect(403);
    await http().post(`/api/policies/${pid}/revisions/1/restore`).set(AUTHOR).send({}).expect(400);
    const res = await http().post(`/api/policies/${pid}/revisions/1/restore`).set(AUTHOR).send({ reason: '고친 내용 철회' }).expect(200);
    const r1 = await http().get(`/api/policies/${pid}/revisions/1`).expect(200);
    expect(res.body).toMatchObject({ revision: 3, status: 'DRAFT', description: '처음 내용', contentHash: r1.body.contentHash });
    const d = await http().get(`/api/policies/${pid}`).expect(200);
    expect(d.body.hashMatchesValidation).toBe(false); // 검증한 것은 r2 — 되살린 r3는 다시 검증해야 한다
    const list = await http().get(`/api/policies/${pid}/revisions`).expect(200);
    expect(list.body.items.map((x: any) => [x.revision, x.kind, x.restoredFrom, x.current])).toEqual([
      [3, 'RESTORE', 1, true],
      [2, 'UPDATE', null, false],
      [1, 'CREATE', null, false],
    ]);
    expect(list.body.items[1].validations).toEqual([expect.objectContaining({ decision: 'GO' })]);
    const ch = await http().get(`/api/policies/${pid}/changes`).expect(200);
    expect(ch.body.items[0]).toMatchObject({ revision: 3, kind: 'RESTORE', restoredFrom: 1, reason: '고친 내용 철회', before: { description: '고친 내용' }, after: { description: '처음 내용' } });
    const audit = await http().get(`/api/audit?target=${pid}`).expect(200);
    expect(audit.body.items.some((a: any) => a.action === 'POLICY_RESTORE' && a.result === 'ALLOWED')).toBe(true);
  });

  it('지금 내용과 같은 버전은 되살리지 않는다(409)', async () => {
    await http().post(`/api/policies/${pid}/revisions/3/restore`).set(AUTHOR).send({ reason: '같음' }).expect(409);
    await http().post(`/api/policies/${pid}/revisions/1/restore`).set(AUTHOR).send({ reason: '같은 내용' }).expect(409);
  });

  it('배포된 정책은 버전 복원으로 바꾸지 않는다(IMMUTABLE — 롤백의 몫), 거부는 감사에 남는다', async () => {
    const seed = (await http().get('/api/policies?flagKey=care_00022_param').expect(200)).body.items[0];
    expect(seed.status).toBe('DEPLOYED');
    const list = await http().get(`/api/policies/${seed.policyId}/revisions`).expect(200);
    expect(list.body).toMatchObject({ restorable: false, items: [expect.objectContaining({ revision: 1, kind: 'CREATE' })] });
    const r = await http().post(`/api/policies/${seed.policyId}/revisions/1/restore`).set(AUTHOR).send({ reason: '시도' }).expect(409);
    expect(r.body.error.code).toBe('IMMUTABLE');
    const audit = await http().get(`/api/audit?target=${seed.policyId}`).expect(200);
    expect(audit.body.items.some((a: any) => a.action === 'POLICY_RESTORE' && a.result === 'FAILED')).toBe(true);
  });
});

describe('정책 버전 이력 — 저장소 규칙', () => {
  it('이력 저장 이전에 있던 정책은 지금 개정본이 IMPORTED로 시작점이 되고, 개정본 기록은 고치거나 지울 수 없다', () => {
    const db = new SqliteDb(':memory:');
    const before = MIGRATIONS.filter((m) => m.name < '039');
    migrate(db, before);
    const doc = { policyId: 'POL-00007', revision: 4, status: 'DEPLOYED', contentHash: 'sha256:x', createdBy: 'usr-author', createdAt: '2026-10-01T00:00:00.000Z', featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'care_00022_flag', description: '예전 정책' };
    db.run('INSERT INTO policy (policy_id, feature_id, feature_version, control_point, flag_key, status, revision, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'POL-00007', 'FEAT-00022', '1.0.0', 'Flag', 'care_00022_flag', 'DEPLOYED', 4, JSON.stringify(doc));
    migrate(db, MIGRATIONS);
    expect(db.all('SELECT policy_id, revision, kind, changed_by FROM policy_revision')).toEqual([{ policy_id: 'POL-00007', revision: 4, kind: 'IMPORTED', changed_by: 'usr-author' }]);
    expect(() => db.run("UPDATE policy_revision SET kind = 'UPDATE'")).toThrow(/추가만/);
    expect(() => db.run('DELETE FROM policy_revision')).toThrow(/추가만/);
  });
});

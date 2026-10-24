// readiness: RD-FN-02 — 정책 버전·배포 이력과 이전 버전으로 되돌리기(정책 상세). 되돌리기는 수동 롤백과 같은 재검증·지정 승인·실행·감사를 거친다.
// 412: 화면이 본 배포가 그사이 바뀜, 409: 진행 중 요청·이미 실행한 요청, Idempotency-Key 재전송은 처음 응답 그대로.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-ph-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const LEAD = actor('park.lead', 'OPS_LEAD');

describe('정책 버전·배포 이력과 되돌리기 (RD-FN-02)', () => {
  let app: INestApplication;
  let http: () => any;
  const policies: Record<string, string> = {};
  const deployments: Record<string, string> = {};
  const advance = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    app.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  async function deployPolicy(name: string) {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: `감속 요청 파라미터 ${name}`, safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const id = c.body.policyId;
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: id }).expect(201);
    expect((await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await http().post(`/api/policies/${id}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    const d = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: `${name} 배포` }).expect(200);
    policies[name] = id;
    deployments[name] = d.body.publicationId;
    advance(12_000);
  }
  const history = async (id = policies.P2) => (await http().get(`/api/policies/${id}/history`).expect(200)).body;
  const body = (over: Record<string, unknown> = {}) => ({ recovery: { policyId: policies.P1 }, expectedDeploymentId: deployments.P2, reason: 'P2 감속 과다 — P1로 되돌림', approvers: ['park.lead'], ...over });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    const fleet = app.get(FleetRepo);
    fleet.updateVehicle({ ...fleet.vehicle('KMH-NX4-0003')!, link: 'ONLINE' }); // 대상 차량 전부가 회신해야 CONFIRMED
    for (const name of ['P1', 'P2']) await deployPolicy(name);
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it('이력 — 이 flag로 배포된 버전(최신 먼저)과 정책 버전마다 되돌릴 수 있는지(재검증 사유)', async () => {
    const h = await history();
    expect(h).toMatchObject({ flagKey: 'care_00022_param', deploymentId: deployments.P2, current: { policyId: policies.P2 } });
    expect(h.deployments.slice(0, 2).map((d: any) => [d.publicationId, d.policyId, d.current])).toEqual([
      [deployments.P2, policies.P2, true],
      [deployments.P1, policies.P1, false],
    ]);
    const p1 = h.versions.find((v: any) => v.policyId === policies.P1);
    expect(p1).toMatchObject({ status: 'RETIRED', current: false, rollback: { eligible: true, blockers: [] } });
    // 시드 정책은 이 내용으로 GO 받은 검증이 없다 — 배포와 같은 게이트라 되돌릴 수 없다
    const seed = h.versions.find((v: any) => v.policyId !== policies.P1 && v.policyId !== policies.P2);
    expect(seed.rollback.eligible).toBe(false);
    expect(seed.rollback.blockers.map((b: any) => b.code)).toContain('GATE_NOT_PASSED');
    // 어느 버전의 정책 상세에서 봐도 같은 flag 이력
    expect((await history(policies.P1)).deploymentId).toBe(deployments.P2);
    await http().get('/api/policies/POL-99999/history').expect(404);
  });

  it('되돌릴 수 없는 버전·권한 없는 역할·요청자=승인대상자는 거부(감사 FAILED)', async () => {
    const h = await history();
    const seed = h.versions.find((v: any) => v.policyId !== policies.P1 && v.policyId !== policies.P2);
    const r = await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).send(body({ recovery: { policyId: seed.policyId } })).expect(422);
    expect(r.body.error.message).toMatch(/검증 기록이 없습니다/);
    await http().post(`/api/policies/${policies.P2}/rollback`).set(AUTHOR).send(body()).expect(403);
    expect((await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).send(body({ approvers: ['seo.ops'] })).expect(403)).body.error.code).toBe('SEPARATION_OF_DUTY');
  });

  it('승인·검증한 내용과 저장된 내용이 다르면(해시 불일치) 되돌릴 수 없다 — 배포와 같은 무결성 검사', async () => {
    const db = app.get<Db>(DB);
    const row = db.get<{ doc: string }>('SELECT doc FROM policy WHERE policy_id = ?', policies.P1)!;
    const doc = JSON.parse(row.doc);
    db.run('UPDATE policy SET doc = ? WHERE policy_id = ?', JSON.stringify({ ...doc, description: `${doc.description} (변조)` }), policies.P1);
    try {
      const h = await history();
      expect(h.versions.find((v: any) => v.policyId === policies.P1).rollback.blockers.map((b: any) => b.code)).toContain('CONTENT_TAMPERED');
      await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).send(body()).expect(422);
    } finally {
      db.run('UPDATE policy SET doc = ? WHERE policy_id = ?', row.doc, policies.P1);
    }
  });

  it('낡은 화면(기준 배포가 지금 배포가 아님)은 412 — 지금 배포를 알려 준다', async () => {
    const r = await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).send(body({ expectedDeploymentId: deployments.P1 })).expect(412);
    expect(r.body.error).toMatchObject({ code: 'PRECONDITION_FAILED', details: { deploymentId: deployments.P2 } });
  });

  let requestId = '';
  it('요청 → 같은 Idempotency-Key 재전송은 처음 응답 그대로, 진행 중 요청이 있으면 새 요청은 409', async () => {
    const key = 'rd-fn-02-rollback-1';
    const a = await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).set('Idempotency-Key', key).send(body()).expect(201);
    expect(a.body).toMatchObject({ status: 'REQUESTED', deploymentId: deployments.P2, recovery: { policyId: policies.P1 }, targetTypes: ['POLICY_VERSION'], approvers: ['park.lead'] });
    requestId = a.body.requestId;
    const replay = await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).set('Idempotency-Key', key).send(body()).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.requestId).toBe(requestId);
    const dup = await http().post(`/api/policies/${policies.P2}/rollback`).set(OPERATOR).send(body({ reason: '두 번째 요청' })).expect(409);
    expect(dup.body.error.details).toEqual({ requestId });
    expect((await history()).requests.map((r: any) => [r.requestId, r.status])).toEqual([[requestId, 'REQUESTED']]);
  });

  it('승인 전 실행은 거부 → 지정 승인대상자 승인 → 실행: 재검증 뒤 P1을 새 서명 게시본으로 다시 배포', async () => {
    await http().post(`/api/rollback-requests/${requestId}/execute`).set(OPERATOR).send({}).expect(422);
    await http().post(`/api/rollback-requests/${requestId}/decision`).set(OPERATOR).send({ decision: 'APPROVE', comment: '셀프 승인' }).expect(403);
    await http().post(`/api/rollback-requests/${requestId}/decision`).set(LEAD).send({ decision: 'APPROVE', comment: '감속 과다 확인' }).expect(200);
    const x = (await http().post(`/api/rollback-requests/${requestId}/execute`).set(OPERATOR).send({}).expect(200)).body;
    expect(x).toMatchObject({ status: 'RUNNING', before: { policyId: policies.P2 }, after: { policyId: policies.P1 }, approvedBy: 'park.lead', requestedBy: 'seo.ops' });
    advance(12_000);
    const h = await history();
    expect(h.current.policyId).toBe(policies.P1);
    expect(h.deploymentId).toBe(x.artifactId);
    expect(h.deployments[0]).toMatchObject({ publicationId: x.artifactId, policyId: policies.P1, current: true, status: 'CONFIRMED' });
    expect(h.executions[0]).toMatchObject({ executionId: x.executionId, status: 'COMPLETED', result: 'SUCCESS' });
    expect(h.versions.find((v: any) => v.policyId === policies.P2)).toMatchObject({ status: 'RETIRED', rollback: { eligible: true } }); // 다시 되돌릴 수도 있다
  });

  it('이미 실행한 요청을 다시 실행하면 409 — 실행 기록을 알려 주고 두 번 되돌리지 않는다', async () => {
    const before = (await history()).deployments.length;
    const r = await http().post(`/api/rollback-requests/${requestId}/execute`).set(OPERATOR).send({}).expect(409);
    expect(r.body.error.details.executionId).toMatch(/^RBX?-?/);
    expect((await history()).deployments.length).toBe(before);
  });

  it('감사 — 요청·승인·실행·재배포·거부가 남는다', async () => {
    const items = (await http().get('/api/audit?limit=1000').expect(200)).body.items as { action: string; result: string; target: string }[];
    const actions = new Set(items.map((i) => `${i.action}:${i.result}`));
    for (const a of ['ROLLBACK_REQUEST:ALLOWED', 'ROLLBACK_REQUEST:FAILED', 'ROLLBACK_REQUEST_DECIDE:ALLOWED', 'ROLLBACK_EXECUTE:ALLOWED', 'ROLLBACK_EXECUTE:FAILED', 'POLICY_DEPLOY:ALLOWED']) expect(actions).toContain(a);
  });
});

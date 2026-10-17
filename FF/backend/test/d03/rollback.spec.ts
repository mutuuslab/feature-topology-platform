// 롤백 (D03-04) — 배포 ID 기준 조회·복구 가능 버전·미리보기, 수동 롤백(요청→지정 승인→실행), 재검증 실패, Rollback Plan 자동 롤백(실패율·DTC), 이력·알림.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-rb-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { EventService } from '../../src/kernel/event.service';
import { Scheduler } from '../../src/kernel/scheduler';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const LEAD = actor('park.lead', 'OPS_LEAD');
const OTHER_LEAD = actor('choi.lead', 'OPS_LEAD');
const OFFLINE = 'KMH-NX4-0003';
const FEATURE_SCOPE = { featureIds: ['FEAT-00022'] };

describe('롤백 (D03-04)', () => {
  let app: INestApplication;
  let http: () => any;
  let scheduler: Scheduler;
  const policies: Record<string, string> = {};
  const deployments: Record<string, string> = {};
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    scheduler = app.get(Scheduler);
    link(OFFLINE, 'ONLINE'); // 성공 경로는 대상 차량 전부가 회신해야 CONFIRMED
    for (const name of ['P1', 'P2']) await deployPolicy(name);
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  const advance = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    scheduler.flush(ms);
    clock.set(new Date(until));
  };
  const link = (vin: string, l: 'ONLINE' | 'OFFLINE') => {
    const fleet = app.get(FleetRepo);
    fleet.updateVehicle({ ...fleet.vehicle(vin)!, link: l });
  };
  async function deployPolicy(name: string, wait = true) {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: `감속 요청 파라미터 ${name}`, safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const id = c.body.policyId;
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: id }).expect(201);
    expect((await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await http().post(`/api/policies/${id}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    const d = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: `${name} 배포` }).expect(200);
    policies[name] = id;
    deployments[name] = d.body.publicationId;
    if (wait) advance(12_000);
  }
  const pubStatus = async (id: string) => (await http().get(`/api/publications/${id}`).expect(200)).body.publication.status;
  const policy = async (id: string) => (await http().get(`/api/policies/${id}`).expect(200)).body.policy;
  const request = (over: Record<string, unknown> = {}) => ({ deploymentId: deployments.P2, targetTypes: ['POLICY_VERSION'], recovery: { policyId: policies.P1 }, scope: FEATURE_SCOPE, reason: 'P2 감속 과다 — P1로 복구', approvers: ['park.lead'], ...over });

  describe('배포 ID 기준 조회', () => {
    it('flag별 지금 배포와 복구 가능 버전 — 검증 기록 없는 시드 정책은 복구 불가', async () => {
      expect(await pubStatus(deployments.P2)).toBe('CONFIRMED');
      const d = (await http().get('/api/rollbacks/deployments').expect(200)).body.items.find((x: any) => x.flagKey === 'care_00022_param');
      expect(d).toMatchObject({ deploymentId: deployments.P2, deployed: { policyId: policies.P2 }, eligible: 1 });
      const det = (await http().get(`/api/rollbacks/deployments/${deployments.P2}`).expect(200)).body;
      expect(det).toMatchObject({ current: true, feature: { featureId: 'FEAT-00022' }, swHistory: { available: false } });
      expect(det.deploymentHistory.map((h: any) => h.publicationId).slice(0, 2)).toEqual([deployments.P2, deployments.P1]);
      expect(det.policyChanges[0]).toMatchObject({ kind: 'CREATE', changedBy: 'kim.author' });
      const [first, ...rest] = det.candidates;
      expect(first).toMatchObject({ policyId: policies.P1, eligible: true, artifactId: deployments.P1 });
      expect(rest.every((c: any) => !c.eligible && c.blockers.some((b: any) => b.code === 'GATE_NOT_PASSED'))).toBe(true);
      await http().get('/api/rollbacks/deployments/PUB-99999').expect(404);
    });

    it('미리보기 — 영향 Feature·차량 그룹, 일부 범위·지금 정책으로의 복구는 막는다', async () => {
      const ok = (await http().post('/api/rollbacks/preview').set(OPERATOR).send({ deploymentId: deployments.P2, recovery: { policyId: policies.P1 }, scope: FEATURE_SCOPE }).expect(200)).body;
      expect(ok).toMatchObject({ applicable: true, blockers: [], current: { policyId: policies.P2 }, recovery: { policyId: policies.P1 } });
      expect(ok.vins).toHaveLength(6);
      expect(ok.impact.features[0]).toMatchObject({ featureId: 'FEAT-00022', role: 'TARGET' });
      expect(ok.vehicleGroups.reduce((n: number, g: any) => n + g.vins.length, 0)).toBe(6);
      const part = (await http().post('/api/rollbacks/preview').set(OPERATOR).send({ deploymentId: deployments.P2, recovery: { policyId: policies.P1 }, scope: { vins: ['KMH-NX4-0001'] } }).expect(200)).body;
      expect(part.blockers.map((b: any) => b.code)).toEqual(['SCOPE_PARTIAL']);
      const same = (await http().post('/api/rollbacks/preview').set(OPERATOR).send({ deploymentId: deployments.P1, recovery: { policyId: policies.P2 }, scope: FEATURE_SCOPE }).expect(200)).body;
      expect(same.blockers.map((b: any) => b.code)).toEqual(['DEPLOYMENT_NOT_CURRENT', 'RECOVERY_IS_CURRENT']);
    });
  });

  describe('수동 롤백', () => {
    let r1: string;
    let r2: string;
    it('입력 검증 — 권한·요청자 승인대상 지정·SW 버전(OTA 위임)·적용 범위', async () => {
      await http().post('/api/rollback-requests').set(AUTHOR).send(request()).expect(403);
      expect((await http().post('/api/rollback-requests').set(OPERATOR).send(request({ approvers: ['seo.ops'] })).expect(403)).body.error.code).toBe('SEPARATION_OF_DUTY');
      const sw = await http().post('/api/rollback-requests').set(OPERATOR).send(request({ targetTypes: ['POLICY_VERSION', 'SW_VERSION'] })).expect(422);
      expect(sw.body.error.details.blockers.map((b: any) => b.code)).toEqual(['SW_VERSION_EXTERNAL']);
      await http().post('/api/rollback-requests').set(OPERATOR).send(request({ scope: {} })).expect(400);
    });

    it('요청 → 지정 승인대상자에게 승인 요청 알림, 승인 전 실행 불가, 지정되지 않은 사람·요청자는 승인 불가', async () => {
      r1 = (await http().post('/api/rollback-requests').set(OPERATOR).send(request()).expect(201)).body.requestId;
      r2 = (await http().post('/api/rollback-requests').set(OPERATOR).send(request({ reason: '같은 배포에 대한 두 번째 요청' })).expect(201)).body.requestId;
      const inbox = (await http().get('/api/notifications').set(LEAD).expect(200)).body.items;
      const n = inbox.find((x: any) => x.eventType === 'rollback.requested' && x.fields.some((f: any) => f.value === r1));
      expect(n).toMatchObject({ category: 'APPROVAL', link: `/ops/rollback?request=${r1}` });
      expect(n.fields.map((f: any) => f.label)).toEqual(['수동 롤백 요청 ID', '배포 ID', 'Feature', '배포 버전', '롤백 대상 유형', '복구 기준 버전', '적용 대상 범위', '복구 사유', '요청자', '요청 일시']);
      expect((await http().get('/api/notifications').set(OPERATOR).expect(200)).body.items.some((x: any) => x.eventType === 'rollback.requested')).toBe(false);
      await http().post(`/api/rollback-requests/${r1}/execute`).set(OPERATOR).send({}).expect(422);
      await http().post(`/api/rollback-requests/${r1}/decision`).set(OTHER_LEAD).send({ decision: 'APPROVE', comment: '확인' }).expect(403);
      await http().post(`/api/rollback-requests/${r1}/decision`).set(LEAD).send({ decision: 'APPROVE', comment: '현장 보고 확인' }).expect(200);
      await http().post(`/api/rollback-requests/${r2}/decision`).set(LEAD).send({ decision: 'APPROVE', comment: '확인' }).expect(200);
      expect((await http().get(`/api/rollback-requests/${r1}`).expect(200)).body).toMatchObject({ status: 'APPROVED', decision: { decision: 'APPROVE', by: 'park.lead', comment: '현장 보고 확인' } });
    });

    it('실행 — 지금 정책은 RETIRED, 복구 기준 정책이 같은 해시로 다시 배포되고 회신이 모두 오면 완료·성공', async () => {
      const before = await policy(policies.P1);
      const x = (await http().post(`/api/rollback-requests/${r1}/execute`).set(OPERATOR).send({}).expect(200)).body;
      expect(x).toMatchObject({ mode: 'MANUAL', requestId: r1, status: 'RUNNING', before: { policyId: policies.P2 }, after: { policyId: policies.P1, contentHash: before.contentHash }, sourceArtifactId: deployments.P1, trigger: { kind: 'MANUAL' } });
      expect(x.artifactId).not.toBe(deployments.P1); // 같은 내용을 새 순번으로 다시 서명
      expect((await policy(policies.P1)).status).toBe('DEPLOYED');
      expect((await policy(policies.P2)).status).toBe('RETIRED');
      expect((await http().get(`/api/rollback-requests/${r1}`).expect(200)).body).toMatchObject({ status: 'EXECUTED', executionId: x.executionId });
      const art = (await http().get(`/api/publications/${x.artifactId}`).expect(200)).body.publication;
      expect(art.payload.policy).toMatchObject({ policyId: policies.P1, contentHash: before.contentHash });
      advance(12_000);
      const done = (await http().get(`/api/rollbacks/${x.executionId}`).expect(200)).body;
      expect(done).toMatchObject({ status: 'COMPLETED', result: 'SUCCESS', failureReason: null });
      deployments.R1 = x.artifactId;
      // 완료 알림 — 요청자·승인자·배포 요청자
      for (const who of [OPERATOR, LEAD, RELEASE]) {
        const items = (await http().get('/api/notifications').set(who).expect(200)).body.items;
        expect(items.some((n: any) => n.eventType === 'rollback.completed' && n.fields.some((f: any) => f.label === '롤백 결과' && f.value === '성공'))).toBe(true);
      }
      const audit = (await http().get(`/api/audit?target=${x.executionId}`).expect(200)).body.items.map((a: any) => a.action);
      expect(audit).toEqual(expect.arrayContaining(['ROLLBACK_EXECUTE', 'ROLLBACK_RESULT']));
    });

    it('재검증 — 승인 뒤 배포가 바뀌었으면 아무것도 바꾸지 않고 실패로 남긴다', async () => {
      const x = (await http().post(`/api/rollback-requests/${r2}/execute`).set(OPERATOR).send({}).expect(200)).body;
      expect(x).toMatchObject({ status: 'FAILED', result: 'FAILURE', artifactId: null, failureReason: expect.stringContaining('지금 효력이 있는 배포가 아닙니다') });
      expect(x.failedAt).toBeTruthy();
      expect((await policy(policies.P1)).status).toBe('DEPLOYED');
      const failed = (await http().get('/api/notifications').set(OPERATOR).expect(200)).body.items.find((n: any) => n.eventType === 'rollback.failed');
      expect(failed.fields.map((f: any) => f.label)).toEqual(['배포 ID', 'Feature', '롤백 대상 유형', '복구 기준 버전', '실패 사유', '실패 발생 시점']);
    });

    it('이력 조회 — 요청·차량·상태·결과로 거른다', async () => {
      const all = (await http().get('/api/rollbacks').expect(200)).body.items;
      expect(all).toHaveLength(2);
      expect((await http().get(`/api/rollbacks?requestId=${r1}`).expect(200)).body.items.map((x: any) => x.status)).toEqual(['COMPLETED']);
      expect((await http().get('/api/rollbacks?result=FAILURE').expect(200)).body.items.map((x: any) => x.requestId)).toEqual([r2]);
      expect((await http().get('/api/rollbacks?vin=KMH-NX4-0001&status=COMPLETED').expect(200)).body.items).toHaveLength(1);
      expect((await http().get('/api/rollbacks?featureId=FEAT-00024').expect(200)).body.items).toHaveLength(0);
      await http().get('/api/rollbacks/RBX-99999').expect(404);
    });
  });

  describe('Rollback Plan 자동 롤백', () => {
    it('계획은 지정 승인대상자 승인 전에는 감시하지 않고, 승인되면 배포 실패율이 기준을 넘을 때 실행한다 — 회신이 모자라면 실패로 남는다', async () => {
      link(OFFLINE, 'OFFLINE');
      await deployPolicy('P3', false); // 회신 기한 전 — 이 배포에 계획을 건다
      const body = { deploymentId: deployments.P3, targetTypes: ['POLICY_VERSION'], recovery: { policyId: policies.P1 }, conditions: { failureRate: { thresholdPercent: 10 } }, scope: FEATURE_SCOPE, approvers: ['park.lead'] };
      const plan = (await http().post('/api/rollback-plans').set(OPERATOR).send(body).expect(201)).body;
      expect(plan).toMatchObject({ status: 'REQUESTED', deployed: { policyId: policies.P3 }, recovery: { policyId: policies.P1 } });
      const n = (await http().get('/api/notifications').set(LEAD).expect(200)).body.items.find((x: any) => x.eventType === 'rollback.plan.requested');
      expect(n.fields.find((f: any) => f.label === '롤백 조건').value).toBe('배포 실패율 > 10%');
      await http().post(`/api/rollback-plans/${plan.planId}/decision`).set(LEAD).send({ decision: 'APPROVE', comment: '조건 확인' }).expect(200);
      advance(12_000); // P3 게시본: 6대 중 1대 무회신 → PARTIAL, 실패율 16.7% > 10%
      expect(await pubStatus(deployments.P3)).toBe('PARTIAL');
      const p = (await http().get(`/api/rollback-plans/${plan.planId}`).expect(200)).body;
      expect(p.status).toBe('TRIGGERED');
      const x = (await http().get(`/api/rollbacks/${p.executionId}`).expect(200)).body;
      // 같은 시간 흐름 안에서 롤백 게시본도 기한을 넘긴다 — 같은 1대가 무회신이라 실패. 서버 기준은 복구 기준 정책으로 바뀌어 있다
      expect(x).toMatchObject({ mode: 'AUTO', planId: plan.planId, status: 'FAILED', result: 'FAILURE', trigger: { kind: 'FAILURE_RATE', detail: expect.stringContaining('16.7%') }, after: { policyId: policies.P1 }, failureReason: expect.stringContaining('PARTIAL — 차량 확인 5/6') });
      expect(x.artifactId).toBeTruthy();
      expect((await policy(policies.P1)).status).toBe('DEPLOYED');
      deployments.AUTO = x.artifactId;
    });

    it('DTC 조건 — 등록한 DTC가 범위 안 차량에서 보고되면 실행, 반려된 계획은 감시하지 않는다', async () => {
      link(OFFLINE, 'ONLINE');
      const body = { deploymentId: deployments.AUTO, targetTypes: ['POLICY_VERSION'], recovery: { policyId: policies.P3 }, conditions: { dtc: { codes: ['4A0001'], types: [] } }, scope: FEATURE_SCOPE, approvers: ['park.lead'] };
      const rejected = (await http().post('/api/rollback-plans').set(OPERATOR).send(body).expect(201)).body.planId;
      await http().post(`/api/rollback-plans/${rejected}/decision`).set(LEAD).send({ decision: 'REJECT', comment: '조건 과민' }).expect(200);
      const plan = (await http().post('/api/rollback-plans').set(OPERATOR).send(body).expect(201)).body.planId;
      await http().post(`/api/rollback-plans/${plan}/decision`).set(LEAD).send({ decision: 'APPROVE', comment: '확인' }).expect(200);
      const report = (dtc: string[]) => app.get<Db>(DB).tx(() => app.get(EventService).publish('vehicle.status.accepted', 'KMH-NX4-0001', { vin: 'KMH-NX4-0001', featureId: 'FEAT-00022', state: 'ACTIVE', dtc }, { componentId: 'D04-03' }));
      report(['012345']);
      expect((await http().get(`/api/rollback-plans/${plan}`).expect(200)).body.status).toBe('APPROVED');
      report(['4A0001']);
      const p = (await http().get(`/api/rollback-plans/${plan}`).expect(200)).body;
      expect(p.status).toBe('TRIGGERED');
      expect((await http().get(`/api/rollback-plans/${rejected}`).expect(200)).body.status).toBe('REJECTED');
      const x = (await http().get(`/api/rollbacks/${p.executionId}`).expect(200)).body;
      expect(x).toMatchObject({ mode: 'AUTO', status: 'RUNNING', trigger: { kind: 'DTC', detail: expect.stringContaining('KMH-NX4-0001 DTC 4A0001') }, after: { policyId: policies.P3 } });
      report(['4A0001']); // 이미 실행한 계획은 다시 실행하지 않는다
      expect((await http().get(`/api/rollbacks?planId=${plan}`).expect(200)).body.items).toHaveLength(1);
      advance(12_000);
      expect((await http().get(`/api/rollbacks/${x.executionId}`).expect(200)).body).toMatchObject({ status: 'COMPLETED', result: 'SUCCESS' });
    });
  });
});

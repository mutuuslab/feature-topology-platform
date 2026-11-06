// 수신자 지정 알림 보강·오류 이력 (기능명세서 B1·B6, D04-04) — 수신자 규칙(추가 수신자)·직접 보내기, 충돌 탐지·품질 Gate 실패·배포 중단·
// 파이프라인 실패·Legacy·과금 연계 오류·정책 서명 실패가 오류 이력과 담당자 알림으로 이어지는지 실제 업무 경로로 확인한다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp, killV2 } from '../helpers';

const OWNER = actor('usr-author', 'FEATURE_AUTHOR'); // 데모: Feature 설계 계정이 Owner 팀 알림을 받는다
const VIEWER = actor('usr-viewer', 'AUDITOR');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const INTEGRATOR = actor('usr-integrator', 'IMPLEMENTER');
const OPERATOR = actor('usr-operator', 'OPERATOR');
const COMMERCE = actor('usr-commerce', 'PRODUCT_AUTHOR');
const QUALITY = actor('usr-quality', 'GATE_JUDGE');
const CSM = actor('usr-integrator', 'SECURITY_OFFICER');

describe('수신자 지정 알림 보강·오류 이력 (D04-04)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const http = () => b.http();
  const inbox = async (who: Record<string, string>) => (await http().get('/api/notifications?limit=500').set(who).expect(200)).body;
  const find = async (who: Record<string, string>, type: string) => (await inbox(who)).items.filter((n: any) => n.eventType === type);
  const errors = async (q = '') => (await http().get(`/api/integrations/errors${q}`).expect(200)).body;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-11-06T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'IF_MODE_12', 'IF_MODE_BILLING']) delete process.env[k];
  });

  describe('수신자 규칙·직접 보내기', () => {
    it('규칙 목록 — 이벤트마다 기본 수신자(끌 수 없음)와 추가 수신자, 팀 선택지', async () => {
      const r = (await http().get('/api/notifications/rules').expect(200)).body;
      const v = r.items.find((x: any) => x.event === 'policy.validated');
      expect(v).toMatchObject({ category: 'DEPLOY', recipients: ['FEATURE_APPROVER', 'OWNER_TEAM', 'AUTHOR'], added: [] });
      expect(r.items.find((x: any) => x.event === 'rollout.halt-required').requirementIds).toEqual(['FR-DSV-003-005']);
      expect(r.teams.length).toBeGreaterThan(0);
    });

    it('추가 수신자 바꾸기 — 운영 리더만, 없는 이벤트 404, 모르는 팀 거부, 사유는 감사에', async () => {
      const body = { recipients: [{ kind: 'user', id: 'usr-viewer' }, { kind: 'role', role: 'RELEASE_MANAGER' }], reason: '검증 결과를 감사 조회자도 받게' };
      await http().put('/api/notifications/rules/policy.validated').set(OWNER).send(body).expect(403);
      await http().put('/api/notifications/rules/no.such.event').set(OPSLEAD).send(body).expect(404);
      await http().put('/api/notifications/rules/policy.validated').set(OPSLEAD).send({ recipients: [{ kind: 'team', team: '없는팀' }], reason: '오타 시험' }).expect(400);
      const r = (await http().put('/api/notifications/rules/policy.validated').set(OPSLEAD).send(body).expect(200)).body;
      expect(r.added).toEqual([{ kind: 'role', role: 'RELEASE_MANAGER' }, { kind: 'user', id: 'usr-viewer' }]);
      expect(r.updatedBy).toBe('usr-opslead');
      const a = (await http().get('/api/audit?action=NOTIFICATION_RULE_UPDATE').expect(200)).body.items[0];
      expect(a).toMatchObject({ target: 'policy.validated', reason: '검증 결과를 감사 조회자도 받게', after: { recipients: ['role:RELEASE_MANAGER', 'user:usr-viewer'] } });
    });

    it('직접 보내기 — 고른 사람·역할·팀이 받고 보낸 사람은 빠진다, 감사 조회자는 보낼 수 없다', async () => {
      const send = { title: '오늘 22시 Edge 점검', message: '점검 중 차량 서명본 발급이 5분 멈춥니다', severity: 'WARNING', link: '/ops/kill', recipients: [{ kind: 'role', role: 'OPS_LEAD' }, { kind: 'user', id: 'usr-integrator' }] };
      await http().post('/api/notifications/send').set(VIEWER).send(send).expect(403);
      const r = (await http().post('/api/notifications/send').set(OPSLEAD).send(send).expect(201)).body;
      expect(r.notificationId).toMatch(/^NTF-/);
      const got = (await find(INTEGRATOR, 'notification.sent'))[0];
      expect(got).toMatchObject({ category: 'DIRECT', severity: 'WARNING', title: '오늘 22시 Edge 점검', link: '/ops/kill' });
      expect(got.fields).toEqual([{ label: '내용', value: '점검 중 차량 서명본 발급이 5분 멈춥니다' }, { label: '보낸 사람', value: 'usr-opslead' }]);
      expect(await find(OPSLEAD, 'notification.sent')).toHaveLength(0); // 보낸 사람 본인 제외
    });
  });

  describe('업무 흐름 알림', () => {
    it('FR-CON-001-003 충돌 탐지 — 같은 문맥 조건이 모순인 정책 검증 → Owner·관리자(정책 승인)·작성자, 추가 수신자 규칙도 적용', async () => {
      const c = await http()
        .post('/api/policies')
        .set(OWNER)
        .send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'care_00022_flag', description: '모순 조건 시험', safeDefault: false, entitlementCatalogId: 'CAT-00019', strategies: [{ name: '국가', constraints: [{ contextName: 'country', operator: 'IN', values: ['KR'] }, { contextName: 'country', operator: 'IN', values: ['US'] }] }] })
        .expect(201);
      const pid = c.body.policyId;
      await http().post(`/api/policies/${pid}/validate`).set(OWNER).send({}).expect(200);
      const n = (await find(OWNER, 'policy.conflict.detected'))[0];
      expect(n).toMatchObject({ category: 'DEPLOY', link: `/policies/${pid}`, requirementIds: ['FR-CON-001-003'] });
      expect(n.fields.find((f: any) => f.label === '충돌 내용').value).toContain('모순');
      expect(await find(actor('usr-approver', 'FEATURE_APPROVER'), 'policy.conflict.detected')).toHaveLength(1);
      // 수신자 규칙의 추가 수신자 — policy.validated에 더한 감사 조회자 계정이 검증 결과 알림을 받는다
      expect((await find(VIEWER, 'policy.validated')).length).toBeGreaterThan(0);
    });

    it('FR-QGV-003-005 품질 Gate 실패 — G5가 PASS가 아닌 Feature의 정책 검증 → 산출물 ID·실패 항목·사유를 Gate 판정 담당에게', async () => {
      const features = (await http().get('/api/features?latestOnly=true').expect(200)).body.items as any[];
      let pid: string | null = null;
      for (const f of features.filter((x) => ['APPROVED', 'DEVELOPING'].includes(x.lifecycle) && x.controlPoints?.length)) {
        const gates = (await http().get(`/api/features/${f.featureId}/versions/${f.version}/gates`).expect(200)).body;
        const g5 = Array.isArray(gates.items) ? gates.items.find((g: any) => g.gate === 'G5') : gates.G5;
        if (g5?.status === 'PASS') continue;
        const flagKey = `qg_${f.featureId.slice(5)}_${f.controlPoints[0].toLowerCase()}`;
        const c = await http().post('/api/policies').set(OWNER).send({ featureId: f.featureId, featureVersion: f.version, controlPoint: f.controlPoints[0], flagKey, description: '품질 Gate 시험' });
        if (c.status !== 201) continue;
        pid = c.body.policyId;
        break;
      }
      expect(pid).not.toBeNull();
      await http().post(`/api/policies/${pid}/validate`).set(OWNER).send({}).expect(200);
      const n = (await find(QUALITY, 'quality.gate.failed'))[0];
      expect(n).toMatchObject({ category: 'GATE', link: `/policies/${pid}`, requirementIds: ['FR-QGV-003-005'] });
      expect(n.fields.map((f: any) => f.label)).toEqual(['산출물', 'Feature', '실패 항목', '실패 사유']);
      expect(n.fields[0].value).toContain(`정책 ${pid} r1`);
      expect(n.fields[3].value).toContain('G5');
    });

    it('FR-DSV-003-005 배포 중단 필요 — 확대 요청이 중단 기준(진행 중 차단)에 걸리면 배포 ID·Feature·사유를 Owner·배포자·요청자에게', async () => {
      const pid = (await http().get('/api/policies?featureId=FEAT-00022').expect(200)).body.items.find((p: any) => p.status === 'DEPLOYED' && p.flagKey === 'care_00022_param').policyId;
      const stage = (basisPoints: number) => http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints, reason: '단계 조정' });
      await stage(0).expect(200);
      await stage(300).expect(200);
      const c = b.get(Clock);
      c.set(new Date(c.now().getTime() + 25 * 3600_000));
      const k = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '단계 확대 중 결함', confirm: 'FEAT-00022' });
      const coordinator = actor('usr-coordinator', 'RELEASE_MANAGER');
      expect((await http().post(`/api/policies/${pid}/rollout`).set(coordinator).send({ basisPoints: 5000, reason: '확대' }).expect(422)).body.error.message).toMatch(new RegExp(`차단 ${k.killId}`));
      const n = (await find(OWNER, 'rollout.halt-required'))[0];
      expect(n).toMatchObject({ category: 'DEPLOY', severity: 'CRITICAL', requirementIds: ['FR-DSV-003-005'] });
      expect(n.fields[0].value).toContain(pid);
      expect(n.fields[1].value).toContain('FEAT-00022');
      expect(n.fields[2].value).toContain(k.killId);
      expect(await find(coordinator, 'rollout.halt-required')).toHaveLength(1); // 확대를 요청한 사람
    });
  });

  describe('오류 이력 + 담당자 알림', () => {
    it('FR-CICD-001-006 파이프라인 실패 수신 → 실행 기록·오류 이력·구현 담당 알림. 실패에 단계·사유가 없으면 거부', async () => {
      await http().post('/api/pipeline/runs').set(INTEGRATOR).send({ runId: 'GL-4411', pipeline: 'adas/main', environment: 'staging', status: 'FAILED' }).expect(400);
      await http().post('/api/pipeline/runs').set(VIEWER).send({ runId: 'GL-4411', pipeline: 'adas/main', environment: 'staging', status: 'STARTED' }).expect(403);
      await http().post('/api/pipeline/runs').set(INTEGRATOR).send({ runId: 'GL-4411', pipeline: 'adas/main', environment: 'staging', status: 'STARTED', featureId: 'FEAT-00022' }).expect(201);
      const r = await http().post('/api/pipeline/runs').set(INTEGRATOR).send({ runId: 'GL-4411', pipeline: 'adas/main', environment: 'staging', status: 'FAILED', featureId: 'FEAT-00022', stage: 'hil-test', reason: 'HIL 시험 3건 실패', finishedAt: '2026-11-06T02:00:00.000Z' }).expect(201);
      expect(r.body).toMatchObject({ status: 'FAILED', receivedBy: 'usr-integrator' });
      await http().post('/api/pipeline/runs').set(INTEGRATOR).send({ runId: 'GL-4411', pipeline: 'adas/main', environment: 'staging', status: 'STARTED' }).expect(409);
      expect((await http().get('/api/pipeline/runs?featureId=FEAT-00022').expect(200)).body.items[0]).toMatchObject({ runId: 'GL-4411', status: 'FAILED', stage: 'hil-test' });
      const e = (await errors('?system=PIPELINE')).items[0];
      expect(e).toMatchObject({ system: 'PIPELINE', errorType: 'PIPELINE_FAILED', target: 'GL-4411', at: '2026-11-06T02:00:00.000Z', featureId: 'FEAT-00022' });
      const n = (await find(INTEGRATOR, 'pipeline.run.failed'))[0];
      expect(n).toMatchObject({ category: 'INTEGRATION', requirementIds: ['FR-CICD-001-006'] });
      expect(n.fields.slice(0, 3).map((f: any) => f.value)).toEqual(['GL-4411 · adas/main · staging', 'hil-test', 'HIL 시험 3건 실패']);
    });

    it('FR-LGCY-001-007·008 Legacy 연계 오류(IF-12 꺼짐) → 오류 유형·시점·대상 시스템·내용 기록, 연계 담당 알림', async () => {
      process.env.IF_MODE_12 = 'off';
      try {
        await http().post('/api/legacy/orders/import').set(OPERATOR).send({ plant: 'TMA' }).expect(422);
      } finally {
        delete process.env.IF_MODE_12;
      }
      const e = (await errors('?system=LEGACY')).items[0];
      expect(e).toMatchObject({ system: 'LEGACY', systemName: 'Legacy 연계(해외공장 ERP)', errorType: 'CONNECTION_OFF', target: 'IF-12 해외공장 TMA', actorId: 'usr-operator' });
      expect(e.message).toContain('꺼져 있습니다');
      expect(e.at).toBeTruthy();
      const n = (await find(INTEGRATOR, 'legacy.import.failed'))[0];
      expect(n).toMatchObject({ requirementIds: ['FR-LGCY-001-008'] });
      expect(n.fields.map((f: any) => f.label)).toEqual(['오류 유형', '발생 시점', '대상 시스템', '오류 내용']);
    });

    it('FR-BIL-001-003·004 과금 연계 오류(꺼짐) → 결제·전환 없음, 오류 이력·상품 담당 알림', async () => {
      const offered = (await http().get('/api/trials?source=DEMO&catalogId=CAT-00019').expect(200)).body.items.find((t: any) => t.state === 'OFFERED');
      const gid = offered.grantId as string;
      await http().post(`/api/trials/${gid}/accept`).set(OPERATOR).send({}).expect(200);
      process.env.IF_MODE_BILLING = 'off';
      try {
        expect((await http().post(`/api/trials/${gid}/purchase`).set(OPERATOR).send({ plan: '구독' }).expect(422)).body.error.message).toContain('과금 시스템 연계가 꺼져 있습니다');
      } finally {
        delete process.env.IF_MODE_BILLING;
      }
      const e = (await errors('?system=BILLING')).items[0];
      expect(e).toMatchObject({ system: 'BILLING', errorType: 'CONNECTION_OFF', target: `${gid}:구독` });
      expect((await find(COMMERCE, 'billing.call.failed'))[0]).toMatchObject({ requirementIds: ['FR-BIL-001-004'] });
      // 결제가 나가지 않았으므로 다시 시도하면 처음 주문으로 처리된다(멱등 기록이 남지 않았다)
      const p = await http().post(`/api/trials/${gid}/purchase`).set(OPERATOR).send({ plan: '구독' }).expect(200);
      expect(p.body.order.status).toBe('PAID');
    });

    it('FR-SDM-001-001 정책 서명 실패(키 만료) → 배포하지 않고 실패 사유·일시를 감사·오류 이력에, 보안 담당 알림', async () => {
      const repo = b.get(PolicyRepo);
      const p = repo.all().find((x) => x.status === 'DEPLOYED' && x.flagKey === 'care_00022_signal')!;
      repo.update({ ...p, status: 'APPROVED' });
      const db = b.get<Db>(DB);
      db.run("UPDATE pki_key SET not_after = '2026-01-01T00:00:00.000Z' WHERE purpose = 'policy' AND status = 'ACTIVE'");
      const r = await http().post(`/api/policies/${p.policyId}/deploy`).set(OPERATOR).send({ reason: '서명 실패 시험' }).expect(422);
      expect(r.body.error.message).toContain('만료되었습니다');
      expect(repo.get(p.policyId)!.status).toBe('APPROVED'); // 배포되지 않았다
      const e = (await errors('?system=SIGNING')).items[0];
      expect(e).toMatchObject({ system: 'SIGNING', errorType: 'KEY_EXPIRED', target: p.policyId, featureId: 'FEAT-00022' });
      const a = (await http().get(`/api/audit?target=${p.policyId}&result=FAILED`).expect(200)).body.items[0];
      expect(a).toMatchObject({ action: 'POLICY_DEPLOY', result: 'FAILED' });
      expect(a.reason).toContain('정책 서명 실패');
      expect((await find(CSM, 'signing.failed')).length).toBe(1);
    });

    it('오류 이력 조회 — 시스템·기간 조건, 일치하는 이력이 없으면 빈 목록, 모르는 시스템 400', async () => {
      const all = await errors();
      expect(all.items.length).toBeGreaterThanOrEqual(4);
      expect(all.counts).toMatchObject({ LEGACY: 1, BILLING: 1, SIGNING: 1, PIPELINE: 1 });
      expect((await errors('?from=2030-01-01')).items).toEqual([]);
      await http().get('/api/integrations/errors?system=NOPE').expect(400);
      // 추가만 — 지울 수 없다
      expect(() => b.get<Db>(DB).run('DELETE FROM integration_error')).toThrow(/추가만/);
    });
  });
});

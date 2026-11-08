// 예외 정책 층(GX) — FR-EXC-001·002(요청·2인 승인·만료·원복), FR-REG-005-010(PENDING Gate 예외), FR-RDD-001-006(출시 전 Shadow만),
// FR-ROL-002-008(중단 기준 충족 여부 기록·중단은 언제나). Gate 판정(FFG-LCY-002)은 바꾸지 않고, 예외는 기록된 제한 범위만 연다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-gx-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, confirmSafety, signG7, withRef } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const OPERATOR = actor('usr-operator', 'OPERATOR');
const FSM = actor('usr-quality', 'SAFETY_OFFICER');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const REG = actor('usr-steward', 'REGULATORY_OWNER');
const T0 = '2026-10-12T01:00:00.000Z';

afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
});

describe('예외 정책 층 (GX)', () => {
  let app: INestApplication;
  let http: () => any;
  let fid: string;
  let pid: string;
  let gateExc: string;
  const clock = () => app.get(Clock);
  const approve = (id: string, who: Record<string, string>, expiresAt: string, reason = '긴급 대응 범위 확인') => http().post(`/api/exceptions/${id}/decision`).set(who).send({ decision: 'APPROVE', reason, expiresAt });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: T0 }));
  });
  afterAll(async () => app?.close());

  describe('출시 전 Version은 Shadow만 + PENDING Gate 예외(FR-RDD-001-006·FR-REG-005-010)', () => {
    it('준비: G1~G7 PASS·정책 승인으로 VERIFIED(G8·G9 미판정)인 Version', async () => {
      const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '예외 시험 Feature', description: 'GX', requirementIds: ['REQ-GX-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
      fid = f.body.featureId;
      await http().patch(`/api/features/${fid}/versions/0.1.0`).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
      await confirmSafety(http, fid, '0.1.0');
      for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
      await signG7(http, fid, '0.1.0');
      for (const g of ['G4', 'G5', 'G6', 'G7']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: fid, featureVersion: '0.1.0', controlPoint: 'Flag', flagKey: `care_${fid.slice(5)}_gx`, description: '예외 시험 Flag', safeDefault: false }).expect(201);
      pid = c.body.policyId;
      expect((await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      const r = await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
      expect(r.body.feature.lifecycle).toBe('VERIFIED');
      await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: 'G8', inputResult: 'CONDITIONAL', rationale: '야간 주행 시험 남음', evidenceRef: 'EV-G8' }).expect(201);
    });

    it('출시 전(G8 검토 중·G9 미판정)이면 실제 배포는 거부 — Shadow만, 감사 FAILED', async () => {
      const g = (await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body;
      expect(g).toMatchObject({ allowed: false, shadowOnly: true, pendingGates: ['G8', 'G9'] });
      const r = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(422);
      expect(r.body.error.details.blockers).toEqual([expect.objectContaining({ code: 'PRE_RELEASE_SHADOW_ONLY' })]);
      expect(r.body.error.message).toMatch(/Shadow/);
      const failed = (await http().get(`/api/audit?target=${pid}`).expect(200)).body.items.filter((x: any) => x.action === 'POLICY_DEPLOY' && x.result === 'FAILED');
      expect(failed.length).toBeGreaterThan(0);
    });

    it('Gate 예외 요청 — 완료 예정일·잔여 리스크 필수, PASS Gate는 대상 아님, 요청 역할만', async () => {
      const body = { kind: 'GATE_PENDING', featureId: fid, featureVersion: '0.1.0', gates: ['G8', 'G9'], restriction: 'PILOT', reason: '현장 검증 차량 우선 적용', periodHours: 48, dueDate: '2026-10-20', residualRisk: '야간 주행 시험 미완 — 지정 차량만' };
      await http().post('/api/exceptions').set(AUTHOR).send(body).expect(403);
      expect((await http().post('/api/exceptions').set(RELEASE).send({ ...body, dueDate: null }).expect(422)).body.error.details.problems.map((p: any) => p.code)).toContain('DUE_DATE_REQUIRED');
      expect((await http().post('/api/exceptions').set(RELEASE).send({ ...body, gates: ['G7'] }).expect(422)).body.error.message).toMatch(/이미 PASS/);
      await http().post('/api/exceptions').set(RELEASE).send({ ...body, periodHours: 24 * 30 }).expect(400); // 무기한·장기 예외 없음
      const r = await http().post('/api/exceptions').set(RELEASE).send(body).expect(201);
      expect(r.body).toMatchObject({ status: 'REQUESTED', requestedBy: 'usr-coordinator', kind: 'GATE_PENDING', gates: ['G8', 'G9'], restriction: 'PILOT', dueDate: '2026-10-20', residualRisk: expect.stringMatching(/야간/) });
      gateExc = r.body.exceptionId;
      const ev = (await http().get('/api/events?type=exception.requested').expect(200)).body.items.at(-1);
      expect(ev.payload).toMatchObject({ exceptionId: gateExc, approvals: 0 });
    });

    it('2인 승인 — 요청자 본인·같은 승인자 거부, 승인에는 만료 일시 필수, 두 번째 승인에서 적용·만료 일시 = 가장 이른 것', async () => {
      const self = actor('usr-coordinator', 'SAFETY_OFFICER');
      expect((await approve(gateExc, self, '2026-10-13T01:00:00.000Z').expect(403)).body.error.code).toBe('SEPARATION_OF_DUTY');
      await http().post(`/api/exceptions/${gateExc}/decision`).set(FSM).send({ decision: 'APPROVE', reason: '확인' }).expect(400);
      expect((await approve(gateExc, FSM, '2026-10-13T01:00:00.000Z').expect(200)).body.status).toBe('APPROVING');
      expect((await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body.allowed).toBe(false); // 한 사람 승인으로는 열지 않는다
      expect((await approve(gateExc, FSM, '2026-10-13T01:00:00.000Z').expect(403)).body.error.message).toMatch(/이미 승인/);
      const r = await approve(gateExc, OPSLEAD, '2026-10-12T21:00:00.000Z').expect(200);
      expect(r.body).toMatchObject({ status: 'ACTIVE', appliedAt: T0, expiresAt: '2026-10-12T21:00:00.000Z', active: true });
      expect(r.body.approvals.map((a: any) => a.by)).toEqual(['usr-quality', 'usr-opslead']);
      const act = (await http().get('/api/exceptions?active=true').expect(200)).body;
      expect(act.items.map((x: any) => x.exceptionId)).toEqual([gateExc]);
    });

    it('예외가 덮으면 제한 범위(Pilot 1%)로만 배포 — Gate 판정은 PENDING 그대로, 범위를 넘겨 넓힐 수 없다', async () => {
      const db = app.get<Db>(DB);
      const gatesBefore = db.get<{ n: number }>('SELECT count(*) AS n FROM gate_record WHERE feature_id = ?', fid)!.n;
      expect((await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body).toMatchObject({ allowed: true, cap: 100, restriction: 'PILOT', exceptionIds: [gateExc] });
      const d = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: 'Pilot 배포' }).expect(200);
      expect(d.body).toMatchObject({ status: 'DEPLOYED', stageBasisPoints: 100, exceptionScope: { exceptionIds: [gateExc], restriction: 'PILOT', capBasisPoints: 100 } });
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM gate_record WHERE feature_id = ?', fid)!.n).toBe(gatesBefore);
      const gates = (await http().get(`/api/features/${fid}/versions/0.1.0/gates`).expect(200)).body.gates;
      expect(gates.find((g: any) => g.gate === 'G8').status).toBe('검토 중');
      expect((await http().get(`/api/exceptions/${gateExc}`).expect(200)).body.applications).toEqual([expect.objectContaining({ policyId: pid, prior: null, capBasisPoints: 100 })]);
      const wide = await http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints: 500, reason: '확대' }).expect(422);
      expect(wide.body.error.message).toMatch(/제한 범위/);
    });

    it('FR-ROL-002-008 — 중단 요청은 기준 충족 여부를 확인해 기록만 하고 언제나 허용(미충족 중단은 사유 기록)', async () => {
      const r = await http().post(`/api/policies/${pid}/rollout`).set(RELEASE).send({ basisPoints: 0, reason: '현장 문의 확인 전 일시 중단' }).expect(200);
      expect(r.body.stopCriteria).toMatchObject({ met: false, allowed: true, reasonRequired: true, reasons: [] });
      const a = (await http().get(`/api/audit?target=${pid}`).expect(200)).body.items.find((x: any) => x.action === 'ROLLOUT_STAGE' && x.result !== 'FAILED');
      expect(a.after.stopCriteria).toEqual({ met: false, reasons: [] });
      await http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints: 100, reason: 'Pilot 재개' }).expect(200);
    });

    it('만료 확인(예약 작업) → 이전 정책 상태로 원복(배포 없던 Flag는 멈춤) + 원복 메시지 알림·감사', async () => {
      clock().set('2026-10-12T21:00:01.000Z');
      const list = (await http().get('/api/exceptions?active=true').expect(200)).body;
      expect(list.items).toEqual([]); // 적용 중 없음 = 빈 목록
      const e = (await http().get(`/api/exceptions/${gateExc}`).expect(200)).body;
      expect(e.status).toBe('EXPIRED');
      expect(e.revert.message).toMatch(/멈췄습니다\(0%\)/);
      expect(e.history.map((h: any) => h.kind)).toEqual(['REQUESTED', 'APPROVED_1', 'ACTIVE', 'APPLIED', 'EXPIRED']);
      const p = (await http().get(`/api/policies/${pid}`).expect(200)).body.policy;
      expect(p.stageBasisPoints).toBe(0);
      const ev = (await http().get('/api/events?type=exception.reverted').expect(200)).body.items.at(-1);
      expect(ev.payload).toMatchObject({ exceptionId: gateExc, cause: 'EXPIRED', message: expect.stringMatching(/멈췄습니다/) });
      const audit = (await http().get(`/api/audit?target=${gateExc}`).expect(200)).body.items.map((x: any) => x.action);
      expect(audit).toEqual(expect.arrayContaining(['EXCEPTION_REQUEST', 'EXCEPTION_APPROVE', 'EXCEPTION_APPLY', 'EXCEPTION_EXPIRE']));
      // 만료된 예외로는 다시 열리지 않는다
      expect((await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body.allowed).toBe(false);
      clock().set(T0);
    });
  });

  describe('임시 우회 — 배포 시점 컴플라이언스 룰(FR-EXC-002-001·004)', () => {
    let rp: string;
    let bypass: string;
    it('승인 뒤 새로 적용된 룰이 배포를 막는다(판정은 그대로)', async () => {
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_signal', description: '전방 거리 단계 판정 — 시험 차량 제외', safeDefault: false, entitlementCatalogId: 'CAT-00019', rollout: { mode: 'COHORT', basisPoints: 10000 }, strategies: [{ name: '시험 차량 제외', constraints: [{ contextName: 'vehicleKey', operator: 'IN', values: ['ZZZ-NONE'], inverted: true }] }] }).expect(201);
      rp = c.body.policyId;
      await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: rp }).expect(201);
      expect((await http().post(`/api/policies/${rp}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      await http().post(`/api/policies/${rp}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
      await http()
        .post('/api/compliance-rules')
        .set(REG)
        .send({ ruleId: 'CR-PRV-901', name: '차량 식별자 대상 지정 금지', type: 'PRIVACY', scope: { markets: ['KR'], featureIds: ['FEAT-00022'] }, criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }], approverIds: ['usr-quality'], evidence: { url: 'https://www.law.go.kr/', docName: '개인정보 보호법', clause: '제23조' }, validFrom: '2026-01-01', validTo: null })
        .expect(201);
      await http().post('/api/compliance-rules/CR-PRV-901/approval-requests').set(REG).send({}).expect(201);
      await http().post('/api/compliance-rules/CR-PRV-901/decision').set(FSM).send({ decision: 'APPROVE', reason: '확인' }).expect(201);
      expect((await http().post(`/api/policies/${rp}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(422)).body.error.message).toMatch(/CR-PRV-901/);
    });

    it('우회 불가 4가지는 요청 단계에서 거부한다', async () => {
      for (const check of ['SIGNATURE_INTEGRITY', 'KILL_TWO_PERSON', 'SEPARATION_OF_DUTY', 'STOP_ALWAYS']) {
        const r = await http().post('/api/exceptions').set(OPERATOR).send({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: rp, checks: [check], restriction: 'LIMITED', reason: '긴급 우회 시도', periodHours: 4 }).expect(422);
        expect(r.body.error.details.problems[0].code).toBe('NOT_BYPASSABLE');
      }
    });

    it('2인 승인된 임시 우회 → 지정한 룰만 우회해 제한 배포(5%)로 배포, 적용 이전 배포 상태를 기록', async () => {
      const r = await http().post('/api/exceptions').set(OPERATOR).send({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: rp, checks: ['COMPLIANCE_RULE'], ruleIds: ['CR-PRV-901'], restriction: 'LIMITED', reason: '현장 결함 대응 — 시험 차량 제외 필요', periodHours: 6 }).expect(201);
      bypass = r.body.exceptionId;
      await approve(bypass, FSM, '2026-10-12T05:00:00.000Z').expect(200);
      expect((await approve(bypass, OPSLEAD, '2026-10-12T09:00:00.000Z').expect(200)).body).toMatchObject({ status: 'ACTIVE', expiresAt: '2026-10-12T05:00:00.000Z' });
      const d = await http().post(`/api/policies/${rp}/deploy`).set(RELEASE).send({ reason: '임시 우회 배포' }).expect(200);
      expect(d.body).toMatchObject({ status: 'DEPLOYED', stageBasisPoints: 500, exceptionScope: { exceptionIds: [bypass], restriction: 'LIMITED', capBasisPoints: 500 } });
      const e = (await http().get(`/api/exceptions/${bypass}`).expect(200)).body;
      expect(e.applications[0]).toMatchObject({ policyId: rp, prior: { policyId: 'POL-00001' } });
      expect((await http().get('/api/policies/POL-00001').expect(200)).body.policy.status).toBe('RETIRED');
    });

    it('회수 → 이전 배포(POL-00001)로 다시 게시해 원복, 원복 메시지', async () => {
      await http().post(`/api/exceptions/${bypass}/revoke`).set(AUTHOR).send({ reason: '룰 정정' }).expect(403);
      const r = await http().post(`/api/exceptions/${bypass}/revoke`).set(FSM).send({ reason: '현장 조치 완료 — 원래 배포로' }).expect(200);
      expect(r.body.status).toBe('REVOKED');
      expect(r.body.revert.message).toMatch(/이전 배포 POL-00001/);
      expect((await http().get(`/api/policies/${rp}`).expect(200)).body.policy.status).toBe('RETIRED');
      expect((await http().get('/api/policies/POL-00001').expect(200)).body.policy.status).toBe('DEPLOYED');
      const dep = (await http().get('/api/events?type=policy.deployed').expect(200)).body.items.at(-1).payload;
      expect(dep).toMatchObject({ policyId: 'POL-00001', replaced: rp });
      await http().post(`/api/exceptions/${bypass}/revoke`).set(FSM).send({ reason: '다시' }).expect(409);
    });

    it('승인된 정책에만 우회를 둔다 · 반려는 반려 사유를 남기고 닫는다(이후 승인 불가)', async () => {
      expect((await http().post('/api/exceptions').set(OPERATOR).send({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: rp, checks: ['FLAG_CODE'], restriction: 'PILOT', reason: '코드 연결 확인 전 배포 요청', periodHours: 2 }).expect(422)).body.error.message).toMatch(/APPROVED/);
      const r = await http().post('/api/exceptions').set(RELEASE).send({ kind: 'GATE_PENDING', featureId: fid, featureVersion: '0.1.0', gates: ['G9'], restriction: 'LIMITED', reason: '출시 Gate 대기 중 제한 배포', periodHours: 12, dueDate: '2026-10-25', residualRisk: '운영 Gate 미판정' }).expect(201);
      const j = await http().post(`/api/exceptions/${r.body.exceptionId}/decision`).set(FSM).send({ decision: 'REJECT', reason: '잔여 리스크 근거 부족' }).expect(200);
      expect(j.body).toMatchObject({ status: 'REJECTED', rejection: { by: 'usr-quality', reason: '잔여 리스크 근거 부족' }, expiresAt: null });
      expect((await approve(r.body.exceptionId, OPSLEAD, '2026-10-12T09:00:00.000Z').expect(409)).body.error.message).toMatch(/반려/);
    });
  });
});

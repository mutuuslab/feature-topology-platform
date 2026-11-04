// 긴급 차단·복원 v2 (D03-03·D03-04, 보고서 v1.1 7~9장) — 수용 기준: 요청자 승인 0건, 복원 승인자 겹침 100% 거부,
// DC4 원격 요청 수락 0건·거부 기록 100%, 봉투 cmd_auth가 차량 키 AES-CMAC으로 검증된다, 대량 차단은 FSM+CSM.
// FFG-PLT-005 · FFG-DEAC-008 · FFG-DEAC-011 · FFG-SEC-003 · FFG-VEH-002 · FFG-VEH-013 · TC-FF-16 · TC-FF-45 · TC-FF-48 · TC-FF-50
import { afterEach, describe, expect, it } from 'vitest';
import { authBlock, jcs, KillCommandV2, wireErrors } from '@ff/contracts';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { targetHashOf } from '../../src/domains/d03-safety/kill-switch/kill.service';
import { actor, bootApp, KILL_APPROVERS, KILL_REQUESTER, killV2, RESTORE_APPROVERS, restoreBody } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
async function boot() {
  const b = await bootApp({ at: '2026-10-13T00:30:00Z' });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB), hsm: b.get(HsmService), clock: b.get(Clock) };
}
const BODY = {
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  vins: ['ego-01', 'lead-01'],
  reasonCategory: 'SAFETY',
  reasonCode: 'DIST_EST_BIAS',
  reason: '전방 거리 오추정',
  containmentJustification: '원인 분석 전 봉쇄',
  confirm: 'FEAT-00022',
};
const lastAudit = (db: Db, action: string) => db.get<{ result: string; reason: string }>('SELECT result, reason FROM audit WHERE action = ? ORDER BY id DESC LIMIT 1', action);

describe('승인 (FFG-PLT-005 · FFG-SEC-008 · SOD-08) — 원격 종료 오남용 방지: 요청자·권한 없는 사람은 승인 칸을 못 채운다', () => {
  it('요청자는 승인할 수 없다 — 403, 감사 FAILED', async () => {
    const { http, db } = await boot();
    const safetyRequester = actor('usr-safety', 'SAFETY_OFFICER'); // 승인 역할이 있어도 요청자면 거부
    const k = (await http().post('/api/kill-requests').set(safetyRequester).send(BODY).expect(201)).body;
    const r = await http().post(`/api/kill-requests/${k.killId}/approvals`).set(safetyRequester).send({}).expect(403);
    expect(r.body.error.details.code).toBe('SELF_APPROVAL');
    expect(lastAudit(db, 'KILL_APPROVE')).toMatchObject({ result: 'FAILED', reason: expect.stringContaining('SELF_APPROVAL') });
  });
  it('F3 안전 차단은 FSM + CSM(2026-11-04 결정) — 운영 리더·두 번째 FSM은 칸을 못 채운다, 같은 사람 두 번도 거부', async () => {
    const { http } = await boot();
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(201)).body;
    const lead = await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-opslead', 'OPS_LEAD')).send({}).expect(409);
    expect(lead.body.error.details.code).toBe('FSM_REQUIRED');
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201); // FSM
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(409); // 같은 사람
    const fsm2 = await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-safety2', 'SAFETY_OFFICER')).send({}).expect(409);
    expect(fsm2.body.error.details.code).toBe('CSM_REQUIRED');
    const done = (await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(201)).body;
    expect(done).toMatchObject({ status: 'ACTIVE', approvals: [{ role: 'FSM' }, { role: 'CSM' }] });
  });
  it('P3-2 FSM·CSM을 함께 가진 사람은 고른 서명 역할로 기록 — 사이버보안 역할로 승인하면 CSM, FSM 뒤 FSM으로 다시 서명하려 하면 거부', async () => {
    const { http } = await boot();
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(201)).body;
    // 승인 대기 상세 — 다음 칸 후보는 필수 역할(FSM·CSM)을 가진 사람만, 요청자 제외
    const d = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
    expect(d.approverCandidates.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['usr-quality', 'usr-integrator', 'usr-safety2']));
    expect(d.approverCandidates.map((c: { id: string }) => c.id)).not.toContain('usr-opslead');
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-quality', 'SAFETY_OFFICER')).send({}).expect(201);
    const twice = await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-integrator', 'SAFETY_OFFICER')).send({}).expect(409);
    expect(twice.body.error.details.code).toBe('CSM_REQUIRED');
    const done = (await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-integrator', 'SECURITY_OFFICER')).send({}).expect(201)).body;
    expect(done.approvals.map((a: { approverId: string; role: string; platformRole: string }) => [a.approverId, a.role, a.platformRole])).toEqual([
      ['usr-quality', 'FSM', 'SAFETY_OFFICER'],
      ['usr-integrator', 'CSM', 'SECURITY_OFFICER'],
    ]);
    // 복원 전망 — 차단 승인자 둘을 빼고도 복원할 FSM(두 번째 Safety Manager)과 운영 리더가 남는다(P4-1)
    const active = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body;
    expect(active.restoreOutlook).toMatchObject({ complete: true, missing: [] });
    const ids = active.restoreOutlook.candidates.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['usr-safety2', 'usr-opslead']));
    expect(ids).not.toContain('usr-quality');
    expect(ids).not.toContain('usr-integrator');
  });
  it('승인 역할이 없으면 403, 거절하면 REJECTED — 이후 승인은 409', async () => {
    const { http } = await boot();
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(201)).body;
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-author', 'FEATURE_AUTHOR')).send({}).expect(403);
    const rj = (await http().post(`/api/kill-requests/${k.killId}/reject`).set(KILL_APPROVERS[0]).send({ reason: '증거 부족' }).expect(201)).body;
    expect(rj).toMatchObject({ status: 'REJECTED', rejectedBy: 'usr-safety', rejectReason: '증거 부족' });
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(409);
  });
  it('승인 대기 2시간이 지나면 EXPIRED — 승인할 수 없다', async () => {
    const { http, clock } = await boot();
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(201)).body;
    clock.set(new Date(Date.parse(k.expiresAt) + 1));
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.status).toBe('EXPIRED');
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(409);
  });
});

describe('DC4·의무 기능 (FFG-PLT-004 · FFG-DEAC-011)', () => {
  it('DC4로 분류된 기능은 요청 단계에서 거부하고 기록한다 — 수락 0건', async () => {
    const { http, db } = await boot();
    await http().put('/api/features/FEAT-00023/versions/1.0.0/safety').set(actor('usr-author', 'FEATURE_AUTHOR')).send({ fClass: 'F4', deactClass: 'DC4', gsrMandatory: true }).expect(200);
    const r = await http()
      .post('/api/kill-requests')
      .set(KILL_REQUESTER)
      .send({ ...BODY, featureId: 'FEAT-00023', confirm: 'FEAT-00023' })
      .expect(422);
    expect(r.body.error.details.rule).toBe('FFG-PLT-004');
    expect(lastAudit(db, 'KILL_REQUEST')).toMatchObject({ result: 'FAILED', reason: expect.stringContaining('FFG-PLT-004') });
    expect((await http().get('/api/kill-requests').expect(200)).body.items.filter((k: { featureId: string }) => k.featureId === 'FEAT-00023')).toEqual([]);
  });
});

describe('발행 — 서명·차량별 봉투 (FFG-VEH-002 · FFG-VEH-013 · TC-FF-50)', () => {
  it('kill 용도 키 JWS, 봉투는 차량 1대·vehicle_seq·cmd_auth(차량 키 CMAC) — 바꾸면 검증 실패', async () => {
    const { http, hsm } = await boot();
    const k = await killV2(http, BODY);
    const e = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body;
    expect(e.commands).toHaveLength(1);
    const cmd = e.commands[0];
    expect(wireErrors(KillCommandV2, cmd)).toEqual([]);
    expect(cmd).toMatchObject({ request: 'deactivate', command_seq: 11, feature: { f_class: 'F3', deact_class: 'DC2' }, approvals: [{ role: 'FSM' }, { role: 'CSM' }] });
    const { signature, ...body } = cmd;
    expect(hsm.verifyDetached('kill', jcs(body), signature).valid).toBe(true);
    expect(hsm.verifyDetached('policy', jcs(body), signature)).toMatchObject({ valid: false }); // 다른 용도로는 무효
    expect(e.envelopes.map((v: { scope: { vehicle_ids: string[] } }) => v.scope.vehicle_ids[0]).sort()).toEqual(['ego-01', 'lead-01']);
    for (const env of e.envelopes) {
      expect(wireErrors(KillCommandV2, env)).toEqual([]);
      const vin = env.scope.vehicle_ids[0];
      const block = (over: Partial<Parameters<typeof authBlock>[0]> = {}) =>
        Buffer.from(
          authBlock({
            featureId: env.feature.id,
            version: env.feature.version,
            request: env.request,
            reason: env.reason.category,
            deactClass: env.feature.deact_class,
            keyEpoch: env.vehicle_auth.key_epoch,
            vehicleSeq: env.vehicle_auth.vehicle_seq,
            notBefore: env.validity.not_before,
            expiresAt: env.validity.expires_at,
            targetHash: targetHashOf(vin, env.target.ecu_id, env.target.sw_version),
            approverRefs: env.vehicle_auth.approver_refs,
            ...over,
          }),
        );
      expect(env.vehicle_auth.vehicle_seq).toBe(1);
      expect(hsm.verifyCmac(vin, env.vehicle_auth.key_epoch, block(), env.vehicle_auth.cmd_auth)).toBe(true);
      expect(hsm.verifyCmac(vin, env.vehicle_auth.key_epoch, block({ request: 'restore' }), env.vehicle_auth.cmd_auth)).toBe(false); // 요청 유형 바꿔치기
      expect(hsm.verifyCmac(vin === 'ego-01' ? 'lead-01' : 'ego-01', env.vehicle_auth.key_epoch, block(), env.vehicle_auth.cmd_auth)).toBe(false); // 다른 차량 키
    }
  });
});

describe('복원 (FFG-DEAC-008 · TC-FF-16)', () => {
  it('FAIL·CONDITIONAL 판정 근거를 본문으로 보내도 복원 요청은 거부한다', async () => {
    const { http, db } = await boot();
    const k = await killV2(http, BODY);
    const rb = await restoreBody(http, k.killId);
    const source = (await http().get('/api/evidence?featureId=FEAT-00022').expect(200)).body.items[0];
    for (const [n, inputResult] of ['FAIL', 'CONDITIONAL'].entries()) {
      const evidenceRef = `EV-RESTORE-${inputResult}`;
      const recordId = `SIM-G5-99999${n}`;
      // 실패·조건부 판정도 원장에 보존된다. 화면 선택지 밖의 근거를 API로 직접 보낸다.
      db.run('INSERT INTO evidence (evidence_ref, gate_record_id, doc) VALUES (?, ?, ?)', evidenceRef, recordId, JSON.stringify({ ...source, evidenceRef, gateRecordId: recordId, inputResult }));
      const r = await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, evidenceRef }).expect(400);
      expect(r.body.error.details.field).toBe('evidenceRef');
      expect(lastAudit(db, 'RESTORE_REQUEST')).toMatchObject({ result: 'FAILED' });
    }
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.restoreRequest).toBeNull();
  });

  it('여러 Feature가 공유하는 근거 번호는 대상 Feature의 PASS 판정을 찾아 복원한다', async () => {
    const { http, db } = await boot();
    const k = await killV2(http, BODY);
    const rb = await restoreBody(http, k.killId);
    const source = (await http().get('/api/evidence?featureId=FEAT-00022').expect(200)).body.items[0];
    const evidenceRef = 'EV-SHARED-RESTORE-REPORT';
    // 같은 외부 시험 보고서가 여러 판정에서 쓰인다. 다른 Feature 행을 먼저 넣는다.
    for (const [n, featureId] of ['FEAT-00001', 'FEAT-00022'].entries()) {
      const recordId = `SIM-G5-99998${n}`;
      db.run('INSERT INTO evidence (evidence_ref, gate_record_id, doc) VALUES (?, ?, ?)', evidenceRef, recordId, JSON.stringify({ ...source, evidenceRef, gateRecordId: recordId, featureId, inputResult: 'PASS' }));
    }
    const restored = (await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, evidenceRef }).expect(201)).body;
    expect(restored.restoreRequest).toMatchObject({ evidenceRef, status: 'REQUESTED' });
  });

  it('P4-7 복원 요청은 재검증 Evidence·Cohort가 있어야 한다 — 없거나 다른 Feature 근거·남은 차량 밖이면 거부, Cohort부터 단계적으로 복원(A10)', async () => {
    const { http } = await boot();
    const k = await killV2(http, BODY);
    const rb = await restoreBody(http, k.killId, '원인 수정·재검증');
    const restore = (b: object) => http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send(b);
    await restore({ reason: '원인 수정' }).expect(400); // Evidence·Cohort 없음
    const other = (await http().get('/api/evidence?featureId=FEAT-00001').expect(200)).body.items[0].evidenceRef;
    expect((await restore({ ...rb, evidenceRef: other }).expect(400)).body.error.details.field).toBe('evidenceRef');
    await restore({ ...rb, cohort: ['KMH-NX4-0001'] }).expect(400); // 차단 차량이 아님
    // 1단계: Canary Cohort(ego-01)만
    const s1 = (await restore({ ...rb, cohort: ['ego-01'] }).expect(201)).body;
    expect(s1.restoreRequest).toMatchObject({ status: 'REQUESTED', evidenceRef: rb.evidenceRef, cohort: ['ego-01'] });
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    const one = (await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
    expect(one).toMatchObject({ status: 'ACTIVE', restoredVins: ['ego-01'], restoreRequest: { status: 'APPROVED', command: { envelopes: 1 } } });
    expect(one.restoreStages).toHaveLength(1);
    expect(one.restore).toMatchObject({ denominator: 1 });
    await restore({ ...rb, cohort: ['ego-01'] }).expect(400); // 이미 복원한 차량
    // 2단계: 남은 차량 — 다 복원되면 해제(RELEASED)
    await restore({ ...rb, cohort: ['lead-01'] }).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    const two = (await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
    expect(two).toMatchObject({ status: 'RELEASED', restoredVins: ['ego-01', 'lead-01'] });
    expect(two.restoreStages.map((s: { cohort: string[] }) => s.cohort)).toEqual([['ego-01'], ['lead-01']]);
  });
  it('차단 승인자는 복원을 승인할 수 없다 — 다른 2인만, 복원 명령은 restore 용도 키·순번 +1', async () => {
    const { http, hsm } = await boot();
    const k = await killV2(http, BODY);
    const rb = await restoreBody(http, k.killId, '원인 수정');
    await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send(rb).expect(201);
    for (const a of KILL_APPROVERS) {
      const r = await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(a).send({}).expect(409);
      expect(r.body.error.details.code).toBe('KILL_APPROVER');
    }
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    const done = (await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
    expect(done).toMatchObject({ status: 'RELEASED', restoreRequest: { status: 'APPROVED', command: { commandSeq: 12, envelopes: 2 } } });
    const e = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body;
    const restore = e.commands.find((c: { request: string }) => c.request === 'restore');
    const { signature, ...body } = restore;
    expect(hsm.verifyDetached('restore', jcs(body), signature).valid).toBe(true);
    // 같은 차량·Feature의 다음 봉투 순번
    expect(e.envelopes.filter((v: { request: string }) => v.request === 'restore').map((v: { vehicle_auth: { vehicle_seq: number } }) => v.vehicle_auth.vehicle_seq)).toEqual([2, 2]);
  });
});

describe('대량 차단 (FFG-SEC-003 · SOD-10 · TC-FF-48)', () => {
  it('24시간 누적 상한을 넘는 차단은 FSM+OPS_LEAD면 게이트가 거부(REJECTED), FSM+CSM이면 발행', async () => {
    const { http, db } = await boot();
    // FEAT-00023(초안)의 누적 상한을 1대로 — 2대 차단은 상한 초과
    await http()
      .put('/api/features/FEAT-00023/versions/1.0.0/safety')
      .set(actor('usr-author', 'FEATURE_AUTHOR'))
      .send({ maxActivationScope: { vehicles: 50000, perWindow: 1 } })
      .expect(200);
    const body = { ...BODY, featureId: 'FEAT-00023', confirm: 'FEAT-00023', vins: undefined, reasonCategory: 'OPERATIONAL', containmentJustification: undefined };
    const pv = (await http().get('/api/kill-requests/preview?featureId=FEAT-00023&featureVersion=1.0.0').expect(200)).body;
    const vins = pv.vehicles.slice(0, 2).map((v: { vin: string }) => v.vin);
    const a = (
      await http()
        .post('/api/kill-requests')
        .set(KILL_REQUESTER)
        .send({ ...body, vins })
        .expect(201)
    ).body;
    await http().post(`/api/kill-requests/${a.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
    // 운영 사유(필수 역할 없음) — 운영 리더도 두 번째 칸을 채우지만, 상한 초과는 게이트가 FSM+CSM을 요구한다
    const rejected = (await http().post(`/api/kill-requests/${a.killId}/approvals`).set(actor('usr-opslead', 'OPS_LEAD')).send({}).expect(201)).body;
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectedBy: 'policy-gate', gate: { result: 'FAIL', failed: ['FFG-SEC-003'] } });
    expect(lastAudit(db, 'KILL_ISSUE')).toMatchObject({ result: 'FAILED', reason: expect.stringContaining('FFG-SEC-003') });
    const b = (
      await http()
        .post('/api/kill-requests')
        .set(KILL_REQUESTER)
        .send({ ...body, vins })
        .expect(201)
    ).body;
    await http().post(`/api/kill-requests/${b.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
    const issued = (await http().post(`/api/kill-requests/${b.killId}/approvals`).set(actor('usr-csm', 'SECURITY_OFFICER')).send({}).expect(201)).body;
    expect(issued).toMatchObject({ status: 'ACTIVE', approvals: [{ role: 'FSM' }, { role: 'CSM' }] });
  });
});

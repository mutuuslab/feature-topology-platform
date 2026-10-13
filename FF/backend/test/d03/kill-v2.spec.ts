// 긴급 차단·복원 v2 (D03-03·D03-04, 보고서 v1.1 7~9장) — 수용 기준: 요청자 승인 0건, 복원 승인자 겹침 100% 거부,
// DC4 원격 요청 수락 0건·거부 기록 100%, 봉투 cmd_auth가 차량 키 AES-CMAC으로 검증된다, 대량 차단은 FSM+CSM.
// FFG-PLT-005 · FFG-DEAC-008 · FFG-DEAC-011 · FFG-SEC-003 · FFG-VEH-002 · FFG-VEH-013 · TC-FF-16 · TC-FF-45 · TC-FF-48 · TC-FF-50
import { afterEach, describe, expect, it } from 'vitest';
import { authBlock, jcs, KillCommandV2, wireErrors } from '@ff/contracts';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { targetHashOf } from '../../src/domains/d03-safety/kill-switch/kill.service';
import { actor, bootApp, KILL_APPROVERS, KILL_REQUESTER, killV2, RESTORE_APPROVERS } from '../helpers';

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
  it('F3 안전 차단은 FSM 필수 — FSM 없이 두 칸을 채울 수 없다, 같은 사람 두 번도 거부', async () => {
    const { http } = await boot();
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(201)).body;
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(201); // OPS_LEAD
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(409); // 같은 사람
    const r = await http().post(`/api/kill-requests/${k.killId}/approvals`).set(actor('usr-csm', 'SECURITY_OFFICER')).send({}).expect(409);
    expect(r.body.error.details.code).toBe('FSM_REQUIRED');
    const done = (await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201)).body;
    expect(done).toMatchObject({ status: 'ACTIVE', approvals: [{ role: 'OPS_LEAD' }, { role: 'FSM' }] });
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
    expect(cmd).toMatchObject({ request: 'deactivate', command_seq: 11, feature: { f_class: 'F3', deact_class: 'DC2' }, approvals: [{ role: 'FSM' }, { role: 'OPS_LEAD' }] });
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
  it('차단 승인자는 복원을 승인할 수 없다 — 다른 2인만, 복원 명령은 restore 용도 키·순번 +1', async () => {
    const { http, hsm } = await boot();
    const k = await killV2(http, BODY);
    await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ reason: '원인 수정' }).expect(201);
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
    const rejected = (await http().post(`/api/kill-requests/${a.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(201)).body;
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

// 차량 연결 v2 (D02-03·D04-03, 보고서 v1.1 9·13장) — 수용 기준: 위조 보고 수락 0건(TC-FF-24), 기한 초과 미적용 차량은 모두 Incident,
// 재부팅·SW 업데이트 뒤 해제 없이 ACTIVE 보고는 Incident(TC-FF-58), 차량 Guard는 변조·재전송 봉투를 거부.
// FFG-TEL-003 · FFG-SEC-004 · FFG-DEAC-013 · FFG-DEAC-007 · FFG-ADS-004 · FFG-VEH-002 · FFG-VEH-013
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterEach, describe, expect, it } from 'vitest';
import { authBlock, jcs, statusAuthCanonical, type KillCommandV2 } from '@ff/contracts';
import { targetHashOf, vehiclePseudonym } from '../../src/kernel/crypto';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { actor, bootApp, killV2 } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
async function boot() {
  const b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  close = () => b.app.close();
  const clock = b.get(Clock);
  const scheduler = b.get(Scheduler);
  const advance = (ms: number) => {
    const until = clock.now().getTime() + ms;
    scheduler.flush(ms);
    clock.set(new Date(until));
  };
  return { ...b, advance, hsm: b.get(HsmService), runtime: b.get(VehicleRuntimeService) };
}
const VEHICLE = (vin: string) => ({ 'X-Vehicle-Id': vin });
const KILL = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: 'v2 차량 연결 시험', confirm: 'FEAT-00022' };
const anomalies = async (http: () => any, kind: string) => (await http().get(`/api/anomalies?kind=${kind}&featureId=FEAT-00022`).expect(200)).body.items;

/** 차단 후 DISABLED까지 진행 — 마지막으로 받아들인 ego-01 보고를 돌려준다 */
async function killed(http: () => any, advance: (ms: number) => void) {
  const k = await killV2(http, KILL);
  advance(8_000);
  const st = (await http().get('/api/vehicles/ego-01/status').expect(200)).body;
  expect(st.features[0]).toMatchObject({ featureId: 'FEAT-00022', state: 'DISABLED' });
  return { k, last: st.features[0].report };
}

describe('수신 검사 (FFG-TEL-003 · TC-FF-24)', () => {
  it('위조 보고(state_auth 불일치)는 받아들이지 않고 보안 Incident — 확인 집계는 그대로', async () => {
    const { http, advance } = await boot();
    const { k, last } = await killed(http, advance);
    const before = (await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.delivery.confirmed;
    const forged = { ...last, state: 'ACTIVE', hmi: 'NONE', edr_aligned_state: 'AVAILABLE', feature_weight_permille: 1000, report_seq: last.report_seq + 1 };
    const r = (await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send(forged).expect(200)).body;
    expect(r).toMatchObject({ accepted: false, violation: { step: 'AUTH', code: 'AUTH_FAILED' } });
    expect((await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].state).toBe('DISABLED');
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.delivery.confirmed).toBe(before);
    const a = (await anomalies(http, 'SECURITY'))[0];
    expect(a).toMatchObject({ severity: 'CRITICAL', advice: 'SECURITY_REVIEW', vins: ['ego-01'] });
    expect(a.reasons).toContain('상태 보고 검사 위반: AUTH_FAILED');
  });

  it('재전송(같은 report_seq)은 REPLAY, 다른 차량 VIN으로 보고하면 403', async () => {
    const { http, advance } = await boot();
    const { last } = await killed(http, advance);
    expect((await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send(last).expect(200)).body.violation).toMatchObject({ step: 'SEQUENCE', code: 'REPLAY' });
    await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('lead-01')).send(last).expect(403);
  });

  it('TC-FF-58 재부팅 뒤 해제 명령 없이 ACTIVE를 보고하면(정상 서명이어도) Incident — 안전 Kill이 풀림', async () => {
    const { http, advance, hsm } = await boot();
    const { last } = await killed(http, advance);
    const { state_auth: _a, ...base } = last;
    const reboot = {
      ...base,
      state: 'ACTIVE',
      reason: { category: 'SAFETY', source: 'STARTUP' },
      request_result: 'NONE',
      hmi: 'NONE',
      edr_aligned_state: 'AVAILABLE',
      feature_weight_permille: 1000,
      report_seq: ((last.report_seq >>> 16) + 1) * 65536 + 1,
    };
    const signed = { ...reboot, state_auth: hsm.cmac('ego-01', reboot.key_epoch, Buffer.from(statusAuthCanonical(reboot))) };
    expect((await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send(signed).expect(200)).body.violation).toMatchObject({ step: 'HISTORY', code: 'ACTIVE_WITHOUT_RESTORE' });
    expect((await anomalies(http, 'SECURITY'))[0].reasons).toContain('상태 보고 검사 위반: ACTIVE_WITHOUT_RESTORE');
  });

  it('회귀: 비활성화를 거부한(받지 못한) 차량의 ACTIVE 보고는 해제 위반이 아니고, 받아들였던 차량은 순번을 잃어도 위반', async () => {
    // GLEO 실연동에서 SIGNATURE_INVALID로 거부한 차량의 ACTIVE 보고가 ACTIVE_WITHOUT_RESTORE("Kill이 풀림")로 잘못 분류됐다
    const { http, advance, hsm } = await boot();
    const sign = (vin: string, r: Record<string, any>) => ({ ...r, state_auth: hsm.cmac(vin, r.key_epoch, Buffer.from(statusAuthCanonical(r))) });
    const { k, last } = await killV2(http, { ...KILL, vins: ['ego-01', 'KMH-NX4-0003'] }).then(async (k) => (advance(8_000), { k, last: (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].report }));
    const { state_auth: _a, ...base } = last;
    const active = { ...base, state: 'ACTIVE', hmi: 'NONE', edr_aligned_state: 'AVAILABLE', feature_weight_permille: 1000, vehicle_seq: 0 };
    // 단절 차량(KMH-NX4-0003)이 봉투를 거부 — 받아들인 적 없음
    const rejected = sign('KMH-NX4-0003', { ...active, vehicle_pseudonym: vehiclePseudonym('KMH-NX4-0003'), request_result: 'REJECTED', reject_code: 'SIGNATURE_INVALID', report_seq: 65537 });
    expect((await http().post('/vehicle/v1/KMH-NX4-0003/status').set(VEHICLE('KMH-NX4-0003')).send(rejected).expect(200)).body).toMatchObject({ accepted: true, violation: null });
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.delivery.confirmed).toBe(1);
    // ego-01은 DISABLED까지 받아들였다 — 재부팅으로 vehicle_seq까지 잃은 ACTIVE도 위반
    const lost = sign('ego-01', { ...active, reason: { category: 'SAFETY', source: 'STARTUP' }, request_result: 'NONE', report_seq: ((last.report_seq >>> 16) + 1) * 65536 + 1 });
    expect((await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send(lost).expect(200)).body.violation).toMatchObject({ step: 'HISTORY', code: 'ACTIVE_WITHOUT_RESTORE' });
  });
});

describe('차량 Guard (FFG-VEH-002 · FFG-VEH-013)', () => {
  it('재전송 봉투는 REPLAY, cmd_auth를 바꾸면 서명 불일치, 플랫폼 키로 다시 서명해도 차량 키가 없으면 AUTH_FAILED — 상태는 그대로', async () => {
    const { http, advance, runtime, hsm } = await boot();
    const { k } = await killed(http, advance);
    const env: KillCommandV2 = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes.find((e: KillCommandV2) => e.scope.vehicle_ids[0] === 'ego-01');
    runtime.guard('ego-01', k.publicationId, 'KILL', env, ['FEAT-00022']); // 재전송 — vehicle_seq가 마지막과 같다
    const tampered = { ...env, vehicle_auth: { ...env.vehicle_auth!, cmd_auth: 'AAAAAAAAAAAAAAAAAAAAAA' } };
    runtime.guard('ego-01', k.publicationId, 'KILL', tampered, ['FEAT-00022']);
    // 서명 키를 가진 내부자라도 차량 키 없이는 cmd_auth를 만들 수 없다 — 순번을 올리고 다시 서명
    const { signature: _s, ...b } = { ...tampered, vehicle_auth: { ...tampered.vehicle_auth!, vehicle_seq: tampered.vehicle_auth!.vehicle_seq + 1 } };
    const resig = hsm.signDetached('kill', jcs(b));
    runtime.guard('ego-01', k.publicationId, 'KILL', { ...b, signature: { alg: 'EdDSA', kid: resig.kid, value: resig.value } }, ['FEAT-00022']);
    const reports = (await http().get('/api/vehicles/ego-01/status').expect(200)).body;
    expect(reports.features[0].report).toMatchObject({ request_result: 'REJECTED', reject_code: 'AUTH_FAILED', state: 'DISABLED' });
    expect(reports.recent.slice(0, 3).every((x: any) => x.accepted && x.state === 'DISABLED')).toBe(true);
    const log = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.log;
    expect(log.slice(-3).map((l: any) => l.detail)).toEqual(['REPLAY', 'SIGNATURE_INVALID', 'AUTH_FAILED']); // 서명은 봉투 전체(vehicle_auth 포함)를 덮는다
  });
});

describe('요청 유형별 Guard 동작 (9.6 SYNC · FFG-LCY-010 활성화 · FFG-SEC-002 용도 키)', () => {
  /** 플랫폼 HSM으로 요청 유형의 봉투를 만든다(같은 차량 키·순번 +1) — 회귀: 예전 Guard는 restore가 아니면 모두 비활성화로 처리했다 */
  function craft(hsm: HsmService, env: KillCommandV2, request: 'sync' | 'activate', purpose: 'sync' | 'activate' | 'kill') {
    const vin = env.scope.vehicle_ids[0];
    const seq = env.vehicle_auth!.vehicle_seq + 1;
    const block = Buffer.from(
      authBlock({
        featureId: env.feature.id,
        version: env.feature.version,
        request,
        reason: env.reason.category,
        deactClass: env.feature.deact_class,
        keyEpoch: env.vehicle_auth!.key_epoch,
        vehicleSeq: seq,
        notBefore: env.validity.not_before,
        expiresAt: env.validity.expires_at,
        targetHash: targetHashOf(vin, env.target.ecu_id, env.target.sw_version),
        approverRefs: [env.vehicle_auth!.approver_refs[0], env.vehicle_auth!.approver_refs[1]],
      }),
    );
    const { signature: _s, ...b } = { ...env, request, vehicle_auth: { ...env.vehicle_auth!, vehicle_seq: seq, cmd_auth: hsm.cmac(vin, env.vehicle_auth!.key_epoch, block) } };
    const sig = hsm.signDetached(purpose, jcs(b));
    return { ...b, signature: { alg: 'EdDSA' as const, kid: sig.kid, value: sig.value } } as KillCommandV2;
  }
  it('SYNC는 상태를 바꾸지 않고, 다른 용도 키로 서명한 활성화는 SIGNATURE_INVALID, DISABLED 활성화는 STATE_NOT_ALLOWED(FFG-CLS-007·TC-FF-15), INACTIVE 활성화는 ACT_PENDING → ACTIVE', async () => {
    const { http, advance, runtime, hsm } = await boot();
    const { k } = await killed(http, advance);
    const env: KillCommandV2 = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes.find((e: KillCommandV2) => e.scope.vehicle_ids[0] === 'ego-01');
    const state = async () => (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.featureState['FEAT-00022'];
    runtime.guard('ego-01', k.publicationId, 'KILL', craft(hsm, env, 'sync', 'sync'), ['FEAT-00022']);
    expect(await state()).toBe('DISABLED');
    const wrongKey = craft(hsm, { ...env, vehicle_auth: { ...env.vehicle_auth!, vehicle_seq: env.vehicle_auth!.vehicle_seq + 1 } }, 'activate', 'kill');
    runtime.guard('ego-01', k.publicationId, 'KILL', wrongKey, ['FEAT-00022']);
    expect(await state()).toBe('DISABLED');
    // 회귀: 안전 Kill로 DISABLED인 기능을 활성화 명령(체험권·구독 경로)이 풀었다 — 복원 절차만 풀 수 있다
    const activate = (bump: number) => craft(hsm, { ...env, vehicle_auth: { ...env.vehicle_auth!, vehicle_seq: env.vehicle_auth!.vehicle_seq + bump } }, 'activate', 'activate');
    runtime.guard('ego-01', k.publicationId, 'KILL', activate(1), ['FEAT-00022']);
    expect(await state()).toBe('DISABLED');
    // 상업 사유로 꺼진(INACTIVE) 기능은 활성화로 켠다 — 작동 중이 아닐 때 ACT_PENDING → ACTIVE
    const rt = runtime as any;
    const st = rt.runtime.get('ego-01');
    st.featureState['FEAT-00022'] = 'INACTIVE';
    rt.runtime.save(st);
    runtime.guard('ego-01', k.publicationId, 'KILL', activate(2), ['FEAT-00022']);
    expect(await state()).toBe('ACT_PENDING');
    advance(2_000);
    expect(await state()).toBe('ACTIVE');
    const log = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.log.map((l: any) => l.detail);
    expect(log.slice(-4)).toEqual(['sync DC2 수락', 'SIGNATURE_INVALID', 'STATE_NOT_ALLOWED', 'activate DC2 수락']);
  });
});

describe('기한 감시 (FFG-SEC-004 · FFG-DEAC-013)', () => {
  it('통신 단절 차량은 DC2 예상 시간 + 여유가 지나도 DISABLED가 아니면 pending_overdue Incident', async () => {
    const { http, advance } = await boot();
    const k = await killV2(http, { ...KILL, vins: ['ego-01', 'KMH-NX4-0003'] });
    advance(8_000);
    expect((await anomalies(http, 'DELIVERY')).flatMap((a: any) => a.signals.map((s: any) => s.code))).not.toContain('PENDING_OVERDUE');
    advance(31_000);
    const d = (await anomalies(http, 'DELIVERY'))[0];
    expect(d.signals.filter((s: any) => s.code === 'PENDING_OVERDUE').map((s: any) => [s.vin, s.ref])).toEqual([['KMH-NX4-0003', k.killId]]);
  });
});

/**
 * §12.5 / §13 / §14 / §18 — Closed Loop end-to-end 를 MockTwinProvider 로 검증한다.
 *
 * 시나리오: Canary 활성화 → 차량 수신·수렴 → 장애 주입(Effective Drift) →
 * Incident 생성 + Rollout 자동 Pause → Kill-Switch → 차량 OFF 응답 확인 →
 * 부분 복구 → Incident 종료(Evidence) → Rollback → Reset.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createTwinProvider } from '../state/twinStore';
import type { MockTwinProvider } from '../data/twin/simulator';
import { DEMO_FLEET_SIZE } from '../data/twin/fleet';
import * as T from '../data/twin/types';

const STEP = 5;
const CANARY_VINS = ['VIN-DEMO-005', 'VIN-DEMO-007', 'VIN-DEMO-010'];

let p: MockTwinProvider;

const twinOf = (vin: string) => p.getTwin(vin)!;
const verdictOf = (vin: string) => p.getSnapshot().verdicts.find((v) => v.twin.vin === vin)!;
const instanceOf = (vin: string) => twinOf(vin).featureInstances[T.FEATURE_ID]!;
/** 수신 지연(VIN hash 기반 최대 3 tick)을 모두 소진한다. */
const drain = (steps = 4) => {
  for (let i = 0; i < steps; i++) p.step(STEP);
};

beforeEach(() => {
  p = createTwinProvider();
});

describe('§18 Closed Loop — 초기 · Canary 활성화', () => {
  it('초기 Twin 은 결정적이며 Rollout 은 비활성 상태다', () => {
    const snap = p.getSnapshot();
    expect(snap.stats.total).toBe(DEMO_FLEET_SIZE);
    expect(snap.stats.reconciliationCounts).toEqual({
      CONVERGED: 22,
      PENDING: 0,
      GUARDED: 4,
      REJECTED: 1,
      CRITICAL_DRIFT: 2,
      UNKNOWN: 1,
    });
    expect(snap.rollout.active).toBe(false);
    expect(snap.rollout.scope).toBe('NONE');
    expect(snap.clock.rate).toBe(0);
    expect(snap.incidents).toEqual([]);
    expect(snap.events).toEqual([]);
  });

  it('Canary 는 즉시 활성화 가능한 VIN 만 대상으로 삼고 Binary OTA 대상을 분리한다', () => {
    const rollout = p.activatePolicy('CANARY');
    expect(rollout.active).toBe(true);
    expect(rollout.scope).toBe('CANARY');
    expect(rollout.paused).toBe(false);
    expect(rollout.activatedVins).toEqual(CANARY_VINS);
    // Binary OTA 는 Policy-only 와 절대 겹치지 않는다 (§13 5단계).
    expect(rollout.binaryOtaVins).toContain('VIN-DEMO-013');
    expect(rollout.binaryOtaVins.filter((v) => rollout.activatedVins.includes(v))).toEqual([]);
    expect(rollout.activatedAt).toBeTruthy();
  });

  it('활성화 직후에는 Desired ON / Reported 미수신 → PENDING 이다', () => {
    p.activatePolicy('CANARY');
    CANARY_VINS.forEach((vin) => {
      const inst = instanceOf(vin);
      expect(inst.desired.state).toBe('ON');
      expect(inst.reported.state).toBe('NOT_RECEIVED');
      const v = verdictOf(vin);
      expect(v.reconciliation.result).toBe('PENDING');
      expect(v.reconciliation.reasonCode).toBe('POLICY_NOT_RECEIVED');
    });
    expect(p.getSnapshot().stats.reconciliationCounts.PENDING).toBe(3);
  });

  it('차량이 Policy 를 수신하면 Local Guard 통과 후 양방향 수렴한다', () => {
    p.activatePolicy('CANARY');
    drain();
    CANARY_VINS.forEach((vin) => {
      const inst = instanceOf(vin);
      expect([inst.reported.state, inst.effective.state]).toEqual(['ON', 'ON']);
      const v = verdictOf(vin);
      expect(v.reconciliation.result).toBe('CONVERGED');
      expect(v.reconciliation.reasonCode).toBe('POLICY_APPLIED_OK');
      expect(v.health).toBe('HEALTHY');
    });
    expect(p.getSnapshot().stats.reconciliationCounts.PENDING).toBe(0);
  });

  it('수신 이벤트는 Received → Reported → Effective 순서로 저널에 남는다', () => {
    p.activatePolicy('CANARY');
    drain();
    // 저널 스냅샷은 최신순이므로 시간순으로 뒤집어 검증한다.
    const seq = p
      .getSnapshot()
      .events.filter((e) => e.vin === 'VIN-DEMO-005')
      .map((e) => e.eventType)
      .reverse();
    expect(seq).toEqual(
      expect.arrayContaining([
        'policy.desired.changed',
        'policy.delivery.started',
        'vehicle.policy.received',
        'vehicle.feature.reported',
        'vehicle.feature.effective',
      ]),
    );
    expect(seq.indexOf('vehicle.policy.received')).toBeLessThan(seq.indexOf('vehicle.feature.reported'));
    expect(seq.indexOf('vehicle.feature.reported')).toBeLessThan(seq.indexOf('vehicle.feature.effective'));
  });
});

describe('§15-5 Kill-Switch 우선순위 — 수신 대기 중인 Policy', () => {
  it('Kill-Switch 가 먼저 걸리면 수신된 Policy 는 실행되지 않는다', () => {
    p.activatePolicy('CANARY');
    p.killSwitch(['VIN-DEMO-005'], { ko: '센서 이상', en: 'Sensor anomaly' });
    drain();

    const inst = instanceOf('VIN-DEMO-005');
    expect(inst.desired.state).toBe('OFF'); // 플랫폼이 ON 요청을 철회한다
    expect(inst.reported.state).toBe('OFF'); // 차량은 수신했지만 실행하지 않는다
    expect(inst.effective.state).toBe('OFF');
    expect(inst.effective.reasonCode).toBe('KILL_SWITCH_ACTIVE');
    expect(inst.reported.guardReason).toBe('KILL_SWITCH_ACTIVE');

    const v = verdictOf('VIN-DEMO-005');
    // Desired/Reported/Effective 가 모두 OFF 로 일치하므로 Safe State 에는 수렴했다.
    expect(v.reconciliation.result).toBe('CONVERGED');
    expect(v.reconciliation.reasonCode).toBe('KILL_SWITCH_ACTIVE');
    expect(v.health).toBe('DEGRADED');
    expect(v.eligibility.eligibility).toBe('BLOCKED_BY_SAFETY_RULE');

    const blocked = p.getSnapshot().events.find((e) => e.eventType === 'vehicle.guard.blocked' && e.vin === 'VIN-DEMO-005');
    expect(blocked?.payload?.reasonCode).toBe('KILL_SWITCH_ACTIVE');

    // 영향을 받지 않은 차량은 정상 수렴한다.
    expect(verdictOf('VIN-DEMO-007').reconciliation.result).toBe('CONVERGED');
    expect(p.rollout.paused).toBe(true);
  });
});

describe('§12.5 장애 주입 → Incident → 자동 Pause', () => {
  beforeEach(() => {
    p.activatePolicy('CANARY');
    drain();
  });

  it('Effective Drift 는 Critical Drift 로 판정되고 SEV-1 Incident 를 만든다', () => {
    const incident = p.injectFault('EFFECTIVE_DRIFT');
    expect(incident.incidentId).toBe('INC-0001');
    expect(incident.fault).toBe('EFFECTIVE_DRIFT');
    expect(incident.severity).toBe('SEV-1');
    expect(incident.status).toBe('OPEN');
    expect(incident.detectedBy).toBe('TWIN_RECONCILIATION');
    expect(incident.affectedVins).toEqual(expect.arrayContaining(CANARY_VINS));
    expect(incident.rolloutPaused).toBe(true);

    const v = verdictOf('VIN-DEMO-005');
    expect(v.reconciliation.result).toBe('CRITICAL_DRIFT');
    expect(v.reconciliation.reasonCode).toBe('EFFECTIVE_DRIFT_DETECTED');
    expect(v.health).toBe('DRIFTED');
    expect(incident.reasonCode).toBe('EFFECTIVE_DRIFT_DETECTED');
  });

  it('장애 주입은 신규 Rollout 을 자동 일시정지시킨다', () => {
    expect(p.rollout.paused).toBe(false);
    p.injectFault('EFFECTIVE_DRIFT');
    expect(p.rollout.paused).toBe(true);
    expect(p.rollout.pausedReason?.ko).toContain('자동 일시정지');
    expect(p.getSnapshot().convergence.paused).toBe(true);
  });

  it('DTC 기반 장애는 Telemetry 가 감지한다', () => {
    const incident = p.injectFault('ABNORMAL_DTC');
    expect(incident.detectedBy).toBe('TELEMETRY');
    expect(incident.severity).toBe('SEV-1');
    expect(instanceOf('VIN-DEMO-005').observed.dtcCodes).toContain('P0A7F-00');
  });
});

describe('§15 Kill-Switch 실행 → Safe State 확인', () => {
  beforeEach(() => {
    p.activatePolicy('CANARY');
    drain();
    p.injectFault('EFFECTIVE_DRIFT');
  });

  it('Kill-Switch 는 전 차량을 Safe State 로 내리고 차량 확인 전까지 PENDING 이다', () => {
    const affected = p.killSwitch('ALL', { ko: '전 차량 중단', en: 'Stop all vehicles' }, 'INC-0001');
    expect(affected).toHaveLength(DEMO_FLEET_SIZE);

    const ks = twinOf('VIN-DEMO-001').killSwitch!;
    expect(ks.active).toBe(true);
    expect(ks.featureId).toBe(T.FEATURE_ID);
    expect(ks.policyVersion).toBe(T.DEMO_POLICY.policyVersion);
    expect(ks.safeState).toBe('OFF');
    expect(ks.requestedBy).toBe('operator-7');
    expect(ks.affectedVins).toBe(DEMO_FLEET_SIZE);

    ['VIN-DEMO-001', 'VIN-DEMO-002'].forEach((vin) => {
      const inst = instanceOf(vin);
      expect(inst.desired.state).toBe('OFF');
      expect(inst.effective.state).toBe('OFF');
      const v = verdictOf(vin);
      expect(v.reconciliation.result).toBe('PENDING');
      expect(v.reconciliation.reasonCode).toBe('KILL_SWITCH_ACTIVE');
      expect(v.health).toBe('DEGRADED');
    });

    // 오프라인 차량은 응답 자체가 없어 Reported Unknown 으로 남는다 (§9 row 4).
    expect(instanceOf('VIN-DEMO-025').reported.state).toBe('UNKNOWN');
    expect(p.getSnapshot().stats.reconciliationCounts.CRITICAL_DRIFT).toBe(0);
  });

  it('Kill-Switch 해제 후 남은 활성 수가 0 이 된다', () => {
    p.killSwitch('ALL', { ko: '전 차량 중단', en: 'Stop all vehicles' });
    expect(p.getSnapshot().twins.filter((t) => t.killSwitch?.active)).toHaveLength(DEMO_FLEET_SIZE);
    p.releaseKillSwitch();
    expect(p.getSnapshot().twins.filter((t) => t.killSwitch?.active)).toHaveLength(0);
    p.releaseKillSwitch(); // 멱등 — 이미 해제된 상태에서도 안전하다
    expect(p.getSnapshot().twins.filter((t) => t.killSwitch?.active)).toHaveLength(0);
  });
});

describe('§18 Closed Loop 12단계 · Evidence · 복구', () => {
  let incidentId: string;

  beforeEach(() => {
    p.activatePolicy('CANARY');
    drain();
    incidentId = p.injectFault('EFFECTIVE_DRIFT').incidentId;
  });

  it('단계는 1-based id 를 가지며 자동 Pause 단계까지 완료 상태로 시작한다', () => {
    const steps = p.incidentById(incidentId)!.steps;
    expect(steps).toHaveLength(12);
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(steps.filter((s) => s.status === 'DONE')).toHaveLength(6);
    expect(steps.find((s) => s.status === 'ACTIVE')!.id).toBe(7);
  });

  it('활성 Rollout 이 없으면 Pause 단계를 건너뛴다', () => {
    p.resetAll();
    const inc = p.injectFault('EFFECTIVE_DRIFT'); // 활성화 전이므로 Pause 대상이 없다
    expect(inc.rolloutPaused).toBe(false);
    expect(inc.steps.filter((s) => s.status === 'DONE')).toHaveLength(5);
    expect(inc.steps.find((s) => s.status === 'ACTIVE')!.id).toBe(6);
  });

  it('진행 단계의 상세는 활성 단계에 기록된다', () => {
    p.advanceClosedLoop(incidentId, 6, { ko: 'Kill-Switch 실행 완료', en: 'Kill-switch executed' });
    const inc = p.incidentById(incidentId)!;
    expect(inc.status).toBe('MITIGATING');
    const active = inc.steps.filter((s) => s.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(7);
    expect(active[0].detail.ko).toBe('Kill-Switch 실행 완료');
    expect(inc.steps.filter((s) => s.status === 'DONE')).toHaveLength(6);
  });

  it('부분 복구는 지정한 Cohort 만 재수렴시킨다', () => {
    p.recoverCohort(incidentId, CANARY_VINS);
    const inc = p.incidentById(incidentId)!;
    expect(inc.status).toBe('RECOVERING');
    expect(inc.steps.find((s) => s.status === 'ACTIVE')!.id).toBe(11);

    CANARY_VINS.forEach((vin) => {
      const inst = instanceOf(vin);
      expect([inst.desired.state, inst.reported.state, inst.effective.state]).toEqual(['ON', 'ON', 'ON']);
      expect(twinOf(vin).killSwitch?.active).not.toBe(true);
      const v = verdictOf(vin);
      expect(v.reconciliation.result).toBe('CONVERGED');
      expect(v.health).toBe('HEALTHY');
    });
    expect(p.getSnapshot().events.some((e) => e.eventType === 'rollback.completed')).toBe(true);
  });

  it('Incident 종료는 Evidence 3건과 함께 수렴 상태를 확정한다', () => {
    p.recoverCohort(incidentId, CANARY_VINS);
    const closed = p.closeIncident(incidentId)!;
    expect(closed.status).toBe('CLOSED');
    expect(closed.rolloutPaused).toBe(false);
    expect(closed.closedAt).toBeTruthy();
    expect(closed.evidence.map((e) => e.kind)).toEqual(['GUARD', 'SAFETY', 'ROLLBACK']);
    expect(closed.evidence.every((e) => e.id.startsWith(`EVD-${incidentId}-`))).toBe(true);
    expect(closed.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(p.getSnapshot().events.some((e) => e.eventType === 'incident.closed')).toBe(true);
  });

  it('Rollback 은 활성 VIN 의 Desired 를 OFF 로 내리고 Rollout 을 닫는다', () => {
    const rolled = p.rollback();
    expect(rolled).toEqual(CANARY_VINS);
    expect(p.rollout.active).toBe(false);
    expect(p.rollout.scope).toBe('NONE');
    expect(p.rollout.activatedVins).toEqual([]);

    const inst = instanceOf('VIN-DEMO-005');
    expect([inst.desired.state, inst.reported.state, inst.effective.state]).toEqual(['OFF', 'OFF', 'OFF']);
    const eventTypes = p.getSnapshot().events.map((e) => e.eventType);
    expect(eventTypes).toContain('rollback.requested');
    expect(eventTypes).toContain('rollback.completed');
  });
});

describe('§18 Idempotency — 중복 · 역행 이벤트 차단', () => {
  const event = (patch: Partial<T.TwinEvent> = {}): T.TwinEvent => ({
    eventId: 'EVT-TEST-1',
    eventType: 'vehicle.feature.reported',
    occurredAt: '2026-09-13T10:05:00Z',
    simTick: 0,
    correlationId: 'ROLLOUT-BDC-2027-01',
    source: 'VEHICLE_AGENT',
    vin: 'VIN-DEMO-001',
    payload: { reported: 'ON' },
    desc: { ko: '중복 보고 테스트', en: 'Duplicate report test' },
    severity: 'INFO',
    ...patch,
  });

  it('같은 eventId 를 두 번 적용하지 않는다', () => {
    const before = p.getSnapshot().events.length;
    expect(p.ingestVehicleReport(event())).toBe(true);
    expect(instanceOf('VIN-DEMO-001').reported.state).toBe('ON');
    const after = p.getSnapshot().events.length;

    expect(p.ingestVehicleReport(event())).toBe(false);
    expect(p.getSnapshot().events.length).toBe(after);
    expect(after).toBe(before + 1);
  });

  it('Twin Version 이 뒤처진 이벤트는 무시한다', () => {
    const at = '2026-09-13T10:06:00Z';
    expect(p.ingestVehicleReport(event({ eventId: 'EVT-OLD-1', occurredAt: at, twinVersion: 1 }))).toBe(false);
  });

  it('알 수 없는 VIN 은 Twin 을 만들지 않고 거부한다', () => {
    expect(p.ingestVehicleReport(event({ eventId: 'EVT-UNKNOWN', vin: 'VIN-XXXX-000' }))).toBe(false);
    expect(p.getTwin('VIN-XXXX-000')).toBeNull();
    expect(p.getSnapshot().stats.total).toBe(DEMO_FLEET_SIZE);
  });

  it('저널은 eventId 를 단조 증가시키고 중복 ingest 를 거부한다', () => {
    const first = p.journal.emit({
      type: 'twin.reconciliation.changed',
      vin: 'VIN-DEMO-001',
      at: '2026-09-13T10:07:00Z',
      simTick: 0,
      correlationId: 'TEST',
    });
    expect(p.journal.ingest(first)).toBe(false);
    expect(first.eventId).toBe('EVT-000001');
  });
});

describe('§14 시뮬레이터 리셋 · 시간 제어', () => {
  it('resetAll 은 초기 Fleet 과 빈 Incident 로 되돌린다', () => {
    p.activatePolicy('CANARY');
    drain();
    p.injectFault('EFFECTIVE_DRIFT');

    p.resetAll();
    const snap = p.getSnapshot();
    expect(snap.stats.total).toBe(DEMO_FLEET_SIZE);
    expect(snap.stats.reconciliationCounts.CONVERGED).toBe(22);
    expect(snap.incidents).toEqual([]);
    expect(snap.events).toEqual([]);
    expect(snap.rollout.active).toBe(false);
    expect(snap.clock.simTick).toBe(0);
    expect(snap.clock.rate).toBe(0);

    // Incident 번호와 Rollout 상태가 다시 초기값에서 시작한다.
    expect(p.injectFault('ABNORMAL_DTC').incidentId).toBe('INC-0001');
  });

  it('rate 0 에서는 tick 이 시간을 진행시키지 않는다', () => {
    const before = p.getSnapshot().clock.simTimeMs;
    p.tick(60_000);
    expect(p.getSnapshot().clock.simTimeMs).toBe(before);

    p.setRate(1);
    p.tick(60_000);
    expect(p.getSnapshot().clock.simTimeMs).toBe(before + 60_000);
    expect(p.getSnapshot().clock.running).toBe(true);

    p.setRate(0);
    expect(p.getSnapshot().clock.running).toBe(false);
  });

  it('step 은 시뮬레이션 시간만 진행시키고 온라인 차량 신호를 갱신한다', () => {
    const before = twinOf('VIN-DEMO-001').context.BatteryTemperature!.observedAt;
    p.step(STEP);
    const after = twinOf('VIN-DEMO-001');
    expect(after.context.BatteryTemperature!.observedAt).not.toBe(before);
    expect(p.getSnapshot().clock.simTick).toBe(1);

    // 오프라인 차량은 마지막 수신 시각에 멈춰 있다 (§6 Stale).
    const offlineBefore = twinOf('VIN-DEMO-025').context.BatteryTemperature!.observedAt;
    p.step(STEP);
    expect(twinOf('VIN-DEMO-025').context.BatteryTemperature!.observedAt).toBe(offlineBefore);
  });
});


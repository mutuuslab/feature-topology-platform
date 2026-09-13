/**
 * Digital Twin 데이터 계층 회귀 테스트.
 *
 * 대상 문서: DIGITAL_TWIN_DEMO.md §5(Reconciliation), §6(Eligibility · Local Guard),
 * §7(Unknown 원인 분류), §8(Twin 모델 · 버전 단조성), §9(Fleet 집계).
 *
 * 엔진은 순수 함수이므로 UI · Store 없이 직접 호출한다. 기준 시각(NOW)은 앱과 동일한
 * 결정적 앵커이며, 여기서 Date.now() 를 쓰면 30대 Fleet 판정이 흔들리므로 사용하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { buildDemoFleet } from '../data/twin/fleet';

const NOW = Date.parse('2026-09-13T10:00:00Z');
const ctx = (nowMs: number = NOW): E.EvalContext => ({ nowMs });

const fleet = buildDemoFleet(NOW);
const byVin = (vin: string): T.Twin => {
  const twin = fleet.find((t) => t.vin === vin);
  if (!twin) throw new Error(`demo fleet has no ${vin}`);
  return twin;
};

/** Deterministic signal patch — keeps the rest of the context intact. */
const withSignal = (twin: T.Twin, key: T.SignalKey, value: number | string): T.Twin => ({
  ...twin,
  context: { ...twin.context, [key]: { ...twin.context[key]!, value } },
});

const withSignalAge = (twin: T.Twin, key: T.SignalKey, ageSeconds: number): T.Twin => ({
  ...twin,
  context: { ...twin.context, [key]: { ...twin.context[key]!, observedAt: E.isoAt(NOW - ageSeconds * 1000) } },
});

const killSwitchOn = (twin: T.Twin): T.Twin => ({
  ...twin,
  killSwitch: {
    active: true,
    requestedBy: 'operator-7',
    requestedAt: E.isoAt(NOW - 5 * 60_000),
    reason: { ko: '테스트 안전 정지', en: 'Test safety stop' },
    featureId: T.FEATURE_ID,
    policyVersion: T.DEMO_POLICY.policyVersion,
    safeState: 'OFF',
    affectedVins: 1,
  },
});

/* ==================================================================== */
/* §5 — Desired × Reported × Effective 매트릭스                          */
/* ==================================================================== */

describe('§5 Reconciliation 매트릭스 (Desired × Reported × Effective)', () => {
  const cases: Array<[T.DesiredState, T.ReportedState, T.EffectiveState, T.Reconciliation]> = [
    ['ON', 'ON', 'ON', 'CONVERGED'],
    ['OFF', 'OFF', 'OFF', 'CONVERGED'],
    ['ON', 'ON', 'BLOCKED', 'GUARDED'],
    ['ON', 'ON', 'DEGRADED', 'GUARDED'],
    ['ON', 'REJECTED', 'OFF', 'REJECTED'],
    ['ON', 'NOT_RECEIVED', 'OFF', 'PENDING'],
    ['ON', 'NOT_RECEIVED', 'BLOCKED', 'PENDING'],
    ['OFF', 'NOT_RECEIVED', 'OFF', 'CONVERGED'],
    ['OFF', 'ON', 'ON', 'CRITICAL_DRIFT'],
    ['OFF', 'UNKNOWN', 'UNKNOWN', 'PENDING'],
    ['ON', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
  ];

  it.each(cases)('D=%s R=%s E=%s → %s', (desired, reported, effective, expected) => {
    expect(E.reconciliationTable(desired, reported, effective)).toBe(expected);
  });

  it('Desired=OFF / Effective=ON 은 Effective=OFF 보다 먼저 Drift 로 분류된다', () => {
    // 순서가 뒤바뀌면 되돌릴 수 없는 Critical Drift 가 PENDING 으로 숨는다.
    expect(E.reconciliationTable('OFF', 'OFF', 'ON')).toBe('CRITICAL_DRIFT');
    expect(E.reconciliationTable('ON', 'ON', 'BLOCKED')).toBe('GUARDED');
  });

  it('판정마다 Reason Code · Evidence 가 함께 부여된다', () => {
    const converged = E.reconcile({ desired: 'ON', reported: 'ON', effective: 'ON', policyVersion: 'POL-0042', twinVersion: 3, nowMs: NOW });
    expect(converged.result).toBe('CONVERGED');
    expect(converged.reasonCode).toBe('POLICY_APPLIED_OK');
    expect(converged.evidence.length).toBeGreaterThan(0);
    expect(converged.twinVersion).toBe(3);

    const offConverged = E.reconcile({ desired: 'OFF', reported: 'OFF', effective: 'OFF', policyVersion: 'POL-0042', twinVersion: 3, nowMs: NOW });
    expect(offConverged.reasonCode).toBe('CONVERGED');
  });

  it('차단 · 거부 · Drift 는 각자의 사유 코드를 쓴다', () => {
    const guarded = E.reconcile({
      desired: 'ON', reported: 'ON', effective: 'BLOCKED', policyVersion: 'POL-0042', twinVersion: 4, nowMs: NOW,
      guardReason: 'SOC_BELOW_THRESHOLD',
    });
    expect(guarded.result).toBe('GUARDED');
    expect(guarded.reasonCode).toBe('SOC_BELOW_THRESHOLD');

    const rejected = E.reconcile({ desired: 'ON', reported: 'REJECTED', effective: 'OFF', policyVersion: 'POL-0039', twinVersion: 5, nowMs: NOW });
    expect(rejected.reasonCode).toBe('POLICY_SIGNATURE_INVALID');

    const drift = E.reconcile({ desired: 'OFF', reported: 'ON', effective: 'ON', policyVersion: 'POL-0042', twinVersion: 6, nowMs: NOW });
    expect(drift.reasonCode).toBe('EFFECTIVE_DRIFT_DETECTED');
  });

  it('Kill-Switch 로 인한 PENDING 은 배송 지연(POLICY_NOT_RECEIVED)과 구분된다', () => {
    // 두 경우 모두 PENDING 이지만 원인이 다르다 — 원인을 구분하지 못하면 운영자가
    // 재전송해야 할 차량과 안전 정지된 차량을 헷갈린다.
    const notDelivered = E.reconcile({
      desired: 'ON', reported: 'NOT_RECEIVED', effective: 'OFF', policyVersion: 'POL-0042', twinVersion: 1, nowMs: NOW,
    });
    const killed = E.reconcile({
      desired: 'ON', reported: 'NOT_RECEIVED', effective: 'OFF', policyVersion: 'POL-0042', twinVersion: 1, nowMs: NOW,
      killSwitchActive: true,
    });
    expect(notDelivered.result).toBe('PENDING');
    expect(killed.result).toBe('PENDING');
    expect(notDelivered.reasonCode).toBe('POLICY_NOT_RECEIVED');
    expect(killed.reasonCode).toBe('KILL_SWITCH_ACTIVE');
  });

  it('표에 없는 조합(D=ON R=ON E=OFF)은 UNKNOWN 으로 남아 원인 분석을 요구한다', () => {
    const odd = E.reconcile({
      desired: 'ON', reported: 'ON', effective: 'OFF', policyVersion: 'POL-0042', twinVersion: 7, nowMs: NOW,
      unknownSignals: { twin: byVin('VIN-DEMO-001'), nowMs: NOW, telemetryAgeSeconds: 5, telemetryTtlSeconds: 120 },
    });
    expect(odd.result).toBe('UNKNOWN');
    expect(odd.reasonCode).toBe('CAUSE_ANALYSIS_REQUIRED');
  });

  it('Incident 사유는 incidentId 가 붙는다', () => {
    const drift = E.reconcile({ desired: 'OFF', reported: 'ON', effective: 'ON', policyVersion: 'POL-0042', twinVersion: 6, nowMs: NOW });
    expect(drift.incidentId).toBeTruthy();
    const ok = E.reconcile({ desired: 'ON', reported: 'ON', effective: 'ON', policyVersion: 'POL-0042', twinVersion: 3, nowMs: NOW });
    expect(ok.incidentId).toBeNull();
  });
});

/* ==================================================================== */
/* §7 — Unknown 은 반드시 원인을 가진다 (8종)                            */
/* ==================================================================== */

describe('§7 Unknown 원인 분류 (8종)', () => {
  const causes: T.UnknownCause[] = [
    'TELEMETRY_TIMEOUT',
    'TWIN_SNAPSHOT_MISSING',
    'POLICY_VERSION_UNKNOWN',
    'VEHICLE_AGENT_VERSION_UNSUPPORTED',
    'CONFIGURATION_MISMATCH',
    'SIGNAL_QUALITY_UNKNOWN',
    'BACKEND_PROCESSING_FAILURE',
    'CAUSE_ANALYSIS_REQUIRED',
  ];

  it('8종 모두 라벨·조치가 정의되어 있다', () => {
    expect(causes).toHaveLength(8);
    causes.forEach((c) => {
      expect(T.UNKNOWN_CAUSE_LABEL[c].ko.length).toBeGreaterThan(0);
      expect(T.UNKNOWN_CAUSE_LABEL[c].en.length).toBeGreaterThan(0);
      expect(T.UNKNOWN_CAUSE_ACTION[c].ko.length).toBeGreaterThan(0);
    });
  });

  it('Twin 스냅샷이 없으면 판정 자체가 불가능하다', () => {
    const out = E.classifyUnknown({});
    expect(out.cause).toBe('TWIN_SNAPSHOT_MISSING');
    expect(out.reasonCode).toBe('TWIN_SNAPSHOT_MISSING');
    expect(out.action.ko.length).toBeGreaterThan(0);
  });

  it('통신 단절(3×TTL 초과)은 Telemetry Timeout 으로 분류된다', () => {
    const twin = byVin('VIN-DEMO-001');
    const out = E.classifyUnknown({ twin, nowMs: NOW, telemetryAgeSeconds: 4000, telemetryTtlSeconds: 120 });
    expect(out.cause).toBe('TELEMETRY_TIMEOUT');
    expect(out.reasonCode).toBe('TELEMETRY_TIMEOUT');
  });

  it('나머지 원인 6종을 각각 구분한다', () => {
    const twin = byVin('VIN-DEMO-001');
    const base: E.UnknownSignals = { twin, nowMs: NOW, telemetryAgeSeconds: 5, telemetryTtlSeconds: 120 };

    expect(E.classifyUnknown({ ...base, policyVersionKnown: false }).cause).toBe('POLICY_VERSION_UNKNOWN');
    expect(E.classifyUnknown({ ...base, agentVersion: 'VA-1.4.0' }).cause).toBe('VEHICLE_AGENT_VERSION_UNSUPPORTED');
    expect(E.classifyUnknown({ ...base, configurationMismatch: true }).cause).toBe('CONFIGURATION_MISMATCH');
    expect(E.classifyUnknown({ ...base, signalQualityUnknown: true }).cause).toBe('SIGNAL_QUALITY_UNKNOWN');
    expect(E.classifyUnknown({ ...base, backendFailure: true }).cause).toBe('BACKEND_PROCESSING_FAILURE');
    expect(E.classifyUnknown({ ...base }).cause).toBe('CAUSE_ANALYSIS_REQUIRED');
  });

  it('Unknown 판정은 원인 코드를 그대로 사유 코드로 노출한다', () => {
    const twin = byVin('VIN-DEMO-001');
    const recon = E.reconcile({
      desired: 'ON', reported: 'UNKNOWN', effective: 'UNKNOWN', policyVersion: null, twinVersion: 2, nowMs: NOW,
      unknownSignals: { twin, nowMs: NOW, telemetryAgeSeconds: 4000, telemetryTtlSeconds: 120 },
    });
    expect(recon.result).toBe('UNKNOWN');
    expect(recon.reasonCode).toBe('TELEMETRY_TIMEOUT');
  });
});

/* ==================================================================== */
/* §6 — 신호 신선도 · 품질                                               */
/* ==================================================================== */

describe('§6 신호 Stale · 품질 판정', () => {
  const spec = T.SIGNAL_BY_KEY.BatteryTemperature;

  it('TTL 을 넘긴 샘플만 Stale 로 판정한다', () => {
    const fresh: T.SignalSample = { value: 12, unit: spec.unit, quality: 'GOOD', observedAt: E.isoAt(NOW - 60_000), ttlSeconds: spec.ttlSeconds };
    const stale: T.SignalSample = { value: 12, unit: spec.unit, quality: 'GOOD', observedAt: E.isoAt(NOW - (spec.ttlSeconds + 60) * 1000), ttlSeconds: spec.ttlSeconds };
    expect(E.isSampleStale(fresh, NOW)).toBe(false);
    expect(E.isSampleStale(stale, NOW)).toBe(true);
    expect(E.isSampleStale(undefined, NOW)).toBe(true);
  });

  it('Stale 신호는 차단 사유(BATTERY_TEMP_SIGNAL_STALE)로 이어진다', () => {
    const broken = withSignalAge(byVin('VIN-DEMO-001'), 'BatteryTemperature', 5 * 3600);
    expect(E.staleSignals(broken, NOW)).toContain('BatteryTemperature');

    const guard = E.evaluateLocalGuard(broken, ctx());
    expect(guard.passed).toBe(false);
    expect(guard.reasonCode).toBe('BATTERY_TEMP_SIGNAL_STALE');
  });

  it('품질이 BAD · UNKNOWN 인 신호는 별도로 집계된다', () => {
    const base = byVin('VIN-DEMO-001');
    expect(E.missingQualitySignals(base)).toEqual([]);

    const badQuality: T.Twin = {
      ...base,
      context: { ...base.context, AmbientTemperature: { ...base.context.AmbientTemperature!, quality: 'UNKNOWN' } },
    };
    expect(E.missingQualitySignals(badQuality)).toEqual(['AmbientTemperature']);
    expect(E.evaluateLocalGuard(badQuality, ctx()).reasonCode).toBe('SIGNAL_QUALITY_BAD');
  });

  it('오프라인 캐시 TTL 만료를 별도로 판정한다', () => {
    expect(E.offlineCacheExpired(byVin('VIN-DEMO-024'), NOW)).toBe(false);
    expect(E.offlineCacheExpired(byVin('VIN-DEMO-025'), NOW)).toBe(true);
  });
});

/* ==================================================================== */
/* §6 — Local Guard (차량 내부 최종 판단)                                */
/* ==================================================================== */

describe('§6 Local Guard — 10개 검사', () => {
  it('정상 차량은 Guard 를 통과한다', () => {
    const guard = E.evaluateLocalGuard(byVin('VIN-DEMO-002'), ctx());
    expect(guard.passed).toBe(true);
    expect(guard.reasonCode).toBe('LOCAL_GUARD_PASSED');
    // GS-03(Policy Version 비역전)은 수신 중인 Policy 가 있을 때만 검사한다.
    expect(guard.checks.map((c) => c.id)).toEqual([
      'GS-01', 'GS-02', 'GS-04', 'GS-05', 'GS-06', 'GS-07', 'GS-08', 'GS-09', 'GS-10',
    ]);
    expect(guard.evaluatedAt).toBe(E.isoAt(NOW));

    const verdict = E.evaluateTwin(byVin('VIN-DEMO-002'), ctx());
    expect(verdict.guard.checks.map((c) => c.id)).toHaveLength(10);
    expect(verdict.guard.checks.every((c) => c.passed)).toBe(true);
  });

  it('SOC 미달이면 차단된다', () => {
    const low = withSignal(byVin('VIN-DEMO-002'), 'BatterySoc', E.GUARD_LIMITS.minSoc - 1);
    const guard = E.evaluateLocalGuard(low, ctx());
    expect(guard.passed).toBe(false);
    expect(guard.reasonCode).toBe('SOC_BELOW_THRESHOLD');
    expect(guard.checks.find((c) => c.id === 'GS-06')?.passed).toBe(false);
  });

  it('주행/시동 상태(Power Mode 미충족)에는 활성화하지 않는다', () => {
    const driving = withSignal(byVin('VIN-DEMO-002'), 'VehiclePowerMode', 'DRIVING');
    const guard = E.evaluateLocalGuard(driving, ctx());
    expect(guard.passed).toBe(false);
    expect(guard.reasonCode).toBe('POWER_MODE_NOT_READY');
  });

  it('충전 스케줄 · 커넥터 · 배터리 온도 범위도 각각 차단 사유가 된다', () => {
    const base = byVin('VIN-DEMO-002');
    expect(E.evaluateLocalGuard(withSignal(base, 'ChargingSchedule', 'NONE'), ctx()).reasonCode).toBe('CHARGING_SCHEDULE_MISSING');
    expect(E.evaluateLocalGuard(withSignal(base, 'ChargingConnectorState', 'DISCONNECTED'), ctx()).reasonCode).toBe('CHARGING_CONNECTOR_OPEN');
    expect(E.evaluateLocalGuard(withSignal(base, 'BatteryTemperature', E.GUARD_LIMITS.maxBatteryTemp + 5), ctx()).reasonCode).toBe('BATTERY_TEMP_OUT_OF_RANGE');
  });

  it('Kill-Switch 는 다른 모든 조건보다 우선한다', () => {
    const low = withSignal(byVin('VIN-DEMO-002'), 'BatterySoc', 3);
    const guard = E.evaluateLocalGuard(killSwitchOn(low), ctx());
    expect(guard.passed).toBe(false);
    expect(guard.reasonCode).toBe('KILL_SWITCH_ACTIVE');
    expect(guard.checks[0].id).toBe('GS-01');
  });

  it('정책 서명 미검증 · 버전 역전도 Guard 에서 잡힌다', () => {
    const base = byVin('VIN-DEMO-002');
    const unsigned: T.Twin = {
      ...base,
      featureInstances: {
        ...base.featureInstances,
        [T.FEATURE_ID]: {
          ...base.featureInstances[T.FEATURE_ID]!,
          policy: { ...base.featureInstances[T.FEATURE_ID]!.policy, signatureStatus: 'UNVERIFIED' },
        },
      },
    };
    expect(E.evaluateLocalGuard(unsigned, ctx()).reasonCode).toBe('POLICY_SIGNATURE_INVALID');
    expect(E.evaluateLocalGuard(base, { nowMs: NOW, incomingPolicySeq: 39 }).reasonCode).toBe('POLICY_VERSION_OUTDATED');
  });
});

/* ==================================================================== */
/* §6 — Eligibility (대상 선정)                                          */
/* ==================================================================== */

describe('§6 Eligibility — 적용 경로 판정', () => {
  it('정상 차량은 Policy-only 활성화 가능', () => {
    const ev = E.evaluateEligibility(byVin('VIN-DEMO-001'), ctx());
    expect(ev.eligibility).toBe('ELIGIBLE_POLICY_ONLY');
    expect(ev.policyOnlyEligible).toBe(true);
    expect(ev.reasonCode).toBe('POLICY_APPLIED_OK');
  });

  it('One-Binary · BMS SW 미달은 REQUIRES_BINARY_OTA 로 분리된다', () => {
    const ob = E.evaluateEligibility(byVin('VIN-DEMO-013'), ctx());
    expect(ob.eligibility).toBe('REQUIRES_BINARY_OTA');
    expect(ob.policyOnlyEligible).toBe(false);
    expect(ob.reasonCode).toBe('ONE_BINARY_BELOW_MINIMUM');

    const bms = E.evaluateEligibility(byVin('VIN-DEMO-015'), ctx());
    expect(bms.eligibility).toBe('REQUIRES_BINARY_OTA');
    expect(bms.reasonCode).toBe('BMS_SOFTWARE_BELOW_MINIMUM');
  });

  it('HW · Variant · Entitlement 결손을 각각 구분한다', () => {
    expect(E.evaluateEligibility(byVin('VIN-DEMO-017'), ctx()).eligibility).toBe('INCOMPATIBLE_HARDWARE');
    expect(E.evaluateEligibility(byVin('VIN-DEMO-017'), ctx()).reasonCode).toBe('HARDWARE_CAPABILITY_MISSING');
    expect(E.evaluateEligibility(byVin('VIN-DEMO-018'), ctx()).eligibility).toBe('INCOMPATIBLE_VARIANT');
    expect(E.evaluateEligibility(byVin('VIN-DEMO-019'), ctx()).eligibility).toBe('MISSING_ENTITLEMENT');
    expect(E.evaluateEligibility(byVin('VIN-DEMO-019'), ctx()).reasonCode).toBe('ENTITLEMENT_INACTIVE');
  });

  it('Stale · 오프라인 차량은 판단을 보류하고 사유를 남긴다', () => {
    const staleSignal = E.evaluateEligibility(byVin('VIN-DEMO-022'), ctx());
    expect(staleSignal.eligibility).toBe('STALE_TWIN');
    expect(staleSignal.reasonCode).toBe('BATTERY_TEMP_SIGNAL_STALE');
    expect(staleSignal.unknownCause).toBe('TELEMETRY_TIMEOUT');

    const offline = E.evaluateEligibility(byVin('VIN-DEMO-024'), ctx());
    expect(offline.eligibility).toBe('STALE_TWIN');
    expect(offline.reasonCode).toBe('OFFLINE_POLICY_CACHE_VALID');

    const expired = E.evaluateEligibility(byVin('VIN-DEMO-025'), ctx());
    expect(expired.eligibility).toBe('STALE_TWIN');
    expect(expired.reasonCode).toBe('OFFLINE_POLICY_TTL_EXPIRED');
  });

  it('Feature 인스턴스가 없으면 UNKNOWN 으로 남긴다', () => {
    const base = byVin('VIN-DEMO-001');
    const none: T.Twin = { ...base, featureInstances: {} };
    const ev = E.evaluateEligibility(none, ctx());
    expect(ev.eligibility).toBe('UNKNOWN');
    expect(ev.unknownCause).toBe('TWIN_SNAPSHOT_MISSING');
  });

  it('Kill-Switch · 미지원 Agent 버전은 대상 선정에서 제외된다', () => {
    expect(E.evaluateEligibility(killSwitchOn(byVin('VIN-DEMO-001')), ctx()).eligibility).toBe('BLOCKED_BY_SAFETY_RULE');

    const oldAgent = byVin('VIN-DEMO-001');
    const patched: T.Twin = { ...oldAgent, link: { ...oldAgent.link, vehicleAgentVersion: 'VA-1.4.0' } };
    const ev = E.evaluateEligibility(patched, ctx());
    expect(ev.eligibility).toBe('UNKNOWN');
    expect(ev.reasonCode).toBe('VEHICLE_AGENT_VERSION_UNSUPPORTED');
  });

  it('버전 비교는 접두어(OB-/BMS-)가 붙어도 성립한다', () => {
    expect(E.cmpSemver('OB-2.7.0', '2.7.0')).toBe(0);
    expect(E.cmpSemver('BMS-3.1.0', '3.2.0')).toBeLessThan(0);
    expect(E.cmpSemver('3.10.0', '3.9.0')).toBeGreaterThan(0);
  });
});

/* ==================================================================== */
/* §8 · §18 — 버전 단조성 · 반복 적용                                    */
/* ==================================================================== */

describe('§8 버전 단조성 · 정책 역전 거부', () => {
  it('정상 Policy 배송은 버전을 올리고 보고 상태를 ON 으로 만든다', () => {
    const twin = byVin('VIN-DEMO-005');
    const next = E.applyPolicyDelivery(twin, T.policyRef(T.DEMO_POLICY, E.isoAt(NOW + 60_000)), E.isoAt(NOW + 60_000));
    const inst = next.featureInstances[T.FEATURE_ID]!;
    expect(next.twinVersion).toBe(twin.twinVersion + 1);
    expect(inst.reported.state).toBe('ON');
    expect(inst.policy.policyVersion).toBe(T.DEMO_POLICY.policyVersion);
    expect(next.auditTrail.length).toBe(twin.auditTrail.length + 1);
  });

  it('오래된 Policy Version 은 거부되고 적용 버전이 뒤로 가지 않는다', () => {
    const twin = byVin('VIN-DEMO-001');
    const cachedBefore = twin.featureInstances[T.FEATURE_ID]!.policy;
    const next = E.applyPolicyDelivery(twin, T.policyRef(T.REVOKED_POLICY, E.isoAt(NOW + 60_000)), E.isoAt(NOW + 60_000));
    const inst = next.featureInstances[T.FEATURE_ID]!;

    expect(inst.reported.state).toBe('REJECTED');
    expect(inst.reported.guardReason).toBe('POLICY_VERSION_OUTDATED');
    expect(inst.reported.receivedPolicyVersion).toBe(T.REVOKED_POLICY.policyVersion);
    expect(inst.policy.policyVersion).toBe(cachedBefore.policyVersion);
    expect(inst.policy.cachedVersionSeq).toBeGreaterThanOrEqual(cachedBefore.cachedVersionSeq);
  });

  it('서명이 검증되지 않은 Policy 도 거부된다', () => {
    const twin = byVin('VIN-DEMO-001');
    const unsigned = { ...T.policyRef(T.DEMO_POLICY, E.isoAt(NOW)), signatureStatus: 'UNVERIFIED' as T.SignatureStatus };
    const inst = E.applyPolicyDelivery(twin, unsigned, E.isoAt(NOW + 60_000)).featureInstances[T.FEATURE_ID]!;
    expect(inst.reported.state).toBe('REJECTED');
    expect(inst.reported.guardReason).toBe('POLICY_SIGNATURE_INVALID');
  });

  it('동일 상태를 재적용해도 버전은 단조 증가하며 되돌아가지 않는다', () => {
    const twin = byVin('VIN-DEMO-003');
    const inst = twin.featureInstances[T.FEATURE_ID]!;
    const a = E.applyVehicleReport(twin, { reported: inst.reported.state, effective: inst.effective.state, guardResult: 'PASS' }, E.isoAt(NOW + 60_000));
    const b = E.applyVehicleReport(a, { reported: inst.reported.state, effective: inst.effective.state, guardResult: 'PASS' }, E.isoAt(NOW + 120_000));
    expect(a.twinVersion).toBe(twin.twinVersion + 1);
    expect(b.twinVersion).toBe(a.twinVersion + 1);
    expect(b.featureInstances[T.FEATURE_ID]!.reported.state).toBe(inst.reported.state);
  });

  it('Kill-Switch 적용은 Effective 를 즉시 OFF 로 만든다', () => {
    const twin = byVin('VIN-DEMO-003');
    const killed = E.applyKillSwitch(twin, killSwitchOn(twin).killSwitch, E.isoAt(NOW + 60_000));
    const inst = killed.featureInstances[T.FEATURE_ID]!;
    expect(inst.effective.state).toBe('OFF');
    expect(inst.effective.reasonCode).toBe('KILL_SWITCH_ACTIVE');
    expect(killed.killSwitch?.active).toBe(true);
    expect(killed.twinVersion).toBeGreaterThan(twin.twinVersion);
  });

  it('rollback 승인 직후에는 차량 ack 전이라 Critical Drift 로 감지된다', () => {
    const twin = byVin('VIN-DEMO-003');
    const rolled = E.applyDesiredChange(twin, 'OFF', E.isoAt(NOW + 60_000));
    const verdict = E.evaluateTwin(rolled, ctx(NOW + 60_000));
    expect(rolled.featureInstances[T.FEATURE_ID]!.desired.state).toBe('OFF');
    expect(verdict.reconciliation.result).toBe('CRITICAL_DRIFT');
    expect(verdict.reconciliation.reasonCode).toBe('EFFECTIVE_DRIFT_DETECTED');
    expect(verdict.health).toBe('DRIFTED');
  });

  it('모든 변경은 Audit Trail 에 남고 40건으로 잘린다', () => {
    let twin = byVin('VIN-DEMO-006');
    const before = twin.auditTrail.length;
    twin = E.applyDesiredChange(twin, 'OFF', E.isoAt(NOW + 1000));
    expect(twin.auditTrail.at(-1)?.actor).toBe('operator-7');
    expect(twin.auditTrail.length).toBe(Math.min(40, before + 1));
  });
});

/* ==================================================================== */
/* §9 — Fleet 집계                                                       */
/* ==================================================================== */

describe('§9 Fleet 집계 · 수렴률', () => {
  const verdicts = fleet.map((t) => E.evaluateTwin(t, ctx()));
  const stats = E.computeFleetStats(verdicts, NOW);

  it('30대 데모 Fleet 이 결정적으로 생성된다', () => {
    expect(fleet).toHaveLength(30);
    expect(verdicts.map((v) => v.twin.vin)).toEqual(fleet.map((t) => t.vin));

    const again = buildDemoFleet(NOW).map((t) => E.evaluateTwin(t, ctx()).reconciliation.result);
    expect(again).toEqual(verdicts.map((v) => v.reconciliation.result));
  });

  it('판정 분포가 데모 시나리오와 일치한다', () => {
    expect(stats.total).toBe(30);
    expect(stats.reconciliationCounts).toMatchObject({
      CONVERGED: 22,
      PENDING: 0,
      GUARDED: 4,
      REJECTED: 1,
      CRITICAL_DRIFT: 2,
      UNKNOWN: 1,
    });
  });

  it('집계 합계와 파생 지표가 일치한다', () => {
    const sum = Object.values(stats.reconciliationCounts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(30);
    expect(Object.values(stats.healthCounts).reduce((a, b) => a + b, 0)).toBe(30);
    expect(Object.values(stats.eligibilityCounts).reduce((a, b) => a + b, 0)).toBe(30);
    expect(stats.unknown).toBe(stats.reconciliationCounts.UNKNOWN);
    expect(stats.drift).toBe(stats.reconciliationCounts.CRITICAL_DRIFT);
    expect(stats.guardBlocked).toBe(stats.reconciliationCounts.GUARDED);
    expect(stats.policyOnly).toBe(stats.eligibilityCounts.ELIGIBLE_POLICY_ONLY);
    expect(stats.requiresBinaryOta).toBe(4);
    expect(stats.incidentVehicles).toBe(7);
    expect(stats.lastSyncedAt).toBe(E.isoAt(NOW));
  });

  it('차단 · Drift · 거부 차량은 반드시 원인 사유 코드를 가진다', () => {
    verdicts
      .filter((v) => ['GUARDED', 'CRITICAL_DRIFT', 'REJECTED'].includes(v.reconciliation.result))
      .forEach((v) => {
        expect(E.reason(v.reconciliation.reasonCode)).toBeTruthy();
        expect(v.reconciliation.reasonCode).not.toBe('POLICY_APPLIED_OK');
        expect(v.reconciliation.reason.label.ko.length).toBeGreaterThan(0);
        expect(v.reconciliation.reason.recommendation.ko.length).toBeGreaterThan(0);
      });
  });

  it('Drift 차량은 Health DRIFTED 로 표시된다', () => {
    const drifted = verdicts.filter((v) => v.reconciliation.result === 'CRITICAL_DRIFT');
    expect(drifted.length).toBe(2);
    drifted.forEach((v) => expect(v.health).toBe('DRIFTED'));
  });

  it('오프라인 · Kill-Switch 차량의 Health 는 상태를 반영한다', () => {
    const offline = verdicts.find((v) => v.twin.vin === 'VIN-DEMO-025')!;
    expect(offline.health).toBe('OFFLINE');

    // Kill-Switch 는 Desired 철회 → Effective OFF 순서로 반영되고, 차량 확인 전까지 PENDING 이다.
    const at = E.isoAt(NOW + 60_000);
    const base = byVin('VIN-DEMO-003');
    const ks = killSwitchOn(base).killSwitch!;
    const killed = E.evaluateTwin(E.applyKillSwitch(E.applyDesiredChange(base, 'OFF', at), ks, at), ctx(NOW + 60_000));
    expect(killed.reconciliation.result).toBe('PENDING');
    expect(killed.reconciliation.reasonCode).toBe('KILL_SWITCH_ACTIVE');
    expect(killed.health).toBe('DEGRADED');
  });

  it('필터는 판정 · 자격 · Health 기준으로 동작한다', () => {
    const driftOnly = E.applyFilters(verdicts, { ...T.EMPTY_FILTERS, reconciliation: 'CRITICAL_DRIFT' });
    expect(driftOnly.map((v) => v.twin.vin).sort()).toEqual(['VIN-DEMO-029', 'VIN-DEMO-030']);

    const hw = E.applyFilters(verdicts, { ...T.EMPTY_FILTERS, eligibility: 'INCOMPATIBLE_HARDWARE' });
    expect(hw.map((v) => v.twin.vin)).toEqual(['VIN-DEMO-017']);

    expect(E.applyFilters(verdicts, T.EMPTY_FILTERS)).toHaveLength(stats.total);
    expect(E.applyFilters(verdicts, { ...T.EMPTY_FILTERS, region: 'KR' })).toHaveLength(27);
    expect(E.filterOptions(verdicts).reconciliation).toContain('CRITICAL_DRIFT');
  });

  it('수렴률은 임계값과 함께 계산된다', () => {
    const conv = E.computeConvergence(verdicts, NOW);
    expect(conv.total).toBe(30);
    expect(conv.threshold).toBe(T.CONVERGENCE_THRESHOLD);
    expect(conv.convergenceRate).toBeCloseTo(22 / 30, 5);
    expect(conv.counts).toEqual(stats.reconciliationCounts);
    expect(conv.waves.reduce((a, w) => a + w.total, 0)).toBe(30);
    expect(conv.paused).toBe(false);
  });
});

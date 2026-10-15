// 운행 중 감시 지표 — FFG-TEL-009 합격: 지표가 없는 출시 Feature Version 0건, 부속서 1 항목 누락 0건 (지표는 13.5 정의대로 — 골든)
import { describe, expect, it } from 'vitest';
import { ANNEX1_ITEMS, annex1Report, computeMetrics, examplePlan, metricCoverage, percentile, SAFETY_METRICS, type MetricInput } from './safety-kpi';

const H = 3_600_000;
const base: MetricInput = {
  killLatencyMs: [],
  deactivation: { total: 0, incomplete: 0, prevTotal: 0, prevIncomplete: 0 },
  pendingOverdue: 0,
  onboard: { disabled: 0, vehicles: 0, prevDisabled: 0, prevVehicles: 0 },
  stateProofFailures: 0,
  persistenceFailed: 0,
};
const byId = (vs: ReturnType<typeof computeMetrics>) => Object.fromEntries(vs.map((v) => [v.id, v]));

describe('운행 중 감시 지표 (FFG-TEL-009)', () => {
  it('FFG-TEL-009 13.5 지표 6종 — 근접 순위 p95, 표본이 없으면 값 null·경보 없음', () => {
    expect(SAFETY_METRICS.map((m) => m.id)).toEqual(['KILL_LATENCY_P95', 'INCOMPLETE_DEACTIVATION', 'PENDING_OVERDUE', 'ONBOARD_FAULT_RATIO', 'STATE_PROOF_FAILURE', 'PERSISTENCE_FAILED']);
    expect(percentile([5, 1, 4, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    const none = byId(computeMetrics(base, examplePlan('FEAT-00022', '1.0.0')));
    expect(Object.values(none).every((v) => !v.alert)).toBe(true);
    expect(none.KILL_LATENCY_P95.value).toBeNull();
    expect(none.ONBOARD_FAULT_RATIO.value).toBeNull();
  });

  it('FFG-TEL-009 골든 — 예시 경보 기준: 24시간 초과·직전 분기 대비 증가·1대/1건 이상·이전 주 2배', () => {
    const v = byId(
      computeMetrics(
        {
          killLatencyMs: [...Array(19).fill(2 * H), 30 * H],
          deactivation: { total: 10, incomplete: 2, prevTotal: 10, prevIncomplete: 1 },
          pendingOverdue: 1,
          onboard: { disabled: 4, vehicles: 100, prevDisabled: 2, prevVehicles: 100 },
          stateProofFailures: 1,
          persistenceFailed: 0,
        },
        examplePlan('FEAT-00022', '1.0.0'),
      ),
    );
    expect(v.KILL_LATENCY_P95).toMatchObject({ value: 2 * H, alert: false }); // 20대 중 95번째 = 19번째
    expect(v.INCOMPLETE_DEACTIVATION).toMatchObject({ value: 0.2, previous: 0.1, alert: true });
    expect(v.PENDING_OVERDUE.alert).toBe(true);
    expect(v.ONBOARD_FAULT_RATIO).toMatchObject({ value: 0.04, previous: 0.02, alert: true });
    expect(v.STATE_PROOF_FAILURE.alert).toBe(true);
    expect(v.PERSISTENCE_FAILED.alert).toBe(false);
    // Safety Case에 기록한 기준이 예시값을 대신한다
    const plan = { ...examplePlan('FEAT-00022', '1.0.0'), source: 'SAFETY_CASE' as const, thresholds: { ...examplePlan('X', '1').thresholds, KILL_LATENCY_P95: H } };
    expect(byId(computeMetrics({ ...base, killLatencyMs: [2 * H] }, plan)).KILL_LATENCY_P95.alert).toBe(true);
  });

  it('FFG-TEL-009 지표 계획 없는 출시 Version·Safety Case 미기록 Version을 드러낸다', () => {
    const released = [
      { featureId: 'FEAT-00022', version: '1.0.0' },
      { featureId: 'FEAT-00023', version: '1.0.0' },
    ];
    const c = metricCoverage(released, [{ ...examplePlan('FEAT-00022', '1.0.0'), source: 'SAFETY_CASE', recordedBy: 'usr-safety', recordedAt: '2026-10-15T00:00:00Z' }]);
    expect(c.missing).toEqual([{ featureId: 'FEAT-00023', version: '1.0.0' }]);
    expect(metricCoverage(released, released.map((r) => examplePlan(r.featureId, r.version))).exampleOnly).toHaveLength(2);
  });

  it('FFG-TEL-009 부속서 1 항목 6종 — 집계값이 없는 항목은 누락으로 남는다', () => {
    expect(ANNEX1_ITEMS).toHaveLength(6);
    const partial = annex1Report({ CYBERSECURITY: { count: 2, detail: { AUTH_FAILURE: 2 } } });
    expect(partial.missing).toEqual(['DEACT_NOT_COMPLETED', 'COMMUNICATION', 'UNAUTHORIZED_CHANGE', 'MRC_MANEUVER', 'REMOTE_INTERACTION']);
    const full = annex1Report(Object.fromEntries(ANNEX1_ITEMS.map((i) => [i.id, { count: 0 }])));
    expect(full.missing).toEqual([]);
  });
});

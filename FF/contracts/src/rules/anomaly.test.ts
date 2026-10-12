// 이상 징후 판정·품질 피드백 규칙 표
import { describe, expect, it } from 'vitest';
import { classifyAnomaly, feedbackActions, versionAfter, type AnomalySignal } from './anomaly';

const sig = (vin: string, severity: AnomalySignal['severity'] = 'WARNING', code = 'GAP_EST_DRIFT'): AnomalySignal => ({ kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', vin, code, severity, at: '2026-10-12T01:00:00Z', ref: null });

describe('이상 징후 판정 (D06-12)', () => {
  it.each([
    ['QM 기능, 1대 WARNING → 조사', 'QM', [sig('a')], 'WARNING', 'INVESTIGATE'],
    ['QM 기능, 1대 INFO → 관찰', 'QM', [sig('a', 'INFO')], 'INFO', 'MONITOR'],
    ['차량이 CRITICAL 보고 → 긴급 차단 권고', 'QM', [sig('a', 'CRITICAL')], 'CRITICAL', 'KILL'],
    ['서로 다른 3대 → CRITICAL', 'QM', [sig('a'), sig('b'), sig('c')], 'CRITICAL', 'KILL'],
    ['같은 차량이 3번 → 대수는 1', 'QM', [sig('a'), sig('a'), sig('a')], 'WARNING', 'INVESTIGATE'],
    ['ASIL B 기능 2대 → CRITICAL', 'B', [sig('a'), sig('b')], 'CRITICAL', 'KILL'],
    ['ASIL A 기능 2대 → WARNING', 'A', [sig('a'), sig('b')], 'WARNING', 'INVESTIGATE'],
  ] as const)('%s', (_n, asil, signals, severity, advice) => {
    const r = classifyAnomaly('FEATURE_FAULT', [...signals], { asil });
    expect([r.severity, r.advice]).toEqual([severity, advice]);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('보안: 변조는 CRITICAL, 재전송만이면 WARNING — 권고는 보안 검토', () => {
    const s = (code: string, severity: AnomalySignal['severity']): AnomalySignal => ({ ...sig('a', severity, code), kind: 'SECURITY' });
    expect(classifyAnomaly('SECURITY', [s('REPLAY', 'WARNING')], { asil: 'B' })).toMatchObject({ severity: 'WARNING', advice: 'SECURITY_REVIEW' });
    expect(classifyAnomaly('SECURITY', [s('REPLAY', 'WARNING'), s('PAYLOAD_TAMPERED', 'CRITICAL')], { asil: 'B' }).severity).toBe('CRITICAL');
  });

  it('전달: DIVERGED는 조사, TIMEOUT·PARTIAL은 재전달', () => {
    const d = (code: string, severity: AnomalySignal['severity']): AnomalySignal => ({ ...sig('', severity, code), kind: 'DELIVERY', vin: null });
    expect(classifyAnomaly('DELIVERY', [d('DIVERGED', 'CRITICAL')], { asil: null }).advice).toBe('INVESTIGATE');
    expect(classifyAnomaly('DELIVERY', [d('TIMEOUT', 'WARNING')], { asil: null }).advice).toBe('REDELIVER');
  });
});

describe('품질 피드백 (D04-06)', () => {
  it('고장: G5 재판정 + ASIL B면 G7 + vECU 회귀 / 전달 이상은 피드백 없음', () => {
    expect(feedbackActions({ kind: 'FEATURE_FAULT' }, { asil: 'B', virtualScenarios: ['SCN-FEAT00022-FAULT-KILL'] }).map((a) => a.ref)).toEqual(['G5', 'G7', 'SCN-FEAT00022-FAULT-KILL']);
    expect(feedbackActions({ kind: 'FEATURE_FAULT' }, { asil: 'QM', virtualScenarios: [] }).map((a) => a.ref)).toEqual(['G5']);
    expect(feedbackActions({ kind: 'SECURITY' }, { asil: 'QM', virtualScenarios: [] }).map((a) => a.ref)).toEqual(['G5', 'G7']);
    expect(feedbackActions({ kind: 'DELIVERY' }, { asil: 'B', virtualScenarios: ['x'] })).toEqual([]);
  });
  it.each([
    ['1.1.0', '1.0.0', true],
    ['1.0.0', '1.0.0', false],
    ['1.0.10', '1.0.9', true],
    ['0.9.0', '1.0.0', false],
  ] as const)('versionAfter(%s, %s) = %s', (a, b, r) => expect(versionAfter(a, b)).toBe(r));
});

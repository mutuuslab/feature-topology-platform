// Data Lake 연계·Closed loop 규칙(80-70 4·9장) — 4축 판정·점검 결과 흐름·Canary 규칙 ①, IF-15 계약(80-75 8장)과 이름·축이 같은지
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AbortCriteriaBody, FindingTransitionBody, LakeModelDecisionBody } from '../schemas/lake';
import {
  CANARY_METRICS, DEFAULT_ABORT, FINDING_FLOW, FINDING_STATUSES, HEALTH_AXES, INDICATOR_RULES, LAKE_INDICATORS, MIN_SAMPLE_VEHICLES,
  findingTransitionProblem, judgeAxis, judgeCanary, judgeIndicator, modelUsable, type CanaryArmStat, type IndicatorValue,
} from './lake';

const api = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', '80-integration', 'datalake-if15.openapi.json'), 'utf8'));
const iv = (name: IndicatorValue['name'], current: number | null, previous: number | null = null, sampleVehicles = 5000, suppressed = false): IndicatorValue => ({ name, axis: INDICATOR_RULES[name].axis, current, previous, sampleVehicles, suppressed });

describe('IF-15 계약 대조 (TL-C01)', () => {
  it('지표 이름·축은 OpenAPI Indicator enum과 같다 — 규칙 표가 모든 지표를 덮는다', () => {
    const ind = api.components.schemas.Indicator.properties;
    expect([...LAKE_INDICATORS].sort()).toEqual([...ind.name.enum].sort());
    expect([...HEALTH_AXES]).toEqual(ind.axis.enum);
    expect(Object.keys(INDICATOR_RULES).sort()).toEqual([...LAKE_INDICATORS].sort());
  });
  it('신선도 SLA 기본값(안전 600초)과 k_min=5가 계약과 같다', () => {
    expect(api.components.schemas.Freshness.properties.sla_seconds.description).toContain('600');
    expect(api.components.schemas.Meta.properties.k_min.const).toBe(5);
  });
});

describe('4축 판정 (80-70 9.1)', () => {
  it('경계·추세 — 커질수록 나쁜 지표와 작아질수록 나쁜 지표', () => {
    expect(judgeIndicator(iv('dtc_vehicle_rate', 0.009))).toBe('ACTION');
    expect(judgeIndicator(iv('dtc_vehicle_rate', 0.003, 0.0015))).toBe('WATCH'); // 앞 창 대비 2배
    expect(judgeIndicator(iv('dtc_vehicle_rate', 0.002, 0.0019))).toBe('OK');
    expect(judgeIndicator(iv('delivery_success_rate', 0.9))).toBe('ACTION');
    expect(judgeIndicator(iv('delivery_success_rate', 0.995))).toBe('OK');
  });
  it('판단 불가 — 값 없음·가림(k<5)·표본 부족은 정상이 아니다', () => {
    expect(judgeIndicator(iv('usage_rate', null))).toBe('UNKNOWN');
    expect(judgeIndicator(iv('usage_rate', 0.5, null, 5000, true))).toBe('UNKNOWN');
    expect(judgeIndicator(iv('usage_rate', 0.5, null, MIN_SAMPLE_VEHICLES - 1))).toBe('UNKNOWN');
  });
  it('축 = 가장 급한 지표, 데이터가 늦으면 정상 대신 판단 불가', () => {
    expect(judgeAxis([iv('dtc_vehicle_rate', 0.001), iv('fault_rate_per_1k', 6)], false)).toEqual({ state: 'ACTION', cause: 'fault_rate_per_1k' });
    expect(judgeAxis([iv('dtc_vehicle_rate', 0.001)], true)).toEqual({ state: 'UNKNOWN', cause: null });
    expect(judgeAxis([iv('dtc_vehicle_rate', 0.009)], true).state).toBe('ACTION');
    expect(judgeAxis([], false).state).toBe('UNKNOWN');
  });
});

describe('점검 결과 흐름 (80-70 9.3·9.4, INV-20)', () => {
  const f = (status: (typeof FINDING_STATUSES)[number], actions: unknown[] = [], met: boolean | null = null) => ({ status, actions, effect: { met } });
  it('감지 → 분석 중 → 조치 중 → 효과 확인 중 → 닫힘/다시 열림 — 건너뛰기 없음', () => {
    expect(FINDING_FLOW.DETECTED).toEqual(['ANALYZING']);
    expect(findingTransitionProblem(f('DETECTED'), 'ACTING', true)).not.toBeNull();
    expect(findingTransitionProblem(f('REOPENED'), 'ANALYZING', false)).toBeNull();
  });
  it('조치 없이 조치 중으로 갈 수 없고, 효과 확인 없이 닫을 수 없다', () => {
    expect(findingTransitionProblem(f('ANALYZING'), 'ACTING', false)).toContain('조치');
    expect(findingTransitionProblem(f('ANALYZING'), 'ACTING', true)).toBeNull();
    expect(findingTransitionProblem(f('VERIFYING', [1], null), 'CLOSED', false)).toContain('효과');
    expect(findingTransitionProblem(f('VERIFYING', [1], false), 'CLOSED', false)).toContain('효과');
    expect(findingTransitionProblem(f('VERIFYING', [1], true), 'CLOSED', false)).toBeNull();
    expect(findingTransitionProblem(f('VERIFYING', [1], true), 'REOPENED', false)).not.toBeNull();
    expect(findingTransitionProblem(f('VERIFYING', [1], false), 'REOPENED', false)).toBeNull();
  });
});

describe('Canary 규칙 ① (80-70 4장, INV-16·17)', () => {
  const stat = (metric: (typeof CANARY_METRICS)[number], lo: number): CanaryArmStat => ({ metric, treatment: 1, control: 1, relativeRisk: lo + 0.3, ci: [lo, lo + 0.6] });
  const base = { lagMinutes: 3, vehicles: 5000, stats: CANARY_METRICS.map((m) => stat(m, 0.8)), criteria: DEFAULT_ABORT };
  it('신선도 초과는 보류가 먼저 — 다른 값과 무관', () => {
    expect(judgeCanary({ ...base, lagMinutes: 23 }).verdict).toBe('HOLD_STALE');
    expect(judgeCanary({ ...base, lagMinutes: null }).verdict).toBe('HOLD_STALE');
  });
  it('신뢰구간 하한이 경계를 넘을 때만 중단, 표본 부족은 판단 불가', () => {
    expect(judgeCanary(base)).toEqual({ verdict: 'OK', breached: [] });
    expect(judgeCanary({ ...base, stats: [stat('dtc_per_1k', 1.6)] })).toEqual({ verdict: 'ABORT', breached: ['dtc_per_1k'] });
    expect(judgeCanary({ ...base, vehicles: 50 }).verdict).toBe('INSUFFICIENT');
  });
  it('모델 점수는 사용 승인·드리프트 없음일 때만 판단 화면에 쓴다', () => {
    expect(modelUsable({ use: 'APPROVED', drift: false })).toBe(true);
    expect(modelUsable({ use: 'APPROVED', drift: true })).toBe(false);
    expect(modelUsable({ use: 'PENDING', drift: false })).toBe(false);
  });
});

describe('요청 본문', () => {
  it('중단 기준·상태 이동·모델 승인 — 범위 밖 값은 거부', () => {
    expect(AbortCriteriaBody.safeParse({ ...DEFAULT_ABORT, reason: '사전 등록' }).success).toBe(true);
    expect(AbortCriteriaBody.safeParse({ ...DEFAULT_ABORT, confidence: 0.5, reason: '낮음' }).success).toBe(false);
    expect(FindingTransitionBody.safeParse({ to: 'ACTING', note: '조치 연결', action: { kind: 'JIRA', ref: 'FFP-1', title: '결함' } }).success).toBe(true);
    expect(FindingTransitionBody.safeParse({ to: 'DONE', note: '없음' }).success).toBe(false);
    expect(LakeModelDecisionBody.safeParse({ version: '2.1.0', decision: 'APPROVE', reason: '검토함' }).success).toBe(true);
  });
});

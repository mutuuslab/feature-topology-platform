// ADS 변경 규칙 — 변경 종류 분류·영향 경로 표·릴리스 diff 방향·분류 완결성·확대 판정(ADS-BE08·BE16·BE12, ADS-UI09)
import { describe, expect, it } from 'vitest';
import {
  ADS_CHANGE_KINDS,
  CHANGE_KIND_PATHS,
  classificationCompleteness,
  classifyChange,
  diffSummary,
  expansionVerdict,
  factsFromDiff,
  oddAxisDirection,
  openPathCounts,
  parseReleaseId,
  pathItems,
  releaseDiff,
  releaseId,
  requiredPaths,
  type AdsClassification,
  type ReleaseSnapshot,
} from './ads-change';

describe('변경 종류 → 필수 영향 경로 표 (TC02)', () => {
  it('다섯 종류의 필수 경로 집합이 서로 다르다', () => {
    const sets = (['POLICY', 'CONFIG', 'SW', 'MODEL', 'ODD'] as const).map((k) => [...CHANGE_KIND_PATHS[k]].sort().join(','));
    expect(new Set(sets).size).toBe(5);
  });
  it('SW+ODD 동시 변경은 합집합 경로', () => {
    expect(requiredPaths(['SW', 'ODD'])).toEqual(['REHARA', 'R156', 'SUMS', 'SAFETY_CASE']);
    expect(classifyChange({ swChanged: true, oddChanged: true }).paths).toEqual(['REHARA', 'R156', 'SUMS', 'SAFETY_CASE']);
  });
  it('판단 불가는 모든 경로가 필수다(가장 무거운 쪽)', () => {
    expect(CHANGE_KIND_PATHS.UNKNOWN).toEqual(['REHARA', 'R156', 'SUMS', 'SAFETY_CASE']);
    expect(ADS_CHANGE_KINDS).toContain('UNKNOWN');
  });
});

describe('변경 종류 분류 — diff에서 산출', () => {
  it('정보가 없으면 POLICY로 선언돼도 판단 불가 — 정책 변경으로 가볍게 분류하지 않는다', () => {
    const c = classifyChange({}, 'POLICY');
    expect(c.primary).toBe('UNKNOWN');
    expect(c.kinds).toEqual(['UNKNOWN']);
    expect(classifyChange(null).primary).toBe('UNKNOWN');
    expect(classifyChange({ swChanged: null, modelChanged: undefined }).primary).toBe('UNKNOWN');
  });
  it('Flag만 바꿔 ODD를 넓힌 개정이 POLICY로 신고돼도 ODD 경로(재-HARA·R156 영향)로 승격', () => {
    const c = classifyChange({ oddWidened: true, swChanged: false, modelChanged: false, configChanged: false }, 'POLICY');
    expect(c.primary).toBe('ODD');
    expect(c.escalated).toBe(true);
    expect(c.paths).toContain('REHARA');
    expect(c.paths).toContain('R156');
  });
  it('사실이 모두 아님이면 정책만 바뀐 개정', () => {
    const c = classifyChange({ oddWidened: false, oddChanged: false, swChanged: false, modelChanged: false, configChanged: false }, 'POLICY');
    expect(c.primary).toBe('POLICY');
    expect(c.escalated).toBe(false);
    expect(c.paths).toEqual(['SUMS']);
  });
  it('여러 종류는 무거운 순, 선언보다 가벼우면 승격 아님', () => {
    const c = classifyChange({ swChanged: true, configChanged: true }, 'MODEL');
    expect(c.kinds).toEqual(['SW', 'CONFIG']);
    expect(c.escalated).toBe(false);
  });
});

describe('승인 경로 집계', () => {
  const model = classifyChange({ modelChanged: true });
  const row = (cls = model, done: string[] = []) => ({ cls, paths: pathItems(cls, Object.fromEntries(done.map((p) => [p, { status: 'DONE' as const }]))) });
  it('필수 경로는 종결 기록이 없으면 OPEN, 필수 아님은 NOT_REQUIRED', () => {
    const p = pathItems(classifyChange({ configChanged: true }), {});
    expect(p.find((x) => x.path === 'REHARA')!.status).toBe('NOT_REQUIRED');
    expect(p.find((x) => x.path === 'R156')!.status).toBe('OPEN');
    expect(p.find((x) => x.path === 'R156')!.closer).toBe('SECURITY_OFFICER');
    expect(p.find((x) => x.path === 'REHARA')!.closer).toBe('SAFETY_OFFICER');
  });
  it('판단 불가 변경은 경로 수에 섞지 않고 따로 센다', () => {
    const c = openPathCounts([row(model, ['SAFETY_CASE']), row(classifyChange({}))]);
    expect(c).toMatchObject({ REHARA: 1, R156: 1, SUMS: 1, SAFETY_CASE: 0, total: 3, undecidable: 1 });
  });
});

const snap = (o: Partial<ReleaseSnapshot> = {}): ReleaseSnapshot => ({
  featureId: 'FEAT-00004',
  version: '4.0.1',
  targets: ['KR · GN7 · Calligraphy'],
  dependencies: ['FEAT-00084@5.4.2'],
  odd: { speedKmh: { min: 0, max: 130, unit: 'km/h' }, roadType: ['고속도로', '자동차전용도로'], weather: ['맑음', '흐림'] },
  termination: { dc: 'DC2', fallback: '운전자 인계', mrc: '경고 15초 뒤 차로 내 정차' },
  ...o,
});

describe('릴리스 diff 방향 (ADS-UI09)', () => {
  it('축별 확대/축소 — 범위 상한이 오르면 확대, 목록이 줄면 축소, 섞이면 위험 쪽(확대)', () => {
    expect(oddAxisDirection({ min: 0, max: 130, unit: 'km/h' }, { min: 0, max: 150, unit: 'km/h' })).toBe('WIDEN');
    expect(oddAxisDirection({ min: 0, max: 130, unit: 'km/h' }, { min: 10, max: 130, unit: 'km/h' })).toBe('NARROW');
    expect(oddAxisDirection({ min: 0, max: 36, unit: 'm/s' }, { min: 0, max: 130, unit: 'km/h' })).toBe('CHANGED');
    expect(oddAxisDirection(['a', 'b'], ['a'])).toBe('NARROW');
    expect(oddAxisDirection(['a'], ['b'])).toBe('WIDEN');
    expect(oddAxisDirection(false, true)).toBe('WIDEN');
    expect(oddAxisDirection(['a'], ['a'])).toBe('SAME');
  });
  it('ODD 확대와 종료 동작 변경이 있는 두 릴리스 — 확대 행이 맨 앞, 종료 동작 변경 요약', () => {
    const after = snap({ version: '4.1.0', dependencies: ['FEAT-00084@5.5.0'], odd: { ...snap().odd, speedKmh: { min: 0, max: 150, unit: 'km/h' }, roadType: ['고속도로'] }, termination: { dc: 'DC2', fallback: '운전자 인계', mrc: '경고 10초 뒤 차로 내 정차' } });
    const rows = releaseDiff(snap(), after);
    expect(rows[0]).toMatchObject({ group: 'ODD', field: 'odd.speedKmh', direction: 'WIDEN' });
    expect(rows.find((r) => r.field === 'mrc')!.direction).toBe('CHANGED');
    expect(rows.find((r) => r.field === 'odd.roadType')!.direction).toBe('NARROW');
    expect(rows.at(-1)!.direction).toBe('SAME');
    const s = diffSummary(rows);
    expect(s).toMatchObject({ widened: 1, narrowed: 1, termination: { dc: 0, fallback: 0, mrc: 1 } });
    expect(factsFromDiff(rows)).toMatchObject({ oddWidened: true, oddChanged: true, modelChanged: null });
    expect(classifyChange(factsFromDiff(rows, { swChanged: true })).primary).toBe('ODD');
  });
  it('릴리스 ID는 Feature Version 쌍의 뒤쪽 Version', () => {
    expect(releaseId('FEAT-00004', '4.1.0')).toBe('FEAT-00004-4.1.0');
    expect(parseReleaseId('FEAT-00004-4.1.0')).toEqual({ featureId: 'FEAT-00004', version: '4.1.0' });
    expect(parseReleaseId('FEAT-4-4.1')).toBeNull();
  });
});

describe('분류 완결성 (ADS-BE16) — 확정 여부만 본다', () => {
  const full: AdsClassification = {
    featureId: 'FEAT-00004', version: '4.1.0', adsFeature: false, ddtImpact: 'SUPPORT', safetyRelated: true, owner: 'ADAS기획팀',
    source: 'MANUAL', status: 'CONFIRMED', confirmedBy: 'usr-safety', confirmedAt: null,
    lifecycleOwners: { CREATE: 'a', OPERATE: 'b', SUSPEND: 'c', DISPOSE: 'd' },
  };
  it('네 축·상태별 책임자·확정이 모두 있으면 분류됨', () => {
    expect(classificationCompleteness(full)).toEqual({ classified: true, gaps: [], inferred: false });
  });
  it('행이 없으면 모든 축이 빈칸 — ADS 아님으로 보지 않는다', () => {
    const c = classificationCompleteness(null);
    expect(c.classified).toBe(false);
    expect(c.gaps).toEqual(['ADS', 'DDT', 'SAFETY', 'OWNER', 'LIFECYCLE_OWNER', 'CONFIRM']);
  });
  it('추정(INFERRED) 초안은 값이 다 있어도 확정 전이므로 미분류', () => {
    const c = classificationCompleteness({ ...full, source: 'INFERRED', status: 'DRAFT' });
    expect(c).toEqual({ classified: false, gaps: ['CONFIRM'], inferred: true });
  });
  it('INFERRED 초안을 확정하면 분류됨 — 출처는 판정에 쓰지 않는다', () => {
    expect(classificationCompleteness({ ...full, source: 'INFERRED' }).classified).toBe(true);
  });
  it('ddtImpact만 빈 Feature는 미분류(DDT 빈칸)', () => {
    expect(classificationCompleteness({ ...full, ddtImpact: null }).gaps).toEqual(['DDT']);
  });
  it('상태별 책임자가 하나라도 없으면 미분류', () => {
    expect(classificationCompleteness({ ...full, lifecycleOwners: { CREATE: 'a', OPERATE: 'b', SUSPEND: null } }).gaps).toEqual(['LIFECYCLE_OWNER']);
  });
});

describe('확대 판정 (ADS-BE12)', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const metric = (o = {}) => ({ key: 'takeover', observedAt: new Date(now - 10 * 60_000).toISOString(), staleAfterMs: 30 * 60_000, value: 0.1, threshold: 0.5, breached: false, ...o });
  const combo = (o = {}) => ({ comboId: 'A', vehicleActive: 60, usageConfirmed: 40, errors: 0, samples: 500, minSamples: 200, windowHours: 72, alert: false, ...o });
  it('정상이면 확대 가능', () => {
    expect(expansionVerdict({ frozen: null, metrics: [metric()], combos: [combo()], now }).verdict).toBe('EXPAND');
  });
  it('지표가 기준 시간을 넘기면 확대 보류(지표 지연) — 확대 가능을 내지 않는다', () => {
    const r = expansionVerdict({ frozen: null, metrics: [metric({ observedAt: new Date(now - 2 * 3600_000).toISOString() })], combos: [combo()], now });
    expect(r).toMatchObject({ verdict: 'HOLD', reason: 'METRIC_DELAY', staleMetrics: ['takeover'] });
    expect(expansionVerdict({ frozen: null, metrics: [metric({ observedAt: null })], combos: [combo()], now }).reason).toBe('METRIC_DELAY');
  });
  it('조합 A 경보면 A만 경보, B 판정은 독립 — 전체는 중단', () => {
    const r = expansionVerdict({ frozen: null, metrics: [metric()], combos: [combo({ alert: true }), combo({ comboId: 'B' })], now });
    expect(r.verdict).toBe('STOP');
    expect(r.combos).toEqual([{ comboId: 'A', verdict: 'ALERT' }, { comboId: 'B', verdict: 'OK' }]);
  });
  it('표본 하한 미달 조합은 확대 가능에 들지 않는다', () => {
    const r = expansionVerdict({ frozen: null, metrics: [metric()], combos: [combo({ samples: 50 })], now });
    expect(r).toMatchObject({ verdict: 'HOLD', reason: 'INSUFFICIENT' });
  });
  it('동결이 가장 먼저', () => {
    expect(expansionVerdict({ frozen: { reason: 'r', scope: 's', by: 'u', at: 'x' }, metrics: [metric({ breached: true })], combos: [combo()], now }).verdict).toBe('FROZEN');
  });
});

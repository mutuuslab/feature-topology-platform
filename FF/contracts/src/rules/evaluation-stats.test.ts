// Feature별 평가 운영 데이터(B5) — 결과 분류·경로·앱 식별·집계.
import { describe, expect, it } from 'vitest';
import { appIdentity, evalResultOf, evalSourceOf, summarizeEvaluations, type EvalCountRow } from './evaluation-stats';

describe('평가 결과·경로 분류', () => {
  it('오류 → ERROR, safe_default → SAFE_DEFAULT, on/off는 분기값, 분기값이 없으면 값으로', () => {
    expect(evalResultOf({ variant: 'on', errorType: 'flag_not_found' })).toBe('ERROR');
    expect(evalResultOf({ variant: 'safe_default' })).toBe('SAFE_DEFAULT');
    expect(evalResultOf({ variant: 'ON' })).toBe('ON');
    expect(evalResultOf({ variant: 'off' })).toBe('OFF');
    expect(evalResultOf({ value: true })).toBe('ON');
    expect(evalResultOf({})).toBe('OFF');
  });
  it('provider 이름 → 경로', () => {
    expect(evalSourceOf('ffp-ofrep')).toBe('OFREP');
    expect(evalSourceOf('unleash-edge')).toBe('UNLEASH_EDGE');
    expect(evalSourceOf('ffp-platform')).toBe('PLATFORM');
    expect(evalSourceOf('ffp-vehicle-bundle')).toBe('VEHICLE_SDK');
  });
  it('앱 식별 — 보내지 않거나 형식이 틀리면 기본 이름', () => {
    expect(appIdentity({ appName: 'ivi-app', environment: 'production' }, { appName: 'x', environment: 'y' })).toEqual({ appName: 'ivi-app', environment: 'production' });
    expect(appIdentity({ appName: 'a b<script>', environment: 3 }, { appName: 'ofrep-client', environment: 'default' })).toEqual({ appName: 'ofrep-client', environment: 'default' });
  });
});

describe('집계 — 평가·활성·비활성·분기값 횟수(FR-OPD-001-005~008, FR-OPD-003-001)', () => {
  const row = (p: Partial<EvalCountRow>): EvalCountRow => ({ day: '2026-11-05', flagKey: 'care_00022_param', source: 'OFREP', appName: 'ivi-app', environment: 'production', result: 'ON', variant: 'on', count: 1, ...p });
  const s = summarizeEvaluations('FEAT-00022', ['care_00022_param', 'care_00022_alert'], [
    row({ count: 30 }),
    row({ result: 'OFF', variant: 'off', count: 10 }),
    row({ day: '2026-11-06', source: 'VEHICLE_SDK', appName: 'vehicle-sdk', environment: 'fleet', result: 'SAFE_DEFAULT', variant: 'safe_default', count: 5 }),
    row({ day: '2026-11-06', flagKey: 'care_00022_alert', result: 'ERROR', variant: '', count: 2 }),
  ], '2026-10-24', '2026-11-06', 14);
  it('합계와 분기값 단위', () => {
    expect(s.totals).toEqual({ evaluations: 47, on: 30, off: 10, safeDefault: 5, errors: 2 });
    expect(s.byVariant).toEqual([{ variant: 'on', count: 30 }, { variant: 'off', count: 10 }, { variant: 'safe_default', count: 5 }]);
  });
  it('경로·앱·flag·일별', () => {
    expect(s.bySource.map((x) => [x.source, x.count])).toEqual([['OFREP', 42], ['VEHICLE_SDK', 5]]);
    expect(s.byApp[0]).toEqual({ appName: 'ivi-app', environment: 'production', source: 'OFREP', count: 42, lastDay: '2026-11-06' });
    expect(s.byFlag.map((f) => f.flagKey)).toEqual(['care_00022_alert', 'care_00022_param']);
    // 일별·경로별의 off도 합계와 같은 뜻(비활성만) — Safe Default·오류는 따로 센다(같은 이름이 화면마다 다른 수가 되지 않게)
    expect(s.daily).toEqual([{ day: '2026-11-05', count: 40, on: 30, off: 10, safeDefault: 0, errors: 0 }, { day: '2026-11-06', count: 7, on: 0, off: 0, safeDefault: 5, errors: 2 }]);
    expect(s.bySource).toEqual([{ source: 'OFREP', count: 42, on: 30, off: 10, safeDefault: 0, errors: 2 }, { source: 'VEHICLE_SDK', count: 5, on: 0, off: 0, safeDefault: 5, errors: 0 }]);
    for (const k of ['on', 'off', 'safeDefault', 'errors'] as const) expect(s.daily.reduce((n, d) => n + d[k], 0)).toBe(s.totals[k]);
    expect(s.period).toEqual({ from: '2026-10-24', to: '2026-11-06', days: 14, unit: 'DAY' });
  });
});

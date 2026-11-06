// Feature별 평가 운영 데이터(기능명세서 B5, D04-03) — 평가마다 남는 span(feature_flag.evaluation)을 일 단위로 센다.
// 집계 키: 날짜(UTC) · flag · 평가 경로(앱 OFREP·차량 SDK·Unleash Edge·서버 판단) · 애플리케이션(appName) · 환경 · 결과 · 분기값.
// 원본 식별자(VIN·사용자)는 집계에 넣지 않는다(FFG-OFT-003/004 — span에도 가명 subject만).

export const EVAL_SOURCES = ['OFREP', 'VEHICLE_SDK', 'UNLEASH_EDGE', 'PLATFORM'] as const;
export type EvalSource = (typeof EVAL_SOURCES)[number];
export const EVAL_SOURCE_LABEL: Record<EvalSource, string> = {
  OFREP: '앱 평가 API(OFREP)',
  VEHICLE_SDK: '차량 SDK',
  UNLEASH_EDGE: 'Unleash Edge',
  PLATFORM: '플랫폼 판단',
};

export const EVAL_RESULTS = ['ON', 'OFF', 'SAFE_DEFAULT', 'ERROR'] as const;
export type EvalResult = (typeof EVAL_RESULTS)[number];
export const EVAL_RESULT_LABEL: Record<EvalResult, string> = { ON: '활성', OFF: '비활성', SAFE_DEFAULT: 'Safe Default', ERROR: '오류(기본값)' };

/** 집계 주기 — 일(UTC). 화면 기본 창 */
export const EVAL_PERIOD = 'DAY' as const;
export const EVAL_DEFAULT_DAYS = 14;
export const EVAL_MAX_DAYS = 90;

/** OpenFeature provider 이름 → 평가 경로 */
export function evalSourceOf(provider: string): EvalSource {
  const p = provider.toLowerCase();
  if (p.includes('ofrep')) return 'OFREP';
  if (p.includes('edge') || p.includes('unleash')) return 'UNLEASH_EDGE';
  if (p.includes('platform') || p.includes('server')) return 'PLATFORM';
  return 'VEHICLE_SDK';
}

/** 평가 결과 분류 — 오류면 ERROR, safe_default면 SAFE_DEFAULT, 그 밖은 분기값 on/off(차량 flag는 boolean 전용, FP-VEHICLE-BOOL-1) */
export function evalResultOf(e: { variant?: string | null; errorType?: string | null; value?: unknown }): EvalResult {
  if (e.errorType) return 'ERROR';
  const v = (e.variant ?? '').toLowerCase();
  if (v === 'safe_default') return 'SAFE_DEFAULT';
  if (v === 'on') return 'ON';
  if (v === 'off') return 'OFF';
  return e.value === true ? 'ON' : 'OFF';
}

/** 집계 한 칸(일 · flag · 경로 · 앱 · 환경 · 결과 · 분기값) */
export interface EvalCountRow {
  day: string;
  flagKey: string;
  source: EvalSource;
  appName: string;
  environment: string;
  result: EvalResult;
  variant: string;
  count: number;
}

/** Feature 평가 운영 데이터 응답 */
export interface FeatureEvaluationStats {
  featureId: string;
  period: { from: string; to: string; days: number; unit: typeof EVAL_PERIOD };
  flagKeys: string[];
  totals: { evaluations: number; on: number; off: number; safeDefault: number; errors: number };
  byVariant: { variant: string; count: number }[];
  bySource: { source: EvalSource; count: number; on: number; off: number }[];
  byApp: { appName: string; environment: string; source: EvalSource; count: number; lastDay: string }[];
  byFlag: { flagKey: string; count: number; on: number; off: number; safeDefault: number; errors: number }[];
  daily: { day: string; count: number; on: number; off: number }[];
}

/** 집계 칸 → 응답(순수 함수 — 백엔드가 쓰고 시험이 같은 값을 본다) */
export function summarizeEvaluations(featureId: string, flagKeys: string[], rows: EvalCountRow[], from: string, to: string, days: number): FeatureEvaluationStats {
  const totals = { evaluations: 0, on: 0, off: 0, safeDefault: 0, errors: 0 };
  const variants = new Map<string, number>();
  const sources = new Map<EvalSource, { count: number; on: number; off: number }>();
  const apps = new Map<string, { appName: string; environment: string; source: EvalSource; count: number; lastDay: string }>();
  const flags = new Map<string, { count: number; on: number; off: number; safeDefault: number; errors: number }>();
  const daily = new Map<string, { count: number; on: number; off: number }>();
  for (const r of rows) {
    const n = r.count;
    totals.evaluations += n;
    if (r.result === 'ON') totals.on += n;
    else if (r.result === 'OFF') totals.off += n;
    else if (r.result === 'SAFE_DEFAULT') totals.safeDefault += n;
    else totals.errors += n;
    if (r.variant) variants.set(r.variant, (variants.get(r.variant) ?? 0) + n);
    const s = sources.get(r.source) ?? { count: 0, on: 0, off: 0 };
    s.count += n;
    if (r.result === 'ON') s.on += n;
    else s.off += n;
    sources.set(r.source, s);
    const ak = `${r.appName}|${r.environment}|${r.source}`;
    const a = apps.get(ak) ?? { appName: r.appName, environment: r.environment, source: r.source, count: 0, lastDay: r.day };
    a.count += n;
    if (r.day > a.lastDay) a.lastDay = r.day;
    apps.set(ak, a);
    const f = flags.get(r.flagKey) ?? { count: 0, on: 0, off: 0, safeDefault: 0, errors: 0 };
    f.count += n;
    if (r.result === 'ON') f.on += n;
    else if (r.result === 'OFF') f.off += n;
    else if (r.result === 'SAFE_DEFAULT') f.safeDefault += n;
    else f.errors += n;
    flags.set(r.flagKey, f);
    const d = daily.get(r.day) ?? { count: 0, on: 0, off: 0 };
    d.count += n;
    if (r.result === 'ON') d.on += n;
    else d.off += n;
    daily.set(r.day, d);
  }
  return {
    featureId,
    period: { from, to, days, unit: EVAL_PERIOD },
    flagKeys,
    totals,
    byVariant: [...variants].map(([variant, count]) => ({ variant, count })).sort((a, b) => b.count - a.count || a.variant.localeCompare(b.variant)),
    bySource: [...sources].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.count - a.count),
    byApp: [...apps.values()].sort((a, b) => b.count - a.count || a.appName.localeCompare(b.appName)),
    byFlag: [...flags].map(([flagKey, v]) => ({ flagKey, ...v })).sort((a, b) => a.flagKey.localeCompare(b.flagKey)),
    daily: [...daily].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** 애플리케이션 식별 — 보내지 않으면 경로별 기본 이름. 길이·문자 제한(집계 키가 되므로) */
export function appIdentity(raw: { appName?: unknown; environment?: unknown }, fallback: { appName: string; environment: string }): { appName: string; environment: string } {
  const clean = (v: unknown, d: string) => (typeof v === 'string' && /^[A-Za-z0-9._:\-/]{1,64}$/.test(v.trim()) ? v.trim() : d);
  return { appName: clean(raw.appName, fallback.appName), environment: clean(raw.environment, fallback.environment) };
}

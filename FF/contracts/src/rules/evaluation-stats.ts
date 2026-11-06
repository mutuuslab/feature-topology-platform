// Flag 평가 집계(기능명세서 B5, D04-03) — 평가마다 남는 span(feature_flag.evaluation)·Unleash Edge 평가·차량 보고를 한 저장소에 센다(통합 D-INT-2).
// 저장 칸: 시(UTC) · flag · 평가 경로(앱 OFREP·차량 SDK·Unleash Edge·서버 판단) · 애플리케이션(appName) · 환경 · 결과 · 분기값 · 폴백 사유.
// 읽는 화면 둘 — Feature 상세 '평가 운영'(일 단위로 묶음)·Flag 평가 모니터링(1h·24h·7d 창, 시 단위 시계열).
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

/**
 * 폴백(Safe Default) 사유 — 차량 SDK 회신(IF-06) 사유. 모르는 사유는 기타(UNSPECIFIED)로 센다(횟수를 버리지 않는다).
 * 차량 보고(IF-06 요약)는 경로가 아니라 전달 방식이다 — 차량 SDK 평가(VEHICLE_SDK)로 센다. 같은 평가를 span과 요약으로 두 번 보내지 않는다.
 */
export const EVAL_FALLBACK_REASONS = ['DEFAULT_NO_SNAPSHOT', 'TTL_EXPIRED', 'SIGNATURE_INVALID', 'LOCAL_GUARD_BLOCK', 'OTHER_VIN', 'PROVIDER_ERROR', 'UNSPECIFIED'] as const;
export type EvalFallbackReason = (typeof EVAL_FALLBACK_REASONS)[number];
/** OpenFeature 사유 → 폴백 사유(span에는 차량 사유 대신 OpenFeature 사유가 실린다) */
const OPENFEATURE_FALLBACK: Record<string, EvalFallbackReason> = { STALE: 'TTL_EXPIRED', DISABLED: 'LOCAL_GUARD_BLOCK', ERROR: 'PROVIDER_ERROR', DEFAULT: 'DEFAULT_NO_SNAPSHOT' };

/** 결과의 폴백 사유 — Safe Default만 사유를 갖는다(그 밖은 빈 값) */
export function fallbackReasonOf(result: EvalResult, reason: string | null | undefined): EvalFallbackReason | '' {
  if (result !== 'SAFE_DEFAULT') return '';
  const r = String(reason ?? '').toUpperCase();
  return (EVAL_FALLBACK_REASONS as readonly string[]).includes(r) ? (r as EvalFallbackReason) : OPENFEATURE_FALLBACK[r] ?? 'UNSPECIFIED';
}

/** 저장 칸 길이 — 1시간. Flag 평가 모니터링 1h 창이 한 칸 */
export const EVAL_BUCKET_MS = 3_600_000;
/** 시각 → 칸 시작(UTC 정시, ISO) */
export const evalHourOf = (at: string): string => new Date(Math.floor(Date.parse(at) / EVAL_BUCKET_MS) * EVAL_BUCKET_MS).toISOString();

/** Feature 평가 운영 응답 주기 — 일(UTC, 시 칸을 묶는다). 화면 기본 창 */
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

/** 결과별 횟수 — 합계·경로별·flag별·일별이 같은 뜻으로 센다 */
export interface EvalTally {
  on: number;
  off: number;
  safeDefault: number;
  errors: number;
}

/** Feature 평가 운영 데이터 응답 */
export interface FeatureEvaluationStats {
  featureId: string;
  period: { from: string; to: string; days: number; unit: typeof EVAL_PERIOD };
  flagKeys: string[];
  totals: { evaluations: number; on: number; off: number; safeDefault: number; errors: number };
  byVariant: { variant: string; count: number }[];
  /** 결과 칸(on·off·safeDefault·errors)은 totals와 같은 뜻 — off는 비활성만 */
  bySource: ({ source: EvalSource; count: number } & EvalTally)[];
  byApp: { appName: string; environment: string; source: EvalSource; count: number; lastDay: string }[];
  byFlag: { flagKey: string; count: number; on: number; off: number; safeDefault: number; errors: number }[];
  daily: ({ day: string; count: number } & EvalTally)[];
}

const tally = (): EvalTally => ({ on: 0, off: 0, safeDefault: 0, errors: 0 });
const add = (t: EvalTally, r: EvalResult, n: number) => {
  if (r === 'ON') t.on += n;
  else if (r === 'OFF') t.off += n;
  else if (r === 'SAFE_DEFAULT') t.safeDefault += n;
  else t.errors += n;
};

/** 집계 칸 → 응답(순수 함수 — 백엔드가 쓰고 시험이 같은 값을 본다) */
export function summarizeEvaluations(featureId: string, flagKeys: string[], rows: EvalCountRow[], from: string, to: string, days: number): FeatureEvaluationStats {
  const totals = { evaluations: 0, on: 0, off: 0, safeDefault: 0, errors: 0 };
  const variants = new Map<string, number>();
  const sources = new Map<EvalSource, { count: number } & EvalTally>();
  const apps = new Map<string, { appName: string; environment: string; source: EvalSource; count: number; lastDay: string }>();
  const flags = new Map<string, { count: number; on: number; off: number; safeDefault: number; errors: number }>();
  const daily = new Map<string, { count: number } & EvalTally>();
  for (const r of rows) {
    const n = r.count;
    totals.evaluations += n;
    if (r.result === 'ON') totals.on += n;
    else if (r.result === 'OFF') totals.off += n;
    else if (r.result === 'SAFE_DEFAULT') totals.safeDefault += n;
    else totals.errors += n;
    if (r.variant) variants.set(r.variant, (variants.get(r.variant) ?? 0) + n);
    const s = sources.get(r.source) ?? { count: 0, ...tally() };
    s.count += n;
    add(s, r.result, n);
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
    const d = daily.get(r.day) ?? { count: 0, ...tally() };
    d.count += n;
    add(d, r.result, n);
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

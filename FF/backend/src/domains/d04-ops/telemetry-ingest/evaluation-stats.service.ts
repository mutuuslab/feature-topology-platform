// Flag 평가 집계 한 저장소 (D04-03 운영 데이터 수집, 기능명세서 B5 · 통합 D-INT-2) — 평가마다 남는 span(feature_flag.evaluation, IF-11)·
// Unleash Edge 평가·Flag 코드 시연 픽스처가 모두 countEvaluations 하나로 flag_eval_hourly(102)에 쌓인다.
// 읽는 화면 둘: Feature 상세 '평가 운영'(feature — 시 칸을 일로 묶음)·Flag 평가 모니터링(flags·series — 1h·24h·7d 창).
// Grafana 지표 ff_flag_evaluations_total은 같은 span을 지표로 내보낼 뿐, 따로 센 집계가 아니다. span은 보존 기간(30일) 뒤 지워져도 집계는 남는다.
// 집계에는 가명 subject도 넣지 않는다 — 횟수만(FFG-OFT-003/004). 고유 차량 수는 한 번에 받은 묶음 안에서만 세고 가명은 버린다.
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import {
  appIdentity, EVAL_BUCKET_MS, EVAL_DEFAULT_DAYS, EVAL_MAX_DAYS, evalHourOf, evalResultOf, evalSourceOf, fallbackReasonOf, summarizeEvaluations,
  type EvalCountRow, type EvalFallbackReason, type EvalResult, type EvalSource, type FeatureEvaluationStats, type FlagEvaluationSeries, type FlagEvaluationStat,
  type FlagEvaluationsResponse, type OtelSpan,
} from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { singleQuery } from '../../../kernel/paging';

export interface EvaluationSample {
  at: string;
  flagKey: string;
  source: EvalSource;
  appName: string;
  environment: string;
  result: EvalResult;
  variant: string;
  /** 폴백 사유(차량 사유 또는 OpenFeature 사유) — Safe Default가 아니면 쓰지 않는다 */
  reason?: string | null;
  count?: number;
  /** 가명 차량 식별 — 묶음 안 고유 차량 수에만 쓰고 저장하지 않는다 */
  subject?: string | null;
}

/** 시 칸 한 줄(flag_eval_hourly) */
export interface EvalCell {
  hour: string;
  flagKey: string;
  source: EvalSource;
  appName: string;
  environment: string;
  result: EvalResult;
  variant: string;
  reason: EvalFallbackReason | '';
  n: number;
}

/** 경로별 기본 앱 이름·환경 — 평가 요청이 보내지 않으면 */
export const DEFAULT_APP: Record<EvalSource, { appName: string; environment: string }> = {
  OFREP: { appName: 'ofrep-client', environment: 'default' },
  VEHICLE_SDK: { appName: 'vehicle-sdk', environment: 'fleet' },
  UNLEASH_EDGE: { appName: 'vehicle-unleash', environment: 'production' },
  PLATFORM: { appName: 'ffp-platform', environment: 'default' },
};

/** Flag 평가 모니터링 창 */
export type EvalWindow = '1h' | '24h' | '7d';
const DAY = 86_400_000;
export const EVAL_WINDOW_MS: Record<EvalWindow, number> = { '1h': 3_600_000, '24h': DAY, '7d': 7 * DAY };
/** 창과 겹치는 칸(끝이 창 시작 뒤)을 모두 넣는다 — 시작 시각만 보면 정시가 아닐 때 1h 창이 비었다 */
const windowFrom = (now: number, w: EvalWindow) => new Date(now - EVAL_WINDOW_MS[w] - EVAL_BUCKET_MS + 1).toISOString();

/** 평가 span → 집계 표본(평가 span이 아니면 건너뛴다) */
export function samplesOfSpans(spans: OtelSpan[]): EvaluationSample[] {
  const out: EvaluationSample[] = [];
  for (const s of spans) {
    if (s.name !== 'feature_flag.evaluation') continue;
    const a = s.attributes ?? {};
    const flagKey = String(a['feature_flag.key'] ?? '');
    if (!flagKey) continue;
    const source = evalSourceOf(String(a['feature_flag.provider.name'] ?? ''));
    const variant = a['feature_flag.result.variant'] == null ? '' : String(a['feature_flag.result.variant']);
    const app = appIdentity({ appName: a['ffp.app.name'], environment: a['deployment.environment.name'] }, DEFAULT_APP[source]);
    const subject = a['feature_flag.context.id'] == null || a['feature_flag.context.id'] === 'unknown' ? null : String(a['feature_flag.context.id']);
    const reason = a['feature_flag.result.reason'] == null ? null : String(a['feature_flag.result.reason']);
    out.push({ at: s.startTime, flagKey, source, ...app, result: evalResultOf({ variant, errorType: a['error.type'] == null ? null : String(a['error.type']) }), variant, reason, subject });
  }
  return out;
}

/**
 * 고유 차량 수 기록 — 더할 수 없는 값이라 칸(시 · flag · 경로)마다 관측한 최댓값만 남긴다. 창 값도 칸 최댓값(하한)이다.
 * 원천: 수집기(받은 묶음 안 가명 고유 수) · 차량 보고·시연 픽스처(보고한 고유 수)
 */
export function recordReach(db: Db, rows: { hour: string; flagKey: string; source: EvalSource; vehicles: number }[]) {
  for (const r of rows)
    if (r.vehicles > 0)
      db.run(
        'INSERT INTO flag_eval_reach (hour, flag_key, source, vehicles) VALUES (?, ?, ?, ?) ON CONFLICT (hour, flag_key, source) DO UPDATE SET vehicles = excluded.vehicles WHERE excluded.vehicles > flag_eval_reach.vehicles',
        r.hour,
        r.flagKey,
        r.source,
        r.vehicles,
      );
}

/** flag별 마지막 평가 시각 — 늦은 값만 남긴다(Flag 코드 대사의 오래된 Flag 판정이 읽는다) */
export function noteLastEvaluated(db: Db, flagKey: string, at: string) {
  db.run('INSERT INTO flag_eval_last (flag_key, last_at) VALUES (?, ?) ON CONFLICT (flag_key) DO UPDATE SET last_at = excluded.last_at WHERE excluded.last_at > flag_eval_last.last_at', flagKey, at);
}

/**
 * 표본을 시 칸에 더한다 — 평가 집계의 유일한 쓰기. 같은 칸은 한 번의 갱신으로, 호출자의 트랜잭션이 있으면 그 안에서.
 * 시각을 읽을 수 없거나 횟수가 0인 표본은 건너뛴다(관측이 평가를 막지 않는다).
 * @req FR-OPD-001-005, FR-OPD-001-006, FR-OPD-001-007, FR-OPD-001-008, FR-OPD-002-001
 */
export function countEvaluations(db: Db, samples: EvaluationSample[]): number {
  if (!samples.length) return 0;
  const cells = new Map<string, EvalCell>();
  const reach = new Map<string, { hour: string; flagKey: string; source: EvalSource; subjects: Set<string> }>();
  const last = new Map<string, string>();
  for (const s of samples) {
    const t = Date.parse(s.at);
    const n = s.count ?? 1;
    if (!Number.isFinite(t) || n <= 0) continue;
    const hour = evalHourOf(s.at);
    const reason = fallbackReasonOf(s.result, s.reason);
    const k = [hour, s.flagKey, s.source, s.appName, s.environment, s.result, s.variant, reason].join('\u0000');
    const c = cells.get(k) ?? { hour, flagKey: s.flagKey, source: s.source, appName: s.appName, environment: s.environment, result: s.result, variant: s.variant, reason, n: 0 };
    c.n += n;
    cells.set(k, c);
    if (s.subject) {
      const rk = [hour, s.flagKey, s.source].join('\u0000');
      const r = reach.get(rk) ?? { hour, flagKey: s.flagKey, source: s.source, subjects: new Set<string>() };
      r.subjects.add(s.subject);
      reach.set(rk, r);
    }
    const at = new Date(t).toISOString();
    if ((last.get(s.flagKey) ?? '') < at) last.set(s.flagKey, at);
  }
  for (const c of cells.values())
    db.run(
      'INSERT INTO flag_eval_hourly (hour, flag_key, source, app_name, environment, result, variant, reason, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hour, flag_key, source, app_name, environment, result, variant, reason) DO UPDATE SET n = flag_eval_hourly.n + excluded.n',
      c.hour,
      c.flagKey,
      c.source,
      c.appName,
      c.environment,
      c.result,
      c.variant,
      c.reason,
      c.n,
    );
  recordReach(db, [...reach.values()].map((r) => ({ hour: r.hour, flagKey: r.flagKey, source: r.source, vehicles: r.subjects.size })));
  for (const [flagKey, at] of last) noteLastEvaluated(db, flagKey, at);
  return samples.length;
}

/** flag별 마지막 평가 시각 */
export function lastEvaluatedAt(db: Db): Map<string, string> {
  return new Map(db.all<{ flag_key: string; last_at: string }>('SELECT flag_key, last_at FROM flag_eval_last').map((r) => [r.flag_key, r.last_at]));
}

/** [from, to) 시각 · flag 목록 조건 */
function rangeWhere(q: { from: string; to: string; flagKeys?: string[] }) {
  const where = ['hour >= ?', 'hour < ?'];
  const params: string[] = [q.from, q.to];
  if (q.flagKeys) (where.push(`flag_key IN (${q.flagKeys.map(() => '?').join(',')})`), params.push(...q.flagKeys));
  return { where, params };
}

/** 칸 읽기 — [from, to) 시각, flag 목록·경로로 좁힌다 */
export function readCells(db: Db, q: { from: string; to: string; flagKeys?: string[]; source?: string }): EvalCell[] {
  if (q.flagKeys && !q.flagKeys.length) return [];
  const { where, params } = rangeWhere(q);
  if (q.source) (where.push('source = ?'), params.push(q.source));
  return db
    .all<{ hour: string; flag_key: string; source: EvalSource; app_name: string; environment: string; result: EvalResult; variant: string; reason: EvalFallbackReason | ''; n: number }>(
      `SELECT hour, flag_key, source, app_name, environment, result, variant, reason, n FROM flag_eval_hourly WHERE ${where.join(' AND ')} ORDER BY hour, flag_key, source`,
      ...params,
    )
    .map((r) => ({ hour: r.hour, flagKey: r.flag_key, source: r.source, appName: r.app_name, environment: r.environment, result: r.result, variant: r.variant, reason: r.reason, n: Number(r.n) }));
}

/** 창 안 고유 차량 수 — flag·경로별 칸 최댓값(하한, 칸끼리 더하지 않는다) */
function reachOf(db: Db, q: { from: string; to: string; flagKeys?: string[] }): Map<string, number> {
  if (q.flagKeys && !q.flagKeys.length) return new Map();
  const { where, params } = rangeWhere(q);
  const rows = db.all<{ flag_key: string; source: string; v: number }>(`SELECT flag_key, source, max(vehicles) AS v FROM flag_eval_reach WHERE ${where.join(' AND ')} GROUP BY flag_key, source`, ...params);
  return new Map(rows.map((r) => [`${r.flag_key}\u0000${r.source}`, Number(r.v)]));
}

/**
 * 칸 → Flag×경로 한 줄(Flag 평가 모니터링). 켜짐 = ON, 꺼짐 = OFF + Safe Default(차량은 꺼진 값으로 동작), 폴백 = Safe Default의 사유별, 오류 = ERROR.
 * 마지막 평가는 창 안 마지막 칸 시작, 창 안에 없으면 flag 마지막 평가 시각
 */
export function flagStats(cells: EvalCell[], window: EvalWindow, reach: Map<string, number>, last: Map<string, string>): FlagEvaluationStat[] {
  const by = new Map<string, FlagEvaluationStat & { _fb: Map<string, number>; _var: Map<string, number> }>();
  for (const c of cells) {
    const k = `${c.flagKey}\u0000${c.source}`;
    let s = by.get(k);
    if (!s) by.set(k, (s = { flagKey: c.flagKey, window, source: c.source, evaluations: 0, enabled: 0, disabled: 0, variants: [], fallbacks: [], errors: 0, vehicles: reach.get(k) ?? 0, lastEvaluatedAt: null, _fb: new Map(), _var: new Map() }));
    s.evaluations += c.n;
    if (c.result === 'ON') s.enabled += c.n;
    else if (c.result === 'ERROR') s.errors += c.n;
    else s.disabled += c.n;
    if (c.result === 'SAFE_DEFAULT') s._fb.set(c.reason || 'UNSPECIFIED', (s._fb.get(c.reason || 'UNSPECIFIED') ?? 0) + c.n);
    if (c.variant) s._var.set(c.variant, (s._var.get(c.variant) ?? 0) + c.n);
    if (!s.lastEvaluatedAt || c.hour > s.lastEvaluatedAt) s.lastEvaluatedAt = c.hour;
  }
  return [...by.values()].map(({ _fb, _var, ...s }) => ({
    ...s,
    lastEvaluatedAt: s.lastEvaluatedAt ? new Date(s.lastEvaluatedAt).toISOString() : last.get(s.flagKey) ? new Date(last.get(s.flagKey)!).toISOString() : null,
    fallbacks: [..._fb].map(([reason, count]) => ({ reason: reason as EvalFallbackReason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    variants: [..._var].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));
}

const windowOf = (raw?: string): EvalWindow => {
  const w = (raw ?? '24h') as EvalWindow;
  if (!(Object.keys(EVAL_WINDOW_MS) as string[]).includes(w)) throw new DomainError('VALIDATION', 'window는 1h·24h·7d 중 하나입니다.');
  return w;
};

@Injectable()
@PlatformComponent('D04-03')
export class EvaluationStatsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 표본 기록 — 서버 안 평가 경로(Unleash Edge 평가 등)가 부른다 */
  record(samples: EvaluationSample[]): number {
    return countEvaluations(this.db, samples);
  }

  /**
   * Feature 기준 평가 운영 데이터 — 이 Feature의 모든 정책 flag(개정·대체 포함)를 최근 days일 동안(시 칸을 일로 묶는다).
   * @req FR-OPD-003-001
   */
  feature(featureId: string, days = EVAL_DEFAULT_DAYS): FeatureEvaluationStats {
    const known = this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ? LIMIT 1', featureId);
    if (!known) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const flagKeys = this.db.all<{ flag_key: string }>('SELECT DISTINCT flag_key FROM policy WHERE feature_id = ? ORDER BY flag_key', featureId).map((r) => r.flag_key);
    const end = new Date(`${this.clock.iso().slice(0, 10)}T00:00:00.000Z`);
    const start = new Date(end.getTime() - (days - 1) * DAY);
    const rows = new Map<string, EvalCountRow>();
    for (const c of readCells(this.db, { from: start.toISOString(), to: new Date(end.getTime() + DAY).toISOString(), flagKeys })) {
      const day = c.hour.slice(0, 10);
      const k = [day, c.flagKey, c.source, c.appName, c.environment, c.result, c.variant].join('\u0000');
      const r = rows.get(k) ?? { day, flagKey: c.flagKey, source: c.source, appName: c.appName, environment: c.environment, result: c.result, variant: c.variant, count: 0 };
      r.count += c.n;
      rows.set(k, r);
    }
    return summarizeEvaluations(featureId, flagKeys, [...rows.values()], start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), days);
  }

  /** Flag 평가 모니터링 목록 — 창 끝은 지금, Flag×경로마다 한 줄. flagKeys가 있으면 그 flag만 */
  flags(q: { window?: string; flagKeys?: string[] | null; flagKey?: string; source?: string }): FlagEvaluationsResponse {
    const window = windowOf(q.window);
    const now = this.clock.now().getTime();
    const keys = q.flagKey ? (q.flagKeys && !q.flagKeys.includes(q.flagKey) ? [] : [q.flagKey]) : (q.flagKeys ?? undefined);
    const range = { from: windowFrom(now, window), to: new Date(now + 1).toISOString(), flagKeys: keys };
    const items = flagStats(readCells(this.db, { ...range, source: q.source }), window, reachOf(this.db, range), lastEvaluatedAt(this.db)).sort((a, b) => a.flagKey.localeCompare(b.flagKey) || a.source.localeCompare(b.source));
    return { window, generatedAt: new Date(now).toISOString(), items };
  }

  /** Flag 한 개의 시 단위 시계열(경로별) */
  series(flagKey: string, windowRaw?: string): FlagEvaluationSeries {
    const window = windowOf(windowRaw);
    const now = this.clock.now().getTime();
    const range = { from: windowFrom(now, window), to: new Date(now + 1).toISOString(), flagKeys: [flagKey] };
    const cells = readCells(this.db, range);
    const buckets = new Map<string, FlagEvaluationSeries['buckets'][number]>();
    for (const c of cells) {
      const k = `${c.hour}\u0000${c.source}`;
      const b = buckets.get(k) ?? { bucketStart: new Date(c.hour).toISOString(), source: c.source, evaluations: 0, enabled: 0, fallbacks: 0, errors: 0 };
      b.evaluations += c.n;
      if (c.result === 'ON') b.enabled += c.n;
      else if (c.result === 'SAFE_DEFAULT') b.fallbacks += c.n;
      else if (c.result === 'ERROR') b.errors += c.n;
      buckets.set(k, b);
    }
    return { flagKey, window, bucketMinutes: EVAL_BUCKET_MS / 60_000, buckets: [...buckets.values()], stats: flagStats(cells, window, reachOf(this.db, range), lastEvaluatedAt(this.db)) };
  }
}

@Controller('api/features')
export class EvaluationStatsController {
  constructor(private readonly stats: EvaluationStatsService) {}

  @Get(':id/evaluations')
  feature(@Param('id') id: string, @Query('days') days?: unknown) {
    const raw = singleQuery(days, 'days');
    const n = raw === undefined || raw === '' ? EVAL_DEFAULT_DAYS : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > EVAL_MAX_DAYS) throw new DomainError('VALIDATION', `기간(days)은 1~${EVAL_MAX_DAYS}일입니다.`, { field: 'days' });
    return this.stats.feature(id, n);
  }
}

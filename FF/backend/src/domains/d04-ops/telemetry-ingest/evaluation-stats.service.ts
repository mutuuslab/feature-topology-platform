// Feature별 평가 운영 데이터 (D04-03 운영 데이터 수집, 기능명세서 B5) — 평가마다 남는 span(feature_flag.evaluation, IF-11)과
// Unleash Edge 평가를 일(UTC) · flag · 평가 경로 · 앱 · 환경 · 결과 · 분기값으로 센다. span은 보존 기간(30일) 뒤 지워져도 집계는 남는다.
// 집계에는 가명 subject도 넣지 않는다 — 횟수만(FFG-OFT-003/004).
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import { appIdentity, EVAL_DEFAULT_DAYS, EVAL_MAX_DAYS, evalResultOf, evalSourceOf, summarizeEvaluations, type EvalCountRow, type EvalResult, type EvalSource, type FeatureEvaluationStats, type OtelSpan } from '@ff/contracts';
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
  count?: number;
}

/** 경로별 기본 앱 이름·환경 — 평가 요청이 보내지 않으면 */
export const DEFAULT_APP: Record<EvalSource, { appName: string; environment: string }> = {
  OFREP: { appName: 'ofrep-client', environment: 'default' },
  VEHICLE_SDK: { appName: 'vehicle-sdk', environment: 'fleet' },
  UNLEASH_EDGE: { appName: 'vehicle-unleash', environment: 'production' },
  PLATFORM: { appName: 'ffp-platform', environment: 'default' },
};

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
    out.push({ at: s.startTime, flagKey, source, ...app, result: evalResultOf({ variant, errorType: a['error.type'] == null ? null : String(a['error.type']) }), variant });
  }
  return out;
}

/**
 * 표본을 일 단위 칸에 더한다 — 같은 칸은 한 번의 갱신으로. 호출자의 트랜잭션이 있으면 그 안에서.
 * @req FR-OPD-001-005, FR-OPD-001-006, FR-OPD-001-007, FR-OPD-001-008, FR-OPD-002-001
 */
export function countEvaluations(db: Db, samples: EvaluationSample[]): number {
  if (!samples.length) return 0;
  const cells = new Map<string, EvaluationSample & { n: number }>();
  for (const s of samples) {
    const day = s.at.slice(0, 10);
    const k = [day, s.flagKey, s.source, s.appName, s.environment, s.result, s.variant].join('\u0000');
    const c = cells.get(k) ?? { ...s, at: day, n: 0 };
    c.n += s.count ?? 1;
    cells.set(k, c);
  }
  for (const c of cells.values())
    db.run(
      'INSERT INTO flag_eval_daily (day, flag_key, source, app_name, environment, result, variant, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, flag_key, source, app_name, environment, result, variant) DO UPDATE SET n = flag_eval_daily.n + excluded.n',
      c.at,
      c.flagKey,
      c.source,
      c.appName,
      c.environment,
      c.result,
      c.variant,
      c.n,
    );
  return samples.length;
}

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
   * Feature 기준 평가 운영 데이터 — 이 Feature의 모든 정책 flag(개정·대체 포함)를 최근 days일 동안.
   * @req FR-OPD-003-001
   */
  feature(featureId: string, days = EVAL_DEFAULT_DAYS): FeatureEvaluationStats {
    const known = this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ? LIMIT 1', featureId);
    if (!known) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const flagKeys = this.db.all<{ flag_key: string }>('SELECT DISTINCT flag_key FROM policy WHERE feature_id = ? ORDER BY flag_key', featureId).map((r) => r.flag_key);
    const end = new Date(`${this.clock.iso().slice(0, 10)}T00:00:00.000Z`);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    const rows = flagKeys.length
      ? this.db
          .all<{ day: string; flag_key: string; source: EvalSource; app_name: string; environment: string; result: EvalResult; variant: string; n: number }>(
            `SELECT day, flag_key, source, app_name, environment, result, variant, n FROM flag_eval_daily WHERE flag_key IN (${flagKeys.map(() => '?').join(',')}) AND day >= ? AND day <= ? ORDER BY day`,
            ...flagKeys,
            from,
            to,
          )
          .map((r): EvalCountRow => ({ day: r.day, flagKey: r.flag_key, source: r.source, appName: r.app_name, environment: r.environment, result: r.result, variant: r.variant, count: Number(r.n) }))
      : [];
    return summarizeEvaluations(featureId, flagKeys, rows, from, to, days);
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

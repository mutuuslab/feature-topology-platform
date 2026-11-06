// Flag 평가 시계열 — 체험 분석의 추이 차트(biz/charts TrendChart)를 그대로 쓴다. 원천별 평가 수, 기본값 폴백·오류를 두 판으로.
import type { FlagEvaluationSeries } from '@ff/contracts';
import { flagCode as T } from '../../copy/flag-code';
import { TrendChart } from '../biz/charts';
import { when } from '../shared';

const E = T.evaluations;
const SOURCE_COLOR: Record<string, string> = { UNLEASH_EDGE: 'var(--viz-1)', VEHICLE_SDK: 'var(--viz-3)', OFREP: 'var(--viz-2)', PLATFORM: 'var(--info)' };

/** 구간 시작 시각 → 원천별 합 */
export function seriesTable(s: FlagEvaluationSeries) {
  const times = [...new Set(s.buckets.map((b) => b.bucketStart))].sort();
  const sources = [...new Set(s.buckets.map((b) => b.source))].sort();
  const at = (t: string, src?: string) => s.buckets.filter((b) => b.bucketStart === t && (!src || b.source === src));
  const sum = (xs: { [k: string]: unknown }[], k: 'evaluations' | 'fallbacks' | 'errors') => xs.reduce((a, b) => a + Number(b[k] ?? 0), 0);
  return {
    labels: times.map((t) => when(t)),
    bySource: sources.map((src) => ({ src, values: times.map((t) => sum(at(t, src), 'evaluations')) })),
    fallbacks: times.map((t) => sum(at(t), 'fallbacks')),
    errors: times.map((t) => sum(at(t), 'errors')),
  };
}

export function EvalTrend({ series, compact = false }: { series: FlagEvaluationSeries; compact?: boolean }) {
  const t = seriesTable(series);
  if (t.labels.length < 2) return null;
  // 7일 창은 날짜(월-일), 24시간 창은 시각
  const tick = series.window === '7d' ? (w: string) => w.slice(5, 10) : (w: string) => w.slice(11, 16);
  return (
    <div className="ds-stack" data-testid="flag-eval-trend">
      <TrendChart
        weeks={t.labels}
        weekLabel="KST"
        tick={tick}
        label={E.seriesLabel(series.flagKey, series.window)}
        series={t.bySource.map((b) => ({ key: b.src, label: `${E.seriesEval} · ${T.source[b.src] ?? b.src}`, values: b.values, color: SOURCE_COLOR[b.src] ?? 'var(--viz-2)' }))}
      />
      {!compact && (
        <TrendChart
          weeks={t.labels}
          weekLabel="KST"
          tick={tick}
          label={`${E.seriesFallback} · ${E.seriesErrors}`}
          series={[
            { key: 'fallbacks', label: E.seriesFallback, values: t.fallbacks, color: 'var(--viz-2)' },
            { key: 'errors', label: E.seriesErrors, values: t.errors, color: 'var(--danger)' },
          ]}
        />
      )}
    </div>
  );
}

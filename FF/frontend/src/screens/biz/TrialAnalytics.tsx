// /biz/trials — 체험 전환 분석 (D05-06 사업 지표). 제안 → 수락 → 구매 깔때기, 성향 차원별 수락률·구매 전환율, 주별 추이.
// 조건(데이터 원천·나눠 보기)은 차트 위 한 줄, 모든 차트·표가 같은 조각을 본다. 다시 읽는 동안 이전 그림을 흐리게 유지한다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, SEGMENT_DIMENSIONS, trialAnalyticsQuery, type SegmentDimension, type TrialSource } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { ops5y } from '../../copy/ops5y';
import { formatCount, formatExact } from '../../design/format';
import { AsyncView, DataTable, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar } from '../../design';
import { FunnelChart, pct, SegmentChart, TrendChart } from './charts';

const B = ko.bizTrial;
const T = ko.trial;
const O = ops5y.trial;
/** 추이 기간(주) — 5년 운영이면 260주까지 */
// 기본 26주는 요청에 넣지 않는다(서버 기본) — 정적 데모 스냅샷 URL과 같게
const PERIODS = [26, 52, 260] as const;
type Period = (typeof PERIODS)[number];

interface Group {
  key: string;
  offered: number;
  accepted: number;
  active: number;
  converted: number;
  declined: number;
  expired: number;
  pending: number;
  acceptRate: number | null;
  conversionRate: number | null;
  overallRate: number | null;
  medianDaysToConvert: number | null;
  suppressed: boolean;
}
interface Analytics {
  today: string;
  catalogId: string;
  source: TrialSource;
  groupBy: SegmentDimension | null;
  k: number;
  counts: { demo: number; synthetic: number };
  /** 대표 대수(가중) — 표본 한 대가 여러 대를 대표한다 */
  represented?: number;
  total: Group;
  groups: Group[];
  trend: { week: string; offered: number; accepted: number; converted: number }[];
}

const nf = (n: number) => n.toLocaleString('ko-KR');

export function TrialAnalyticsScreen() {
  const [source, setSource] = useState<TrialSource>('ALL');
  const [groupBy, setGroupBy] = useState<SegmentDimension | ''>('drivingStyle');
  const [weeks, setWeeks] = useState<Period>(26);
  const catalogId = 'CAT-00019';
  const q = useApi<Analytics>('trialAnalytics', { query: { ...trialAnalyticsQuery({ catalogId, source, groupBy }), weeks: weeks === 26 ? undefined : weeks } }, { placeholderData: (prev) => prev });
  const d = q.data;
  const t = d?.total;
  // 진행 중인 주는 그래프에서 뺀다(덜 찬 주가 급락처럼 보임) — 표에는 남긴다
  const done = d ? d.trend.filter((w) => addDays(w.week, 6) < d.today) : [];
  const partial = d?.trend.find((w) => addDays(w.week, 6) >= d.today);
  // 1년 넘게 보면 4주씩 합친다 — 월 캠페인이라 주별로는 톱니가 된다
  const bucket = done.length > 60 ? 4 : 1;
  const shown = bucket === 1 ? done : Array.from({ length: Math.ceil(done.length / bucket) }, (_, i) => done.slice(i * bucket, i * bucket + bucket)).map((g) => ({ week: g[0].week, offered: g.reduce((t, w) => t + w.offered, 0), accepted: g.reduce((t, w) => t + w.accepted, 0), converted: g.reduce((t, w) => t + w.converted, 0) }));
  return (
    <div className="ds-screen">
      <PageHeader
        codes={`D05-06 · BIZ METRICS · ${catalogId}`}
        title={B.title}
        lead={B.lead}
        message={{ tone: 'neutral', value: t ? pct(t.conversionRate) : '—', text: B.key }}
        meta={d ? `${B.asOf(d.today)} · ${B.counts(d.counts.demo, d.counts.synthetic)}` : undefined}
        actions={<Link to="/entitlements">{ko.entitlement.tabs.trials}</Link>}
      />
      <Toolbar label={B.filters}>
        <Segmented label={T.source} options={(['ALL', 'DEMO', 'SYNTHETIC'] as const).map((v) => ({ value: v, label: T.sources[v] }))} value={source} onChange={(v) => setSource(v as TrialSource)} />
        <Segmented label={O.period} options={PERIODS.map((w) => ({ value: String(w), label: O.periods[w] }))} value={String(weeks)} onChange={(v) => setWeeks(Number(v) as Period)} />
        <Select label={B.groupBy} value={groupBy} onChange={(e) => setGroupBy(e.target.value as SegmentDimension | '')}>
          <option value="">{B.none}</option>
          {SEGMENT_DIMENSIONS.map((dim) => (
            <option key={dim} value={dim}>
              {T.dims[dim]}
            </option>
          ))}
        </Select>
      </Toolbar>
      {source !== 'DEMO' && <p className="ds-field__hint">{T.syntheticNote}</p>}
      <AsyncView state={asyncState(q, !t || t.offered === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && t && (
          <div className="ds-stack" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <SummaryLine
              items={[
                { k: B.kpi.offered, v: <span title={formatExact(t.offered)}>{formatCount(t.offered)}</span> },
                { k: B.kpi.accepted, v: pct(t.acceptRate) },
                { k: B.kpi.overall, v: pct(t.overallRate) },
                { k: B.kpi.median, v: t.medianDaysToConvert === null ? '—' : String(t.medianDaysToConvert) },
              ]}
            />
            <div className="ds-stack">
              <Panel title={B.funnel} id="trial-funnel">
                <FunnelChart
                  label={B.funnel}
                  stages={[
                    { key: 'offered', label: B.stages.offered, value: t.offered, note: '' },
                    { key: 'accepted', label: B.stages.accepted, value: t.accepted, note: `${B.kpi.accepted} ${pct(t.acceptRate)}` },
                    { key: 'converted', label: B.stages.converted, value: t.converted, note: `${B.kpi.converted} ${pct(t.conversionRate)}` },
                  ]}
                />
                <p className="ds-field__hint">{B.funnelNote(t.active, t.pending)}</p>
              </Panel>
              <Panel title={B.trend} id="trial-trend">
                <TrendChart
                  label={B.trend}
                  weekLabel={bucket === 1 ? B.week : `${B.week} · ${O.monthly}`}
                  weeks={shown.map((w) => w.week)}
                  series={(['offered', 'accepted', 'converted'] as const).map((k) => ({ key: k, label: B.stages[k], values: shown.map((w) => w[k]) }))}
                />
                {partial && <p className="ds-field__hint">{B.trendPartial(partial.week)}</p>}
                <details>
                  <summary>{B.table}</summary>
                  <DataTable
                    caption={B.trend}
                    rows={d.trend}
                    rowKey={(r) => r.week}
                    maxHeight="40vh"
                    columns={[
                      { key: 'w', header: B.week, cell: (r) => <span className="ds-mono">{r.week}</span> },
                      ...(['offered', 'accepted', 'converted'] as const).map((k) => ({ key: k, header: B.stages[k], cell: (r: Analytics['trend'][number]) => <span className="ds-mono">{nf(r[k])}</span>, align: 'right' as const })),
                    ]}
                  />
                </details>
              </Panel>
            </div>
            <Panel title={d.groupBy ? B.segments(T.dims[d.groupBy]) : B.segments(B.groupBy)} id="trial-segments">
              {d.groupBy ? (
                <>
                  <p className="ds-field__hint">{B.segmentsHint}</p>
                  <SegmentChart label={B.segments(T.dims[d.groupBy])} rows={d.groups} suppressedText={B.suppressed(d.k)} rateLabels={B.rate} />
                  <DataTable
                    caption={B.segments(T.dims[d.groupBy])}
                    rows={d.groups}
                    rowKey={(r) => r.key}
                    columns={[
                      { key: 'key', header: B.col.key, cell: (r) => r.key },
                      ...(['offered', 'accepted', 'active', 'converted', 'declined', 'expired'] as const).map((k) => ({
                        key: k,
                        header: B.col[k],
                        cell: (r: Group) => <span className="ds-mono">{k !== 'offered' && r.suppressed ? '—' : nf(r[k])}</span>,
                        align: 'right' as const,
                        sort: (r: Group) => r[k],
                      })),
                      ...(['acceptRate', 'conversionRate', 'overallRate'] as const).map((k) => ({
                        key: k,
                        header: B.col[k],
                        cell: (r: Group) => <span className="ds-mono">{r.suppressed ? B.suppressed(d.k) : pct(r[k])}</span>,
                        align: 'right' as const,
                        sort: (r: Group) => r[k] ?? -1,
                      })),
                      { key: 'med', header: B.col.median, cell: (r) => <span className="ds-mono">{r.medianDaysToConvert === null ? '—' : r.medianDaysToConvert.toFixed(1)}</span>, align: 'right', sort: (r) => r.medianDaysToConvert ?? -1 },
                    ]}
                  />
                </>
              ) : (
                <p className="ds-field__hint">{B.pickDim}</p>
              )}
            </Panel>
          </div>
        )}
      </AsyncView>
    </div>
  );
}

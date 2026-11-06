// /ops/flag-evaluations — Flag 평가 모니터링(20-97 §7.2). 기간(1h/24h/7d)별 Flag마다 평가 수·켜짐 비율·변형 분포·기본값 폴백 이유·
// 오류·차량 수·마지막 평가, 선택 Flag의 최근 24시간 시계열(체험 분석 추이 차트 재사용). 지도·게시본·코드 연결 상세로 이어진다.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { FlagEvaluationStat } from '@ff/contracts';
import { asyncState } from '../../api/hooks';
import { flagCode as T } from '../../copy/flag-code';
import { AsyncView, DataTable, PageHeader, Panel, Segmented, SummaryLine } from '../../design';
import { formatCount, formatExact } from '../../design/format';
import { flagMapPath } from '../features/FeatureFlags';
import { when } from '../shared';
import { isSpike, listOf, seriesOf, totalsByFlag, useEvaluations, useSeries, type FlagEvalTotal } from './data';
import { EvalTrend } from './trend';
import './flag-code.css';

const E = T.evaluations;
const C = T.col;
type Win = '1h' | '24h' | '7d';
const WINDOWS: Win[] = ['1h', '24h', '7d'];
const VARIANT_COLOR = ['var(--viz-1)', 'var(--viz-3)', 'var(--viz-2)', 'var(--info)', 'var(--warn)'];
const FALLBACK_COLOR: Record<string, string> = {
  DEFAULT_NO_SNAPSHOT: 'var(--viz-1)',
  TTL_EXPIRED: 'var(--warn)',
  SIGNATURE_INVALID: 'var(--danger)',
  LOCAL_GUARD_BLOCK: 'var(--viz-3)',
  OTHER_VIN: 'var(--info)',
  PROVIDER_ERROR: 'var(--viz-2)',
};
const pct = (k: number, of: number) => (of > 0 ? k / of : 0);

/** 누적 막대 — 값은 aria-label과 title로 */
function Stack({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const text = parts.map((p) => `${p.label} ${formatExact(p.value)}`).join(', ');
  return (
    <span className="fc-stack" role="img" aria-label={`${label}: ${text}`} title={text}>
      {total > 0 && parts.map((p) => <span key={p.key} style={{ width: `${pct(p.value, total) * 100}%`, background: p.color }} />)}
    </span>
  );
}

function ReasonBars({ t }: { t: FlagEvalTotal }) {
  const max = Math.max(1, ...t.fallbacks.map((f) => f.count));
  return (
    <ul className="fc-reasons" aria-label={E.fallbackLabel(t.flagKey)}>
      {[...t.fallbacks].sort((a, b) => b.count - a.count).map((f) => (
        <li key={f.reason}>
          <span>{T.fallback[f.reason] ?? f.reason}</span>
          <i style={{ width: `${(f.count / max) * 100}%`, '--c': FALLBACK_COLOR[f.reason] ?? 'var(--muted)' } as React.CSSProperties} />
          <b>{formatExact(f.count)}</b>
        </li>
      ))}
    </ul>
  );
}

export function FlagEvaluationsScreen() {
  const [sp, setSp] = useSearchParams();
  // 기본 7일 — 하루 넘게 이어진 폴백 급증(서명 오류 등)이 첫 화면에서 보이게
  const win = (WINDOWS.includes(sp.get('window') as Win) ? sp.get('window') : '7d') as Win;
  const q = useEvaluations(win);
  const totals = useMemo(() => totalsByFlag(listOf<FlagEvaluationStat>(q.data)).sort((a, b) => Number(isSpike(b)) - Number(isSpike(a)) || b.evaluations - a.evaluations), [q.data]);
  const spikes = totals.filter(isSpike);
  const picked = sp.get('flagKey') ?? spikes[0]?.flagKey ?? totals[0]?.flagKey ?? null;
  const seriesQ = useSeries(picked, win === '7d' ? '7d' : '24h');
  const series = seriesOf(seriesQ.data);
  const sel = totals.find((t) => t.flagKey === picked) ?? null;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    next.set(k, v);
    setSp(next, { replace: true });
  };
  const sum = (k: 'evaluations' | 'enabled' | 'fallbackTotal' | 'errors') => totals.reduce((a, t) => a + t[k], 0);
  const vehicles = totals.reduce((a, t) => Math.max(a, t.vehicles), 0);
  return (
    <div className="ds-screen fc-screen">
      <PageHeader
        codes="D04-03"
        title={E.title}
        lead={E.lead}
        message={!q.data ? { text: E.keyOk, value: '—' } : spikes.length ? { tone: 'danger', value: spikes.length, text: E.keySpike } : { tone: 'ok', text: E.keyOk }}
        actions={<Segmented<Win> label={E.window} value={win} onChange={(v) => set('window', v)} options={WINDOWS.map((w) => ({ value: w, label: E.windowLabel[w] }))} />}
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <SummaryLine
          label={E.summary}
          items={[
            { k: E.sumEval, v: formatCount(sum('evaluations')) },
            { k: E.sumOn, v: E.ratio(pct(sum('enabled'), sum('evaluations'))) },
            { k: E.sumFallback, v: formatCount(sum('fallbackTotal')) },
            { k: E.sumErrors, v: formatCount(sum('errors')) },
            { k: E.sumVehicles, v: formatCount(vehicles) },
          ]}
        />
        {sel && (
          <Panel
            title={E.series}
            id="flag-series"
            eyebrow={`${sel.flagKey} · ${E.seriesEyebrow(win)}`}
            actions={
              <span className="fc-actions">
                <Link to={flagMapPath(sel.flagKey)}>{E.toMap}</Link>
                <Link to="/deployments">{E.toDeploy}</Link>
                <Link to={`/flag-code/flags/${encodeURIComponent(sel.flagKey)}`}>{E.toDetail}</Link>
              </span>
            }
          >
            <div className="ds-split">
              <div>{series ? <EvalTrend series={series} /> : <AsyncView state={asyncState(seriesQ)} error={seriesQ.error} rows={4} />}</div>
              <div className="ds-stack">
                <h3 className="ds-eyebrow ds-eyebrow--ko">{E.reasons}</h3>
                <ReasonBars t={sel} />
                {sel.variants.length > 0 && (
                  <>
                    <h3 className="ds-eyebrow ds-eyebrow--ko">{C.variants}</h3>
                    <Stack label={E.variantsLabel(sel.flagKey)} parts={sel.variants.map((v, i) => ({ key: v.name, label: v.name, value: v.count, color: VARIANT_COLOR[i % VARIANT_COLOR.length] }))} />
                    <p className="fc-note">{sel.variants.map((v) => `${v.name} ${formatExact(v.count)}`).join(' · ')}</p>
                  </>
                )}
              </div>
            </div>
          </Panel>
        )}
        <Panel title={E.table} id="flag-evaluations">
          <DataTable
            caption={E.table}
            rows={totals}
            rowKey={(t) => t.flagKey}
            pageSize={50}
            onOpen={(t) => set('flagKey', t.flagKey)}
            columns={[
              {
                key: 'flag',
                header: C.flag,
                sort: (t) => t.flagKey,
                cell: (t) => (
                  <button type="button" className="fc-pick" aria-pressed={t.flagKey === picked} aria-label={E.select(t.flagKey)} onClick={() => set('flagKey', t.flagKey)}>
                    {t.flagKey}
                  </button>
                ),
              },
              { key: 'eval', header: C.evaluations, align: 'right', sort: (t) => t.evaluations, cell: (t) => <span className="fc-num" title={formatExact(t.evaluations)}>{formatCount(t.evaluations)}</span> },
              {
                key: 'on',
                header: C.onRatio,
                sort: (t) => pct(t.enabled, t.evaluations),
                cell: (t) => (
                  <span className="fc-ratio">
                    {E.ratio(pct(t.enabled, t.evaluations))}
                    <i aria-hidden="true"><b style={{ width: `${pct(t.enabled, t.evaluations) * 100}%` }} /></i>
                  </span>
                ),
              },
              { key: 'var', header: C.variants, cell: (t) => !t.variants.length ? '—' : <Stack label={E.variantsLabel(t.flagKey)} parts={t.variants.map((v, i) => ({ key: v.name, label: v.name, value: v.count, color: VARIANT_COLOR[i % VARIANT_COLOR.length] }))} />, minor: true },
              {
                key: 'fb',
                header: C.fallbacks,
                sort: (t) => t.fallbackTotal,
                cell: (t) => (
                  <span className="ds-stack">
                    <span className="fc-num" data-alert={isSpike(t) ? '' : undefined}>
                      {`${formatCount(t.fallbackTotal)} · ${E.ratio(pct(t.fallbackTotal, t.evaluations))}`}
                      {isSpike(t) ? ` · ${E.spike}` : ''}
                    </span>
                    <Stack label={E.fallbackLabel(t.flagKey)} parts={t.fallbacks.map((f) => ({ key: f.reason, label: T.fallback[f.reason] ?? f.reason, value: f.count, color: FALLBACK_COLOR[f.reason] ?? 'var(--muted)' }))} />
                  </span>
                ),
              },
              { key: 'err', header: C.errors, align: 'right', sort: (t) => t.errors, cell: (t) => <span className="fc-num">{formatCount(t.errors)}</span> },
              { key: 'veh', header: C.vehicles, align: 'right', sort: (t) => t.vehicles, cell: (t) => <span className="fc-num">{formatCount(t.vehicles)}</span> },
              { key: 'last', header: C.lastEval, sort: (t) => t.lastEvaluatedAt ?? '', cell: (t) => <span className="fc-num">{when(t.lastEvaluatedAt)}</span> },
            ]}
          />
        </Panel>
      </AsyncView>
    </div>
  );
}

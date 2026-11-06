// Feature 상세 '평가 운영' 탭(D04-03, 기능명세서 B5) — 이 Feature의 flag가 앱(OFREP)·차량 SDK·Unleash Edge에서 평가된 횟수를
// 일 단위로: 평가·활성·비활성·Safe Default·오류, 분기값별, 평가 경로별, 애플리케이션·환경별, flag별. 상세 화면에서 지연 로드한다.
import { useState } from 'react';
import { EVAL_DEFAULT_DAYS, EVAL_SOURCE_LABEL, type FeatureEvaluationStats } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi } from '../../api/hooks';
import { evaluations as E } from '../../copy/records';
import { AsyncView, DataTable, Kpi, Panel, Segmented } from '../../design';
import './evaluations.css';

const n = (v: number) => v.toLocaleString('ko-KR');

/** 일별 막대 — 활성(on)·비활성(off+Safe Default+오류) 비율, 값은 글자로도 */
function DailyBars({ s }: { s: FeatureEvaluationStats }) {
  const max = Math.max(1, ...s.daily.map((d) => d.count));
  return (
    <>
      <p className="ev-legend" aria-hidden="true">
        <span>
          <i className="on" />
          {E.kpi.on}
        </span>
        <span>
          <i className="off" />
          {E.kpi.off}
        </span>
      </p>
      <ol className="ev-days" aria-label={E.daily}>
        {s.daily.map((d) => (
          <li key={d.day} className="ev-day" aria-label={`${d.day} ${E.kpi.total} ${n(d.count)} · ${E.kpi.on} ${n(d.on)}`}>
            <span className="ev-day__label">{d.day.slice(5)}</span>
            <span className="ev-bar" style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }}>
              <span className="ev-bar__on" style={{ width: `${d.count ? (d.on / d.count) * 100 : 0}%` }} />
              <span className="ev-bar__off" style={{ flex: 1 }} />
            </span>
            <span className="ev-day__n">{n(d.count)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function EvaluationsTab({ id }: { id: string }) {
  const [days, setDays] = useState<number>(EVAL_DEFAULT_DAYS);
  const q = useApi<FeatureEvaluationStats>('featureEvaluations', { params: { id }, query: days === EVAL_DEFAULT_DAYS ? {} : { days: String(days) } });
  const s = q.data;
  const C = E.col;
  return (
    // 읽기 전용 공개본은 기본 기간(14일)만 찍어 둔다 — 기간 단추를 보이지 않는다
    <Panel title={E.title} id="evaluations" actions={STATIC_MODE ? undefined : <Segmented label={E.days} value={String(days)} onChange={(v) => setDays(Number(v))} options={E.dayOptions.map((d) => ({ value: String(d), label: E.dayLabel(d) }))} />}>
      <p className="ds-field__hint">{E.lead}</p>
      <AsyncView state={asyncState(q, false)} error={q.error} onRetry={() => q.refetch()}>
        {s && !s.flagKeys.length ? (
          <p className="ds-field__hint" data-testid="evaluations-noflag">{E.noFlag}</p>
        ) : s ? (
          <div className="ds-stack" data-testid="evaluations">
            <div className="ev-kpis">
              <Kpi label={E.kpi.total} value={n(s.totals.evaluations)} hint={s.totals.evaluations ? E.share(s.totals.on, s.totals.evaluations) : E.quiet(s.period.days)} tone="accent" />
              <Kpi label={E.kpi.on} value={n(s.totals.on)} />
              <Kpi label={E.kpi.off} value={n(s.totals.off)} />
              <Kpi label={E.kpi.safe} value={n(s.totals.safeDefault)} />
              <Kpi label={E.kpi.errors} value={n(s.totals.errors)} tone={s.totals.errors ? 'warn' : undefined} />
            </div>
            <div className="ev-grid">
              <section className="ds-stack">
                <h3 className="ds-eyebrow">{E.daily}</h3>
                <span className="ds-field__hint">{E.dailyCaption(s.period.from, s.period.to)}</span>
                <DailyBars s={s} />
              </section>
              <section className="ds-stack">
                <h3 className="ds-eyebrow">{E.byVariant}</h3>
                <DataTable
                  caption={E.byVariant}
                  rows={s.byVariant}
                  rowKey={(r) => r.variant}
                  columns={[
                    { key: 'v', header: C.variant, cell: (r) => <span title={r.variant}>{E.variant[r.variant] ?? r.variant}</span> },
                    { key: 'c', header: C.count, cell: (r) => <span className="ds-mono">{n(r.count)}</span>, align: 'right', sort: (r) => r.count },
                  ]}
                />
                <h3 className="ds-eyebrow">{E.bySource}</h3>
                <DataTable
                  caption={E.bySource}
                  rows={s.bySource}
                  rowKey={(r) => r.source}
                  columns={[
                    { key: 's', header: C.source, cell: (r) => EVAL_SOURCE_LABEL[r.source] },
                    { key: 'c', header: C.count, cell: (r) => <span className="ds-mono">{n(r.count)}</span>, align: 'right', sort: (r) => r.count },
                    { key: 'o', header: C.on, cell: (r) => <span className="ds-mono">{n(r.on)}</span>, align: 'right' },
                  ]}
                />
              </section>
            </div>
            <h3 className="ds-eyebrow">{E.byApp}</h3>
            <DataTable
              caption={E.byApp}
              rows={s.byApp}
              rowKey={(r) => `${r.appName}|${r.environment}|${r.source}`}
              columns={[
                { key: 'a', header: C.app, cell: (r) => <span className="ds-mono">{r.appName}</span>, sort: (r) => r.appName },
                { key: 'e', header: C.env, cell: (r) => <span className="ds-mono">{r.environment}</span>, sort: (r) => r.environment },
                { key: 's', header: C.source, cell: (r) => EVAL_SOURCE_LABEL[r.source] },
                { key: 'c', header: C.count, cell: (r) => <span className="ds-mono">{n(r.count)}</span>, align: 'right', sort: (r) => r.count },
                { key: 'l', header: C.last, cell: (r) => <span className="ds-mono">{r.lastDay}</span> },
              ]}
            />
            <h3 className="ds-eyebrow">{E.byFlag}</h3>
            <DataTable
              caption={E.byFlag}
              rows={s.byFlag}
              rowKey={(r) => r.flagKey}
              columns={[
                { key: 'f', header: C.flag, cell: (r) => <code>{r.flagKey}</code>, sort: (r) => r.flagKey },
                { key: 'c', header: C.count, cell: (r) => <span className="ds-mono">{n(r.count)}</span>, align: 'right', sort: (r) => r.count },
                { key: 'o', header: C.on, cell: (r) => <span className="ds-mono">{n(r.on)}</span>, align: 'right' },
                { key: 'x', header: C.off, cell: (r) => <span className="ds-mono">{n(r.off)}</span>, align: 'right' },
                { key: 's', header: C.safe, cell: (r) => <span className="ds-mono">{n(r.safeDefault)}</span>, align: 'right' },
                { key: 'e', header: C.errors, cell: (r) => <span className="ds-mono">{n(r.errors)}</span>, align: 'right' },
              ]}
            />
          </div>
        ) : null}
      </AsyncView>
    </Panel>
  );
}

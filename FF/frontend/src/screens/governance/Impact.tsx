// /analysis/impact — 변경 영향 분석 (v2). Feature → 의존 Feature → Baseline → 상품, 재판정 Gate·담당자.
import { useSearchParams } from 'react-router-dom';
import { REJUDGE_MAP } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, GateBadge, IdChip, Kpi, LifecycleBadge, PageHeader, Panel } from '../../design';

const T = ko.impact;
const CHANGEABLE = Object.keys(REJUDGE_MAP);

interface Impact {
  feature: { featureId: string; version: string; name: string; lifecycle: string; baselineId: string | null; ownerId: string };
  dependents: { dependencyId: string; featureId: string; version: string; name: string; lifecycle: string; depth: number; path: string[] }[];
  baselines: { baselineId: string; version: string; current: boolean }[];
  products: { catalogId: string; version: string; name: string; lifecycle: string; ownerId: string; via: { baselineId: string; featureId: string; direct: boolean }[] }[];
  rejudge: string[];
  owners: string[];
  summary: { dependents: number; products: number; releasedProducts: number; rejudgeGates: number };
}

export default function ImpactScreen() {
  const [sp, setSp] = useSearchParams();
  const feature = sp.get('feature') ?? 'FEAT-00145';
  const version = sp.get('version') ?? '5.4.2';
  const changed = (sp.get('changed') ?? '').split(',').filter(Boolean);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Impact>('impact', { params: { id: feature, ver: version }, query: { changed: changed.join(',') || undefined } });
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · D06-05 · IMPACT" title={T.title} lead={T.lead} />
      <Panel title={T.target} id="target">
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="ds-field">
            <span className="ds-field__label">Feature ID</span>
            <input className="ds-input ds-input--mono" defaultValue={feature} onBlur={(e) => set('feature', e.target.value.trim().toUpperCase())} />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Version</span>
            <input className="ds-input ds-input--mono" defaultValue={version} onBlur={(e) => set('version', e.target.value.trim())} />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <legend className="ds-field__label">{T.changed}</legend>
            {CHANGEABLE.map((k) => (
              <label key={k} className="ds-tag" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={changed.includes(k)} onChange={(e) => set('changed', (e.target.checked ? [...changed, k] : changed.filter((x) => x !== k)).join(','))} />
                <span className="ds-mono">{k}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </Panel>
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className="ds-kpis">
              <Kpi label={T.dependents} value={d.summary.dependents} />
              <Kpi label={T.products} value={d.summary.products} hint={`RELEASED ${d.summary.releasedProducts}`} tone={d.summary.releasedProducts ? 'warn' : undefined} />
              <Kpi label={T.rejudge} value={d.summary.rejudgeGates} />
              <Kpi label={T.owners} value={d.owners.length} />
            </div>
            <div className="ds-chain" aria-label={T.title}>
              <section>
                <h3>Feature</h3>
                <div className="ds-stack">
                  <IdChip id={d.feature.featureId} version={d.feature.version} to={`/features/${d.feature.featureId}/${d.feature.version}`} />
                  <span>{d.feature.name}</span>
                  <LifecycleBadge value={d.feature.lifecycle} />
                </div>
              </section>
              <section>
                <h3>
                  {T.dependents} <span className="ds-mono">{d.dependents.length}</span>
                </h3>
                <div className="ds-stack">
                  {d.dependents.length ? (
                    d.dependents.map((x) => (
                      <div key={x.featureId} title={x.path.join(' → ')}>
                        <IdChip id={x.featureId} version={x.version} to={`/features/${x.featureId}/${x.version}`} copy={false} /> <span className="ds-field__hint">{x.name} · d{x.depth}</span>
                      </div>
                    ))
                  ) : (
                    <span className="ds-field__hint">{T.none}</span>
                  )}
                </div>
              </section>
              <section>
                <h3>
                  Baseline <span className="ds-mono">{d.baselines.length}</span>
                </h3>
                <div className="ds-stack">
                  {d.baselines.map((b) => (
                    <div key={b.baselineId}>
                      <IdChip id={b.baselineId} copy={false} /> <span className="ds-field__hint">v{b.version}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3>
                  {T.products} <span className="ds-mono">{d.products.length}</span>
                </h3>
                <div className="ds-stack">
                  {d.products.length ? (
                    d.products.map((p) => (
                      <div key={p.catalogId + p.version}>
                        <IdChip id={p.catalogId} version={p.version} to={`/products/${p.catalogId}/${p.version}`} copy={false} /> <LifecycleBadge value={p.lifecycle} />
                        <div className="ds-field__hint">
                          {p.name} · {p.via.some((v) => v.direct) ? T.direct : T.indirect}
                        </div>
                      </div>
                    ))
                  ) : (
                    <span className="ds-field__hint">{T.none}</span>
                  )}
                </div>
              </section>
            </div>
            <div className="ds-split">
              <Panel title={T.rejudge} id="rejudge">
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {d.rejudge.length ? d.rejudge.map((g) => <span key={g} className="ds-mono"><GateBadge status="검토 중" /> {g}</span>) : <span className="ds-field__hint">{T.none}</span>}
                </div>
              </Panel>
              <Panel title={T.owners} id="owners">
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {d.owners.map((o) => <span key={o} className="ds-tag">{o}</span>)}
                </div>
              </Panel>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}

// ISO/IEC 26580 제품 라인 화면(20-60 §6) — Feature 카탈로그·Bill-of-Features·제품 구성기·공유 자산 추적.
// 모두 조회·점검 화면이다. 상품 승인은 기존 구성 규칙으로 판정하고, 카탈로그 제약 위반은 경고로 알린다(D-26580-2).
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { BillOfFeatures, BofIssue, CatalogueFeatureNode, CatalogueTree, ProductConfiguration, SharedAsset } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { assets as AS, bof as B, catalogue as C, configurator as CF, profile as PR } from '../../copy/ple';
import { AsyncView, Button, DataTable, ErrorNote, Field, PageHeader, Panel, Segmented, SummaryLine, VerdictBadge, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { PleNav } from './PleNav';
import './ple.css';

// ───────── Feature 카탈로그 ─────────

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
function matches(n: CatalogueFeatureNode, key: string): boolean {
  return !key || norm(`${n.refId}${n.nameKo}${n.nameEn}`).includes(key) || n.realizations.some((r) => norm(`${r.featureId}${r.name}`).includes(key)) || n.children.some((c) => matches(c, key));
}

function FeatureNode({ n, keyword }: { n: CatalogueFeatureNode; keyword: string }) {
  const shown = n.realizations.slice(0, 6);
  return (
    <li data-catalogue-ref={n.refId}>
      <div className="cat-node" data-role={n.catalogueRole}>
        <span>
          <span className="cat-node__name">{n.nameKo}</span> <Link to={`/master/feature-db/${n.refId}`} className="ds-mono">{n.refId}</Link>
        </span>
        <span className="cat-node__meta">
          <span className="ds-tag">{PR.roleOpt[n.catalogueRole]}</span>
          <span className="ds-tag">ASIL {n.asilRep}</span>
          {n.variationPoints > 0 && <span className="ds-tag">{C.vps(n.variationPoints)}</span>}
          {n.requires.map((r) => (
            <span key={r} className="ds-tag">{`${C.requires} ${r}`}</span>
          ))}
          {n.excludes.map((r) => (
            <span key={r} className="ds-tag ds-tag--warn">{`${C.excludes} ${r}`}</span>
          ))}
        </span>
        {n.realizations.length > 0 && (
          <span className="cat-node__real">
            <span className="ds-tag">{C.realizations(n.realizations.length)}</span>
            {shown.map((r) => (
              <Link key={`${r.featureId}-${r.role}`} to={`/features/${r.featureId}/${r.version}`} className="ds-mono" title={`${r.name} · ${r.country} · ${r.vehicleModel} · ${r.trim}`}>
                {r.featureId}
              </Link>
            ))}
            {n.realizations.length > shown.length && <span>{`+${n.realizations.length - shown.length}`}</span>}
          </span>
        )}
      </div>
      {n.children.length > 0 && (
        <ul className="cat-list" aria-label={`${n.nameKo} ${C.sub}`}>
          {n.children.filter((c) => matches(c, keyword)).map((c) => (
            <FeatureNode key={c.refId} n={c} keyword={keyword} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function CatalogueScreen() {
  const q = useApi<CatalogueTree>('featureCatalogue');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<boolean | null>(null);
  const keyword = norm(text);
  const t = q.data;
  const domains = (t?.domains ?? []).map((d) => ({ ...d, components: d.components.map((c) => ({ ...c, features: c.features.filter((f) => matches(f, keyword)) })).filter((c) => c.features.length) })).filter((d) => d.components.length);
  return (
    <div className="ds-screen">
      <PageHeader codes="ISO/IEC 26580 · 3.5 · D01-01" title={C.title} lead={C.lead} message={t ? { tone: 'neutral', value: t.counts.primary, text: C.key(t.counts.primary, t.counts.sub) } : { tone: 'neutral', value: '—', text: C.key(0, 0) }} />
      <PleNav />
      <AsyncView state={asyncState(q, !t?.domains.length)} onRetry={() => q.refetch()}>
        {t && (
          <>
            {/* 수는 요약 한 줄로(3초 테스트 — KPI 타일 줄 금지). 주요·하위 feature 수는 핵심 메시지에 있어 되풀이하지 않는다 */}
            <SummaryLine
              label={C.title}
              items={[
                { k: C.kpi.domains, v: t.counts.domains },
                { k: C.kpi.realizations, v: t.counts.realizations },
                { k: C.kpi.constraints, v: t.counts.constraints },
                { k: C.kpi.vps, v: t.counts.variationPoints },
              ]}
            />
            <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}>
              <Field label={C.search}>
                <input className="ds-input" name="catalogueSearch" value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <Button onClick={() => setOpen(true)}>{C.expandAll}</Button>
              <Button onClick={() => setOpen(false)}>{C.collapseAll}</Button>
            </div>
            <div className="cat-tree" data-testid="catalogue-tree">
              {domains.map((d, i) => (
                <details key={`${d.domain}-${open}`} className="cat-domain" open={open ?? (!!keyword || i < 2)} data-domain={d.domain}>
                  <summary>
                    {d.domain}
                    <span className="cat-domain__counts">{`${C.kpi.primary} ${d.counts.features} · ${C.kpi.sub} ${d.counts.subFeatures} · ${C.kpi.realizations} ${d.counts.realizations}`}</span>
                  </summary>
                  {d.components.map((c) => (
                    <div key={c.component} className="cat-comp">
                      <h3>{c.component}</h3>
                      <ul className="cat-list">
                        {c.features.map((f) => (
                          <FeatureNode key={f.refId} n={f} keyword={keyword} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              ))}
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}

// ───────── Bill-of-Features ─────────

interface PortfolioItem {
  catalogId: string;
  version: string;
  name: string;
  lifecycle: string;
  type: string;
  country: string;
  vehicleModel: string;
  trim: string;
  result: 'PASS' | 'FAIL';
  features: number;
  refs: string[];
  primaryRefs: string[];
  fails: number;
  warns: number;
  catalogueIssues: number;
}
interface Portfolio {
  items: PortfolioItem[];
  refIds: string[];
  refNames: Record<string, string>;
  counts: { products: number; fail: number; features: number };
}

const productKey = (p: { catalogId: string; version: string }) => `${p.catalogId}@${p.version}`;

/** 위반·경고 목록 — 없으면 지킨 제약(고른 feature 수)을 말한다 */
export function IssueList({ issues, checked }: { issues: readonly BofIssue[]; checked: number }) {
  if (!issues.length) return <p className="ds-field__hint" data-testid="bof-issues-pass">{B.issuesNone(checked)}</p>;
  return (
    <ul className="bof-issues" data-testid="bof-issues">
      {issues.map((i, k) => (
        <li key={`${i.code}-${k}`} data-severity={i.severity} data-code={i.code}>
          <VerdictBadge value={i.severity === 'FAIL' ? 'FAIL' : 'CONDITIONAL'} label={B.origin[i.origin]} />
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

function BillDetail({ id, version }: { id: string; version: string }) {
  const q = useApi<BillOfFeatures>('billOfFeatures', { params: { id, ver: version } });
  const b = q.data;
  return (
    <Panel title={B.detail(`${id}@${version}`)} id="bof-detail" actions={<Link to={`/products/configurator?product=${id}@${version}`}>{B.openConfigurator} →</Link>}>
      <AsyncView state={asyncState(q, !b)} onRetry={() => q.refetch()} rows={4}>
        {b && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <DataTable
              caption={B.detail(`${id}@${version}`)}
              rows={b.selections}
              rowKey={(s) => s.baselineId}
              columns={[
                { key: 'f', header: B.selCol.feature, cell: (s) => <span><Link to={`/features/${s.featureId}/${s.version}`} className="ds-mono">{s.featureId}</Link> {s.name}</span>, sort: (s) => s.featureId },
                { key: 'r', header: B.selCol.ref, cell: (s) => (s.primaryRefId ? <span><span className="ds-mono">{s.primaryRefId}</span> {s.refName}</span> : '—') },
                { key: 'p', header: B.selCol.role, cell: (s) => <span>{PR.roleOpt[s.catalogueRole]}{s.parentRefId ? <span className="ds-mono">{` ← ${s.parentRefId}`}</span> : null}</span> },
                { key: 'v', header: B.selCol.variability, cell: (s) => PR.variabilityOpt[s.variability] },
                { key: 'l', header: B.selCol.lifecycle, cell: (s) => s.lifecycle },
              ]}
            />
            <h3 style={{ margin: 0 }}>{B.issues}</h3>
            <IssueList issues={b.issues} checked={b.selections.length} />
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}

function CheckForm() {
  const perm = usePermission(['PRODUCT_AUTHOR', 'PRODUCT_APPROVER']);
  const run = useApiMutation<BillOfFeatures>('checkBillOfFeatures');
  const [f, setF] = useState({ country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', type: 'PACKAGE', baselineIds: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ids = f.baselineIds.split(',').map((x) => x.trim()).filter(Boolean);
  const why = whyDisabled([!perm.ok, B.checkWhy], [STATIC_MODE, perm.hint], [!ids.length, B.baselines]);
  return (
    <Panel title={B.checkTitle} eyebrow={B.checkHint} id="bof-check">
      <div className="af__profile-grid">
        <Field label={B.checkCol.country}>
          <input className="ds-input ds-input--mono" name="bofCountry" value={f.country} onChange={set('country')} />
        </Field>
        <Field label={B.checkCol.vehicleModel}>
          <input className="ds-input" name="bofVehicleModel" value={f.vehicleModel} onChange={set('vehicleModel')} />
        </Field>
        <Field label={B.checkCol.trim}>
          <input className="ds-input" name="bofTrim" value={f.trim} onChange={set('trim')} />
        </Field>
        <Field label={B.checkCol.type}>
          <select className="ds-select" name="bofType" value={f.type} onChange={set('type')}>
            {['PACKAGE', 'SINGLE', 'BUNDLE'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={B.baselines}>
        <input className="ds-input ds-input--mono" name="bofBaselines" value={f.baselineIds} onChange={set('baselineIds')} />
      </Field>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
        <Button variant="primary" data-ui="checkBillOfFeatures" disabled={!!why || run.isPending} reason={why} onClick={() => run.mutate({ body: { ...f, baselineIds: ids } })}>
          {B.checkRun}
        </Button>
      </div>
      <ErrorNote error={run.error} />
      {run.data && (
        <div data-testid="bof-check-result" data-result={run.data.result} style={{ marginTop: 'var(--sp-3)', display: 'grid', gap: 'var(--sp-2)' }}>
          <VerdictBadge value={run.data.result} label={run.data.result === 'PASS' ? B.pass : B.fail} />
          <IssueList issues={run.data.issues} checked={run.data.selections.length} />
        </div>
      )}
    </Panel>
  );
}

export function BillOfFeaturesScreen() {
  const q = useApi<Portfolio>('billOfFeaturesPortfolio');
  const [sp, setSp] = useSearchParams();
  const p = q.data;
  // 고른 상품 — 없으면 위반이 있는 첫 상품, 없으면 첫 상품
  const first = p?.items.find((i) => i.result === 'FAIL') ?? p?.items[0];
  const pick = sp.get('product') ?? (first ? productKey(first) : null);
  const [pid, pver] = (pick ?? '').split('@');
  return (
    <div className="ds-screen">
      <PageHeader codes="ISO/IEC 26580 · 3.1·3.2 · D01-03" title={B.title} lead={B.lead} message={p ? { tone: p.counts.fail ? 'warn' : 'ok', value: p.counts.fail || p.counts.products, text: B.key(p.counts.fail) } : { tone: 'neutral', value: '—', text: B.key(0) }} />
      <PleNav />
      <AsyncView state={asyncState(q, !p?.items.length)} onRetry={() => q.refetch()}>
        {p && (
          <>
            <DataTable
              caption={B.title}
              rows={p.items}
              rowKey={(r: PortfolioItem) => productKey(r)}
              onOpen={(r) => setSp({ product: productKey(r) }, { replace: true })}
              columns={[
                { key: 'p', header: B.col.product, cell: (r) => <span><Link to={`/products/${r.catalogId}/${r.version}`} className="ds-mono">{productKey(r)}</Link> {r.name}</span>, sort: (r) => r.catalogId },
                { key: 's', header: B.col.scope, cell: (r) => `${r.country} · ${r.vehicleModel} · ${r.trim}` },
                { key: 't', header: B.col.type, cell: (r) => r.type },
                { key: 'r', header: B.col.result, cell: (r) => <VerdictBadge value={r.result} label={r.result === 'PASS' ? B.pass : B.fail} />, sort: (r) => r.result },
                { key: 'f', header: B.col.features, cell: (r) => r.features, sort: (r) => r.features },
                { key: 'i', header: B.col.issues, cell: (r) => (r.fails || r.warns ? `${r.fails} · ${r.warns}` : '0'), sort: (r) => r.fails * 100 + r.warns },
              ]}
            />
            {pid && pver && <BillDetail id={pid} version={pver} />}
            <Panel title={B.portfolio} eyebrow={B.portfolioHint} id="bof-portfolio">
              <div className="bof-grid-wrap" role="region" aria-label={B.portfolio} tabIndex={0}>
                <table className="bof-grid" data-testid="bof-grid" aria-label={B.portfolio}>
                  <thead>
                    <tr>
                      <th scope="col">{B.col.product}</th>
                      {p.refIds.map((r) => (
                        <th key={r} scope="col" title={p.refNames[r]}>
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((i) => (
                      <tr key={productKey(i)}>
                        <th scope="row" data-result={i.result}>
                          <span className="ds-mono">{i.catalogId}</span>
                        </th>
                        {p.refIds.map((r) => {
                          const on = i.primaryRefs.includes(r);
                          return (
                            <td key={r} data-on={on} title={on ? `${i.name} · ${p.refNames[r]}` : undefined}>
                              {on ? '●' : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <CheckForm />
          </>
        )}
      </AsyncView>
    </div>
  );
}

// ───────── 제품 구성기 ─────────

export function ConfiguratorScreen() {
  const list = useApi<Portfolio>('billOfFeaturesPortfolio');
  const [sp, setSp] = useSearchParams();
  const items = list.data?.items ?? [];
  const pick = sp.get('product') ?? (items[0] ? productKey(items[0]) : '');
  const [id, ver] = pick.split('@');
  const q = useApi<ProductConfiguration>('productConfiguration', { params: { id, ver } }, { enabled: !!id && !!ver });
  const c = q.data;
  const on = c?.instances.flags.filter((f) => f.value === 'ON').length ?? 0;
  const off = c?.instances.flags.filter((f) => f.value === 'OFF').length ?? 0;
  return (
    <div className="ds-screen">
      <PageHeader codes="ISO/IEC 26580 · 3.12·3.14 · D01-03" title={CF.title} lead={CF.lead} message={c ? { tone: 'neutral', value: on, text: CF.key(on, off) } : { tone: 'neutral', value: '—', text: CF.key(0, 0) }} />
      <PleNav />
      <AsyncView state={asyncState(list, !items.length)} onRetry={() => list.refetch()} rows={2}>
        <Field label={CF.product}>
          <select className="ds-select" name="configProduct" style={{ minWidth: 0, width: '100%', maxWidth: '100%' }} value={pick} onChange={(e) => setSp({ product: e.target.value }, { replace: true })}>
            {items.map((i) => (
              <option key={productKey(i)} value={productKey(i)}>{`${productKey(i)} · ${i.name} · ${i.country} ${i.vehicleModel} ${i.trim}`}</option>
            ))}
          </select>
        </Field>
      </AsyncView>
      <AsyncView state={asyncState(q, !c)} onRetry={() => q.refetch()}>
        {c && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }} data-testid="configurator">
            <Panel title={B.issues} id="cfg-issues">
              <VerdictBadge value={c.bill.result} label={c.bill.result === 'PASS' ? B.pass : B.fail} />
              <IssueList issues={c.bill.issues} checked={c.bill.selections.length} />
            </Panel>
            <Panel title={CF.flags} id="cfg-flags">
              <DataTable
                caption={CF.flags}
                rows={c.instances.flags}
                rowKey={(f) => `${f.featureId}-${f.flagKey}`}
                maxHeight="40vh"
                columns={[
                  { key: 'k', header: CF.flagCol.flag, cell: (f) => <span className="ds-mono">{f.flagKey}</span> },
                  { key: 'f', header: CF.flagCol.feature, cell: (f) => <Link to={`/features/${f.featureId}/${c.bill.selections.find((s) => s.featureId === f.featureId)?.version ?? '1.0.0'}`} className="ds-mono">{f.featureId}</Link> },
                  { key: 'v', header: CF.flagCol.value, cell: (f) => <span className={f.value === 'ON' ? 'flag-on' : 'flag-off'} data-flag-value={f.value}>{f.value === 'ON' ? CF.on : CF.off}</span>, sort: (f) => f.value },
                  { key: 's', header: CF.flagCol.source, cell: (f) => CF.flagSource[f.source] },
                ]}
              />
            </Panel>
            <Panel title={CF.sw} id="cfg-sw">
              <DataTable
                caption={CF.sw}
                rows={c.instances.swComponents}
                rowKey={(s) => s.swId}
                columns={[
                  { key: 's', header: CF.swCol.sw, cell: (s) => <span className="ds-mono">{s.swId}</span> },
                  { key: 'v', header: CF.swCol.versions, cell: (s) => <span className="ds-mono">{s.versions.join(', ') || '—'}</span> },
                  { key: 'e', header: CF.swCol.ecu, cell: (s) => <span className="ds-mono">{s.ecuPnos.join(', ') || '—'}</span> },
                  { key: 'f', header: CF.swCol.features, cell: (s) => <span className="ds-mono">{s.features.join(', ')}</span> },
                ]}
              />
            </Panel>
            <Panel title={CF.vps} id="cfg-vps">
              <DataTable
                caption={CF.vps}
                rows={c.instances.variationPoints}
                rowKey={(v) => `${v.featureId}-${v.vpId}`}
                maxHeight="40vh"
                columns={[
                  { key: 'f', header: CF.vpCol.feature, cell: (v) => <span className="ds-mono">{v.featureId}</span>, sort: (v) => v.featureId },
                  { key: 'p', header: CF.vpCol.vp, cell: (v) => PR.vpKind[v.assetKind] ?? v.assetKind },
                  { key: 'a', header: CF.vpCol.asset, cell: (v) => <span className="ds-mono">{v.asset}</span> },
                  { key: 'r', header: CF.vpCol.resolved, cell: (v) => v.resolved },
                ]}
              />
            </Panel>
            {c.instances.policies.length > 0 && (
              <Panel title={CF.policies} id="cfg-policies">
                <ul className="af__list">
                  {c.instances.policies.map((x) => (
                    <li key={x.policyId}>
                      <Link to={`/policies/${x.policyId}`} className="ds-mono">{x.policyId}</Link>
                      <span className="ds-mono">{x.featureId}</span>
                      <span className="ds-tag">{x.status}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </AsyncView>
    </div>
  );
}

// ───────── 공유 자산 추적 ─────────

export function SharedAssetsScreen() {
  const q = useApi<{ items: SharedAsset[]; counts: { shared: number; swComponents: number; ecus: number; flags: number; policies: number; total: number } }>('sharedAssets');
  const [kind, setKind] = useState<'ALL' | SharedAsset['kind']>('ALL');
  const items = q.data?.items ?? [];
  const rows = useMemo(() => (kind === 'ALL' ? items : items.filter((i) => i.kind === kind)), [items, kind]);
  const cnt = q.data?.counts;
  const chips = (xs: string[], to: (x: string) => string): ReactNode => (
    <span className="cat-node__real shared-asset-links">
      {xs.slice(0, 5).map((x) => (
        <Link key={x} to={to(x)} className="ds-mono">{x}</Link>
      ))}
      {xs.length > 5 && <span>{AS.more(xs.length - 5)}</span>}
    </span>
  );
  return (
    <div className="ds-screen">
      <PageHeader codes="ISO/IEC 26580 · 3.17·3.18 · D01-02" title={AS.title} lead={AS.lead} message={cnt ? { tone: 'neutral', value: cnt.shared, text: AS.key(cnt.shared) } : { tone: 'neutral', value: '—', text: AS.key(0) }} />
      <PleNav />
      <AsyncView state={asyncState(q, !items.length)} onRetry={() => q.refetch()}>
        {cnt && (
          <Segmented
            label={AS.col.kind}
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
            options={[
              { value: 'ALL', label: AS.all, count: cnt.total },
              { value: 'SW_COMPONENT', label: AS.kind.SW_COMPONENT, count: cnt.swComponents },
              { value: 'ECU', label: AS.kind.ECU, count: cnt.ecus },
              { value: 'FLAG', label: AS.kind.FLAG, count: cnt.flags },
              { value: 'POLICY', label: AS.kind.POLICY, count: cnt.policies },
            ]}
          />
        )}
        <DataTable
          caption={AS.title}
          rows={rows}
          rowKey={(a) => `${a.kind}|${a.asset}`}
          maxHeight="62vh"
          columns={[
            { key: 'k', header: AS.col.kind, cell: (a) => AS.kind[a.kind], sort: (a) => a.kind },
            { key: 'a', header: AS.col.asset, cell: (a) => <span className="ds-mono">{a.asset}</span>, sort: (a) => a.asset },
            { key: 'f', header: AS.col.features, cell: (a) => chips(a.features.map((f) => f.featureId), (x) => `/features/${x}/${a.features.find((f) => f.featureId === x)!.version}`), sort: (a) => a.features.length },
            { key: 'p', header: AS.col.products, cell: (a) => (a.products.length ? chips(a.products, (x) => `/products?q=${x}`) : '—'), sort: (a) => a.products.length },
          ]}
        />
      </AsyncView>
    </div>
  );
}

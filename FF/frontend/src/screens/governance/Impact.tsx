// /analysis/impact — 변경 영향 분석 (v2). Feature → 의존 Feature → Baseline → 상품, 재판정 Gate·담당자.
// 보강(W5 P5-2): 협력사로 시작하기(?supplier= — 그 협력사 SW를 쓰는 Feature를 골라 영향 보기), 바뀐 항목은 한글 이름(영문 키는 툴팁).
// ADS 변경(ADS-UI09): '승인 경로'(변경 종류별 재-HARA·R156 영향·SUMS)·'릴리스 비교' 탭을 더했다 — 위 내용은 '영향 범위' 탭(?feature=·?supplier=로 오면 이 탭).
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REJUDGE_MAP } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { adsChange } from '../../copy/ads-change';
import { impactPlus as IP } from '../../copy/impactSupplier';
import { traceCopy } from '../../copy/trace-links';
import { useDefaultFeature } from '../../data/first-run';
import { AsyncView, Button, GateBadge, IdChip, LifecycleBadge, PageHeader, Panel, Select, SummaryLine, Tabs } from '../../design';
import { ApprovalPathsTab, pathsMessage, ReleaseDiffTab, releaseMessage, useChangeImpacts, useReleasePick } from '../ads/ChangeImpact';

const T = ko.impact;
const TI = traceCopy.impact;
const CHANGEABLE = Object.keys(REJUDGE_MAP);
const TAB_KEYS = ['paths', 'release', 'scope'];

interface Impact {
  feature: { featureId: string; version: string; name: string; lifecycle: string; baselineId: string | null; ownerId: string };
  dependents: { dependencyId: string; featureId: string; version: string; name: string; lifecycle: string; depth: number; path: string[] }[];
  baselines: { baselineId: string; version: string; current: boolean }[];
  products: { catalogId: string; version: string; name: string; lifecycle: string; ownerId: string; via: { baselineId: string; featureId: string; direct: boolean }[] }[];
  rejudge: string[];
  owners: string[];
  summary: { dependents: number; products: number; releasedProducts: number; rejudgeGates: number; policies?: number; livePolicies?: number; vehicles?: number; otaPackages?: number };
  /** 차량·정책·OTA 영향 범위(FR-DEP-003-001) */
  policies?: { policyId: string; featureId: string; featureVersion: string; flagKey: string; status: string; direct: boolean; live: boolean }[];
  vehicles?: { total: number; byScope: { scope: string; vehicles: number }[]; sample: string[] };
  ota?: { linkId: string; featureId: string; packageId: string; name: string | null; version: string | null; direct: boolean }[];
}

export default function ImpactScreen() {
  const [sp, setSp] = useSearchParams();
  // 탭 — 기본은 승인 경로, Feature·협력사를 골라 온 주소(?feature=·?supplier=)는 영향 범위. 주소에 탭을 적어 Tabs와 맞춘다
  const tabParam = sp.get('tab');
  const active = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : sp.get('feature') || sp.get('supplier') ? 'scope' : 'paths';
  useEffect(() => {
    if (tabParam === active) return;
    const n = new URLSearchParams(sp);
    n.set('tab', active);
    setSp(n, { replace: true });
  }, [tabParam, active, sp, setSp]);
  const paths = useChangeImpacts(active === 'paths');
  const release = useReleasePick(active === 'release');
  // 기본 대상 — 예시 Feature가 있으면 그것, 없으면 첫 Feature, 하나도 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const fallback = useDefaultFeature({ featureId: 'FEAT-00145', version: '5.4.2' }, !sp.get('feature'));
  const feature = sp.get('feature') ?? fallback?.featureId ?? '';
  const version = sp.get('version') ?? (sp.get('feature') ? '5.4.2' : (fallback?.version ?? ''));
  const none = !sp.get('feature') && fallback === null;
  const changed = (sp.get('changed') ?? '').split(',').filter(Boolean);
  // 머리 핵심 메시지용 — 영향 범위 탭의 같은 조회(캐시 공유)
  const q = useApi<Impact>('impact', { params: { id: feature, ver: version }, query: { changed: changed.join(',') || undefined } }, { enabled: active === 'scope' && !!feature && !!version });
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-02 · D06-05 · IMPACT"
        title={T.title}
        lead={active === 'paths' ? adsChange.lead.paths : active === 'release' ? adsChange.lead.release : T.lead}
        message={
          active === 'paths'
            ? pathsMessage(paths.data)
            : active === 'release'
            ? releaseMessage(release.diff.data)
            : none
            ? { tone: 'neutral', text: ko.state.noFeatureTitle, action: <Link to="/feature/propose">{ko.state.proposeFirst}</Link> }
            : q.data
            ? q.data.summary.rejudgeGates
              ? { tone: 'warn', value: q.data.summary.rejudgeGates, text: T.key.rejudge(`${feature} ${version}`) }
              : { tone: 'ok', text: T.key.none(`${feature} ${version}`) }
            : { tone: 'neutral', value: '—', text: T.key.rejudge(`${feature} ${version}`) }
        }
      />
      <Tabs
        tabs={[
          { key: 'paths', label: adsChange.tabs.paths, count: paths.data?.counts?.total },
          { key: 'release', label: adsChange.tabs.release },
          { key: 'scope', label: adsChange.tabs.scope },
        ]}
      >
        {(tab) => (tab === 'paths' ? <ApprovalPathsTab /> : tab === 'release' ? <ReleaseDiffTab /> : <ScopeTab />)}
      </Tabs>
    </div>
  );
}

/** 영향 범위 탭 — 기존 화면 내용(분석 대상·의존 Feature·Baseline·상품·재판정 Gate·담당자) */
function ScopeTab() {
  const [sp, setSp] = useSearchParams();
  // 기본 대상 — 예시 Feature가 있으면 그것, 없으면 첫 Feature, 하나도 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const fallback = useDefaultFeature({ featureId: 'FEAT-00145', version: '5.4.2' }, !sp.get('feature'));
  const feature = sp.get('feature') ?? fallback?.featureId ?? '';
  const version = sp.get('version') ?? (sp.get('feature') ? '5.4.2' : (fallback?.version ?? ''));
  const none = !sp.get('feature') && fallback === null;
  const changed = (sp.get('changed') ?? '').split(',').filter(Boolean);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    n.set(k, v);
    setSp(n, { replace: true });
  };
  const q = useApi<Impact>('impact', { params: { id: feature, ver: version }, query: { changed: changed.join(',') || undefined } }, { enabled: !!feature && !!version });
  const supplier = sp.get('supplier') ?? '';
  const deliveries = useApi<{ items: { swId: string; version: string; supplier: string }[] }>('supplierDeliveries');
  const sw = useApi<{ items: { swId: string; version: string; features: string[] }[] }>('masterSw', {}, { enabled: !!supplier });
  const suppliers = [...new Set((deliveries.data?.items ?? []).map((r) => r.supplier))].sort();
  const mine = (deliveries.data?.items ?? []).filter((r) => r.supplier === supplier);
  const supplied = [...new Set(mine.flatMap((r) => sw.data?.items.find((s) => s.swId === r.swId && s.version === r.version)?.features ?? []))].sort();
  const pickFeature = (key: string) => {
    const [id, ver] = key.split('@');
    const n = new URLSearchParams(sp);
    n.set('feature', id);
    n.set('version', ver);
    setSp(n, { replace: true });
  };
  const d = q.data;
  return (
    <>
      <Panel title={T.target} id="target">
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--sp-3)' }}>
          <Select label={IP.supplier} value={supplier} onChange={(e) => set('supplier', e.target.value)} data-impact-supplier>
            <option value="">{IP.supplierAny}</option>
            {suppliers.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </div>
        {supplier && sw.data && (
          <div className="ds-stack" data-supplier-features={supplier} style={{ marginBottom: 'var(--sp-3)' }}>
            <p className="ds-field__hint">{supplied.length ? IP.supplierLead(supplied.length) : IP.supplierNone}</p>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {supplied.map((k) => {
                const [id, ver] = k.split('@');
                return (
                  <Button key={k} variant={id === feature && ver === version ? 'primary' : 'ghost'} aria-pressed={id === feature && ver === version} onClick={() => pickFeature(k)}>
                    {IP.pick(id, ver)}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="ds-field">
            <span className="ds-field__label">{IP.featureId}</span>
            <input key={feature} className="ds-input ds-input--mono" defaultValue={feature} onBlur={(e) => set('feature', e.target.value.trim().toUpperCase())} />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">{IP.version}</span>
            <input key={version} className="ds-input ds-input--mono" defaultValue={version} onBlur={(e) => set('version', e.target.value.trim())} />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <legend className="ds-field__label">{T.changed}</legend>
            {CHANGEABLE.map((k) => (
              <label key={k} className="ds-tag" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={changed.includes(k)} onChange={(e) => set('changed', (e.target.checked ? [...changed, k] : changed.filter((x) => x !== k)).join(','))} />
                <span title={k}>{IP.field[k] ?? k}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </Panel>
      <AsyncView emptyHidden={none} state={none ? 'empty' : asyncState(q)} error={q.error} onRetry={() => q.refetch()} empty={{ title: ko.state.noFeatureTitle, body: ko.state.noFeatureBody, action: <Link to="/feature/propose">{ko.state.proposeFirst}</Link> }}>
        {d && (
          <>
            <SummaryLine
              items={[
                { k: T.dependents, v: d.summary.dependents },
                { k: T.products, v: `${d.summary.products} (RELEASED ${d.summary.releasedProducts})` },
                { k: T.owners, v: d.owners.length },
                ...(d.policies ? [{ k: TI.policies, v: `${d.policies.length} (${TI.live} ${d.policies.filter((p) => p.live).length})` }, { k: TI.vehicles, v: d.vehicles?.total ?? 0 }, { k: TI.ota, v: d.ota?.length ?? 0 }] : []),
              ]}
            />
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
            {d.policies && <ScopeChain d={d} />}
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
    </>
  );
}

/** 차량·정책·OTA 영향(FR-DEP-003-001) — 바뀐 Feature와 의존 Feature의 정책, 켜진 정책 범위의 차량, 연결된 OTA 패키지 */
function ScopeChain({ d }: { d: Impact }) {
  const pol = d.policies ?? [];
  const ota = d.ota ?? [];
  const veh = d.vehicles;
  return (
    <div className="ds-chain" aria-label={`${TI.policies} · ${TI.vehicles} · ${TI.ota}`} data-ui="impactScope">
      <section>
        <h3>
          {TI.policies} <span className="ds-mono">{pol.length}</span>
        </h3>
        <div className="ds-stack">
          {pol.map((p) => (
            <div key={p.policyId}>
              <Link to={`/policies/${p.policyId}`} className="ds-mono">{p.policyId}</Link> <span className="ds-tag">{p.status}</span>
              <div className="ds-field__hint">
                {p.flagKey} · {p.featureId} · {p.direct ? TI.direct : TI.indirect}{p.live ? ` · ${TI.live}` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>
          {TI.vehicles} <span className="ds-mono">{veh?.total ?? 0}</span>
        </h3>
        <div className="ds-stack">
          <span>{TI.vehicleTotal(veh?.total ?? 0)}</span>
          {(veh?.byScope ?? []).map((s) => (
            <span key={s.scope} className="ds-field__hint">{`${s.scope} · ${s.vehicles}`}</span>
          ))}
        </div>
      </section>
      <section>
        <h3>
          {TI.ota} <span className="ds-mono">{ota.length}</span>
        </h3>
        <div className="ds-stack">
          {ota.map((o) => (
            <div key={o.linkId}>
              <span className="ds-mono">{o.packageId}</span>
              <div className="ds-field__hint">
                {o.featureId} · {o.direct ? TI.direct : TI.indirect}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

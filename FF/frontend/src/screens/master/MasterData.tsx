// 기준정보 (v2, P10-C4) — /master/upg UPG·UPG-VC, /master/artifacts SW·Artifact(+ECU), /master/structure SW 구조,
// /master/control-points 제어점, /master/taxonomy Taxonomy. 원천은 v0.81 데이터셋(백엔드 /api/master/*).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, IdChip, LifecycleBadge, PageHeader, Panel, Tabs, Toolbar, VerdictBadge } from '../../design';

const M = ko.master;
const fref = (s: string) => {
  const [id, ver] = s.split('@');
  return <IdChip key={s} id={id} version={ver} to={`/features/${id}/${ver}`} copy={false} />;
};

export function UpgScreen() {
  const q = useApi<{ items: { upgVc: string; features: { featureId: string; version: string; name: string }[]; vehicles: string[]; models: string[] }[] }>('masterUpg');
  const rows = q.data?.items ?? [];
  const C = M.upg.col;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · UPG-VC" title={M.upg.title} lead={M.upg.lead} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={M.upg.title}
          rows={rows}
          rowKey={(r) => r.upgVc}
          columns={[
            { key: 'c', header: C.code, cell: (r) => <span className="ds-mono ds-nowrap">{r.upgVc}</span>, sort: (r) => r.upgVc },
            { key: 'f', header: C.features, cell: (r) => (r.features.length ? <span className="ds-chain">{r.features.map((f) => fref(`${f.featureId}@${f.version}`))}</span> : <span className="ds-field__hint">{M.upg.unused}</span>), sort: (r) => r.features.length },
            { key: 's', header: C.scopes, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.models.join(' · ') || '—'}</span> },
            { key: 'v', header: C.vehicles, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.vehicles.join(' · ') || '—'}</span>, sort: (r) => r.vehicles.length },
          ]}
        />
      </AsyncView>
    </div>
  );
}

interface SwRow {
  swId: string;
  version: string;
  name: string;
  swType: string;
  ecuPno: string;
  ecuName: string | null;
  supplier: string;
  safetyClass: string;
  securityClass: string;
  lifecycle: string;
  artifactId: string;
  features: string[];
}

export function SwScreen() {
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · SW_Master · ECU_Master" title={M.sw.title} lead={M.sw.lead} />
      <Tabs tabs={[{ key: 'sw', label: M.sw.tabs.sw }, { key: 'ecu', label: M.sw.tabs.ecu }]}>{(t) => (t === 'ecu' ? <EcuTab /> : <SwTab />)}</Tabs>
    </div>
  );
}

function SwTab() {
  const [q, setQ] = useState('');
  const list = useApi<{ items: SwRow[] }>('masterSw', { query: { q: q.trim() || undefined } }, { placeholderData: (p) => p });
  const rows = list.data?.items ?? [];
  const C = M.sw.col;
  return (
    <>
      <Toolbar label={M.common.search}>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{M.common.search}</span>
          <input className="ds-input" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </Toolbar>
      <AsyncView state={asyncState(list, rows.length === 0)} error={list.error?.message} onRetry={() => list.refetch()}>
        <DataTable
          caption={M.sw.tabs.sw}
          rows={rows}
          rowKey={(r) => `${r.swId}@${r.version}`}
          maxHeight="66vh"
          columns={[
            { key: 's', header: C.sw, cell: (r) => <span className="ds-mono ds-nowrap">{r.swId}</span>, sort: (r) => r.swId },
            { key: 'v', header: C.version, cell: (r) => <span className="ds-mono">{r.version}</span> },
            { key: 'n', header: C.name, cell: (r) => r.name },
            { key: 't', header: C.type, cell: (r) => <span className="ds-nowrap">{r.swType}</span> },
            { key: 'e', header: C.ecu, cell: (r) => <span className="ds-nowrap" title={r.ecuName ?? undefined}><span className="ds-mono">{r.ecuPno}</span></span> },
            { key: 'p', header: C.supplier, cell: (r) => <span className="ds-nowrap">{r.supplier}</span>, sort: (r) => r.supplier },
            { key: 'sc', header: C.safety, cell: (r) => <span className="ds-tag">{r.safetyClass}</span> },
            { key: 'se', header: C.security, cell: (r) => <span className="ds-tag">{r.securityClass}</span> },
            { key: 'l', header: C.lifecycle, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.lifecycle}</span> },
            { key: 'f', header: C.features, cell: (r) => <span className="ds-chain">{r.features.map(fref)}</span> },
          ]}
        />
      </AsyncView>
    </>
  );
}

function EcuTab() {
  const q = useApi<{ items: { ecuPno: string; name: string; domain: string; vehiclePlatform: string; hwRevision: string; osRuntime: string; network: string; supplier: string; asil: string; sw: string[]; features: number }[] }>('masterEcu');
  const rows = q.data?.items ?? [];
  const C = M.sw.ecuCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable
        caption={M.sw.tabs.ecu}
        rows={rows}
        rowKey={(r) => r.ecuPno}
        columns={[
          { key: 'p', header: C.pno, cell: (r) => <span className="ds-mono ds-nowrap">{r.ecuPno}</span> },
          { key: 'n', header: C.name, cell: (r) => r.name },
          { key: 'd', header: C.domain, cell: (r) => <span className="ds-nowrap">{r.domain}</span> },
          { key: 'pl', header: C.platform, cell: (r) => <span className="ds-nowrap">{r.vehiclePlatform}</span> },
          { key: 'h', header: C.hw, cell: (r) => <span className="ds-mono">{r.hwRevision}</span> },
          { key: 'o', header: C.os, cell: (r) => <span className="ds-nowrap">{r.osRuntime}</span> },
          { key: 'a', header: C.asil, cell: (r) => <span className="ds-tag">{r.asil}</span> },
          { key: 's', header: C.sw, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.sw.join(' · ')}</span> },
          { key: 'f', header: C.features, cell: (r) => <span className="ds-mono">{r.features}</span>, align: 'right', sort: (r) => r.features },
        ]}
      />
    </AsyncView>
  );
}

export function StructureScreen() {
  const q = useApi<{ items: { ecuPno: string; name: string; domain: string; sw: { swId: string; version: string; name: string; functions: { functionId: string; name: string; featureId: string; featureVersion: string }[] }[] }[] }>('masterStructure');
  const rows = q.data?.items ?? [];
  const S = M.structure;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · ECU → SW → Function" title={S.title} lead={S.lead} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <ul className="ds-tree" aria-label={S.title}>
          {rows.map((e) => (
            <li key={e.ecuPno}>
              <details open={e.sw.some((s) => s.functions.length > 0)}>
                <summary>
                  <span className="ds-mono">{e.ecuPno}</span> {e.name} <span className="ds-field__hint">{`${e.domain} · ${S.sw(e.sw.length)}`}</span>
                </summary>
                <ul>
                  {e.sw.map((s) => (
                    <li key={`${s.swId}@${s.version}`}>
                      <span className="ds-mono">{`${s.swId}@${s.version}`}</span> {s.name} <span className="ds-field__hint">{S.fns(s.functions.length)}</span>
                      {s.functions.length > 0 ? (
                        <ul>
                          {s.functions.map((f) => (
                            <li key={`${f.functionId}:${f.featureId}@${f.featureVersion}`}>
                              <span className="ds-mono">{f.functionId}</span> {f.name} → {fref(`${f.featureId}@${f.featureVersion}`)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </AsyncView>
    </div>
  );
}

interface CpRow {
  featureId: string;
  version: string;
  name: string;
  lifecycle: string;
  controlPoints: string[];
  policies: { policyId: string; flagKey: string; controlPoint: string; status: string }[];
  unbound: string[];
  multiBound: string[];
}

export function ControlPointsScreen() {
  const q = useApi<{ items: CpRow[] }>('masterControlPoints');
  const [issues, setIssues] = useState(false);
  const all = q.data?.items ?? [];
  const rows = issues ? all.filter((r) => r.unbound.length || r.multiBound.length) : all;
  const C = M.cp.col;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · Control Point · BD-06" title={M.cp.title} lead={M.cp.lead} />
      <Toolbar label={M.cp.onlyIssues}>
        <label className="ds-field ds-field--inline">
          <input type="checkbox" checked={issues} onChange={(e) => setIssues(e.target.checked)} />
          <span className="ds-field__label">{M.cp.onlyIssues}</span>
        </label>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={M.cp.title}
          rows={rows}
          rowKey={(r) => r.featureId}
          maxHeight="66vh"
          columns={[
            { key: 'f', header: C.feature, cell: (r) => <span className="ds-nowrap">{fref(`${r.featureId}@${r.version}`)} {r.name}</span> },
            { key: 'l', header: C.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} /> },
            { key: 'c', header: C.cps, cell: (r) => <span className="ds-mono">{r.controlPoints.join(' · ') || '—'}</span> },
            { key: 'p', header: C.policies, cell: (r) => (r.policies.length ? <span className="ds-chain">{r.policies.map((p) => <Link key={p.policyId} to={`/policies/${p.policyId}`} className="ds-mono">{`${p.controlPoint}: ${p.flagKey} · ${p.status}`}</Link>)}</span> : '—') },
            { key: 'u', header: C.unbound, cell: (r) => (r.unbound.length ? <span className="ds-mono">{r.unbound.join(' · ')}</span> : '—'), sort: (r) => r.unbound.length },
            { key: 'm', header: C.multi, cell: (r) => (r.multiBound.length ? <VerdictBadge value="FAIL" /> : '—') },
          ]}
        />
      </AsyncView>
    </div>
  );
}

export function TaxonomyScreen() {
  const q = useApi<{ tags: { tag: string; features: { featureId: string; version: string; name: string }[] }[]; scopes: { scope: string; count: number }[] }>('masterTaxonomy');
  const d = q.data;
  const T = M.taxonomy;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-01 · Taxonomy" title={T.title} lead={T.lead} />
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <div className="ds-split">
            <Panel title={T.tags} id="taxonomy-tags">
              <DataTable
                caption={T.tags}
                rows={d.tags}
                rowKey={(r) => r.tag}
                maxHeight="62vh"
                columns={[
                  { key: 't', header: T.col.tag, cell: (r) => <span className="ds-tag">{r.tag}</span>, sort: (r) => r.tag },
                  { key: 'f', header: T.col.features, cell: (r) => <span className="ds-chain">{r.features.map((f) => fref(`${f.featureId}@${f.version}`))}</span>, sort: (r) => r.features.length },
                ]}
              />
            </Panel>
            <Panel title={T.scopes} id="taxonomy-scopes">
              <DataTable
                caption={T.scopes}
                rows={d.scopes}
                rowKey={(r) => r.scope}
                columns={[
                  { key: 's', header: T.col.scope, cell: (r) => <span className="ds-mono">{r.scope}</span>, sort: (r) => r.scope },
                  { key: 'c', header: T.col.count, cell: (r) => <span className="ds-mono">{r.count}</span>, align: 'right', sort: (r) => r.count },
                ]}
              />
            </Panel>
          </div>
        )}
      </AsyncView>
    </div>
  );
}

// /integration/openfeature — OpenFeature 반영 범위 (D05-01). 무엇을 OpenFeature로 하고 무엇을 하지 않는가를 한 화면에:
// 두 경로(OpenFeature = F0·F1 IVI 앱 / Safety Guard = F2 이상), OF-1~7·경계·범위 밖 표, flag별 경계, SDK 고정, flagd·매니페스트, 차량 내장 provider.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, Explain, PageHeader, Panel, RuleText, Select, SummaryLine, Tabs, VerdictBadge } from '../../design';

const O = ko.p10.openfeature;

interface ScopeItem {
  id: string;
  title: string;
  what: string;
  side: string;
  status: 'done' | 'excluded';
  rules: string[];
  endpoints: string[];
  tests: string[];
}
interface CatalogItem {
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: string;
  safeDefault: boolean;
  revisions: number[];
  openFeature: boolean;
}
interface Scope {
  items: ScopeItem[];
  pins: { spec: string; sdks: Record<string, string>; experimental: string[] };
  catalog: CatalogItem[];
  snapshotVersion: string;
  audit: { spans: number; lastAt: string | null };
}

export function OpenFeatureScopeScreen() {
  const q = useApi<Scope>('openfeatureScope');
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D05-01 · IF-10 · OpenFeature · FFG-OFT · FFG-PLT-011"
        title={O.title}
        lead={O.lead}
        message={{ tone: 'neutral', value: d ? d.catalog.filter((c) => c.openFeature).length : '—', text: O.key }}
      />
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <>
            <SummaryLine
              items={[
                { k: O.kpi.excluded, v: d.catalog.filter((c) => !c.openFeature).length },
                { k: O.kpi.spans, v: d.audit.spans },
                { k: O.kpi.snapshot, v: d.snapshotVersion },
              ]}
            />
            <Panel title={O.paths} id="of-paths">
              <div className="ds-split">
                <PathColumn title={O.ofPath} steps={O.ofPathSteps} tone="ok" />
                <PathColumn title={O.guardPath} steps={O.guardPathSteps} tone="warn" />
              </div>
            </Panel>
            <Panel title={O.scope} id="of-scope">
              <DataTable
                caption={O.scope}
                rows={d.items}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'id', header: O.col.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.id}</span> },
                  { key: 't', header: O.col.title, cell: (r) => <strong className="ds-nowrap">{r.title}</strong> },
                  { key: 'side', header: O.col.side, cell: (r) => <span className="ds-nowrap">{O.sides[r.side]}</span> },
                  { key: 's', header: O.col.status, cell: (r) => <span className="ds-nowrap"><VerdictBadge value={r.status === 'done' ? 'PASS' : 'UNJUDGED'} /> {O.status[r.status]}</span> },
                  // 근거 규칙 ID는 설명 모드 칩으로(UX3-01) — 본문은 내용
                  {
                    key: 'w',
                    header: O.col.what,
                    cell: (r) => (
                      <>
                        <RuleText text={r.what} explain />
                        <Explain rules={r.rules} />
                      </>
                    ),
                  },
                  { key: 'e', header: O.col.endpoints, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.endpoints.join(' · ') || '—'}</span> },
                ]}
              />
            </Panel>
            <Panel title={O.catalog} id="of-catalog">
              <DataTable
                caption={O.catalog}
                rows={d.catalog}
                rowKey={(r) => r.flagKey}
                columns={[
                  { key: 'k', header: O.catCol.flag, cell: (r) => <span className="ds-mono ds-nowrap">{r.flagKey}</span> },
                  { key: 'f', header: O.catCol.feature, cell: (r) => <span className="ds-mono ds-nowrap">{`${r.featureId} ${r.featureVersion}`}</span> },
                  { key: 'c', header: O.catCol.fClass, cell: (r) => <span className="ds-tag">{r.fClass}</span> },
                  { key: 'o', header: O.catCol.target, cell: (r) => <span className="ds-nowrap"><VerdictBadge value={r.openFeature ? 'PASS' : 'CONDITIONAL'} /> {r.openFeature ? O.yes : O.no}</span> },
                  { key: 'd', header: O.catCol.default, cell: (r) => <span className="ds-mono">{String(r.safeDefault)}</span> },
                  { key: 'v', header: O.catCol.revisions, cell: (r) => <span className="ds-mono">{r.revisions.join(', ')}</span> },
                ]}
              />
            </Panel>
            <Panel title={O.pins} codes="FFG-OFT-007" id="of-pins">
              <ul className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                <li>{`${O.spec} ${d.pins.spec}`}</li>
                {Object.entries(d.pins.sdks).map(([k, v]) => (
                  <li key={k}>{`${k} ${v}`}</li>
                ))}
              </ul>
            </Panel>
            <Tabs tabs={[{ key: 'vehicle', label: O.vehicle }, { key: 'flagd', label: O.flagd }, { key: 'manifest', label: O.manifest }]} param="of">
              {(tab) => (tab === 'flagd' ? <JsonPanel name="openfeatureFlagd" /> : tab === 'manifest' ? <ManifestPanel /> : <VehiclePanel />)}
            </Tabs>
          </>
        )}
      </AsyncView>
    </div>
  );
}

function PathColumn({ title, steps, tone }: { title: string; steps: readonly string[]; tone: 'ok' | 'warn' }) {
  return (
    <section className="ds-of-path" data-tone={tone} aria-label={title}>
      <h3>{title}</h3>
      <ol>
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </section>
  );
}

function JsonPanel({ name }: { name: string }) {
  const q = useApi<unknown>(name);
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      <pre className="ds-code" tabIndex={0} style={{ maxHeight: '50vh', overflow: 'auto' }}>{JSON.stringify(q.data, null, 2)}</pre>
    </AsyncView>
  );
}

function ManifestPanel() {
  const q = useApi<{ flags: Record<string, unknown>; findings: { flagKey: string; rule: string; message: string }[] }>('openfeatureManifest');
  const d = q.data;
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {d && (
        <>
          <p className={d.findings.length ? 'ds-stale' : 'ds-ok'} role="status">
            {d.findings.length ? `${O.findings}: ${d.findings.map((f) => `${f.rule} ${f.message}`).join(' · ')}` : `${O.findings}: ${O.noFindings}`}
          </p>
          <pre className="ds-code" tabIndex={0} style={{ maxHeight: '50vh', overflow: 'auto' }}>{JSON.stringify({ flags: d.flags }, null, 2)}</pre>
        </>
      )}
    </AsyncView>
  );
}

interface VehicleEval {
  vin: string;
  pseudonym: string;
  stale: boolean;
  items: { flagKey: string; fClass: string; openFeature: boolean; sdk: { value: boolean; reason: string | null }; guard: { value: boolean; reason: string }; agrees: boolean }[];
}

function VehiclePanel() {
  const vehicles = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  const [vin, setVin] = useState('ego-01');
  const q = useApi<VehicleEval>('vehicleOpenFeature', { params: { vin } });
  const d = q.data;
  const C = O.vehCol;
  return (
    <>
      <Select label={O.vin} value={vin} onChange={(e) => setVin(e.target.value)}>
        {(vehicles.data?.items ?? [{ vin: 'ego-01', label: '' }]).map((v) => (
          <option key={v.vin} value={v.vin}>{`${v.vin} ${v.label}`}</option>
        ))}
      </Select>
      <AsyncView state={asyncState(q, !d?.items.length)} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <>
            <p className="ds-field__hint ds-mono">{O.pseudonym(d.pseudonym)}</p>
            {d.stale && <p className="ds-stale" role="status">{O.stale}</p>}
            <DataTable
              caption={O.vehicle}
              rows={d.items}
              rowKey={(r) => r.flagKey}
              columns={[
                { key: 'k', header: C.flag, cell: (r) => <span className="ds-mono ds-nowrap">{r.flagKey}</span> },
                { key: 'c', header: C.fClass, cell: (r) => <span className="ds-tag">{r.fClass}</span> },
                { key: 's', header: C.sdk, cell: (r) => <span className="ds-mono ds-nowrap">{`${r.sdk.value ? 'ON' : 'OFF'} · ${r.sdk.reason ?? '—'}`}</span> },
                { key: 'g', header: C.guard, cell: (r) => <span className="ds-mono ds-nowrap">{`${r.guard.value ? 'ON' : 'OFF'} · ${r.guard.reason}`}</span> },
                { key: 'a', header: C.agrees, cell: (r) => <VerdictBadge value={r.agrees ? 'PASS' : 'FAIL'} /> },
              ]}
            />
          </>
        )}
      </AsyncView>
    </>
  );
}

/** 활성화 판단 화면의 OpenFeature 패널이 범위 화면으로 연결할 때 쓰는 링크 */
export function OpenFeatureScopeLink() {
  return <Link to="/integration/openfeature">{O.scopeLink}</Link>;
}

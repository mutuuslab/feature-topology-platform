// 운영·관리 v2 화면 (P10-C4) — /ops/telemetry 운영 데이터·이벤트, /supplier/portal 협력사 이관, /admin/security 보안·인증서,
// /admin/settings 설정, /verify/compliance 컴플라이언스(보고서 v1.1 규칙 추적), /change/eo SW EO. 모두 기존 API·계약 데이터를 읽는다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPLIANCE_PROFILES, OPENFEATURE_PINS, profileFinding, reportRule, RULE_STATUS, STANDARDS_MAP, sumsRetention, VEX_STATES } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, IdChip, KeyValue, Kpi, PageHeader, Panel, Segmented, Select, Tabs, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';
import { EpochBump, SbomDrawer, SecurityEventsPanel } from './Security';

const M = ko.master;
const fref = (s: string) => {
  const [id, ver] = s.split('@');
  return <IdChip key={s} id={id} version={ver} to={`/features/${id}/${ver}`} copy={false} />;
};
const t19 = (iso: string | null | undefined) => (iso ? iso.slice(0, 19).replace('T', ' ') : '—');

// ───────── 운영 데이터·이벤트 ─────────

export function TelemetryScreen() {
  const T = M.telemetry;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D04-03 · IF-06 · IF-11" title={T.title} lead={T.lead} actions={<Link to="/events">{T.events}</Link>} />
      <Tabs tabs={[{ key: 'readbacks', label: T.tabs.readbacks }, { key: 'status', label: T.tabs.status }, { key: 'requests', label: T.tabs.requests }]}>
        {(t) => (t === 'status' ? <StatusTab /> : t === 'requests' ? <RequestsTab /> : <ReadbacksTab />)}
      </Tabs>
    </div>
  );
}

function ReadbacksTab() {
  const q = useApi<{ items: { vin: string; publicationId: string; metricType: string; observed: string; at: string; rejectReason?: string | null }[] }>('readbacks');
  const rows = q.data?.items ?? [];
  const C = M.telemetry.rbCol;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
      <DataTable
        caption={M.telemetry.tabs.readbacks}
        rows={rows}
        rowKey={(r) => `${r.vin}:${r.publicationId}:${r.at}`}
        maxHeight="62vh"
        columns={[
          { key: 'a', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t19(r.at)}</span>, sort: (r) => r.at },
          { key: 'v', header: C.vin, cell: (r) => <Link to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`} className="ds-mono">{r.vin}</Link> },
          { key: 'p', header: C.pub, cell: (r) => <Link to={`/deployments/${r.publicationId}`} className="ds-mono">{r.publicationId}</Link> },
          { key: 't', header: C.type, cell: (r) => <span className="ds-mono">{r.metricType}</span> },
          { key: 'o', header: C.observed, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{String(r.observed).slice(0, 24)}</span> },
          { key: 'r', header: C.reason, cell: (r) => (r.rejectReason ? <VerdictBadge value="FAIL" /> : '—') },
        ]}
      />
    </AsyncView>
  );
}

function VehiclePicker({ vin, onChange }: { vin: string; onChange: (v: string) => void }) {
  const v = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  return (
    <Toolbar label={M.telemetry.vin}>
      <Select label={M.telemetry.vin} value={vin} onChange={(e) => onChange(e.target.value)}>
        {(v.data?.items ?? [{ vin, label: '' }]).map((x) => (
          <option key={x.vin} value={x.vin}>{`${x.vin} ${x.label}`}</option>
        ))}
      </Select>
    </Toolbar>
  );
}

function StatusTab() {
  const [vin, setVin] = useState('ego-01');
  const q = useApi<{ vin: string; features: { featureId: string; state: string; reportSeq: number; updatedAt: string }[]; recent: { featureId: string; state: string; reportSeq: number; accepted: boolean; violation: { code: string; message: string } | null; at: string }[] }>('vehicleStatusView', { params: { vin } });
  const d = q.data;
  return (
    <>
      <VehiclePicker vin={vin} onChange={setVin} />
      <AsyncView state={asyncState(q, !d?.features.length && !d?.recent.length)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <DataTable
            caption={M.telemetry.tabs.status}
            rows={d.recent}
            rowKey={(r) => `${r.featureId}:${r.reportSeq}:${r.at}`}
            columns={[
              { key: 'a', header: M.telemetry.rbCol.at, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t19(r.at)}</span> },
              { key: 'f', header: ko.master.common.feature, cell: (r) => <span className="ds-mono">{r.featureId}</span> },
              { key: 's', header: M.telemetry.rbCol.observed, cell: (r) => <span className="ds-mono">{`${r.state} #${r.reportSeq}`}</span> },
              { key: 'ok', header: M.telemetry.rbCol.reason, cell: (r) => (r.accepted ? <VerdictBadge value="PASS" /> : <span title={r.violation?.message}><VerdictBadge value="FAIL" /> <span className="ds-mono">{r.violation?.code}</span></span>) },
            ]}
          />
        )}
      </AsyncView>
    </>
  );
}

function RequestsTab() {
  const [vin, setVin] = useState('ego-01');
  const q = useApi<{ items: { requestId: string; at: string; channel: string; type: string; outcome: string; reason: string | null; summary: string }[] }>('vehicleRequests', { params: { vin } });
  const rows = q.data?.items ?? [];
  const C = M.telemetry.reqCol;
  return (
    <>
      <VehiclePicker vin={vin} onChange={setVin} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={M.telemetry.tabs.requests}
          rows={rows}
          rowKey={(r) => r.requestId}
          columns={[
            { key: 'a', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t19(r.at)}</span> },
            { key: 'c', header: C.channel, cell: (r) => <span className="ds-mono">{r.channel}</span> },
            { key: 't', header: C.type, cell: (r) => <span className="ds-mono">{r.type}</span> },
            { key: 'o', header: C.outcome, cell: (r) => <VerdictBadge value={r.outcome === 'REJECTED' ? 'FAIL' : 'PASS'} /> },
            { key: 'r', header: C.reason, cell: (r) => <span className="ds-mono" title={r.summary}>{r.reason ?? r.summary}</span> },
          ]}
        />
      </AsyncView>
    </>
  );
}

// ───────── 협력사 이관 ─────────

export function SupplierScreen() {
  const q = useApi<{ items: { swId: string; version: string; supplier: string; artifactId: string; checksum: string; ecuPno: string; lifecycle: string }[] }>('supplierDeliveries');
  const sw = useApi<{ items: { swId: string; version: string; features: string[] }[] }>('masterSw');
  const [supplier, setSupplier] = useState('');
  const rows = q.data?.items ?? [];
  const suppliers = [...new Set(rows.map((r) => r.supplier))].sort();
  const pick = supplier || suppliers[0] || '';
  const mine = rows.filter((r) => r.supplier === pick);
  const featuresOf = (r: { swId: string; version: string }) => sw.data?.items.find((s) => s.swId === r.swId && s.version === r.version)?.features ?? [];
  const S = M.supplier;
  const C = S.col;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D05-01 · IF-08 Supplier Portal" title={S.title} lead={S.lead} meta={pick ? S.summary(mine.length, new Set(mine.flatMap(featuresOf)).size) : undefined} />
      <Toolbar label={S.supplier}>
        <Select label={S.supplier} value={pick} onChange={(e) => setSupplier(e.target.value)}>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(q, mine.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={S.title}
          rows={mine}
          rowKey={(r) => `${r.swId}@${r.version}`}
          columns={[
            { key: 's', header: C.sw, cell: (r) => <span className="ds-mono ds-nowrap">{r.swId}</span> },
            { key: 'v', header: C.version, cell: (r) => <span className="ds-mono">{r.version}</span> },
            { key: 'a', header: C.artifact, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.artifactId}</span> },
            { key: 'c', header: C.checksum, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{String(r.checksum ?? '—').slice(0, 18)}</span> },
            { key: 'e', header: C.ecu, cell: (r) => <span className="ds-mono ds-nowrap">{r.ecuPno}</span> },
            { key: 'l', header: C.lifecycle, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.lifecycle}</span> },
            { key: 'f', header: C.features, cell: (r) => <span className="ds-chips">{featuresOf(r).map(fref)}</span> },
          ]}
        />
      </AsyncView>
    </div>
  );
}

// ───────── 보안·인증서 ─────────

export function SecurityScreen() {
  const keys = useApi<{ items: { keyId: string; alg: string; purpose: string; epoch: number; status: string; createdAt: string; notAfter: string; fingerprint: string }[] }>('pkiKeys');
  const hsm = useApi<Record<string, unknown>>('hsmStatus');
  const S = M.security;
  const C = S.keyCol;
  const rows = keys.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D06-10 · D06-11 · PKI/KMS" title={S.title} lead={S.lead} />
      <Panel title={S.keys} id="sec-keys">
        <AsyncView state={asyncState(keys, rows.length === 0)} error={keys.error?.message} onRetry={() => keys.refetch()}>
          <DataTable
            caption={S.keys}
            rows={rows}
            rowKey={(r) => r.keyId}
            columns={[
              { key: 'k', header: C.kid, cell: (r) => <span className="ds-mono">{r.keyId}</span> },
              { key: 'p', header: C.purpose, cell: (r) => <span className="ds-tag">{r.purpose}</span> },
              { key: 'a', header: C.alg, cell: (r) => <span className="ds-mono">{r.alg}</span> },
              { key: 's', header: C.status, cell: (r) => <VerdictBadge value={r.status === 'ACTIVE' ? 'PASS' : 'UNJUDGED'} /> },
              { key: 'f', header: C.from, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t19(r.createdAt)}</span> },
              { key: 'u', header: C.until, cell: (r) => <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }}>{t19(r.notAfter)}</span> },
              { key: 'fp', header: C.fp, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.fingerprint}</span> },
            ]}
          />
        </AsyncView>
      </Panel>
      <div className="ds-split">
        <Panel title={S.hsm} id="sec-hsm" actions={<EpochBump />}>
          <AsyncView state={asyncState(hsm)} error={hsm.error?.message} onRetry={() => hsm.refetch()}>
            <KeyValue rows={Object.entries(hsm.data ?? {}).map(([k, v]) => ({ k: <span className="ds-mono">{k}</span>, v: <span className="ds-mono">{String(v)}</span> }))} />
          </AsyncView>
        </Panel>
        <Panel title={S.vuln} id="sec-vuln">
          <p className="ds-field__hint">{S.vulnNote}</p>
        </Panel>
      </div>
      <SecurityEventsPanel />
      <SbomPanel />
      <VexPanel />
    </div>
  );
}

interface SbomRow {
  serial: string;
  publicationId: string | null;
  featureId: string;
  featureVersion: string;
  components: number;
  originFindings: string[];
}

/** 서명 게시본별 SBOM — 원산지 누락은 발견으로(배포는 막지 않는다) */
function SbomPanel() {
  const S = M.security;
  const q = useApi<{ items: SbomRow[] }>('sbomList');
  const rows = [...(q.data?.items ?? [])].reverse();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title={S.sbom} eyebrow="D06-11 · FFG-SBOM-002·003" id="sec-sbom">
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()} rows={3}>
        <DataTable
          caption={S.sbom}
          rows={rows}
          rowKey={(r) => r.serial}
          onOpen={(r) => setOpen(r.serial)}
          columns={[
            { key: 's', header: S.sbomCol.serial, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }} title={r.serial}>{r.serial.slice(9, 17)}</span> },
            { key: 'p', header: S.sbomCol.pub, cell: (r) => <span className="ds-mono">{r.publicationId ?? '—'}</span> },
            { key: 'f', header: S.sbomCol.feature, cell: (r) => <span className="ds-mono">{`${r.featureId}@${r.featureVersion}`}</span> },
            { key: 'c', header: S.sbomCol.comps, cell: (r) => <span className="ds-mono">{r.components}</span>, align: 'right' },
            {
              key: 'o',
              header: S.sbomCol.origin,
              cell: (r) => (
                <span title={r.originFindings.join('\n') || undefined} style={{ fontSize: 'var(--fs-xs)', color: r.originFindings.length ? 'var(--warn)' : 'var(--ok)' }} data-testid={`origin-${r.serial}`}>
                  {r.originFindings.length ? S.originMissing(r.originFindings.length) : S.originOk}
                </span>
              ),
            },
          ]}
        />
      </AsyncView>
      <SbomDrawer serial={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

interface VexRow {
  statement: { vulnId: string; affects: string[]; state: string; justification?: string };
  impact: { action: string; features: { featureId: string; featureVersion: string; killPath: boolean }[] };
  at: string;
}

/** VEX 판정 기록·이력 — 영향 Feature와 조치 권고(보고서 15.2.2) */
function VexPanel() {
  const S = M.security;
  const q = useApi<{ items: VexRow[] }>('vexList');
  const perm = usePermission(['SECURITY_OFFICER', 'SAFETY_OFFICER']);
  const rec = useApiMutation('recordVex', ['vexList', 'audit']);
  const [f, setF] = useState({ vulnId: '', affects: '', state: 'under_investigation', justification: 'code_not_reachable' });
  const rows = [...(q.data?.items ?? [])].reverse();
  return (
    <Panel title={S.vex} eyebrow="D06-11 · VEX" id="sec-vex">
      <form
        style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}
        onSubmit={(e) => {
          e.preventDefault();
          const affects = f.affects.split(',').map((x) => x.trim()).filter(Boolean);
          rec.mutate({ body: { vulnId: f.vulnId.trim(), affects, state: f.state, ...(f.state === 'not_affected' ? { justification: f.justification } : {}) } }, { onSuccess: () => setF({ ...f, vulnId: '', affects: '' }) });
        }}
      >
        <Field label={S.vexForm.vuln}>
          <input className="ds-input ds-input--mono" value={f.vulnId} onChange={(e) => setF({ ...f, vulnId: e.target.value })} />
        </Field>
        <Field label={S.vexForm.affects}>
          <input className="ds-input ds-input--mono" value={f.affects} onChange={(e) => setF({ ...f, affects: e.target.value })} />
        </Field>
        <Select label={S.vexForm.state} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
          {VEX_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {f.state === 'not_affected' && (
          <Select label={S.vexForm.justification} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })}>
            {['code_not_present', 'code_not_reachable', 'requires_configuration', 'protected_at_runtime', 'protected_by_mitigating_control'].map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </Select>
        )}
        <Button type="submit" variant="primary" disabled={!perm.ok || rec.isPending || f.vulnId.trim().length < 3 || !f.affects.trim()} title={perm.hint}>
          {S.vexForm.submit}
        </Button>
      </form>
      <ErrorNote error={rec.error} />
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()} rows={2} empty={{ title: S.vexNone }}>
        <DataTable
          caption={S.vex}
          rows={rows}
          rowKey={(r) => `${r.statement.vulnId}-${r.at}`}
          columns={[
            { key: 'v', header: S.vexCol.vuln, cell: (r) => <span className="ds-mono">{r.statement.vulnId}</span> },
            { key: 's', header: S.vexCol.state, cell: (r) => <span className="ds-tag">{r.statement.state}</span> },
            { key: 'f', header: S.vexCol.features, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.impact.features.map((x) => `${x.featureId}@${x.featureVersion}${x.killPath ? ' (Kill 경로)' : ''}`).join(', ') || '—'}</span> },
            { key: 'a', header: S.vexCol.action, cell: (r) => <span style={{ fontSize: 'var(--fs-xs)', color: r.impact.action === 'NONE' ? undefined : 'var(--danger)' }}>{S.vexAction[r.impact.action] ?? r.impact.action}</span> },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

// ───────── 설정 ─────────

export function SettingsScreen() {
  const health = useApi<{ status: string; seed: string | null; counts: Record<string, number> }>('health');
  const sys = useApi<{ items: { ifId: string; name: string; mode: string }[] }>('integrationSystems');
  const S = M.settings;
  const h = health.data;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="KERNEL · CONFIG" title={S.title} lead={S.lead} />
      <div className="ds-split">
        <Panel title={S.health} id="set-health">
          <AsyncView state={asyncState(health)} error={health.error?.message} onRetry={() => health.refetch()}>
            {h && (
              <KeyValue
                rows={[
                  { k: S.health, v: <VerdictBadge value={h.status === 'ok' ? 'PASS' : 'FAIL'} /> },
                  { k: 'seed', v: <span className="ds-mono">{h.seed ?? '—'}</span> },
                  ...Object.entries(h.counts).map(([k, v]) => ({ k: <span className="ds-mono">{k}</span>, v: <span className="ds-mono">{v.toLocaleString('ko-KR')}</span> })),
                ]}
              />
            )}
          </AsyncView>
        </Panel>
        <Panel title={S.pins} id="set-pins">
          <ul className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {Object.entries(OPENFEATURE_PINS.sdks).map(([k, v]) => (
              <li key={k}>{`${k} ${v}`}</li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title={S.integrations} id="set-if" actions={<Link to="/integration/connectors">{ko.p10.integrations.title}</Link>}>
        <AsyncView state={asyncState(sys)} error={sys.error?.message} onRetry={() => sys.refetch()}>
          <DataTable
            caption={S.integrations}
            rows={sys.data?.items ?? []}
            rowKey={(r) => r.ifId}
            columns={[
              { key: 'i', header: ko.p10.integrations.col.if, cell: (r) => <span className="ds-mono">{r.ifId}</span> },
              { key: 'n', header: ko.p10.integrations.col.name, cell: (r) => r.name },
              { key: 'm', header: ko.p10.integrations.col.mode, cell: (r) => ko.p10.integrations.modes[r.mode] ?? r.mode },
            ]}
          />
        </AsyncView>
      </Panel>
    </div>
  );
}

// ───────── 컴플라이언스 (보고서 v1.1 플랫폼 규칙 추적) ─────────

function RulesTab() {
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const C = M.compliance;
  const all = useMemo(
    () =>
      Object.entries(STANDARDS_MAP)
        .map(([id, p]) => ({ id, rule: reportRule(id), wp: p.wp, components: p.components, status: RULE_STATUS[id] ?? { implemented: false, tested: false } }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    [],
  );
  const rows = all.filter((r) => filter === 'all' || (filter === 'done' ? r.status.implemented : !r.status.implemented));
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <div className="ds-kpis">
        <Kpi label={C.kpi.total} value={all.length} />
        <Kpi label={C.kpi.implemented} value={`${all.filter((r) => r.status.implemented).length}/${all.length}`} tone="ok" />
        <Kpi label={C.kpi.tested} value={`${all.filter((r) => r.status.tested).length}/${all.length}`} tone="accent" />
      </div>
      <Toolbar label={C.filter}>
        <Segmented label={C.filter} options={(['all', 'open', 'done'] as const).map((v) => ({ value: v, label: C.filters[v] }))} value={filter} onChange={(v) => setFilter(v as typeof filter)} />
      </Toolbar>
      <DataTable
        caption={C.title}
        rows={rows}
        rowKey={(r) => r.id}
        maxHeight="62vh"
        columns={[
          { key: 'i', header: C.col.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.id}</span>, sort: (r) => r.id },
          { key: 't', header: C.col.title, cell: (r) => r.rule?.title ?? '—' },
          { key: 'l', header: C.col.level, cell: (r) => <span className="ds-nowrap">{r.rule?.level ?? '—'}</span> },
          { key: 'w', header: C.col.wp, cell: (r) => <span className="ds-mono">{r.wp}</span>, sort: (r) => r.wp },
          { key: 'c', header: C.col.components, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.components.join(' · ')}</span> },
          { key: 'im', header: C.col.impl, cell: (r) => <VerdictBadge value={r.status.implemented ? 'PASS' : 'UNJUDGED'} /> },
          { key: 'te', header: C.col.test, cell: (r) => <VerdictBadge value={r.status.tested ? 'PASS' : 'UNJUDGED'} /> },
        ]}
      />
    </div>
  );
}

/** 시장 Compliance Profile(보고서 v1.1 GEN, FFG-GEN-001·003) — Profile 표와 게이트 사전 판정(profileFinding, 서버 정책 게이트와 같은 함수) */
function ProfilesTab() {
  const C = M.compliance.profiles;
  const [sim, setSim] = useState({ market: 'KR', request: 'activate', fClass: 'F2', ads: false });
  const verdict = profileFinding({ market: sim.market, request: sim.request, fClass: sim.fClass, adsFeature: sim.ads });
  const markets = [...new Set(COMPLIANCE_PROFILES.flatMap((p) => p.markets as string[]))].filter((m) => m !== 'ADS');
  const ret = sumsRetention();
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <div className="ds-kpis">
        <Kpi label={C.kpi.profiles} value={COMPLIANCE_PROFILES.length} />
        <Kpi label={C.kpi.confirmed} value={`${COMPLIANCE_PROFILES.filter((p) => p.status === 'CONFIRMED').length}/${COMPLIANCE_PROFILES.length}`} tone="ok" />
        <Kpi label={C.kpi.verify} value={COMPLIANCE_PROFILES.filter((p) => p.status !== 'CONFIRMED').length} tone="warn" />
        <Kpi label={C.kpi.sums} value={C.years(ret.yearsAfterProductionEnd)} hint={ret.basis} />
      </div>
      <Panel title={C.simTitle} eyebrow="FFG-GEN-003" id="cp-sim">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <Select label={C.sim.market} value={sim.market} onChange={(e) => setSim({ ...sim, market: e.target.value })}>
            {[...markets, 'KR', 'OTHER'].filter((m, i, a) => a.indexOf(m) === i).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select label={C.sim.request} value={sim.request} onChange={(e) => setSim({ ...sim, request: e.target.value })}>
            {['activate', 'restore', 'deactivate'].map((q) => (
              <option key={q} value={q}>
                {C.requests[q]}
              </option>
            ))}
          </Select>
          <Select label={C.sim.fClass} value={sim.fClass} onChange={(e) => setSim({ ...sim, fClass: e.target.value })}>
            {['F0', 'F1', 'F2', 'F3', 'F4'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
          <label className="ds-field ds-field--inline" style={{ paddingBottom: 'var(--sp-1)' }}>
            <input type="checkbox" checked={sim.ads} onChange={(e) => setSim({ ...sim, ads: e.target.checked })} />
            <span className="ds-field__label">{C.sim.ads}</span>
          </label>
        </div>
        <div data-testid="cp-verdict" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginTop: 'var(--sp-3)' }}>
          <VerdictBadge value={verdict.ok ? 'PASS' : 'FAIL'} />
          <span>{verdict.detail}</span>
        </div>
      </Panel>
      <DataTable
        caption={C.title}
        rows={COMPLIANCE_PROFILES}
        rowKey={(p) => p.profileId}
        maxHeight="52vh"
        columns={[
          { key: 'id', header: C.col.id, cell: (p) => <span className="ds-mono ds-nowrap">{`${p.profileId} ${p.version}`}</span>, sort: (p) => p.profileId },
          { key: 'c', header: C.col.countries, cell: (p) => p.countries },
          // 날짜(YYYY-MM-DD)가 줄바꿈에 갈리지 않게 줄바꿈 없는 하이픈으로
          { key: 'o', header: C.col.obligations, cell: (p) => p.obligations.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$1‑$2‑$3') },
          { key: 's', header: C.col.settings, cell: (p) => p.settings },
          { key: 'st', header: C.col.status, cell: (p) => <VerdictBadge value={p.status === 'CONFIRMED' ? 'PASS' : 'CONDITIONAL'} />, sort: (p) => p.status },
        ]}
      />
    </div>
  );
}

export function ComplianceScreen() {
  const C = M.compliance;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D03-01 · Report v1.1 FFG" title={C.title} lead={C.lead} actions={<Link to="/arch/components">{ko.arch.title}</Link>} />
      <Tabs tabs={[{ key: 'rules', label: C.tabs.rules }, { key: 'profiles', label: C.tabs.profiles }]}>{(t) => (t === 'profiles' ? <ProfilesTab /> : <RulesTab />)}</Tabs>
    </div>
  );
}

// ───────── SW EO ─────────

export function EoScreen() {
  const q = useApi<{ items: { swId: string; version: string; name: string; ecuPno: string; lifecycle: string; features: string[] }[] }>('masterSw');
  const [multi, setMulti] = useState(true);
  const groups = useMemo(() => {
    const by = new Map<string, { swId: string; name: string; ecuPno: string; versions: { version: string; lifecycle: string; features: string[] }[] }>();
    for (const r of q.data?.items ?? []) {
      const g = by.get(r.swId) ?? { swId: r.swId, name: r.name, ecuPno: r.ecuPno, versions: [] };
      g.versions.push({ version: r.version, lifecycle: r.lifecycle, features: r.features });
      by.set(r.swId, g);
    }
    return [...by.values()].map((g) => ({ ...g, versions: g.versions.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })) }));
  }, [q.data]);
  const rows = multi ? groups.filter((g) => g.versions.length > 1) : groups;
  const E = M.eo;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D01-02 · SW EO" title={E.title} lead={E.lead} />
      <Toolbar label={E.onlyMulti}>
        <label className="ds-field ds-field--inline">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          <span className="ds-field__label">{E.onlyMulti}</span>
        </label>
      </Toolbar>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
        <DataTable
          caption={E.title}
          rows={rows}
          rowKey={(r) => r.swId}
          columns={[
            { key: 's', header: E.col.sw, cell: (r) => <span className="ds-mono ds-nowrap">{r.swId}</span>, sort: (r) => r.swId },
            { key: 'n', header: E.col.name, cell: (r) => r.name },
            { key: 'e', header: E.col.ecu, cell: (r) => <span className="ds-mono ds-nowrap">{r.ecuPno}</span> },
            { key: 'v', header: E.col.versions, cell: (r) => <span className="ds-mono">{r.versions.map((v) => `${v.version}(${v.lifecycle})`).join(' → ')}</span>, sort: (r) => r.versions.length },
            { key: 'f', header: E.col.features, cell: (r) => <span className="ds-chips">{r.versions.flatMap((v) => v.features).map(fref)}</span> },
          ]}
        />
      </AsyncView>
    </div>
  );
}

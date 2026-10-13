// /ops/incidents — 장애·VOC 이력 연계 (D04-05). VOC 가져오기·현장 접수, SOTIF 트리거면 이상 징후(D06-12)로 넘어간 결과를 함께 본다.
// /field — 현장 지원 포털 (D05-05). VIN 하나로 Feature 상태 종합 조회, 현장 접수는 장애·VOC로.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, PageHeader, Panel, Select, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';

const I = ko.p10.incident;
const F = ko.p10.field;
const SEV_BADGE: Record<string, string> = { INFO: 'UNJUDGED', WARNING: 'CONDITIONAL', CRITICAL: 'FAIL' };
const CATEGORIES = ['UNEXPECTED_ACTIVATION', 'NO_ACTIVATION', 'PERFORMANCE', 'HMI', 'OTHER'];
const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

export interface IncidentRow {
  incidentId: string;
  source: string;
  externalRef: string | null;
  vin: string | null;
  featureId: string | null;
  category: string;
  severity: string;
  summary: string;
  status: string;
  sotif: { trigger: boolean; reason: string };
  anomalyId: string | null;
  anomaly: { severity: string; advice: string; status: string } | null;
}

export function IncidentsScreen() {
  const [source, setSource] = useState('');
  const list = useApi<{ items: IncidentRow[] }>('incidents', { query: { source: source || undefined } });
  const perm = usePermission(['OPERATOR', 'SYSTEM']);
  const importVoc = useApiMutation<{ created: IncidentRow[]; skipped: number }>('importVoc', ['incidents', 'anomalies', 'events', 'audit']);
  const rows = list.data?.items ?? [];
  const C = I.col;
  return (
    <div className="ds-screen">
      <PageHeader
        eyebrow="D04-05 · INCIDENT · VOC · FFG-SOT-003"
        title={I.title}
        lead={I.lead}
        actions={
          <Button variant="primary" disabled={!perm.ok || importVoc.isPending || STATIC_MODE} title={perm.hint} onClick={() => importVoc.mutate({ body: {} })}>
            {I.importVoc}
          </Button>
        }
      />
      {importVoc.data && (
        <p className="ds-ok" role="status">
          {I.imported(importVoc.data.created.length, importVoc.data.skipped)}
        </p>
      )}
      <ErrorNote error={importVoc.error} />
      <Toolbar label={I.source}>
        <Select label={I.source} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">{I.any}</option>
          {Object.entries(I.sources).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={asyncState(list, rows.length === 0)} empty={{ title: I.empty }} error={list.error?.message} onRetry={() => list.refetch()}>
        <DataTable
          caption={I.title}
          rows={rows}
          rowKey={(r) => r.incidentId}
          columns={[
            { key: 'id', header: C.id, cell: (r) => <span className="ds-mono ds-nowrap">{r.incidentId}</span> },
            { key: 'src', header: C.source, cell: (r) => <span className="ds-nowrap">{I.sources[r.source]}</span> },
            { key: 'vin', header: C.vin, cell: (r) => <span className="ds-mono ds-nowrap">{r.vin ?? '—'}</span> },
            { key: 'f', header: C.feature, cell: (r) => <span className="ds-mono ds-nowrap">{r.featureId ?? '—'}</span> },
            { key: 'cat', header: C.category, cell: (r) => <span className="ds-nowrap">{I.categories[r.category]}</span> },
            { key: 'sev', header: C.severity, cell: (r) => <VerdictBadge value={SEV_BADGE[r.severity]} /> },
            { key: 'sotif', header: C.sotif, cell: (r) => <span title={r.sotif.reason} className="ds-nowrap">{r.sotif.trigger ? I.sotifYes : I.sotifNo}</span> },
            { key: 'anm', header: C.anomaly, cell: (r) => (r.anomalyId ? <Link to={`/ops/anomalies?id=${r.anomalyId}`} className="ds-mono">{`${r.anomalyId} · ${r.anomaly?.advice ?? ''}`}</Link> : '—') },
            { key: 'sum', header: C.summary, cell: (r) => r.summary },
          ]}
        />
      </AsyncView>
      <IncidentForm />
    </div>
  );
}

function IncidentForm() {
  const perm = usePermission(['OPERATOR', 'SYSTEM']);
  const create = useApiMutation<IncidentRow>('createIncident', ['incidents', 'anomalies', 'events', 'audit']);
  const [f, setF] = useState({ vin: '', featureId: '', category: 'UNEXPECTED_ACTIVATION', severity: 'WARNING', summary: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (STATIC_MODE) return null;
  return (
    <Panel title={I.create} id="incident-create">
      <div className="ds-toolbar">
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{I.vin}</span>
          <input className="ds-input ds-input--mono" value={f.vin} onChange={set('vin')} style={{ width: 140 }} />
        </label>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{I.feature}</span>
          <input className="ds-input ds-input--mono" value={f.featureId} placeholder="FEAT-00022" onChange={set('featureId')} style={{ width: 120 }} />
        </label>
        <Select label={I.category} value={f.category} onChange={set('category')}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{I.categories[c]}</option>
          ))}
        </Select>
        <Select label={I.severity} value={f.severity} onChange={set('severity')}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
      <Field label={I.summary}>
        <input className="ds-input" value={f.summary} maxLength={500} onChange={set('summary')} />
      </Field>
      <ErrorNote error={create.error} />
      <Button
        variant="primary"
        disabled={!perm.ok || f.summary.trim().length < 4 || create.isPending}
        title={perm.hint}
        onClick={() => create.mutate({ body: { source: 'FIELD', vin: f.vin.trim() || null, featureId: f.featureId.trim() || null, category: f.category, severity: f.severity, summary: f.summary.trim() } }, { onSuccess: () => setF((x) => ({ ...x, summary: '' })) })}
      >
        {I.submit}
      </Button>
    </Panel>
  );
}

interface FieldView {
  vehicle: { vin: string; label: string; country: string; vehicleModel: string; trim: string; swVersion: string };
  flags: { flagKey: string; featureId: string | null; value: boolean; reason: string; policyId: string | null }[];
  entitlements: { grantId: string; catalogId: string; kind: string; state: string; validTo: string; effective: boolean }[];
  kills: { killId: string; featureIds: string[]; status: string; reason: string }[];
  anomalies: { anomalyId: string; kind: string; featureId: string; severity: string; advice: string; mine: boolean }[];
  incidents: { incidentId: string; source: string; category: string; severity: string; status: string; summary: string }[];
}

export function FieldPortalScreen() {
  const [sp, setSp] = useSearchParams();
  const vin = sp.get('vin') ?? 'ego-01';
  const [input, setInput] = useState(vin);
  const q = useApi<FieldView>('fieldVehicle', { params: { vin } });
  const d = q.data;
  const C = F.col;
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D05-05 · FIELD SUPPORT" title={F.title} lead={F.lead} />
      <Toolbar label={F.vin}>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{F.vin}</span>
          <input className="ds-input ds-input--mono" value={input} onChange={(e) => setInput(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && setSp({ vin: input })} />
        </label>
        <Button onClick={() => setSp({ vin: input })}>{F.lookup}</Button>
      </Toolbar>
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <p className="ds-mono">{`${d.vehicle.vin} · ${d.vehicle.label} · ${d.vehicle.country} ${d.vehicle.vehicleModel} ${d.vehicle.trim} · SW ${d.vehicle.swVersion}`}</p>
            <div className="ds-split">
              <Panel title={F.flags} id="field-flags">
                <DataTable caption={F.flags} rows={d.flags} rowKey={(r) => r.flagKey} columns={[
                  { key: 'k', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span> },
                  { key: 'f', header: C.feature, cell: (r) => <span className="ds-mono">{r.featureId ?? '—'}</span> },
                  { key: 'v', header: C.value, cell: (r) => <strong className="ds-mono">{r.value ? 'ON' : 'OFF'}</strong> },
                  { key: 'r', header: C.reason, cell: (r) => <span className="ds-mono">{r.reason}</span> },
                ]} />
              </Panel>
              <Panel title={F.entitlements} id="field-entitlements">
                {d.entitlements.length ? (
                  <DataTable caption={F.entitlements} rows={d.entitlements} rowKey={(r) => r.grantId} columns={[
                    { key: 'g', header: C.grant, cell: (r) => <span className="ds-mono">{`${r.grantId} · ${r.catalogId}`}</span> },
                    { key: 'k', header: C.kind, cell: (r) => r.kind },
                    { key: 's', header: C.state, cell: (r) => <span className="ds-mono">{r.state}</span> },
                    { key: 'u', header: C.until, cell: (r) => <span className="ds-mono">{r.validTo}</span> },
                  ]} />
                ) : (
                  <p className="ds-field__hint">{F.none}</p>
                )}
              </Panel>
            </div>
            <div className="ds-split">
              <Panel title={F.kills} id="field-kills">
                {d.kills.length ? <ul>{d.kills.map((k) => <li key={k.killId}><Link to={`/ops/kill?id=${k.killId}`} className="ds-mono">{k.killId}</Link>{` · ${k.featureIds.join(', ')} · ${k.status} · ${k.reason}`}</li>)}</ul> : <p className="ds-field__hint">{F.none}</p>}
              </Panel>
              <Panel title={F.anomalies} id="field-anomalies">
                {d.anomalies.length ? <ul>{d.anomalies.map((a) => <li key={a.anomalyId}><Link to={`/ops/anomalies?id=${a.anomalyId}`} className="ds-mono">{a.anomalyId}</Link>{` · ${a.kind} · ${a.featureId} · ${a.severity} · ${a.advice}${a.mine ? ` · ${F.mine}` : ''}`}</li>)}</ul> : <p className="ds-field__hint">{F.none}</p>}
              </Panel>
            </div>
            <Panel title={F.incidents} id="field-incidents">
              {d.incidents.length ? (
                <DataTable caption={F.incidents} rows={d.incidents} rowKey={(r) => r.incidentId} columns={[
                  { key: 'i', header: C.incident, cell: (r) => <span className="ds-mono">{r.incidentId}</span> },
                  { key: 'c', header: C.category, cell: (r) => I.categories[r.category] },
                  { key: 's', header: C.severity, cell: (r) => <VerdictBadge value={SEV_BADGE[r.severity]} /> },
                  { key: 'm', header: C.summary, cell: (r) => r.summary },
                ]} />
              ) : (
                <p className="ds-field__hint">{F.none}</p>
              )}
            </Panel>
            <FieldCase vin={d.vehicle.vin} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function FieldCase({ vin }: { vin: string }) {
  const perm = usePermission(['OPERATOR']);
  const create = useApiMutation<IncidentRow>('createFieldCase', ['fieldVehicle', 'incidents', 'anomalies', 'events', 'audit']);
  const [f, setF] = useState({ featureId: '', category: 'NO_ACTIVATION', severity: 'WARNING', summary: '', dealer: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (STATIC_MODE) return null;
  return (
    <Panel title={F.caseTitle} id="field-case">
      <div className="ds-toolbar">
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{I.feature}</span>
          <input className="ds-input ds-input--mono" value={f.featureId} placeholder="FEAT-00022" onChange={set('featureId')} style={{ width: 120 }} />
        </label>
        <Select label={I.category} value={f.category} onChange={set('category')}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{I.categories[c]}</option>
          ))}
        </Select>
        <Select label={I.severity} value={f.severity} onChange={set('severity')}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{F.dealer}</span>
          <input className="ds-input" value={f.dealer} onChange={set('dealer')} />
        </label>
      </div>
      <Field label={I.summary}>
        <input className="ds-input" value={f.summary} maxLength={500} onChange={set('summary')} />
      </Field>
      <ErrorNote error={create.error} />
      {create.data && <p className="ds-ok" role="status">{F.submitted(create.data.incidentId)}</p>}
      <Button
        variant="primary"
        disabled={!perm.ok || f.summary.trim().length < 4 || f.dealer.trim().length < 2 || create.isPending}
        title={perm.hint}
        onClick={() => create.mutate({ body: { vin, featureId: f.featureId.trim() || null, category: f.category, severity: f.severity, summary: f.summary.trim(), dealer: f.dealer.trim() } }, { onSuccess: () => setF((x) => ({ ...x, summary: '' })) })}
      >
        {F.submit}
      </Button>
    </Panel>
  );
}

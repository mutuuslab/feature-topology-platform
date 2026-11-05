import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DATA_CATEGORY_ACCESS } from '@ff/contracts';
import { canAct } from '../../../api/actor';
import { useApi } from '../../../api/hooks';
import { operationOverview as O } from '../../../copy/operation-overview';
import { ExternalToolLaunchers } from '../../../external/launchers';
import { buildOperationModel, UNKNOWN_GROUP, type OperationEvent, type OperationFeature, type OperationInput, type OperationPolicy, type OperationPreparationIssue, type OperationPublication, type OperationReadback, type OperationRuntime, type OperationState, type OperationSync, type OperationVehicle } from './operation-overview-model';
import './operation-overview.css';

export const OPERATION_APIS = ['fleetRuntime', 'vehicles', 'listPolicies', 'listFeatures', 'publications', 'readbacks', 'integrationCalls'];
const STATES: OperationState[] = ['ON', 'OFF', 'SAFE', 'UNKNOWN'];
const PHASES = ['SYNC', 'DEPLOY', 'READBACK'] as const;
type Raw = Record<string, any>;
const object = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string';
const array = <T,>(value: unknown, valid: (row: Raw) => boolean): T[] | undefined => object(value) && Array.isArray(value.items) && value.items.every((row) => object(row) && valid(row)) ? value.items as T[] : undefined;
const runtimeRows = (v: unknown) => array<OperationRuntime>(v, (r) => text(r.vin) && text(r.quality) && text(r.link) && Array.isArray(r.flags) && r.flags.every((f: Raw) => object(f) && text(f.flagKey) && object(f.local) && typeof f.local.value === 'boolean' && text(f.local.reason)));
const vehicleRows = (v: unknown) => array<OperationVehicle>(v, (r) => text(r.vin) && (r.country === undefined || text(r.country)) && (r.vehicleModel === undefined || text(r.vehicleModel)));
const policyRows = (v: unknown) => array<OperationPolicy>(v, (r) => [r.policyId, r.featureId, r.featureVersion, r.flagKey, r.status].every(text) && Number.isSafeInteger(r.revision));
const featureRows = (v: unknown) => array<OperationFeature>(v, (r) => [r.featureId, r.version, r.country, r.vehicleModel].every(text));
const publicationRows = (v: unknown) => array<OperationPublication>(v, (r) => [r.publicationId, r.createdAt, r.status].every(text) && object(r.payload) && Array.isArray(r.payload.targets) && r.payload.targets.every(text) && (r.payload.policy === null || (object(r.payload.policy) && text(r.payload.policy.policyId) && Number.isSafeInteger(r.payload.policy.revision))));
const readbackRows = (v: unknown) => array<OperationReadback>(v, (r) => [r.vin, r.publicationId, r.at, r.metricType, r.observed].every(text) && (r.rejectReason === undefined || text(r.rejectReason)));
const syncRows = (v: unknown) => array<OperationSync>(v, (r) => text(r.at) && object(r.request) && object(r.response));
const stamp = (at: string | undefined) => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : O.unspecified;

function GroupChart({ groups, title, onSelect }: { groups: ReturnType<typeof buildOperationModel>['countryGroups']; title: string; onSelect: (name: string) => void }) {
  return <section className="operation-groupchart" aria-label={title}><h3>{title}</h3>{!groups.length ? <p className="operation-note">{O.noRows}</p> : <ul>{groups.slice(0, 8).map((group) => <li key={group.name}><button type="button" onClick={() => onSelect(group.name)} aria-label={O.group(group.name === UNKNOWN_GROUP ? O.unspecified : group.name, group.total)}>{group.name === UNKNOWN_GROUP ? O.unspecified : group.name}</button><span className="operation-stack" role="img" aria-label={STATES.map((state) => `${O.state[state]} ${group.states[state]}`).join(', ')}>{STATES.map((state) => <span key={state} className="operation-state" data-state={state} style={{ width: `${group.states[state] / group.total * 100}%` }} />)}</span><span className="operation-groupchart__count">{group.total}</span></li>)}</ul>}{groups.length > 8 && <p className="operation-note">{O.groupMore(groups.length)}</p>}</section>;
}

function TimeDistribution({ events, ready, preparationIssues }: { events: OperationEvent[]; ready: Record<OperationEvent['phase'], boolean>; preparationIssues: OperationPreparationIssue[] }) {
  const groups = new Map<string, { phase: OperationEvent['phase']; time: number; events: OperationEvent[] }>();
  for (const event of events) {
    if (!ready[event.phase]) continue;
    const time = Date.parse(event.at), key = `${event.phase}:${Math.floor(time / 60_000)}`;
    const group = groups.get(key) ?? { phase: event.phase, time, events: [] };
    group.events.push(event); groups.set(key, group);
  }
  const points = [...groups.values()];
  const times = points.map((p) => p.time), min = Math.min(...times), max = Math.max(...times);
  const x = (t: number) => min === max ? 470 : 155 + (t - min) / (max - min) * 630;
  return <section className="operation-timeline" aria-label={O.timeline}><h3>{O.timeline}</h3>
    {!points.length ? <p className="operation-note">{O.noEvents} {PHASES.map((phase) => `${O.phase[phase]}: ${ready[phase] ? O.noPhase : O.restricted}`).join(' · ')}</p> : <svg viewBox="0 0 850 170" role="group" aria-label={O.timeline}>
      {PHASES.map((phase, i) => <g key={phase}><text x="0" y={30 + i * 45} className="operation-timeline__label">{O.phase[phase]}</text><line x1="150" x2="790" y1={26 + i * 45} y2={26 + i * 45} className="operation-timeline__axis" />{!points.some((p) => p.phase === phase) && <text x="470" y={30 + i * 45} textAnchor="middle" className="operation-timeline__tick">{ready[phase] ? O.noPhase : O.restricted}</text>}</g>)}
      {points.map((point, i) => {
        const first = point.events.find((e) => e.failed) ?? point.events[0];
        return <Link key={i} to={first.to} aria-label={`${O.event(O.phase[point.phase], stamp(first.at), point.events.length)} · ${first.label}`}><circle cx={x(point.time)} cy={26 + PHASES.indexOf(point.phase) * 45} r={Math.min(12, 4 + Math.sqrt(point.events.length))} className="operation-timeline__point" data-failed={point.events.some((e) => e.failed)}><title>{`${O.event(O.phase[point.phase], stamp(first.at), point.events.length)} · ${first.label}`}</title></circle></Link>;
      })}
      <text x="150" y="157" className="operation-timeline__tick">{stamp(new Date(min).toISOString())}</text>{max !== min && <text x="790" y="157" textAnchor="end" className="operation-timeline__tick">{stamp(new Date(max).toISOString())}</text>}
    </svg>}
    <p className="operation-note">{O.timelineBasis} {O.syncRecent}</p>
    {preparationIssues.length > 0 && <section className="operation-note" aria-label={O.preparation}>{!ready.SYNC ? <p role="status">{O.syncUnavailable}</p> : <details><summary><strong>{O.preparationPending(preparationIssues.length)}</strong></summary><ul>{preparationIssues.map((issue) => <li key={issue.publicationId}><Link to={`/deployments/${encodeURIComponent(issue.publicationId)}`}>{`${issue.publicationId} · ${issue.policyId}@r${issue.revision}`}</Link>{` · ${O.preparationReason[issue.reason]}`}</li>)}</ul></details>}</section>}
    <div className="operation-recent" role="group" aria-label={O.recent}>{events.filter((e) => ready[e.phase]).slice(-6).reverse().map((event, i) => <Link key={i} to={event.to}>{`${O.phase[event.phase]} · ${stamp(event.at)} · ${event.label}`}</Link>)}</div>
  </section>;
}

export default function ReadOnlyOperationOverview({ role }: { role: string }) {
  const qc = useQueryClient();
  const [country, setCountry] = useState(''), [model, setModel] = useState(''), [flag, setFlag] = useState('');
  const [limit, setLimit] = useState(12);
  const canRead = canAct(role, DATA_CATEGORY_ACCESS.SAFETY_OPERATION);
  const fleet = useApi<unknown>('fleetRuntime');
  const vehicles = useApi<unknown>('vehicles');
  const policies = useApi<unknown>('listPolicies');
  const features = useApi<unknown>('listFeatures');
  const pubs = useApi<unknown>('publications');
  const replies = useApi<unknown>('readbacks', {}, { enabled: canRead });
  const syncs = useApi<unknown>('integrationCalls', { query: { ifId: 'IF-04' } });
  const runtime = runtimeRows(fleet.data), vehicle = vehicleRows(vehicles.data), policy = policyRows(policies.data), feature = featureRows(features.data), publication = publicationRows(pubs.data), readback = readbackRows(replies.data), sync = syncRows(syncs.data);
  const input: OperationInput = { runtime: runtime ?? [], vehicles: vehicle ?? [], policies: policy ?? [], features: feature ?? [], publications: publication ?? [], readbacks: canRead ? readback ?? [] : [], syncs: sync ?? [] };
  const data = useMemo(() => buildOperationModel(input, { country, model, flag }), [runtime, vehicle, policy, feature, publication, readback, sync, country, model, flag, canRead]);
  const policyReady = !!policy && !!feature;
  const readReady = canRead && !!readback && !!publication && (!flag || !!policy);
  const refresh = () => void Promise.all(OPERATION_APIS.map((name) => qc.invalidateQueries({ queryKey: [name] })));
  const select = (kind: 'country' | 'model', value: string) => { if (kind === 'country') setCountry(value); else setModel(value); setLimit(12); document.getElementById('operation-vehicles')?.scrollIntoView?.({ block: 'nearest' }); };
  const loading = fleet.isPending || vehicles.isPending;
  const invalid = !loading && (!runtime || !vehicle);
  const optionalError = (!policies.isPending && !policy) || (!features.isPending && !feature) || (!pubs.isPending && !publication) || (!syncs.isPending && !sync) || (canRead && !replies.isPending && !readback);
  const kpis = [
    { key: 'vehicles', label: O.vehicles, value: data.rows.length, busy: false },
    { key: 'deployed', label: O.deployed, value: policyReady ? data.deployed : '—', busy: policies.isPending || features.isPending },
    { key: 'received', label: O.received, value: data.rows.length ? `${Math.round(data.received / data.rows.length * 100)}%` : '—', detail: O.receivedCount(data.received, data.rows.length), busy: false },
    { key: 'unknown', label: O.unknown, value: data.unknown, busy: false },
    { key: 'approvals', label: O.approvals, value: policyReady ? data.approvals : '—', busy: policies.isPending || features.isPending },
    { key: 'rejected', label: O.rejected, value: readReady ? data.rejected : '—', busy: canRead && (replies.isPending || pubs.isPending) },
  ];
  return <>
    <ExternalToolLaunchers compact />
    <section className="operation-overview" aria-label={O.title}>
      <div className="operation-overview__head"><div><h2>{O.title}</h2><p>{O.lead}</p></div><div className="operation-overview__links"><Link to={`/fleet/map?lens=activation${flag ? `&flagKey=${encodeURIComponent(flag)}` : ''}`}>{O.map}</Link><Link to="/deployments">{O.deployments}</Link><button type="button" className="ds-btn" onClick={refresh}>{O.refresh}</button></div></div>
      {loading ? <div className="ds-skel" data-state="loading" aria-busy="true" role="progressbar" aria-label={O.loading}><span /><span /></div> : invalid ? <p role="alert" data-state="error">{O.badData}</p> : <>
        <div className="operation-filter" role="group" aria-label={O.filters}>
          <label>{O.country}<select className="ds-input" value={country} onChange={(e) => { setCountry(e.target.value); setLimit(12); }}><option value="">{O.all}</option>{data.countries.map((value) => <option key={value} value={value}>{value === UNKNOWN_GROUP ? O.unspecified : value}</option>)}</select></label>
          <label>{O.model}<select className="ds-input" value={model} onChange={(e) => { setModel(e.target.value); setLimit(12); }}><option value="">{O.all}</option>{data.models.map((value) => <option key={value} value={value}>{value === UNKNOWN_GROUP ? O.unspecified : value}</option>)}</select></label>
          <label>{O.flag}<select className="ds-input" value={flag} onChange={(e) => { setFlag(e.target.value); setLimit(12); }}><option value="">{O.all}</option>{flag && !data.flags.includes(flag) && <option>{flag}</option>}{data.flags.map((value) => <option key={value}>{value}</option>)}</select></label>
          <button type="button" className="ds-btn" onClick={() => { setCountry(''); setModel(''); setFlag(''); setLimit(12); }}>{O.clear}</button>
        </div>
        <dl className="operation-kpis">{kpis.map((kpi) => <div key={kpi.key} data-metric={kpi.key}><dt>{kpi.label}</dt><dd aria-busy={kpi.busy}>{kpi.value}{kpi.detail && <small>{kpi.detail}</small>}</dd></div>)}</dl>
        <p className="operation-note">{O.receivedBasis}. {O.stateBasis}</p>
        {optionalError && <p className="operation-note" role="status">{O.unavailable}</p>}{!canRead && <p className="operation-note">{O.noAccess}</p>}
        <ul className="operation-state-legend">{STATES.map((state) => <li key={state}><i className="operation-state" data-state={state} aria-hidden="true" />{O.state[state]}</li>)}</ul>
        <div className="operation-charts"><GroupChart groups={data.countryGroups} title={O.countryChart} onSelect={(value) => select('country', value)} /><GroupChart groups={data.modelGroups} title={O.modelChart} onSelect={(value) => select('model', value)} /></div><p className="operation-note">{O.chartHelp}</p>
        <TimeDistribution events={data.events} ready={{ DEPLOY: !!publication, SYNC: !!sync && !!publication, READBACK: readReady }} preparationIssues={data.preparationIssues} />
        {!!data.invalidTimes && <p className="operation-note">{O.invalidTimes(data.invalidTimes)}</p>}
        <div id="operation-vehicles" className="operation-table" role="region" aria-label={O.table} tabIndex={0}><table><caption className="ds-sr">{O.table}</caption><thead><tr>{[O.vin, O.scope, O.stateCol, O.policy, O.last, O.link, O.reason].map((title) => <th scope="col" key={title}>{title}</th>)}</tr></thead><tbody>
          {data.rows.slice(0, limit).map((row) => <tr key={row.runtime.vin}>
            <td><Link to={`/fleet/vehicles/${encodeURIComponent(row.runtime.vin)}`}><code>{row.runtime.vin}</code></Link></td>
            <td>{`${row.vehicle?.country || O.unspecified} / ${row.vehicle?.vehicleModel || O.unspecified}`}</td>
            <td><span className="operation-table__state operation-state" data-state={row.state}>{O.state[row.state]}</span></td>
            <td className="operation-table__policy">{!row.flags.length ? O.noPolicy : row.flags.map((f) => { const pub = f.publicationId ? data.publicationById.get(f.publicationId) : undefined; const policy = pub?.payload.policy; return <div key={f.flagKey}><code>{f.flagKey}</code>{f.publicationId ? <Link to={`/deployments/${encodeURIComponent(f.publicationId)}`}>{policy ? `${policy.policyId} · r${policy.revision}` : `${f.publicationId} · ${O.unspecified}`}</Link> : O.noPolicy}</div>; })}</td>
            <td>{row.readback ? <Link to={`/deployments/${encodeURIComponent(row.readback.publicationId)}`}>{stamp(row.readback.at)}</Link> : O.noReadback}</td>
            <td>{row.runtime.link === 'ONLINE' ? O.online : row.runtime.link === 'OFFLINE' ? O.offline : O.unspecified}</td>
            <td>{row.readback?.rejectReason || (row.runtime.quality !== 'TRUSTED' ? row.runtime.quality : row.flags.map((f) => f.local.reason).join(', ') || O.unspecified)}</td>
          </tr>)}
          {!data.rows.length && <tr><td colSpan={7}>{runtime.length ? O.noRows : O.noRuntime}</td></tr>}
        </tbody></table></div>
        <div className="operation-overview__footer"><span>{O.showing(Math.min(limit, data.rows.length), data.rows.length)}</span>{limit < data.rows.length && <button type="button" className="ds-btn" onClick={() => setLimit((value) => value + 12)}>{O.more}</button>}<span>{O.snapshot}: {stamp(fleet.dataUpdatedAt ? new Date(fleet.dataUpdatedAt).toISOString() : undefined)}</span></div>
      </>}
    </section>
  </>;
}

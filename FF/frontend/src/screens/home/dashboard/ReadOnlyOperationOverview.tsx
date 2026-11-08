import { lazy, Suspense, useMemo, useState } from 'react';
import { uiLocaleTag } from '../../../locale/runtime';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DATA_CATEGORY_ACCESS } from '@ff/contracts';
import { useApi } from '../../../api/hooks';
import { operationOverview as O } from '../../../copy/operation-overview';
import { ExternalToolLaunchers } from '../../../external/launchers';
import { canRead as canReadAs } from '../../shared';
import { buildOperationModel, OPERATION_PAGE, recentEvents, timelinePoints, UNKNOWN_GROUP, type OperationAttention, type OperationEvent, type OperationFeature, type OperationGroup, type OperationInput, type OperationPolicy, type OperationPreparationIssue, type OperationPublication, type OperationReadback, type OperationReady, type OperationReplyGap, type OperationRuntime, type OperationState, type OperationSummary, type OperationSummaryRow, type OperationSync, type OperationTimelinePoint, type OperationVehicle } from './operation-overview-model';
import { AttentionList, FlowStrip, GroupBars, KpiCards, KpiHero, MyWork, PreparationList, ReplyGapList, type Kpi } from './overview-visuals';
import type { OperationAdoption } from '@ff/contracts';
import './operation-overview.css';

// 'Feature 적용 현황'(Canvas 점 지도·깔때기·되감기) — 지연 묶음. 요약에 adoption이 실릴 때만 받는다
const AdoptionPanel = lazy(() => import('./AdoptionPanel'));
/** 요약의 적용 현황 — 모양이 맞을 때만(옛 요약·깨진 응답이면 위젯을 그리지 않는다) */
export const adoptionOf = (v: unknown): OperationAdoption | undefined => {
  const a = (v && typeof v === 'object' ? (v as { adoption?: unknown }).adoption : undefined) as OperationAdoption | undefined;
  if (!a || !Array.isArray(a.vins) || !Array.isArray(a.countries) || typeof a.country !== 'string' || a.country.length !== a.vins.length || !Array.isArray(a.flags) || !a.flags.length) return undefined;
  return a.flags.every((f) => f && typeof f.flagKey === 'string' && typeof f.state === 'string' && f.state.length === a.vins.length && typeof f.stage === 'string' && f.stage.length === a.vins.length && Array.isArray(f.at) && f.at.length === a.vins.length && !!f.funnel && !!f.states && Array.isArray(f.markers)) ? a : undefined;
};

export const OPERATION_APIS = ['operationSummary', 'fleetRuntime', 'vehicles', 'listPolicies', 'listFeatures', 'publications', 'readbacks', 'integrationCalls'];
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
// 서버 요약 — 모양이 맞지 않으면 전체 목록으로 화면에서 센다(예전 방식)
const summaryOf = (v: unknown): OperationSummary | undefined => object(v) && Number.isSafeInteger(v.total) && typeof v.readbacks === 'boolean' && [v.rows, v.countryGroups, v.modelGroups, v.points, v.recent, v.preparationIssues, v.publications, v.countries, v.models, v.flags].every(Array.isArray) && v.rows.every((r: Raw) => object(r) && object(r.runtime) && text(r.runtime.vin) && Array.isArray(r.flags)) ? v as OperationSummary : undefined;
// 시각 형식기는 하나만 — toLocaleString(옵션)은 부를 때마다 형식기를 새로 만들어 점·행이 많으면 느렸다
let stampFormat: Intl.DateTimeFormat | undefined;
let stampLocale: string | undefined;
const stamp = (at: string | undefined) => {
  if (!at || !Number.isFinite(Date.parse(at))) return O.unspecified;
  const locale = uiLocaleTag();
  if (!stampFormat || stampLocale !== locale) {
    stampFormat = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    stampLocale = locale;
  }
  return stampFormat.format(new Date(at));
};

function TimeDistribution({ points, recent, ready }: { points: OperationTimelinePoint[]; recent: OperationEvent[]; ready: OperationReady }) {
  const times = points.map((p) => p.time), min = Math.min(...times), max = Math.max(...times);
  const x = (t: number) => min === max ? 470 : 155 + (t - min) / (max - min) * 630;
  return <section className="operation-timeline" aria-label={O.timeline}><h3>{O.timeline}</h3>
    {!points.length ? <p className="operation-note">{O.noEvents} {PHASES.map((phase) => `${O.phase[phase]}: ${ready[phase] ? O.noPhase : O.restricted}`).join(' · ')}</p> : <svg viewBox="0 0 850 170" role="group" aria-label={O.timeline}>
      {PHASES.map((phase, i) => <g key={phase}><text x="0" y={30 + i * 45} className="operation-timeline__label">{O.phase[phase]}</text><line x1="150" x2="790" y1={26 + i * 45} y2={26 + i * 45} className="operation-timeline__axis" />{!points.some((p) => p.phase === phase) && <text x="470" y={30 + i * 45} textAnchor="middle" className="operation-timeline__tick">{ready[phase] ? O.noPhase : O.restricted}</text>}</g>)}
      {points.map((point, i) => {
        const first = point.first, label = `${O.event(O.phase[point.phase], stamp(first.at), point.count)} · ${first.label}`;
        const cx = x(point.time), cy = 26 + PHASES.indexOf(point.phase) * 45, r = Math.min(12, 4 + Math.sqrt(point.count));
        // 실패가 섞인 묶음은 사각(색만으로 가르지 않는다)
        return <Link key={i} to={first.to} aria-label={label}>{point.failed ? <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} className="operation-timeline__point" data-failed="true"><title>{label}</title></rect> : <circle cx={cx} cy={cy} r={r} className="operation-timeline__point" data-failed={point.failed}><title>{label}</title></circle>}</Link>;
      })}
      <text x="150" y="157" className="operation-timeline__tick">{stamp(new Date(min).toISOString())}</text>{max !== min && <text x="790" y="157" textAnchor="end" className="operation-timeline__tick">{stamp(new Date(max).toISOString())}</text>}
    </svg>}
    {!!points.length && <div className="operation-timeline__legend" aria-label={O.timelineSize}>
      {[1, 10, 50].map((n) => <span key={n}><svg width="26" height="26" aria-hidden="true"><circle cx="13" cy="13" r={Math.min(12, 4 + Math.sqrt(n))} className="operation-timeline__point" /></svg>{O.records(n)}</span>)}
      <span><svg width="26" height="26" aria-hidden="true"><rect x="6" y="6" width="14" height="14" className="operation-timeline__point" data-failed="true" /></svg>{O.timelineFailed}</span>
    </div>}
    <p className="operation-note">{O.timelineSize}</p>
    <details className="ov-basis"><summary>{O.basis}</summary><p className="operation-note">{O.timelineBasis} {O.syncRecent}</p></details>
    <div className="operation-recent" role="group" aria-label={O.recent}>{recent.map((event, i) => <Link key={i} to={event.to}>{`${O.phase[event.phase]} · ${stamp(event.at)} · ${event.label}`}</Link>)}</div>
  </section>;
}

/** 화면에 그리는 값 — 서버 요약(거르지 않은 첫 화면) 또는 전체 목록으로 센 모델 */
interface View {
  total: number; received: number; unknown: number; safe: number | '—'; deployed: number | '—'; approvals: number | '—'; rejected: number | '—';
  /** Top 목록 — 옛 요약(필드 없음)이면 그리지 않는다 */
  attention?: OperationAttention; replyGaps?: OperationReplyGap[];
  busy: { policy: boolean; read: boolean };
  countryGroups: OperationGroup[]; modelGroups: OperationGroup[];
  points: OperationTimelinePoint[]; recent: OperationEvent[]; ready: OperationReady; invalidTimes: number; preparationIssues: OperationPreparationIssue[];
  rows: OperationSummaryRow[]; policyOf: (publicationId: string) => { policyId: string; revision: number } | null | undefined;
  countries: string[]; models: string[]; flags: string[]; empty: string; updatedAt: number;
}

export default function ReadOnlyOperationOverview({ role }: { role: string }) {
  const qc = useQueryClient();
  const [country, setCountry] = useState(''), [model, setModel] = useState(''), [flag, setFlag] = useState('');
  const [limit, setLimit] = useState(OPERATION_PAGE);
  // 차량 회신은 읽기 — 정적 데모(공개 읽기본)에서는 역할과 상관없이 보인다
  const canRead = canReadAs(role, DATA_CATEGORY_ACCESS.SAFETY_OPERATION);
  // 홈 첫 화면은 서버 요약 하나 — 거르거나 더 볼 때(또는 요약을 못 읽을 때)만 전체 목록을 받아 화면에서 센다.
  // 예전에는 홈에 들어올 때마다 차량·회신·게시본 전체(공개 데모 압축 전 약 1 MB)를 받았다
  const detail = !!(country || model || flag) || limit > OPERATION_PAGE;
  // 홈 첫 렌더가 미리 받은 요약(Dashboard usePreloadHome)을 다시 받지 않게 30초는 그대로 쓴다 — 새로 고침 단추는 무효화로 다시 받는다
  const summaryQ = useApi<unknown>('operationSummary', {}, { enabled: !detail, staleTime: 30_000 });
  const summary = useMemo(() => summaryOf(summaryQ.data), [summaryQ.data]);
  // 적용 현황은 전체 차량 기준 — 거르는 동안에도 마지막 요약 그대로
  const adoption = useMemo(() => adoptionOf(summaryQ.data), [summaryQ.data]);
  const full = detail || summaryQ.isError || (summaryQ.isSuccess && !summary);
  const fleet = useApi<unknown>('fleetRuntime', {}, { enabled: full });
  const vehicles = useApi<unknown>('vehicles', {}, { enabled: full });
  const policies = useApi<unknown>('listPolicies', {}, { enabled: full });
  const features = useApi<unknown>('listFeatures', {}, { enabled: full });
  const pubs = useApi<unknown>('publications', {}, { enabled: full });
  const replies = useApi<unknown>('readbacks', {}, { enabled: full && canRead });
  const syncs = useApi<unknown>('integrationCalls', { query: { ifId: 'IF-04' } }, { enabled: full });
  // 응답 모양 확인은 데이터가 바뀔 때만 — 렌더마다 수백 대·회신 천여 건을 다시 훑었다
  const runtime = useMemo(() => runtimeRows(fleet.data), [fleet.data]), vehicle = useMemo(() => vehicleRows(vehicles.data), [vehicles.data]), policy = useMemo(() => policyRows(policies.data), [policies.data]), feature = useMemo(() => featureRows(features.data), [features.data]), publication = useMemo(() => publicationRows(pubs.data), [pubs.data]), readback = useMemo(() => readbackRows(replies.data), [replies.data]), sync = useMemo(() => syncRows(syncs.data), [syncs.data]);
  const data = useMemo(() => {
    if (!full) return null;
    const input: OperationInput = { runtime: runtime ?? [], vehicles: vehicle ?? [], policies: policy ?? [], features: feature ?? [], publications: publication ?? [], readbacks: canRead ? readback ?? [] : [], syncs: sync ?? [] };
    return buildOperationModel(input, { country, model, flag });
  }, [full, runtime, vehicle, policy, feature, publication, readback, sync, country, model, flag, canRead]);
  const view = useMemo((): View | null => {
    if (data) {
      const policyReady = !!policy && !!feature;
      const readReady = canRead && !!readback && !!publication && (!flag || !!policy);
      const ready: OperationReady = { DEPLOY: !!publication, SYNC: !!sync && !!publication, READBACK: readReady };
      return {
        total: data.rows.length, received: data.received, unknown: data.unknown, safe: data.safe, attention: data.attention, replyGaps: readReady ? data.replyGaps : [], deployed: policyReady ? data.deployed : '—', approvals: policyReady ? data.approvals : '—', rejected: readReady ? data.rejected : '—',
        busy: { policy: policies.isPending || features.isPending, read: canRead && (replies.isPending || pubs.isPending) },
        countryGroups: data.countryGroups, modelGroups: data.modelGroups, points: timelinePoints(data.events, ready), recent: recentEvents(data.events, ready), ready, invalidTimes: data.invalidTimes, preparationIssues: data.preparationIssues,
        rows: data.rows.slice(0, limit), policyOf: (id) => data.publicationById.get(id)?.payload.policy,
        countries: data.countries, models: data.models, flags: data.flags, empty: runtime?.length ? O.noRows : O.noRuntime, updatedAt: fleet.dataUpdatedAt,
      };
    }
    if (!summary) return null;
    const readReady = canRead && summary.readbacks;
    const pubPolicy = new Map(summary.publications.map((p) => [p.publicationId, p.policy]));
    return {
      total: summary.total, received: summary.received, unknown: summary.unknown, safe: summary.safe ?? '—', attention: summary.attention, replyGaps: readReady ? summary.replyGaps : [], deployed: summary.deployed, approvals: summary.approvals, rejected: readReady ? summary.rejected : '—',
      busy: { policy: false, read: false },
      countryGroups: summary.countryGroups, modelGroups: summary.modelGroups, points: summary.points, recent: summary.recent, ready: { DEPLOY: true, SYNC: true, READBACK: readReady }, invalidTimes: summary.invalidTimes, preparationIssues: summary.preparationIssues,
      rows: summary.rows, policyOf: (id) => pubPolicy.get(id),
      countries: summary.countries, models: summary.models, flags: summary.flags, empty: O.noRuntime, updatedAt: summaryQ.dataUpdatedAt,
    };
  }, [data, summary, limit, canRead, flag, policy, feature, readback, publication, sync, runtime, policies.isPending, features.isPending, replies.isPending, pubs.isPending, fleet.dataUpdatedAt, summaryQ.dataUpdatedAt]);
  // 고리에서 지도로 — 그 국가·차종 차량만(묶음 '미지정'은 조건 없이), 고른 Flag가 있으면 함께
  const mapHref = (kind: 'country' | 'model', value: string) => `/fleet/map?lens=activation${value && value !== UNKNOWN_GROUP ? `&${kind}=${encodeURIComponent(value)}` : ''}${flag ? `&flagKey=${encodeURIComponent(flag)}` : ''}`;
  const refresh = () => void Promise.all(OPERATION_APIS.map((name) => qc.invalidateQueries({ queryKey: [name] })));
  const select = (kind: 'country' | 'model', value: string) => { if (kind === 'country') setCountry(value); else setModel(value); setLimit(OPERATION_PAGE); document.getElementById('operation-vehicles')?.scrollIntoView?.({ block: 'nearest' }); };
  const loading = full ? fleet.isPending || vehicles.isPending : summaryQ.isPending;
  const invalid = full && !loading && (!runtime || !vehicle);
  const optionalError = full && ((!policies.isPending && !policy) || (!features.isPending && !feature) || (!pubs.isPending && !publication) || (!syncs.isPending && !sync) || (canRead && !replies.isPending && !readback));
  // 거르기 선택지 — 전체 목록을 받는 동안에도 요약의 선택지로 거르기 줄을 그대로 둔다(고른 칸의 초점이 사라지지 않게)
  const options = view ?? (summary ? { countries: summary.countries, models: summary.models, flags: summary.flags } : null);
  const skeleton = <div className="ds-skel" data-state="loading" aria-busy="true" role="progressbar" aria-label={O.loading}><span /><span /></div>;
  // 히어로(선택 차량·신뢰 수신율) 다음 카드 — 값은 요약 그대로, 일할 화면으로 바로 간다
  const kpis: Kpi[] = view ? [
    { key: 'deployed', label: O.deployed, value: view.deployed, busy: view.busy.policy, to: '/policies' },
    { key: 'unknown', label: O.unknown, value: view.unknown, busy: false, tone: view.unknown ? 'warn' : undefined },
    // 차단 수신은 차량 지도의 '긴급 차단'과 같은 뜻(위험) — 대시보드 디자인 언어 §4.2
    { key: 'safe', label: O.safe, value: view.safe, busy: false, tone: typeof view.safe === 'number' && view.safe ? 'danger' : undefined },
    { key: 'approvals', label: O.approvals, value: view.approvals, busy: view.busy.policy, to: '/policies' },
    { key: 'rejected', label: O.rejected, value: view.rejected, busy: view.busy.read, to: '/deployments', tone: typeof view.rejected === 'number' && view.rejected ? 'danger' : undefined },
  ] : [];
  const mapTo = `/fleet/map?lens=activation${flag ? `&flagKey=${encodeURIComponent(flag)}` : ''}`;
  const toTable = () => document.getElementById('operation-vehicles')?.scrollIntoView?.({ block: 'nearest' });
  return <>
    <section className="operation-overview" aria-label={O.title}>
      <div className="operation-overview__head"><div><h2>{O.title}</h2><p>{O.lead}</p></div><div className="operation-overview__links"><Link to={mapTo}>{O.map}<span aria-hidden="true"> →</span></Link><Link to="/deployments">{O.deployments}<span aria-hidden="true"> →</span></Link><button type="button" className="ds-btn" onClick={refresh}>{O.refresh}</button></div></div>
      {/* 첫 화면 맨 위 — 수신까지의 세 단계와 내 차례(외부 도구는 현황 아래) */}
      <div className="ov-lead">
        {view && !loading ? <FlowStrip points={view.points} ready={view.ready} received={view.received} total={view.total} preparation={view.preparationIssues.length} /> : invalid ? null : skeleton}
        <MyWork role={role} />
      </div>
      {invalid ? <p role="alert" data-state="error">{O.badData}</p> : !options ? skeleton : <>
        <div className="operation-filter" role="group" aria-label={O.filters}>
          <label>{O.country}<select className="ds-input" value={country} onChange={(e) => { setCountry(e.target.value); setLimit(OPERATION_PAGE); }}><option value="">{O.all}</option>{options.countries.map((value) => <option key={value} value={value}>{value === UNKNOWN_GROUP ? O.unspecified : value}</option>)}</select></label>
          <label>{O.model}<select className="ds-input" value={model} onChange={(e) => { setModel(e.target.value); setLimit(OPERATION_PAGE); }}><option value="">{O.all}</option>{options.models.map((value) => <option key={value} value={value}>{value === UNKNOWN_GROUP ? O.unspecified : value}</option>)}</select></label>
          <label>{O.flag}<select className="ds-input" value={flag} onChange={(e) => { setFlag(e.target.value); setLimit(OPERATION_PAGE); }}><option value="">{O.all}</option>{flag && !options.flags.includes(flag) && <option>{flag}</option>}{options.flags.map((value) => <option key={value}>{value}</option>)}</select></label>
          <button type="button" className="ds-btn" onClick={() => { setCountry(''); setModel(''); setFlag(''); setLimit(OPERATION_PAGE); }}>{O.clear}</button>
        </div>
        {loading || !view ? skeleton : <>
          <div className="ov-kpi-row">
            <KpiHero total={view.total} received={view.received} unknown={view.unknown} points={view.points} />
            <KpiCards items={kpis} />
          </div>
          {optionalError && <p className="operation-note" role="status">{O.unavailable}</p>}{!canRead && <p className="operation-note">{O.noAccess}</p>}
          {adoption && <Suspense fallback={<div className="ds-skel ov-adoption-skel" data-state="loading" aria-busy="true" role="progressbar" aria-label={O.adoption.loading}><span /><span /></div>}><AdoptionPanel adoption={adoption} /></Suspense>}
          <div className="ov-groups">
            <GroupBars groups={view.countryGroups} title={O.donut.country} label={O.countryChart} onSelect={(value) => select('country', value)} mapTo={(value) => mapHref('country', value)} />
            <GroupBars groups={view.modelGroups} title={O.donut.model} label={O.modelChart} onSelect={(value) => select('model', value)} mapTo={(value) => mapHref('model', value)} />
          </div>
          <div className="ov-legend-row">
            <ul className="operation-state-legend" aria-label={O.legend}>{STATES.map((state) => <li key={state}><i className="operation-state" data-state={state} aria-hidden="true" />{O.state[state]}</li>)}</ul>
            <details className="ov-basis"><summary>{O.basis}</summary><p className="operation-note">{O.receivedBasis}. {O.stateBasis} {O.flow.note} {O.donut.barHelp} {O.top.repliesBasis}{adoption ? ` ${O.adoption.basis}` : ''}</p></details>
          </div>
          {view.attention && <div className="ov-tops">
            <AttentionList attention={view.attention} total={view.total} stamp={stamp} onMore={toTable} />
            <ReplyGapList gaps={view.replyGaps ?? []} ready={view.ready.READBACK && !!view.replyGaps} />
            <PreparationList issues={view.preparationIssues} syncReady={view.ready.SYNC} />
          </div>}
          <TimeDistribution points={view.points} recent={view.recent} ready={view.ready} />
          {!!view.invalidTimes && <p className="operation-note">{O.invalidTimes(view.invalidTimes)}</p>}
          <div id="operation-vehicles" className="operation-table" role="region" aria-label={O.table} tabIndex={0}><table><caption className="ds-sr">{O.table}</caption><thead><tr>{[O.vin, O.scope, O.stateCol, O.policy, O.last, O.link, O.reason].map((title) => <th scope="col" key={title}>{title}</th>)}</tr></thead><tbody>
            {view.rows.map((row) => <tr key={row.runtime.vin}>
              <td><Link to={`/fleet/vehicles/${encodeURIComponent(row.runtime.vin)}`}><code>{row.runtime.vin}</code></Link></td>
              <td>{`${row.vehicle?.country || O.unspecified} / ${row.vehicle?.vehicleModel || O.unspecified}`}</td>
              <td><span className="operation-table__state operation-state" data-state={row.state}>{O.state[row.state]}</span></td>
              <td className="operation-table__policy">{!row.flags.length ? O.noPolicy : row.flags.map((f) => { const policy = f.publicationId ? view.policyOf(f.publicationId) : undefined; return <div key={f.flagKey}><code>{f.flagKey}</code>{f.publicationId ? <Link to={`/deployments/${encodeURIComponent(f.publicationId)}`}>{policy ? `${policy.policyId} · r${policy.revision}` : `${f.publicationId} · ${O.unspecified}`}</Link> : O.noPolicy}</div>; })}</td>
              <td>{row.readback ? <Link to={`/deployments/${encodeURIComponent(row.readback.publicationId)}`}>{stamp(row.readback.at)}</Link> : O.noReadback}</td>
              <td>{row.runtime.link === 'ONLINE' ? O.online : row.runtime.link === 'OFFLINE' ? O.offline : O.unspecified}</td>
              <td>{row.readback?.rejectReason || (row.runtime.quality !== 'TRUSTED' ? row.runtime.quality : row.flags.map((f) => f.local.reason).join(', ') || O.unspecified)}</td>
            </tr>)}
            {!view.total && <tr><td colSpan={7}>{view.empty}</td></tr>}
          </tbody></table></div>
          <div className="operation-overview__footer"><span>{O.showing(Math.min(limit, view.total), view.total)}</span>{limit < view.total && <button type="button" className="ds-btn" onClick={() => setLimit((value) => value + OPERATION_PAGE)}>{O.more}</button>}<span>{O.snapshot}: {stamp(view.updatedAt ? new Date(view.updatedAt).toISOString() : undefined)}</span></div>
        </>}
      </>}
    </section>
    <ExternalToolLaunchers compact />
  </>;
}

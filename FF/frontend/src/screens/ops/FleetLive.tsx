// /fleet/live — Fleet 실시간 적용 현황 (D02-03 차량 런타임 · D04-03 회신 수집 · D06-08 서명 배포)
// /fleet/vehicles/:vin — 차량별 적용 상태 (차량 측 판단 vs 서버 판단)
// 모든 값은 백엔드 차량 런타임·게시본에서 온다. 화면은 다시 계산하지 않는다. SSE로 배포·차단 이벤트가 오면 새로 고친다.
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { asyncState, useApi } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, EventStream, Explain, IdChip, KeyValue, Kpi, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { when } from '../shared';
import { Progress, type Delivery } from './shared';
import { VehicleRequestPanel } from './VehicleRequests';
import { SupportPanel } from '../admin/Access';

const F = ko.fleet;
const V = ko.vehicle;
const STREAM = ['publication.', 'vehicle.', 'kill.', 'virtual.'];

interface FleetRow {
  vin: string;
  label: string;
  scope: string;
  link: 'ONLINE' | 'OFFLINE';
  quality: string;
  gleo: boolean;
  featureState: Record<string, string>;
  kills: string[];
  flags: { flagKey: string; publicationId: string | null; sequence: number | null; local: { value: boolean; reason: string }; server: { value: boolean; reason: string } | null; drift: boolean }[];
  last: { at: string; publicationId: string; kind: string; result: string; detail: string } | null;
}
interface Pub extends Delivery {
  kind: 'POLICY' | 'KILL' | 'RESTORE';
  createdAt: string;
  payload: { flagKey: string | null; featureId: string; targets: string[] };
}

function Cell({ f }: { f: FleetRow['flags'][number] | undefined }) {
  if (!f) return <span className="ds-fcell">{F.noBundle}</span>;
  const v = f.local.reason === 'KILL_SWITCH' ? 'safe' : f.local.value ? 'on' : 'off';
  return (
    <span className="ds-fcell" data-v={v} data-drift={f.drift} title={`${f.local.reason}${f.drift ? ` · ${F.drift}: ${f.server?.reason}` : ''}`}>
      {f.local.value ? 'ON' : 'OFF'}
      {f.drift && <span aria-label={F.drift}>≠</span>}
    </span>
  );
}

export function FleetLive() {
  const nav = useNavigate();
  const fleet = useApi<{ items: FleetRow[]; gleo: string }>('fleetRuntime');
  const pubs = useApi<{ items: Pub[] }>('publications');
  const kills = useApi<{ items: { killId: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const gleo = useApi<{ mode: 'off' | 'internal' | 'ws'; connected: boolean; lastError: string | null; messages: { dir: string; at: string; msg: { type: string } }[] }>('gleoStatus');
  const live = usePlatformEvents(STREAM, ['fleetRuntime', 'publications', 'killRequests', 'gleoStatus']);
  const rows = fleet.data?.items ?? [];
  const flagKeys = [...new Set(rows.flatMap((r) => r.flags.map((f) => f.flagKey)))].sort();
  const pubRows = (pubs.data?.items ?? []).slice(0, 12);
  const inflight = pubRows.filter((p) => !p.closedAt).length;
  const drift = rows.reduce((n, r) => n + r.flags.filter((f) => f.drift).length, 0);
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D02-03 · D04-03 · D06-08 · LIVE" title={F.title} lead={F.lead} />
      <div className="ds-kpis">
        <Kpi label={F.kpi.online} value={`${rows.filter((r) => r.link === 'ONLINE').length}/${rows.length}`} tone="ok" />
        <Kpi label={F.kpi.inflight} value={inflight} tone={inflight ? 'accent' : undefined} />
        <Kpi label={F.kpi.kills} value={kills.data?.items.length ?? 0} tone={kills.data?.items.length ? 'danger' : undefined} />
        <Kpi label={F.kpi.drift} value={drift} tone={drift ? 'warn' : undefined} />
      </div>
      <Panel title={F.matrix} id="matrix">
        <AsyncView state={asyncState(fleet, rows.length === 0)} error={fleet.error?.message} onRetry={() => fleet.refetch()}>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table className="ds-fleet">
              <caption className="ds-sr">{F.matrix}</caption>
              <thead>
                <tr>
                  <th scope="col">{F.vehicle}</th>
                  <th scope="col">Context</th>
                  {flagKeys.map((k) => (
                    <th key={k} scope="col" className="ds-mono">
                      {k}
                    </th>
                  ))}
                  <th scope="col">{F.state}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vin}>
                    <th scope="row">
                      <Link to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`} className="ds-mono">
                        <span className="ds-dot" data-on={r.link === 'ONLINE'} aria-hidden="true" />
                        {r.vin}
                      </Link>
                      {r.gleo && <span className="ds-tag" style={{ marginLeft: 'var(--sp-1)' }}>GLEO</span>}
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{r.scope}</div>
                    </th>
                    <td className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {F.link[r.link]} · {r.quality}
                    </td>
                    {flagKeys.map((k) => (
                      <td key={k}>
                        <Cell f={r.flags.find((f) => f.flagKey === k)} />
                      </td>
                    ))}
                    <td className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {Object.entries(r.featureState).map(([fid, st]) => `${fid} ${st}`).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AsyncView>
      </Panel>
      <div className="ds-split">
        <Panel title={F.inflight} id="pubs" actions={<Link to="/deployments">{ko.deploy.title} →</Link>}>
          <DataTable
            caption={F.inflight}
            rows={pubRows}
            rowKey={(p) => p.publicationId}
            onOpen={(p) => nav(`/deployments/${p.publicationId}`)}
            columns={[
              { key: 'id', header: ko.deploy.col.id, cell: (p) => <IdChip id={p.publicationId} to={`/deployments/${p.publicationId}`} copy={false} /> },
              { key: 'k', header: ko.deploy.col.kind, cell: (p) => <span className="ds-tag">{ko.deploy.kind[p.kind]}</span> },
              { key: 't', header: ko.deploy.col.target, cell: (p) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{p.payload.flagKey ?? p.payload.featureId}</span> },
              { key: 'p', header: ko.deploy.col.progress, cell: (p) => <Progress d={p} /> },
            ]}
          />
        </Panel>
        <div style={{ display: 'grid', gap: 'var(--sp-3)', alignContent: 'start' }}>
          <Panel title={F.gleo} id="gleo" actions={gleo.data && <VerdictBadge value={gleo.data.mode !== 'ws' ? '미판정' : gleo.data.connected ? 'PASS' : 'FAIL'} />}>
            {gleo.data && (
              <KeyValue
                rows={[
                  { k: 'GLEO_MODE', v: <span className="ds-mono">{F.gleoMode[gleo.data.mode]}</span> },
                  ...(gleo.data.mode === 'ws' ? [{ k: 'Broker', v: <span className="ds-mono">{gleo.data.connected ? F.connected : F.disconnected}</span>, note: gleo.data.lastError ?? undefined }] : []),
                  ...(gleo.data.messages.length ? [{ k: 'Last', v: <span className="ds-mono">{`${gleo.data.messages.at(-1)!.dir} ${gleo.data.messages.at(-1)!.msg.type}`}</span>, note: when(gleo.data.messages.at(-1)!.at) }] : []),
                ]}
              />
            )}
          </Panel>
          <Panel title={F.stream} eyebrow="SSE /api/events/stream" id="stream">
            <EventStream items={live.map((e) => ({ seq: e.seq, at: e.at, type: e.type, aggregate: e.aggregate, summary: String(e.payload.status ?? e.payload.observed ?? e.payload.state ?? e.payload.gateResult ?? '') }))} max={30} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

interface RuntimeView {
  vehicle: { vin: string; label: string; country: string; vehicleModel: string; trim: string; swVersion: string; link: string; quality: string; gleo: boolean };
  runtime: { bootId: string; highest: Record<string, number>; bundles: Record<string, { publicationId: string; sequence: number; payloadHash: string; policy: { policyId: string; revision: number } }>; kills: Record<string, { killId: string; safeMode: string; publicationId: string }>; featureState: Record<string, string>; log: { at: string; publicationId: string; kind: string; result: string; detail: string }[] };
  evaluations: { flagKey: string; local: { value: boolean; decision: string; reason: string }; server: { value: boolean; decision: string; reason: string } | null; drift: boolean }[];
}

export function VehicleRuntimeScreen() {
  const nav = useNavigate();
  const { vin = 'ego-01' } = useParams();
  const vehicles = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  const q = useApi<RuntimeView>('vehicleRuntime', { params: { vin } });
  usePlatformEvents(STREAM, ['vehicleRuntime', 'vehicleStatusView']);
  const d = q.data;
  return (
    <div className="ds-screen">
      <PageHeader
        eyebrow="D02-03 · VEHICLE RUNTIME"
        title={V.title}
        lead={V.lead}
        actions={
          <Select label={V.pick} value={vin} onChange={(e) => nav(`/fleet/vehicles/${encodeURIComponent(e.target.value)}`)}>
            {(vehicles.data?.items ?? []).map((v) => (
              <option key={v.vin} value={v.vin}>
                {v.vin} · {v.label}
              </option>
            ))}
          </Select>
        }
      />
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <>
            <div className="ds-split">
              <Panel title={d.vehicle.label} eyebrow={d.vehicle.vin} id="vehicle">
                <KeyValue
                  rows={[
                    { k: 'Scope', v: <span className="ds-mono">{`${d.vehicle.country}/${d.vehicle.vehicleModel}/${d.vehicle.trim}`}</span> },
                    { k: 'SW', v: <span className="ds-mono">{d.vehicle.swVersion}</span> },
                    { k: 'Context', v: <span className="ds-mono">{`${F.link[d.vehicle.link as 'ONLINE']} · ${d.vehicle.quality}${d.vehicle.gleo ? ' · GLEO' : ''}`}</span> },
                    { k: V.boot, v: <span className="ds-mono">{d.runtime.bootId}</span> },
                    { k: V.kills, v: <span className="ds-mono">{Object.entries(d.runtime.featureState).map(([f, s]) => `${f} ${s}`).join(' · ') || '—'}</span> },
                  ]}
                />
              </Panel>
              <Panel title={V.bundles} id="bundles">
                <DataTable
                  caption={V.bundles}
                  rows={Object.entries(d.runtime.bundles).map(([flagKey, b]) => ({ flagKey, ...b }))}
                  rowKey={(b) => b.flagKey}
                  onOpen={(b) => nav(`/deployments/${b.publicationId}`)}
                  columns={[
                    { key: 'f', header: 'flagKey', cell: (b) => <span className="ds-mono">{b.flagKey}</span> },
                    { key: 'p', header: ko.deploy.col.id, cell: (b) => <IdChip id={b.publicationId} to={`/deployments/${b.publicationId}`} copy={false} /> },
                    { key: 'pol', header: ko.policy.col.id, cell: (b) => <IdChip id={b.policy.policyId} version={`r${b.policy.revision}`} to={`/policies/${b.policy.policyId}`} copy={false} /> },
                    { key: 's', header: V.highest, cell: (b) => <span className="ds-mono">#{b.sequence}</span>, align: 'right' },
                  ]}
                />
              </Panel>
            </div>
            <Panel title={V.evaluations} id="evaluations">
              <DataTable
                caption={V.evaluations}
                rows={d.evaluations}
                rowKey={(e) => e.flagKey}
                columns={[
                  { key: 'f', header: 'flagKey', cell: (e) => <span className="ds-mono">{e.flagKey}</span> },
                  { key: 'l', header: V.local, cell: (e) => <span className="ds-fcell" data-v={e.local.reason === 'KILL_SWITCH' ? 'safe' : e.local.value ? 'on' : 'off'}>{`${e.local.value ? 'ON' : 'OFF'} · ${e.local.reason}`}</span> },
                  { key: 's', header: V.server, cell: (e) => (e.server ? <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${e.server.value ? 'ON' : 'OFF'} · ${e.server.reason}`}</span> : '—') },
                  { key: 'd', header: F.drift, cell: (e) => <VerdictBadge value={e.drift ? 'FAIL' : 'PASS'} /> },
                ]}
              />
            </Panel>
            <Panel title={V.log} id="log">
              <DataTable
                caption={V.log}
                rows={[...d.runtime.log].reverse()}
                rowKey={(l) => `${l.at}-${l.publicationId}-${l.detail}`}
                columns={[
                  { key: 'at', header: ko.audit.col.at, cell: (l) => <span className="ds-mono">{when(l.at)}</span> },
                  { key: 'p', header: ko.deploy.col.id, cell: (l) => <IdChip id={l.publicationId} to={`/deployments/${l.publicationId}`} copy={false} /> },
                  { key: 'k', header: ko.deploy.col.kind, cell: (l) => <span className="ds-tag">{l.kind}</span> },
                  { key: 'r', header: ko.audit.col.result, cell: (l) => <VerdictBadge value={l.result === 'APPLIED' ? 'PASS' : 'FAIL'} /> },
                  { key: 'd', header: ko.audit.col.reason, cell: (l) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{l.detail}</span> },
                ]}
              />
            </Panel>
            <StatusV2Panel vin={vin} />
            <SupportPanel vin={vin} />
            <VehicleRequestPanel vin={vin} />
          </>
        )}
      </AsyncView>
    </div>
  );
}


interface StatusView {
  features: { featureId: string; state: string; reportSeq: number; updatedAt: string; report: { hmi: string; request_result: string; reject_code?: string; time_sync: string; persistence: string; feature_weight_permille: number } }[];
  recent: { featureId: string; state: string; reportSeq: number; accepted: boolean; violation: { step: string; code: string; message: string } | null; via: string; at: string }[];
}

/**
 * 상태 보고 v2 — 받아들인 최신 상태와 최근 수신(위반 포함). 보고가 없으면 UNKNOWN(확인 전에는 비활성으로 보지 않는다).
 * @rule FFG-TEL-003 — 화면: 증명된 보고와 위반을 구분해 보인다
 */
function StatusV2Panel({ vin }: { vin: string }) {
  const S2 = ko.statusV2;
  const q = useApi<StatusView>('vehicleStatusView', { params: { vin } });
  const d = q.data;
  const seq = (n: number) => `${n >>> 16} · ${n & 0xffff}`;
  return (
    <Panel
      title={
        <>
          {S2.title} <Explain rules={['FFG-TEL-003', 'FFG-VEH-002', 'FFG-DEAC-007']} />
        </>
      }
      id="status-v2"
      tour="vehicle-status-v2"
    >
      <p className="ds-field__hint" style={{ marginTop: 0 }}>
        {S2.lead}
      </p>
      <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
        {d && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {d.features?.length ? (
              <DataTable
                caption={S2.title}
                rows={d.features}
                rowKey={(f) => f.featureId}
                columns={[
                  { key: 'f', header: S2.col.feature, cell: (f) => <span className="ds-mono ds-nowrap">{f.featureId}</span> },
                  { key: 's', header: S2.col.state, cell: (f) => <span className="ds-tag ds-mono">{f.state}</span> },
                  { key: 'h', header: S2.col.hmi, cell: (f) => S2.hmi[f.report.hmi] ?? f.report.hmi },
                  { key: 'r', header: S2.col.result, cell: (f) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{f.report.reject_code && f.report.reject_code !== 'NONE' ? `${f.report.request_result} · ${f.report.reject_code}` : f.report.request_result}</span> },
                  { key: 'q', header: S2.col.seq, cell: (f) => <span className="ds-mono ds-nowrap">{seq(f.reportSeq)}</span> },
                  { key: 't', header: S2.col.sync, cell: (f) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${f.report.time_sync} · ${f.report.persistence}`}</span> },
                ]}
              />
            ) : (
              <p className="ds-stale" role="status">
                {S2.none}
              </p>
            )}
            {(d.recent?.length ?? 0) > 0 && (
              <DataTable
                caption={S2.recent}
                rows={d.recent}
                rowKey={(x) => `${x.at}-${x.reportSeq}-${x.featureId}`}
                columns={[
                  { key: 'at', header: S2.col.at, cell: (x) => <span className="ds-mono ds-nowrap">{when(x.at)}</span> },
                  { key: 'f', header: S2.col.feature, cell: (x) => <span className="ds-mono ds-nowrap">{x.featureId}</span> },
                  { key: 's', header: S2.col.state, cell: (x) => <span className="ds-mono">{x.state}</span> },
                  { key: 'a', header: S2.col.accepted, cell: (x) => <VerdictBadge value={x.accepted ? 'PASS' : 'FAIL'} /> },
                  { key: 'v', header: S2.col.violation, cell: (x) => (x.violation ? <span title={x.violation.message} className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{`${x.violation.step} · ${x.violation.code}`}</span> : '—') },
                  { key: 'w', header: S2.col.via, cell: (x) => <span className="ds-mono">{x.via}</span> },
                ]}
              />
            )}
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}

/** 이전 주소(/twin/live) — Fleet 실시간 적용 현황으로 옮겼다 */
export function LegacyLiveRedirect() {
  return <Navigate to="/fleet/live" replace />;
}

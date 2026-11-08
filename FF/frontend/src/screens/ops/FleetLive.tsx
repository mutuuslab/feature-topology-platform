// /fleet/live — Fleet 실시간 적용 현황 (D02-03 차량 런타임 · D04-03 회신 수집 · D06-08 서명 배포)
// /fleet/vehicles/:vin — 차량별 적용 상태 (차량 측 판단 vs 서버 판단)
// 모든 값은 백엔드 차량 런타임·게시본에서 온다. 화면은 다시 계산하지 않는다. SSE로 배포·차단 이벤트가 오면 새로 고친다.
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CustomerStateView, FleetAxisView, VehicleFeatureStateView, VehicleVerdictsView } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { fleetSearch as FS } from '../../copy/fleet-search';
import { control as CT } from '../../copy/control';
import { pickDefault } from '../../data/first-run';
import { AsyncView, DataTable, EventStream, Explain, IdChip, KeyValue, PageHeader, Panel, Select, SummaryLine, Tabs, VerdictBadge } from '../../design';
import { fleetAxes as FA, vehicleTabs as VTAB, axesTab, verdictsTab, customerTab } from '../../copy/ads-state';
import { customerMessage, fleetAxesMessage, vehicleStateMessage, verdictsMessage } from '../ads/state-messages';
import { when } from '../shared';
import { Progress, waitedMinutes, type Delivery } from './shared';
import { VehicleRequestPanel } from './VehicleRequests';
import { SupportPanel } from '../admin/Access';

const F = ko.fleet;
const V = ko.vehicle;
// ADS 상태 부품 — 탭을 열 때만 읽는다(화면 묶음 예산)
const statePanels = () => import('../ads/StatePanels');
const VehicleAxesPanel = lazy(() => statePanels().then((m) => ({ default: m.VehicleAxesPanel })));
const VerdictsPanel = lazy(() => statePanels().then((m) => ({ default: m.VerdictsPanel })));
const CustomerPanel = lazy(() => statePanels().then((m) => ({ default: m.CustomerPanel })));
const FleetAxesPanel = lazy(() => statePanels().then((m) => ({ default: m.FleetAxesPanel })));
// ADS-OTA01 — '구성과 설치' 행 상세: OTA 설치 단계(선형 5단계 + 갈림 상태)
const InstallDetail = lazy(() => import('../ads/OtaInstalls').then((m) => ({ default: m.InstallDetail })));
const STREAM = ['publication.', 'vehicle.', 'kill.', 'virtual.'];
/** 차량 × flag 표 한 번에 그리는 줄 — 수백 대를 다 그리면 표 하나가 수천 칸이라 메뉴를 열 때 멈췄다(CPU 4배 느림 3초) */
const MATRIX_PAGE = 60;

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
  /** 마지막 정책 게시본의 대상인데 아직 꾸러미가 없는 flag — 이것만 미수신. 대상이 아닌 flag는 해당 없음 */
  pending?: string[];
  last: { at: string; publicationId: string; kind: string; result: string; detail: string } | null;
}
interface Pub extends Delivery {
  kind: 'POLICY' | 'KILL' | 'RESTORE';
  createdAt: string;
  payload: { flagKey: string | null; featureId: string; targets: string[] };
}

function Cell({ f, pending }: { f: FleetRow['flags'][number] | undefined; pending: boolean }) {
  if (!f)
    return pending ? (
      <span className="ds-fcell">{F.noBundle}</span>
    ) : (
      <span className="ds-fcell" data-v="na" title={F.notTarget}>
        —
      </span>
    );
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
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'match' ? 'match' : 'axes';
  const picked = sp.get('feature') ?? '';
  const ax = useApi<FleetAxisView>('adsAxisDistribution', { query: picked ? { featureId: picked } : {} }, { enabled: tab === 'axes' });
  const fleet = useApi<{ items: FleetRow[]; gleo: string }>('fleetRuntime');
  const pubs = useApi<{ items: Pub[] }>('publications');
  const kills = useApi<{ items: { killId: string }[] }>('killRequests', { query: { status: 'ACTIVE' } });
  const gleo = useApi<{ mode: 'off' | 'internal' | 'ws'; connected: boolean; lastError: string | null; messages: { dir: string; at: string; msg: { type: string } }[] }>('gleoStatus');
  const live = usePlatformEvents(STREAM, ['fleetRuntime', 'publications', 'killRequests', 'gleoStatus']);
  const [shown, setShown] = useState(MATRIX_PAGE);
  const [query, setQuery] = useState('');
  // 다른 조회(게시본·이벤트)가 올 때마다 수백 대를 다시 훑지 않게 차량 목록이 바뀔 때만 센다.
  // 한 쪽보다 많으면 앞쪽만 그리므로 차단 중 차량 → 서버 판단과 다른 차량 → 미확인 차량을 위에 둔다(같은 묶음 안은 받은 순서).
  // 차단 중 차량은 대수가 적어도 위로 — 긴급 차단 직후 이 화면을 열면 차단한 차량이 표 아래(스크롤 밖)에 있었다
  const { rows, flagKeys, ordered, drift, unsure } = useMemo(() => {
    const rows = fleet.data?.items ?? [];
    const flagKeys = [...new Set(rows.flatMap((r) => r.flags.map((f) => f.flagKey)))].sort();
    // 다른 차종·코호트의 flag가 없는 것은 미수신이 아니다 — 받아야 할 게시본을 못 받은(pending) 차량만 센다
    const isUnsure = (r: FleetRow) => r.quality !== 'TRUSTED' || !!r.pending?.length;
    const rank = (r: FleetRow) => (r.kills.length ? 0 : r.flags.some((f) => f.drift) ? 1 : isUnsure(r) ? 2 : 3);
    const ordered = rows.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
    return { rows, flagKeys, ordered, drift: rows.reduce((n, r) => n + r.flags.filter((f) => f.drift).length, 0), unsure: rows.filter(isUnsure).length };
  }, [fleet.data]);
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ordered.filter(r => [r.vin, r.label, r.scope].some(v => v.toLowerCase().includes(q))) : ordered;
  }, [ordered, query]);
  const pubRows = (pubs.data?.items ?? []).slice(0, 12);
  const inflight = pubRows.filter((p) => !p.closedAt).length;
  // 차량 측 값을 받지 못했거나(미수신) 신뢰할 수 없는 차량(unsure) — 이들이 있으면 "모두 같다"고 말할 수 없다
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D02-03 · D04-03 · D06-08 · LIVE"
        title={F.title}
        lead={tab === 'axes' ? FA.lead : F.lead}
        message={tab === 'axes' ? fleetAxesMessage(ax.data) : !fleet.data ? { tone: 'neutral', value: '—', text: F.key.drift } : drift ? { tone: 'warn', value: drift, text: F.key.drift } : unsure ? { tone: 'warn', value: unsure, text: F.key.unsure } : { tone: 'ok', text: F.key.clean }}
        actions={
          tab === 'axes' && ax.data?.features?.length ? (
            <Select label={FA.pick} value={ax.data.selected?.featureId ?? ''} onChange={(e) => setSp((x) => (x.set('feature', e.target.value), x), { replace: true })}>
              {ax.data.features.map((f) => (
                <option key={f.featureId} value={f.featureId}>
                  {`${f.featureId} · ${f.name}${f.featureClass === 'ADS' ? ` · ${FA.ads}` : ''}`}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />
      <SummaryLine
        items={[
          { k: F.kpi.online, v: `${rows.filter((r) => r.link === 'ONLINE').length}/${rows.length}` },
          { k: F.kpi.inflight, v: inflight },
          { k: F.kpi.kills, v: kills.data?.items.length ?? 0 },
        ]}
      />
      <Tabs tabs={[{ key: 'axes', label: FA.tabs.axes }, { key: 'match', label: FA.tabs.match }]}>
        {(t) =>
          t === 'axes' ? (
            <AsyncView state={asyncState(ax, !ax.data?.selected?.axes)} error={ax.error} onRetry={() => ax.refetch()} empty={{ title: FA.keyNone }}>
              {ax.data?.selected?.axes ? (
                <Suspense fallback={null}>
                  <FleetAxesPanel view={ax.data} />
                </Suspense>
              ) : null}
            </AsyncView>
          ) : (
            <>
      <Panel title={F.matrix} id="matrix">
        <AsyncView state={asyncState(fleet, rows.length === 0)} error={fleet.error} onRetry={() => fleet.refetch()}>
          <label className="ds-field"><span className="ds-field__label">{FS.label}</span><input className="ds-input" type="search" value={query} placeholder={FS.placeholder} onChange={e => { setQuery(e.target.value); setShown(MATRIX_PAGE); }} /></label>
          {query.trim() && <p role="status">{FS.matches(matching.length, rows.length)}</p>}
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
                {matching.slice(0, shown).map((r) => (
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
                        <Cell f={r.flags.find((f) => f.flagKey === k)} pending={!!r.pending?.includes(k)} />
                      </td>
                    ))}
                    <td className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {Object.entries(r.featureState).map(([fid, st]) => `${fid} ${V.guard[st] ?? st}`).join(' · ') || (r.last ? '—' : CT.vehicle.noState)}
                    </td>
                  </tr>
                ))}
                {!matching.length && <tr><td colSpan={flagKeys.length + 3}>{FS.empty}</td></tr>}
              </tbody>
            </table>
          </div>
          {matching.length > MATRIX_PAGE && (
            <div className="ds-toolbar" style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
              <span>{F.showing(Math.min(shown, matching.length), matching.length)}</span>
              {shown < matching.length && (
                <button type="button" className="ds-btn" onClick={() => setShown((n) => n + MATRIX_PAGE)}>
                  {F.more}
                </button>
              )}
            </div>
          )}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-3)', alignContent: 'start' }}>
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
            </>
          )
        }
      </Tabs>
    </div>
  );
}

interface RuntimeView {
  vehicle: { vin: string; label: string; country: string; vehicleModel: string; trim: string; swVersion: string; link: string; quality: string; gleo: boolean };
  runtime: { bootId: string; highest: Record<string, number>; bundles: Record<string, { publicationId: string; sequence: number; payloadHash: string; policy: { policyId: string; revision: number } }>; kills: Record<string, { killId: string; safeMode: string; publicationId: string }>; featureState: Record<string, string>; log: { at: string; publicationId: string; kind: string; result: string; detail: string }[] };
  evaluations: { flagKey: string; local: { value: boolean; decision: string; reason: string }; server: { value: boolean; decision: string; reason: string } | null; drift: boolean }[];
}

const VEHICLE_TABS = ['state', 'verdicts', 'customer', 'records', 'requests'] as const;
type VehicleTab = (typeof VEHICLE_TABS)[number];

export function VehicleRuntimeScreen() {
  const nav = useNavigate();
  const { vin: param } = useParams();
  const [sp] = useSearchParams();
  const tab: VehicleTab = (VEHICLE_TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as VehicleTab) : 'state';
  const vehicles = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  // 차량을 고르지 않은 메뉴 주소 — 예시 차량이 있으면 그것, 없으면 첫 차량, 차량이 없으면(빈 설치) 빈 상태(출시 준비 RD-OPS-02)
  const fallback = pickDefault(vehicles.data?.items, (v) => v.vin === 'ego-01');
  const vin = param ?? fallback?.vin ?? (vehicles.isError ? 'ego-01' : '');
  const none = !param && fallback === null;
  const q = useApi<RuntimeView>('vehicleRuntime', { params: { vin } }, { enabled: !!vin });
  // 이 차량에 보냈는데 회신이 없는 게시본 — 가장 오래 기다린 시간(P4-3, '같습니다'라고 단정하지 않는다)
  const pubs = useApi<{ items: (Delivery & { createdAt: string; payload: { targets: string[] } })[] }>('publications');
  usePlatformEvents(STREAM, ['vehicleRuntime', 'vehicleStatusView', 'publications']);
  const fs = useApi<VehicleFeatureStateView>('adsVehicleFeatureState', { params: { vin } }, { enabled: !!vin && tab === 'state' });
  const vd = useApi<VehicleVerdictsView>('adsVehicleVerdicts', { params: { vin } }, { enabled: !!vin && tab === 'verdicts' });
  const cs = useApi<CustomerStateView>('adsCustomerState', { params: { vin } }, { enabled: !!vin && tab === 'customer' });
  const d = q.data;
  const pending = (pubs.data?.items ?? []).filter((p) => p.payload.targets.includes(vin) && p.nodes.find((n) => n.nodeId === vin)?.reason === 'NO_REPORT');
  const missedMin = pending.length ? Math.max(...pending.map((p) => waitedMinutes(p.createdAt))) : null;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D02-03 · VEHICLE RUNTIME"
        title={param ? V.titleFor(param) : V.title}
        lead={tab === 'state' ? axesTab.lead : tab === 'verdicts' ? verdictsTab.lead : tab === 'customer' ? customerTab.lead : V.lead}
        message={(() => {
          const n = d?.evaluations.filter((e) => e.drift).length ?? 0;
          if (none) return { tone: 'neutral', text: ko.state.noVehicleTitle };
          // 활성 탭이 핵심 메시지를 고른다(P-10)
          if (tab === 'state') return vehicleStateMessage(fs.data);
          if (tab === 'verdicts') return verdictsMessage(vd.data);
          if (tab === 'customer') return customerMessage(cs.data);
          if (!d) return { tone: 'neutral', value: '—', text: V.key.clean(vin) };
          if (n) return { tone: 'warn', value: n, text: V.key.drift(vin) };
          // 회신이 하나도 없거나 보낸 게시본의 회신을 못 받았으면 같다고 말할 수 없다 — 판단 불가
          if (missedMin !== null) return { tone: 'warn', text: CT.vehicle.unknownFor(vin, missedMin) };
          if (!d.runtime.log.length) return { tone: 'warn', text: CT.vehicle.unknown(vin) };
          return { tone: 'ok', text: V.key.clean(vin) };
        })()}
        actions={
          <Select label={V.pick} value={vin} onChange={(e) => nav(`/fleet/vehicles/${encodeURIComponent(e.target.value)}${sp.get('tab') ? `?tab=${sp.get('tab')}` : ''}`)}>
            {(vehicles.data?.items ?? []).map((v) => (
              <option key={v.vin} value={v.vin}>
                {v.vin} · {v.label}
              </option>
            ))}
          </Select>
        }
      />
      {none ? (
        <AsyncView emptyHidden state="empty" />
      ) : (
        <Tabs
          tabs={[
            { key: 'state', label: VTAB.state },
            { key: 'verdicts', label: VTAB.verdicts },
            { key: 'customer', label: VTAB.customer },
            { key: 'records', label: VTAB.records },
            { key: 'requests', label: VTAB.requests },
          ]}
        >
          {(t) =>
            t === 'state' ? (
              <AsyncView state={asyncState(fs, !fs.data?.features?.length)} error={fs.isError ? axesTab.error : null} onRetry={() => fs.refetch()} empty={axesTab.empty}>
                {fs.data?.features ? (
                  <Suspense fallback={null}>
                    <VehicleAxesPanel view={fs.data} />
                    <InstallDetail vin={vin} />
                  </Suspense>
                ) : null}
              </AsyncView>
            ) : t === 'verdicts' ? (
              <AsyncView state={asyncState(vd, !vd.data?.items?.length && !vd.data?.unreported?.length)} error={vd.isError ? verdictsTab.error : null} onRetry={() => vd.refetch()} empty={verdictsTab.empty}>
                {vd.data?.items ? (
                  <Suspense fallback={null}>
                    <VerdictsPanel view={vd.data} />
                  </Suspense>
                ) : null}
              </AsyncView>
            ) : t === 'customer' ? (
              <AsyncView state={asyncState(cs, !cs.data?.features?.length)} error={cs.error} onRetry={() => cs.refetch()} empty={customerTab.empty}>
                {cs.data?.features ? (
                  <Suspense fallback={null}>
                    <CustomerPanel view={cs.data} />
                  </Suspense>
                ) : null}
              </AsyncView>
            ) : t === 'requests' ? (
              <VehicleRequestPanel vin={vin} />
            ) : (
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
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
                    { k: V.kills, v: <span title={Object.entries(d.runtime.featureState).map(([f, s]) => `${f} ${s}`).join(' · ')}>{Object.entries(d.runtime.featureState).map(([f, s]) => `${f} ${V.guard[s] ?? s}`).join(' · ') || (d.runtime.log.length ? '—' : CT.vehicle.noState)}</span>, note: missedMin !== null ? CT.pub.waitingShort(missedMin) : undefined },
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
                  { key: 'l', header: V.local, cell: (e) => <span className="ds-fcell" data-v={e.local.reason === 'KILL_SWITCH' ? 'safe' : e.local.value ? 'on' : 'off'} title={e.local.reason}>{`${e.local.value ? 'ON' : 'OFF'} · ${ko.activation.reason[e.local.reason] ?? e.local.reason}`}</span> },
                  { key: 's', header: V.server, cell: (e) => (e.server ? <span style={{ fontSize: 'var(--fs-xs)' }} title={e.server.reason}>{`${e.server.value ? 'ON' : 'OFF'} · ${ko.activation.reason[e.server.reason] ?? e.server.reason}`}</span> : '—') },
                  { key: 'd', header: F.drift, cell: (e) => <VerdictBadge value={e.drift ? 'FAIL' : 'PASS'} label={e.drift ? V.differs : V.same} /> },
                ]}
              />
            </Panel>
            <Panel title={V.log} id="log">
              <DataTable
                caption={V.log}
                rows={[...d.runtime.log].reverse()}
                rowKey={(l) => `${l.at}-${l.publicationId}-${l.detail}`}
                columns={[
                  { key: 'at', header: ko.audit.col.at, cell: (l) => <span className="ds-mono ds-nowrap">{when(l.at)}</span> },
                  { key: 'p', header: ko.deploy.col.id, cell: (l) => <IdChip id={l.publicationId} to={`/deployments/${l.publicationId}`} copy={false} /> },
                  { key: 'k', header: ko.deploy.col.kind, cell: (l) => <span className="ds-tag">{l.kind}</span> },
                  { key: 'r', header: ko.audit.col.result, cell: (l) => <VerdictBadge value={l.result === 'APPLIED' ? 'PASS' : 'FAIL'} /> },
                  { key: 'd', header: ko.audit.col.reason, cell: (l) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{l.detail}</span> },
                ]}
              />
            </Panel>
            <StatusV2Panel vin={vin} />
            <SupportPanel vin={vin} />
          </>
        )}
      </AsyncView>
            )
          }
        </Tabs>
      )}
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
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
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

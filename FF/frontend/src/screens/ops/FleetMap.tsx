// /fleet/map — 전세계 차량 지도 (D02-03). 차량마다 위치·구독 상태·기능 활성(차단·미확인 포함)을 지도와 표로 보여 준다.
// 위치는 데모 모의값·약 1 km(D5 결정 전 잠정 기본값). 정밀 위치는 한 대 상세에서만 열리고 열람마다 감사된다.
// 데모 Fleet 위치는 5초마다, 상태는 SSE(차단·배포·회신·체험) 변경 때 바로 새로 고친다. 모든 값은 백엔드 응답 그대로다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ACTIVATION_LABEL, ACTIVATION_STATES, LOCATION_PRECISION_LABEL, SUBSCRIPTION_LABEL, SUBSCRIPTION_STATES, summarize, type FleetMapCluster, type FleetMapSummaryRow, type FleetMapVehicle, type MapLens } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { ops5y } from '../../copy/ops5y';
import { formatCount, formatExact } from '../../design/format';
import { AsyncView, DataTable, EventStream, KeyValue, PageHeader, Panel, Segmented, Select } from '../../design';
import { when } from '../shared';
import { ACTIVATION_VAR, FleetMapCanvas, HOLLOW_VAR, NO_RUNTIME_VAR, stateLabel, stateVar, SUBSCRIPTION_VAR, VIEWS, type MapView, type MapViewport } from './FleetMapCanvas';

const F = ko.fleetMap;
const O = ops5y.fleetMap;
const STREAM = ['kill.', 'publication.', 'vehicle.', 'trial.', 'entitlement.', 'readback.'];

interface MapResponse {
  generatedAt: string;
  source: string;
  flagKeys: string[];
  catalogs: { catalogId: string; name: string }[];
  precision: { level: string; label: string; degrees: number };
  provider: string;
  privacy: string;
  audited: boolean;
  items: FleetMapVehicle[];
  summary: FleetMapSummaryRow[];
  /** 범위 안 표본이 상한을 넘어 점으로 보내지 않은 수 */
  pointsOmitted?: number;
  clusters?: FleetMapCluster[];
  /** 대표 대수(가중) */
  represented?: number;
}

/** 시연 차량 요약(행 수)과 표본 요약(가중 대수)을 국가별로 합친다 */
function mergeSummary(a: FleetMapSummaryRow[], b: FleetMapSummaryRow[]): FleetMapSummaryRow[] {
  const m = new Map<string, FleetMapSummaryRow>();
  for (const r of [...a, ...b]) {
    const c = m.get(r.country);
    if (!c) {
      m.set(r.country, { ...r, subscription: { ...r.subscription }, activation: { ...r.activation } });
      continue;
    }
    c.total += r.total;
    c.located += r.located;
    for (const k of SUBSCRIPTION_STATES) c.subscription[k] += r.subscription[k];
    for (const k of ACTIVATION_STATES) c.activation[k] += r.activation[k];
  }
  return [...m.values()].sort((x, y) => y.total - x.total);
}

/** 화면 범위를 요청 값으로 — 확대는 정수, 범위는 바깥쪽으로 0.5° 맞춤(조금 움직일 때마다 다시 받지 않게).
 * 범위를 모르거나 정적 데모(URL로 찾는 스냅샷)면 넣지 않는다 — 서버 기본(확대 1·세계 전체)과 같다 */
function viewQuery(v: MapViewport | null) {
  if (!v || STATIC_MODE) return {};
  const out = (x: number, f: (n: number) => number) => f(x * 2) / 2;
  const [w, so, e, n] = v.bbox;
  return { zoom: Math.round(v.zoom), bbox: [out(w, Math.floor), out(so, Math.floor), out(e, Math.ceil), out(n, Math.ceil)].join(',') };
}
interface DetailResponse {
  vehicle: FleetMapVehicle;
  grants: {
    grantId: string;
    catalogId: string;
    kind: string;
    state: string;
    validFrom: string;
    validTo: string;
    effective: boolean;
  }[];
  runtime: {
    featureState: Record<string, string>;
    flags: {
      flagKey: string;
      local: { value: boolean; reason: string };
      drift: boolean;
    }[];
    quality: string;
    last: { at: string } | null;
  } | null;
  audited: boolean;
}

export function StateChip({ cssVar, label }: { cssVar: string; label: string }) {
  // 지도의 속이 빈 자동차(권한 없음)와 같게 칩도 테두리만
  const hollow = cssVar === HOLLOW_VAR;
  return (
    <span className="fm-chip">
      <span className="fm-chip__dot" data-hollow={hollow || undefined} style={hollow ? { border: `2px solid var(${cssVar})` } : { background: `var(${cssVar})` }} aria-hidden="true" />
      {label}
    </span>
  );
}

function Legend({ lens, items, summary, clustered }: { lens: MapLens; items: FleetMapVehicle[]; summary: FleetMapSummaryRow[]; clustered: boolean }) {
  // 수는 국가 요약(표본은 가중 대수)에서 — 그린 점 수가 아니라 대표 대수
  const sub = (s: (typeof SUBSCRIPTION_STATES)[number]) => summary.reduce((t, r) => t + r.subscription[s], 0);
  const act = (s: (typeof ACTIVATION_STATES)[number]) => summary.reduce((t, r) => t + r.activation[s], 0);
  const total = summary.reduce((t, r) => t + r.total, 0);
  const noRuntime = total - ACTIVATION_STATES.reduce((t, s) => t + act(s), 0);
  const rows =
    lens === 'subscription'
      ? SUBSCRIPTION_STATES.map((s) => ({
          key: s,
          v: SUBSCRIPTION_VAR[s],
          label: SUBSCRIPTION_LABEL[s],
          n: sub(s),
        }))
      : [
          ...ACTIVATION_STATES.map((s) => ({
            key: s,
            v: ACTIVATION_VAR[s],
            label: ACTIVATION_LABEL[s],
            n: act(s),
          })),
          ...(noRuntime > 0
            ? [
                {
                  key: 'none',
                  v: NO_RUNTIME_VAR,
                  label: '런타임 없음(합성)',
                  n: noRuntime,
                },
              ]
            : []),
        ];
  return (
    <ul className="fm-legend" aria-label={F.legend}>
      {rows.map((r) => (
        <li key={r.key}>
          <StateChip cssVar={r.v} label={r.label} />
          <span className="fm-legend__n" title={formatExact(r.n)}>
            {formatCount(r.n)}
          </span>
        </li>
      ))}
      <li>
        <span className="fm-chip">
          <span className="fm-chip__ring" aria-hidden="true" />
          {LOCATION_PRECISION_LABEL.REGION}
        </span>
      </li>
      {items.some((x) => x.source === 'DEMO') && (
        <li>
          <span className="fm-chip">
            <svg className="fm-chip__car" viewBox="0 0 12 20" aria-hidden="true">
              <path d="M2 6.5V17q0 1.5 1.5 1.5h5Q10 18.5 10 17V6.5Q10 2 6 1Q2 2 2 6.5z" />
              <path d="M3.4 7.6h5.2l-.6 2.8H4z" className="fm-chip__glass" />
            </svg>
            {F.legendCar}
          </span>
        </li>
      )}
      {clustered && (
        <li>
          <span className="fm-chip">
            <span className="fm-chip__dot fm-chip__dot--cluster" aria-hidden="true" />
            {O.legendCluster}
          </span>
        </li>
      )}
      {items.some((x) => x.source === 'SYNTHETIC') && (
        <li>
          <span className="fm-chip">
            <span className="fm-chip__dot fm-chip__dot--sm" aria-hidden="true" />
            {F.legendDot}
          </span>
        </li>
      )}
    </ul>
  );
}

function Detail({ vin }: { vin: string }) {
  // 상세는 열람마다 감사되므로 주기적으로 다시 읽지 않는다
  const q = useApi<DetailResponse>('fleetMapVehicle', { params: { vin } }, { staleTime: Infinity });
  return (
    <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
      {q.data &&
        (() => {
          const d = q.data;
          const v = d.vehicle;
          return (
            <div className="fm-detail" data-testid="fleet-map-detail">
              <KeyValue
                rows={[
                  {
                    k: F.col.vehicle,
                    v: `${v.label ?? '—'} · ${v.vehicleModel} ${v.trim}`,
                    note: v.vin,
                  },
                  {
                    k: F.position,
                    v: v.position ? `${v.position.lat}, ${v.position.lng}` : '—',
                    note: v.position ? `${v.position.city} · ${v.country} ${v.region}` : undefined,
                  },
                  {
                    k: F.accuracy,
                    v: v.position ? LOCATION_PRECISION_LABEL[v.position.precision] : '—',
                  },
                  {
                    k: F.col.link,
                    v: v.link ? `${v.link}${v.stale ? ` · ${F.stale}` : v.moving ? ` · ${F.moving}` : ''}` : F.parked,
                    note: v.position?.heading != null ? `${F.heading} ${v.position.heading}°` : undefined,
                  },
                  {
                    k: F.col.subscription,
                    v: <StateChip cssVar={SUBSCRIPTION_VAR[v.subscription]} label={SUBSCRIPTION_LABEL[v.subscription]} />,
                  },
                  {
                    k: F.col.activation,
                    v: v.activation ? <StateChip cssVar={ACTIVATION_VAR[v.activation]} label={ACTIVATION_LABEL[v.activation]} /> : F.noRuntime,
                  },
                ]}
              />
              <p className="fm-note">{F.detailAudit}</p>
              <DataTable
                caption={F.grants}
                rows={d.grants}
                rowKey={(g) => g.grantId}
                columns={[
                  // 좁은 옆 패널 — 칸을 둘씩 묶어 세 칸으로
                  {
                    key: 'id',
                    header: F.grantCol.grant,
                    cell: (g) => (
                      <>
                        <span className="ds-mono">{g.grantId}</span>
                        <div className="fm-sub ds-mono">{g.catalogId}</div>
                      </>
                    ),
                  },
                  {
                    key: 's',
                    header: F.grantCol.state,
                    cell: (g) => (
                      <>
                        {g.kind}
                        <div className="fm-sub">{`${g.state}${g.effective ? ' · ON' : ''}`}</div>
                      </>
                    ),
                  },
                  {
                    key: 'p',
                    header: F.grantCol.period,
                    cell: (g) => (
                      <span className="ds-mono">
                        {g.validFrom}
                        <div className="fm-sub">~{g.validTo}</div>
                      </span>
                    ),
                  },
                ]}
              />
              {d.runtime && (
                <>
                  <DataTable
                    caption={F.flags}
                    rows={d.runtime.flags}
                    rowKey={(f) => f.flagKey}
                    columns={[
                      {
                        key: 'f',
                        header: F.flag,
                        cell: (f) => <span className="ds-mono">{f.flagKey}</span>,
                      },
                      {
                        key: 'v',
                        header: '값',
                        cell: (f) => (f.local.value ? 'ON' : 'OFF'),
                      },
                      {
                        key: 'r',
                        header: '사유',
                        cell: (f) => (
                          <span className="ds-mono">
                            {f.local.reason}
                            {f.drift ? ' ≠' : ''}
                          </span>
                        ),
                      },
                    ]}
                  />
                  <Link to={`/fleet/vehicles/${encodeURIComponent(v.vin)}`}>{F.runtimeLink} →</Link>
                </>
              )}
            </div>
          );
        })()}
    </AsyncView>
  );
}

export function FleetMapScreen() {
  const [sp, setSp] = useSearchParams();
  const [lens, setLens] = useState<MapLens>('subscription');
  const [withSynthetic, setWithSynthetic] = useState(false);
  const [catalogId, setCatalogId] = useState('');
  const [flagKey, setFlagKey] = useState('');
  const [view, setView] = useState<MapView>('world');
  const selected = sp.get('vin');
  const select = (vin: string, scroll = false) => {
    setSp((p) => {
      const n = new URLSearchParams(p);
      n.set('vin', vin);
      return n;
    });
    // 아래 표에서 고르면 상세가 보이게 올린다
    if (scroll) requestAnimationFrame(() => document.getElementById('fm-side')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  };
  const clear = () =>
    setSp((p) => {
      const n = new URLSearchParams(p);
      n.delete('vin');
      return n;
    });

  const demo = useApi<MapResponse>(
    'fleetMap',
    { query: { source: 'DEMO', catalogId, flagKey } },
    {
      refetchInterval: STATIC_MODE ? false : 5000,
      placeholderData: (prev) => prev,
    },
  );
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(settle.current), []);
  const onViewChange = (v: MapViewport) => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setViewport(v), 250);
  };
  const syn = useApi<MapResponse>(
    'fleetMap',
    { query: { source: 'SYNTHETIC', catalogId, ...viewQuery(viewport) } },
    {
      enabled: withSynthetic,
      staleTime: 60_000,
      placeholderData: (prev) => prev,
    },
  );
  const live = usePlatformEvents(STREAM, ['fleetMap']);

  const items = useMemo(() => [...(demo.data?.items ?? []), ...(withSynthetic ? (syn.data?.items ?? []) : [])], [demo.data, syn.data, withSynthetic]);
  const synData = withSynthetic ? syn.data : undefined;
  const summary = useMemo(() => (synData ? mergeSummary(summarize(demo.data?.items ?? []), synData.summary) : summarize(items)), [items, demo.data, synData]);
  const clusters = useMemo(() => (synData && synData.pointsOmitted ? (synData.clusters ?? []) : []), [synData]);
  const represented = summary.reduce((t, r) => t + r.total, 0);
  const sampled = clusters.reduce((t, c) => t + c.sample, 0);
  // 안내 문구는 지금 보이는 범위 기준 — 국가 요약(전체)과 다르다
  const inView = clusters.reduce((t, c) => t + c.count, 0);
  const count = (pred: (v: FleetMapVehicle) => boolean) => items.filter(pred).length.toLocaleString('ko-KR');
  const demoItems = demo.data?.items ?? [];
  const forbidden = demo.error?.status === 403;

  const controls = (
    <div className="fm-controls">
      <Segmented<MapLens>
        label={F.lens}
        value={lens}
        onChange={setLens}
        options={[
          { value: 'subscription', label: F.lensSubscription },
          { value: 'activation', label: F.lensActivation },
        ]}
      />
      <Segmented<'demo' | 'all'>
        label={F.source}
        value={withSynthetic ? 'all' : 'demo'}
        onChange={(v) => setWithSynthetic(v === 'all')}
        options={[
          { value: 'demo', label: F.sourceDemo },
          { value: 'all', label: O.sourceAll },
        ]}
      />
      {lens === 'subscription' ? (
        <Select label={F.catalog} value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
          <option value="">{F.allCatalogs}</option>
          {(demo.data?.catalogs ?? []).map((c) => (
            <option key={c.catalogId} value={c.catalogId}>
              {c.catalogId} · {c.name}
            </option>
          ))}
        </Select>
      ) : (
        <Select label={F.flag} value={flagKey} onChange={(e) => setFlagKey(e.target.value)}>
          <option value="">{F.allFlags}</option>
          {(demo.data?.flagKeys ?? []).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
  const summaryTable = (
    <DataTable
      caption={F.summary}
      rows={summary}
      rowKey={(r) => r.country}
      columns={[
        {
          key: 'c',
          header: F.col.country,
          cell: (r) => <span className="ds-mono">{r.country}</span>,
        },
        {
          key: 't',
          header: F.col.total,
          cell: (r) => <span title={formatExact(r.total)}>{formatCount(r.total)}</span>,
          align: 'right',
        },
        ...(lens === 'subscription'
          ? (['PAID', 'TRIAL', 'OFFERED'] as const).map((s) => ({
              key: s,
              header: SUBSCRIPTION_LABEL[s],
              cell: (r: FleetMapSummaryRow) => <span title={formatExact(r.subscription[s])}>{formatCount(r.subscription[s])}</span>,
              align: 'right' as const,
            }))
          : (['ON', 'DISABLED', 'UNKNOWN'] as const).map((s) => ({
              key: s,
              header: ACTIVATION_LABEL[s].replace(/\(.*\)/, ''),
              cell: (r: FleetMapSummaryRow) => <span title={formatExact(r.activation[s])}>{formatCount(r.activation[s])}</span>,
              align: 'right' as const,
            }))),
      ]}
    />
  );

  return (
    <div className="ds-screen">
      <PageHeader
        codes={F.eyebrow}
        title={F.title}
        lead={F.lead}
        message={(() => {
          const n = items.filter((v) => v.activation === 'DISABLED' || v.activation === 'UNKNOWN').length;
          const killed = items.some((v) => v.activation === 'DISABLED');
          return forbidden ? { tone: 'neutral', text: F.key.forbidden } : !demo.data ? { tone: 'neutral', value: '—', text: F.key.attention } : n ? { tone: killed ? 'danger' : 'warn', value: n, text: F.key.attention } : { tone: 'ok', text: F.key.clean };
        })()}
      />
      {forbidden ? (
        <Panel title={F.privacyTitle} id="fm-forbidden">
          <AsyncView state="forbidden">{null}</AsyncView>
          <p className="fm-note">{F.forbidden}</p>
        </Panel>
      ) : (
        <>

          <div className="fm-layout">
            <Panel
              title={F.map}
              id="fm-map"
              actions={
                <Segmented<MapView>
                  label={F.region}
                  value={view}
                  onChange={setView}
                  options={(Object.keys(VIEWS) as MapView[]).map((k) => ({
                    value: k,
                    label: F.regions[k],
                  }))}
                />
              }
              eyebrow={`${synData ? O.represented(represented) : `${F.kpi.located} ${count((v) => !!v.position)}/${items.length.toLocaleString('ko-KR')}`}${demo.data ? ` · ${F.updated(when(demo.data.generatedAt))}` : ''}`}
            >
              {controls}
              <AsyncView state={asyncState(demo, false)} error={demo.error?.message} onRetry={() => demo.refetch()}>
                <FleetMapCanvas items={items} lens={lens} selected={selected} onSelect={select} view={view} clusters={clusters} onViewChange={onViewChange} />
                <Legend lens={lens} items={items} summary={summary} clustered={clusters.length > 0} />
                {synData && (clusters.length ? <p className="fm-note">{O.clusterNote(inView, sampled)}</p> : synData.items.length > 0 && <p className="fm-note">{O.pointsNote(synData.items.length)}</p>)}
                {synData && lens === 'activation' && <p className="fm-note">{O.activationNote}</p>}
              </AsyncView>
            </Panel>
            <div id="fm-side" className="fm-side">
              <Panel
                title={selected ? F.detail(selected) : F.summary}
                id="fm-detail"
                actions={
                  selected ? (
                    <button type="button" className="fm-linkbtn" onClick={clear}>
                      {F.close}
                    </button>
                  ) : undefined
                }
              >
                {selected ? (
                  <Detail key={selected} vin={selected} />
                ) : (
                  <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                    <p className="fm-note">{F.pick}</p>
                    {summaryTable}
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <Panel title={F.vehicles} id="fm-vehicles" eyebrow={F.sourceDemo}>
            <DataTable
              caption={F.vehicles}
              rows={demoItems}
              rowKey={(v) => v.vin}
              onOpen={(v) => select(v.vin, true)}
              columns={[
                {
                  key: 'v',
                  header: F.col.vehicle,
                  cell: (v) => (
                    <>
                      <span className="ds-mono">{v.vin}</span>
                      <div className="fm-sub">{v.label}</div>
                    </>
                  ),
                },
                {
                  key: 'p',
                  header: F.col.place,
                  cell: (v) => (v.position ? `${v.position.city} · ${v.country} ${v.region}` : '—'),
                },
                {
                  key: 'a',
                  header: F.accuracy,
                  cell: (v) => (v.position ? LOCATION_PRECISION_LABEL[v.position.precision] : '—'),
                },
                {
                  key: 's',
                  header: F.col.subscription,
                  cell: (v) => <StateChip cssVar={SUBSCRIPTION_VAR[v.subscription]} label={SUBSCRIPTION_LABEL[v.subscription]} />,
                },
                {
                  key: 'x',
                  header: F.col.activation,
                  cell: (v) => <StateChip cssVar={stateVar(v, 'activation')} label={stateLabel(v, 'activation')} />,
                },
                {
                  key: 'k',
                  header: F.col.link,
                  cell: (v) => (v.stale ? F.stale : v.link === 'ONLINE' ? F.moving : '—'),
                },
              ]}
            />
          </Panel>

          <div className="ds-split">
            <Panel title={F.privacyTitle} eyebrow={F.privacyPending} id="fm-privacy">
              <KeyValue
                rows={[
                  { k: F.provider, v: demo.data?.provider ?? '—' },
                  { k: F.precision, v: demo.data?.precision.label ?? '—' },
                ]}
              />
              <p className="fm-note">{demo.data?.privacy}</p>
              <p className="fm-note">{F.tiles}</p>
              <p className="fm-note">{demo.data?.audited ? F.auditedNow : F.auditedWindow}</p>
            </Panel>
            <Panel title={F.live} id="fm-live">
              <EventStream items={live} max={12} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

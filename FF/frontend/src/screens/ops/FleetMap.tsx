// /fleet/map — 전세계 차량 지도 (D02-03). 차량마다 위치·구독 상태·기능 활성(차단·미확인 포함)을 지도와 표로 보여 준다.
// 위치는 데모 모의값·약 1 km(D5 결정 전 잠정 기본값). 정밀 위치는 한 대 상세에서만 열리고 열람마다 감사된다.
// 데모 Fleet 위치는 5초마다, 상태는 SSE(차단·배포·회신·체험) 변경 때 바로 새로 고친다. 모든 값은 백엔드 응답 그대로다.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ACTIVATION_LABEL, ACTIVATION_STATES, LOCATION_PRECISION_LABEL, SUBSCRIPTION_LABEL, SUBSCRIPTION_STATES, summarize, type FleetMapSummaryRow, type FleetMapVehicle, type MapLens } from '@ff/contracts';
import { asyncState, useApi } from '../../api/hooks';
import { STATIC_MODE } from '../../api/client';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { AsyncView, DataTable, EventStream, KeyValue, Kpi, PageHeader, Panel, Segmented, Select } from '../../design';
import { when } from '../shared';
import { ACTIVATION_VAR, FleetMapCanvas, HOLLOW_VAR, NO_RUNTIME_VAR, stateLabel, stateVar, SUBSCRIPTION_VAR, VIEWS, type MapView } from './FleetMapCanvas';

const F = ko.fleetMap;
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

function Legend({ lens, items }: { lens: MapLens; items: FleetMapVehicle[] }) {
  const rows =
    lens === 'subscription'
      ? SUBSCRIPTION_STATES.map((s) => ({
          key: s,
          v: SUBSCRIPTION_VAR[s],
          label: SUBSCRIPTION_LABEL[s],
          n: items.filter((x) => x.subscription === s).length,
        }))
      : [
          ...ACTIVATION_STATES.map((s) => ({
            key: s,
            v: ACTIVATION_VAR[s],
            label: ACTIVATION_LABEL[s],
            n: items.filter((x) => x.activation === s).length,
          })),
          ...(items.some((x) => !x.activation)
            ? [
                {
                  key: 'none',
                  v: NO_RUNTIME_VAR,
                  label: '런타임 없음(합성)',
                  n: items.filter((x) => !x.activation).length,
                },
              ]
            : []),
        ];
  return (
    <ul className="fm-legend" aria-label={F.legend}>
      {rows.map((r) => (
        <li key={r.key}>
          <StateChip cssVar={r.v} label={r.label} />
          <span className="fm-legend__n">{r.n.toLocaleString('ko-KR')}</span>
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
  const syn = useApi<MapResponse>(
    'fleetMap',
    { query: { source: 'SYNTHETIC', catalogId } },
    {
      enabled: withSynthetic,
      staleTime: 60_000,
      placeholderData: (prev) => prev,
    },
  );
  const live = usePlatformEvents(STREAM, ['fleetMap']);

  const items = useMemo(() => [...(demo.data?.items ?? []), ...(withSynthetic ? (syn.data?.items ?? []) : [])], [demo.data, syn.data, withSynthetic]);
  const summary = useMemo(() => summarize(items), [items]);
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
          { value: 'all', label: F.sourceAll },
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
          cell: (r) => r.total.toLocaleString('ko-KR'),
          align: 'right',
        },
        ...(lens === 'subscription'
          ? (['PAID', 'TRIAL', 'OFFERED'] as const).map((s) => ({
              key: s,
              header: SUBSCRIPTION_LABEL[s],
              cell: (r: FleetMapSummaryRow) => r.subscription[s].toLocaleString('ko-KR'),
              align: 'right' as const,
            }))
          : (['ON', 'DISABLED', 'UNKNOWN'] as const).map((s) => ({
              key: s,
              header: ACTIVATION_LABEL[s].replace(/\(.*\)/, ''),
              cell: (r: FleetMapSummaryRow) => r.activation[s].toLocaleString('ko-KR'),
              align: 'right' as const,
            }))),
      ]}
    />
  );

  return (
    <div className="ds-screen">
      <PageHeader eyebrow={F.eyebrow} title={F.title} lead={F.lead} />
      {forbidden ? (
        <Panel title={F.privacyTitle} id="fm-forbidden">
          <AsyncView state="forbidden">{null}</AsyncView>
          <p className="fm-note">{F.forbidden}</p>
        </Panel>
      ) : (
        <>
          <div className="ds-kpis">
            <Kpi label={F.kpi.paid} value={count((v) => v.subscription === 'PAID')} />
            <Kpi label={F.kpi.trial} value={count((v) => v.subscription === 'TRIAL')} tone="accent" />
            <Kpi label={F.kpi.killed} value={count((v) => v.activation === 'DISABLED')} tone={items.some((v) => v.activation === 'DISABLED') ? 'danger' : undefined} />
            <Kpi label={F.kpi.unknown} value={count((v) => v.activation === 'UNKNOWN')} tone={items.some((v) => v.activation === 'UNKNOWN') ? 'warn' : undefined} />
          </div>

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
              eyebrow={`${F.kpi.located} ${count((v) => !!v.position)}/${items.length.toLocaleString('ko-KR')}${demo.data ? ` · ${F.updated(when(demo.data.generatedAt))}` : ''}`}
            >
              {controls}
              <AsyncView state={asyncState(demo, false)} error={demo.error?.message} onRetry={() => demo.refetch()}>
                <FleetMapCanvas items={items} lens={lens} selected={selected} onSelect={select} view={view} />
                <Legend lens={lens} items={items} />
                {withSynthetic && lens === 'activation' && syn.data && <p className="fm-note">{F.syntheticNote(syn.data.items.length)}</p>}
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

// /entitlements — 사용 권한·체험권 (D01-05 · 구매 전환 D05-04). 체험권은 차량마다 따로: 제안(14일) → 수락(30일 ON) → 만료·거절·구매 전환.
// 체험권 차량 목록은 상태·성향 필터와 쪽 나눔, 합성 모집단(통계용 가상 데이터)은 표시해서 구분한다.
import { lazy, Suspense, useState, type CSSProperties } from 'react';
import type { OrdersView } from '@ff/contracts';
import { orders as OR } from '../../copy/ads-state';
import { ordersMessage } from '../ads/state-messages';
import { Link, useSearchParams } from 'react-router-dom';
import { ADAS_USAGE, AGE_BANDS, DRIVING_STYLES, referenceCodes, TRIAL_PAGE_SIZE, TRIAL_STATES, trialListQuery, type ReferenceValue, type SegmentDimension, type TrialSource } from '@ff/contracts';
import { useConnectionLabel } from '../../api/connections';
import { connections as CN } from '../../copy/connections';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { planning as W } from '../../copy/planning';
import { AsyncView, Button, ConnectionBadge, DataTable, ErrorNote, Field, IdChip, PageHeader, Panel, Segmented, Select, StatusGlyph, Tabs, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';

const E = ko.entitlement;
const T = ko.trial;
// 주문 추적(ORC-UI01) — 탭을 열 때만 부품을 읽는다(화면 묶음 예산)
const OrdersPanel = lazy(() => import('../ads/StatePanels').then((m) => ({ default: m.OrdersPanel })));

interface Profile {
  country: string;
  region: string;
  vehicleModel: string;
  trim: string;
  ageBand: string;
  drivingStyle: string;
  adasUsage: string;
}
export interface GrantRow {
  grantId: string;
  vin: string;
  catalogId: string;
  kind: string;
  validFrom: string;
  validTo: string;
  status: string;
  state: string;
  effective: boolean;
  daysLeft: number | null;
  offeredAt: string | null;
  acceptedAt: string | null;
  convertedAt: string | null;
  convertedPlan: string | null;
  fromTrial: string | null;
  source: 'PRODUCTION' | 'DEMO' | 'SYNTHETIC';
  note: string | null;
  profile?: Profile | null;
}
interface TrialPage {
  today: string;
  total: number;
  page: number;
  pageSize: number;
  byState: Record<string, number>;
  items: GrantRow[];
}

/** 체험 상태 배지 — 색과 모양을 함께(색맹 대비): 체험 중·구매 전환 ●, 제안 중 ◐, 만료 ○, 거절 ✕ */
const STATE_KIND: Record<string, 'PASS' | 'REVIEW' | 'UNJUDGED' | 'FAIL'> = { ACTIVE: 'PASS', CONVERTED: 'PASS', OFFERED: 'REVIEW', DECLINED: 'FAIL', EXPIRED: 'UNJUDGED', REVOKED: 'FAIL' };
export function TrialState({ state }: { state: string }) {
  const k = STATE_KIND[state] ?? 'UNJUDGED';
  return (
    <span className="ds-badge" data-trial-state={state} style={{ '--c': `var(--gate-${k})` } as CSSProperties}>
      <StatusGlyph kind={k} />
      <span className="ds-badge__ko">{T.states[state] ?? state}</span>
    </span>
  );
}

/** 표에서는 월-일만(전체 날짜는 title) — 1366·1536에서 처리 버튼까지 한 화면에 */
const md = (ymd: string | null) => (ymd ? ymd.slice(5) : '—');

/** 성향 필터 — 판매국·지역은 이 설치에 등록된 고객 기준 값(RD-OPS-03, 데모 목록이 아니다), 나머지는 가명 구간값 */
const SEGMENTS: { dim: SegmentDimension; options: (seg: Partial<Record<SegmentDimension, string>>, refs: readonly ReferenceValue[] | undefined) => readonly string[] }[] = [
  { dim: 'country', options: (_s, refs) => referenceCodes(refs, 'COUNTRY') },
  { dim: 'region', options: (s, refs) => (s.country ? referenceCodes(refs, 'REGION', s.country) : []) },
  { dim: 'ageBand', options: () => AGE_BANDS },
  { dim: 'drivingStyle', options: () => DRIVING_STYLES },
  { dim: 'adasUsage', options: () => ADAS_USAGE },
];

/** 체험 상품 — 주소 ?catalog= 또는 이 설치에 실제로 등록된 체험 상품. 빈 설치에는 임의 ID를 만들지 않는다. */
interface ProductLite {
  catalogId: string;
  version: string;
  name: string;
  lifecycle: string;
  country: string;
  vehicleModel: string;
  trim: string;
  saleType?: string;
}
interface VehicleLite {
  vin: string;
  label: string;
  country?: string;
  vehicleModel?: string;
  trim?: string;
  gleo?: boolean;
  fleet?: string;
}

/**
 * 고객 체험을 제안할 수 있는 차량(P1-3) — 시뮬레이터(영상 키트)·통계 표본 차량은 빼고, 상품 범위(국가·차종·트림)와 같은 차량(inScope)과
 * 범위 밖 차량(outOfScope, 펼쳐야 보인다 — 켤 수 있는지는 서버가 차량별로 다시 본다)으로 나눈다
 */
export function offerableVehicles(vehicles: VehicleLite[], p: Pick<ProductLite, 'country' | 'vehicleModel' | 'trim'> | undefined) {
  const customer = vehicles.filter((v) => !v.gleo && v.fleet !== 'SAMPLE');
  const fits = (v: VehicleLite) => !p || (v.country === p.country && v.vehicleModel === p.vehicleModel && v.trim === p.trim);
  return { inScope: customer.filter(fits), outOfScope: customer.filter((v) => !fits(v)) };
}

export function EntitlementsScreen() {
  const [sp, setSp] = useSearchParams();
  const products = useApi<{ items: ProductLite[] }>('listProducts');
  const latest = latestProducts(products.data?.items ?? []);
  const requested = sp.get('catalog');
  // 등록 차량의 실제 체험 이력을 우선한다. 구성 승인 체험은 운영 중일 수
  // 있으며, 새 초안이 ID 정렬의 앞에 왔다고 그 상품으로 조회하면 안 된다.
  const registered = useApi<{ items: GrantRow[] }>('entitlements', {}, { enabled: !requested && latest.length > 0 });
  const trialCatalogs = new Set((registered.data?.items ?? []).filter((g) => g.kind === '체험').map((g) => g.catalogId));
  const available = latest.filter((p) => p.lifecycle === 'APPROVED' || p.lifecycle === 'RELEASED');
  const fallback = available.find((p) => p.saleType === '체험' && trialCatalogs.has(p.catalogId)) ?? available.find((p) => p.saleType === '체험' && p.lifecycle === 'RELEASED') ?? available.find((p) => p.saleType === '체험') ?? available.find((p) => p.lifecycle === 'RELEASED');
  const product = requested ? latest.find((p) => p.catalogId === requested) : registered.isSuccess ? fallback : undefined;
  const catalogId = product?.catalogId ?? '';
  // 고객 출시 상품과 구성 승인 체험 상품. 명시한 출시 전 상품도 주소 그대로 남긴다.
  const choices = latest.filter((p) => p.lifecycle === 'RELEASED' || (p.saleType === '체험' && p.lifecycle === 'APPROVED') || p.catalogId === catalogId);
  const selection = products.isPending || products.isError || !latest.length || requested ? products : registered;
  const all = useApi<TrialPage>('trials', { query: trialListQuery({ catalogId, source: 'ALL', state: '', segment: {}, q: '', page: 1 }) }, { enabled: !!catalogId });
  const active = all.isSuccess ? all.data.byState.ACTIVE ?? 0 : undefined;
  // 활성 탭이 핵심 메시지를 고른다(P-10) — '주문 추적'이면 기한 넘긴 사용 준비 미확인 주문
  const onOrders = sp.get('tab') === 'orders';
  const orders = useApi<OrdersView>('adsOrders', {}, { enabled: onOrders });
  const operator = usePermission(['OPERATOR', 'OPS_LEAD']);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-05 · ENTITLEMENT · D05-04 BILLING"
        title={E.title}
        lead={onOrders ? OR.lead : E.lead}
        message={onOrders ? ordersMessage(orders.data) : { tone: 'neutral', value: active == null ? '—' : active.toLocaleString('ko-KR'), text: E.key }}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Select label={W.trial.product} value={catalogId} disabled={products.isPending || !choices.length} onChange={(e) => setSp((x) => (x.set('catalog', e.target.value), x), { replace: true })}>
              {!product && <option value="">{W.trial.chooseProduct}</option>}
              {choices.map((p) => (
                <option key={p.catalogId} value={p.catalogId}>
                  {p.lifecycle === 'RELEASED' ? `${p.catalogId} · ${p.name}` : W.trial.other(`${p.catalogId} · ${p.name}`)}
                </option>
              ))}
            </Select>
            <Link to="/biz/trials">{T.toAnalytics}</Link>
          </div>
        }
      />
      <Tabs tabs={[{ key: 'trials', label: E.tabs.trials }, { key: 'grants', label: E.tabs.grants }, { key: 'orders', label: OR.tab }]}>{(tab) => (tab === 'orders' ? <AsyncView state={asyncState(orders, !orders.data?.items?.length)} error={orders.isError ? OR.error : null} onRetry={() => orders.refetch()} empty={OR.empty}>{orders.data?.items ? <Suspense fallback={null}><OrdersPanel view={orders.data} canAct={operator.ok} /></Suspense> : null}</AsyncView> : tab === 'grants' ? <GrantsTable /> : <AsyncView state={asyncState(selection, !catalogId)} empty={{ title: W.trial.chooseProduct }} error={selection.error} onRetry={() => selection.refetch()}>{catalogId && <TrialVehicles key={catalogId} catalogId={catalogId} product={product} />}</AsyncView>)}</Tabs>
    </div>
  );
}

/** 상품별 가장 최신 Version */
function latestProducts(items: ProductLite[]): ProductLite[] {
  const by = new Map<string, ProductLite>();
  for (const p of items) {
    const cur = by.get(p.catalogId);
    if (!cur || cur.version.localeCompare(p.version, undefined, { numeric: true }) < 0) by.set(p.catalogId, p);
  }
  return [...by.values()].sort((a, b) => a.catalogId.localeCompare(b.catalogId));
}

function TrialVehicles({ catalogId, product }: { catalogId: string; product?: ProductLite }) {
  const [source, setSource] = useState<TrialSource>('ALL');
  const [state, setState] = useState('');
  const [segment, setSegment] = useState<Partial<Record<SegmentDimension, string>>>({});
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = trialListQuery({ catalogId, source, state, segment, q, page });
  const list = useApi<TrialPage>('trials', { query }, { placeholderData: (prev) => prev });
  const refs = useApi<{ items: ReferenceValue[] }>('referenceValues');
  const perm = usePermission(['OPERATOR', 'SYSTEM']);
  const invalidate = ['trials', 'entitlements', 'trialAnalytics', 'activationDecide', 'events', 'audit'];
  const accept = useApiMutation('acceptTrial', invalidate);
  const decline = useApiMutation('declineTrial', invalidate);
  const purchase = useApiMutation('purchaseTrial', invalidate);
  const busy = accept.isPending || decline.isPending || purchase.isPending;
  const billing = useConnectionLabel('billing');
  const data = list.data;
  const rows = data?.items ?? [];
  const reset = (f: () => void) => (f(), setPage(1));
  const C = T.col;
  const total = data ? Object.values(data.byState).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <Toolbar label={T.filters}>
        <Segmented label={T.source} options={(['ALL', 'FLEET', 'SYNTHETIC'] as const).map((v) => ({ value: v, label: T.sources[v] }))} value={source} onChange={(v) => reset(() => setSource(v))} />
        <Select label={T.state} value={state} onChange={(e) => reset(() => setState(e.target.value))}>
          <option value="">
            {T.any} {data ? `(${total.toLocaleString('ko-KR')})` : ''}
          </option>
          {TRIAL_STATES.map((s) => (
            <option key={s} value={s}>
              {T.states[s]} ({(data?.byState[s] ?? 0).toLocaleString('ko-KR')})
            </option>
          ))}
        </Select>
        {SEGMENTS.map(({ dim, options }) => {
          const opts = options(segment, refs.data?.items);
          if (!opts.length) return null;
          return (
            <Select key={dim} label={T.dims[dim]} value={segment[dim] ?? ''} onChange={(e) => reset(() => setSegment((s) => ({ ...s, [dim]: e.target.value || undefined, ...(dim === 'country' ? { region: undefined } : {}) })))}>
              <option value="">{T.any}</option>
              {opts.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          );
        })}
        <label className="ds-field ds-field--inline">
          <span className="ds-field__label">{T.search}</span>
          <input className="ds-input ds-input--mono" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        </label>
      </Toolbar>
      {source !== 'FLEET' && <p className="ds-field__hint">{T.syntheticNote}</p>}
      {/* 과금 시스템이 실제로 연결되기 전에는 구매 결과가 실제 결제가 아니다(RD-UX-04) */}
      {billing !== 'none' && (
        <p className="ds-field__hint" data-connection-note="billing">
          <ConnectionBadge state={billing} system={CN.system.billing} /> {billing === 'mock' ? CN.hint.mock(CN.system.billing) : CN.hint.disconnected(CN.system.billing)}
        </p>
      )}
      <ErrorNote error={accept.error ?? decline.error ?? purchase.error} />
      <AsyncView state={asyncState(list, rows.length === 0)} empty={{ title: T.empty }} error={list.error} onRetry={() => list.refetch()}>
        <div style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }} data-tour="trial-vehicles">
          <DataTable
            caption={E.tabs.trials}
            rows={rows}
            rowKey={(r) => r.grantId}
            maxHeight="62vh"
            columns={[
              { key: 'g', header: C.grant, cell: (r) => <span className="ds-mono ds-nowrap">{r.grantId}</span> },
              {
                key: 'vin',
                header: C.vin,
                cell: (r) => (
                  <span className="ds-mono ds-nowrap">
                    {r.source !== 'SYNTHETIC' ? <Link to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`}>{r.vin}</Link> : r.vin}
                    {r.source === 'SYNTHETIC' && <span className="ds-tag" style={{ marginLeft: 'var(--sp-1)' }}>{T.synthetic}</span>}
                  </span>
                ),
              },
              { key: 'st', header: C.state, cell: (r) => <TrialState state={r.state} /> },
              {
                key: 'act',
                header: '',
                cell: (r) => {
                  if (r.source === 'SYNTHETIC') return null;
                  const dis = !perm.ok || busy;
                  if (r.state === 'OFFERED')
                    return (
                      <span className="ds-nowrap" style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                        <Button disabled={dis} title={perm.hint} onClick={() => accept.mutate({ params: { grantId: r.grantId }, body: {} })}>
                          {T.accept}
                        </Button>
                        <Button variant="ghost" disabled={dis} title={perm.hint} onClick={() => decline.mutate({ params: { grantId: r.grantId }, body: {} })}>
                          {T.decline}
                        </Button>
                      </span>
                    );
                  if (r.acceptedAt && (r.state === 'ACTIVE' || r.state === 'EXPIRED'))
                    return (
                      <Button disabled={dis || billing === 'disconnected'} title={billing === 'disconnected' ? CN.billing.blocked : perm.hint} style={{ whiteSpace: 'nowrap' }} onClick={() => purchase.mutate({ params: { grantId: r.grantId }, body: { plan: '구독' } })}>
                        {T.purchase}
                      </Button>
                    );
                  return null;
                },
              },
              {
                key: 'sched',
                header: C.schedule,
                cell: (r) => (
                  <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }} title={`${r.offeredAt ?? '—'} · ${r.acceptedAt ?? '—'} · ${r.validTo}`}>
                    {md(r.offeredAt)} · {md(r.acceptedAt)} · {md(r.validTo)}
                  </span>
                ),
              },
              { key: 'left', header: C.left, cell: (r) => <span className="ds-mono ds-nowrap">{r.daysLeft === null ? '—' : T.days(r.daysLeft)}</span>, align: 'right' },
              { key: 'conv', header: C.converted, cell: (r) => (r.convertedAt ? <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)' }} title={r.convertedAt}>{`${r.convertedPlan} ${md(r.convertedAt)}`}</span> : '—') },
              { key: 'where', header: C.where, cell: (r) => <span className="ds-nowrap">{r.profile ? `${r.profile.country} · ${r.profile.region}` : '—'}</span> },
              { key: 'model', header: C.model, cell: (r) => <span className="ds-nowrap">{r.profile ? `${r.profile.vehicleModel} ${r.profile.trim}` : '—'}</span> },
              { key: 'persona', header: C.persona, cell: (r) => <span className="ds-nowrap">{r.profile ? `${r.profile.ageBand} · ${r.profile.drivingStyle} · ${T.adas(r.profile.adasUsage)}` : '—'}</span> },
            ]}
          />
        </div>
        {data && data.total > TRIAL_PAGE_SIZE && (
          <div className="ds-toolbar" role="navigation" aria-label={E.tabs.trials}>
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {T.prev}
            </Button>
            <span className="ds-mono">{T.page((page - 1) * TRIAL_PAGE_SIZE + 1, Math.min(page * TRIAL_PAGE_SIZE, data.total), data.total)}</span>
            <Button disabled={page * TRIAL_PAGE_SIZE >= data.total} onClick={() => setPage((p) => p + 1)}>
              {T.next}
            </Button>
          </div>
        )}
      </AsyncView>
      <OfferPanel catalogId={catalogId} product={product} />
    </>
  );
}

function OfferPanel({ catalogId, product }: { catalogId: string; product?: ProductLite }) {
  const vehicles = useApi<{ items: VehicleLite[] }>('vehicles');
  const { inScope, outOfScope } = offerableVehicles(vehicles.data?.items ?? [], product);
  const [wide, setWide] = useState(false);
  const shown = wide ? [...inScope, ...outOfScope] : inScope;
  const scope = product ? `${product.country}/${product.vehicleModel}/${product.trim}` : null;
  const perm = usePermission(['PRODUCT_AUTHOR', 'OPERATOR', 'SYSTEM']);
  const offer = useApiMutation<{ offered: GrantRow[]; skipped: { vin: string; reason: string }[] }>('offerTrials', ['trials', 'entitlements', 'trialAnalytics', 'events', 'audit']);
  const [vins, setVins] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const O = T.offer;
  return (
    <Panel title={O.title} eyebrow={product ? `${catalogId} · ${product.name}` : catalogId} id="trial-offer">
      <p className="ds-field__hint">{O.lead}</p>
      {scope && vehicles.data && <p className="ds-field__hint" data-testid="offer-scope">{inScope.length ? W.trial.scope(scope, inScope.length) : W.trial.none(scope)}</p>}
      {outOfScope.length > 0 && (
        <label className="ds-choices">
          <input type="checkbox" checked={wide} onChange={(e) => (setWide(e.target.checked), e.target.checked || setVins((xs) => xs.filter((x) => inScope.some((v) => v.vin === x))))} />
          {W.trial.wide(outOfScope.length)}
        </label>
      )}
      <fieldset className="ds-choices" aria-label={O.vehicles}>
        <legend className="ds-field__label">
          {O.vehicles} ({vins.length})
        </legend>
        {shown.map((v) => (
          <label key={v.vin}>
            <input type="checkbox" checked={vins.includes(v.vin)} onChange={() => setVins((xs) => (xs.includes(v.vin) ? xs.filter((x) => x !== v.vin) : [...xs, v.vin]))} />
            {W.trial.vehicleLabel(v.vin, v.label)}
            {outOfScope.includes(v) && <span className="ds-tag" style={{ marginLeft: 'var(--sp-1)' }}>{W.trial.outTag}</span>}
          </label>
        ))}
      </fieldset>
      <Field label={O.note}>
        <input className="ds-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorNote error={offer.error} />
      {offer.data && (
        <p className="ds-ok" role="status">
          {O.done(offer.data.offered.length, offer.data.skipped.length)}
          {offer.data.skipped.length > 0 && ` — ${offer.data.skipped.map((s) => `${s.vin}: ${s.reason}`).join(' · ')}`}
        </p>
      )}
      <Button variant="primary" disabled={!perm.ok || !vins.length || offer.isPending} title={perm.hint} onClick={() => offer.mutate({ body: { catalogId, vins, ...(note.trim() ? { note: note.trim() } : {}) } }, { onSuccess: () => setVins([]) })}>
        {O.submit}
      </Button>
    </Panel>
  );
}

function GrantsTable() {
  const q = useApi<{ items: GrantRow[] }>('entitlements');
  const rows = q.data?.items ?? [];
  const C = E.col;
  return (
    <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
      <DataTable
        caption={E.tabs.grants}
        rows={rows}
        rowKey={(r) => r.grantId}
        columns={[
          { key: 'g', header: C.grant, cell: (r) => <span className="ds-mono">{r.grantId}</span>, sort: (r) => r.grantId },
          { key: 'vin', header: C.vin, cell: (r) => <span className="ds-mono">{r.vin}</span>, sort: (r) => r.vin },
          { key: 'cat', header: C.catalog, cell: (r) => <IdChip id={r.catalogId} copy={false} /> },
          { key: 'kind', header: C.kind, cell: (r) => <span className="ds-tag">{r.kind}</span> },
          { key: 'period', header: C.period, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.validFrom} ~ {r.validTo}</span> },
          { key: 'st', header: C.status, cell: (r) => <TrialState state={r.state} /> },
          { key: 'eff', header: C.effective, cell: (r) => <VerdictBadge value={r.effective ? 'PASS' : 'FAIL'} /> },
          { key: 'from', header: C.origin, cell: (r) => (r.fromTrial ? <span className="ds-mono">{r.fromTrial}</span> : '—') },
        ]}
      />
    </AsyncView>
  );
}

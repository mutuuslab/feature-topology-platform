// /entitlements — 사용 권한·체험권 (D01-05 · 구매 전환 D05-04). 체험권은 차량마다 따로: 제안(14일) → 수락(30일 ON) → 만료·거절·구매 전환.
// 체험권 차량 목록은 상태·성향 필터와 쪽 나눔, 합성 모집단(통계용 가상 데이터)은 표시해서 구분한다.
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ADAS_USAGE, AGE_BANDS, DRIVING_STYLES, regionsOf, TRIAL_COUNTRIES, TRIAL_PAGE_SIZE, TRIAL_STATES, trialListQuery, type SegmentDimension, type TrialSource } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { useConnectionLabel } from '../../api/connections';
import { connections as CN } from '../../copy/connections';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, ConnectionBadge, DataTable, ErrorNote, Field, IdChip, PageHeader, Panel, Segmented, Select, StatusGlyph, Tabs, Toolbar, VerdictBadge } from '../../design';
import { usePermission } from '../shared';

const E = ko.entitlement;
const T = ko.trial;

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
  source: 'DEMO' | 'SYNTHETIC';
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

const SEGMENTS: { dim: SegmentDimension; options: (seg: Partial<Record<SegmentDimension, string>>) => readonly string[] }[] = [
  { dim: 'country', options: () => TRIAL_COUNTRIES },
  { dim: 'region', options: (s) => (s.country ? regionsOf(s.country) : []) },
  { dim: 'ageBand', options: () => AGE_BANDS },
  { dim: 'drivingStyle', options: () => DRIVING_STYLES },
  { dim: 'adasUsage', options: () => ADAS_USAGE },
];

export function EntitlementsScreen() {
  const all = useApi<TrialPage>('trials', { query: trialListQuery({ catalogId: 'CAT-00019', source: 'ALL', state: '', segment: {}, q: '', page: 1 }) });
  const active = all.data?.byState.ACTIVE;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-05 · ENTITLEMENT · D05-04 BILLING"
        title={E.title}
        lead={E.lead}
        message={{ tone: 'neutral', value: active == null ? '—' : active.toLocaleString('ko-KR'), text: E.key }}
        actions={<Link to="/biz/trials">{T.toAnalytics}</Link>}
      />
      <Tabs tabs={[{ key: 'trials', label: E.tabs.trials }, { key: 'grants', label: E.tabs.grants }]}>{(tab) => (tab === 'grants' ? <GrantsTable /> : <TrialVehicles />)}</Tabs>
    </div>
  );
}

function TrialVehicles() {
  const [source, setSource] = useState<TrialSource>('ALL');
  const [state, setState] = useState('');
  const [segment, setSegment] = useState<Partial<Record<SegmentDimension, string>>>({});
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const catalogId = 'CAT-00019';
  const query = trialListQuery({ catalogId, source, state, segment, q, page });
  const list = useApi<TrialPage>('trials', { query }, { placeholderData: (prev) => prev });
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
        <Segmented label={T.source} options={(['ALL', 'DEMO', 'SYNTHETIC'] as const).map((v) => ({ value: v, label: T.sources[v] }))} value={source} onChange={(v) => reset(() => setSource(v))} />
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
          const opts = options(segment);
          if (!opts.length) return null;
          return (
            <Select key={dim} label={T.dims[dim]} value={segment[dim] ?? ''} disabled={STATIC_MODE} onChange={(e) => reset(() => setSegment((s) => ({ ...s, [dim]: e.target.value || undefined, ...(dim === 'country' ? { region: undefined } : {}) })))}>
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
          <input className="ds-input ds-input--mono" value={q} disabled={STATIC_MODE} onChange={(e) => reset(() => setQ(e.target.value))} />
        </label>
      </Toolbar>
      {source !== 'DEMO' && <p className="ds-field__hint">{T.syntheticNote}</p>}
      {/* 과금 시스템이 실제로 연결되기 전에는 구매 결과가 실제 결제가 아니다(RD-UX-04) */}
      {billing !== 'none' && (
        <p className="ds-field__hint" data-connection-note="billing">
          <ConnectionBadge state={billing} system={CN.system.billing} /> {billing === 'mock' ? CN.hint.mock(CN.system.billing) : CN.hint.disconnected(CN.system.billing)}
        </p>
      )}
      <ErrorNote error={accept.error ?? decline.error ?? purchase.error} />
      <AsyncView state={asyncState(list, rows.length === 0)} empty={{ title: T.empty }} error={list.error} onRetry={() => list.refetch()}>
        <div style={{ opacity: list.isPlaceholderData ? 0.6 : 1 }}>
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
                    {r.source === 'DEMO' ? <Link to={`/fleet/vehicles/${encodeURIComponent(r.vin)}`}>{r.vin}</Link> : r.vin}
                    {r.source === 'SYNTHETIC' && <span className="ds-tag" style={{ marginLeft: 'var(--sp-1)' }}>{T.synthetic}</span>}
                  </span>
                ),
              },
              { key: 'st', header: C.state, cell: (r) => <TrialState state={r.state} /> },
              {
                key: 'act',
                header: '',
                cell: (r) => {
                  if (r.source !== 'DEMO') return null;
                  const dis = !perm.ok || busy || STATIC_MODE;
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
            <Button disabled={page * TRIAL_PAGE_SIZE >= data.total || STATIC_MODE} onClick={() => setPage((p) => p + 1)}>
              {T.next}
            </Button>
          </div>
        )}
      </AsyncView>
      <OfferPanel catalogId={catalogId} />
    </>
  );
}

function OfferPanel({ catalogId }: { catalogId: string }) {
  const vehicles = useApi<{ items: { vin: string; label: string }[] }>('vehicles');
  const perm = usePermission(['PRODUCT_AUTHOR', 'OPERATOR', 'SYSTEM']);
  const offer = useApiMutation<{ offered: GrantRow[]; skipped: { vin: string; reason: string }[] }>('offerTrials', ['trials', 'entitlements', 'trialAnalytics', 'events', 'audit']);
  const [vins, setVins] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const O = T.offer;
  if (STATIC_MODE) return null;
  return (
    <Panel title={O.title} eyebrow={catalogId} id="trial-offer">
      <p className="ds-field__hint">{O.lead}</p>
      <fieldset className="ds-choices" aria-label={O.vehicles}>
        <legend className="ds-field__label">
          {O.vehicles} ({vins.length})
        </legend>
        {(vehicles.data?.items ?? []).map((v) => (
          <label key={v.vin} title={v.label}>
            <input type="checkbox" checked={vins.includes(v.vin)} onChange={() => setVins((xs) => (xs.includes(v.vin) ? xs.filter((x) => x !== v.vin) : [...xs, v.vin]))} />
            {v.vin}
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

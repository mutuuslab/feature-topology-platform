// /products · /products/:id/:ver · /products/new — Feature Catalog 상품 (v2, D01-03)
// 상품 구성은 BOM 후보(확정 Baseline·범위 일치)에서 고르고, 저장 전에도 구성 검증 결과를 실시간으로 보여 준다.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LIFECYCLE, type Lifecycle } from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { call } from '../../api/client';
import { fieldErrors } from '../../api/field-errors';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { planning as W } from '../../copy/planning';
import { catalogExperience as Cx } from '../../copy/catalog-experience';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, LifecycleBadge, LifecycleStepper, PageHeader, Panel, VerdictBadge, Icon, whyDisabled } from '../../design';
import { ProductVersionActions } from '../features/VersionEdit';
import { scopeOf, usePermission } from '../shared';
import { CatalogApproval, CatalogAssembly, CatalogCard, CatalogIdentity } from './CatalogExperience';

const T = ko.product;

export interface Product {
  catalogId: string;
  version: string;
  name: string;
  description: string;
  country: string;
  vehicleModel: string;
  trim: string;
  tags: string[];
  saleType: string;
  type: string;
  baselineIds: string[];
  validFrom: string | null;
  validTo: string | null;
  ownerId: string;
  lifecycle: Lifecycle;
  featureCount?: number;
}
export interface Composition {
  result: 'PASS' | 'FAIL';
  issues: { code: string; severity: 'FAIL' | 'WARN'; message: string; refs: string[]; suggest?: string[] }[];
  features: { baselineId: string; featureId: string; version: string; name: string; lifecycle: Lifecycle }[];
}
interface Candidate {
  baselineId: string;
  featureId: string;
  version: string;
  name: string;
  lifecycle: Lifecycle;
  latest: boolean;
  requires: string[];
}

export function ProductList() {
  const nav = useNavigate();
  const q = useApi<{ items: Product[] }>('listProducts');
  const all = q.data?.items ?? [];
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [sale, setSale] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [view, setView] = useState<'browse' | 'table'>('browse');
  const needle = search.trim().toLocaleLowerCase();
  const rows = all.filter((p) => (!country || p.country === country) && (!sale || p.saleType === sale) && (!lifecycle || p.lifecycle === lifecycle) && (!needle || `${p.catalogId} ${p.name} ${p.ownerId} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(needle)));
  const perm = usePermission(['PRODUCT_AUTHOR']);
  const C = T.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-03 · FEATURE CATALOG"
        title={T.title}
        lead={T.lead}
        message={{ tone: 'neutral', value: q.data ? rows.length : '—', text: T.key.count(rows.filter((r) => r.lifecycle === 'RELEASED').length) }}
        actions={
          <Button variant="primary" icon="layers" disabled={!perm.ok} title={perm.hint} onClick={() => nav('/products/new')}>
            {T.create}
          </Button>
        }
      />
      <p className="catalog-intro">{Cx.definition} {Cx.boundary}</p>
      <div className="catalog-filter" role="group" aria-label={Cx.filters}>
        <label>{Cx.search}<input className="ds-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label>{Cx.country}<select className="ds-input" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">{Cx.all}</option>{[...new Set(all.map((p) => p.country))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>{Cx.sale}<select className="ds-input" value={sale} onChange={(e) => setSale(e.target.value)}><option value="">{Cx.all}</option>{[...new Set(all.map((p) => p.saleType))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>{Cx.lifecycle}<select className="ds-input" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)}><option value="">{Cx.all}</option>{[...new Set(all.map((p) => p.lifecycle))].map((value) => <option key={value} value={value}>{W.product.lifecycle[value] ?? value}</option>)}</select></label>
      </div>
      <div className="catalog-viewbar"><span>{Cx.count(rows.length, all.length)}</span><div role="group" aria-label={Cx.view}>{(['browse', 'table'] as const).map((value) => <button type="button" key={value} className="ds-btn" aria-pressed={view === value} onClick={() => setView(value)}>{value === 'browse' ? Cx.browse : Cx.table}</button>)}</div></div>
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
        {view === 'browse' ? <div className="catalog-gallery">{rows.map((p) => <CatalogCard key={`${p.catalogId}@${p.version}`} product={p} />)}</div> :
        <DataTable
          caption={T.title}
          rows={rows}
          rowKey={(r) => `${r.catalogId}@${r.version}`}
          onOpen={(r) => nav(`/products/${r.catalogId}/${r.version}`)}
          initialSort={{ key: 'id', dir: 'asc' }}
          columns={[
            { key: 'id', header: C.id, cell: (r) => <IdChip id={r.catalogId} version={r.version} to={`/products/${r.catalogId}/${r.version}`} />, sort: (r) => r.catalogId },
            { key: 'name', header: C.name, cell: (r) => r.name, sort: (r) => r.name },
            { key: 'scope', header: C.scope, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{scopeOf(r)}</span> },
            { key: 'sale', header: C.sale, cell: (r) => <span className="ds-tag">{r.saleType}</span>, sort: (r) => r.saleType },
            { key: 'type', header: C.type, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.type}</span> },
            { key: 'lc', header: C.lifecycle, cell: (r) => <LifecycleBadge value={r.lifecycle} />, sort: (r) => LIFECYCLE.indexOf(r.lifecycle) },
            { key: 'n', header: C.features, cell: (r) => <span className="ds-mono">{r.featureCount ?? Cx.unknown}</span>, align: 'right', sort: (r) => r.featureCount ?? -1 },
            { key: 'valid', header: C.validity, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}><span className="ds-date">{r.validFrom ?? '—'}</span> ~ <span className="ds-date">{r.validTo ?? '—'}</span></span> },
          ]}
        />}
      </AsyncView>
    </div>
  );
}

/** 구성 검증 결과 — onAdd를 주면 빠진 REQUIRES 대상 Baseline을 바로 더하는 버튼(P1-10). 규칙 코드는 글자로 보이지 않는다(data-code) */
export function CompositionView({ c, onAdd, picked = [] }: { c: Composition; onAdd?: (baselineId: string) => void; picked?: string[] }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <VerdictBadge value={c.result} />
        <span className="ds-field__hint">{c.features.length} Feature</span>
      </div>
      {c.issues.length > 0 && (
        <ul className="ds-check">
          {c.issues.map((i, n) => (
            <li key={n} data-state={i.severity === 'FAIL' ? 'FAIL' : 'INFO'} data-code={i.code}>
              <Icon name="alert" size={16} />
              <span>
                {i.message}
                {onAdd && !!i.suggest?.length && (
                  <span className="ds-check__detail" style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    {i.suggest.filter((id) => !picked.includes(id)).map((id) => (
                      <Button key={id} onClick={() => onAdd(id)}>
                        {W.product.add(id)}
                      </Button>
                    ))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <DataTable
        caption={T.composition}
        rows={c.features}
        rowKey={(f) => f.baselineId}
        columns={[
          { key: 'bl', header: 'Baseline', cell: (f) => <span className="ds-mono">{f.baselineId}</span> },
          { key: 'f', header: 'Feature', cell: (f) => <IdChip id={f.featureId} version={f.version} to={`/features/${f.featureId}/${f.version}`} copy={false} /> },
          { key: 'n', header: ko.registry.col.name, cell: (f) => f.name },
          { key: 'lc', header: 'Lifecycle', cell: (f) => <LifecycleBadge value={f.lifecycle} /> },
        ]}
      />
    </div>
  );
}

export interface CompositionBody {
  country: string;
  vehicleModel: string;
  trim: string;
  type: string;
  baselineIds: string[];
  validFrom: string | null;
  validTo: string | null;
}

/** 저장하지 않고 구성 검증 — 본문이 바뀔 때마다(늦게 온 이전 응답은 버린다). 고른 Baseline이 없거나 권한이 없으면 묻지 않는다 */
export function useLiveComposition(body: CompositionBody | null, role: string, enabled: boolean) {
  const [comp, setComp] = useState<Composition | null>(null);
  const [pending, setPending] = useState(false);
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body || !body.baselineIds.length || !enabled) {
      setComp(null);
      setPending(false);
      return;
    }
    let live = true;
    const ctl = new AbortController();
    setPending(true);
    call<Composition>('validateComposition', { body, role, signal: ctl.signal }).then(
      (c) => live && (setComp(c), setPending(false)),
      () => live && setPending(false),
    );
    return () => ((live = false), ctl.abort());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, role]);
  return { comp, pending };
}

/** BOM 후보 표 — 같은 범위의 확정 Baseline에서 고른다(쉼표 글자 입력 대신, P1-10) */
export function BaselinePicker({ scope, picked, onToggle }: { scope: { country: string; vehicleModel: string; trim: string }; picked: string[]; onToggle: (id: string) => void }) {
  const cands = useApi<{ items: Candidate[] }>('productCandidates', { query: scope });
  const rows = cands.data?.items ?? [];
  return (
    <AsyncView state={asyncState(cands, rows.length === 0)} error={cands.error}>
      <DataTable
        caption={T.candidates}
        rows={rows}
        rowKey={(r) => r.baselineId}
        onOpen={(r) => onToggle(r.baselineId)}
        maxHeight="420px"
        columns={[
          { key: 'pick', header: '', srHeader: ko.action.select, width: '36px', cell: (r) => <input type="checkbox" aria-label={r.baselineId} checked={picked.includes(r.baselineId)} onChange={() => onToggle(r.baselineId)} onClick={(e) => e.stopPropagation()} /> },
          { key: 'bl', header: 'Baseline', cell: (r) => <span className="ds-mono">{r.baselineId}</span> },
          { key: 'f', header: 'Feature', cell: (r) => <IdChip id={r.featureId} version={r.version} copy={false} /> },
          { key: 'n', header: ko.registry.col.name, cell: (r) => r.name },
          { key: 'lc', header: 'Lifecycle', cell: (r) => <LifecycleBadge value={r.lifecycle} /> },
          { key: 'req', header: 'REQUIRES', cell: (r) => (r.requires.length ? <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{T.requires(r.requires.join(', '))}</span> : '') },
        ]}
      />
    </AsyncView>
  );
}

export interface ProductMeta {
  createdBy: string | null;
  configApprovedBy: string | null;
  releaseApprovedBy: string | null;
}

/** 직무 분리 미리 보기(P1-2) — 서버가 403으로 거절하기 전에 같은 사람이면 버튼을 막고 이유를 말한다 */
export function productSodReason(approval: string | null | undefined, meta: ProductMeta | undefined, me: string): string | undefined {
  if (!approval || !meta) return undefined;
  if (meta.createdBy === me) return W.product.sodCreator;
  if (approval === 'RELEASE' && meta.configApprovedBy === me) return W.product.sodRelease;
  return undefined;
}

export function ProductDetail() {
  const { id = '', ver = '' } = useParams();
  const q = useApi<{ product: Product; meta?: ProductMeta; composition: Composition; eligibility: { eligible: boolean; reasons: string[] }; transitions: { to: Lifecycle; ko: string; approval: string | null; blockers: string[] }[]; versions: { version: string; lifecycle: Lifecycle }[] }>('productDetail', { params: { id, ver } });
  const [to, setTo] = useState<Lifecycle | null>(null);
  const perm = usePermission(['PRODUCT_APPROVER']);
  const me = actorFor(perm.role, ['PRODUCT_APPROVER']).id;
  const d = q.data;
  const p = d?.product;
  return (
    <div className="ds-screen">
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        {d && p && (
          <>
            <PageHeader
              title={p.name}
              message={
                d.eligibility.eligible
                  ? { tone: 'ok', status: { label: p.lifecycle }, text: T.key.eligible }
                  : { tone: 'warn', status: { label: p.lifecycle }, text: T.key.notEligible(d.eligibility.reasons.length, d.eligibility.reasons[0] ?? '') }
              }
              meta={
                <>
                  <IdChip id={p.catalogId} version={p.version} />
                  <span className="ds-tag">{scopeOf(p)}</span>
                  <span className="ds-tag">{p.saleType}</span>
                  <span className="ds-tag ds-mono">{p.type}</span>
                  <span className="ds-tag">{p.ownerId}</span>
                </>
              }
              lead={p.description}
              actions={
                <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <ProductVersionActions key={`${p.catalogId}@${p.version}`} p={p} latest={d.versions[d.versions.length - 1]?.version === p.version} />
                  {/* 고객 출시된 상품 — 체험 제안으로 이어진다(P1-3) */}
                  {p.lifecycle === 'RELEASED' && <Link to={`/entitlements?catalog=${encodeURIComponent(p.catalogId)}#trial-offer`}>{W.product.toTrials}</Link>}
                </div>
              }
            />
            <CatalogIdentity product={p} composition={d.composition} />
            <CatalogAssembly key={`${p.catalogId}@${p.version}`} product={p} composition={d.composition} />
            <CatalogApproval product={p} meta={d.meta} transitions={d.transitions} eligibility={d.eligibility} />
            <Panel id="plc">
              {/* 상품의 APPROVED는 '구성 승인', RELEASED는 '고객 출시' — Feature의 '정의 승인'과 낱말을 나눈다(P1-10) */}
              <LifecycleStepper current={p.lifecycle} labels={W.product.lifecycle} transitions={d.transitions.map((t) => ({ to: t.to, blockers: t.blockers.map((m) => ({ message: m })) }))} />
              <div className="catalog-lifecycle-actions">
                {d.transitions.map((t) => {
                  const sod = perm.ok ? productSodReason(t.approval, d.meta, me) : undefined;
                  return (
                    <Button key={t.to} variant="primary" disabled={!!sod} reason={sod} onClick={() => setTo(t.to)}>
                      {t.ko} → {t.to}
                    </Button>
                  );
                })}
              </div>
            </Panel>
            <div className="ds-split">
              <Panel title={T.composition} id="comp">
                <CompositionView c={d.composition} />
              </Panel>
              <Panel title={T.eligibility} id="elig">
                <div className="catalog-eligibility">
                <KeyValue
                  rows={[
                    { k: T.col.validity, v: <span className="ds-mono"><span className="ds-date">{p.validFrom ?? '—'}</span> ~ <span className="ds-date">{p.validTo ?? '—'}</span></span> },
                  ]}
                />
                </div>
                {d.eligibility.reasons.length > 0 && <ErrorNote error={{ message: T.notEligible, details: { blockers: d.eligibility.reasons } }} />}
              </Panel>
            </div>
            <ProductTransition p={p} to={to} onClose={() => setTo(null)} transitions={d.transitions} meta={d.meta} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function ProductTransition({ p, to, onClose, transitions, meta }: { p: Product; to: Lifecycle | null; onClose: () => void; transitions: { to: Lifecycle; ko: string; approval?: string | null; blockers: string[] }[]; meta?: ProductMeta }) {
  const perm = usePermission(['PRODUCT_APPROVER']);
  const me = actorFor(perm.role, ['PRODUCT_APPROVER']).id;
  const m = useApiMutation('productTransition', ['productDetail', 'listProducts', 'audit']);
  const [reason, setReason] = useState('');
  const t = transitions.find((x) => x.to === to);
  const sod = t && perm.ok ? productSodReason(t.approval, meta, me) : undefined;
  return (
    <Drawer open={!!to} title={t ? `${t.ko} → ${t.to}` : ''} onClose={onClose}>
      {t && (
        <form
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ params: { id: p.catalogId, ver: p.version }, body: { to, reason } }, { onSuccess: () => (setReason(''), onClose()) });
          }}
        >
          {t.blockers.length > 0 && <ErrorNote error={{ message: ko.stepper.blocked, details: { blockers: t.blockers } }} />}
          <Field label={ko.page.reason}>
            <textarea className="ds-input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" variant="primary" disabled={!perm.ok || t.blockers.length > 0 || !!sod || m.isPending} reason={sod} title={perm.hint}>
            {ko.page.submit}
          </Button>
          {perm.hint && <span className="ds-field__hint">{perm.hint}</span>}
        </form>
      )}
    </Drawer>
  );
}

/** 새 상품 구성 — 범위 선택 → BOM 후보 선택 → 실시간 구성 검증 → 등록 */
export function ProductCompose() {
  const nav = useNavigate();
  const perm = usePermission(['PRODUCT_AUTHOR']);
  const [scope, setScope] = useState({ country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' });
  const [form, setForm] = useState({ name: '', description: '', saleType: '체험', type: 'PACKAGE', validFrom: '', validTo: '', ownerId: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmFail, setConfirmFail] = useState(false);
  const create = useApiMutation<{ product: Product }>('createProduct', ['listProducts']);
  // 서버 입력 검사 오류는 해당 칸 옆에(RD-UX-01)
  const fe = fieldErrors(create.error);

  const body = useMemo(
    () => ({ ...scope, type: form.type, baselineIds: picked, validFrom: form.validFrom || null, validTo: form.validTo || null }),
    [scope, form.type, form.validFrom, form.validTo, picked],
  );
  // 저장하지 않고 구성 검증 — 선택이 바뀔 때마다
  const { comp, pending } = useLiveComposition(body, perm.role, perm.ok);
  // 등록은 구성 검증 PASS일 때만 — FAIL이면 경고를 읽고 'FAIL인 채로 초안 등록'을 확인해야 한다(P1-10)
  const passed = comp?.result === 'PASS';
  const why = whyDisabled([!perm.ok, perm.hint], [!picked.length, ko.why.baselines], [pending || (!comp && picked.length > 0), W.product.checking], [!passed && !confirmFail, W.product.failWhy]);

  const toggle = (id: string) => (setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])), setConfirmFail(false));
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-03 · COMPOSE" title={T.create} message={{ tone: 'neutral', text: perm.ok ? T.key.can : T.key.cannot }} />
      <div className="ds-split">
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Panel title={ko.registry.col.scope} id="scope">
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {(['country', 'vehicleModel', 'trim'] as const).map((k) => (
                <Field key={k} label={ko.detail.attrs[k]} error={fe[k]}>
                  <input className="ds-input" value={scope[k]} onChange={(e) => (setScope({ ...scope, [k]: e.target.value }), setPicked([]))} />
                </Field>
              ))}
            </div>
          </Panel>
          <Panel title={T.candidates} id="cands">
            <BaselinePicker scope={scope} picked={picked} onToggle={toggle} />
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-4)', position: 'sticky', top: 0 }}>
          <Panel title={T.composition} id="live-comp">
            {comp ? <CompositionView c={comp} picked={picked} onAdd={toggle} /> : <p className="ds-field__hint">{perm.hint ?? T.candidates}</p>}
          </Panel>
          <Panel title={T.create} id="form">
            <form
              style={{ display: 'grid', gap: 'var(--sp-3)' }}
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(
                  { body: { ...scope, ...form, baselineIds: picked, tags: [], validFrom: form.validFrom || null, validTo: form.validTo || null } },
                  { onSuccess: (r) => nav(`/products/${r.product.catalogId}/${r.product.version}`) },
                );
              }}
            >
              <Field label={T.col.name} error={fe.name}>
                <input className="ds-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={ko.detail.attrs.description} error={fe.description}>
                <textarea className="ds-input" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <Field label={T.col.sale}>
                  <select className="ds-select" value={form.saleType} onChange={(e) => setForm({ ...form, saleType: e.target.value })}>
                    {['구독', '구매', '체험'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label={T.col.type}>
                  <select className="ds-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {['PACKAGE', 'SINGLE'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <Field label="From" error={fe.validFrom}>
                  <input className="ds-input ds-input--mono" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
                </Field>
                <Field label="To" error={fe.validTo}>
                  <input className="ds-input ds-input--mono" type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
                </Field>
              </div>
              <Field label={ko.registry.col.owner} error={fe.ownerId}>
                <input className="ds-input" required value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} />
              </Field>
              {comp && !passed && (
                <label className="ds-choices ds-callout" data-tone="warn" data-testid="compose-fail-confirm">
                  <input type="checkbox" checked={confirmFail} onChange={(e) => setConfirmFail(e.target.checked)} />
                  {W.product.failConfirm}
                </label>
              )}
              <ErrorNote error={create.error} />
              <Button type="submit" variant="primary" disabled={!!why || create.isPending} reason={why} title={perm.hint}>
                {T.create}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

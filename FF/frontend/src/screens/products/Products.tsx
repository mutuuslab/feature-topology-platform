// /products · /products/:id/:ver · /products/new — Feature Catalog 상품 (v2, D01-03)
// 상품 구성은 BOM 후보(확정 Baseline·범위 일치)에서 고르고, 저장 전에도 구성 검증 결과를 실시간으로 보여 준다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LIFECYCLE, type Lifecycle } from '@ff/contracts';
import { call } from '../../api/client';
import { fieldErrors } from '../../api/field-errors';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, IdChip, KeyValue, LifecycleBadge, LifecycleStepper, PageHeader, Panel, VerdictBadge, Icon } from '../../design';
import { ProductVersionActions } from '../features/VersionEdit';
import { scopeOf, usePermission } from '../shared';

const T = ko.product;

interface Product {
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
interface Composition {
  result: 'PASS' | 'FAIL';
  issues: { code: string; severity: 'FAIL' | 'WARN'; message: string; refs: string[] }[];
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
  const rows = q.data?.items ?? [];
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
      <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
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
            { key: 'n', header: C.features, cell: (r) => <span className="ds-mono">{r.baselineIds.length}</span>, align: 'right', sort: (r) => r.baselineIds.length },
            { key: 'valid', header: C.validity, cell: (r) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}><span className="ds-date">{r.validFrom ?? '—'}</span> ~ <span className="ds-date">{r.validTo ?? '—'}</span></span> },
          ]}
        />
      </AsyncView>
    </div>
  );
}

export function CompositionView({ c }: { c: Composition }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <VerdictBadge value={c.result} />
        <span className="ds-field__hint">{c.features.length} Feature</span>
      </div>
      {c.issues.length > 0 && (
        <ul className="ds-check">
          {c.issues.map((i, n) => (
            <li key={n} data-state={i.severity === 'FAIL' ? 'FAIL' : 'INFO'}>
              <Icon name="alert" size={16} />
              <span>
                {i.message}
                <span className="ds-check__detail ds-mono">{i.code}</span>
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

export function ProductDetail() {
  const { id = '', ver = '' } = useParams();
  const q = useApi<{ product: Product; composition: Composition; eligibility: { eligible: boolean; reasons: string[] }; transitions: { to: Lifecycle; ko: string; approval: string | null; blockers: string[] }[]; versions: { version: string; lifecycle: Lifecycle }[] }>('productDetail', { params: { id, ver } });
  const [to, setTo] = useState<Lifecycle | null>(null);
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
              actions={<ProductVersionActions key={`${p.catalogId}@${p.version}`} p={p} latest={d.versions[d.versions.length - 1]?.version === p.version} />}
            />
            <Panel id="plc">
              <LifecycleStepper current={p.lifecycle} transitions={d.transitions.map((t) => ({ to: t.to, blockers: t.blockers.map((m) => ({ message: m })) }))} />
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
                {d.transitions.map((t) => (
                  <Button key={t.to} variant="primary" onClick={() => setTo(t.to)}>
                    {t.ko} → {t.to}
                  </Button>
                ))}
              </div>
            </Panel>
            <div className="ds-split">
              <Panel title={T.composition} id="comp">
                <CompositionView c={d.composition} />
              </Panel>
              <Panel title={T.eligibility} id="elig">
                <KeyValue
                  rows={[
                    { k: T.col.validity, v: <span className="ds-mono"><span className="ds-date">{p.validFrom ?? '—'}</span> ~ <span className="ds-date">{p.validTo ?? '—'}</span></span> },
                  ]}
                />
                {d.eligibility.reasons.length > 0 && <ErrorNote error={{ message: T.notEligible, details: { blockers: d.eligibility.reasons } }} />}
              </Panel>
            </div>
            <ProductTransition p={p} to={to} onClose={() => setTo(null)} transitions={d.transitions} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

function ProductTransition({ p, to, onClose, transitions }: { p: Product; to: Lifecycle | null; onClose: () => void; transitions: { to: Lifecycle; ko: string; blockers: string[] }[] }) {
  const perm = usePermission(['PRODUCT_APPROVER']);
  const m = useApiMutation('productTransition', ['productDetail', 'listProducts', 'audit']);
  const [reason, setReason] = useState('');
  const t = transitions.find((x) => x.to === to);
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
          <Button type="submit" variant="primary" disabled={!perm.ok || t.blockers.length > 0 || m.isPending} title={perm.hint}>
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
  const cands = useApi<{ items: Candidate[] }>('productCandidates', { query: scope });
  const [comp, setComp] = useState<Composition | null>(null);
  const create = useApiMutation<{ product: Product }>('createProduct', ['listProducts']);
  // 서버 입력 검사 오류는 해당 칸 옆에(RD-UX-01)
  const fe = fieldErrors(create.error);

  const body = useMemo(
    () => ({ ...scope, type: form.type, baselineIds: picked, validFrom: form.validFrom || null, validTo: form.validTo || null }),
    [scope, form.type, form.validFrom, form.validTo, picked],
  );
  // 저장하지 않고 구성 검증 — 선택이 바뀔 때마다
  useEffect(() => {
    if (!picked.length || !perm.ok) return setComp(null);
    const ctl = new AbortController();
    call<Composition>('validateComposition', { body, role: perm.role, signal: ctl.signal }).then(setComp, () => undefined);
    return () => ctl.abort();
  }, [body, picked.length, perm.ok, perm.role]);

  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const rows = cands.data?.items ?? [];
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
            <AsyncView state={asyncState(cands, rows.length === 0)} error={cands.error}>
              <DataTable
                caption={T.candidates}
                rows={rows}
                rowKey={(r) => r.baselineId}
                onOpen={(r) => toggle(r.baselineId)}
                maxHeight="420px"
                columns={[
                  { key: 'pick', header: '', srHeader: ko.action.select, width: '36px', cell: (r) => <input type="checkbox" aria-label={r.baselineId} checked={picked.includes(r.baselineId)} onChange={() => toggle(r.baselineId)} onClick={(e) => e.stopPropagation()} /> },
                  { key: 'bl', header: 'Baseline', cell: (r) => <span className="ds-mono">{r.baselineId}</span> },
                  { key: 'f', header: 'Feature', cell: (r) => <IdChip id={r.featureId} version={r.version} copy={false} /> },
                  { key: 'n', header: ko.registry.col.name, cell: (r) => r.name },
                  { key: 'lc', header: 'Lifecycle', cell: (r) => <LifecycleBadge value={r.lifecycle} /> },
                  { key: 'req', header: 'REQUIRES', cell: (r) => (r.requires.length ? <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{T.requires(r.requires.join(', '))}</span> : '') },
                ]}
              />
            </AsyncView>
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-4)', position: 'sticky', top: 0 }}>
          <Panel title={T.composition} id="live-comp">
            {comp ? <CompositionView c={comp} /> : <p className="ds-field__hint">{perm.hint ?? T.candidates}</p>}
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
              <ErrorNote error={create.error} />
              <Button type="submit" variant="primary" disabled={!perm.ok || !picked.length || create.isPending} title={perm.hint}>
                {T.create}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

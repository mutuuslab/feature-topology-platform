// /policies/global-scope — 브랜드·권역별 정책(B7 (b), FR-GLB-001-001~004)과 적용 지역 코드 대응 표(FR-CRC-001-002).
// 브랜드(현대·기아·제네시스)로 정책을 보고, 지역 코드·법규 조건으로 좁히고, 정책 하나의 조건을 등록·수정한다(수정은 Feature Owner·시스템 관리자만 — 서버가 403).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND_LABEL, BRANDS, type Brand, type PolicyGlobalScope } from '../../../../contracts/src/schemas/global-scope';
import { GLOBAL_SCOPE_AUTHOR_ROLES } from '../../../../contracts/src/rules/global-scope';
import { REGION_CODE_TABLE, regionCodeLabel, type RegionCodeRow } from '../../../../contracts/src/rules/region-code';
import { actorFor } from '../../api/actor';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { brandCopy as B, regionCopy as R } from '../../copy/taxonomy-levels';
import { AsyncView, Button, DataTable, ErrorNote, Field, IdChip, PageHeader, Panel, Segmented, Select, Tabs } from '../../design';
import { useAppShell } from '../../store';
import { usePermission } from '../shared';

type ScopeView = PolicyGlobalScope & { policy: { flagKey: string; status: string; featureVersion: string } | null; feature: { name: string; ownerId: string; country: string } | null };
interface BrandsView {
  items: { brand: Brand; label: string; policies: number }[];
}
interface SearchView {
  total: number;
  items: ScopeView[];
}
interface RegionView {
  items: (RegionCodeRow & { features: number; rules: string[]; policies: number })[];
}
const INVALIDATE = ['brands', 'brandPolicies', 'globalScopes', 'policyGlobalScope', 'regionCodes', 'audit', 'events'];

export default function GlobalScopeScreen() {
  const brands = useApi<BrandsView>('brands');
  const total = useApi<SearchView>('globalScopes');
  return (
    <div className="ds-screen">
      <PageHeader codes="D01-01 · BRAND · REGION" title={B.title} lead={B.lead} message={{ tone: 'neutral', text: total.data ? B.key(total.data.total) : '—' }} meta={<Link to="/policies">{B.back}</Link>} />
      <AsyncView state={asyncState(brands)} error={brands.error} onRetry={() => brands.refetch()}>
        {brands.data && (
          <Tabs
            tabs={[
              { key: 'brands', label: B.title, count: total.data?.total },
              { key: 'codes', label: R.title, count: REGION_CODE_TABLE.length },
              ...(STATIC_MODE ? [] : [{ key: 'edit', label: B.form.title }]),
            ]}
          >
            {(tab) => (tab === 'codes' ? <RegionCodesPanel /> : tab === 'edit' ? <ScopeForm /> : <BrandPanel brands={brands.data!} />)}
          </Tabs>
        )}
      </AsyncView>
    </div>
  );
}

/** 브랜드별 정책(FR-GLB-001-003) + 지역 코드로 좁히기(FR-GLB-001-001) */
function BrandPanel({ brands }: { brands: BrandsView }) {
  const [brand, setBrand] = useState<Brand>('HYUNDAI');
  const [code, setCode] = useState('');
  const byBrand = useApi<{ items: ScopeView[] }>('brandPolicies', { params: { brand } }, { placeholderData: (p) => p });
  const rows = (byBrand.data?.items ?? []).filter((s) => !code || s.regionCodes.includes(code));
  return (
    <Panel id="brand-policies">
      <Segmented<Brand> label={B.brand} value={brand} onChange={setBrand} options={BRANDS.map((b) => ({ value: b, label: BRAND_LABEL[b], count: brands.items.find((x) => x.brand === b)?.policies }))} />
      <div className="ds-toolbar">
        <Select label={B.regionCode} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">{B.all}</option>
          {REGION_CODE_TABLE.map((r) => (
            <option key={r.code} value={r.code}>{regionCodeLabel(r.code)}</option>
          ))}
        </Select>
      </div>
      <AsyncView state={asyncState(byBrand)} error={byBrand.error} onRetry={() => byBrand.refetch()}>
        {code && !rows.length ? <p className="ds-field__hint" role="status">{B.emptyFilter}</p> : <ScopeTable rows={rows} caption={`${B.brand} ${BRAND_LABEL[brand]}`} />}
      </AsyncView>
    </Panel>
  );
}

function ScopeTable({ rows, caption }: { rows: ScopeView[]; caption: string }) {
  const C = B.col;
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(r) => r.policyId}
      maxHeight="60vh"
      columns={[
        { key: 'p', header: C.policy, cell: (r) => <span className="ds-mono">{r.policyId}</span>, sort: (r) => r.policyId },
        { key: 'k', header: C.flag, cell: (r) => <span className="ds-mono">{r.policy?.flagKey ?? '—'}</span> },
        { key: 'f', header: C.feature, cell: (r) => <IdChip id={r.featureId} version={r.policy?.featureVersion} to={r.policy ? `/features/${r.featureId}/${r.policy.featureVersion}?tab=taxonomy` : undefined} copy={false} /> },
        { key: 'b', header: C.brands, cell: (r) => <span className="ds-chips">{r.brands.map((b) => <span key={b} className="ds-tag">{BRAND_LABEL[b]}</span>)}</span> },
        { key: 'c', header: C.codes, cell: (r) => (r.regionCodes.length ? r.regionCodes.map(regionCodeLabel).join(', ') : '—') },
        { key: 'r', header: C.rules, cell: (r) => (r.complianceRuleIds.length ? <span className="ds-mono">{r.complianceRuleIds.join(', ')}</span> : '—') },
        { key: 'v', header: C.rev, cell: (r) => <span className="ds-mono">{r.revision}</span>, align: 'right' },
      ]}
    />
  );
}

/** 적용 지역 코드 ↔ 시장·국가(FR-CRC-001-002) */
function RegionCodesPanel() {
  const q = useApi<RegionView>('regionCodes');
  const C = R.col;
  return (
    <Panel id="region-codes">
      <p className="ds-field__hint">{R.lead}</p>
      <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
        <DataTable
          caption={R.title}
          rows={q.data?.items ?? []}
          rowKey={(r) => r.code}
          columns={[
            { key: 'c', header: C.code, cell: (r) => <b className="ds-mono">{r.code}</b> },
            { key: 'n', header: C.name, cell: (r) => r.nameKo },
            { key: 'm', header: C.market, cell: (r) => <span className="ds-mono">{r.market}</span> },
            { key: 'k', header: C.countries, cell: (r) => (r.countries.length ? <span className="ds-mono">{r.countries.join(', ')}</span> : <span className="ds-field__hint">{R.general}</span>) },
            { key: 'f', header: C.features, cell: (r) => <span className="ds-mono">{r.features}</span>, align: 'right' },
            { key: 'r', header: C.rules, cell: (r) => (r.rules.length ? <span className="ds-mono">{r.rules.join(', ')}</span> : '—') },
            { key: 'p', header: C.policies, cell: (r) => <span className="ds-mono">{r.policies}</span>, align: 'right' },
          ]}
        />
      </AsyncView>
    </Panel>
  );
}

/** 등록·수정(FR-GLB-001-002·004) — 수정은 Feature Owner만 버튼이 열린다(시스템 관리자는 서버가 함께 허용) */
function ScopeForm() {
  const { role } = useAppShell();
  const perm = usePermission(GLOBAL_SCOPE_AUTHOR_ROLES);
  const [policyId, setPolicyId] = useState('');
  const [loaded, setLoaded] = useState('');
  const cur = useApi<{ policyId: string; ownerId: string | null; scope: ScopeView | null }>('policyGlobalScope', { params: { id: loaded } }, { enabled: !!loaded });
  const [brands, setBrands] = useState<Brand[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [rules, setRules] = useState('');
  const [reason, setReason] = useState('');
  const [seen, setSeen] = useState<unknown>(null);
  if (cur.data && cur.data !== seen) {
    setSeen(cur.data);
    setBrands(cur.data.scope?.brands ?? []);
    setCodes(cur.data.scope?.regionCodes ?? []);
    setRules(cur.data.scope?.complianceRuleIds.join(', ') ?? '');
  }
  const exists = !!cur.data?.scope;
  const create = useApiMutation<ScopeView>('createPolicyGlobalScope', INVALIDATE);
  const update = useApiMutation<ScopeView>('updatePolicyGlobalScope', INVALIDATE);
  const m = exists ? update : create;
  const owner = cur.data?.ownerId ?? '';
  const isOwner = !!owner && actorFor(role).id === owner;
  const toggle = <T extends string>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const F = B.form;
  const body = { brands, regionCodes: codes, complianceRuleIds: rules.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean), reason: reason.trim() };
  return (
    <Panel title={F.title} id="global-scope-form">
      <div className="ds-toolbar">
        <Field label={F.policy}>
          <input className="ds-input ds-input--mono" name="policyId" value={policyId} onChange={(e) => setPolicyId(e.target.value.trim().toUpperCase())} />
        </Field>
        <Button disabled={!/^POL-\d{5}$/.test(policyId)} onClick={() => setLoaded(policyId)}>
          {F.load}
        </Button>
      </div>
      <ErrorNote error={cur.error} />
      {cur.data && (
        <>
          <p className="ds-field__hint">{exists && !isOwner ? F.ownerOnly(owner) : F.owner(owner || '—')}</p>
          <fieldset className="ds-toolbar" aria-label={F.brands}>
            {BRANDS.map((b) => (
              <label key={b} className="ds-check">
                <input type="checkbox" checked={brands.includes(b)} onChange={() => setBrands((x) => toggle(x, b))} />
                {BRAND_LABEL[b]}
              </label>
            ))}
          </fieldset>
          <fieldset className="ds-toolbar" aria-label={F.codes}>
            {REGION_CODE_TABLE.map((r) => (
              <label key={r.code} className="ds-check">
                <input type="checkbox" checked={codes.includes(r.code)} onChange={() => setCodes((x) => toggle(x, r.code))} />
                {regionCodeLabel(r.code)}
              </label>
            ))}
          </fieldset>
          <div className="ds-toolbar">
            <Field label={F.rules}>
              <input className="ds-input ds-input--mono" name="rules" value={rules} onChange={(e) => setRules(e.target.value)} />
            </Field>
            <Field label={F.reason}>
              <input className="ds-input" name="scopeReason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <ErrorNote error={m.error} />
          {create.data && <p className="ds-ok" role="status">{F.created(create.data.policyId)}</p>}
          {update.data && <p className="ds-ok" role="status">{F.updated(update.data.policyId, update.data.revision)}</p>}
          <Button
            variant="primary"
            disabled={!brands.length || reason.trim().length < 2 || m.isPending || (exists ? !isOwner : !perm.ok)}
            title={exists && !isOwner ? F.ownerOnly(owner) : perm.hint}
            onClick={() => m.mutate({ params: { id: loaded }, body })}
          >
            {exists ? F.update : F.create}
          </Button>
        </>
      )}
    </Panel>
  );
}

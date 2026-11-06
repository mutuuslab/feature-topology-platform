// 새 Version·초안 수정 (P11) — Feature(D01-01)·상품(D01-03)·정책(D01-06). 불변 규칙(출시 뒤 수정 409 → 새 Version)은 서버가 다시 검사한다.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { Button, Drawer, ErrorNote, Field, Select, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import type { RefWarning } from '../refdb/common';
import { BaselinePicker, CompositionView, useLiveComposition } from '../products/Products';
import { planning as W } from '../../copy/planning';
import { ImplLinksEditor, implBody, implComplete, implRowsOf, missingImplText, type ImplRow } from './ImplLinks';

const E = ko.p11.edit;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const BUMPS = ['minor', 'patch', 'major'] as const;

function TextField({ label, value, onChange, mono, area }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; area?: boolean }) {
  return (
    <Field label={label}>
      {area ? (
        <textarea className="ds-input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={`ds-input${mono ? ' ds-input--mono' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function NewVersionForm({ base, onSubmit, pending, error, children, blocked }: { base: string; onSubmit: (bump: string, reason: string) => void; pending: boolean; error: any; children?: ReactNode; blocked?: ReactNode }) {
  const [bump, setBump] = useState<string>('minor');
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p className="ds-field__hint">{E.newVersionLead}</p>
      <div className="ds-split">
        <TextField label={E.base} value={base} onChange={() => undefined} mono />
        <Select label={E.bump} value={bump} onChange={(e) => setBump(e.target.value)}>
          {BUMPS.map((b) => (
            <option key={b} value={b}>{E.bumps[b]}</option>
          ))}
        </Select>
      </div>
      <TextField label={E.reason} value={reason} onChange={setReason} area />
      {children}
      <ErrorNote error={error} />
      <Button variant="primary" disabled={reason.trim().length < 2 || pending || !!blocked} reason={whyDisabled([reason.trim().length < 2, ko.why.reason], [!!blocked, blocked])} onClick={() => onSubmit(bump, reason.trim())}>
        {E.create}
      </Button>
    </div>
  );
}

interface FeatureLike {
  featureId: string;
  version: string;
  lifecycle: string;
  name: string;
  description: string;
  ownerId: string;
  asil: string;
  tags: string[];
  requirementIds: string[];
  // 구현 연결 — 상세 응답에는 늘 있다(시험·옛 호출은 빠질 수 있다)
  functions?: { functionId: string; label: string }[];
  swIds?: string[];
  swVersions?: string[];
  ecuPnos?: string[];
}

/** Feature 상세 머리 — PROPOSED면 초안 수정, 가장 최신 Version이면 새 Version */
export function FeatureVersionActions({ f, latest }: { f: FeatureLike; latest: boolean }) {
  const nav = useNavigate();
  const author = usePermission(['FEATURE_AUTHOR']);
  const editor = usePermission(['FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER']);
  const create = useApiMutation<{ feature: { version: string }; rejudge: string[]; warnings?: RefWarning[] }>('createVersion', ['featureDetail', 'listFeatures', 'audit']);
  const save = useApiMutation('updateDraft', ['featureDetail', 'listFeatures', 'audit', 'gates']);
  const [open, setOpen] = useState<null | 'version' | 'draft'>(null);
  const initial = { name: f.name, description: f.description, ownerId: f.ownerId, asil: f.asil, tags: f.tags.join(', '), requirementIds: f.requirementIds.join(', ') };
  const [draft, setDraft] = useState(initial);
  const set = (k: keyof typeof draft) => (v: string) => setDraft((x) => ({ ...x, [k]: v }));
  // 구현 연결(P2-2) — 기준정보에서 고른 행. 바뀐 때만 보낸다
  const implInitial = implRowsOf(f);
  const [impl, setImpl] = useState<ImplRow[]>(implInitial);
  const implDirty = JSON.stringify(impl) !== JSON.stringify(implInitial);
  // 새 Version — 앞 Version에 구현이 비어 있으면 새 Version에서 넣는다(승인 뒤 막다른 길, P3-8)
  const implMissing = !!missingImplText(f);
  const [nextImpl, setNextImpl] = useState<ImplRow[]>([]);
  // 저장하지 않은 입력 — 닫기 전에 묻고(Drawer dirty), 버리면 처음 값으로(출시 준비 RD-UX-02)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || implDirty;
  // 승인 서랍·막다른 길 안내가 여는 서랍 — ?edit=impl(초안) · ?edit=version(새 Version)
  const [sp, setSp] = useSearchParams();
  const asked = sp.get('edit');
  useEffect(() => {
    if (!asked) return;
    if (asked === 'impl' && f.lifecycle === 'PROPOSED' && editor.ok) setOpen('draft');
    else if (asked === 'version' && latest && f.lifecycle !== 'PROPOSED' && author.ok) setOpen('version');
    // 주소의 요청은 한 번만 — 닫은 뒤 다시 열리지 않게 지운다
    setSp((x) => (x.delete('edit'), x), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  return (
    <>
      {f.lifecycle === 'PROPOSED' && (
        <Button disabled={!editor.ok} title={editor.hint} onClick={() => setOpen('draft')}>
          {E.draft}
        </Button>
      )}
      {latest && f.lifecycle !== 'PROPOSED' && (
        <Button disabled={!author.ok} title={author.hint} onClick={() => setOpen('version')} data-tour="version-new">
          {E.newVersion}
        </Button>
      )}
      <Drawer open={open === 'version'} title={`${E.newVersion} · ${f.featureId}`} onClose={() => (setOpen(null), setNextImpl([]))}>
        <NewVersionForm
          base={f.version}
          pending={create.isPending}
          error={create.error}
          blocked={nextImpl.length > 0 && !implComplete(nextImpl) ? W.impl.rowWhy : undefined}
          onSubmit={(bump, reason) =>
            create.mutate(
              { params: { id: f.featureId }, body: { baseVersion: f.version, bump, reason, ...(nextImpl.length ? { changes: implBody(nextImpl) } : {}) } },
              { onSuccess: (r) => (setOpen(null), setNextImpl([]), nav(`/features/${f.featureId}/${r.feature.version}`, r.warnings?.length ? { state: { refWarnings: r.warnings } } : undefined)) },
            )
          }
        >
          {implMissing && <ImplLinksEditor rows={nextImpl} onChange={setNextImpl} />}
        </NewVersionForm>
      </Drawer>
      <Drawer open={open === 'draft'} title={`${E.draft} · ${f.featureId} ${f.version}`} dirty={dirty} onClose={() => (setOpen(null), setDraft(initial), setImpl(implInitial))}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p className="ds-field__hint">{E.draftLead}</p>
          <TextField label={E.name} value={draft.name} onChange={set('name')} />
          <TextField label={E.description} value={draft.description} onChange={set('description')} area />
          <div className="ds-split">
            <TextField label={E.owner} value={draft.ownerId} onChange={set('ownerId')} />
            <Select label={E.asil} value={draft.asil} onChange={(e) => set('asil')(e.target.value)}>
              {['QM', 'A', 'B', 'C', 'D'].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
          </div>
          <Field label={<>{E.requirements} <span className="ds-tag">{W.required.tag}</span></>} hint={W.required.reqHint}>
            <input className="ds-input ds-input--mono" value={draft.requirementIds} onChange={(e) => set('requirementIds')(e.target.value)} />
          </Field>
          <TextField label={E.tags} value={draft.tags} onChange={set('tags')} />
          <ImplLinksEditor rows={impl} onChange={setImpl} />
          <ErrorNote error={save.error} />
          <Button
            variant="primary"
            disabled={save.isPending || !draft.name.trim() || !implComplete(impl)}
            reason={whyDisabled([!draft.name.trim(), ko.why.name], [!implComplete(impl), W.impl.rowWhy])}
            onClick={() =>
              save.mutate(
                {
                  params: { id: f.featureId, ver: f.version },
                  body: { name: draft.name.trim(), description: draft.description.trim(), ownerId: draft.ownerId.trim(), asil: draft.asil, tags: list(draft.tags), requirementIds: list(draft.requirementIds), ...(implDirty ? implBody(impl) : {}) },
                },
                { onSuccess: () => setOpen(null) },
              )
            }
          >
            {E.save}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

interface ProductLike {
  catalogId: string;
  version: string;
  lifecycle: string;
  name: string;
  description: string;
  baselineIds: string[];
  validFrom: string | null;
  validTo: string | null;
  // 구성 후보 표·실시간 검증에 쓰는 범위·유형 — 상세 응답에는 늘 있다
  country?: string;
  vehicleModel?: string;
  trim?: string;
  type?: string;
}

/** 상품 상세 머리 — PROPOSED면 초안 수정(구성 검증 결과를 바로 보인다), 아니면 새 Catalog Version */
export function ProductVersionActions({ p, latest }: { p: ProductLike; latest: boolean }) {
  const nav = useNavigate();
  const perm = usePermission(['PRODUCT_AUTHOR']);
  const create = useApiMutation<{ product: { version: string } }>('createProductVersion', ['productDetail', 'listProducts', 'audit']);
  const save = useApiMutation<{ composition: any }>('updateProductDraft', ['productDetail', 'listProducts', 'audit']);
  const [open, setOpen] = useState<null | 'version' | 'draft'>(null);
  const initial = { name: p.name, description: p.description, validFrom: p.validFrom ?? '', validTo: p.validTo ?? '' };
  const [draft, setDraft] = useState(initial);
  const set = (k: keyof typeof draft) => (v: string) => setDraft((x) => ({ ...x, [k]: v }));
  // 구성 Baseline은 BOM 후보 표에서 고른다(쉼표 글자 입력 대신, P1-10) — 고르는 동안 구성 검증을 실시간으로
  const [baselineIds, setBaselineIds] = useState<string[]>(p.baselineIds);
  const toggle = (id: string) => setBaselineIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const scope = p.country && p.vehicleModel && p.trim ? { country: p.country, vehicleModel: p.vehicleModel, trim: p.trim } : null;
  const live = useLiveComposition(
    open === 'draft' && scope && p.type ? { ...scope, type: p.type, baselineIds, validFrom: draft.validFrom.trim() || null, validTo: draft.validTo.trim() || null } : null,
    perm.role,
    perm.ok,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || baselineIds.join() !== p.baselineIds.join();
  return (
    <>
      {p.lifecycle === 'PROPOSED' && (
        <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen('draft')}>
          {E.draft}
        </Button>
      )}
      {latest && p.lifecycle !== 'PROPOSED' && (
        <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen('version')}>
          {E.newVersion}
        </Button>
      )}
      <Drawer open={open === 'version'} title={`${E.newVersion} · ${p.catalogId}`} onClose={() => setOpen(null)}>
        <NewVersionForm
          base={p.version}
          pending={create.isPending}
          error={create.error}
          onSubmit={(bump, reason) =>
            create.mutate({ params: { id: p.catalogId }, body: { baseVersion: p.version, bump, reason } }, { onSuccess: (r) => (setOpen(null), nav(`/products/${p.catalogId}/${r.product.version}`)) })
          }
        />
      </Drawer>
      <Drawer open={open === 'draft'} title={`${E.draft} · ${p.catalogId} ${p.version}`} dirty={dirty} onClose={() => (setOpen(null), setDraft(initial), setBaselineIds(p.baselineIds))}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <TextField label={E.name} value={draft.name} onChange={set('name')} />
          <TextField label={E.description} value={draft.description} onChange={set('description')} area />
          <section aria-label={E.baselines} data-testid="product-draft-baselines" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <span className="ds-field__label">{W.product.picked(baselineIds.length)}</span>
            {scope && <BaselinePicker scope={scope} picked={baselineIds} onToggle={toggle} />}
          </section>
          <div className="ds-split">
            <TextField label={E.validFrom} value={draft.validFrom} onChange={set('validFrom')} mono />
            <TextField label={E.validTo} value={draft.validTo} onChange={set('validTo')} mono />
          </div>
          <ErrorNote error={save.error} />
          {(live.comp ?? save.data?.composition) && <CompositionView c={live.comp ?? save.data!.composition} picked={baselineIds} onAdd={toggle} />}
          <Button
            variant="primary"
            disabled={save.isPending || !draft.name.trim() || baselineIds.length === 0}
            reason={whyDisabled([!draft.name.trim(), ko.why.name], [baselineIds.length === 0, ko.why.baselines])}
            onClick={() =>
              save.mutate({
                params: { id: p.catalogId, ver: p.version },
                body: { name: draft.name.trim(), description: draft.description.trim(), baselineIds, validFrom: draft.validFrom.trim() || null, validTo: draft.validTo.trim() || null },
              })
            }
          >
            {E.save}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

interface PolicyLike {
  policyId: string;
  status: string;
  description: string;
  enabled: boolean;
  safeDefault: boolean;
  rollout: { mode: 'ALL' | 'NONE' | 'COHORT'; basisPoints: number; salt?: string };
}

/** 정책 상세 머리 — DRAFT·VALIDATED·REJECTED만 수정(새 개정본 DRAFT, 다시 검증) */
export function PolicyEdit({ p }: { p: PolicyLike }) {
  const perm = usePermission(['FEATURE_AUTHOR', 'IMPLEMENTER']);
  const save = useApiMutation('updatePolicy', ['policyDetail', 'listPolicies', 'audit', 'policyRevisions', 'policyChanges']);
  const [open, setOpen] = useState(false);
  const initial = { description: p.description, enabled: p.enabled, safeDefault: p.safeDefault, mode: p.rollout.mode, basisPoints: String(p.rollout.basisPoints) };
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  if (!['DRAFT', 'VALIDATED', 'REJECTED'].includes(p.status)) return null;
  const bp = Number(f.basisPoints);
  return (
    <>
      <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen(true)}>
        {E.policyEdit}
      </Button>
      <Drawer open={open} title={`${E.policyEdit} · ${p.policyId}`} dirty={dirty} onClose={() => (setOpen(false), setF(initial))}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <p className="ds-field__hint">{E.policyEditLead}</p>
          <TextField label={E.description} value={f.description} onChange={(v) => setF((x) => ({ ...x, description: v }))} area />
          <div className="ds-split">
            <label className="ds-choices">
              <input type="checkbox" checked={f.enabled} onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))} />
              {E.enabled}
            </label>
            <label className="ds-choices">
              <input type="checkbox" checked={f.safeDefault} onChange={(e) => setF((x) => ({ ...x, safeDefault: e.target.checked }))} />
              {E.safeDefault}
            </label>
          </div>
          <div className="ds-split">
            <Select label={E.rolloutMode} value={f.mode} onChange={(e) => setF((x) => ({ ...x, mode: e.target.value as PolicyLike['rollout']['mode'] }))}>
              {(['ALL', 'NONE', 'COHORT'] as const).map((m) => (
                <option key={m} value={m}>{E.rollouts[m]}</option>
              ))}
            </Select>
            {f.mode === 'COHORT' && <TextField label={E.basisPoints} value={f.basisPoints} onChange={(v) => setF((x) => ({ ...x, basisPoints: v }))} mono />}
          </div>
          <ErrorNote error={save.error} />
          <Button
            variant="primary"
            disabled={save.isPending || (f.mode === 'COHORT' && !(Number.isInteger(bp) && bp >= 0 && bp <= 10000))}
            reason={whyDisabled([f.mode === 'COHORT' && !(Number.isInteger(bp) && bp >= 0 && bp <= 10000), ko.why.bp])}
            onClick={() =>
              save.mutate(
                { params: { id: p.policyId }, body: { description: f.description.trim(), enabled: f.enabled, safeDefault: f.safeDefault, rollout: { ...p.rollout, mode: f.mode, basisPoints: f.mode === 'COHORT' ? bp : f.mode === 'ALL' ? 10000 : 0 } } },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {E.save}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

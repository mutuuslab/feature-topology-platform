// 새 Version·초안 수정 (P11) — Feature(D01-01)·상품(D01-03)·정책(D01-06). 불변 규칙(출시 뒤 수정 409 → 새 Version)은 서버가 다시 검사한다.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { Button, Drawer, ErrorNote, Field, Select, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { CompositionView } from '../products/Products';

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

function NewVersionForm({ base, onSubmit, pending, error, children }: { base: string; onSubmit: (bump: string, reason: string) => void; pending: boolean; error: any; children?: ReactNode }) {
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
      <Button variant="primary" disabled={reason.trim().length < 2 || pending} reason={whyDisabled([reason.trim().length < 2, ko.why.reason])} onClick={() => onSubmit(bump, reason.trim())}>
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
}

/** Feature 상세 머리 — PROPOSED면 초안 수정, 가장 최신 Version이면 새 Version */
export function FeatureVersionActions({ f, latest }: { f: FeatureLike; latest: boolean }) {
  const nav = useNavigate();
  const author = usePermission(['FEATURE_AUTHOR']);
  const editor = usePermission(['FEATURE_AUTHOR', 'SAFETY_OFFICER', 'VARIANT_OWNER', 'IMPLEMENTER']);
  const create = useApiMutation<{ feature: { version: string }; rejudge: string[] }>('createVersion', ['featureDetail', 'listFeatures', 'audit']);
  const save = useApiMutation('updateDraft', ['featureDetail', 'listFeatures', 'audit', 'gates']);
  const [open, setOpen] = useState<null | 'version' | 'draft'>(null);
  const [draft, setDraft] = useState({ name: f.name, description: f.description, ownerId: f.ownerId, asil: f.asil, tags: f.tags.join(', '), requirementIds: f.requirementIds.join(', ') });
  const set = (k: keyof typeof draft) => (v: string) => setDraft((x) => ({ ...x, [k]: v }));
  return (
    <>
      {f.lifecycle === 'PROPOSED' && (
        <Button disabled={!editor.ok} title={editor.hint} onClick={() => setOpen('draft')}>
          {E.draft}
        </Button>
      )}
      {latest && f.lifecycle !== 'PROPOSED' && (
        <Button disabled={!author.ok} title={author.hint} onClick={() => setOpen('version')}>
          {E.newVersion}
        </Button>
      )}
      <Drawer open={open === 'version'} title={`${E.newVersion} · ${f.featureId}`} onClose={() => setOpen(null)}>
        <NewVersionForm
          base={f.version}
          pending={create.isPending}
          error={create.error}
          onSubmit={(bump, reason) =>
            create.mutate({ params: { id: f.featureId }, body: { baseVersion: f.version, bump, reason } }, { onSuccess: (r) => (setOpen(null), nav(`/features/${f.featureId}/${r.feature.version}`)) })
          }
        />
      </Drawer>
      <Drawer open={open === 'draft'} title={`${E.draft} · ${f.featureId} ${f.version}`} onClose={() => setOpen(null)}>
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
          <TextField label={E.requirements} value={draft.requirementIds} onChange={set('requirementIds')} mono />
          <TextField label={E.tags} value={draft.tags} onChange={set('tags')} />
          <ErrorNote error={save.error} />
          <Button
            variant="primary"
            disabled={save.isPending || !draft.name.trim()}
            onClick={() =>
              save.mutate(
                { params: { id: f.featureId, ver: f.version }, body: { name: draft.name.trim(), description: draft.description.trim(), ownerId: draft.ownerId.trim(), asil: draft.asil, tags: list(draft.tags), requirementIds: list(draft.requirementIds) } },
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
}

/** 상품 상세 머리 — PROPOSED면 초안 수정(구성 검증 결과를 바로 보인다), 아니면 새 Catalog Version */
export function ProductVersionActions({ p, latest }: { p: ProductLike; latest: boolean }) {
  const nav = useNavigate();
  const perm = usePermission(['PRODUCT_AUTHOR']);
  const create = useApiMutation<{ product: { version: string } }>('createProductVersion', ['productDetail', 'listProducts', 'audit']);
  const save = useApiMutation<{ composition: any }>('updateProductDraft', ['productDetail', 'listProducts', 'audit']);
  const [open, setOpen] = useState<null | 'version' | 'draft'>(null);
  const [draft, setDraft] = useState({ name: p.name, description: p.description, baselineIds: p.baselineIds.join(', '), validFrom: p.validFrom ?? '', validTo: p.validTo ?? '' });
  const set = (k: keyof typeof draft) => (v: string) => setDraft((x) => ({ ...x, [k]: v }));
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
      <Drawer open={open === 'draft'} title={`${E.draft} · ${p.catalogId} ${p.version}`} onClose={() => setOpen(null)}>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <TextField label={E.name} value={draft.name} onChange={set('name')} />
          <TextField label={E.description} value={draft.description} onChange={set('description')} area />
          <TextField label={E.baselines} value={draft.baselineIds} onChange={set('baselineIds')} mono />
          <div className="ds-split">
            <TextField label={E.validFrom} value={draft.validFrom} onChange={set('validFrom')} mono />
            <TextField label={E.validTo} value={draft.validTo} onChange={set('validTo')} mono />
          </div>
          <ErrorNote error={save.error} />
          {save.data && <CompositionView c={save.data.composition} />}
          <Button
            variant="primary"
            disabled={save.isPending || !draft.name.trim() || list(draft.baselineIds).length === 0}
            reason={whyDisabled([!draft.name.trim(), ko.why.name], [list(draft.baselineIds).length === 0, ko.why.baselines])}
            onClick={() =>
              save.mutate({
                params: { id: p.catalogId, ver: p.version },
                body: { name: draft.name.trim(), description: draft.description.trim(), baselineIds: list(draft.baselineIds), validFrom: draft.validFrom.trim() || null, validTo: draft.validTo.trim() || null },
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
  const [f, setF] = useState({ description: p.description, enabled: p.enabled, safeDefault: p.safeDefault, mode: p.rollout.mode, basisPoints: String(p.rollout.basisPoints) });
  if (!['DRAFT', 'VALIDATED', 'REJECTED'].includes(p.status)) return null;
  const bp = Number(f.basisPoints);
  return (
    <>
      <Button disabled={!perm.ok} title={perm.hint} onClick={() => setOpen(true)}>
        {E.policyEdit}
      </Button>
      <Drawer open={open} title={`${E.policyEdit} · ${p.policyId}`} onClose={() => setOpen(false)}>
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

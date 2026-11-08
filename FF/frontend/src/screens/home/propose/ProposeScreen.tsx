// /feature/propose — 기준 Feature DB 선택 → 기본값 확인·문서 작성 → 제출·검토·정의 승인.
// 대표 기준 행에서 이름·설명·대표 ASIL·분류 태그·규제를 미리 채우고(§6.3), 바뀐 칸은 '수정됨'으로 보인다.
// ASIL을 대표 ASIL과 다르게 하면 사유(asilDeviation)가 필수 — 기능안전 담당자 G2 검토 대상. 같은 범위 같은 대표 행은 409 → 사유와 함께 확인(§6.2).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FeatureRefRole } from '@ff/contracts';
import { actorFor, canAct } from '../../../api/actor';
import { fieldErrors } from '../../../api/field-errors';
import { useApi, useApiMutation } from '../../../api/hooks';
import { propose as P } from '../../../copy/propose';
import { PRD_BODY_LIMIT, PRD_TEMPLATE, proposePrd as D } from '../../../copy/propose-prd';
import { proposeGuide as G } from '../../../copy/propose-guide';
import { personLabel } from '../../../data/people';
import { planning as W } from '../../../copy/planning';
import { Button, Drawer, ErrorNote, Field, PageHeader, Panel, useUnsavedGuard, whyDisabled } from '../../../design';
import { usePermission } from '../../shared';
import { RefPicker, refWarning } from './RefPicker';
import { RefRequestDrawer } from './RefRequestDrawer';
import { RefStatusBadge, RefWarningItems, type RefWarning } from '../../refdb/common';
import { ASIL_VALUES, type TaxonomyNodeLite } from './taxonomy';
import { choosePicked, list, makePrimaryPicked, prefillOf, preserveEditedPrefill, primaryOf, regulationsOf, removePicked, sameList, type PickedRef, type Prefill, type RefLite } from './prefill';
import { autofill as AF, profile as PR } from '../../../copy/ple';
import { AutofillPanel, scopeKey, useAutofill, variationPointsFor, type ProfileDraft } from './AutofillPanel';
import { RegistrationReview } from './RegistrationReview';
import { PrdEditor } from './PrdEditor';
import { RegistrationGuide } from './RegistrationGuide';

const INITIAL = { name: '', description: '', requirementIds: '', country: '', vehicleModel: '', trim: '', ownerId: '', asil: 'QM', tags: '', upgVc: '' };
type Form = typeof INITIAL;
const DUPLICATE = 'REFDB_DUPLICATE_IN_SCOPE';
const LINK_REQUIRED = 'REFDB_LINK_REQUIRED';

/** 등록 응답의 서버 안내 — 요청 중·검토 필요·폐기 예정 행(REF_STATUS), 같은 범위 중복 확인(REF_DUPLICATE_CONFIRMED), 선행 행 없음(REF_PREREQUISITE) — refdb/common RefWarning */
export type { RefWarning };

interface Created {
  featureId: string;
  version: string;
  warnings?: RefWarning[];
}

export default function ProposeScreen() {
  const nav = useNavigate();
  const perm = usePermission(['FEATURE_AUTHOR']);
  const actorId = actorFor(perm.role).id;
  const accountOwner = actorId === 'anonymous' ? '' : actorId;
  const create = useApiMutation<Created>('createFeature', ['listFeatures', 'events', 'audit']);
  const taxonomy = useApi<{ items: TaxonomyNodeLite[] }>('refTaxonomy');
  const nodes = taxonomy.data?.items ?? [];
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<PickedRef[]>([]);
  const [pendingPicked, setPendingPicked] = useState<PickedRef[]>([]);
  const [domain, setDomain] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [f, setF] = useState<Form>(() => ({ ...INITIAL, ownerId: accountOwner }));
  const [userEdited, setUserEdited] = useState(false);
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [cps, setCps] = useState<string[]>(['Flag']);
  const [asilReason, setAsilReason] = useState('');
  const [dupReason, setDupReason] = useState('');
  const [done, setDone] = useState<Created | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // Stable callbacks keep Drawer's original focus target across pending selection and async form updates.
  const closeRefs = useCallback(() => setSelecting(false), []);
  const closeReview = useCallback(() => setReviewing(false), []);
  const closeRequest = useCallback(() => { setRequesting(false); setSelecting(true); }, []);
  // 미리 채운 값과 그 값을 준 대표 행 — 대표를 바꾸면 사용자가 고치지 않은 칸만 새 기준값으로 바꾼다
  const [base, setBase] = useState<(Prefill & { refId: string }) | null>(null);
  // 자동 채움(20-60 §5.3) — 사람이 손대지 않은 제어점·범위·프로필만 대표 행이 바뀔 때 채운다
  const [cpsTouched, setCpsTouched] = useState(false);
  const [scopeTouched, setScopeTouched] = useState(false);
  const [asilTouched, setAsilTouched] = useState(false);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [appliedRef, setAppliedRef] = useState<string | null>(null);
  const dupHead = useRef<HTMLHeadingElement>(null);

  const primary = primaryOf(picked);
  const scope = { country: f.country.trim(), vehicleModel: f.vehicleModel.trim(), trim: f.trim.trim() };
  const af = useAutofill(primary, picked.map((p) => p.ref), f.name, scope);
  const ownerField = af.data?.fields.find((field) => field.key === 'owner');
  const catalogueOwner = typeof ownerField?.value === 'string' ? ownerField.value.trim() : '';
  const suggestedOwner = catalogueOwner || accountOwner;
  useEffect(() => {
    if (!ownerTouched) setF((current) => current.ownerId === suggestedOwner ? current : { ...current, ownerId: suggestedOwner });
  }, [ownerTouched, suggestedOwner]);
  useEffect(() => {
    const r = af.data;
    if (!r || r.refId !== primary?.refId || r.refId === appliedRef) return;
    setAppliedRef(r.refId);
    const plan = r.fields.find((x) => x.key === 'controlPoints')?.value;
    if (!cpsTouched && Array.isArray(plan) && plan.length) setCps(plan);
    // 지금 범위가 후보 밖이고 사람이 고치지 않았으면 첫 후보로
    const first = r.scopeCandidates[0];
    if (!scopeTouched && first && !r.scopeCandidates.some((s) => scopeKey(s) === scopeKey(scope))) setF((x) => ({ ...x, country: first.country, vehicleModel: first.vehicleModel, trim: first.trim }));
    const { variationPoints: _vps, ...draft } = r.variability;
    setProfile(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [af.data]);
  // Automatic account defaults do not turn an untouched document into an unsaved edit.
  const dirty = !done && !create.isSuccess && (picked.length > 0 || userEdited);
  // 입력이 있으면 떠나기 전에 묻는다 — 등록이 끝나면(상세로 이동) 묻지 않는다(출시 준비 RD-UX-02)
  useUnsavedGuard(dirty);

  const openRefs = () => { setPendingPicked(picked); setSelecting(true); };
  const choose = (ref: RefLite, role: FeatureRefRole) => setPendingPicked((xs) => choosePicked(xs, ref, role));
  const makePrimary = (refId: string) => setPendingPicked((xs) => makePrimaryPicked(xs, refId));
  const remove = (refId: string) => setPendingPicked((xs) => removePicked(xs, refId));

  const toStep2 = () => {
    const candidate = primaryOf(pendingPicked);
    if (!candidate) return;
    if (base?.refId !== candidate.refId) {
      const next = prefillOf(candidate);
      setF((x) => ({ ...x, ...preserveEditedPrefill(x, base, next, asilTouched) }));
      setBase({ ...next, refId: candidate.refId });
    }
    setPicked(pendingPicked);
    setSelecting(false);
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setUserEdited(true);
    if (k === 'ownerId') setOwnerTouched(true);
    if (k === 'country' || k === 'vehicleModel' || k === 'trim') setScopeTouched(true);
    if (k === 'asil') setAsilTouched(true);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  const fe = fieldErrors(create.error);
  const duplicate = create.error?.code === DUPLICATE;
  // 같은 범위 중복(409) 안내가 뜨면 그 제목으로 초점 — 누른 '제안 등록' 아래에 새 칸이 생긴 것을 듣는다(WCAG 4.1.3)
  useEffect(() => {
    if (duplicate) dupHead.current?.focus();
  }, [duplicate]);
  const asilChanged = !!base && f.asil !== base.asil;
  const regulations = primary ? regulationsOf(primary) : [];

  const mark = (k: 'name' | 'description' | 'tags'): ReactNode => {
    if (!base) return undefined;
    const same = k === 'tags' ? sameList(f.tags, base.tags) : f[k].trim() === base[k].trim();
    return (
      <span className="ds-tag ds-ref-mark" data-ref-mark={same ? 'base' : 'edited'}>
        {same ? P.markBase : P.markEdited}
      </span>
    );
  };

  const submit = (confirmDuplicate = false) => {
    if (!primary) return;
    create.mutate(
      {
        body: {
          name: f.name.trim(),
          description: f.description.trim(),
          requirementIds: list(f.requirementIds),
          country: f.country.trim(),
          vehicleModel: f.vehicleModel.trim(),
          trim: f.trim.trim(),
          ownerId: f.ownerId.trim(),
          asil: f.asil,
          tags: list(f.tags),
          upgVc: list(f.upgVc),
          controlPoints: cps,
          featureRefs: picked.map((p) => ({ refId: p.ref.refId, role: p.role })),
          ...(asilChanged && base ? { asilDeviation: { from: base.asil, to: f.asil, reason: asilReason.trim() } } : {}),
          ...(regulations.length ? { refRegulations: regulations } : {}),
          // 26580 Feature 프로필 — 변이점은 고른 제어점의 것만(서버가 대표 행으로 다시 계산해 그대로·고침을 기록)
          ...(profile && af.data ? { variability: { ...profile, variationPoints: variationPointsFor(af.data.variability.variationPoints, cps) } } : {}),
          ...(confirmDuplicate ? { confirmDuplicate: true, duplicateReason: dupReason.trim() } : {}),
        },
      },
      {
        onError: (e) => {
          // 대표 기준 행이 없다는 거절(400 REFDB_LINK_REQUIRED) — 1단계로 돌려보내 기준 행을 고르게 한다
          if (e.code === LINK_REQUIRED) {
            setNotice(P.linkRequired);
            openRefs();
          }
        },
        onSuccess: (r) => {
          // 서버 안내(요청 중·검토 필요·폐기 예정 행 연결 등)가 있으면 이 화면에서 먼저 보여 준다
          // 상세에서 '등록했습니다 — 다음 할 일'(정의 승인 필수 칸·구현 연결·G1~G3)을 보인다(P1-7)
          if (r.warnings?.length) setDone(r);
          else nav(`/features/${r.featureId}/${r.version}?tab=ext`, { state: { registered: true } });
        },
      },
    );
  };

  const why = whyDisabled(
    [!perm.ok, perm.hint],
    [!primary, P.nextWhy],
    [!f.country.trim() || !f.vehicleModel.trim() || !f.trim.trim(), P.scopeWhy],
    [!f.name.trim() || !f.description.trim() || !f.ownerId.trim(), P.requiredWhy],
    [f.description.length > PRD_BODY_LIMIT, D.bodyTooLong],
    [f.description.trim() === PRD_TEMPLATE.trim(), D.templateFill],
    [asilChanged && asilReason.trim().length < 2, P.asilReasonWhy],
    [profile?.catalogueRole === 'SUB' && !profile.parentRefId, PR.parentWhy],
  );

  // '작성자만' 안내는 실제로 역할이 다를 때만 — 공개 데모도 브라우저 안 시연 데이터로 등록한다(설계 20-60)
  const message = !canAct(perm.role, ['FEATURE_AUTHOR'])
    ? { tone: 'neutral' as const, text: P.key.cannot }
    : done
      ? { tone: 'warn' as const, text: P.key.done }
      : { tone: 'neutral' as const, text: primary ? P.key.picked(primary.refId, picked.length - 1) : D.key };

  const text = (k: keyof Form, label: string, hint?: ReactNode, mono = true) => (
    <Field label={label} error={fe[k]} hint={hint}>
      <input className={`ds-input${mono ? ' ds-input--mono' : ''}`} name={k} required={k === 'country' || k === 'vehicleModel' || k === 'trim'} maxLength={k === 'country' ? 8 : k === 'vehicleModel' || k === 'trim' ? 80 : undefined} value={f[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <div className="ds-screen">
      <PageHeader codes="D01-01 · PROPOSED 0.1.0 · 30-95 §6" title={P.title} lead={D.lead} message={message} actions={!done && <div className="propose-actions">
        <Button onClick={openRefs}>{D.chooseRefs}</Button>
        {primary && <Button variant="primary" disabled={!!why || create.isPending} reason={why} onClick={() => setReviewing(true)}>{D.reviewTop}</Button>}
      </div>} />
      <p className="propose-prd-lifecycle">{D.lifecycle}</p>
      {!done && <RegistrationGuide />}
      <Panel id="propose-form" tour="feature-form">
        {notice && (
          <p className="ds-field__hint" role="status" data-testid="ref-request-notice">
            {notice}
          </p>
        )}
        {done ? (
          <section aria-labelledby="propose-warnings-h" data-testid="propose-warnings">
            <h3 id="propose-warnings-h">{P.warningsTitle}</h3>
            <RefWarningItems warnings={done.warnings ?? []} />
            <Button variant="primary" onClick={() => nav(`/features/${done.featureId}/${done.version}?tab=ext`, { state: { registered: true } })}>
              {P.openDetail}
            </Button>
          </section>
        ) : !primary ? (
          <section className="propose-reference-gate" aria-labelledby="propose-reference-gate-h" data-testid="propose-reference-gate">
            <h2 id="propose-reference-gate-h">{G.startTitle}</h2>
            <p>{G.startBody}</p>
            <p className="ds-field__hint">{G.startMissing}</p>
            <div className="propose-actions">
              <Button onClick={() => { setPendingPicked(picked); setRequesting(true); }}>{G.requestMissing}</Button>
              <Link to="/master/feature-db">{G.openFeatureDb}</Link>
            </div>
          </section>
        ) : (
          <>
            {/* 적용한 기준이 있어야 문서 편집과 등록 전 확인을 연다. */}
            <div className="propose-prd-layout ds-prefill" data-prefilled={base?.refId}>
              <PrdEditor name={f.name} description={f.description} onName={(name) => { setUserEdited(true); setF((x) => ({ ...x, name })); }} onDescription={(description) => { setUserEdited(true); setF((x) => ({ ...x, description })); }} nameError={fe.name} descriptionError={fe.description} nameMark={mark('name')} descriptionMark={mark('description')} />
              <aside className="propose-prd-aside" aria-label={D.metadataLandmark}>
                <h3>{D.metadata}</h3>
                <section className="ds-stack" aria-label={D.referenceTitle}>
                  <p className="propose-selection-summary">{primary ? <>{primary.nameKo} <span className="ds-mono">{primary.refId}</span> · {P.selection.included(picked.filter((p) => p.role === 'INCLUDED').length)}</> : D.referenceEmpty}</p>
                  <p className="ds-field__hint">{D.referenceHint}</p>
                  <Button onClick={openRefs}>{D.manageRefs}</Button>
                </section>
                <Field label={P.owner} error={fe.ownerId} hint={<span id="propose-owner-hint">{ownerTouched ? G.ownerEdited : catalogueOwner && ownerField ? G.ownerCatalogue(ownerField.source.column) : G.ownerAccount(personLabel(accountOwner))} {P.form.ownerHint}</span>}>
                  <input className="ds-input" name="ownerId" aria-label={P.owner} aria-describedby="propose-owner-hint" required maxLength={100} value={f.ownerId} onChange={set('ownerId')} list="propose-owner-candidates" />
                  <datalist id="propose-owner-candidates">{[...new Set([accountOwner, catalogueOwner].filter(Boolean))].map((owner) => <option key={owner} value={owner}>{personLabel(owner)}</option>)}</datalist>
                </Field>
                {!!accountOwner && f.ownerId !== accountOwner && <Button variant="ghost" onClick={() => { setUserEdited(true); setOwnerTouched(true); setF((x) => ({ ...x, ownerId: accountOwner })); }}>{G.ownerSelf}</Button>}
                <h3 className="propose-section-heading">{P.form.references}</h3>
                {/* 정의 승인 필수(PROPOSED → APPROVED 필수 입력) — 등록은 되지만 비어 있으면 승인이 막힌다(P1-7) */}
                <Field label={<>{P.requirements} <span className="ds-tag" data-required-for="approval">{W.required.tag}</span></>} error={fe.requirementIds} hint={P.form.requirementsHint}>
                  <input className="ds-input ds-input--mono" name="requirementIds" value={f.requirementIds} onChange={set('requirementIds')} />
                </Field>
                {text('tags', P.tags, <>{mark('tags')} {P.form.tagsHint}</>, false)}
                <section aria-labelledby="propose-regs-h" data-testid="ref-regulations">
                  <h3 id="propose-regs-h">{P.refRegulations}</h3>
                  <p className="ds-field__hint">{P.refRegulationsHint}</p>
                  {regulations.length ? (
                    <ul className="ds-chips" style={{ listStyle: 'none', padding: 0 }}>
                      {regulations.map((r) => (
                        <li key={r} className="ds-tag">{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-field__hint">{P.refRegulationsNone}</p>
                  )}
                </section>
                <h3 className="propose-section-heading">{P.form.scope} <span className="ds-tag">{P.form.required}</span></h3>
                <p className="ds-field__hint">{P.form.scopeHint}</p>
                {af.data?.scopeCandidates.length ? <Field label={G.scope} hint={<span id="propose-scope-candidates-hint">{G.scopeHint}</span>}>
                  <select className="ds-select" aria-label={G.scope} aria-describedby="propose-scope-candidates-hint" value={af.data.scopeCandidates.some((s) => scopeKey(s) === scopeKey(scope)) ? scopeKey(scope) : ''} onChange={(e) => {
                    const selected = af.data?.scopeCandidates.find((s) => scopeKey(s) === e.target.value);
                    if (selected) { setUserEdited(true); setScopeTouched(true); setF((x) => ({ ...x, country: selected.country, vehicleModel: selected.vehicleModel, trim: selected.trim })); }
                  }}>
                    <option value="">{G.customScope}</option>
                    {af.data.scopeCandidates.map((candidate) => <option key={scopeKey(candidate)} value={scopeKey(candidate)}>{candidate.country} · {candidate.vehicleModel} · {candidate.trim}</option>)}
                  </select>
                </Field> : <p className="ds-field__hint" role="status">{!primary ? G.scopeBefore : af.pending ? G.scopeWaiting : G.scopeEmpty}</p>}
                {text('country', P.country, P.form.countryHint)}
                {text('vehicleModel', P.vehicleModel, P.form.modelHint)}
                {text('trim', P.trim, P.form.trimHint)}
                <Field
                  label={P.asil}
                  error={fe.asil}
                  hint={
                    base ? <>{P.form.asilHint} {(
                      <span className="ds-tag ds-ref-mark" data-ref-mark={asilChanged ? 'edited' : 'base'}>
                        {asilChanged ? `${P.markEdited} · ${P.asilBase(base.asil)}` : `${P.markBase} · ${P.asilBase(base.asil)}`}
                      </span>
                    )}</> : P.form.asilHint
                  }
                >
                  <select className="ds-select" name="asil" value={f.asil} onChange={set('asil')}>
                    {ASIL_VALUES.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </Field>
                {asilChanged && base && (
                  // 대표 ASIL과 다르게 한 사유 — 기능안전 G2 검토 대상이라 경고 바탕 안내 칸으로 둔다
                  <div className="ds-callout" data-tone="warn" data-testid="asil-deviation">
                    <Field label={P.asilReason} error={fe.asilDeviation} hint={P.asilReasonHint(base.asil, f.asil)}>
                      <textarea className="ds-input" name="asilDeviation" value={asilReason} onChange={(e) => setAsilReason(e.target.value)} rows={2} />
                    </Field>
                  </div>
                )}
                <h3 className="propose-section-heading">{P.form.optional}</h3>
                {text('upgVc', P.upgVc, P.form.upgHint)}
                <fieldset className="ds-choices" aria-label={P.cps}>
                  <legend className="ds-field__label">{P.cps}</legend>
                  <p className="ds-field__hint" id="propose-cps-hint">{P.form.cpHint}</p>
                  {['Flag', 'Parameter', 'Signal', 'DTC'].map((c) => (
                    <label key={c}>
                      <input type="checkbox" aria-describedby="propose-cps-hint" checked={cps.includes(c)} onChange={() => { setUserEdited(true); setCpsTouched(true); setCps((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c])); }} />
                      {c}
                    </label>
                  ))}
                </fieldset>
              </aside>
            </div>

            {af.data && profile ? (
              <details className="propose-autofill">
                <summary>{P.form.autofill}</summary>
                <AutofillPanel result={af.data} form={{ name: f.name, description: f.description, asil: f.asil, tags: f.tags, owner: f.ownerId }} cps={cps} scope={scope}
                  onScope={(s) => { setScopeTouched(true); setF((x) => ({ ...x, ...s })); }} profile={profile} onProfile={setProfile} />
              </details>
            ) : af.pending && <p className="ds-field__hint" role="status">{AF.loading}</p>}

            <section aria-labelledby="propose-linked-h" data-testid="ref-linked">
              <h3 id="propose-linked-h">{P.linked}</h3>
              <ul className="ds-check">
                {picked.map((p) => {
                  const warn = refWarning(p.ref);
                  return (
                    <li key={p.ref.refId} data-state={warn ? 'REVIEW' : 'PASS'}>
                      <span>
                        <span className="ds-tag">{P.role[p.role]}</span> <span className="ds-mono">{p.ref.refId}</span> {p.ref.nameKo} <RefStatusBadge status={p.ref.status} />
                        {warn && <span className="ds-check__detail">{warn}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {fe.featureRefs && <p className="ds-field__error">{fe.featureRefs}</p>}
            </section>

            {duplicate ? (
              <section className="ds-panel" aria-labelledby="propose-dup-h" data-testid="propose-duplicate" style={{ padding: 'var(--sp-3)' }}>
                <h3 id="propose-dup-h" ref={dupHead} tabIndex={-1}>
                  {P.duplicate.title}
                </h3>
                <p role="alert">{create.error?.message}</p>
                <Field label={P.duplicate.reason} hint={P.duplicate.hint} error={fe.duplicateReason}>
                  <textarea className="ds-input" name="duplicateReason" value={dupReason} onChange={(e) => setDupReason(e.target.value)} rows={2} />
                </Field>
                <Button variant="primary" data-ui="createFeatureConfirmDuplicate" disabled={dupReason.trim().length < 2 || create.isPending} reason={dupReason.trim().length < 2 ? P.duplicate.reasonWhy : undefined} onClick={() => submit(true)}>
                  {P.duplicate.confirm}
                </Button>
              </section>
            ) : (
              <ErrorNote error={create.error} />
            )}

            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Button onClick={openRefs}>{P.changeRefs}</Button>
              <Button variant="primary" data-ui="reviewFeature" disabled={!!why || create.isPending} reason={why} title={perm.hint} onClick={() => setReviewing(true)}>
                {P.review.open}
              </Button>
            </div>
          </>
        )}
      </Panel>
      {selecting && <Drawer open title={P.steps.pick} onClose={closeRefs}>
        <RefPicker suggestIntent picked={pendingPicked} onChoose={choose} onRemove={remove} onMakePrimary={makePrimary} onRequest={() => { setSelecting(false); setRequesting(true); }} onNext={toStep2} nodes={nodes} domain={domain} setDomain={setDomain} />
      </Drawer>}
      {reviewing && primary && <RegistrationReview draft={f} picked={picked} cps={cps} onClose={closeReview} onRegister={() => { setReviewing(false); submit(false); }} />}
      {requesting && (
        <RefRequestDrawer
          open={requesting}
          nodes={nodes}
          initialDomain={domain}
          onClose={closeRequest}
          onCreated={(ref) => {
            setRequesting(false);
            setSelecting(true);
            choose(ref, 'PRIMARY');
            setNotice(P.request.notice(ref.refId));
          }}
        />
      )}
    </div>
  );
}

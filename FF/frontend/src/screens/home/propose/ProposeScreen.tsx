// /feature/propose — Feature 등록 마법사(30-95 §6.1, 20-60 §6): ① 기준 기능 고르기(이름·설명 추천 포함) → ② 자동 채움 확인 → 제출·검토·정의 승인.
// 대표 기준 행에서 이름·설명·대표 ASIL·분류 태그·규제를 미리 채우고(§6.3), 바뀐 칸은 '수정됨'으로 보인다.
// ASIL을 대표 ASIL과 다르게 하면 사유(asilDeviation)가 필수 — 기능안전 담당자 G2 검토 대상. 같은 범위 같은 대표 행은 409 → 사유와 함께 확인(§6.2).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FeatureRefRole } from '@ff/contracts';
import { canAct } from '../../../api/actor';
import { fieldErrors } from '../../../api/field-errors';
import { useApi, useApiMutation } from '../../../api/hooks';
import { propose as P } from '../../../copy/propose';
import { planning as W } from '../../../copy/planning';
import { Button, ErrorNote, Field, PageHeader, Panel, useUnsavedGuard, whyDisabled } from '../../../design';
import { usePermission } from '../../shared';
import { RefPicker, refWarning } from './RefPicker';
import { RefRequestDrawer } from './RefRequestDrawer';
import { RefStatusBadge, RefWarningItems, type RefWarning } from '../../refdb/common';
import { ASIL_VALUES, type TaxonomyNodeLite } from './taxonomy';
import { choosePicked, list, makePrimaryPicked, prefillOf, primaryOf, regulationsOf, removePicked, sameList, type PickedRef, type Prefill, type RefLite } from './prefill';
import { autofill as AF, profile as PR } from '../../../copy/ple';
import { RegistrationSteps } from '../../ple/RegistrationSteps';
import { IntentSuggest } from './IntentSuggest';
import { AutofillPanel, scopeKey, useAutofill, variationPointsFor, type ProfileDraft } from './AutofillPanel';

const INITIAL = { name: '', description: '', requirementIds: '', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: '', asil: 'QM', tags: '', upgVc: '' };
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
  const create = useApiMutation<Created>('createFeature', ['listFeatures', 'events', 'audit']);
  const taxonomy = useApi<{ items: TaxonomyNodeLite[] }>('refTaxonomy');
  const nodes = taxonomy.data?.items ?? [];
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<PickedRef[]>([]);
  const [domain, setDomain] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [f, setF] = useState<Form>(INITIAL);
  const [cps, setCps] = useState<string[]>(['Flag']);
  const [asilReason, setAsilReason] = useState('');
  const [dupReason, setDupReason] = useState('');
  const [done, setDone] = useState<Created | null>(null);
  // 미리 채운 값과 그 값을 준 대표 행 — 대표를 바꾸면 사용자가 고치지 않은 칸만 새 기준값으로 바꾼다
  const [base, setBase] = useState<(Prefill & { refId: string }) | null>(null);
  // 자동 채움(20-60 §5.3) — 사람이 손대지 않은 제어점·범위·프로필만 대표 행이 바뀔 때 채운다
  const [cpsTouched, setCpsTouched] = useState(false);
  const [scopeTouched, setScopeTouched] = useState(false);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [appliedRef, setAppliedRef] = useState<string | null>(null);
  const stepHead = useRef<HTMLHeadingElement>(null);
  const dupHead = useRef<HTMLHeadingElement>(null);

  const primary = primaryOf(picked);
  const scope = { country: f.country.trim(), vehicleModel: f.vehicleModel.trim(), trim: f.trim.trim() };
  const af = useAutofill(primary, picked.map((p) => p.ref), f.name, scope);
  useEffect(() => {
    const r = af.data;
    if (!r || r.refId === appliedRef) return;
    setAppliedRef(r.refId);
    const plan = r.fields.find((x) => x.key === 'controlPoints')?.value;
    if (!cpsTouched && Array.isArray(plan) && plan.length) setCps(plan);
    // 지금 범위가 후보 밖이고 사람이 고치지 않았으면 첫 후보로
    const first = r.scopeCandidates[0];
    if (!scopeTouched && first && !r.scopeCandidates.some((s) => scopeKey(s) === scopeKey(scope))) setF((x) => ({ ...x, country: first.country, vehicleModel: first.vehicleModel, trim: first.trim }));
    // 담당 — 비어 있으면 같은 컴포넌트·도메인 Feature의 담당으로
    const owner = r.fields.find((x) => x.key === 'owner')?.value;
    if (typeof owner === 'string') setF((x) => (x.ownerId.trim() ? x : { ...x, ownerId: owner }));
    const { variationPoints: _vps, ...draft } = r.variability;
    setProfile(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [af.data]);
  const dirty = !done && !create.isSuccess && (picked.length > 0 || Object.entries(f).some(([k, v]) => v !== INITIAL[k as keyof Form]) || cps.join() !== 'Flag');
  // 입력이 있으면 떠나기 전에 묻는다 — 등록이 끝나면(상세로 이동) 묻지 않는다(출시 준비 RD-UX-02)
  useUnsavedGuard(dirty);

  // 단계를 바꾸면 그 단계 제목으로 초점을 옮긴다 — 화면 읽기 사용자가 새 단계를 듣는다
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    stepHead.current?.focus();
  }, [step]);

  const choose = (ref: RefLite, role: FeatureRefRole) => setPicked((xs) => choosePicked(xs, ref, role));
  const makePrimary = (refId: string) => setPicked((xs) => makePrimaryPicked(xs, refId));
  const remove = (refId: string) => setPicked((xs) => removePicked(xs, refId));

  const toStep2 = () => {
    if (!primary) return;
    if (base?.refId !== primary.refId) {
      const next = prefillOf(primary);
      // 처음이거나 사용자가 고치지 않은 칸(이전 기준값 그대로·빈 칸)만 새 기준값으로
      const keep = (k: keyof Prefill, cur: string) => (base && cur !== '' && cur !== base[k] ? cur : next[k]);
      setF((x) => ({ ...x, name: keep('name', x.name), description: keep('description', x.description), asil: base && x.asil !== base.asil ? x.asil : next.asil, tags: keep('tags', x.tags) }));
      setBase({ ...next, refId: primary.refId });
    }
    setStep(2);
  };

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    if (k === 'country' || k === 'vehicleModel' || k === 'trim') setScopeTouched(true);
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

  const submit = (confirmDuplicate = false) =>
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
            setStep(1);
          }
        },
        onSuccess: (r) => {
          // 서버 안내(요청 중·검토 필요·폐기 예정 행 연결 등)가 있으면 이 화면에서 먼저 보여 준다
          // 상세에서 '등록했습니다 — 다음 할 일'(정의 승인 필수 칸·구현 연결·G1~G3)을 보인다(P1-7)
          if (r.warnings?.length) setDone(r);
          else nav(`/features/${r.featureId}/${r.version}`, { state: { registered: true } });
        },
      },
    );

  const why = whyDisabled(
    [!perm.ok, perm.hint],
    [!primary, P.nextWhy],
    [!f.name.trim() || !f.description.trim() || !f.ownerId.trim(), P.requiredWhy],
    [asilChanged && asilReason.trim().length < 2, P.asilReasonWhy],
    [profile?.catalogueRole === 'SUB' && !profile.parentRefId, PR.parentWhy],
  );

  // '작성자만' 안내는 실제로 역할이 다를 때만 — 공개 데모도 브라우저 안 시연 데이터로 등록한다(설계 20-60)
  const message = !canAct(perm.role, ['FEATURE_AUTHOR'])
    ? { tone: 'neutral' as const, text: P.key.cannot }
    : done
      ? { tone: 'warn' as const, text: P.key.done }
      : step === 1
        ? { tone: 'neutral' as const, text: primary ? P.key.picked(primary.refId, picked.length - 1) : P.key.pick }
        : { tone: 'neutral' as const, text: P.key.can };

  const text = (k: keyof Form, label: string, hint?: ReactNode, mono = true) => (
    <Field label={label} error={fe[k]} hint={hint}>
      <input className={`ds-input${mono ? ' ds-input--mono' : ''}`} name={k} value={f[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <div className="ds-screen">
      <PageHeader codes="D01-01 · PROPOSED 0.1.0 · 30-95 §6" title={P.title} lead={P.lead} message={message} />
      {/* 등록 진행 단계 — 마법사 두 단계 뒤로 제출·검토·정의 승인이 이어진다(20-60 §6) */}
      <RegistrationSteps current={done || create.isSuccess ? 2 : step - 1} />
      <Panel id="propose-form" tour="feature-form">
        <h2 ref={stepHead} tabIndex={-1} style={{ marginTop: 0 }}>
          {step === 1 ? P.steps.pick : P.steps.confirm}
        </h2>
        {notice && (
          <p className="ds-field__hint" role="status" data-testid="ref-request-notice">
            {notice}
          </p>
        )}
        {done ? (
          <section aria-labelledby="propose-warnings-h" data-testid="propose-warnings">
            <h3 id="propose-warnings-h">{P.warningsTitle}</h3>
            <RefWarningItems warnings={done.warnings ?? []} />
            <Button variant="primary" onClick={() => nav(`/features/${done.featureId}/${done.version}`, { state: { registered: true } })}>
              {P.openDetail}
            </Button>
          </section>
        ) : step === 1 ? (
          <>
            <IntentSuggest pickedIds={new Set(picked.map((p) => p.ref.refId))} onPick={(ref) => choose(ref, 'PRIMARY')} />
            <RefPicker picked={picked} onChoose={choose} onRemove={remove} onMakePrimary={makePrimary} onRequest={() => setRequesting(true)} onNext={toStep2} nodes={nodes} domain={domain} setDomain={setDomain} />
          </>
        ) : (
          <>
            {/* 2단계 칸 묶음 — 미리 채운 칸은 처음 열 때 잠깐 강조한다(data-prefilled, 움직임 줄이기면 강조 없이) */}
            {af.data && profile ? (
              <AutofillPanel
                result={af.data}
                form={{ name: f.name, description: f.description, asil: f.asil, tags: f.tags, owner: f.ownerId }}
                cps={cps}
                scope={scope}
                onScope={(s) => {
                  setScopeTouched(true);
                  setF((x) => ({ ...x, ...s }));
                }}
                profile={profile}
                onProfile={setProfile}
              />
            ) : (
              af.pending && <p className="ds-field__hint" role="status">{AF.loading}</p>
            )}
            <p className="ds-field__hint" style={{ margin: 0 }}>{W.required.legend}</p>
            <div className="ds-split ds-prefill" data-prefilled={base?.refId}>
              <div className="ds-stack">
                <Field label={P.name} error={fe.name} hint={mark('name')}>
                  <input className="ds-input" name="name" value={f.name} onChange={set('name')} />
                </Field>
                <Field label={P.description} error={fe.description} hint={mark('description')}>
                  <textarea className="ds-input" name="description" value={f.description} onChange={set('description')} rows={4} />
                </Field>
                {/* 정의 승인 필수(PROPOSED → APPROVED 필수 입력) — 등록은 되지만 비어 있으면 승인이 막힌다(P1-7) */}
                <Field label={<>{P.requirements} <span className="ds-tag" data-required-for="approval">{W.required.tag}</span></>} error={fe.requirementIds} hint={W.required.reqHint}>
                  <input className="ds-input ds-input--mono" name="requirementIds" value={f.requirementIds} onChange={set('requirementIds')} />
                </Field>
                {text('tags', P.tags, mark('tags'), false)}
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
              </div>
              <div className="ds-stack">
                {text('country', P.country)}
                {text('vehicleModel', P.vehicleModel)}
                {text('trim', P.trim)}
                <Field label={P.owner} error={fe.ownerId}>
                  <input className="ds-input" name="ownerId" value={f.ownerId} onChange={set('ownerId')} />
                </Field>
                <Field
                  label={P.asil}
                  error={fe.asil}
                  hint={
                    base ? (
                      <span className="ds-tag ds-ref-mark" data-ref-mark={asilChanged ? 'edited' : 'base'}>
                        {asilChanged ? `${P.markEdited} · ${P.asilBase(base.asil)}` : `${P.markBase} · ${P.asilBase(base.asil)}`}
                      </span>
                    ) : undefined
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
                {text('upgVc', P.upgVc)}
                <fieldset className="ds-choices" aria-label={P.cps}>
                  <legend className="ds-field__label">{P.cps}</legend>
                  {['Flag', 'Parameter', 'Signal', 'DTC'].map((c) => (
                    <label key={c}>
                      <input type="checkbox" checked={cps.includes(c)} onChange={() => { setCpsTouched(true); setCps((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c])); }} />
                      {c}
                    </label>
                  ))}
                </fieldset>
              </div>
            </div>

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
              <Button onClick={() => setStep(1)}>{P.changeRefs}</Button>
              <Button variant="primary" data-ui="createFeature" disabled={!!why || create.isPending} reason={why} title={perm.hint} onClick={() => submit(false)}>
                {P.submit}
              </Button>
            </div>
          </>
        )}
      </Panel>
      {requesting && (
        <RefRequestDrawer
          open={requesting}
          nodes={nodes}
          initialDomain={domain}
          onClose={() => setRequesting(false)}
          onCreated={(ref) => {
            setRequesting(false);
            choose(ref, 'PRIMARY');
            setNotice(P.request.notice(ref.refId));
          }}
        />
      )}
    </div>
  );
}

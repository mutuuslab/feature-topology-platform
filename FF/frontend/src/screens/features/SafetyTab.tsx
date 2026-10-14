// Feature 상세 › 안전 분류 탭 (D01-01, 보고서 v1.1 5장) — 판정 흐름으로 제안 → 초안 수정(조합 검사 실시간) → 비활성화 효과 미리보기 → Safety Manager 개인 서명 확정.
// 조합 검사·제안·미리보기는 contracts 순수 함수(checkProfile·proposeClass·deactStages)라 서버 판정과 같다.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ASIL_EXCEPTION_LABEL, checkProfile, DEACT_CLASSES, deactStages, F_CLASSES, FLAG_TYPES, proposeClass, REG_CLASSES, type AsilInheritance, type ClassFinding, type ClassifyAnswers, type SafetyProfile } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, ClassBadges, Drawer, ErrorNote, Explain, Field, Icon, KeyValue, Panel, RuleChecklist, Select, StageStrip, StatusGlyph, WindowGauge } from '../../design';
import { usePermission, when } from '../shared';

const S = ko.safetyTab;
const EDIT_ROLES = ['FEATURE_AUTHOR', 'SAFETY_OFFICER'] as const;
const CONFIRM_ROLES = ['SAFETY_OFFICER'] as const;
const INVALIDATE = ['safetyProfile', 'safetyProfiles', 'featureDetail', 'audit'];

interface View {
  profile: SafetyProfile;
  findings: ClassFinding[];
  asil?: AsilInheritance;
}

/** 안전 관련 Flag의 ASIL 상속과 예외 다섯 조건 — 서버 판정(contracts asilInheritance) 그대로 */
function AsilPanel({ a }: { a: AsilInheritance }) {
  return (
    <Panel title={S.asil} id="safety-asil">
      <div data-testid="asil-inheritance" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <p className="ds-field__hint" style={{ margin: 0, color: a.blocker ? 'var(--danger)' : undefined }}>
          {!a.safetyRelated ? S.asilNotSafety : a.exception ? S.asilException : S.asilInherits(a.inherits)}
          {a.blocker ? ` — ${a.blocker}` : ''}
        </p>
        {a.safetyRelated && (
          <RuleChecklist
            caption={S.asilConditions}
            items={a.conditions.map((c) => ({ id: c.id, status: c.met && c.evidence ? ('pass' as const) : ('fail' as const), title: ASIL_EXCEPTION_LABEL[c.id], reason: c.evidence ?? '—' }))}
          />
        )}
      </div>
    </Panel>
  );
}

const TIME_KEYS = ['takeoverMs', 'rampMs', 'faultRampMs', 'faultTolerantTimeMs', 'maxPendingMs', 'maxCycleWaitMs'] as const;
type Editable = Pick<
  SafetyProfile,
  'fClass' | 'deactClass' | 'regClass' | 'flagType' | (typeof TIME_KEYS)[number] | 'safeState' | 'markets' | 'expiresAt' | 'retirementPlan' | 'adsFeature' | 'adsfType' | 'gsrMandatory'
>;
const EDITABLE: (keyof Editable)[] = ['fClass', 'deactClass', 'regClass', 'flagType', ...TIME_KEYS, 'safeState', 'markets', 'expiresAt', 'retirementPlan', 'adsFeature', 'adsfType', 'gsrMandatory'];

/** 상세 머리말 배지 — 안전 분류 네 축 */
export function SafetyBadges({ id, ver }: { id: string; ver: string }) {
  const q = useApi<View>('safetyProfile', { params: { id, ver } });
  const p = q.data?.profile;
  if (!p) return null;
  return (
    <span className="ds-cls-row" data-tour="feature-classes" title={`${S.status[p.status]} · ${S.source[p.source]}`}>
      <ClassBadges f={p.fClass} dc={p.deactClass} r={p.regClass} type={p.flagType} short />
      {p.status === 'DRAFT' && <span className="ds-tag">{S.status.DRAFT}</span>}
    </span>
  );
}

function Wizard({ asil, onApply, disabled }: { asil: SafetyProfile['asilRef']; onApply: (c: ReturnType<typeof proposeClass>) => void; disabled: boolean }) {
  const [a, setA] = useState<ClassifyAnswers>({ mandatory: false, safetyRelevant: asil !== 'QM', asil, changesActiveControl: false, typeApproval: false, ads: false });
  const prop = proposeClass(a);
  const box = (k: Exclude<keyof ClassifyAnswers, 'asil'>) => (
    <label key={k} className="ds-field ds-field--inline">
      <input type="checkbox" checked={a[k]} disabled={disabled} onChange={(e) => setA({ ...a, [k]: e.target.checked })} />
      <span className="ds-field__label">{S.q[k]}</span>
    </label>
  );
  return (
    <details className="ds-wizard">
      <summary>{S.wizard}</summary>
      <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
        {box('mandatory')}
        {box('safetyRelevant')}
        <Select label={S.q.asil} value={a.asil} disabled={disabled} onChange={(e) => setA({ ...a, asil: e.target.value as ClassifyAnswers['asil'] })}>
          {(['QM', 'A', 'B', 'C', 'D'] as const).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
        {box('changesActiveControl')}
        {box('typeApproval')}
        {box('ads')}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="ds-eyebrow ds-eyebrow--ko">{S.propose}</span>
          <ClassBadges f={prop.fClass} dc={prop.deactClass} r={prop.regClass} short />
          <Button disabled={disabled} onClick={() => onApply(prop)}>
            {S.apply}
          </Button>
        </div>
      </div>
    </details>
  );
}

interface GateSnapshot {
  feature: { status: string; markets_approved: string[]; max_vehicles: number; max_per_window: number };
  ledger: { last_order_seq?: number; last_kill_approvers?: string[] };
  nextSeq: number;
  window: { hours: number; deactivate: number; cap: number };
}

/** 정책 게이트 기준 (D03-02) — 이 분류·Registry 값이 Kill·복원 명령 판정에서 어떻게 쓰이는지 */
function GatePanel({ id, ver }: { id: string; ver: string }) {
  const g = useApi<GateSnapshot>('gateSnapshot', { params: { id, ver } });
  const s = g.data;
  return (
    <Panel
      title={
        <>
          {S.gate} <Explain rules={['FFG-PLT-002', 'FFG-PLT-017', 'FFG-SEC-003', 'FFG-PLT-005']} />
        </>
      }
      id="safety-gate"
      tour="safety-gate"
    >
      <AsyncView state={asyncState(g)} error={g.error?.message} onRetry={() => g.refetch()}>
        {s && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <p className="ds-field__hint" style={{ margin: 0 }}>
              {S.gateLead}
            </p>
            <KeyValue
              rows={[
                { k: S.gateStatus, v: S.gateStatusKo[s.feature.status] ?? S.gateNotTarget(s.feature.status) },
                { k: S.gateMarkets, v: <span className="ds-mono">{s.feature.markets_approved.join(' · ') || '—'}</span> },
                { k: S.gateCap, v: S.gateCapValue(s.feature.max_vehicles, s.feature.max_per_window) },
                { k: S.gateNextSeq, v: <span className="ds-mono">{s.nextSeq}</span> },
                {
                  k: S.gateApprovers,
                  v: <span className="ds-mono">{s.ledger.last_kill_approvers?.join(', ') || S.gateNoKill}</span>,
                  note: s.ledger.last_kill_approvers?.length ? S.gateApproversNote : undefined,
                },
              ]}
            />
            <WindowGauge used={s.window.deactivate} adding={0} cap={s.window.cap} />
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}

export function SafetyTab({ id, ver }: { id: string; ver: string }) {
  const q = useApi<View>('safetyProfile', { params: { id, ver } });
  const save = useApiMutation<View>('updateSafetyProfile', INVALIDATE);
  const confirm = useApiMutation<View>('confirmSafetyProfile', INVALIDATE);
  const edit = usePermission([...EDIT_ROLES]);
  const sign = usePermission([...CONFIRM_ROLES]);
  const p = q.data?.profile;
  const [draft, setDraft] = useState<Editable | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (p) setDraft(Object.fromEntries(EDITABLE.map((k) => [k, p[k]])) as Editable);
  }, [p]);
  const merged = useMemo(() => (p && draft ? ({ ...p, ...draft } as SafetyProfile) : null), [p, draft]);
  const findings = merged ? checkProfile(merged) : [];
  const stageParams = merged ? { takeover_ms: merged.takeoverMs, ramp_ms: merged.rampMs, max_pending_ms: merged.maxPendingMs, max_cycle_wait_ms: merged.maxCycleWaitMs } : {};
  const blockers = findings.filter((f) => f.severity === 'block');
  const dirty = !!p && !!draft && EDITABLE.some((k) => JSON.stringify(p[k]) !== JSON.stringify(draft[k]));
  const locked = p?.status === 'CONFIRMED';
  const ro = locked || !edit.ok;
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const patch = () => (p && draft ? Object.fromEntries(EDITABLE.filter((k) => JSON.stringify(p[k]) !== JSON.stringify(draft[k])).map((k) => [k, draft[k]])) : {});

  return (
    <AsyncView state={asyncState(q)} error={q.error?.message} onRetry={() => q.refetch()}>
      {p && draft && merged && (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <div className="ds-split">
            <Panel
              title={
                <>
                  {S.title} <Explain rules={['FFG-CLS-001', 'FFG-CLS-004', 'FFG-CLS-009']} />
                </>
              }
              eyebrow="FFP-FS-STR-001 v1.1 · §5"
              id="safety-profile"
              tour="safety-tab"
              actions={<ClassBadges f={merged.fClass} dc={merged.deactClass} r={merged.regClass} type={merged.flagType} short />}
            >
              <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                <p className="ds-field__hint" style={{ margin: 0 }}>
                  {S.lead}
                </p>
                <div className="ds-cls-row">
                  <span className="ds-tag">{S.status[p.status]}</span>
                  <span className="ds-tag">{S.source[p.source]}</span>
                </div>
                {locked && (
                  <p className="ds-locked" role="status">
                    <Icon name="lock" size={14} aria-hidden="true" /> {S.locked}
                  </p>
                )}
                {!ro && <Wizard asil={p.asilRef} disabled={ro} onApply={(c) => setDraft((d) => (d ? { ...d, ...c } : d))} />}

                <fieldset className="ds-fieldset" disabled={ro}>
                  <legend className="ds-eyebrow ds-eyebrow--ko">{S.classes}</legend>
                  <div className="ds-form-grid">
                    <Select label={S.f.fClass} value={draft.fClass} onChange={(e) => set('fClass', e.target.value as Editable['fClass'])}>
                      {F_CLASSES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </Select>
                    <Select label={S.f.deactClass} value={draft.deactClass} onChange={(e) => set('deactClass', e.target.value as Editable['deactClass'])}>
                      {DEACT_CLASSES.map((x) => (
                        <option key={x} value={x}>
                          {x} · {ko.safety.dcShort[x]}
                        </option>
                      ))}
                    </Select>
                    <Select label={S.f.regClass} value={draft.regClass} onChange={(e) => set('regClass', e.target.value as Editable['regClass'])}>
                      {REG_CLASSES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </Select>
                    <Select label={S.f.flagType} value={draft.flagType} onChange={(e) => set('flagType', e.target.value as Editable['flagType'])}>
                      {FLAG_TYPES.map((x) => (
                        <option key={x} value={x}>
                          {ko.safety.typeShort[x]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </fieldset>

                <fieldset className="ds-fieldset" disabled={ro}>
                  <legend className="ds-eyebrow ds-eyebrow--ko">{S.times}</legend>
                  <div className="ds-form-grid">
                    {TIME_KEYS.map((k) => (
                      <Field key={k} label={S.f[k]} hint={draft[k] > 0 ? S.seconds(draft[k]) : undefined}>
                        <input className="ds-input ds-input--mono" type="number" min={0} step={100} value={draft[k]} onChange={(e) => set(k, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                      </Field>
                    ))}
                  </div>
                </fieldset>

                <details className="ds-wizard">
                  <summary>{S.more}</summary>
                  <fieldset className="ds-fieldset" disabled={ro} style={{ marginTop: 'var(--sp-2)' }}>
                    <div className="ds-form-grid">
                      <Field label={S.f.safeState}>
                        <input className="ds-input" value={draft.safeState ?? ''} onChange={(e) => set('safeState', e.target.value.trim() || null)} />
                      </Field>
                      <Field label={S.f.markets}>
                        <input
                          className="ds-input ds-input--mono"
                          value={draft.markets.join(', ')}
                          onChange={(e) =>
                            set(
                              'markets',
                              e.target.value
                                .split(',')
                                .map((x) => x.trim().toUpperCase())
                                .filter(Boolean),
                            )
                          }
                        />
                      </Field>
                      <Field label={S.f.expiresAt}>
                        <input className="ds-input" type="date" value={draft.expiresAt ?? ''} onChange={(e) => set('expiresAt', e.target.value || null)} />
                      </Field>
                      <Field label={S.f.retirementPlan}>
                        <input className="ds-input" value={draft.retirementPlan ?? ''} onChange={(e) => set('retirementPlan', e.target.value.trim() || null)} />
                      </Field>
                      <label className="ds-field ds-field--inline">
                        <input type="checkbox" checked={draft.gsrMandatory} onChange={(e) => set('gsrMandatory', e.target.checked)} />
                        <span className="ds-field__label">{S.f.gsrMandatory}</span>
                      </label>
                      <label className="ds-field ds-field--inline">
                        <input type="checkbox" checked={draft.adsFeature} onChange={(e) => set('adsFeature', e.target.checked)} />
                        <span className="ds-field__label">{S.f.adsFeature}</span>
                      </label>
                      {draft.adsFeature && (
                        <Select label={S.f.adsfType} value={draft.adsfType ?? ''} onChange={(e) => set('adsfType', (e.target.value || null) as Editable['adsfType'])}>
                          <option value="">—</option>
                          <option value="ADSF-1">ADSF-1</option>
                          <option value="ADSF-2">ADSF-2</option>
                        </Select>
                      )}
                    </div>
                  </fieldset>
                </details>

                <ErrorNote error={save.error ?? confirm.error} />
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {!locked && (
                    <Button disabled={!edit.ok || !dirty || save.isPending} title={edit.hint} onClick={() => save.mutate({ params: { id, ver }, body: patch() })}>
                      {S.save}
                    </Button>
                  )}
                  {!locked && (
                    <Button
                      variant="primary"
                      icon="pen"
                      disabled={!sign.ok || dirty || blockers.length > 0}
                      title={sign.hint ?? (dirty ? S.dirty : blockers.length ? S.confirmBlocked : undefined)}
                      onClick={() => setOpen(true)}
                      data-tour="safety-confirm"
                    >
                      {S.confirm}
                    </Button>
                  )}
                  {!locked && blockers.length > 0 && (
                    <span className="ds-field__hint" style={{ color: 'var(--danger)' }}>
                      {S.confirmBlocked}
                    </span>
                  )}
                  {dirty && <span className="ds-field__hint">{S.dirty}</span>}
                </div>
              </div>
            </Panel>

            <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
              <Panel title={S.findings} id="safety-findings">
                {findings.length ? (
                  <RuleChecklist
                    live
                    caption={S.findingsList}
                    items={findings.map((f) => ({ id: f.rule, status: f.severity === 'block' ? ('fail' as const) : ('pending' as const), reason: f.message }))}
                  />
                ) : (
                  <p className="ds-field__hint" role="status" style={{ margin: 0, color: 'var(--ok)' } as CSSProperties}>
                    <StatusGlyph kind="PASS" /> {S.noFindings}
                  </p>
                )}
              </Panel>
              {q.data?.asil && <AsilPanel a={q.data.asil} />}
              <GatePanel id={id} ver={ver} />
              {locked && (
                <Panel title={S.confirmedBy} id="safety-confirmed">
                  <KeyValue
                    rows={[
                      { k: S.confirmer, v: <span className="ds-mono">{p.confirmedBy ?? '—'}</span>, note: p.confirmedAt ? when(p.confirmedAt) : undefined },
                      { k: S.signature, v: p.confirmSig ? <span className="ds-mono">{`${p.confirmSig.slice(0, 16)}…`}</span> : S.unsigned },
                    ]}
                  />
                </Panel>
              )}
            </div>
          </div>

          <Panel title={S.preview} id="safety-preview">
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <div>
                <span className="ds-eyebrow ds-eyebrow--ko">{S.previewSafety}</span>
                <StageStrip caption={S.previewSafety} stages={deactStages(merged.deactClass, 'SAFETY')} current={0} params={stageParams} />
              </div>
              <div>
                <span className="ds-eyebrow ds-eyebrow--ko">{S.previewCommercial}</span>
                <StageStrip caption={S.previewCommercial} stages={deactStages(merged.deactClass, 'COMMERCIAL')} current={0} params={stageParams} />
              </div>
            </div>
          </Panel>

          <Drawer open={open} title={S.confirmTitle} onClose={() => setOpen(false)}>
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <p style={{ margin: 0 }}>{S.confirmBody}</p>
              <ClassBadges f={merged.fClass} dc={merged.deactClass} r={merged.regClass} type={merged.flagType} />
              <Field label={ko.page.reason}>
                <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
              </Field>
              <ErrorNote error={confirm.error} />
              <Button
                variant="primary"
                icon="pen"
                disabled={!sign.ok || reason.trim().length < 2 || confirm.isPending}
                onClick={() => confirm.mutate({ params: { id, ver }, body: { reason } }, { onSuccess: () => (setOpen(false), setReason('')) })}
              >
                {S.confirm}
              </Button>
            </div>
          </Drawer>
        </div>
      )}
    </AsyncView>
  );
}

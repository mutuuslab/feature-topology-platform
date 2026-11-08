import { procedureGateCaption as procedureGateText } from '../../data/contractCaptions';
import { contractCaptions } from '../../copy/contract-captions';
import { useUiLocale } from '../../locale/react';
// Feature 상세 › Gate 탭(D01-02) — G1~G9 판정·이력. 담당자 웨이브 W3:
//  · 단계 밖 Gate·앞 단계 미통과는 제출 전에 막고 사유를 보인다(contracts gateStageBlocker — 서버와 같은 판정, P3-10)
//  · G2·G7 PASS의 분석 근거 조건(HARA·TARA·ASIL 사유 검토·SM·CSM 서명)을 판정 전에 보인다(gateEvidenceBlockers, P3-1·3)
//  · 절차 Gate ↔ 플랫폼 Gate 대응(P3-9), Evidence 칸은 원장 딥링크(P3-4)
//  · 판정 입력은 Gate마다 따로 — 앞 Gate 저장이 다음 Gate에 쓰던 입력을 지우지 않는다(P3-10). 오류 상자에 내부 코드를 붙이지 않는다
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { gateEvidenceBlockers, gateEvidenceInputOf, gateStageBlocker, procedureGatesFor, ROUTES, type AnalysisView, type Asil, type GateId, type GateResult, type Lifecycle } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { analysis as A } from '../../copy/analysis';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, ErrorNote, Field, GateBadge, GateRail, Icon, Panel, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { analysisViewOf, AsilDeviationBlock } from './AnalysisPanel';
import { GateChecks, GateNaSection, GoNoGoBar, type GateOutcomeView } from './GateOutcomePanel';
import { lcGate } from '../../copy/lifecycle-gate';
import type { GateView } from '../types';
import { useWpGateCheck } from './AlmPanels';

const T = ko.detail;
const INVALIDATE = ['featureDetail', 'listFeatures', 'gates', 'audit', 'baselineRequests', 'baselineChecklist', 'baselines', 'analysisEvidence', 'evidenceLedger'];
const JUDGE_ROLES = ROUTES.find((r) => r.name === 'judgeGate')!.roles!;

interface Form {
  inputResult: GateResult;
  rationale: string;
  evidenceRef: string;
  asilReviewed: boolean;
}
const EMPTY: Form = { inputResult: 'PASS', rationale: '', evidenceRef: '', asilReviewed: false };

/** Evidence 원장 딥링크 — Gate 이력의 Evidence 칸 */
export const evidenceHref = (ref: string, featureId: string) => `/verify/evidence?ref=${encodeURIComponent(ref)}&feature=${encodeURIComponent(featureId)}`;

export function GatesTab({ id, ver }: { id: string; ver: string }) {
  useUiLocale();
  const q = useApi<GateView & GateOutcomeView & { lifecycle?: Lifecycle }>('gates', { params: { id, ver } });
  const an = useApi<AnalysisView>('analysisEvidence', { params: { id, ver } });
  const [selected, setSelected] = useState<GateId>('G1');
  const perm = usePermission(JUDGE_ROLES);
  const judge = useApiMutation('judgeGate', INVALIDATE);
  // Gate마다 입력을 따로 둔다 — 저장 응답이 늦게 와도 다른 Gate의 입력을 지우지 않는다
  const [forms, setForms] = useState<Partial<Record<GateId, Form>>>({});
  const form = forms[selected] ?? EMPTY;
  const setForm = (patch: Partial<Form>) => setForms((f) => ({ ...f, [selected]: { ...(f[selected] ?? EMPTY), ...patch } }));
  // 저장 결과·오류는 그 판정을 보낸 Gate에서만 보인다(다른 Gate로 옮겨도 늦은 응답의 입력 비우기는 보낸 Gate에만)
  const sentGate = (judge.variables as { body?: { gate?: GateId } } | undefined)?.body?.gate;
  const mine = sentGate === selected;
  const g = q.data?.gates.find((x) => x.gate === selected);
  const statuses = Object.fromEntries((q.data?.gates ?? []).map((x) => [x.gate, x.status === '미판정' ? null : x.status]));
  // G2·G7 PASS는 분석 조회가 준비된 뒤에만 — 실패·로딩·계약 밖 응답을 '필요한 근거 없음'으로 취급하지 않는다.
  const av = analysisViewOf(an.data);
  const analysisUnavailable = form.inputResult === 'PASS' && (selected === 'G2' || selected === 'G7') && (an.isFetching || an.isError || !av);
  const analysisReason = an.isPending || an.isFetching ? A.gate.loadingAnalysis : A.gate.unavailableAnalysis;
  const lifecycle = q.data?.lifecycle ?? av?.lifecycle;
  const actorRole = actorFor(perm.role, JUDGE_ROLES).role;
  const stage = lifecycle ? gateStageBlocker({ lifecycle, gate: selected, role: actorRole, latest: statuses }) : null;
  const needs = av ? gateEvidenceBlockers(gateEvidenceInputOf(av, selected, form.inputResult, form.asilReviewed)) : [];
  const procedure = procedureGatesFor(selected);
  const short = form.rationale.trim().length < 2;
  // 판정마다 근거 1건 이상(FR-REG-005-011) — PASS만이 아니다
  const noEvidence = !form.evidenceRef.trim();
  const wpg = useWpGateCheck(id, ver, selected, form.inputResult);
  const blocked = whyDisabled([!perm.ok, perm.hint], [stage, stage?.reason], [analysisUnavailable, analysisReason], [needs.length > 0, A.gate.needs], [!!wpg.blocked, wpg.blocked], [noEvidence, T.evidenceHint], [short, ko.why.reason]);
  const submitted = selected;
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {!!q.data?.rehara?.length && (
          <section aria-label={T.rehara} data-testid="rehara">
            {q.data.rehara.some((x) => x.status === 'OPEN') && <p className="ds-field__hint" style={{ color: 'var(--danger)' }}>{T.reharaOpen(q.data.rehara.filter((x) => x.status === 'OPEN').length)}</p>}
            <ul className="ds-check">
              {q.data.rehara.map((x) => (
                <li key={x.requestId} data-state={x.status === 'OPEN' ? 'FAIL' : 'PASS'}>
                  <Icon name={x.status === 'OPEN' ? 'alert' : 'check'} size={16} />
                  <span>
                    <span className="ds-mono">{x.requestId}</span> {T.reharaCondition[x.condition] ?? x.condition}
                    <span className="ds-check__detail">{`${x.detail}${x.resolvedBy ? ` · ${T.reharaResolved(x.resolvedBy)}` : ''}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <GoNoGoBar v={q.data?.goNoGo} />
        <GateRail statuses={statuses} onSelect={setSelected} tours={{ G5: 'gate-g5' }} />
        {g && (
          <div className="ds-split">
            <Panel title={`${g.gate} ${g.name}`} eyebrow={`${g.stage} · ${contractCaptions.gateJudge[g.gate as GateId] ?? g.judgeRole}`} id="gate-hist" actions={<GateBadge status={g.status === '미판정' ? null : g.status} />}>
              <p className="ds-field__hint" data-testid="procedure-gate" style={{ marginTop: 0 }}>
                {A.gate.procedure}: {procedure.length ? procedure.map((m) => procedureGateText(m.procedureGate)).join(' / ') : A.gate.procedureNone}
              </p>
              {g.decision && (
                <p className="ds-field__hint" data-testid="gate-decision" style={{ color: g.decision.state === 'MISSING' || g.decision.state === 'INVALID' ? 'var(--danger)' : undefined }}>
                  {`${T.decision}: ${T.decisionState[g.decision.state]} · ${T.decisionNote(g.decision.kid, g.decision.approver ? (g.decision.approver.id ?? g.decision.approver.role) : null)}`}
                  {g.decision.reason ? ` — ${g.decision.reason}` : ''}
                </p>
              )}
              <GateChecks checks={(q.data?.checks ?? []).filter((c) => c.gate === selected)} />
              <h3 className="ds-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>{T.history}</h3>
              <DataTable
                caption={T.history}
                rows={[...g.history].reverse()}
                rowKey={(r) => r.gateRecordId}
                columns={[
                  { key: 'id', header: 'Gate Record', cell: (r) => <span className="ds-mono">{r.gateRecordId}</span> },
                  { key: 'st', header: ko.audit.col.result, cell: (r) => <GateBadge status={r.status} /> },
                  { key: 'at', header: ko.audit.col.at, cell: (r) => <span className="ds-mono">{r.judgedAt.slice(0, 16).replace('T', ' ')}</span> },
                  {
                    key: 'ev',
                    header: T.evidence,
                    cell: (r) =>
                      r.evidenceRef ? (
                        <Link className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }} to={evidenceHref(r.evidenceRef, id)} title={A.gate.evidenceLink(r.evidenceRef)} data-testid={`evidence-link-${r.gateRecordId}`}>
                          {r.evidenceRef}
                        </Link>
                      ) : (
                        <span className="ds-mono">—</span>
                      ),
                  },
                  {
                    key: 'sig',
                    header: T.decision,
                    cell: (r) => (
                      <span data-testid={`decision-${r.gateRecordId}`} style={{ fontSize: 'var(--fs-xs)', color: r.decision === 'MISSING' || r.decision === 'INVALID' ? 'var(--danger)' : undefined }}>
                        {r.decision ? T.decisionState[r.decision] : '—'}
                      </span>
                    ),
                  },
                  { key: 'why', header: ko.page.reason, cell: (r) => r.rationale },
                ]}
              />
            </Panel>
            <Panel title={T.judge} id="judge">
              <form
                style={{ display: 'grid', gap: 'var(--sp-3)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (blocked) return;
                  judge.mutate(
                    {
                      params: { id, ver },
                      body: { gate: submitted, inputResult: form.inputResult, rationale: form.rationale, evidenceRef: form.evidenceRef || null, ...(submitted === 'G2' && av?.asilDeviation ? { asilReasonReviewed: form.asilReviewed } : {}) },
                    },
                    // 판정한 그 Gate의 입력만 비운다(이미 다른 Gate로 옮겨 쓰던 입력은 그대로)
                    { onSuccess: () => setForms((f) => ({ ...f, [submitted]: EMPTY })) },
                  );
                }}
              >
                {stage && (
                  <p className="ds-field__hint" role="status" data-testid="gate-stage-blocked" style={{ margin: 0, color: 'var(--danger)' }}>
                    {A.gate.stageBlocked} — {stage.reason}
                  </p>
                )}
                {analysisUnavailable && (
                  <div role="status" data-testid="analysis-unavailable">
                    <p className="ds-field__hint">{analysisReason}</p>
                    {!an.isPending && <Button type="button" disabled={an.isFetching} onClick={() => an.refetch()}>{A.gate.retryAnalysis}</Button>}
                  </div>
                )}
                {selected === 'G2' && av && (
                  <AsilDeviationBlock v={av}>
                    {av.asilDeviation && (
                      <label className="ds-field ds-field--inline">
                        <input type="checkbox" checked={form.asilReviewed} onChange={(e) => setForm({ asilReviewed: e.target.checked })} />
                        <span className="ds-field__label">{A.deviation.review}</span>
                        <span className="ds-field__hint">{A.deviation.reviewHint}</span>
                      </label>
                    )}
                  </AsilDeviationBlock>
                )}
                <Field label={T.judgeResult}>
                  <select className="ds-select" value={form.inputResult} onChange={(e) => setForm({ inputResult: e.target.value as GateResult })}>
                    <option value="PASS">PASS</option>
                    <option value="CONDITIONAL">CONDITIONAL</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </Field>
                <Field label={T.evidence} hint={lcGate.evidenceAll}>
                  <input className="ds-input ds-input--mono" value={form.evidenceRef} onChange={(e) => setForm({ evidenceRef: e.target.value })} />
                </Field>
                <Field label={ko.page.reason}>
                  <textarea className="ds-input" placeholder={ko.page.reasonPlaceholder} value={form.rationale} onChange={(e) => setForm({ rationale: e.target.value })} />
                </Field>
                {needs.length > 0 && (
                  <div role="status" data-testid="gate-needs">
                    <span className="ds-eyebrow ds-eyebrow--ko">{A.gate.needs}</span>
                    <ul className="ds-check">
                      {needs.map((n) => (
                        <li key={n} data-state="FAIL">
                          <Icon name="alert" size={16} />
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {wpg.node}
                <ErrorNote error={mine && judge.error ? { ...judge.error, message: judge.error.message, code: undefined } : null} />
                {mine && judge.isSuccess && <div className="ds-ok" role="status">{ko.page.saved}</div>}
                <Button type="submit" variant="primary" disabled={!!blocked || judge.isPending} reason={blocked}>
                  {selected} · {T.judge}
                </Button>
              </form>
            </Panel>
            {av && lifecycle && (
              <Panel title={lcGate.na.title} id="gate-na-panel">
                <GateNaSection id={id} ver={ver} gate={selected} asil={av.asil as Asil} requests={q.data?.naRequests ?? []} readOnly={lifecycle === 'RELEASED' || lifecycle === 'DEPRECATED' || lifecycle === 'RETIRED'} />
              </Panel>
            )}
          </div>
        )}
      </div>
    </AsyncView>
  );
}

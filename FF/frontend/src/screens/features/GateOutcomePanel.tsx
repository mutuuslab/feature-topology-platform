// Feature 상세 › Gate 탭 보강(P10) — 최종 Go/No-Go, 선택한 Gate의 자동 검사(전이 때 다시 본다), 해당 없음(N/A) 요청·승인.
// 규칙은 contracts(gate-outcome·gate-checks) — 서버 응답(goNoGo·checks·naRequests)을 그대로 보이고, N/A 불가 Gate는 같은 함수로 미리 막는다.
import { useState } from 'react';
import { useUiLocale } from '../../locale/react';
import { contractCaptions } from '../../copy/contract-captions';
import { GATE_NA_APPROVERS, GATE_NA_REQUESTERS, gateNaBlocker, type GateNaRequest, type GoNoGoResult } from '../../../../contracts/src/rules/gate-outcome';
import type { GateCheck } from '../../../../contracts/src/rules/gate-checks';
import type { Asil, GateId } from '@ff/contracts';
import { useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { lcGate as C } from '../../copy/lifecycle-gate';
import { ko } from '../../copy/ko';
import { Button, ErrorNote, Field, Icon, whyDisabled } from '../../design';
import { usePermission } from '../shared';

const INVALIDATE = ['featureDetail', 'listFeatures', 'gates', 'audit', 'workQueues'];

export interface GateOutcomeView {
  goNoGo?: GoNoGoResult;
  checks?: GateCheck[];
  naRequests?: GateNaRequest[];
}

/** 최종 Go/No-Go 한 줄 — Gate 레일 위 */
export function GoNoGoBar({ v }: { v?: GoNoGoResult }) {
  if (!v) return null;
  const tone = v.result === 'GO' ? 'var(--ok)' : v.result === 'NO_GO' ? 'var(--danger)' : 'var(--warn)';
  return (
    <p className="ds-field__hint" data-testid="go-no-go" data-result={v.result} style={{ margin: 0, display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
      <strong style={{ color: tone }}>{`${C.goNoGo.title}: ${C.goNoGo[v.result]}`}</strong>
      <span>{C.goNoGo.counts(v.passed.length, v.required.length, v.notApplicable.length)}</span>
      {v.failed.length > 0 && <span style={{ color: 'var(--danger)' }}>{C.goNoGo.failed(v.failed.join(', '))}</span>}
      {v.result === 'PENDING' && <span>{C.goNoGo.open(v.open.join(', '))}</span>}
    </p>
  );
}

/** 선택한 Gate의 자동 검사 목록 */
export function GateChecks({ checks }: { checks: GateCheck[] }) {
  const {language}=useUiLocale();
  if (!checks.length) return null;
  return (
    <section aria-label={C.checks.title} data-testid="gate-checks">
      <h3 className="ds-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>{C.checks.title}</h3>
      <ul className="ds-check">
        {checks.map((c) => (
          <li key={c.key} data-state={c.pass ? 'PASS' : 'FAIL'} data-check={c.key}>
            <Icon name={c.pass ? 'check' : 'close'} size={16} />
            <span>
              {language === 'en' ? contractCaptions.gateCheck[c.key] : c.label}
              <span className="ds-check__detail">{language === 'en' ? <>{c.pass ? C.checks.pass : C.checks.fail}<details><summary>{contractCaptions.sourceResponse}</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.detail}</p></details></> : c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="ds-field__hint" style={{ margin: 0 }}>{C.checks.hint}</p>
    </section>
  );
}

/** 해당 없음(N/A) — 요청 폼과 이 Gate의 요청·결정 */
export function GateNaSection({ id, ver, gate, asil, requests, readOnly }: { id: string; ver: string; gate: GateId; asil: Asil; requests: GateNaRequest[]; readOnly: boolean }) {
  const reqPerm = usePermission(GATE_NA_REQUESTERS);
  const decPerm = usePermission(GATE_NA_APPROVERS);
  const me = actorFor(decPerm.role, GATE_NA_APPROVERS).id;
  const request = useApiMutation('requestGateNa', INVALIDATE);
  const decide = useApiMutation('decideGateNa', INVALIDATE);
  const [reason, setReason] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const mine = requests.filter((r) => r.gate === gate);
  const pending = mine.find((r) => r.status === 'PENDING');
  const never = gateNaBlocker(gate, asil);
  const blocked = whyDisabled([readOnly, C.na.never], [!!never, never], [!reqPerm.ok, reqPerm.hint], [!!pending, C.na.pending], [reason.trim().length < 5, ko.why.reason]);
  return (
    <section aria-label={C.na.title} data-testid="gate-na" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <h3 className="ds-eyebrow" style={{ margin: 0 }}>{C.na.title}</h3>
      {mine.length > 0 && (
        <ul className="ds-check">
          {mine.map((r) => (
            <li key={r.requestId} data-state={r.status === 'APPROVED' ? 'PASS' : r.status === 'REJECTED' ? 'FAIL' : 'REVIEW'}>
              <Icon name={r.status === 'APPROVED' ? 'check' : r.status === 'REJECTED' ? 'close' : 'alert'} size={16} />
              <span>
                <span className="ds-mono">{r.requestId}</span> {C.na.status[r.status]} — {r.reason}
                <span className="ds-check__detail">{`${C.na.by(r.requestedBy, r.requestedAt.slice(0, 16).replace('T', ' '))}${r.decidedBy ? ` · ${C.na.decided(r.decidedBy)}${r.decisionReason ? ` (${r.decisionReason})` : ''}` : ''}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {pending && decPerm.ok && (
        <form
          data-testid="gate-na-decide"
          style={{ display: 'grid', gap: 'var(--sp-2)' }}
          onSubmit={(e) => e.preventDefault()}
        >
          <Field label={C.na.decisionReason}>
            <input className="ds-input" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} />
          </Field>
          <ErrorNote error={decide.error} />
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            {(['APPROVE', 'REJECT'] as const).map((d) => {
              const why = whyDisabled([pending.requestedBy === me, C.na.selfBlocked], [decisionReason.trim().length < 2, ko.why.reason]);
              return (
                <Button key={d} variant={d === 'APPROVE' ? 'primary' : 'default'} disabled={!!why || decide.isPending} reason={why ?? undefined} onClick={() => decide.mutate({ params: { rid: pending.requestId }, body: { decision: d, reason: decisionReason } }, { onSuccess: () => setDecisionReason('') })}>
                  {d === 'APPROVE' ? C.na.approve : C.na.reject}
                </Button>
              );
            })}
          </div>
        </form>
      )}
      {!pending && !readOnly && !never && (
        <form
          data-testid="gate-na-request"
          style={{ display: 'grid', gap: 'var(--sp-2)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked) return;
            request.mutate({ params: { id, ver }, body: { gate, reason } }, { onSuccess: () => setReason('') });
          }}
        >
          <p className="ds-field__hint" style={{ margin: 0 }}>{C.na.hint}</p>
          <Field label={C.na.reason}>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={request.error} />
          <Button type="submit" disabled={!!blocked || request.isPending} reason={blocked ?? undefined}>
            {C.na.request}
          </Button>
        </form>
      )}
      {never && <p className="ds-field__hint" style={{ margin: 0 }}>{never}</p>}
    </section>
  );
}

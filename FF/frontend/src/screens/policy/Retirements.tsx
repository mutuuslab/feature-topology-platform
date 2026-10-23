// /flag-retirements — Flag Retirement 6단계 (D01-01, 보고서 6.5 · FFG-LCY-011). 서버가 순서·완료 조건·직무 분리(요청자 승인 불가)를 다시 검사한다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RETIREMENT_STEPS, ROLE_LABEL, type Role } from '@ff/contracts';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, Select, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';

const T = ko.p11.retire;
const INVALIDATE = ['flagRetirements', 'audit', 'events'];

type StepKey = (typeof RETIREMENT_STEPS)[number]['key'];
interface Retirement {
  retirementId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: string;
  reason: string;
  nextReleaseAt: string | null;
  requestedBy: string;
  requestedAt: string;
  status: 'REQUESTED' | 'APPROVED' | 'RETIRED' | 'CLOSED';
  approvals: { by: string; role: string; at: string }[];
  approvedAt: string | null;
  steps: Partial<Record<StepKey, { at: string; by: string; data: any }>>;
  requiredApprovals: Role[];
  codeRemovalDue: string | null;
  overdue: boolean;
  next: StepKey | null;
}

const stepOf = (k: StepKey) => RETIREMENT_STEPS.find((s) => s.key === k)!;
const doneCount = (r: Retirement) => RETIREMENT_STEPS.filter((s) => r.steps[s.key] || (s.key === 'APPROVED' && r.approvedAt)).length;

export function RetirementsScreen() {
  const q = useApi<{ items: Retirement[] }>('flagRetirements');
  const [open, setOpen] = useState<string | null>(null);
  // 요청은 머리의 행동으로 여는 Drawer — 결과(목록)가 위, 입력은 Drawer(3초 규칙 9, UX3-12)
  const [requesting, setRequesting] = useState(false);
  const rows = q.data?.items ?? [];
  const C = T.col;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D01-01 · FFG-LCY-011"
        title={T.title}
        lead={T.lead}
        message={(() => {
          const overdue = rows.filter((r) => r.overdue).length;
          return !q.data ? { tone: 'neutral', value: '—', text: T.key.count } : overdue ? { tone: 'danger', value: overdue, text: T.key.overdue } : rows.length ? { tone: 'neutral', value: rows.length, text: T.key.count } : { tone: 'neutral', text: T.key.none };
        })()}
        actions={<Button onClick={() => setRequesting(true)}>{T.request}</Button>}
      />
      <Drawer open={requesting} title={T.request} onClose={() => setRequesting(false)}>
        <RequestForm onDone={() => setRequesting(false)} />
      </Drawer>
      <Panel title={T.list} id="retirements">
        <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: T.empty }} error={q.error?.message} onRetry={() => q.refetch()}>
          <DataTable
            caption={T.list}
            rows={rows}
            rowKey={(r) => r.retirementId}
            onOpen={(r) => setOpen(r.retirementId)}
            columns={[
              { key: 'id', header: C.id, cell: (r) => <span className="ds-mono">{r.retirementId}</span> },
              { key: 'f', header: C.flag, cell: (r) => <span className="ds-mono">{r.flagKey}</span> },
              { key: 'v', header: C.feature, cell: (r) => <Link className="ds-mono ds-nowrap" to={`/features/${r.featureId}/${r.featureVersion}`}>{`${r.featureId} ${r.featureVersion}`}</Link> },
              { key: 's', header: C.status, cell: (r) => T.status[r.status] },
              { key: 'p', header: C.progress, cell: (r) => <span className="ds-mono">{`${doneCount(r)}/6`}</span> },
              { key: 'n', header: C.next, cell: (r) => (r.next ? `${stepOf(r.next).step}. ${stepOf(r.next).done}` : '—') },
              {
                key: 'd',
                header: C.due,
                cell: (r) => (
                  <span className="ds-mono ds-nowrap" style={{ color: r.overdue ? 'var(--danger)' : undefined }} data-testid={`due-${r.retirementId}`}>
                    {r.codeRemovalDue ? when(r.codeRemovalDue) : '—'}
                    {r.overdue ? ` · ${T.overdue}` : ''}
                  </span>
                ),
              },
            ]}
          />
        </AsyncView>
      </Panel>
      <RetirementDrawer r={rows.find((x) => x.retirementId === open) ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const pols = useApi<{ items: { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string }[] }>('listPolicies');
  const perm = usePermission(['FEATURE_AUTHOR', 'RELEASE_MANAGER']);
  const create = useApiMutation<Retirement>('requestFlagRetirement', INVALIDATE);
  const [flagKey, setFlagKey] = useState('');
  const [reason, setReason] = useState('');
  const [nextRelease, setNextRelease] = useState('');
  const flags = [...new Set((pols.data?.items ?? []).map((p) => p.flagKey))].sort();
  return (
    <div className="ds-stack" id="retire-request" style={{ gap: 'var(--sp-3)' }}>
      <div className="ds-split">
        <Select label={T.flag} value={flagKey} onChange={(e) => setFlagKey(e.target.value)}>
          <option value="">—</option>
          {flags.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
        <Field label={T.nextRelease}>
          <input className="ds-input ds-input--mono" type="date" value={nextRelease} onChange={(e) => setNextRelease(e.target.value)} />
        </Field>
      </div>
      <Field label={T.reason}>
        <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={create.error} />
      <Button
        variant="primary"
        disabled={!perm.ok || !flagKey || reason.trim().length < 4 || create.isPending}
        title={perm.hint}
        onClick={() =>
          create.mutate(
            { body: { flagKey, reason: reason.trim(), nextReleaseAt: nextRelease ? new Date(`${nextRelease}T00:00:00+09:00`).toISOString() : null } },
            { onSuccess: () => (setFlagKey(''), setReason(''), setNextRelease(''), onDone()) },
          )
        }
      >
        {T.submit}
      </Button>
    </div>
  );
}

function RetirementDrawer({ r, onClose }: { r: Retirement | null; onClose: () => void }) {
  const approvePerm = usePermission(['FEATURE_APPROVER', 'SAFETY_OFFICER']);
  const approve = useApiMutation<Retirement>('approveFlagRetirement', INVALIDATE);
  return (
    <Drawer open={!!r} title={r?.retirementId ?? ''} onClose={onClose}>
      {r && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: T.col.flag, v: <span className="ds-mono">{r.flagKey}</span>, note: `${r.featureId} ${r.featureVersion} · ${r.fClass}` },
              { k: T.reason, v: r.reason, note: `${r.requestedBy} · ${when(r.requestedAt)}` },
              { k: T.col.due, v: <span style={{ color: r.overdue ? 'var(--danger)' : undefined }}>{r.codeRemovalDue ? when(r.codeRemovalDue) : '—'}</span> },
            ]}
          />
          <ol className="ds-stack" aria-label={T.list} style={{ paddingLeft: 'var(--sp-4)' }}>
            {RETIREMENT_STEPS.map((s) => {
              const rec = s.key === 'APPROVED' ? (r.approvedAt ? { at: r.approvedAt, by: r.approvals.map((a) => a.by).join(', ') } : null) : r.steps[s.key];
              return (
                <li key={s.key}>
                  <VerdictBadge value={rec ? 'PASS' : r.next === s.key || (s.key === 'APPROVED' && r.status === 'REQUESTED') ? 'CONDITIONAL' : 'UNJUDGED'} /> {T.stepTitle(s.step, s.label)}
                  {rec && <span className="ds-field__hint"> — {`${rec.by} · ${when(rec.at)}`}</span>}
                  {s.key === 'REMAINING_VEHICLES' && r.steps.REMAINING_VEHICLES && (
                    <span className="ds-field__hint"> · {T.remaining(r.steps.REMAINING_VEHICLES.data.onOldVersion.length, r.steps.REMAINING_VEHICLES.data.unreported.length)}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {r.status === 'REQUESTED' && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <p className="ds-field__hint">{T.needs(r.requiredApprovals.map((x) => `${ROLE_LABEL[x]}${r.approvals.some((a) => a.role === x) ? ' ✓' : ''}`).join(' · '))}</p>
              <ErrorNote error={approve.error} />
              <Button variant="primary" disabled={!approvePerm.ok || approve.isPending} title={approvePerm.hint} onClick={() => approve.mutate({ params: { id: r.retirementId }, body: {} })}>
                {T.approve}
              </Button>
            </div>
          )}
          {r.status !== 'REQUESTED' && r.next && <StepForm r={r} step={r.next} />}
        </div>
      )}
    </Drawer>
  );
}

function StepForm({ r, step }: { r: Retirement; step: StepKey }) {
  const perm = usePermission(['FEATURE_AUTHOR', 'RELEASE_MANAGER', 'IMPLEMENTER', 'REGULATORY_OWNER']);
  const rec = useApiMutation<Retirement>('recordFlagRetirementStep', INVALIDATE);
  const [f, setF] = useState({ swVersion: '', completionRate: '100', requiredRate: '95', evidenceRef: '', analysisRef: '', references: '0', markets: '', basis: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const input = (k: keyof typeof f, label: string, mono = true) => (
    <Field label={label}>
      <input className={`ds-input${mono ? ' ds-input--mono' : ''}`} value={f[k]} onChange={set(k)} />
    </Field>
  );
  const body =
    step === 'FINAL_STATE'
      ? { step, swVersion: f.swVersion.trim(), completionRate: Number(f.completionRate), requiredRate: Number(f.requiredRate), evidenceRef: f.evidenceRef.trim() }
      : step === 'CODE_REMOVED'
        ? { step, analysisRef: f.analysisRef.trim(), references: Number(f.references) }
        : step === 'RECORDS_RETAINED'
          ? { step, markets: f.markets.split(',').map((m) => m.trim()).filter(Boolean), basis: f.basis.trim() }
          : { step };
  const s = stepOf(step);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }} data-testid="retire-step">
      <h3 className="ds-eyebrow ds-eyebrow--ko">{`${T.record} · ${T.stepTitle(s.step, s.done)}`}</h3>
      {step === 'FINAL_STATE' && (
        <>
          {input('swVersion', T.swVersion)}
          <div className="ds-split">
            {input('completionRate', T.completionRate)}
            {input('requiredRate', T.requiredRate)}
          </div>
          {input('evidenceRef', T.evidenceRef)}
        </>
      )}
      {step === 'CODE_REMOVED' && (
        <>
          {input('analysisRef', T.analysisRef)}
          {input('references', T.references)}
        </>
      )}
      {step === 'RECORDS_RETAINED' && (
        <>
          {input('markets', T.markets)}
          {input('basis', T.basis, false)}
        </>
      )}
      <ErrorNote error={rec.error} />
      <Button variant="primary" disabled={!perm.ok || STATIC_MODE || rec.isPending} title={perm.hint} onClick={() => rec.mutate({ params: { id: r.retirementId }, body })}>
        {T.record}
      </Button>
    </div>
  );
}

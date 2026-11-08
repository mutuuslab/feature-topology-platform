// /verify/exceptions — 예외 승인(GX, FR-EXC-001·002·FR-REG-005-010). 임시 우회·Gate 예외 목록(적용 중·승인 대기·만료·반려), 상세(2인 승인·만료·원복 기록),
// 요청 폼(계약 스키마로 먼저 검사)과 승인·반려·회수. 예외는 판정을 바꾸지 않고 기록된 제한 범위만 연다 — 규칙은 서버(contracts rules/exception-policy)가 판정한다.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreateExceptionBody,
  EXCEPTION_APPROVER_ROLES,
  EXCEPTION_CHECKS,
  EXCEPTION_KIND_LABEL,
  EXCEPTION_KINDS,
  EXCEPTION_MAX_HOURS,
  EXCEPTION_REQUEST_ROLES,
  EXCEPTION_RESTRICTION_LABEL,
  EXCEPTION_RESTRICTIONS,
  EXCEPTION_STATUS_LABEL,
  GATES,
  type ExceptionKind,
  type ExceptionPolicy,
  type ExceptionRestriction,
  type ExceptionStatus,
} from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { actorFor } from '../../api/actor';
import { exceptions as X } from '../../copy/exceptions';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, Segmented, Select, SummaryLine, Toolbar, VerdictBadge } from '../../design';
import { usePermission, when } from '../shared';
import { personLabel } from '../ops/shared';

type Row = ExceptionPolicy & { kindLabel: string; statusLabel: string; restrictionLabel: string; capBasisPoints: number; active: boolean; remainingMs: number | null; scope: string };
type Detail = Row & { history: { at: string; kind: string; actorId: string; reason?: string; message?: string }[] };

const INVALIDATE = ['exceptionPolicies', 'exceptionPolicy', 'policyReleaseGate', 'policy', 'policies', 'events', 'audit'];
const STATUS_VERDICT: Record<ExceptionStatus, string> = { ACTIVE: 'CONDITIONAL', REQUESTED: 'UNJUDGED', APPROVING: 'UNJUDGED', REJECTED: 'FAIL', EXPIRED: 'PASS', REVOKED: 'PASS', COMPLETED: 'PASS' };
const CLOSED: ExceptionStatus[] = ['EXPIRED', 'REVOKED', 'COMPLETED'];
type Filter = 'all' | 'active' | 'waiting' | 'closed' | 'REJECTED';
const Badge = ({ s }: { s: ExceptionStatus }) => <VerdictBadge value={STATUS_VERDICT[s]} label={EXCEPTION_STATUS_LABEL[s]} />;

export function ExceptionsScreen() {
  const q = useApi<{ items: Row[]; active: number }>('exceptionPolicies');
  const [sp, setSp] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const perm = usePermission(EXCEPTION_REQUEST_ROLES);
  const all = q.data?.items ?? [];
  const waiting = all.filter((e) => e.status === 'REQUESTED' || e.status === 'APPROVING');
  const match = (e: Row) => filter === 'all' || (filter === 'active' ? e.active : filter === 'waiting' ? waiting.includes(e) : filter === 'closed' ? CLOSED.includes(e.status) : e.status === filter);
  const rows = all.filter(match);
  const selected = sp.get('id');
  const open = (id: string | null) =>
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('id', id);
        else n.delete('id');
        return n;
      },
      { replace: true },
    );
  const active = q.data?.active ?? 0;
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D03-02 · FR-EXC-001·002 · FR-REG-005-010 · FR-RDD-001-006"
        title={X.title}
        lead={X.lead}
        message={!q.data ? { tone: 'neutral', value: '—', text: X.key.active } : active ? { tone: 'warn', value: active, text: X.key.active } : waiting.length ? { tone: 'neutral', value: waiting.length, text: X.key.waiting } : { tone: 'neutral', text: X.key.none }}
        actions={
          <Button variant="primary" disabled={!perm.ok} reason={perm.hint} onClick={() => setCreating(true)}>
            {X.create}
          </Button>
        }
      />
      <SummaryLine
        items={[
          { k: X.kpi.active, v: active },
          { k: X.kpi.waiting, v: waiting.length },
          { k: X.kpi.closed, v: all.filter((e) => CLOSED.includes(e.status)).length },
          { k: X.kpi.rejected, v: all.filter((e) => e.status === 'REJECTED').length },
        ]}
      />
      <Toolbar label={X.filter}>
        <Segmented
          label={X.filter}
          options={[
            { value: 'all' as const, label: X.all, count: all.length },
            { value: 'active' as const, label: X.kpi.active, count: active },
            { value: 'waiting' as const, label: X.kpi.waiting, count: waiting.length },
            { value: 'closed' as const, label: X.kpi.closed },
            { value: 'REJECTED' as const, label: X.kpi.rejected },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
        />
      </Toolbar>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        <DataTable
          caption={X.table}
          rows={rows}
          rowKey={(e) => e.exceptionId}
          onOpen={(e) => open(e.exceptionId)}
          maxHeight="52vh"
          columns={[
            { key: 'id', header: X.col.id, cell: (e) => <span className="ds-mono ds-nowrap">{e.exceptionId}</span>, sort: (e) => e.exceptionId },
            { key: 'k', header: X.col.kind, cell: (e) => e.kindLabel, sort: (e) => e.kind },
            { key: 't', header: X.col.target, cell: (e) => <span className="ds-mono ds-nowrap">{`${e.featureId} ${e.featureVersion}${e.policyId ? ` · ${e.policyId}` : ''}`}</span>, sort: (e) => e.featureId },
            { key: 'sc', header: X.col.scope, cell: (e) => e.scope },
            { key: 'r', header: X.col.restriction, cell: (e) => `${e.restrictionLabel} · ${e.capBasisPoints / 100}%` },
            { key: 'a', header: X.col.approvals, cell: (e) => X.approvals(e.approvals.length) },
            { key: 's', header: X.col.status, cell: (e) => <Badge s={e.status} />, sort: (e) => e.status },
            { key: 'x', header: X.col.expires, cell: (e) => <span className="ds-nowrap">{e.expiresAt ? `${when(e.expiresAt)}${e.remainingMs ? ` · ${X.remaining(e.remainingMs)}` : ''}` : '—'}</span>, sort: (e) => e.expiresAt ?? '' },
          ]}
        />
      </AsyncView>
      <Panel title={X.rules.title}>
        <p className="ds-field__hint">{X.rules.note}</p>
        <DataTable
          caption={X.rules.title}
          rows={[...EXCEPTION_CHECKS]}
          rowKey={(c) => c.id}
          pageSize={0}
          columns={[
            { key: 'l', header: X.col.scope, cell: (c) => c.label },
            { key: 'b', header: X.col.status, cell: (c) => <VerdictBadge value={c.bypassable ? 'CONDITIONAL' : 'FAIL'} label={c.bypassable ? X.rules.open : X.rules.closed} /> },
            { key: 'n', header: X.detail.reason, cell: (c) => c.note },
          ]}
        />
      </Panel>
      {selected && <ExceptionDrawer id={selected} onClose={() => open(null)} />}
      <Drawer open={creating} title={X.create} onClose={() => setCreating(false)}>
        <RequestForm onDone={(id) => (setCreating(false), open(id))} />
      </Drawer>
    </div>
  );
}

/** 승인자 지정 만료 기본값 — 지금부터 24시간(로컬 시각 입력 칸 형식) */
const localInput = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function ExceptionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const D = X.detail;
  const q = useApi<Detail>('exceptionPolicy', { params: { id } });
  const approver = usePermission(EXCEPTION_APPROVER_ROLES);
  const revoker = usePermission([...EXCEPTION_REQUEST_ROLES, ...EXCEPTION_APPROVER_ROLES]);
  const me = actorFor(approver.role, EXCEPTION_APPROVER_ROLES).id;
  const decide = useApiMutation('decideExceptionPolicy', INVALIDATE);
  const revoke = useApiMutation('revokeExceptionPolicy', INVALIDATE);
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => localInput(Date.now() + 24 * 3_600_000));
  const e = q.data;
  const pending = e && (e.status === 'REQUESTED' || e.status === 'APPROVING');
  const decideWhy = !e ? null : e.requestedBy === me ? X.act.selfApproval : e.approvals.some((a) => a.by === me) ? X.act.sameApprover : null;
  return (
    <Drawer open title={D.title(id)} onClose={onClose}>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        {e && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <KeyValue
              rows={[
                { k: X.col.kind, v: e.kindLabel },
                { k: X.col.status, v: <Badge s={e.status} /> },
                { k: X.col.target, v: <span className="ds-mono">{`${e.featureId} ${e.featureVersion}`}</span> },
                ...(e.policyId ? [{ k: D.policy, v: <span className="ds-mono">{e.policyId}</span> }] : []),
                { k: X.col.scope, v: e.scope },
                { k: X.col.restriction, v: `${e.restrictionLabel} · ${e.capBasisPoints / 100}%` },
                { k: D.requester, v: `${personLabel(e.requestedBy)} · ${when(e.requestedAt)}` },
                { k: D.reason, v: e.reason },
                { k: D.period, v: D.periodValue(e.periodHours) },
                ...(e.dueDate ? [{ k: D.due, v: e.dueDate }] : []),
                ...(e.residualRisk ? [{ k: D.risk, v: e.residualRisk }] : []),
                { k: D.approvals, v: e.approvals.length ? e.approvals.map((a) => `${personLabel(a.by)} · ${when(a.at)} · ${D.expires} ${when(a.expiresAt)}`).join(' / ') : '—' },
                { k: D.applied, v: when(e.appliedAt) },
                { k: D.expires, v: when(e.expiresAt) },
                ...(e.rejection ? [{ k: D.rejection, v: `${personLabel(e.rejection.by)} · ${e.rejection.reason}` }] : []),
                ...(e.revert ? [{ k: D.revert, v: e.revert.message }] : []),
              ]}
            />
            {pending && (
              <Panel title={X.act.approve}>
                <Field label={X.act.reason}>
                  <textarea className="ds-input" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} />
                </Field>
                <Field label={X.act.expiresAt}>
                  <input className="ds-input" type="datetime-local" value={expiresAt} onChange={(ev) => setExpiresAt(ev.target.value)} />
                </Field>
                {(approver.hint || decideWhy) && <p className="ds-field__hint">{approver.hint ?? decideWhy}</p>}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                  {(['APPROVE', 'REJECT'] as const).map((d) => (
                    <Button
                      key={d}
                      variant={d === 'APPROVE' ? 'primary' : 'danger'}
                      disabled={!approver.ok || !!decideWhy || reason.trim().length < 2 || (d === 'APPROVE' && !expiresAt) || decide.isPending}
                      onClick={() =>
                        decide.mutate(
                          { params: { id }, body: { decision: d, reason: reason.trim(), ...(d === 'APPROVE' ? { expiresAt: new Date(expiresAt).toISOString() } : {}) } },
                          { onSuccess: () => setReason('') },
                        )
                      }
                    >
                      {d === 'APPROVE' ? X.act.approve : X.act.reject}
                    </Button>
                  ))}
                </div>
                <ErrorNote error={decide.error} />
              </Panel>
            )}
            {(pending || e.status === 'ACTIVE') && (
              <Panel title={X.act.revoke}>
                <p className="ds-field__hint">{X.act.revokeHint}</p>
                <Button variant="danger" disabled={!revoker.ok || reason.trim().length < 2 || revoke.isPending} reason={revoker.hint} onClick={() => revoke.mutate({ params: { id }, body: { reason: reason.trim() } })}>
                  {X.act.revoke}
                </Button>
                <ErrorNote error={revoke.error} />
              </Panel>
            )}
            {e.applications.length > 0 && (
              <DataTable
                caption={D.applications}
                rows={e.applications}
                rowKey={(a) => `${a.policyId}@${a.at}`}
                pageSize={0}
                columns={[
                  { key: 'p', header: D.policy, cell: (a) => <span className="ds-mono">{a.policyId}</span> },
                  { key: 'at', header: D.applied, cell: (a) => `${when(a.at)} · ${personLabel(a.by)}` },
                  { key: 'pr', header: D.revert, cell: (a) => D.prior(a.prior?.policyId ?? null) },
                  { key: 'c', header: X.col.restriction, cell: (a) => D.cap(a.capBasisPoints) },
                ]}
              />
            )}
            <DataTable
              caption={D.history}
              rows={e.history}
              rowKey={(h) => `${h.at}-${h.kind}`}
              pageSize={0}
              columns={[
                { key: 'at', header: D.applied, cell: (h) => <span className="ds-nowrap">{when(h.at)}</span> },
                { key: 'k', header: X.col.status, cell: (h) => D.historyKind[h.kind] ?? h.kind },
                { key: 'by', header: D.requester, cell: (h) => personLabel(h.actorId) },
                { key: 'r', header: D.reason, cell: (h) => h.message ?? h.reason ?? '—' },
              ]}
            />
          </div>
        )}
      </AsyncView>
    </Drawer>
  );
}

function RequestForm({ onDone }: { onDone: (id: string) => void }) {
  const F = X.form;
  const create = useApiMutation('createExceptionPolicy', INVALIDATE);
  const [kind, setKind] = useState<ExceptionKind>('GATE_PENDING');
  const [featureId, setFeatureId] = useState('');
  const [featureVersion, setFeatureVersion] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [checks, setChecks] = useState<string[]>([]);
  const [ruleIds, setRuleIds] = useState('');
  const [gates, setGates] = useState<string[]>(['G8', 'G9']);
  const [restriction, setRestriction] = useState<ExceptionRestriction>('PILOT');
  const [reason, setReason] = useState('');
  const [periodHours, setPeriodHours] = useState('24');
  const [dueDate, setDueDate] = useState('');
  const [residualRisk, setResidualRisk] = useState('');
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const body = useMemo(
    () =>
      CreateExceptionBody.safeParse({
        kind,
        featureId: featureId.trim(),
        featureVersion: featureVersion.trim(),
        policyId: kind === 'BYPASS' ? policyId.trim() || null : null,
        checks: kind === 'BYPASS' ? checks : [],
        ruleIds: kind === 'BYPASS' ? ruleIds.split(',').map((x) => x.trim()).filter(Boolean) : [],
        gates: kind === 'GATE_PENDING' ? gates : [],
        restriction,
        reason,
        periodHours: Number(periodHours),
        dueDate: kind === 'GATE_PENDING' ? dueDate || null : null,
        residualRisk: kind === 'GATE_PENDING' ? residualRisk || null : null,
      }),
    [kind, featureId, featureVersion, policyId, checks, ruleIds, gates, restriction, reason, periodHours, dueDate, residualRisk],
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <Select label={F.kind} value={kind} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
        {EXCEPTION_KINDS.map((k) => (
          <option key={k} value={k}>
            {EXCEPTION_KIND_LABEL[k]}
          </option>
        ))}
      </Select>
      <Field label={F.feature}>
        <input className="ds-input" value={featureId} placeholder="FEAT-00001" onChange={(e) => setFeatureId(e.target.value)} />
      </Field>
      <Field label={F.version}>
        <input className="ds-input" value={featureVersion} placeholder="2.2.0" onChange={(e) => setFeatureVersion(e.target.value)} />
      </Field>
      {kind === 'BYPASS' ? (
        <>
          <Field label={F.policy}>
            <input className="ds-input" value={policyId} placeholder="POL-00001" onChange={(e) => setPolicyId(e.target.value)} />
          </Field>
          <fieldset className="ds-fieldset">
            <legend>{F.checks}</legend>
            {EXCEPTION_CHECKS.filter((c) => c.bypassable && c.id !== 'RELEASE_GATE').map((c) => (
              <label key={c.id} style={{ display: 'block' }}>
                <input type="checkbox" checked={checks.includes(c.id)} onChange={() => setChecks((l) => toggle(l, c.id))} /> {c.label}
              </label>
            ))}
          </fieldset>
          {checks.includes('COMPLIANCE_RULE') && (
            <Field label={F.ruleIds}>
              <input className="ds-input" value={ruleIds} onChange={(e) => setRuleIds(e.target.value)} />
            </Field>
          )}
        </>
      ) : (
        <>
          <fieldset className="ds-fieldset">
            <legend>{F.gates}</legend>
            {GATES.map((g) => (
              <label key={g} style={{ display: 'inline-block', marginInlineEnd: 'var(--sp-3)' }}>
                <input type="checkbox" checked={gates.includes(g)} onChange={() => setGates((l) => toggle(l, g))} /> {g}
              </label>
            ))}
          </fieldset>
          <Field label={F.dueDate}>
            <input className="ds-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label={F.residualRisk}>
            <textarea className="ds-input" rows={2} value={residualRisk} onChange={(e) => setResidualRisk(e.target.value)} />
          </Field>
        </>
      )}
      <Select label={F.restriction} value={restriction} onChange={(e) => setRestriction(e.target.value as ExceptionRestriction)}>
        {EXCEPTION_RESTRICTIONS.filter((r) => kind === 'GATE_PENDING' || r !== 'SHADOW').map((r) => (
          <option key={r} value={r}>
            {EXCEPTION_RESTRICTION_LABEL[r]}
          </option>
        ))}
      </Select>
      <Field label={F.reason}>
        <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={F.periodHours}>
        <input className="ds-input" type="number" min={1} max={EXCEPTION_MAX_HOURS} value={periodHours} onChange={(e) => setPeriodHours(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={!body.success || create.isPending} onClick={() => body.success && create.mutate({ body: body.data }, { onSuccess: (r) => onDone((r as { exceptionId: string }).exceptionId) })}>
        {F.submit}
      </Button>
      <ErrorNote error={create.error} />
    </div>
  );
}

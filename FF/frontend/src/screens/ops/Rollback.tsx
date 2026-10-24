// /ops/rollback 롤백 (D03-04) — 배포 고르기 → 복구 가능 버전·배포 이력·정책 변경 이력 → 수동 롤백 요청 또는 Rollback Plan(자동 조건)
// → 지정 승인대상자 승인·반려 → (수동) 실행 → 롤백 이력. 적용 가능 판정·영향 차량 그룹은 서버 미리보기(contracts rules/rollback)와 같다.
// 알림 링크: ?request= · ?plan= · ?execution= 로 해당 기록을 연다.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DTC_TYPE_LABEL,
  DTC_TYPES,
  NOTIFICATION_ACCOUNTS,
  POLICY_REVISION_KIND_LABEL,
  ROLLBACK_APPROVER_ROLES,
  ROLLBACK_PLAN_STATUS_LABEL,
  ROLLBACK_REQUEST_ROLES,
  ROLLBACK_REQUEST_STATUS_LABEL,
  ROLLBACK_RESULT_LABEL,
  ROLLBACK_STATUS_LABEL,
  conditionText,
  scopeText,
  versionText,
  type DtcType,
  type PolicyChangeEntry,
  type RollbackExecution,
  type RollbackPlan,
  type RollbackRequest,
  type RollbackScope,
  type VehicleGroup,
} from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import { whyDisabled, AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, Segmented, Select, VerdictBadge } from '../../design';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';

const R = ko.rollback;
const F = R.form;
const INVALIDATE = ['rollbackDeployments', 'rollbackDeployment', 'rollbackPlans', 'rollbackRequests', 'rollbacks', 'rollbackExecution', 'listPolicies', 'notifications'];
const EVENTS = ['rollback.', 'publication.closed', 'policy.deployed'];
const STATUS_VERDICT: Record<string, string> = { COMPLETED: 'PASS', FAILED: 'FAIL', RUNNING: 'CONDITIONAL', REQUESTED: '미판정' };

interface Ref {
  policyId: string;
  revision: number;
  contentHash: string;
  featureId: string;
  featureVersion: string;
}
interface DeploymentRow {
  deploymentId: string | null;
  flagKey: string;
  controlPoint: string;
  feature: { featureId: string; version: string; name: string };
  deployed: Ref;
  deployedAt: string | null;
  publication: { status: string; confirmed: number; denominator: number } | null;
  candidates: number;
  eligible: number;
  plans: number;
}
interface Candidate extends Ref {
  status: string;
  deployedAt: string | null;
  artifactId: string | null;
  eligible: boolean;
  blockers: { code: string; message: string }[];
}
interface DeploymentDetail {
  deploymentId: string;
  current: boolean;
  feature: { featureId: string; version: string; name: string };
  deployed: Ref & { flagKey: string; deployedBy: string | null; deployedAt: string | null };
  publication: { status: string; confirmed: number; denominator: number; targets: number };
  policyChanges: PolicyChangeEntry[];
  deploymentHistory: { publicationId: string; policyId: string | null; revision: number | null; status: string; confirmed: number; denominator: number; createdAt: string; createdBy: string; rollback: string | null }[];
  swHistory: { available: boolean; note: string };
  candidates: Candidate[];
  plans: RollbackPlan[];
  requests: RollbackRequest[];
}
interface Preview {
  applicable: boolean;
  blockers: { code: string; message: string }[];
  impact: { features: { featureId: string; version: string | null; name: string; role: 'TARGET' | 'DEPENDENT' }[] };
  vehicleGroups: VehicleGroup[];
  vins: string[];
}

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

/** 롤백 요청 양식 — 수동 롤백·Rollback Plan, 미리보기로 적용 가능 여부와 영향 범위를 먼저 본다 */
function RollbackForm({ d, me }: { d: DeploymentDetail; me: string }) {
  const perm = usePermission(ROLLBACK_REQUEST_ROLES);
  const eligible = d.candidates.filter((c) => c.eligible);
  const approverOptions = NOTIFICATION_ACCOUNTS.filter((a) => a.id !== me && a.roles.some((r) => ROLLBACK_APPROVER_ROLES.includes(r)));
  const [mode, setMode] = useState<'manual' | 'plan'>('manual');
  const [recovery, setRecovery] = useState(eligible[0]?.policyId ?? '');
  const [vins, setVins] = useState('');
  const [regions, setRegions] = useState('');
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState(approverOptions[0]?.id ?? '');
  const [useRate, setUseRate] = useState(true);
  const [rate, setRate] = useState(10);
  const [useDtc, setUseDtc] = useState(false);
  const [dtcCodes, setDtcCodes] = useState('');
  const [dtcTypes, setDtcTypes] = useState<DtcType[]>([]);
  const preview = useApiMutation<Preview>('previewRollback');
  const createReq = useApiMutation<RollbackRequest>('createRollbackRequest', INVALIDATE);
  const createPlan = useApiMutation<RollbackPlan>('createRollbackPlan', INVALIDATE);
  const scope: RollbackScope = { featureIds: [d.feature.featureId], vins: list(vins), marketRegions: list(regions), variantRules: [], productionRegions: [], swVersions: [] };
  const conditions = { ...(useRate && { failureRate: { thresholdPercent: rate } }), ...(useDtc && { dtc: { codes: list(dtcCodes), types: dtcTypes } }) };
  const base = { deploymentId: d.deploymentId, targetTypes: ['POLICY_VERSION'], recovery: { policyId: recovery }, scope, approvers: [approver] };
  const m = mode === 'manual' ? createReq : createPlan;
  const ready = !!recovery && !!approver && perm.ok && !STATIC_MODE && (mode === 'manual' ? reason.trim().length >= 2 : useRate || useDtc);
  const p = preview.data;
  if (!eligible.length) return <p className="pv-lead">{F.noCandidate}</p>;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <Segmented
        label={F.modeLabel}
        value={mode}
        onChange={(v) => setMode(v as 'manual' | 'plan')}
        options={[
          { value: 'manual', label: F.manual },
          { value: 'plan', label: F.plan },
        ]}
      />
      <Select label={F.recovery} value={recovery} onChange={(e) => setRecovery(e.target.value)}>
        {eligible.map((c) => (
          <option key={c.policyId} value={c.policyId}>
            {versionText(c)} · {when(c.deployedAt)}
          </option>
        ))}
      </Select>
      <fieldset className="rb-fieldset">
        <legend>{F.targetTypes}</legend>
        <label>
          <input type="checkbox" checked disabled /> {F.policyVersion}
        </label>
        <label>
          <input type="checkbox" checked={false} disabled /> {F.swVersion}
        </label>
      </fieldset>
      <Field label={F.scope} hint={F.scopeHint}>
        <span className="ds-tag">Feature {d.feature.featureId}</span>
      </Field>
      <Field label={F.vins}>
        <input className="ds-input ds-input--mono" value={vins} onChange={(e) => setVins(e.target.value)} />
      </Field>
      <Field label={F.regions}>
        <input className="ds-input ds-input--mono" value={regions} onChange={(e) => setRegions(e.target.value)} />
      </Field>
      {mode === 'manual' ? (
        <Field label={F.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
      ) : (
        <fieldset className="rb-fieldset">
          <legend>{R.trigger}</legend>
          <label>
            <input type="checkbox" checked={useRate} onChange={(e) => setUseRate(e.target.checked)} /> {F.useFailureRate}
          </label>
          {useRate && (
            <Field label={F.failureRate}>
              <input className="ds-input ds-input--mono" type="number" min={0} max={100} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
            </Field>
          )}
          <label>
            <input type="checkbox" checked={useDtc} onChange={(e) => setUseDtc(e.target.checked)} /> {F.useDtc}
          </label>
          {useDtc && (
            <>
              <Field label={F.dtcCodes}>
                <input className="ds-input ds-input--mono" value={dtcCodes} onChange={(e) => setDtcCodes(e.target.value)} />
              </Field>
              <div role="group" aria-label={F.dtcTypes} className="rb-types">
                {DTC_TYPES.map((t) => (
                  <label key={t}>
                    <input type="checkbox" checked={dtcTypes.includes(t)} onChange={(e) => setDtcTypes(e.target.checked ? [...dtcTypes, t] : dtcTypes.filter((x) => x !== t))} /> {DTC_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>
      )}
      <Select label={F.approvers} value={approver} onChange={(e) => setApprover(e.target.value)}>
        {approverOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.id} · {a.roles.filter((r) => ROLLBACK_APPROVER_ROLES.includes(r)).join(', ')}
          </option>
        ))}
      </Select>
      <p className="pv-lead">{F.approversHint}</p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <Button disabled={!recovery || STATIC_MODE || preview.isPending} reason={whyDisabled([STATIC_MODE, ko.page.readOnly], [!recovery, ko.why.recovery])} onClick={() => preview.mutate({ body: { deploymentId: d.deploymentId, recovery: { policyId: recovery }, scope } })}>
          {F.preview}
        </Button>
        <Button
          variant="primary"
          disabled={!ready || m.isPending}
          title={STATIC_MODE ? R.staticNote : perm.hint}
          onClick={() => (mode === 'manual' ? createReq.mutate({ body: { ...base, reason } }) : createPlan.mutate({ body: { ...base, conditions } }))}
        >
          {mode === 'manual' ? F.submitManual : F.submitPlan}
        </Button>
      </div>
      <ErrorNote error={preview.error ?? m.error} />
      {(createReq.data || createPlan.data) && m.isSuccess && <p role="status">{F.created(createReq.data?.requestId ?? createPlan.data!.planId)}</p>}
      {p && (
        <section aria-label={F.preview} className="rb-preview">
          <p role="status" className={p.applicable ? 'ds-ok' : 'ds-stale'}>
            <strong>{p.applicable ? F.applicable : F.blocked}</strong>
          </p>
          {p.blockers.length > 0 && (
            <ul>
              {p.blockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          )}
          <h3 className="pv-h">{F.impact}</h3>
          <p>
            {p.impact.features.map((f) => (
              <span key={f.featureId} className="ds-tag">
                {f.featureId} {f.name} · {f.role === 'TARGET' ? F.target : F.dependent}
              </span>
            ))}
          </p>
          <h3 className="pv-h">
            {F.groups} · {p.vins.length}
          </h3>
          <DataTable
            caption={F.groups}
            rows={p.vehicleGroups}
            rowKey={(g) => g.vins[0]}
            columns={[
              { key: 'p', header: F.groupCol.production, cell: (g) => <span className="ds-mono">{g.productionRegion}</span> },
              { key: 'm', header: F.groupCol.market, cell: (g) => <span className="ds-mono">{g.marketRegion}</span> },
              { key: 'v', header: F.groupCol.variant, cell: (g) => <span className="ds-mono">{g.variant}</span> },
              { key: 't', header: F.groupCol.model, cell: (g) => `${g.vehicleModel} ${g.trim}` },
              { key: 's', header: F.groupCol.sw, cell: (g) => <span className="ds-mono">{g.swVersion}</span> },
              { key: 'n', header: F.groupCol.vins, cell: (g) => g.vins.length, align: 'right' },
            ]}
          />
        </section>
      )}
    </div>
  );
}

/** 요청·계획 한 줄 — 지정 승인대상자는 승인·반려, 승인된 수동 요청은 실행 */
function PendingItem({ x, me }: { x: (RollbackRequest & { kind: 'request' }) | (RollbackPlan & { kind: 'plan' }); me: string }) {
  const id = x.kind === 'request' ? x.requestId : x.planId;
  const decide = useApiMutation(x.kind === 'request' ? 'decideRollbackRequest' : 'decideRollbackPlan', INVALIDATE);
  const execute = useApiMutation<RollbackExecution>('executeRollbackRequest', INVALIDATE);
  const runner = usePermission(ROLLBACK_REQUEST_ROLES);
  const [comment, setComment] = useState('');
  const mine = x.approvers.includes(me) && x.requestedBy !== me;
  const label = x.kind === 'request' ? ROLLBACK_REQUEST_STATUS_LABEL[x.status] : ROLLBACK_PLAN_STATUS_LABEL[x.status];
  return (
    <li className="rb-item" data-testid="rollback-pending" id={id}>
      <div className="ntf-row__meta">
        <span className="ds-tag">{R.kind[x.kind]}</span>
        <span className="ds-mono">{id}</span>
        <span>{label}</span>
        <span className="ds-mono ds-nowrap">{when(x.requestedAt)}</span>
      </div>
      <KeyValue
        rows={[
          { k: F.recovery, v: versionText(x.recovery) },
          { k: F.scope, v: scopeText(x.scope) },
          x.kind === 'request' ? { k: F.reason, v: x.reason } : { k: R.trigger, v: conditionText(x.conditions) },
          { k: ko.bom.requestedBy, v: <span className="ds-mono">{x.requestedBy}</span> },
          { k: F.approvers, v: <span className="ds-mono">{x.approvers.join(', ')}</span> },
          ...(x.decision ? [{ k: ko.bom.decidedBy, v: `${x.decision.decision === 'APPROVE' ? R.approve : R.reject} · ${x.decision.by} · ${x.decision.comment}`, note: when(x.decision.at) }] : []),
        ]}
      />
      {x.status === 'REQUESTED' &&
        (mine ? (
          <div className="rb-decide">
            <Field label={R.comment}>
              <input className="ds-input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <Button variant="primary" disabled={comment.trim().length < 2 || decide.isPending} reason={whyDisabled([comment.trim().length < 2, ko.why.comment])} onClick={() => decide.mutate({ params: { id }, body: { decision: 'APPROVE', comment } })}>
              {R.approve}
            </Button>
            <Button disabled={comment.trim().length < 2 || decide.isPending} onClick={() => decide.mutate({ params: { id }, body: { decision: 'REJECT', comment } })}>
              {R.reject}
            </Button>
          </div>
        ) : (
          <p className="pv-lead">{R.notApprover}</p>
        ))}
      {x.kind === 'request' && x.status === 'APPROVED' && (
        <Button variant="danger" disabled={!runner.ok || execute.isPending} title={runner.hint} onClick={() => execute.mutate({ params: { id }, body: {} })}>
          {R.execute}
        </Button>
      )}
      <ErrorNote error={decide.error ?? execute.error} />
    </li>
  );
}

function DeploymentPanel({ id, me }: { id: string; me: string }) {
  const q = useApi<DeploymentDetail>('rollbackDeployment', { params: { deploymentId: id } });
  const d = q.data;
  const pending = d ? [...d.requests.map((r) => ({ ...r, kind: 'request' as const })), ...d.plans.map((p) => ({ ...p, kind: 'plan' as const }))].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) : [];
  return (
    <AsyncView state={asyncState(q)} onRetry={() => q.refetch()} error={q.error}>
      {d && (
        <>
          <Panel title={R.detail(d.deploymentId)} eyebrow={`${d.deployed.flagKey} · ${versionText(d.deployed)}`} id="rb-deployment">
            {!d.current && <p className="ds-stale">{R.notCurrent}</p>}
            <h3 className="pv-h">{R.candidatesTitle}</h3>
            <p className="pv-lead">{R.candidatesLead}</p>
            <DataTable
              caption={R.candidatesTitle}
              rows={d.candidates}
              rowKey={(c) => c.policyId}
              columns={[
                { key: 'v', header: F.recovery, cell: (c) => <span className="ds-mono">{versionText(c)}</span> },
                { key: 'at', header: R.hcol.at, cell: (c) => <span className="ds-mono ds-nowrap">{when(c.deployedAt)}</span> },
                { key: 'e', header: R.eligible, cell: (c) => <VerdictBadge value={c.eligible ? 'PASS' : 'FAIL'} /> },
                { key: 'b', header: R.failure, cell: (c) => (c.eligible ? <span className="ds-mono">{c.artifactId}</span> : c.blockers.map((b) => b.message).join(' · ')) },
              ]}
            />
            <details className="pv-log">
              <summary>
                {R.historyTitle} · {d.deploymentHistory.length}
              </summary>
              <DataTable
                caption={R.historyTitle}
                rows={d.deploymentHistory}
                rowKey={(h) => h.publicationId}
                columns={[
                  { key: 'id', header: R.col.deployment, cell: (h) => <span className="ds-mono">{h.publicationId}</span> },
                  { key: 'p', header: R.col.deployed, cell: (h) => <span className="ds-mono">{h.policyId} r{h.revision}</span> },
                  { key: 's', header: R.col.artifact, cell: (h) => `${h.status} ${h.confirmed}/${h.denominator}` },
                  { key: 'r', header: R.title, cell: (h) => h.rollback ?? '—' },
                  { key: 'at', header: R.hcol.at, cell: (h) => <span className="ds-mono ds-nowrap">{when(h.createdAt)}</span> },
                ]}
              />
            </details>
            <details className="pv-log">
              <summary>
                {R.changesTitle} · {d.policyChanges.length}
              </summary>
              <ul>
                {d.policyChanges.map((c) => (
                  <li key={c.revision}>
                    r{c.revision} · {POLICY_REVISION_KIND_LABEL[c.kind]} · <span className="ds-mono">{c.changedBy}</span> · {when(c.changedAt)} {c.changes.length ? `· ${c.changes.map((x) => x.path).join(', ')}` : ''}
                  </li>
                ))}
              </ul>
            </details>
            <p className="pv-lead">
              {R.swNote} — {d.swHistory.note}
            </p>
          </Panel>
          <div className="ds-split">
            <Panel title={F.title} id="rb-form">
              {d.current ? <RollbackForm key={d.deploymentId} d={d} me={me} /> : <p className="pv-lead">{R.notCurrent}</p>}
            </Panel>
            <Panel title={R.pending} id="rb-pending">
              {pending.length ? (
                <ul className="ntf-list">
                  {pending.map((x) => (
                    <PendingItem key={x.kind === 'request' ? x.requestId : x.planId} x={x} me={me} />
                  ))}
                </ul>
              ) : (
                <p className="pv-lead">{R.pendingEmpty}</p>
              )}
            </Panel>
          </div>
        </>
      )}
    </AsyncView>
  );
}

function ExecutionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<RollbackExecution>('rollbackExecution', { params: { id: id ?? '-' } }, { enabled: !!id });
  const x = q.data;
  return (
    <Drawer open={!!id} title={id ? R.execTitle(id) : ''} onClose={onClose}>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()}>
        {x && (
          <KeyValue
            rows={[
              { k: R.hcol.status, v: <VerdictBadge value={STATUS_VERDICT[x.status] ?? '미판정'} />, note: `${ROLLBACK_STATUS_LABEL[x.status]}${x.result ? ` · ${ROLLBACK_RESULT_LABEL[x.result]}` : ''}` },
              { k: R.hcol.mode, v: R.mode[x.mode], note: x.planId ?? x.requestId ?? undefined },
              { k: R.trigger, v: x.trigger.detail },
              { k: R.col.deployment, v: <span className="ds-mono">{x.deploymentId}</span> },
              { k: R.hcol.before, v: versionText(x.before) },
              { k: R.hcol.after, v: versionText(x.after) },
              { k: R.artifact, v: <span className="ds-mono">{x.artifactId ?? '—'}</span> },
              { k: R.sourceArtifact, v: <span className="ds-mono">{x.sourceArtifactId ?? '—'}</span> },
              { k: R.vehicles, v: `${x.vins.length} · ${x.vehicleGroups.map((g) => `${g.productionRegion}/${g.marketRegion}/${g.swVersion} ${g.vins.length}`).join(', ')}` },
              ...(x.failureReason ? [{ k: R.failure, v: x.failureReason, note: x.failedAt ? when(x.failedAt) : undefined }] : []),
              { k: ko.bom.requestedBy, v: <span className="ds-mono">{x.requestedBy}</span>, note: x.approvedBy ? `${R.approve} ${x.approvedBy}` : undefined },
              { k: R.hcol.at, v: when(x.startedAt), note: x.finishedAt ? when(x.finishedAt) : undefined },
            ]}
          />
        )}
      </AsyncView>
    </Drawer>
  );
}

export function RollbackScreen() {
  const { role } = useAppShell();
  const me = actorFor(role).id;
  const [sp, setSp] = useSearchParams();
  const deps = useApi<{ items: DeploymentRow[] }>('rollbackDeployments');
  const pending = useApi<{ items: unknown[] }>('rollbackRequests', { query: { status: 'REQUESTED' } });
  const [status, setStatus] = useState('');
  const hist = useApi<{ items: RollbackExecution[] }>('rollbacks', { query: { status: status || undefined } });
  const reqQ = useApi<RollbackRequest>('rollbackRequest', { params: { id: sp.get('request') ?? '-' } }, { enabled: !!sp.get('request') });
  const planQ = useApi<RollbackPlan>('rollbackPlan', { params: { id: sp.get('plan') ?? '-' } }, { enabled: !!sp.get('plan') });
  usePlatformEvents(EVENTS, INVALIDATE);
  // 알림 링크(요청·계획)는 그 기록의 배포를 연다
  const selected = sp.get('deployment') ?? reqQ.data?.deploymentId ?? planQ.data?.deploymentId ?? null;
  const execution = sp.get('execution');
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const rows = useMemo(() => (deps.data?.items ?? []).filter((d) => d.deploymentId), [deps.data]);
  return (
    <div className="ds-screen">
      <PageHeader
        codes={R.eyebrow}
        title={R.title}
        lead={R.lead}
        message={!pending.data ? { tone: 'neutral', value: '—', text: R.key.waiting } : pending.data.items.length ? { tone: 'warn', value: pending.data.items.length, text: R.key.waiting } : { tone: 'ok', text: R.key.clean }}
      />
      <Panel title={R.deployments} id="rb-deployments">
        <AsyncView state={asyncState(deps, rows.length === 0)} onRetry={() => deps.refetch()}>
          <DataTable
            caption={R.deployments}
            rows={rows}
            rowKey={(d) => d.deploymentId!}
            onOpen={(d) => set('deployment', d.deploymentId)}
            columns={[
              { key: 'flag', header: R.col.flag, cell: (d) => <span className="ds-mono">{d.flagKey}</span>, sort: (d) => d.flagKey },
              { key: 'f', header: R.col.feature, cell: (d) => `${d.feature.featureId} ${d.feature.name}` },
              { key: 'v', header: R.col.deployed, cell: (d) => <span className="ds-mono">{d.deployed.policyId} r{d.deployed.revision}</span> },
              { key: 'id', header: R.col.deployment, cell: (d) => <span className="ds-mono">{d.deploymentId}</span> },
              { key: 'a', header: R.col.artifact, cell: (d) => (d.publication ? `${d.publication.status} ${d.publication.confirmed}/${d.publication.denominator}` : '—') },
              { key: 'c', header: R.col.candidates, cell: (d) => `${d.eligible}/${d.candidates}`, align: 'right' },
              { key: 'p', header: R.col.plans, cell: (d) => d.plans, align: 'right' },
            ]}
          />
        </AsyncView>
        {!selected && <p className="pv-lead">{R.pick}</p>}
      </Panel>
      {selected && <DeploymentPanel key={selected} id={selected} me={me} />}
      <Panel
        title={R.historyListTitle}
        id="rb-history"
        actions={
          <Select label={R.filterStatus} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{R.filterAll}</option>
            {Object.entries(ROLLBACK_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      >
        <AsyncView state={asyncState(hist, (hist.data?.items ?? []).length === 0)} onRetry={() => hist.refetch()}>
          <DataTable
            caption={R.historyListTitle}
            rows={hist.data?.items ?? []}
            rowKey={(x) => x.executionId}
            onOpen={(x) => set('execution', x.executionId)}
            columns={[
              { key: 'id', header: R.hcol.id, cell: (x) => <span className="ds-mono">{x.executionId}</span> },
              { key: 'm', header: R.hcol.mode, cell: (x) => R.mode[x.mode] },
              { key: 's', header: R.hcol.source, cell: (x) => <span className="ds-mono">{x.planId ?? x.requestId}</span> },
              { key: 'f', header: R.hcol.feature, cell: (x) => <span className="ds-mono">{x.featureId}</span> },
              { key: 'b', header: R.hcol.before, cell: (x) => <span className="ds-mono">{x.before.policyId} r{x.before.revision}</span> },
              { key: 'a', header: R.hcol.after, cell: (x) => <span className="ds-mono">{x.after.policyId} r{x.after.revision}</span> },
              { key: 'st', header: R.hcol.status, cell: (x) => <><VerdictBadge value={STATUS_VERDICT[x.status] ?? '미판정'} /> {ROLLBACK_STATUS_LABEL[x.status]}</> },
              { key: 'r', header: R.hcol.result, cell: (x) => (x.result ? ROLLBACK_RESULT_LABEL[x.result] : '—') },
              { key: 'at', header: R.hcol.at, cell: (x) => <span className="ds-mono ds-nowrap">{when(x.startedAt)}</span>, sort: (x) => x.startedAt },
            ]}
          />
        </AsyncView>
      </Panel>
      <ExecutionDrawer id={execution} onClose={() => set('execution', null)} />
    </div>
  );
}

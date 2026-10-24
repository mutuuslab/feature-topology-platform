// 정책 상세의 배포 이력·되돌리기 (D03-04 · RD-FN-02) — 이 flag로 배포한 버전(서명 게시본), 정책 버전마다 되돌릴 수 있는지(서버 재검증 사유),
// 이 버전으로 되돌리기 요청(지정 승인대상자) → 승인·실행(롤백 화면과 같은 부품). 요청은 화면이 본 지금 배포(expectedDeploymentId)에 묶인다 —
// 그사이 배포가 바뀌면 서버가 412로 거절하고 이 화면은 이력을 새로 읽는다. 진행 중 요청이 있으면 409.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NOTIFICATION_ACCOUNTS, ROLLBACK_APPROVER_ROLES, ROLLBACK_REQUEST_ROLES, type RollbackExecution, type RollbackRequest } from '@ff/contracts';
import { actorFor } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { ko } from '../../copy/ko';
import { whyDisabled, AsyncView, Button, DataTable, Drawer, ErrorNote, Field, KeyValue, Panel, Select, VerdictBadge } from '../../design';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';
import { PendingItem } from '../ops/Rollback';

const H = ko.policy.deployHistory;
const INVALIDATE = ['policyHistory', 'policyDetail', 'listPolicies', 'rollbackDeployments', 'rollbackDeployment', 'rollbackRequests', 'rollbacks', 'notifications', 'audit'];
const PUB_VERDICT: Record<string, string> = { CONFIRMED: 'PASS', PARTIAL: 'CONDITIONAL', DIVERGED: 'FAIL', EXPIRED: 'FAIL', PENDING: '미판정' };

interface Ref {
  policyId: string;
  revision: number;
  contentHash: string;
  featureId: string;
  featureVersion: string;
}
interface DeploymentRow {
  publicationId: string;
  policyId: string | null;
  revision: number | null;
  status: string;
  confirmed: number;
  denominator: number;
  createdAt: string;
  createdBy: string;
  current: boolean;
  rollbackExecutionId: string | null;
}
interface VersionRow extends Ref {
  status: string;
  description: string;
  approvedBy: string | null;
  deployedAt: string | null;
  current: boolean;
  rollback: { eligible: boolean; blockers: { code: string; message: string }[] } | null;
}
interface History {
  policyId: string;
  flagKey: string;
  deploymentId: string | null;
  current: Ref | null;
  deployments: DeploymentRow[];
  versions: VersionRow[];
  requests: RollbackRequest[];
  executions: RollbackExecution[];
}

function RollbackDrawer({ h, target, me, onClose }: { h: History; target: VersionRow | null; me: string; onClose: () => void }) {
  const approverOptions = NOTIFICATION_ACCOUNTS.filter((a) => a.id !== me && a.roles.some((r) => ROLLBACK_APPROVER_ROLES.includes(r)));
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState(approverOptions[0]?.id ?? '');
  const [done, setDone] = useState<string | null>(null);
  const req = useApiMutation<RollbackRequest>('requestPolicyRollback', INVALIDATE);
  const perm = usePermission(ROLLBACK_REQUEST_ROLES);
  const stale = req.error?.status === 412;
  const close = () => (setReason(''), setDone(null), req.reset(), onClose());
  return (
    <Drawer open={!!target} title={target ? H.drawerTitle(target.policyId, target.revision) : ''} onClose={close} dirty={reason.trim().length > 0 && !done}>
      {target && h.current && h.deploymentId && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }} data-testid="policy-rollback-form">
          <p className="pv-lead">{H.drawerLead}</p>
          <KeyValue
            rows={[
              { k: H.from, v: <span className="ds-mono">{h.current.policyId} r{h.current.revision}</span>, note: h.deploymentId },
              { k: H.to, v: <span className="ds-mono">{target.policyId} r{target.revision}</span>, note: target.description },
            ]}
          />
          <Field label={ko.rollback.form.reason}>
            <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
          </Field>
          <Select label={ko.rollback.form.approvers} value={approver} onChange={(e) => setApprover(e.target.value)}>
            {approverOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.roles.filter((r) => ROLLBACK_APPROVER_ROLES.includes(r)).join(', ')}
              </option>
            ))}
          </Select>
          <p className="pv-lead">{ko.rollback.form.approversHint}</p>
          {stale && <p role="status">{H.stale}</p>}
          <ErrorNote error={req.error} />
          {done ? (
            <p role="status">{H.created(done)}</p>
          ) : (
            <div>
              <Button
                variant="primary"
                disabled={!perm.ok || reason.trim().length < 2 || !approver || req.isPending || stale}
                title={perm.hint}
                reason={whyDisabled([!perm.ok, perm.hint], [reason.trim().length < 2, ko.why.reason])}
                onClick={() =>
                  req.mutate(
                    { params: { id: h.policyId }, body: { recovery: { policyId: target.policyId }, expectedDeploymentId: h.deploymentId, reason, approvers: [approver] } },
                    { onSuccess: (r) => setDone(r.requestId) },
                  )
                }
              >
                {H.submit}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function PolicyHistory({ policyId }: { policyId: string }) {
  const q = useApi<History>('policyHistory', { params: { id: policyId } });
  const { role } = useAppShell();
  const me = actorFor(role).id;
  const [target, setTarget] = useState<VersionRow | null>(null);
  const h = q.data;
  const deployments = h?.deployments ?? [];
  const open = (h?.requests ?? []).filter((r) => r.status === 'REQUESTED' || r.status === 'APPROVED');
  const candidates = (h?.versions ?? []).filter((v) => !v.current && v.rollback);
  return (
    <Panel title={H.title} id="deploy-history" eyebrow={h ? h.flagKey : undefined}>
      <p className="pv-lead">{H.lead}</p>
      <AsyncView state={asyncState(q)} onRetry={() => q.refetch()} rows={3}>
        {h && (
          <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
            <p className="pv-meta" data-testid="policy-current-deployment">{h.current && h.deploymentId ? H.current(h.current.policyId, h.current.revision, h.deploymentId) : H.none}</p>
            <DataTable
              caption={H.deploymentsTitle}
              rows={deployments}
              rowKey={(r) => r.publicationId}
              columns={[
                { key: 'id', header: H.col.deployment, cell: (r) => <span className="ds-mono">{r.publicationId}{r.current ? ` · ${H.now}` : ''}</span> },
                { key: 'ver', header: H.col.version, cell: (r) => <span className="ds-mono">{r.policyId ?? '—'}{r.revision !== null ? ` r${r.revision}` : ''}</span> },
                { key: 'st', header: H.col.status, cell: (r) => <VerdictBadge value={PUB_VERDICT[r.status] ?? '미판정'} /> },
                { key: 'veh', header: H.col.vehicles, cell: (r) => <span className="ds-mono">{r.confirmed}/{r.denominator}</span> },
                { key: 'by', header: H.col.by, cell: (r) => <span className="ds-mono">{r.createdBy}</span> },
                { key: 'at', header: H.col.at, cell: (r) => <span className="ds-mono ds-nowrap">{when(r.createdAt)}</span>, sort: (r) => r.createdAt },
                { key: 'rb', header: H.col.rollback, cell: (r) => (r.rollbackExecutionId ? <Link to={`/ops/rollback?execution=${r.rollbackExecutionId}`} className="ds-mono">{r.rollbackExecutionId}</Link> : '—') },
              ]}
            />
            {h.current && (
              <DataTable
                caption={H.versionsTitle}
                rows={candidates}
                rowKey={(r) => r.policyId}
                columns={[
                  { key: 'p', header: H.col.policy, cell: (r) => <span className="ds-mono">{r.policyId} r{r.revision}</span> },
                  { key: 'd', header: ko.policy.field.description, cell: (r) => r.description },
                  { key: 's', header: H.col.state, cell: (r) => <span className="ds-tag">{r.status}</span> },
                  { key: 'at', header: H.col.deployedAt, cell: (r) => <span className="ds-mono ds-nowrap">{r.deployedAt ? when(r.deployedAt) : H.neverDeployed}</span> },
                  { key: 'v', header: H.col.verdict, cell: (r) => <VerdictBadge value={r.rollback!.eligible ? 'PASS' : 'FAIL'} /> },
                  {
                    key: 'act',
                    header: H.col.why,
                    cell: (r) =>
                      r.rollback!.eligible ? (
                        <Button onClick={() => setTarget(r)} disabled={open.length > 0} reason={whyDisabled([open.length > 0, H.busy])}>
                          {H.pick}
                        </Button>
                      ) : (
                        <span className="pv-lead">{r.rollback!.blockers.map((b) => b.message).join(' · ')}</span>
                      ),
                  },
                ]}
              />
            )}
            <section aria-label={H.requestsTitle}>
              <h3 className="pv-h">{H.requestsTitle}</h3>
              {open.length ? (
                <ul className="ntf-list">
                  {open.map((r) => (
                    <PendingItem key={r.requestId} x={{ ...r, kind: 'request' }} me={me} />
                  ))}
                </ul>
              ) : (
                <p className="pv-lead">{H.requestsEmpty}</p>
              )}
              {h.deploymentId && (
                <p style={{ marginBottom: 0 }}>
                  <Link to="/ops/rollback">{H.openRollback}</Link>
                </p>
              )}
            </section>
            <RollbackDrawer key={target?.policyId ?? '-'} h={h} target={target} me={me} onClose={() => (setTarget(null), q.refetch())} />
          </div>
        )}
      </AsyncView>
    </Panel>
  );
}

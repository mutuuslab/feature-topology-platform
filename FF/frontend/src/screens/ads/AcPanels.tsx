import { useUiLocale } from '../../locale/react';
// 승인 구성 조합(/config/compat) 보강 — 조합 제안→승인(작성자 ≠ 승인자)·보안 최소 버전 표(사이버보안 담당 승인). 규칙은 contracts rules/ads-config-approval.ts.
import { useState } from 'react';
import type { ConfigSet, SecurityMinEntry } from '@ff/contracts';
import { securityMinProposalBlocker } from '../../../../contracts/src/rules/ads-config-approval';
import { actorFor } from '../../api/actor';
import { STATIC_MODE } from '../../api/client';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { securityMin as S, setApproval as A } from '../../copy/ads-ac';
import { personName } from '../../data/people';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Panel } from '../../design';
import { BlockedAction, VerdictReason } from '../../design/ads';
import { useAppShell } from '../../store';
import { usePermission, when } from '../shared';

const INVALIDATE = ['configSets', 'configSetVehicles', 'securityMins', 'audit', 'events'];

export interface SecurityMinsResp {
  items: SecurityMinEntry[];
  current: { swId: string; version: string }[];
  pending: number;
  unregistered: string[];
}

/** 조합 상태 글자 — 승인 대기는 '미확인' 색(근거로 쓰지 않음) */
export function SetStatus({ set }: { set: Pick<ConfigSet, 'status' | 'proposedBy' | 'approvedBy'> }) {
  useUiLocale();
  return set.status === 'APPROVED' ? (
    <VerdictReason tone="ok" label={A.statusLabel.APPROVED} reason={`${A.proposer} ${personName(set.proposedBy)} · ${A.approver} ${personName(set.approvedBy)}`} />
  ) : (
    <VerdictReason tone="unknown" label={A.statusLabel.PROPOSED} reason={`${A.proposer} ${personName(set.proposedBy)}`} />
  );
}

/** 조합 승인 — 기능안전 담당, 제안자 본인이면 버튼 대신 사유(서버도 같은 사유로 거부) */
export function SetApprove({ set }: { set: ConfigSet }) {
  useUiLocale();
  const perm = usePermission(['SAFETY_OFFICER']);
  const { role } = useAppShell();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const approve = useApiMutation<ConfigSet>('approveConfigSet', INVALIDATE);
  if (set.status === 'APPROVED') return null;
  if (!perm.ok) return <BlockedAction label={A.action} reason={STATIC_MODE ? A.readOnly : A.noPermission} />;
  if (set.proposedBy && actorFor(role, ['SAFETY_OFFICER']).id === set.proposedBy) return <BlockedAction label={A.action} reason={A.selfApproval} />;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{A.action}</Button>
      <Drawer open={open} title={A.title(set.setId)} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          <p className="adsc-note">{A.pendingNote}</p>
          <Field label={A.reason}>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={approve.error} />
          {approve.data ? <p className="adsc-note">{A.done}</p> : null}
          <Button variant="primary" disabled={reason.trim().length < 2 || approve.isPending} onClick={() => approve.mutate({ params: { id: set.setId }, body: { reason } }, { onSuccess: () => setOpen(false) })}>
            {A.submit}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

/** 보안 최소 버전 표 탭 — 지금 하한·제안·승인 이력, 제안(올리기만)·승인(사이버보안 담당, 제안자 본인 제외) */
export function SecurityMinTab() {
  useUiLocale();
  const q = useApi<SecurityMinsResp>('securityMins');
  const items = q.data?.items ?? [];
  return (
    <AsyncView state={asyncState(q, items.length === 0)} error={q.error ? S.error : null} onRetry={() => q.refetch()}>
      <div className="adsc-stack">
        <p className="adsc-note">{S.lead}</p>
        {q.data?.unregistered?.length ? <VerdictReason tone="danger" label={S.unregistered(q.data.unregistered)} /> : null}
        <Panel title={S.current} id="security-min-current" actions={<ProposeAction entries={items} />}>
          <DataTable
            caption={S.current}
            rows={q.data?.current ?? []}
            pageSize={0}
            rowKey={(r) => r.swId}
            columns={[
              { key: 'sw', header: S.col.sw, cell: (r) => <span className="ds-mono">{r.swId}</span> },
              { key: 'v', header: S.col.version, cell: (r) => <span className="ds-mono">{r.version}</span> },
            ]}
          />
        </Panel>
        <Panel title={`${S.history} · ${S.pending(q.data?.pending ?? 0)}`} id="security-min-history">
          <DataTable
            caption={S.history}
            rows={[...items].reverse()}
            pageSize={0}
            rowKey={(r) => r.entryId}
            columns={[
              { key: 'sw', header: S.col.sw, cell: (r) => <span className="ds-mono">{`${r.swId} ${r.version}`}</span> },
              { key: 's', header: S.col.status, cell: (r) => <VerdictReason tone={r.status === 'APPROVED' ? 'ok' : 'unknown'} label={S.statusLabel[r.status]} /> },
              { key: 'r', header: S.col.rationale, cell: (r) => r.rationale },
              { key: 'p', header: S.col.proposer, cell: (r) => <span className="adsc-cell">{personName(r.proposedBy)}<span className="adsc-sub">{when(r.proposedAt)}</span></span> },
              { key: 'a', header: S.col.approver, cell: (r) => (r.status === 'APPROVED' ? <span className="adsc-cell">{personName(r.approvedBy)}<span className="adsc-sub">{when(r.approvedAt)}</span></span> : <MinApprove entry={r} entries={items} />) },
            ]}
          />
        </Panel>
      </div>
    </AsyncView>
  );
}

function MinApprove({ entry, entries }: { entry: SecurityMinEntry; entries: SecurityMinEntry[] }) {
  useUiLocale();
  const perm = usePermission(['SECURITY_OFFICER']);
  const { role } = useAppShell();
  const [reason, setReason] = useState('');
  const approve = useApiMutation<SecurityMinEntry>('approveSecurityMin', INVALIDATE);
  if (!perm.ok) return <BlockedAction label={S.approve.action} reason={STATIC_MODE ? S.readOnly : S.approve.noPermission} />;
  if (actorFor(role, ['SECURITY_OFFICER']).id === entry.proposedBy) return <BlockedAction label={S.approve.action} reason={S.selfApproval} />;
  const stale = securityMinProposalBlocker(entries.filter((e) => e.entryId !== entry.entryId), entry.swId, entry.version);
  if (stale) return <BlockedAction label={S.approve.action} reason={S.blocker[stale.code] ?? stale.message} />;
  return (
    <div className="adsc-row">
      <Field label={S.approve.reason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button variant="primary" disabled={reason.trim().length < 2 || approve.isPending} onClick={() => approve.mutate({ params: { id: entry.entryId }, body: { reason } })}>
        {S.approve.action}
      </Button>
      <ErrorNote error={approve.error} />
    </div>
  );
}

function ProposeAction({ entries }: { entries: SecurityMinEntry[] }) {
  useUiLocale();
  const perm = usePermission(['SECURITY_OFFICER', 'VARIANT_OWNER']);
  const [open, setOpen] = useState(false);
  const [swId, setSwId] = useState('');
  const [version, setVersion] = useState('');
  const [rationale, setRationale] = useState('');
  const propose = useApiMutation<SecurityMinEntry>('proposeSecurityMin', INVALIDATE);
  if (!perm.ok) return <BlockedAction label={S.propose.action} reason={STATIC_MODE ? S.readOnly : S.propose.noPermission} />;
  const blocked = swId && /^\d+\.\d+\.\d+$/.test(version) ? securityMinProposalBlocker(entries, swId, version) : null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{S.propose.action}</Button>
      <Drawer open={open} title={S.propose.title} onClose={() => setOpen(false)}>
        <div className="adsc-stack">
          <Field label={S.propose.sw}>
            <input className="ds-input ds-input--mono" value={swId} onChange={(e) => setSwId(e.target.value.trim())} />
          </Field>
          <Field label={S.propose.version}>
            <input className="ds-input ds-input--mono" value={version} onChange={(e) => setVersion(e.target.value.trim())} />
          </Field>
          <Field label={S.propose.rationale}>
            <input className="ds-input" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </Field>
          <ErrorNote error={propose.error} />
          {blocked ? (
            <BlockedAction label={S.propose.submit} reason={S.blocker[blocked.code] ?? blocked.message} />
          ) : (
            <Button variant="primary" disabled={!swId || !version || rationale.trim().length < 2 || propose.isPending} onClick={() => propose.mutate({ body: { swId, version, rationale } }, { onSuccess: () => setOpen(false) })}>
              {S.propose.submit}
            </Button>
          )}
        </div>
      </Drawer>
    </>
  );
}

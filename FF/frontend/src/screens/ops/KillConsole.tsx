// /ops/kill — 긴급 기능 차단(Kill Switch)·복구 (D03-03 · D03-04, PoC ⑥). 보고서 v1.1 7~9장: 긴급 상황에도 사전 2인 승인을 생략하지 않는다.
// 요청(영향 범위·사유 분류·게이트 사전 점검·24시간 누적) → 서로 다른 2인 개인 서명 승인 → 게이트 최종 판정 → 서명·차량별 봉투 → 긴급 채널 → 차량 회신.
// 복원도 요청 → 차단 승인자와 다른 2인 승인. 승인 가능 여부는 서버와 같은 contracts approvalCheck로 미리 보인다.
// @rule FFG-PLT-003 — 화면: 비활성화 방식을 운영자가 고르지 않는다(Registry 등급 표시만)
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  approvalCheck,
  approvalPlan,
  deactStages,
  KILL_APPROVER_ROLES,
  REASON_CATEGORIES,
  reportRolesOf,
  type ApproverRole,
  type DeactClass,
  type FClass,
  type GateFinding,
  type ReasonCategory,
  type Role,
  type SafeMode,
  REPORT_APPROVER_ROLES,
} from '@ff/contracts';
import { actorFor, PLATFORM_ROLES } from '../../api/actor';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { PostReviewForm } from '../admin/Oversight';
import { usePlatformEvents } from '../../api/stream';
import { ko } from '../../copy/ko';
import {
  ApprovalSlots,
  AsyncView,
  Button,
  ClassBadges,
  DangerConfirm,
  DataTable,
  Drawer,
  ErrorNote,
  Explain,
  Field,
  IdChip,
  KeyValue,
  PageHeader,
  Panel,
  RuleChecklist,
  RuleText,
  Select,
  StageStrip,
  WindowGauge,
  type ApprovalSlot,
  type RuleItem,
} from '../../design';
import { usePermission, when } from '../shared';
import { Progress, PubStatus, type Delivery } from './shared';

const K = ko.kill;
const KILL_ROLES = ['OPERATOR', 'SAFETY_OFFICER'] as const;
const INVALIDATE = ['killRequests', 'killDetail', 'killEnvelopes', 'publications', 'fleetRuntime', 'activationDecide', 'audit', 'gateSnapshot'];

interface Approval {
  approverId: string;
  role: ApproverRole;
  signedAt: string;
  kid: string;
}
interface CommandRef {
  commandId: string;
  commandSeq: number;
  kid: string;
  issuedAt: string;
  envelopes: number;
}
interface Kill {
  killId: string;
  featureId: string;
  featureVersion: string;
  featureIds: string[];
  flagKeys: string[];
  vins: string[];
  safeMode?: SafeMode;
  reason: string;
  status: 'REQUESTED' | 'ACTIVE' | 'RELEASED' | 'REJECTED' | 'EXPIRED';
  requestedBy: string;
  requestedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  version?: 2;
  reasonCategory?: ReasonCategory;
  reasonCode?: string;
  fClass?: FClass;
  deactClass?: DeactClass;
  fsmRequired?: boolean;
  approvals?: Approval[];
  expiresAt?: string;
  gate?: { result: string; failed: string[] } | null;
  command?: CommandRef | null;
  rejectedBy?: string | null;
  rejectReason?: string | null;
  restoreRequest?: {
    requestedBy: string;
    requestedAt: string;
    reason: string;
    status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
    approvals: Approval[];
    gate: { failed: string[] } | null;
    command: CommandRef | null;
    rejectedBy: string | null;
    rejectReason: string | null;
  } | null;
  delivery: Delivery | null;
  restore: Delivery | null;
}
interface Preview {
  feature: { featureId: string; version: string; name: string; lifecycle: string; asil: string };
  featureIds: string[];
  dependents: { featureId: string; version: string | null; name: string }[];
  flagKeys: string[];
  vehicles: { vin: string; label: string; link: string; gleo: boolean }[];
  activeKill: string | null;
  registry: { f_class: FClass; deact_class: DeactClass; gsr_mandatory: boolean; profile?: Record<string, number> } | null;
  window: { hours: number; deactivate: number; cap: number };
  checks: GateFinding[];
}

/** 게이트 판정 + 승인 칸(대기)을 한 목록으로 — 승인 칸은 실시간 판정에서 '대기' */
function gateItems(checks: GateFinding[], fsm: boolean): RuleItem[] {
  return [
    ...checks.map((c) => ({ id: c.rule, status: c.ok ? ('pass' as const) : ('fail' as const), reason: c.message })),
    { id: 'FFG-PLT-005', status: 'pending' as const, reason: K.approvalPending(fsm) },
  ];
}

function NodeTable({ d, caption }: { d: Delivery; caption: string }) {
  return (
    <DataTable
      caption={caption}
      rows={d.nodes}
      rowKey={(n) => n.nodeId}
      columns={[
        {
          key: 'v',
          header: ko.fleet.vehicle,
          cell: (n) => (
            <Link className="ds-mono" to={`/fleet/vehicles/${encodeURIComponent(n.nodeId)}`}>
              {n.nodeId}
            </Link>
          ),
        },
        {
          key: 's',
          header: K.col.status,
          cell: (n) => (
            <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
              {n.state}
            </span>
          ),
        },
        {
          key: 'r',
          header: ko.audit.col.reason,
          cell: (n) => (
            <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
              {n.reason}
            </span>
          ),
        },
      ]}
    />
  );
}

function NewKill({ onDone }: { onDone: (k: Kill) => void }) {
  const perm = usePermission([...KILL_ROLES]);
  // 이상 징후 대응(/ops/anomalies)에서 넘어오면 대상 Feature·이상 건을 채워 둔다
  const [sp] = useSearchParams();
  const anomalyId = sp.get('anomaly');
  const [featureId, setFeatureId] = useState(sp.get('featureId') ?? 'FEAT-00022');
  const [featureVersion, setVersion] = useState(sp.get('version') ?? '1.0.0');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [category, setCategory] = useState<ReasonCategory>('SAFETY');
  const [code, setCode] = useState('FIELD_FAULT');
  const [recall, setRecall] = useState('');
  const [containment, setContainment] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const valid = /^FEAT-\d{5}$/.test(featureId) && /^\d+\.\d+\.\d+$/.test(featureVersion);
  const pv = useApi<Preview>(
    'killPreview',
    {
      query: {
        featureId,
        featureVersion,
        reasonCategory: category,
        vins: picked?.join(',') || undefined,
        recallCampaignId: recall.trim() || undefined,
        containmentJustification: containment.trim() || undefined,
      },
    },
    { enabled: valid, placeholderData: (prev) => prev },
  ); // 차량·사유를 바꿔도 패널이 깜박이지 않게 — 이전 결과를 보이며 다시 판정
  const issue = useApiMutation<Kill>('issueKill', INVALIDATE);
  const p = pv.data;
  const vins = picked ?? p?.vehicles.map((v) => v.vin) ?? [];
  const toggle = (vin: string) => setPicked(vins.includes(vin) ? vins.filter((x) => x !== vin) : [...vins, vin]);
  const reg = p?.registry;
  const safetyF2 = category === 'SAFETY' && !!reg && ['F2', 'F3', 'F4'].includes(reg.f_class);
  const needContainment = safetyF2 && !recall.trim() && !containment.trim();
  const locked = !!reg && (reg.deact_class === 'DC4' || reg.gsr_mandatory);
  const fsm = !!reg && approvalPlan(reg.f_class, 'deactivate', category).fsm;
  const missing = [
    !perm.ok && (perm.hint ?? ''),
    p?.activeKill && K.activeKill,
    locked && K.lockedDc4,
    p && !vins.length && K.needVehicles,
    !/^[A-Z0-9_]{3,40}$/.test(code) && K.needCode,
    needContainment && K.containment,
    reason.trim().length < 2 && ko.page.reason,
  ].filter(Boolean) as string[];
  const ready = !!p && !missing.length;
  return (
    <Panel
      title={
        <>
          {K.create} <Explain rules={['FFG-PLT-005', 'FFG-PLT-003', 'FFG-SEC-003', 'FFG-DEAC-010']} />
        </>
      }
      id="new-kill"
      tour="kill-request"
    >
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <Field label={K.feature}>
            <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => (setFeatureId(e.target.value.trim().toUpperCase()), setPicked(null))} />
          </Field>
          <Field label={ko.policy.field.version}>
            <input className="ds-input ds-input--mono" value={featureVersion} onChange={(e) => (setVersion(e.target.value.trim()), setPicked(null))} />
          </Field>
        </div>
        <AsyncView state={asyncState(pv)} error={pv.error?.message} onRetry={() => pv.refetch()}>
          {p && (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <KeyValue
                rows={[
                  {
                    k: K.preview,
                    v: <IdChip id={p.feature.featureId} version={p.feature.version} to={`/features/${p.feature.featureId}/${p.feature.version}?tab=safety`} copy={false} />,
                    note: `${p.feature.name} · ${p.feature.lifecycle} · ${K.asilRef(p.feature.asil)}`,
                  },
                  { k: K.deactMode, v: reg ? <ClassBadges f={reg.f_class} dc={reg.deact_class} /> : '—', note: K.deactByRegistry },
                  { k: K.dependents, v: <span className="ds-mono">{p.dependents.map((d) => d.featureId).join(', ') || '—'}</span> },
                  { k: K.flags, v: <span className="ds-mono">{p.flagKeys.join(', ') || '—'}</span> },
                ]}
              />
              {reg && !locked && <span className="ds-eyebrow ds-eyebrow--ko">{K.deactStages}</span>}
              {reg && !locked && (
                <StageStrip
                  caption={K.deactStages}
                  stages={deactStages(reg.deact_class, category === 'COMMERCIAL' || category === 'OPERATIONAL' ? 'COMMERCIAL' : 'SAFETY')}
                  current={0}
                  params={reg.profile}
                />
              )}
              {p.activeKill && (
                <p className="ds-stale" role="status">
                  {K.activeKill}: <Link to={`/ops/kill?id=${p.activeKill}`}>{p.activeKill}</Link>
                </p>
              )}
              <fieldset className="ds-choices" aria-label={K.vehicles}>
                <legend className="ds-field__label">
                  {K.vehicles} ({vins.length}/{p.vehicles.length})
                </legend>
                {p.vehicles.map((v) => (
                  <label key={v.vin} title={v.link === 'OFFLINE' ? K.offline : v.label}>
                    <input type="checkbox" checked={vins.includes(v.vin)} onChange={() => toggle(v.vin)} />
                    <span className="ds-dot" data-on={v.link === 'ONLINE'} aria-hidden="true" />
                    {v.vin}
                    {v.gleo ? ' · GLEO' : ''}
                  </label>
                ))}
              </fieldset>
              <WindowGauge used={p.window.deactivate} adding={vins.length} cap={p.window.cap} />
            </div>
          )}
        </AsyncView>
        {anomalyId && (
          <p className="ds-field__hint" role="status">
            {K.fromAnomaly}: <Link to={`/ops/anomalies?id=${anomalyId}`}>{anomalyId}</Link>
          </p>
        )}
        <div className="ds-form-grid">
          <Select label={K.reasonCategory} value={category} onChange={(e) => setCategory(e.target.value as ReasonCategory)}>
            {REASON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {K.reasonCategories[c]}
              </option>
            ))}
          </Select>
          <Field label={K.reasonCode}>
            <input className="ds-input ds-input--mono" value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} />
          </Field>
          {safetyF2 && (
            <>
              <Field label={K.recall}>
                <input className="ds-input ds-input--mono" value={recall} onChange={(e) => setRecall(e.target.value)} />
              </Field>
              <Field label={K.containment} hint={needContainment ? <RuleText text={K.containmentNeed} /> : undefined}>
                <input className="ds-input" value={containment} onChange={(e) => setContainment(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <Field label={ko.page.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        {p && reg && <RuleChecklist live caption={K.checks} items={gateItems(p.checks, fsm)} />}
        <ErrorNote error={issue.error} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="danger" icon="alert" disabled={!ready || issue.isPending} title={perm.hint} onClick={() => setConfirm(true)}>
            {K.issue}
          </Button>
          {p && missing.length > 0 && <span className="ds-field__hint">{K.needs(missing)}</span>}
        </div>
      </div>
      <DangerConfirm
        open={confirm}
        title={`${K.create} — ${featureId}`}
        body={K.confirmBody}
        confirmWord={featureId}
        actionLabel={K.issue}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          issue.mutate(
            {
              body: {
                featureId,
                featureVersion,
                vins,
                reasonCategory: category,
                reasonCode: code,
                reason,
                confirm: featureId,
                ...(recall.trim() && { recallCampaignId: recall.trim() }),
                ...(containment.trim() && { containmentJustification: containment.trim() }),
                ...(anomalyId && { anomalyId }),
              },
            },
            {
              onSuccess: (k) => {
                setConfirm(false);
                setReason('');
                setPicked(null);
                onDone(k);
              },
              onError: () => setConfirm(false),
            },
          )
        }
      />
    </Panel>
  );
}

/** 승인 칸 + 승인·거절 — 이 사람이 지금 승인할 수 있는지는 서버와 같은 approvalCheck로 */
function ApprovalBox({
  requestedBy,
  approvals,
  fsm,
  since,
  excluded,
  approveRoute,
  rejectRoute,
  id,
}: {
  requestedBy: string;
  approvals: Approval[];
  fsm: boolean;
  since: string;
  excluded?: string[];
  approveRoute: 'approveKill' | 'approveRestore';
  rejectRoute: 'rejectKill' | 'rejectRestore';
  id: string;
}) {
  const perm = usePermission(KILL_APPROVER_ROLES);
  const approve = useApiMutation<Kill>(approveRoute, INVALIDATE);
  const reject = useApiMutation<Kill>(rejectRoute, INVALIDATE);
  const [why, setWhy] = useState('');
  const me = actorFor(perm.role, KILL_APPROVER_ROLES);
  const myReport = reportRolesOf((PLATFORM_ROLES[perm.role] ?? []) as Role[]);
  const check = approvalCheck({ requestedBy, approvals, plan: { count: 2, fsm }, excluded }, { id: me.id, roles: myReport });
  const hasFsm = approvals.some((a) => a.role === 'FSM');
  // 빈 칸 역할: FSM이 필요하고 아직 없으면 첫 빈 칸이 FSM, 나머지는 그 밖의 승인 역할
  const slots: ApprovalSlot[] = [0, 1].map((i) => {
    const a = approvals[i];
    if (a) return { role: a.role, approver: { id: a.approverId, signedAt: a.signedAt } };
    const fsmSlot = fsm && !hasFsm && i === approvals.length;
    return { role: fsmSlot ? 'FSM' : K.anyApprover, approver: null, waitingSince: since };
  });
  const blocked =
    'code' in check
      ? (
          { SELF_APPROVAL: K.selfApproval, DUPLICATE: K.alreadyApproved, FSM_REQUIRED: K.fsmOnly, KILL_APPROVER: K.killApprover, NO_APPROVER_ROLE: K.approverRoleNeed, COMPLETE: '' } as Record<
            string,
            string
          >
        )[check.code]
      : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <ApprovalSlots requester={{ id: requestedBy }} slots={slots} />
      {blocked && <p className="ds-field__hint">{blocked}</p>}
      <ErrorNote error={approve.error ?? reject.error} />
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Button
          variant="primary"
          icon="pen"
          disabled={!perm.ok || !!blocked || approve.isPending}
          title={perm.hint ?? blocked ?? undefined}
          onClick={() => approve.mutate({ params: { id }, body: {}, actorRole: 'role' in check ? REPORT_APPROVER_ROLES[check.role] : undefined })}
        >
          {K.approve}
        </Button>
        <Field label={K.rejectReason}>
          <input className="ds-input" value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        <Button
          disabled={!perm.ok || why.trim().length < 2 || reject.isPending}
          title={perm.hint}
          onClick={() => reject.mutate({ params: { id }, body: { reason: why } }, { onSuccess: () => setWhy('') })}
        >
          {K.reject}
        </Button>
      </div>
    </div>
  );
}

interface Envelopes {
  envelopes: { request: string; scope: { vehicle_ids: string[] }; vehicle_auth: { key_epoch: number; vehicle_seq: number; cmd_auth: string } }[];
}

interface TimePt {
  at: string;
  trust: 'TRUSTED' | 'UNCERTAIN';
  timeSync: string;
}
interface TimelineRow {
  vin: string;
  deactivate: { commandId: string; accepted: TimePt | null; completed: TimePt | null } | null;
  restore: { commandId: string; accepted: TimePt | null; effective: TimePt | null } | null;
  cause: 'REMOTE_KILL' | 'ONBOARD_FAULT' | 'UNKNOWN';
  uncertain: string[];
}

/** 종료·복원 시간 기록 — 차량마다 다섯 시각, 신뢰 못 하는 시각은 흐리게 (FFG-ADS-007·TEL-004·TEL-010) */
function KillTimeline({ id }: { id: string }) {
  const P = ko.p11.kill;
  const q = useApi<{ items: TimelineRow[] }>('killTimeline', { params: { id } });
  const rows = q.data?.items ?? [];
  const pt = (p: TimePt | null | undefined) =>
    p ? (
      <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)', color: p.trust === 'UNCERTAIN' ? 'var(--warn)' : undefined }} title={p.trust === 'UNCERTAIN' ? `${P.uncertain} · ${p.timeSync}` : p.timeSync}>
        {when(p.at)}
      </span>
    ) : (
      '—'
    );
  const C = P.col;
  return (
    <section style={{ display: 'grid', gap: 'var(--sp-2)' }} data-testid="kill-timeline">
      <h3 className="ds-eyebrow ds-eyebrow--ko">{P.timeline}</h3>
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: P.timelineEmpty }} error={q.error?.message} rows={2}>
        <DataTable
          caption={P.timeline}
          rows={rows}
          rowKey={(r) => r.vin}
          columns={[
            { key: 'v', header: C.vin, cell: (r) => <span className="ds-mono ds-nowrap">{r.vin}</span> },
            { key: 'a', header: C.accepted, cell: (r) => pt(r.deactivate?.accepted) },
            { key: 'c', header: C.completed, cell: (r) => pt(r.deactivate?.completed) },
            { key: 'ra', header: C.restoreAccepted, cell: (r) => pt(r.restore?.accepted) },
            { key: 'e', header: C.effective, cell: (r) => pt(r.restore?.effective) },
            { key: 'k', header: C.cause, cell: (r) => P.cause[r.cause] ?? r.cause },
          ]}
        />
      </AsyncView>
    </section>
  );
}

/** 긴급 권한(Kill 발행)의 24시간 사후 독립 검토 (FFG-PLT-016) */
function PostReview({ id }: { id: string }) {
  const q = useApi<{ items: { killId: string; due: string; status: 'REVIEWED' | 'PENDING' | 'OVERDUE'; review: any; issuedAt: string; featureId: string; requestedBy: string; approvers: string[] }[] }>('killPostReviews');
  const row = q.data?.items.find((r) => r.killId === id);
  if (!row) return null;
  return (
    <section style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <h3 className="ds-eyebrow ds-eyebrow--ko">{ko.p11.kill.postReview}</h3>
      <PostReviewForm killId={id} row={row} />
    </section>
  );
}

function KillDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<Kill>('killDetail', { params: { id: id ?? '' } }, { enabled: !!id });
  const env = useApi<Envelopes>('killEnvelopes', { params: { id: id ?? '' } }, { enabled: !!id && !!q.data?.command });
  const perm = usePermission([...KILL_ROLES]);
  const release = useApiMutation('releaseKill', INVALIDATE);
  const requestRestore = useApiMutation('requestRestore', INVALIDATE);
  const [reason, setReason] = useState('');
  const k = q.data;
  const v2 = k?.version === 2;
  const rr = k?.restoreRequest;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {k && (
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <KeyValue
            rows={[
              { k: K.col.feature, v: <span className="ds-mono">{k.featureIds.join(', ')}</span> },
              { k: K.deactMode, v: v2 ? <ClassBadges f={k.fClass} dc={k.deactClass} /> : <span className="ds-tag">{`${K.legacy} · ${K.appliedAs[k.safeMode ?? 'SAFE_DEFAULT']}`}</span> },
              {
                k: K.col.status,
                v: <span className="ds-mono">{K.status[k.status]}</span>,
                note: k.releasedAt ? `${k.releasedBy} · ${when(k.releasedAt)}` : k.expiresAt && k.status === 'REQUESTED' ? `${K.expiresAt} ${when(k.expiresAt)}` : undefined,
              },
              { k: K.reasonCategory, v: v2 ? `${K.reasonCategories[k.reasonCategory ?? 'SAFETY']} · ${k.reasonCode}` : '—' },
              { k: ko.page.reason, v: k.reason },
              ...(k.rejectReason ? [{ k: K.reject, v: k.rejectReason, note: k.rejectedBy ?? undefined }] : []),
            ]}
          />
          {v2 && (
            <>
              <h3 className="ds-eyebrow ds-eyebrow--ko">{K.approvals}</h3>
              {k.status === 'REQUESTED' ? (
                <ApprovalBox requestedBy={k.requestedBy} approvals={k.approvals ?? []} fsm={!!k.fsmRequired} since={k.requestedAt} approveRoute="approveKill" rejectRoute="rejectKill" id={k.killId} />
              ) : (
                <ApprovalSlots requester={{ id: k.requestedBy }} slots={(k.approvals ?? []).map((a) => ({ role: a.role, approver: { id: a.approverId, signedAt: a.signedAt } }))} />
              )}
            </>
          )}
          {k.gate && k.gate.failed.length > 0 && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <p className="ds-field__hint" role="status">
                {K.gateRejected}
              </p>
              <RuleChecklist caption={K.gate} items={k.gate.failed.map((r) => ({ id: r, status: 'fail' as const }))} />
            </div>
          )}
          {k.command && (
            <KeyValue
              rows={[
                { k: K.command, v: <span className="ds-mono" title={k.command.commandId}>{`${k.command.commandId.slice(0, 8)}…`}</span> },
                { k: K.commandSeq, v: <span className="ds-mono">{k.command.commandSeq}</span>, note: `${K.kid} ${k.command.kid}` },
              ]}
            />
          )}
          {env.data && env.data.envelopes.length > 0 && (
            <DataTable
              caption={K.envelopes}
              rows={env.data.envelopes}
              rowKey={(e) => `${e.request}-${e.scope.vehicle_ids[0]}`}
              columns={[
                { key: 'v', header: K.envCol.vin, cell: (e) => <span className="ds-mono ds-nowrap">{e.scope.vehicle_ids[0]}</span> },
                { key: 'r', header: K.envCol.request, cell: (e) => <span className="ds-mono">{e.request}</span> },
                { key: 's', header: K.envCol.seq, cell: (e) => <span className="ds-mono ds-nowrap">{`e${e.vehicle_auth.key_epoch} · #${e.vehicle_auth.vehicle_seq}`}</span> },
                { key: 'a', header: K.envCol.auth, cell: (e) => <span className="ds-mono" title={e.vehicle_auth.cmd_auth}>{`${e.vehicle_auth.cmd_auth.slice(0, 8)}…`}</span> },
              ]}
            />
          )}
          {k.delivery && (
            <>
              <h3 className="ds-eyebrow">
                {K.delivery} · <Link to={`/deployments/${k.delivery.publicationId}`}>{k.delivery.publicationId}</Link>
              </h3>
              <Progress d={k.delivery} />
              <NodeTable d={k.delivery} caption={K.delivery} />
            </>
          )}
          {k.restore && (
            <>
              <h3 className="ds-eyebrow">
                {K.restore} · <Link to={`/deployments/${k.restore.publicationId}`}>{k.restore.publicationId}</Link>
              </h3>
              <Progress d={k.restore} />
            </>
          )}
          {k.command && <KillTimeline id={k.killId} />}
          {k.command && <PostReview id={k.killId} />}
          {k.status === 'ACTIVE' && v2 && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }} data-tour="kill-restore">
              <h3 className="ds-eyebrow ds-eyebrow--ko">
                {K.restoreTitle} <Explain rules={['FFG-DEAC-008', 'FFG-PLT-008', 'FFG-PLT-010']} />
              </h3>
              <p className="ds-field__hint">{K.restoreBody}</p>
              {rr?.status === 'REQUESTED' ? (
                <ApprovalBox
                  requestedBy={rr.requestedBy}
                  approvals={rr.approvals}
                  fsm={!!k.fsmRequired}
                  since={rr.requestedAt}
                  excluded={(k.approvals ?? []).map((a) => a.approverId)}
                  approveRoute="approveRestore"
                  rejectRoute="rejectRestore"
                  id={k.killId}
                />
              ) : (
                <>
                  {rr?.status === 'REJECTED' && (
                    <p className="ds-field__hint" role="status">
                      {K.restoreRejected}: {rr.rejectReason}
                    </p>
                  )}
                  <Field label={ko.page.reason}>
                    <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
                  </Field>
                  <ErrorNote error={requestRestore.error} />
                  <Button
                    variant="primary"
                    disabled={!perm.ok || reason.trim().length < 2 || requestRestore.isPending}
                    title={perm.hint}
                    onClick={() => requestRestore.mutate({ params: { id: k.killId }, body: { reason } }, { onSuccess: () => setReason('') })}
                  >
                    {K.restoreRequest}
                  </Button>
                </>
              )}
            </div>
          )}
          {k.status === 'ACTIVE' && !v2 && (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <p className="ds-field__hint">{K.releaseBody}</p>
              <Field label={ko.page.reason}>
                <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
              </Field>
              <ErrorNote error={release.error} />
              <Button
                variant="primary"
                disabled={!perm.ok || reason.trim().length < 2 || release.isPending}
                title={perm.hint}
                onClick={() => release.mutate({ params: { id: k.killId }, body: { reason } }, { onSuccess: () => setReason('') })}
              >
                {K.release}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function KillConsole() {
  const q = useApi<{ items: Kill[] }>('killRequests');
  usePlatformEvents(['kill.', 'publication.', 'vehicle.readback'], ['killRequests', 'killDetail', 'killEnvelopes']);
  // 상세는 라우터 검색 파라미터로 연다 — 검토함 등 앱 안 이동(/ops/kill?id=…)에서도 열린다
  const [sp] = useSearchParams();
  const [open, setOpen] = useState<string | null>(() => sp.get('id'));
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader eyebrow="D03-03 · D03-04 · KILL / RESTORE" title={K.title} lead={K.lead} />
      <div className="ds-split ds-split--wide-side">
        <NewKill onDone={(k) => setOpen(k.killId)} />
        <Panel title={K.list} id="kills">
          <AsyncView state={asyncState(q, rows.length === 0)} error={q.error?.message} onRetry={() => q.refetch()}>
            <DataTable
              caption={K.title}
              rows={rows}
              rowKey={(k) => k.killId}
              onOpen={(k) => setOpen(k.killId)}
              columns={[
                {
                  key: 'id',
                  header: K.col.id,
                  cell: (k) => (
                    <span style={{ display: 'grid', gap: 2 }} title={when(k.requestedAt)}>
                      <span className="ds-mono ds-nowrap">{k.killId}</span>
                      <span className="ds-mono ds-nowrap" style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
                        {K.rowScope(k.featureIds.join(', '), k.vins.length)}
                      </span>
                    </span>
                  ),
                  sort: (k) => k.killId,
                },
                {
                  key: 's',
                  header: K.col.status,
                  cell: (k) =>
                    k.status === 'ACTIVE' ? (
                      <PubStatus status={k.delivery?.status ?? 'SIGNED'} />
                    ) : k.status === 'REQUESTED' ? (
                      <span className="ds-tag">{K.approvalsCount(k.approvals?.length ?? 0)}</span>
                    ) : (
                      <span className="ds-mono">{K.status[k.status]}</span>
                    ),
                },
                { key: 'd', header: K.col.delivery, cell: (k) => <Progress d={k.status === 'RELEASED' ? k.restore : k.delivery} /> },
              ]}
            />
          </AsyncView>
        </Panel>
      </div>
      <KillDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

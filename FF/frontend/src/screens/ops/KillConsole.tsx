// /ops/kill — 긴급 기능 차단(Kill Switch)·복구 (D03-03 · D03-04, PoC ⑥). 보고서 v1.1 7~9장: 긴급 상황에도 사전 2인 승인을 생략하지 않는다.
// 요청(영향 범위·사유 분류·게이트 사전 점검·24시간 누적) → 서로 다른 2인 개인 서명 승인 → 게이트 최종 판정 → 서명·차량별 봉투 → 긴급 채널 → 차량 회신.
// 복원도 요청(재검증 Evidence·Canary Cohort, 단계적) → 차단 승인자와 다른 2인 승인. 승인 가능 여부·서명 역할·복원 전망은 서버와 같은 contracts 규칙으로 미리 보인다.
// @rule FFG-PLT-003 — 화면: 비활성화 방식을 운영자가 고르지 않는다(Registry 등급 표시만)
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  approvalCheck,
  approvalPlan,
  deactStages,
  KILL_APPROVER_ROLES,
  NOTIFICATION_ACCOUNTS,
  REASON_CATEGORIES,
  reportRolesOf,
  requiredRoles,
  restoreOutlook,
  type ApprovalPlan,
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
import { APPROVER_ROLE, control as CT, DEPT_SIGN_ROLE } from '../../copy/control';
import { useDefaultFeature } from '../../data/first-run';
import { useAppShell } from '../../store';
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
import { nodeReasonLabel, nodeStateLabel, personLabel, Progress, PubStatus, type Delivery } from './shared';

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
    evidenceRef?: string | null;
    cohort?: string[];
  } | null;
  /** F2 이상 안전 Kill — 리콜·봉쇄 근거와 시장별 결함 보고 기한(FFG-DEAC-010) */
  recallCampaignId?: string | null;
  containmentJustification?: string | null;
  recallReports?: { market: string; due: string | null; basis: string; note: string | null }[];
  /** 단계적 복원 — 복원한 차량·단계 기록 */
  restoredVins?: string[];
  restoreStages?: { cohort: string[]; evidenceRef: string | null; publicationId: string; approvedAt: string; approvers: string[] }[];
  /** 상세만 — 승인 대기면 다음 칸 후보, 차단 중이면 복원 전망(직전 차단 승인자 제외) */
  approverCandidates?: { id: string; roles: ApproverRole[] }[];
  restoreOutlook?: { candidates: { id: string; roles: ApproverRole[] }[]; byRole: { role: ApproverRole; ids: string[] }[]; missing: ApproverRole[]; complete: boolean };
  delivery: Delivery | null;
  restore: Delivery | null;
}

/** 승인 후보 계정(데모 IAM, 서버 알림 수신 계정과 같은 표) — 보고서 승인 역할로 */
const ACCOUNTS = NOTIFICATION_ACCOUNTS.map((a) => ({ id: a.id, roles: reportRolesOf(a.roles) })).filter((a) => a.roles.length > 0);
const roleNames = (rs: readonly ApproverRole[]) => rs.map((r) => APPROVER_ROLE[r]).join(' + ');
/** 승인 안내 — 필수 역할 쌍(차단 FSM+CSM, 복원 FSM 포함) */
const planNote = (plan: ApprovalPlan, request: 'deactivate' | 'restore') => {
  const need = requiredRoles(plan);
  if (!need.length) return K.approvalPending(false);
  return request === 'deactivate' ? CT.approval.pair(roleNames(need)) : CT.approval.restorePair(roleNames(need));
};
/** 후보 목록 — 이름(맡을 역할) */
function Candidates({ title, items }: { title: string; items: { id: string; roles: ApproverRole[] }[] }) {
  return (
    <p className="ds-field__hint" data-testid="approver-candidates">
      <strong>{title}</strong> · {items.length ? items.map((c) => `${personLabel(c.id)} — ${roleNames(c.roles)}`).join(' / ') : CT.approval.candidatesNone}
    </p>
  );
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
function gateItems(checks: GateFinding[], plan: ApprovalPlan): RuleItem[] {
  return [
    ...checks.map((c) => ({ id: c.rule, status: c.ok ? ('pass' as const) : ('fail' as const), reason: c.message })),
    { id: 'FFG-PLT-005', status: 'pending' as const, reason: planNote(plan, 'deactivate') },
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
            <span style={{ fontSize: 'var(--fs-xs)' }} title={n.state}>
              {nodeStateLabel(n.state)}
            </span>
          ),
        },
        {
          key: 'r',
          header: ko.audit.col.reason,
          cell: (n) => (
            <span style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }} title={n.reason}>
              {nodeReasonLabel(n.reason)}
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
  // 사용자가 적기 전에는 예시 Feature(있으면)·첫 Feature — 없는 데모 ID를 미리 채우지 않는다(출시 준비 RD-OPS-02)
  const [typedId, setFeatureId] = useState<string | null>(sp.get('featureId'));
  const [typedVer, setVersion] = useState<string | null>(sp.get('featureId') ? (sp.get('version') ?? '1.0.0') : null);
  const fallback = useDefaultFeature({ featureId: 'FEAT-00022', version: '1.0.0' }, typedId === null);
  const featureId = typedId ?? fallback?.featureId ?? '';
  const featureVersion = typedVer ?? (typedId === null ? fallback?.version : undefined) ?? '';
  const [picked, setPicked] = useState<string[] | null>(null);
  const [category, setCategory] = useState<ReasonCategory>('SAFETY');
  const [code, setCode] = useState('FIELD_FAULT');
  const [recall, setRecall] = useState('');
  const [containment, setContainment] = useState('');
  const [defectAt, setDefectAt] = useState('');
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
  const plan = reg ? approvalPlan(reg.f_class, 'deactivate', category) : approvalPlan('F0', 'deactivate', category);
  const missing = [
    !perm.ok && (perm.hint ?? ''),
    p?.activeKill && K.activeKill,
    locked && K.lockedDc4,
    p && !vins.length && K.needVehicles,
    !/^[A-Z0-9_]{3,40}$/.test(code) && K.needCode,
    needContainment && K.containment,
    reason.trim().length < 2 && ko.page.reason,
    p?.checks.some((c) => !c.ok) && K.precheckFail, // 최종 게이트에서 막힐 요청은 받지 않는다(UX3-03)
  ].filter(Boolean) as string[];
  const ready = !!p && !missing.length;
  return (
    <div id="new-kill">
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <Field label={K.feature}>
            <input className="ds-input ds-input--mono" value={featureId} onChange={(e) => (setFeatureId(e.target.value.trim().toUpperCase()), setPicked(null))} />
          </Field>
          <Field label={ko.policy.field.version}>
            <input className="ds-input ds-input--mono" value={featureVersion} onChange={(e) => (setVersion(e.target.value.trim()), setPicked(null))} />
          </Field>
        </div>
        <AsyncView state={asyncState(pv)} error={pv.error} onRetry={() => pv.refetch()}>
          {p && (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <KeyValue
                rows={[
                  {
                    k: K.preview,
                    v: <IdChip id={p.feature.featureId} version={p.feature.version} to={`/features/${p.feature.featureId}/${p.feature.version}?tab=safety`} copy={false} />,
                    note: `${p.feature.name} · ${p.feature.lifecycle} · ${K.asilRef(p.feature.asil)}`,
                  },
                  { k: K.deactMode, v: reg ? <ClassBadges f={reg.f_class} dc={reg.deact_class} /> : '—', note: <RuleText text={K.deactByRegistry} explain /> },
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
              <Field label={K.containment} hint={needContainment ? <RuleText text={K.containmentNeed} explain /> : undefined}>
                <input className="ds-input" value={containment} onChange={(e) => setContainment(e.target.value)} />
              </Field>
              <Field label={K.defectAt} hint={K.defectAtHint}>
                <input className="ds-input" type="datetime-local" value={defectAt} onChange={(e) => setDefectAt(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <Field label={ko.page.reason}>
          <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
        </Field>
        {p && reg && <RuleChecklist live caption={K.checks} items={gateItems(p.checks, plan)} />}
        <ErrorNote error={issue.error} />
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="danger" icon="alert" disabled={!ready || issue.isPending} title={perm.hint} reason={p && missing.length ? K.needs(missing) : undefined} onClick={() => setConfirm(true)}>
            {K.issue}
          </Button>
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
                ...(safetyF2 && defectAt && { defectDeterminedAt: new Date(defectAt).toISOString() }),
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
    </div>
  );
}

/**
 * 승인 칸 + 승인·거절 — 이 사람이 지금 승인할 수 있는지·어느 역할로 서명하는지는 서버와 같은 approvalCheck로.
 * 여러 승인 역할을 가진 사람은 서명 역할을 고른다(기본은 부서 보기의 역할, P3-2). 차단 두 번째 승인 전에는 복원 전망을 본다(P4-1).
 */
function ApprovalBox({
  requestedBy,
  approvals,
  plan,
  since,
  excluded,
  approveRoute,
  rejectRoute,
  id,
  candidates,
  restorePlan,
}: {
  requestedBy: string;
  approvals: Approval[];
  plan: ApprovalPlan;
  since: string;
  excluded?: string[];
  approveRoute: 'approveKill' | 'approveRestore';
  rejectRoute: 'rejectKill' | 'rejectRestore';
  id: string;
  /** 서버가 계산한 다음 칸 후보(상세) — 없으면 같은 규칙으로 화면이 계산 */
  candidates?: { id: string; roles: ApproverRole[] }[];
  /** 차단 승인일 때 — 이 승인 뒤 복원을 끝낼 수 있는지 미리 본다 */
  restorePlan?: ApprovalPlan;
}) {
  const perm = usePermission(KILL_APPROVER_ROLES);
  const { department } = useAppShell();
  const approve = useApiMutation<Kill>(approveRoute, INVALIDATE);
  const reject = useApiMutation<Kill>(rejectRoute, INVALIDATE);
  const [why, setWhy] = useState('');
  const [picked, setPicked] = useState<ApproverRole | null>(null);
  const me = actorFor(perm.role, KILL_APPROVER_ROLES);
  const myReport = reportRolesOf((PLATFORM_ROLES[perm.role] ?? []) as Role[]);
  const s = { requestedBy, approvals, plan, excluded };
  // 고를 수 있는 서명 역할 — 그 역할로 서명이 허용되는 것만(남은 필수 역할을 막지 않는 것)
  const options = myReport.filter((r) => {
    const c = approvalCheck(s, { id: me.id, roles: myReport }, r);
    return c.ok && c.role === r;
  });
  const deptRole = DEPT_SIGN_ROLE[department];
  const preferred = picked && options.includes(picked) ? picked : deptRole && options.includes(deptRole) ? deptRole : undefined;
  const check = approvalCheck(s, { id: me.id, roles: myReport }, preferred);
  // 빈 칸 역할: 아직 빠진 필수 역할(차단 FSM·CSM, 복원 FSM)부터, 나머지는 그 밖의 승인 역할
  const missing = requiredRoles(plan).filter((r) => !approvals.some((a) => a.role === r));
  const slots: ApprovalSlot[] = [0, 1].map((i) => {
    const a = approvals[i];
    if (a) return { role: APPROVER_ROLE[a.role] ?? a.role, approver: { id: a.approverId, name: personLabel(a.approverId), signedAt: a.signedAt } };
    const need = missing[i - approvals.length];
    return { role: need ? APPROVER_ROLE[need] : K.anyApprover, approver: null, waitingSince: since };
  });
  const blocked =
    'code' in check
      ? (
          { SELF_APPROVAL: K.selfApproval, DUPLICATE: K.alreadyApproved, FSM_REQUIRED: K.fsmOnly, CSM_REQUIRED: CT.approval.csmOnly, KILL_APPROVER: K.killApprover, NO_APPROVER_ROLE: K.approverRoleNeed, COMPLETE: '' } as Record<
            string,
            string
          >
        )[check.code]
      : null;
  const next = candidates ?? ACCOUNTS.map((a) => ({ id: a.id, roles: a.roles.filter((r) => approvalCheck(s, { id: a.id, roles: [r] }).ok) })).filter((a) => a.roles.length);
  // 차단의 마지막 칸 — 내가 승인하면 차단 승인자(나 포함)가 복원에서 빠진다. 복원할 FSM이 남는가(P4-1)
  const deadEnd =
    restorePlan && 'role' in check && approvals.length === plan.count - 1 ? restoreOutlook(ACCOUNTS, restorePlan, [...approvals.map((a) => a.approverId), me.id]) : null;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <ApprovalSlots requester={{ id: requestedBy, name: personLabel(requestedBy) }} slots={slots} />
      <p className="ds-field__hint">{planNote(plan, restorePlan ? 'deactivate' : 'restore')}</p>
      <Candidates title={CT.approval.candidates} items={next} />
      {blocked && <p className="ds-field__hint">{blocked}</p>}
      {deadEnd && !deadEnd.complete && (
        <div className="ds-stale" role="alert" data-testid="restore-dead-end">
          <p style={{ margin: 0 }}>{CT.approval.deadEnd(roleNames(deadEnd.missing.length ? deadEnd.missing : requiredRoles(restorePlan!)))}</p>
          <p style={{ margin: 0 }}>{CT.approval.escalate}</p>
        </div>
      )}
      <ErrorNote error={approve.error ?? reject.error} />
      {options.length > 1 && (
        <Select label={CT.approval.signAs} value={'role' in check ? check.role : ''} onChange={(e) => setPicked(e.target.value as ApproverRole)} data-testid="sign-as">
          {options.map((r) => (
            <option key={r} value={r}>
              {APPROVER_ROLE[r]}
            </option>
          ))}
        </Select>
      )}
      {options.length > 1 && <p className="ds-field__hint">{CT.approval.signAsHint}</p>}
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
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-2)', minWidth: 0 }} data-testid="kill-timeline" data-tour="kill-timeline">
      <h3 className="ds-eyebrow ds-eyebrow--ko">{P.timeline}</h3>
      <AsyncView state={asyncState(q, rows.length === 0)} empty={{ title: P.timelineEmpty }} error={q.error} rows={2}>
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
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-2)', minWidth: 0 }}>
      <h3 className="ds-eyebrow ds-eyebrow--ko">{ko.p11.kill.postReview}</h3>
      <PostReviewForm killId={id} row={row} />
    </section>
  );
}

/** 복원 전망 — 직전 차단 승인자를 빼고 복원을 승인할 수 있는 사람과, 없을 때 상위 대응(P4-1) */
function RestoreOutlookNote({ k }: { k: Kill }) {
  const o = k.restoreOutlook;
  if (!o) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-1)', minWidth: 0 }} data-testid="restore-outlook">
      {o.complete ? (
        <Candidates title={CT.approval.restoreWho} items={o.candidates} />
      ) : (
        <div className="ds-stale" role="alert">
          <p style={{ margin: 0 }}>{CT.approval.restoreBlocked(roleNames(o.missing.length ? o.missing : ['FSM']))}</p>
          <p style={{ margin: 0 }}>{CT.approval.escalate}</p>
        </div>
      )}
    </div>
  );
}

/** 단계적 복원 기록(FPW.8-A10) */
function RestoreStages({ k }: { k: Kill }) {
  const C = CT.restore.stageCol;
  return (
    <DataTable
      caption={CT.restore.stages}
      rows={(k.restoreStages ?? []).map((s, i) => ({ ...s, no: i + 1 }))}
      rowKey={(s) => s.publicationId}
      columns={[
        { key: 'n', header: C.no, cell: (s) => <span className="ds-mono">{s.no}</span> },
        { key: 'c', header: C.cohort, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.cohort.map((vin, i) => <span key={vin}>{i > 0 ? ', ' : ''}<span className="ds-nowrap">{vin}</span></span>)}</span> },
        { key: 'e', header: C.evidence, cell: (s) => <span className="ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.evidenceRef ?? '—'}</span> },
        { key: 'p', header: C.pub, cell: (s) => <Link className="ds-mono ds-nowrap" to={`/deployments/${s.publicationId}`}>{s.publicationId}</Link> },
      ]}
    />
  );
}

/**
 * 복원 요청 폼 — 사유 + 재검증 Evidence(이 Feature의 판정 근거) + 이번 단계 Canary Cohort(FPW.8-A08 종료 기준).
 * 남은 차량 일부만 고르면 단계적 복원(A10) — 관측 뒤 다시 요청해 넓힌다. 빠진 것이 있으면 버튼이 이유와 함께 막힌다.
 */
function RestoreForm({ k }: { k: Kill }) {
  const perm = usePermission([...KILL_ROLES]);
  const requestRestore = useApiMutation('requestRestore', INVALIDATE);
  const ev = useApi<{ items: { evidenceRef: string; gate: string; featureVersion: string; inputResult: string }[] }>('evidenceLedger', { query: { featureId: k.featureId } });
  const done = new Set(k.restoredVins ?? []);
  const left = k.vins.filter((v) => !done.has(v));
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [cohort, setCohort] = useState<string[] | null>(null);
  // Evidence — 이 Feature Version의 PASS 판정 근거, G5(검증)를 앞으로
  const options = [...(ev.data?.items ?? [])]
    .filter((e) => e.inputResult === 'PASS')
    .sort((a, b) => Number(b.gate === 'G5') - Number(a.gate === 'G5') || Number(b.featureVersion === k.featureVersion) - Number(a.featureVersion === k.featureVersion));
  const picked = evidence || options[0]?.evidenceRef || '';
  // 기본 Cohort — Canary 표시 차량이 있으면 그 차량, 없으면 남은 첫 차량(한 대부터 넓힌다)
  const chosen = cohort ?? left.slice(0, 1);
  const toggle = (vin: string) => setCohort(chosen.includes(vin) ? chosen.filter((x) => x !== vin) : [...chosen, vin]);
  const missing = [!perm.ok && (perm.hint ?? ''), reason.trim().length < 2 && CT.restore.needReason, !picked && CT.restore.needEvidence, !chosen.length && CT.restore.needCohort].filter(Boolean) as string[];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-2)', minWidth: 0 }} data-testid="restore-form">
      {!!done.size && <p className="ds-field__hint">{CT.restore.progress(done.size, k.vins.length)}</p>}
      <Field label={ko.page.reason}>
        <textarea className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ko.page.reasonPlaceholder} />
      </Field>
      {options.length ? (
        <Select label={CT.restore.evidence} value={picked} onChange={(e) => setEvidence(e.target.value)} style={{ minWidth: 0, width: '100%', maxWidth: '100%' }} title={picked} data-testid="restore-evidence">
          {options.map((e) => (
            <option key={e.evidenceRef} value={e.evidenceRef}>
              {`${e.gate} · ${e.featureVersion} · ${e.evidenceRef}`}
            </option>
          ))}
        </Select>
      ) : (
        <p className="ds-stale" role="status">
          {CT.restore.evidenceNone}
        </p>
      )}
      <p className="ds-field__hint">{CT.restore.evidenceHint}</p>
      <fieldset className="ds-choices" aria-label={CT.restore.cohort} data-testid="restore-cohort">
        <legend className="ds-field__label">
          {CT.restore.cohort} ({chosen.length}/{left.length})
        </legend>
        {left.map((vin) => (
          <label key={vin}>
            <input type="checkbox" checked={chosen.includes(vin)} onChange={() => toggle(vin)} />
            {vin}
          </label>
        ))}
      </fieldset>
      <p className="ds-field__hint">{CT.restore.cohortHint}</p>
      <ErrorNote error={requestRestore.error} />
      <Button
        variant="primary"
        data-ui="requestRestore"
        disabled={!!missing.length || requestRestore.isPending}
        title={perm.hint}
        reason={missing.length ? K.needs(missing) : undefined}
        onClick={() =>
          requestRestore.mutate({ params: { id: k.killId }, body: { reason, evidenceRef: picked, cohort: chosen } }, { onSuccess: () => (setReason(''), setCohort(null)) })
        }
      >
        {K.restoreRequest}
      </Button>
    </div>
  );
}

function KillDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApi<Kill>('killDetail', { params: { id: id ?? '' } }, { enabled: !!id });
  const env = useApi<Envelopes>('killEnvelopes', { params: { id: id ?? '' } }, { enabled: !!id && !!q.data?.command });
  const release = useApiMutation('releaseKill', INVALIDATE);
  const perm = usePermission([...KILL_ROLES]);
  const [reason, setReason] = useState('');
  const k = q.data;
  const v2 = k?.version === 2;
  const rr = k?.restoreRequest;
  return (
    <Drawer open={!!id} title={id ?? ''} onClose={onClose}>
      {k && (
        // 좁은 서랍(1366 폭) — 긴 ID·이름은 줄을 바꾸고, 표는 제 칸 안에서 가로로 넘긴다(P4-10)
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-3)', minWidth: 0, overflowWrap: 'anywhere' }} data-testid="kill-drawer">
          <KeyValue
            rows={[
              { k: K.col.feature, v: <span className="ds-mono">{k.featureIds.join(', ')}</span> },
              { k: K.deactMode, v: v2 ? <ClassBadges f={k.fClass} dc={k.deactClass} /> : <span className="ds-tag">{`${K.legacy} · ${K.appliedAs[k.safeMode ?? 'SAFE_DEFAULT']}`}</span> },
              {
                k: K.col.status,
                v: <span title={k.status}>{k.status === 'ACTIVE' && k.restoredVins?.length ? CT.restore.activeWithRestore(k.restoredVins.length, k.vins.length) : K.status[k.status]}</span>,
                note: k.releasedAt ? `${personLabel(k.releasedBy ?? '')} · ${when(k.releasedAt)}` : k.expiresAt && k.status === 'REQUESTED' ? `${K.expiresAt} ${when(k.expiresAt)}` : undefined,
              },
              { k: K.reasonCategory, v: v2 ? `${K.reasonCategories[k.reasonCategory ?? 'SAFETY']} · ${k.reasonCode}` : '—' },
              { k: ko.page.reason, v: k.reason },
              ...(k.rejectReason ? [{ k: K.reject, v: k.rejectReason, note: k.rejectedBy ? personLabel(k.rejectedBy) : undefined }] : []),
            ]}
          />
          {(k.recallCampaignId || k.containmentJustification || !!k.recallReports?.length) && (
            <div data-tour="kill-recall">
              <KeyValue
                rows={[
                  { k: K.recall, v: <span className="ds-mono">{k.recallCampaignId ?? '—'}</span> },
                  ...(k.containmentJustification ? [{ k: K.containment, v: k.containmentJustification }] : []),
                  ...(k.recallReports ?? []).map((r) => ({ k: K.recallDue(r.market), v: <span className="ds-mono" data-due={r.due ?? undefined}>{r.due ? when(r.due) : '—'}</span>, note: r.note ?? r.basis })),
                ]}
              />
            </div>
          )}
          {v2 && (
            <>
              <h3 className="ds-eyebrow ds-eyebrow--ko">{K.approvals}</h3>
              {k.status === 'REQUESTED' ? (
                <ApprovalBox
                  requestedBy={k.requestedBy}
                  approvals={k.approvals ?? []}
                  plan={approvalPlan(k.fClass ?? 'F0', 'deactivate', k.reasonCategory ?? 'SAFETY')}
                  restorePlan={approvalPlan(k.fClass ?? 'F0', 'restore', k.reasonCategory ?? 'SAFETY')}
                  since={k.requestedAt}
                  approveRoute="approveKill"
                  rejectRoute="rejectKill"
                  id={k.killId}
                  candidates={k.approverCandidates}
                />
              ) : (
                <ApprovalSlots
                  requester={{ id: k.requestedBy, name: personLabel(k.requestedBy) }}
                  slots={(k.approvals ?? []).map((a) => ({ role: APPROVER_ROLE[a.role] ?? a.role, approver: { id: a.approverId, name: personLabel(a.approverId), signedAt: a.signedAt } }))}
                />
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
            <div data-tour="kill-envelopes">
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
            </div>
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
          {!!k.restoreStages?.length && <RestoreStages k={k} />}
          {k.command && <KillTimeline id={k.killId} />}
          {k.command && <PostReview id={k.killId} />}
          {k.status === 'ACTIVE' && v2 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--sp-2)', minWidth: 0 }} data-tour="kill-restore">
              <h3 className="ds-eyebrow ds-eyebrow--ko">
                {K.restoreTitle} <Explain rules={['FFG-DEAC-008', 'FFG-PLT-008', 'FFG-PLT-010']} />
              </h3>
              <p className="ds-field__hint">
                <RuleText text={K.restoreBody} explain />
              </p>
              <RestoreOutlookNote k={k} />
              {rr?.status === 'REQUESTED' ? (
                <>
                  {rr.evidenceRef && <p className="ds-field__hint">{CT.restore.requested(rr.evidenceRef, rr.cohort?.length ?? k.vins.length)}</p>}
                  <ApprovalBox
                    requestedBy={rr.requestedBy}
                    approvals={rr.approvals}
                    plan={approvalPlan(k.fClass ?? 'F0', 'restore', k.reasonCategory ?? 'SAFETY')}
                    since={rr.requestedAt}
                    excluded={(k.approvals ?? []).map((a) => a.approverId)}
                    approveRoute="approveRestore"
                    rejectRoute="rejectRestore"
                    id={k.killId}
                    candidates={k.restoreOutlook?.candidates}
                  />
                </>
              ) : (
                <>
                  {rr?.status === 'REJECTED' && (
                    <p className="ds-field__hint" role="status">
                      {K.restoreRejected}: {rr.rejectReason}
                    </p>
                  )}
                  <RestoreForm k={k} />
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
  // 이 화면에 머문 채 ?id=가 바뀌어도(따라하기 가이드·알림의 이동) 그 차단을 연다
  const idParam = sp.get('id');
  useEffect(() => {
    if (idParam) setOpen(idParam);
  }, [idParam]);
  // 요청 폼은 머리의 행동으로 여는 Drawer — 결과(이력)가 위, 입력은 Drawer(3초 규칙 9, UX3-03). 이상 건에서 넘어오면 바로 연다
  const [composing, setComposing] = useState(() => sp.has('featureId') || sp.has('anomaly'));
  const rows = q.data?.items ?? [];
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D03-03 · D03-04 · KILL / RESTORE"
        title={K.title}
        lead={K.lead}
        message={(() => {
          const waiting = rows.filter((k) => k.status === 'REQUESTED').length;
          const active = rows.filter((k) => k.status === 'ACTIVE').length;
          if (!q.data) return { tone: 'neutral', value: '—', text: K.key.clean };
          if (waiting) return { tone: 'warn', value: waiting, text: K.key.waiting(active) };
          return active ? { tone: 'danger', value: active, text: K.key.active } : { tone: 'ok', text: K.key.clean };
        })()}
        actions={
          <Button icon="alert" data-tour="kill-request" onClick={() => setComposing(true)}>
            {K.create}
          </Button>
        }
      />
      <Drawer
        open={composing}
        title={
          <>
            {K.create} <Explain rules={['FFG-PLT-005', 'FFG-PLT-003', 'FFG-SEC-003', 'FFG-DEAC-010']} />
          </>
        }
        onClose={() => setComposing(false)}
      >
        <NewKill onDone={(k) => (setComposing(false), setOpen(k.killId))} />
      </Drawer>
      <Panel title={K.list} id="kills" tour="kill-approve">
        <AsyncView state={asyncState(q, rows.length === 0)} error={q.error} onRetry={() => q.refetch()}>
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
                    <span title={k.status}>{K.status[k.status]}</span>
                  ),
              },
              { key: 'd', header: K.col.delivery, cell: (k) => <Progress d={k.status === 'RELEASED' ? k.restore : k.delivery} /> },
            ]}
          />
        </AsyncView>
      </Panel>
      <KillDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// 예외 정책·임시 우회(FR-EXC-001·002), PENDING Gate 예외(FR-REG-005-010), 출시 전 Shadow만(FR-RDD-001-006),
// 중단 기준 충족 여부 기록(FR-ROL-002-008), 차량 속성 최신성(FR-SUP-004-003) — 순수 규칙. 백엔드(요청·승인·배포 검사·만료 원복)와 화면이 같은 함수를 쓴다.
// 결정(2026-11-07 B4 (c)·확정 2): Gate·검증 판정(FFG-LCY-002 fail-closed)은 그대로 두고, 예외는 그 위의 별도 층이다 — 2인 승인(요청자≠승인자,
// 두 승인자 서로 다름)·만료 필수(무기한 없음)·만료 시 자동 원복·모든 상태 전이 감사. 우회 불가 4가지: 서명·무결성, 긴급 차단 2인 승인, 직무 분리, 멈추기(0%).
// 예외는 기록된 제한 범위(제한 배포·Pilot·Shadow)만 연다 — 판정 결과를 PASS로 바꾸지 않는다.
import type { GateId, GateStatus, Role } from '../enums';
import { EXCEPTION_MAX_HOURS, type CreateExceptionBody, type ExceptionCheckId, type ExceptionDecisionBody, type ExceptionKind, type ExceptionRestriction } from '../schemas/exception-policy';
export * from '../schemas/exception-policy';
import { CONFIG_REPORT_STALE_MS } from './ads-config';
import { CANARY_MAX_BP } from './rollout-stage';

export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = { BYPASS: '임시 우회', GATE_PENDING: 'Gate 예외' };

export const EXCEPTION_RESTRICTION_LABEL: Record<ExceptionRestriction, string> = { LIMITED: '제한 배포', PILOT: 'Pilot', SHADOW: 'Shadow Mode' };
/** 제한 조건별 차량 효력 상한(bp) — 제한 배포 = Canary 상한(5%), Pilot = 1%(지정 Canary 차량 포함), Shadow = 실제 켜기 없음 */
export const RESTRICTION_CAP_BP: Record<ExceptionRestriction, number> = { LIMITED: CANARY_MAX_BP, PILOT: 100, SHADOW: 0 };

export const EXCEPTION_STATUSES = ['REQUESTED', 'APPROVING', 'ACTIVE', 'REJECTED', 'EXPIRED', 'REVOKED', 'COMPLETED'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
export const EXCEPTION_STATUS_LABEL: Record<ExceptionStatus, string> = {
  REQUESTED: '승인 요청',
  APPROVING: '1차 승인',
  ACTIVE: '적용 중',
  REJECTED: '반려',
  EXPIRED: '만료·원복',
  REVOKED: '회수·원복',
  COMPLETED: '완료(Gate 통과)',
};

/** 출시 Gate — 이 둘을 통과하지 않은 Version은 출시 전(Shadow만, FR-RDD-001-006·결정 B8 (c)) */
export const RELEASE_GATES: GateId[] = ['G8', 'G9'];

/** 적용에 필요한 승인 수 — 서로 다른 두 사람, 둘 다 요청자가 아니다 */
export const EXCEPTION_REQUIRED_APPROVALS = 2;

/** 예외 층이 보는 배포 검사 — bypassable=false는 어떤 예외로도 열지 않는다(우회 불가 4가지) */
export const EXCEPTION_CHECKS: readonly { id: ExceptionCheckId; label: string; bypassable: boolean; note: string }[] = [
  { id: 'COMPLIANCE_RULE', label: '배포 시점 컴플라이언스 룰', bypassable: true, note: '지정한 룰 ID만 — 승인되지 않은 룰은 원래 판정에 들어가지 않는다' },
  { id: 'FLAG_CODE', label: 'Flag 코드 연결 출시 관문', bypassable: true, note: '코드 연결 미확인 Flag의 게시' },
  { id: 'ADS_PUBLISH', label: 'ADS 발행 조건', bypassable: true, note: '분류 미등록·승인 조합 없음·승인 상한 밖 설정' },
  { id: 'RELEASE_GATE', label: '출시 Gate(G8·G9) 미통과 — Shadow만', bypassable: true, note: 'Gate 예외(PENDING Gate)로만 연다' },
  { id: 'SIGNATURE_INTEGRITY', label: '서명·무결성', bypassable: false, note: '게시본 서명·내용 해시 검증은 언제나 적용한다' },
  { id: 'KILL_TWO_PERSON', label: '긴급 차단·복원 2인 승인', bypassable: false, note: '차단·복원 명령은 언제나 두 사람이 승인한다' },
  { id: 'SEPARATION_OF_DUTY', label: '직무 분리(요청자≠승인자)', bypassable: false, note: '요청자는 자기 요청을 승인할 수 없다' },
  { id: 'STOP_ALWAYS', label: '멈추기(0%)', bypassable: false, note: '멈추기는 언제나 할 수 있어 예외 대상이 아니다' },
];
export const checkLabel = (id: string) => EXCEPTION_CHECKS.find((c) => c.id === id)?.label ?? id;


export interface ExceptionApproval {
  by: string;
  role: Role;
  at: string;
  reason: string;
  expiresAt: string;
}

/** 예외가 열어 준 배포 하나 — 만료·회수 때 이 상태로 되돌린다 */
export interface ExceptionApplication {
  policyId: string;
  flagKey: string;
  at: string;
  by: string;
  /** 적용 이전 이 Flag에 배포돼 있던 정책과 단계 — 없으면 null */
  prior: { policyId: string; stageBasisPoints: number | null } | null;
  capBasisPoints: number;
}

export interface ExceptionPolicy extends Omit<CreateExceptionBody, 'checks'> {
  exceptionId: string;
  checks: ExceptionCheckId[];
  status: ExceptionStatus;
  requestedBy: string;
  requestedAt: string;
  approvals: ExceptionApproval[];
  rejection: { by: string; at: string; reason: string } | null;
  appliedAt: string | null;
  expiresAt: string | null;
  applications: ExceptionApplication[];
  closedAt: string | null;
  /** 원복 결과와 원복 메시지(FR-EXC-002-004) */
  revert: { at: string; message: string; actions: string[] } | null;
}

export interface ExceptionProblem {
  code: string;
  message: string;
}

/** 요청 내용 검사(FR-EXC-001-001) — 우회 불가 항목·종류별 필수 칸 */
export function requestProblems(b: CreateExceptionBody): ExceptionProblem[] {
  const out: ExceptionProblem[] = [];
  for (const id of b.checks) {
    const c = EXCEPTION_CHECKS.find((x) => x.id === id)!;
    if (!c.bypassable) out.push({ code: 'NOT_BYPASSABLE', message: `${c.label}은(는) 예외로 우회할 수 없습니다 — ${c.note}` });
  }
  if (out.length) return out;
  if (b.kind === 'BYPASS') {
    if (!b.policyId) out.push({ code: 'POLICY_REQUIRED', message: '임시 우회할 배포 정책을 지정하세요.' });
    if (!b.checks.length) out.push({ code: 'CHECK_REQUIRED', message: '우회할 검사를 하나 이상 고르세요.' });
    if (b.checks.includes('RELEASE_GATE')) out.push({ code: 'USE_GATE_EXCEPTION', message: '출시 Gate는 Gate 예외(PENDING Gate)로 요청하세요.' });
    if (b.checks.includes('COMPLIANCE_RULE') && !b.ruleIds.length) out.push({ code: 'RULE_REQUIRED', message: '우회할 컴플라이언스 룰 ID를 지정하세요.' });
    if (b.restriction === 'SHADOW') out.push({ code: 'RESTRICTION', message: '임시 우회는 제한 배포 또는 Pilot 범위로만 엽니다(Shadow는 우회 없이 가능합니다).' });
    if (b.gates.length) out.push({ code: 'GATE_NOT_ALLOWED', message: 'Gate는 Gate 예외로 요청하세요.' });
  } else {
    if (!b.gates.length) out.push({ code: 'GATE_REQUIRED', message: '예외를 둘 PENDING Gate를 고르세요.' });
    if (!b.dueDate) out.push({ code: 'DUE_DATE_REQUIRED', message: 'Gate 완료 예정일을 입력하세요.' });
    if (!b.residualRisk?.trim()) out.push({ code: 'RESIDUAL_RISK_REQUIRED', message: '잔여 리스크를 입력하세요.' });
    if (b.checks.length) out.push({ code: 'CHECK_NOT_ALLOWED', message: '검사 우회는 임시 우회로 요청하세요.' });
  }
  return out;
}

/** Gate 예외 대상 — PENDING(검토 중·미판정)만. PASS는 필요 없고 FAIL은 예외로 열지 않는다(FR-REG-005-010) */
export function gatePendingProblems(gates: readonly GateId[], latest: Partial<Record<GateId, GateStatus | null>>): ExceptionProblem[] {
  const out: ExceptionProblem[] = [];
  for (const g of gates) {
    const s = latest[g] ?? null;
    if (s === 'PASS') out.push({ code: 'GATE_PASSED', message: `${g}은(는) 이미 PASS입니다.` });
    else if (s === 'FAIL') out.push({ code: 'GATE_FAILED', message: `${g}은(는) FAIL입니다 — PENDING Gate만 예외를 둘 수 있습니다.` });
  }
  return out;
}

/** 승인·반려 검사 — 직무 분리(요청자≠승인자)·같은 승인자 거부·만료 일시(지금 이후, 최대 기간 안) */
export function approvalProblems(e: ExceptionPolicy, approverId: string, body: ExceptionDecisionBody, now: string): ExceptionProblem[] {
  if (e.status !== 'REQUESTED' && e.status !== 'APPROVING') return [{ code: 'NOT_PENDING', message: `${EXCEPTION_STATUS_LABEL[e.status]} 상태의 예외는 승인·반려할 수 없습니다.` }];
  if (approverId === e.requestedBy) return [{ code: 'SELF_APPROVAL', message: '요청자는 자기 예외 요청을 승인·반려할 수 없습니다(직무 분리).' }];
  if (e.approvals.some((a) => a.by === approverId)) return [{ code: 'SAME_APPROVER', message: '이미 승인한 사람입니다 — 두 번째 승인은 다른 사람이 합니다.' }];
  if (body.decision !== 'APPROVE') return [];
  const t = Date.parse(body.expiresAt!);
  const n = Date.parse(now);
  if (!(t > n)) return [{ code: 'EXPIRY_PAST', message: '만료 일시는 지금 이후여야 합니다.' }];
  if (t - n > EXCEPTION_MAX_HOURS * 3600_000) return [{ code: 'EXPIRY_TOO_LONG', message: `만료 일시는 ${EXCEPTION_MAX_HOURS / 24}일 안이어야 합니다(무기한 예외 없음).` }];
  return [];
}

/** 만료 일시(FR-EXC-002-001·002) — 적용 시각 + 적용 기간과 승인자들이 지정한 만료 중 가장 이른 것 */
export function finalExpiry(appliedAt: string, periodHours: number, approverExpiries: string[]): string {
  const all = [Date.parse(appliedAt) + periodHours * 3600_000, ...approverExpiries.map((x) => Date.parse(x))];
  return new Date(Math.min(...all)).toISOString();
}

/** 적용 중(FR-EXC-001-003·002-003) — 만료 일시가 지나면 상태가 아직 ACTIVE여도 적용하지 않는다 */
export function exceptionActive(e: Pick<ExceptionPolicy, 'status' | 'expiresAt'>, now: string): boolean {
  return e.status === 'ACTIVE' && !!e.expiresAt && Date.parse(e.expiresAt) > Date.parse(now);
}

/** 만료 확인(FR-EXC-002-003) — 적용 중으로 남았지만 만료 일시가 지난 예외 */
export const exceptionDue = (e: Pick<ExceptionPolicy, 'status' | 'expiresAt'>, now: string) => e.status === 'ACTIVE' && !!e.expiresAt && Date.parse(e.expiresAt) <= Date.parse(now);

/** 이 배포 검사를 우회하는 적용 중 임시 우회 — 같은 Feature Version·정책·검사, 룰 우회는 걸린 룰을 모두 지정했어야 한다 */
export function exceptionWaiver(
  list: ExceptionPolicy[],
  q: { featureId: string; featureVersion: string; policyId: string; check: ExceptionCheckId; ruleIds?: string[] },
  now: string,
): ExceptionPolicy | null {
  const c = EXCEPTION_CHECKS.find((x) => x.id === q.check);
  if (!c?.bypassable) return null;
  return (
    list.find(
      (e) =>
        e.kind === 'BYPASS' &&
        exceptionActive(e, now) &&
        e.featureId === q.featureId &&
        e.featureVersion === q.featureVersion &&
        e.policyId === q.policyId &&
        e.checks.includes(q.check) &&
        (q.check !== 'COMPLIANCE_RULE' || (q.ruleIds ?? []).every((r) => e.ruleIds.includes(r))),
    ) ?? null
  );
}

export interface ReleaseGateDecision {
  allowed: boolean;
  /** 출시 전이라 Shadow만 — 실제 켜기 없음 */
  shadowOnly: boolean;
  /** 예외로 연 효력 상한(bp) — null이면 상한 없음(출시됨) */
  cap: number | null;
  restriction: ExceptionRestriction | null;
  exceptionIds: string[];
  /** PASS가 아닌 Gate */
  pendingGates: GateId[];
  message: string;
}

/**
 * 출시 전 배포(FR-RDD-001-006, 결정 B8 (c)) — 출시되지 않았고 출시 Gate(G8·G9)를 통과하지 않은 Version은 Shadow만. PASS가 아닌 출시 Gate를 모두 PENDING Gate 예외가 덮으면
 * 그 제한 조건 중 가장 좁은 범위만 연다(FR-REG-005-010). FAIL Gate는 예외로 열지 않는다. Gate 판정은 바꾸지 않는다.
 */
export function releaseGateDecision(i: { featureId: string; featureVersion: string; lifecycle: string; latestGates: Partial<Record<GateId, GateStatus | null>>; exceptions: ExceptionPolicy[]; now: string; narrowing?: boolean }): ReleaseGateDecision {
  if (i.lifecycle === 'RELEASED') return { allowed: true, shadowOnly: false, cap: null, restriction: null, exceptionIds: [], pendingGates: [], message: '출시된 Version' };
  // ODD 축소 정책(FFG-SOT-002)은 효력을 넓히지 않고 줄이는 조치라 출시 전에도 나간다(멈추기처럼 위험을 줄이는 조치는 막지 않는다)
  if (i.narrowing) return { allowed: true, shadowOnly: false, cap: null, restriction: null, exceptionIds: [], pendingGates: [], message: 'ODD 축소 정책 — 효력을 줄이는 조치' };
  const pendingGates = RELEASE_GATES.filter((g) => i.latestGates[g] !== 'PASS');
  if (!pendingGates.length) return { allowed: true, shadowOnly: false, cap: null, restriction: null, exceptionIds: [], pendingGates, message: '출시 Gate(G8·G9) 통과' };
  const failed = pendingGates.filter((g) => i.latestGates[g] === 'FAIL');
  const active = i.exceptions.filter((e) => e.kind === 'GATE_PENDING' && exceptionActive(e, i.now) && e.featureId === i.featureId && e.featureVersion === i.featureVersion);
  const covering = pendingGates.map((g) => active.filter((e) => e.gates.includes(g)));
  const shadow = `출시 전(${pendingGates.join('·')} 미통과) Version은 Shadow(판단만 기록, 차량 동작 그대로)로만 차량에 보낼 수 있습니다 — Shadow 실험을 쓰거나 PENDING Gate 예외(제한 배포·Pilot)를 2인 승인받으세요.`;
  if (failed.length || covering.some((c) => !c.length)) return { allowed: false, shadowOnly: true, cap: 0, restriction: null, exceptionIds: [], pendingGates, message: failed.length ? `${failed.join('·')} FAIL — ${shadow}` : shadow };
  const used = [...new Map(covering.flat().map((e) => [e.exceptionId, e])).values()];
  const narrow = used.reduce((a, e) => (RESTRICTION_CAP_BP[e.restriction] < RESTRICTION_CAP_BP[a.restriction] ? e : a));
  const cap = RESTRICTION_CAP_BP[narrow.restriction];
  if (cap === 0) return { allowed: false, shadowOnly: true, cap: 0, restriction: 'SHADOW', exceptionIds: used.map((e) => e.exceptionId), pendingGates, message: `Gate 예외 ${narrow.exceptionId}의 제한 조건이 Shadow Mode입니다 — ${shadow}` };
  return {
    allowed: true,
    shadowOnly: false,
    cap,
    restriction: narrow.restriction,
    exceptionIds: used.map((e) => e.exceptionId).sort(),
    pendingGates,
    message: `Gate 예외 ${used.map((e) => e.exceptionId).join(', ')} — ${EXCEPTION_RESTRICTION_LABEL[narrow.restriction]}(${cap / 100}%)까지만`,
  };
}

/**
 * 배포 중단 기준 충족 여부(FR-ROL-002-008, 확정 2) — 확인해 기록·표시만 하고 중단(멈추기 0%)은 언제나 허용한다.
 * 기준을 충족하지 않은 중단은 사유를 남겨야 한다(단계 조정 요청은 사유가 필수 칸이다).
 */
export function stopCriteriaCheck(i: { openAnomalies: string[]; activeKills: string[]; abort: string[] }): { met: boolean; allowed: true; reasonRequired: boolean; reasons: string[] } {
  const reasons = [
    ...i.openAnomalies.map((x) => `열린 이상 징후 ${x}`),
    ...i.activeKills.map((x) => `진행 중 차단 ${x}`),
    ...i.abort,
  ];
  return { met: reasons.length > 0, allowed: true, reasonRequired: reasons.length === 0, reasons };
}

/** 차량 속성 최신성 기준(FR-SUP-004-003) — 차량 보고 기준 시간(24시간) */
export const ATTRIBUTE_FRESHNESS_MS = CONFIG_REPORT_STALE_MS;

/** 최신성 확인 — 기준 시간보다 오래됐거나 보고가 없으면 미충족(판단하지 않는다). 차량 쪽 Safe Default는 그대로 */
export function attributeFreshness(observedAt: string | null, now: string, thresholdMs = ATTRIBUTE_FRESHNESS_MS): { met: boolean; ageMs: number | null; thresholdMs: number; message: string } {
  const hours = Math.round(thresholdMs / 3600_000);
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) return { met: false, ageMs: null, thresholdMs, message: `최신성 미충족 — 차량 속성 보고가 없습니다(기준 ${hours}시간). 판단하지 않았습니다.` };
  const age = Math.max(0, Date.parse(now) - Date.parse(observedAt));
  if (age <= thresholdMs) return { met: true, ageMs: age, thresholdMs, message: `차량 속성 보고 ${Math.round(age / 3600_000)}시간 전 — 기준 ${hours}시간 안` };
  return { met: false, ageMs: age, thresholdMs, message: `최신성 미충족 — 차량 속성 보고가 ${Math.round(age / 3600_000)}시간 전입니다(기준 ${hours}시간). 판단하지 않았습니다.` };
}

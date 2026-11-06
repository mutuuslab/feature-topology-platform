// 롤백 (D03-04 이전 상태 복구) — 배포된 정책을 이전에 배포했던 정책 버전으로 되돌린다.
// 배포 ID = 정책 배포가 만든 서명 게시본(POLICY publication) ID. 복구 기준 버전 = 같은 flagKey로 예전에 배포했던 정책(지금은 RETIRED).
// - Rollback Plan: 배포 하나에 미리 승인받아 두는 자동 롤백 조건(배포 실패율·DTC). 조건이 충족되면 승인된 계획대로 실행한다.
// - 수동 롤백: 요청 → 지정 승인대상자 승인(요청자 아님) → 실행. 승인 전에는 실행할 수 없다.
// - 실행은 언제나 재검증부터(fail-closed): 복구 기준 버전이 배포 완료·검증 통과·운영 승인·서명된 배포 산출물을 갖추고, 지금도 적용 가능해야 한다.
//   정책 롤백은 flag 단위(서버 평가 기준이 하나)라 적용 범위가 배포 대상 차량 전부를 덮어야 한다 — 일부만 되돌리면 서버와 차량 기준이 갈라진다.
// - SW 버전 롤백은 OTA(IF-05)에 위임한다(결정 대기 D7) — 롤백 대상 유형으로 받지만 실행하지 않고 사유를 돌려준다.
// @req FR-RBK-001-001 FR-RBK-001-002 FR-RBK-001-004 FR-RBK-001-005 FR-RBK-001-006 FR-RBK-001-008 FR-RBK-002-001 FR-RBK-002-002 FR-RBK-002-003 FR-RBK-002-004 FR-RBK-002-005
// @req FR-RBK-003-001 FR-RBK-003-002 FR-RBK-003-003 FR-RBK-004-001 FR-RBK-004-002 FR-RBK-004-004 FR-RBK-004-006 FR-RBK-004-007 FR-RBK-004-008 FR-RBK-005-001 FR-RBK-005-002
import { z } from 'zod';
import type { Role } from '../enums';

export const RollbackTargetType = z.enum(['POLICY_VERSION', 'SW_VERSION']);
export type RollbackTargetType = z.infer<typeof RollbackTargetType>;
export const ROLLBACK_TARGET_LABEL: Record<RollbackTargetType, string> = { POLICY_VERSION: '정책 버전', SW_VERSION: 'SW 버전' };

/** 롤백 요청·계획 권한(FR-RBK-004-002) — 배포 권한과 같은 역할 */
export const ROLLBACK_REQUEST_ROLES: Role[] = ['RELEASE_MANAGER', 'OPERATOR'];
/** 승인대상자가 가져야 하는 역할 — 요청자와 다른 사람이어야 한다 */
export const ROLLBACK_APPROVER_ROLES: Role[] = ['OPS_LEAD', 'SAFETY_OFFICER', 'RELEASE_MANAGER'];

const codes = (re: RegExp, max = 200) => z.array(z.string().trim().regex(re)).max(max).default([]);

/**
 * 적용 대상 범위 — 차원 안은 OR, 차원 사이는 AND. 하나 이상 지정해야 한다(FR-RBK-001-006).
 * 생산 지역 코드 = VIN 앞자리(제조사·생산지 WMI, 예: KMH), 적용 지역 코드 = 판매 국가, Variant Rule = UPG 사양 코드(upgVc).
 */
export const RollbackScope = z
  .object({
    featureIds: codes(/^FEAT-\d{5}$/),
    variantRules: codes(/^[A-Z0-9]{3,20}$/),
    productionRegions: codes(/^[A-Z0-9]{2,5}$/),
    marketRegions: codes(/^[A-Z]{2}$/),
    swVersions: codes(/^\d+\.\d+\.\d+$/),
    vins: codes(/^[A-Z0-9-]{3,40}$/, 5000),
  })
  .strict()
  .refine((s) => Object.values(s).some((v) => v.length > 0), { message: '적용 대상 범위를 하나 이상 지정하세요 (Feature·Variant Rule·생산 지역·적용 지역·SW 버전·VIN)' });
export type RollbackScope = z.infer<typeof RollbackScope>;
export const ROLLBACK_SCOPE_LABEL: Record<keyof RollbackScope, string> = { featureIds: 'Feature', variantRules: 'Variant Rule', productionRegions: '생산 지역', marketRegions: '적용 지역', swVersions: 'SW 버전', vins: 'VIN' };

export const DTC_TYPES = ['P', 'C', 'B', 'U'] as const;
export type DtcType = (typeof DTC_TYPES)[number];
export const DTC_TYPE_LABEL: Record<DtcType, string> = { P: 'P 파워트레인', C: 'C 섀시', B: 'B 바디', U: 'U 네트워크' };

/** 자동 롤백 조건(FR-RBK-001-004) — 배포 실패율 기준 초과, 특정 DTC 발생 중 하나 이상 */
export const RollbackConditions = z
  .object({
    failureRate: z.object({ thresholdPercent: z.number().min(0).max(100) }).strict().optional(),
    dtc: z
      .object({ codes: codes(/^[0-9A-F]{6}$/, 50), types: z.array(z.enum(DTC_TYPES)).max(4).default([]) })
      .strict()
      .refine((d) => d.codes.length + d.types.length > 0, { message: 'DTC 조건에는 DTC 코드나 DTC 유형을 하나 이상 넣으세요' })
      .optional(),
  })
  .strict()
  .refine((c) => !!c.failureRate || !!c.dtc, { message: '자동 롤백 조건을 하나 이상 고르세요 (배포 실패율·DTC 발생)' });
export type RollbackConditions = z.infer<typeof RollbackConditions>;

const targetTypes = z.array(RollbackTargetType).min(1, '롤백 대상 유형을 하나 이상 고르세요').max(2);
const approvers = z.array(z.string().trim().min(1).max(80)).min(1, '승인대상자를 한 명 이상 지정하세요').max(5);
const recovery = z.object({ policyId: z.string().regex(/^POL-\d{5}$/) }).strict();
const deploymentId = z.string().trim().min(1).max(40);

export const CreateRollbackPlanBody = z.object({ deploymentId, targetTypes, recovery, conditions: RollbackConditions, scope: RollbackScope, approvers, note: z.string().trim().max(500).optional() }).strict();
export type CreateRollbackPlanBody = z.infer<typeof CreateRollbackPlanBody>;
export const CreateRollbackRequestBody = z.object({ deploymentId, targetTypes, recovery, scope: RollbackScope, reason: z.string().trim().min(2).max(500), approvers }).strict();
export type CreateRollbackRequestBody = z.infer<typeof CreateRollbackRequestBody>;
export const RollbackDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().min(2).max(500) }).strict();
export type RollbackDecisionBody = z.infer<typeof RollbackDecisionBody>;
export const RollbackPreviewBody = z.object({ deploymentId, recovery, scope: RollbackScope }).strict();
export type RollbackPreviewBody = z.infer<typeof RollbackPreviewBody>;
/**
 * 정책 상세의 되돌리기 요청(RD-FN-02) — 이 flag의 지금 배포를 고른 예전 버전으로 되돌리는 수동 롤백 요청을 만든다.
 * expectedDeploymentId = 화면이 본 지금 배포(이력의 deploymentId). 그사이 배포가 바뀌었으면 412 — 낡은 화면으로 되돌리지 않는다.
 * 범위는 flag 단위(배포 대상 전부), 대상 유형은 정책 버전. 승인(지정 승인대상자, 요청자 아님) → 실행(재검증)은 수동 롤백과 같다.
 */
export const PolicyRollbackBody = z.object({ recovery, expectedDeploymentId: deploymentId, reason: z.string().trim().min(2).max(500), approvers }).strict();
export type PolicyRollbackBody = z.infer<typeof PolicyRollbackBody>;

// ─── 기록 ───────────────────────────────────────────────────

export interface PolicyVersionRef {
  policyId: string;
  revision: number;
  contentHash: string;
  featureId: string;
  featureVersion: string;
}
export interface RollbackDecision {
  decision: 'APPROVE' | 'REJECT';
  by: string;
  role: string;
  at: string;
  comment: string;
}
export type RollbackPlanStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'TRIGGERED';
export const ROLLBACK_PLAN_STATUS_LABEL: Record<RollbackPlanStatus, string> = { REQUESTED: '승인 대기', APPROVED: '감시 중', REJECTED: '반려', TRIGGERED: '실행됨' };
export interface RollbackPlan {
  planId: string;
  deploymentId: string;
  featureId: string;
  flagKey: string;
  /** 배포 버전 — 계획을 만든 배포가 내보낸 정책 */
  deployed: PolicyVersionRef;
  targetTypes: RollbackTargetType[];
  conditions: RollbackConditions;
  recovery: PolicyVersionRef;
  scope: RollbackScope;
  approvers: string[];
  requestedBy: string;
  requestedAt: string;
  note: string | null;
  status: RollbackPlanStatus;
  decision: RollbackDecision | null;
  executionId: string | null;
}
export type RollbackRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
export const ROLLBACK_REQUEST_STATUS_LABEL: Record<RollbackRequestStatus, string> = { REQUESTED: '승인 대기', APPROVED: '승인됨 — 실행 대기', REJECTED: '반려', EXECUTED: '실행됨' };
export interface RollbackRequest {
  requestId: string;
  deploymentId: string;
  featureId: string;
  flagKey: string;
  deployed: PolicyVersionRef;
  targetTypes: RollbackTargetType[];
  recovery: PolicyVersionRef;
  scope: RollbackScope;
  reason: string;
  approvers: string[];
  requestedBy: string;
  requestedAt: string;
  status: RollbackRequestStatus;
  decision: RollbackDecision | null;
  executionId: string | null;
}
export type RollbackStatus = 'REQUESTED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export const ROLLBACK_STATUS_LABEL: Record<RollbackStatus, string> = { REQUESTED: '요청', RUNNING: '실행 중', COMPLETED: '완료', FAILED: '실패' };
export type RollbackResult = 'SUCCESS' | 'FAILURE';
export const ROLLBACK_RESULT_LABEL: Record<RollbackResult, string> = { SUCCESS: '성공', FAILURE: '실패' };
export interface RollbackTrigger {
  kind: 'MANUAL' | 'FAILURE_RATE' | 'DTC';
  detail: string;
}
export interface RollbackExecution {
  executionId: string;
  mode: 'AUTO' | 'MANUAL';
  planId: string | null;
  requestId: string | null;
  deploymentId: string;
  featureId: string;
  flagKey: string;
  targetTypes: RollbackTargetType[];
  trigger: RollbackTrigger;
  /** 롤백 전 버전 */
  before: PolicyVersionRef;
  /** 롤백 후 버전(복구 기준 버전) */
  after: PolicyVersionRef;
  /** 복구 기준 버전의 원래 배포 산출물(서명 게시본) */
  sourceArtifactId: string | null;
  /** 롤백이 내보낸 배포 산출물 — 복구 기준 버전의 내용(같은 해시)을 새 순번으로 다시 서명 */
  artifactId: string | null;
  vehicleGroups: VehicleGroup[];
  vins: string[];
  status: RollbackStatus;
  result: RollbackResult | null;
  failureReason: string | null;
  failedAt: string | null;
  requestedBy: string;
  approvedBy: string | null;
  deploymentRequestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// ─── 적용 범위·차량 그룹 ──────────────────────────────────────

export interface ScopeVehicle {
  vin: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string;
  swVersion: string;
}
/** 생산 지역 코드 — VIN 앞자리(구분자 앞) */
export const productionRegionOf = (vin: string) => vin.split('-')[0].slice(0, 5).toUpperCase();

export function vehicleInScope(v: ScopeVehicle, featureId: string, s: RollbackScope): boolean {
  const any = <T>(xs: T[], hit: (x: T) => boolean) => !xs.length || xs.some(hit);
  return (
    any(s.featureIds, (f) => f === featureId) &&
    any(s.variantRules, (r) => r === v.upgVc) &&
    any(s.productionRegions, (r) => r === productionRegionOf(v.vin)) &&
    any(s.marketRegions, (r) => r === v.country) &&
    any(s.swVersions, (x) => x === v.swVersion) &&
    any(s.vins, (x) => x === v.vin)
  );
}

export interface VehicleGroup {
  productionRegion: string;
  marketRegion: string;
  variant: string;
  vehicleModel: string;
  trim: string;
  swVersion: string;
  vins: string[];
}
/** 영향 차량 그룹(FR-RBK-003-002) — 생산 지역·적용 지역·Variant·SW 버전 묶음 */
export function vehicleGroups(vs: ScopeVehicle[]): VehicleGroup[] {
  const m = new Map<string, VehicleGroup>();
  for (const v of vs) {
    const key = [productionRegionOf(v.vin), v.country, v.upgVc, v.vehicleModel, v.trim, v.swVersion].join('|');
    const g = m.get(key) ?? { productionRegion: productionRegionOf(v.vin), marketRegion: v.country, variant: v.upgVc, vehicleModel: v.vehicleModel, trim: v.trim, swVersion: v.swVersion, vins: [] };
    g.vins.push(v.vin);
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => b.vins.length - a.vins.length || a.vins[0].localeCompare(b.vins[0]));
}

// ─── 복구 기준 버전 판정 ─────────────────────────────────────

export const ROLLBACK_BLOCKER = {
  SW_VERSION_EXTERNAL: 'SW 버전 롤백은 OTA(IF-05)에 위임되어 이 플랫폼에서 실행하지 않습니다 (결정 대기 D7)',
  POLICY_TARGET_REQUIRED: '롤백 대상 유형에 정책 버전이 있어야 합니다',
  DEPLOYMENT_NOT_FOUND: '배포 ID에 해당하는 정책 배포 산출물이 없습니다',
  DEPLOYMENT_NOT_CURRENT: '이 배포는 지금 효력이 있는 배포가 아닙니다 (이미 다른 배포로 바뀜)',
  RECOVERY_NOT_FOUND: '복구 기준 정책이 없습니다',
  RECOVERY_OTHER_FLAG: '복구 기준 정책이 같은 flag(Control Point)의 정책이 아닙니다',
  RECOVERY_IS_CURRENT: '복구 기준 정책이 지금 배포된 정책입니다',
  RECOVERY_SAME_CONTENT: '복구 기준 정책 내용이 지금 배포된 내용과 같습니다',
  NOT_DEPLOYED_BEFORE: '배포 완료된 적 없는 정책입니다',
  NOT_APPROVED: '운영 승인 기록이 없습니다',
  GATE_NOT_PASSED: '이 정책 내용으로 통과(GO)한 검증 기록이 없습니다',
  NO_ARTIFACT: '연결된 배포 산출물(서명 게시본)이 없습니다',
  ARTIFACT_SIGNATURE_INVALID: '연결된 배포 산출물의 서명을 확인할 수 없습니다',
  ARTIFACT_NOT_COMPLETED: '연결된 배포 산출물이 차량 확인(CONFIRMED·PARTIAL)까지 가지 못했습니다',
  FEATURE_NOT_DEPLOYABLE: '복구 기준 정책의 Feature Version이 지금 배포할 수 없는 상태입니다',
  CONTENT_TAMPERED: '복구 기준 정책 내용이 승인·검증한 내용(해시)과 다릅니다',
  KILL_ACTIVE: '이 Feature에 진행 중인 긴급 차단이 있습니다 — 차단을 먼저 정리하세요',
  SCOPE_EMPTY: '적용 대상 범위에 드는 배포 대상 차량이 없습니다',
  SCOPE_PARTIAL: '정책 버전 롤백은 flag 단위입니다 — 적용 대상 범위가 배포 대상 차량 전부를 덮어야 합니다',
} as const;
export type RollbackBlocker = keyof typeof ROLLBACK_BLOCKER;

export interface RecoveryFacts {
  /** 복구 후보 정책 */
  policy: { policyId: string; flagKey: string; status: string; contentHash: string; approvedBy: string | null; deployedAt?: string | null } | null;
  /** 지금 배포된 정책 */
  current: { policyId: string; flagKey: string; contentHash: string };
  /** 복구 후보 내용(해시)으로 GO 판정을 받은 검증이 있는가 */
  validatedGo: boolean;
  /** 복구 후보의 배포 산출물 — 최신 POLICY 게시본 */
  artifact: { status: string; signatureValid: boolean } | null;
  featureDeployable: boolean;
  /** 저장된 내용으로 다시 계산한 해시 = 기록된 해시(배포와 같은 무결성 검사). 생략하면 확인한 것으로 본다 */
  contentIntact?: boolean;
}

/** 복구 가능한 버전인가(FR-RBK-001-005·004-004) — 배포 완료·검증 통과·운영 승인·배포 산출물 */
export function recoveryBlockers(f: RecoveryFacts): RollbackBlocker[] {
  const p = f.policy;
  if (!p) return ['RECOVERY_NOT_FOUND'];
  const out: RollbackBlocker[] = [];
  if (p.flagKey !== f.current.flagKey) out.push('RECOVERY_OTHER_FLAG');
  if (p.policyId === f.current.policyId) out.push('RECOVERY_IS_CURRENT');
  else if (p.contentHash === f.current.contentHash) out.push('RECOVERY_SAME_CONTENT');
  if (!p.deployedAt) out.push('NOT_DEPLOYED_BEFORE');
  if (!p.approvedBy) out.push('NOT_APPROVED');
  if (!f.validatedGo) out.push('GATE_NOT_PASSED');
  if (!f.artifact) out.push('NO_ARTIFACT');
  else {
    if (!f.artifact.signatureValid) out.push('ARTIFACT_SIGNATURE_INVALID');
    if (!['CONFIRMED', 'PARTIAL'].includes(f.artifact.status)) out.push('ARTIFACT_NOT_COMPLETED');
  }
  if (!f.featureDeployable) out.push('FEATURE_NOT_DEPLOYABLE');
  if (f.contentIntact === false) out.push('CONTENT_TAMPERED');
  return out;
}

/** 적용 범위 판정(FR-RBK-003-003) — 범위 안 차량이 배포 대상 전부여야 한다(대상이 없으면 범위 확인만) */
export function scopeBlockers(targets: string[], scoped: string[]): RollbackBlocker[] {
  if (!targets.length) return [];
  if (!scoped.length) return ['SCOPE_EMPTY'];
  return targets.every((v) => scoped.includes(v)) ? [] : ['SCOPE_PARTIAL'];
}

export const targetTypeBlockers = (types: readonly RollbackTargetType[]): RollbackBlocker[] => [
  ...(types.includes('POLICY_VERSION') ? [] : (['POLICY_TARGET_REQUIRED'] as const)),
  ...(types.includes('SW_VERSION') ? (['SW_VERSION_EXTERNAL'] as const) : []),
];

// ─── 자동 롤백 조건 ──────────────────────────────────────────

/** DTC 유형 — 첫 바이트 상위 2비트(SAE J2012): 00 P · 01 C · 10 B · 11 U */
export const dtcType = (code: string): DtcType => DTC_TYPES[parseInt(code.slice(0, 1), 16) >> 2];

/** 배포 실패율 — 확인되지 않은 대상 비율(%) */
export const failureRate = (confirmed: number, denominator: number) => (denominator ? Math.round(((denominator - confirmed) / denominator) * 1000) / 10 : 0);

/** 실패율 조건 — 기준값 초과(FR-RBK-002-001) */
export function failureRateTrigger(c: RollbackConditions, confirmed: number, denominator: number): RollbackTrigger | null {
  if (!c.failureRate || !denominator) return null;
  const rate = failureRate(confirmed, denominator);
  return rate > c.failureRate.thresholdPercent ? { kind: 'FAILURE_RATE', detail: `배포 실패율 ${rate}% > 기준 ${c.failureRate.thresholdPercent}% (확인 ${confirmed}/${denominator})` } : null;
}

/** DTC 조건 — 등록한 DTC 코드 또는 유형이 차량에서 발생 */
export function dtcTrigger(c: RollbackConditions, vin: string, dtcs: readonly string[]): RollbackTrigger | null {
  if (!c.dtc) return null;
  const hit = dtcs.find((d) => c.dtc!.codes.includes(d) || c.dtc!.types.includes(dtcType(d)));
  return hit ? { kind: 'DTC', detail: `${vin} DTC ${hit} (${DTC_TYPE_LABEL[dtcType(hit)]})` } : null;
}

export const scopeText = (s: RollbackScope) =>
  (Object.keys(ROLLBACK_SCOPE_LABEL) as (keyof RollbackScope)[])
    .filter((k) => s[k].length)
    .map((k) => `${ROLLBACK_SCOPE_LABEL[k]} ${s[k].length > 3 ? `${s[k].slice(0, 3).join(', ')} 외 ${s[k].length - 3}` : s[k].join(', ')}`)
    .join(' · ');

export const conditionText = (c: RollbackConditions) =>
  [c.failureRate && `배포 실패율 > ${c.failureRate.thresholdPercent}%`, c.dtc && `DTC ${[...c.dtc.codes, ...c.dtc.types.map((t) => `${t}유형`)].join(', ')}`].filter(Boolean).join(' · ');

export const versionText = (v: Pick<PolicyVersionRef, 'policyId' | 'revision' | 'featureVersion'>) => `${v.policyId} r${v.revision} (Feature ${v.featureVersion})`;

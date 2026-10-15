// 단일 Flag 평가기 — 서버 활성화 판단(D01-09)·OFREP(IF-10)·차량 런타임 시뮬레이터·정책 시나리오 검증이 같은 함수를 쓴다.
// 순서: 배포 여부 → 긴급 차단(Kill) → 적용 범위(필수) → 차량 지원 조건(필수, 넘겼을 때) → 사용 권한(필수) → 대상 전략(OR) → 코호트(FP-COHORT-1) → P0 decide.
// HOLD(문맥 불명·무효)는 Safe Default, DENY는 OFF, ALLOW는 정책 값(enabled).
import type { Policy, Vehicle } from '../schemas/policy';
import { and3, cohortBucket, constraint, decide, type Decision, type EvalContext, type Tri } from './p0';

export type EvalReason =
  | 'NOT_DEPLOYED'
  | 'KILL_SWITCH'
  | 'NOT_APPLICABLE'
  | 'NOT_SUPPORTED'
  | 'NO_ENTITLEMENT'
  | 'TARGETING_MISS'
  | 'COHORT_MISS'
  | 'CONTEXT_UNKNOWN'
  | 'POLICY_MATCH'
  | 'ERROR_SAFE_DEFAULT';

export interface EvalStep {
  step: 'DEPLOYED' | 'KILL' | 'APPLICABILITY' | 'SUPPORT' | 'ENTITLEMENT' | 'TARGETING' | 'COHORT' | 'DECIDE';
  result: Tri | 'SKIP';
  detail: string;
}

export interface FlagResult {
  flagKey: string;
  value: boolean;
  variant: 'on' | 'off';
  decision: Decision | 'SAFE_DEFAULT';
  reason: EvalReason;
  policyId: string;
  revision: number;
  trace: EvalStep[];
}

/** 정책이 가리키는 Feature Version의 적용 범위 (평가기는 Registry를 조회하지 않는다 — 호출자가 넘긴다) */
export interface PolicyScope {
  country: string;
  vehicleModel: string;
  trim: string;
}

export interface EvalInput {
  policy: Policy;
  scope: PolicyScope;
  /** 이 Feature에 긴급 차단이 걸려 있나 */
  killed: boolean;
  vehicle: Vehicle;
  /** 이 차량의 해당 상품 사용 권한이 지금 유효한가 (null = 확인 불가) */
  entitlementActive: boolean | null;
  /** 차량 지원 조건(D02-02 variantRow 판정) — 넘기면 필수 조건이 된다(FFG-VEH-006). NOT_SUPPORTED면 비활성 유지, 사유 보고 */
  support?: { verdict: 'APPLICABLE' | 'NOT_APPLICABLE' | 'NOT_SUPPORTED' | 'UNKNOWN'; reason: string };
}

/** 차량 → P0 평가 문맥. 차량 문맥 품질이 TRUSTED가 아니면 모든 항목이 판단 불가가 된다. */
export function vehicleContext(v: Vehicle, entitlementActive: boolean | null): EvalContext {
  const item = (value: string | null) => ({ value, quality: v.quality });
  return {
    vehicleKey: item(v.vin),
    country: item(v.country),
    vehicleModel: item(v.vehicleModel),
    vehicleTrim: item(v.trim),
    modelYear: item(v.modelYear),
    upgVc: item(v.upgVc),
    swVersion: item(v.swVersion),
    trialSessionValid: entitlementActive === null ? undefined : item(String(entitlementActive)),
  };
}

/**
 * 단일 Flag 평가.
 * @rule FFG-VEH-006 — 활성화 전 차량 지원 조건 확인: 불만족이면 활성화하지 않고 사유(NOT_SUPPORTED·trace)를 보고
 */
export async function evaluateFlag({ policy, scope, killed, vehicle, entitlementActive, support }: EvalInput): Promise<FlagResult> {
  const trace: EvalStep[] = [];
  const out = (decision: FlagResult['decision'], reason: EvalReason, value: boolean): FlagResult => ({
    flagKey: policy.flagKey,
    value,
    variant: value ? 'on' : 'off',
    decision,
    reason,
    policyId: policy.policyId,
    revision: policy.revision,
    trace,
  });
  try {
    const deployed = policy.status === 'DEPLOYED';
    trace.push({ step: 'DEPLOYED', result: deployed ? 'TRUE' : 'FALSE', detail: policy.status });
    if (!deployed) return out('SAFE_DEFAULT', 'NOT_DEPLOYED', policy.safeDefault);
    trace.push({ step: 'KILL', result: killed ? 'TRUE' : 'FALSE', detail: killed ? '긴급 차단 우선' : '차단 없음' });
    if (killed) return out('SAFE_DEFAULT', 'KILL_SWITCH', policy.safeDefault);

    const ctx = vehicleContext(vehicle, entitlementActive);
    // 적용 범위: 정책 대상 Feature의 국가·차종·트림은 정책 등록 시 strategies와 별개로 필수 조건이 된다
    const applicability = and3([
      constraint({ contextName: 'country', operator: 'IN', values: [scope.country] }, ctx),
      constraint({ contextName: 'vehicleModel', operator: 'IN', values: [scope.vehicleModel] }, ctx),
      constraint({ contextName: 'vehicleTrim', operator: 'IN', values: [scope.trim] }, ctx),
    ]);
    trace.push({ step: 'APPLICABILITY', result: applicability, detail: `범위 ${scope.country}/${scope.vehicleModel}/${scope.trim}` });

    // 차량 지원 조건 — 범위 밖(NOT_APPLICABLE)은 적용 범위가 이미 거른다
    const supportTri: Tri = !support || support.verdict === 'APPLICABLE' || support.verdict === 'NOT_APPLICABLE' ? 'TRUE' : support.verdict === 'NOT_SUPPORTED' ? 'FALSE' : 'UNKNOWN';
    if (support) trace.push({ step: 'SUPPORT', result: supportTri, detail: support.reason });

    let entitlement: Tri = 'TRUE';
    if (policy.entitlementCatalogId) entitlement = constraint({ contextName: 'trialSessionValid', operator: 'IN', values: ['true'] }, ctx);
    trace.push({ step: 'ENTITLEMENT', result: policy.entitlementCatalogId ? entitlement : 'SKIP', detail: policy.entitlementCatalogId ?? '권한 불필요' });

    const strategies: Tri[] = policy.strategies.length ? policy.strategies.map((s) => and3(s.constraints.map((c) => constraint(c, ctx)))) : ['TRUE'];
    trace.push({ step: 'TARGETING', result: strategies.includes('TRUE') ? 'TRUE' : strategies.includes('UNKNOWN') ? 'UNKNOWN' : 'FALSE', detail: policy.strategies.length ? `${policy.strategies.length}개 전략 중 하나` : '전략 없음 — 전체' });

    // 코호트 — 정책 rollout과 단계 배포의 현재 단계 중 더 좁은 쪽 (단계는 승인 범위를 넓힐 수 없다)
    const bp = effectiveBasisPoints(policy);
    let cohort: Tri = 'TRUE';
    if (bp === 0) cohort = 'FALSE';
    else if (bp < 10000) {
      if (vehicle.quality !== 'TRUSTED') cohort = 'UNKNOWN';
      else cohort = (await cohortBucket('1', policy.flagKey, policy.rollout.salt, vehicle.vin)) < bp ? 'TRUE' : 'FALSE';
    }
    trace.push({ step: 'COHORT', result: cohort, detail: bp === 10000 ? '전체' : bp === 0 ? '배포 대상 없음' : `FP-COHORT-1 < ${bp / 100}%` });

    const d = decide({ flagEnabled: policy.enabled, strategies, mandatory: [applicability, supportTri, entitlement, cohort] });
    trace.push({ step: 'DECIDE', result: d.decision === 'ALLOW' ? 'TRUE' : d.decision === 'DENY' ? 'FALSE' : 'UNKNOWN', detail: d.reason });
    if (d.decision === 'HOLD') return out('HOLD', 'CONTEXT_UNKNOWN', policy.safeDefault);
    if (d.decision === 'DENY') {
      const reason: EvalReason = applicability === 'FALSE' ? 'NOT_APPLICABLE' : supportTri === 'FALSE' ? 'NOT_SUPPORTED' : entitlement === 'FALSE' ? 'NO_ENTITLEMENT' : cohort === 'FALSE' ? 'COHORT_MISS' : 'TARGETING_MISS';
      return out('DENY', reason, false);
    }
    return out('ALLOW', 'POLICY_MATCH', policy.enabled);
  } catch (e) {
    trace.push({ step: 'DECIDE', result: 'UNKNOWN', detail: `평가 오류: ${(e as Error).message}` });
    return out('SAFE_DEFAULT', 'ERROR_SAFE_DEFAULT', policy.safeDefault);
  }
}

/** 실효 코호트 비율(basis points) — rollout NONE=0, ALL=10000, COHORT=basisPoints, 단계 값이 있으면 그보다 넓어지지 않는다 */
export function effectiveBasisPoints(policy: Pick<Policy, 'rollout' | 'stageBasisPoints'>): number {
  const approved = policy.rollout.mode === 'NONE' ? 0 : policy.rollout.mode === 'ALL' ? 10000 : policy.rollout.basisPoints;
  return policy.stageBasisPoints == null ? approved : Math.min(approved, policy.stageBasisPoints);
}

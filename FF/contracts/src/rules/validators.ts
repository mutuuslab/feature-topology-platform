// PoC ② 분야별 검증 8종 (PPT v0.50 슬라이드 4) — 병렬 실행 후 검증 이력(D06-04)에 모으고 배포 안전성(D03-02)이 종합한다.
// 모두 순수 함수: 입력은 백엔드가 Registry·Topology·Fleet에서 모아 넘긴다.
import type { FeatureVersionRow } from '../schemas/dataset';
import type { Policy, Vehicle } from '../schemas/policy';
import type { GateId, GateStatus, Lifecycle } from '../enums';
import { evaluateFlag, type PolicyScope } from '../flags/evaluate';
import { decimalCompare, semverCompare, time, type Constraint } from '../flags/p0';
import { LIFECYCLE_RANK } from './lifecycle';
import type { VirtualEvidence, VirtualScenario } from './virtual';

export type ValidatorResultState = 'PASS' | 'CONDITIONAL' | 'FAIL';

export interface ValidatorResult {
  componentId: string;
  ko: string;
  result: ValidatorResultState;
  summary: string;
  /** INFO는 알림(대체 사실·통지 대상) — 기록·표시하되 판정에는 넣지 않는다 */
  findings: { result: Exclude<ValidatorResultState, 'PASS'> | 'INFO'; message: string }[];
}

export interface ValidationInput {
  policy: Policy;
  feature: FeatureVersionRow;
  gates: Partial<Record<GateId, GateStatus>>;
  requiresTargets: { dependencyId: string; targetFeatureId: string; targetVersion: string | null; targetLifecycle: Lifecycle | null }[];
  trace: { swId: string; swVersion: string | null; ecuPno: string | null; swFound: boolean; ecuActive: boolean }[];
  /** 같은 Feature Version의 다른 승인·배포 정책 */
  activePolicies: Policy[];
  /** 같은 flagKey를 쓰는 다른 Feature의 정책 */
  flagKeyClash: Policy[];
  fleet: Vehicle[];
  affectedProducts: { catalogId: string; version: string; lifecycle: Lifecycle }[];
  /** entitlementCatalogId 상품이 이 Feature를 구성에 포함하나 (null = 상품 없음) */
  entitlementProductOk: boolean | null;
  /** vECU 가상검증 — 이 Feature 시나리오별, 이 정책 내용으로 돌린 최신 실행(없으면 null). 시나리오가 없는 Feature는 빈 목록 */
  virtual?: VirtualEvidence[];
}

/** 문맥으로 쓸 수 있는 이름 — 평가기 vehicleContext와 같다 */
export const CONTEXT_NAMES = ['vehicleKey', 'country', 'vehicleModel', 'vehicleTrim', 'modelYear', 'upgVc', 'swVersion', 'trialSessionValid'] as const;

const done = (componentId: string, ko: string, findings: ValidatorResult['findings'], pass: string): ValidatorResult => ({
  componentId,
  ko,
  result: findings.some((f) => f.result === 'FAIL') ? 'FAIL' : findings.some((f) => f.result === 'CONDITIONAL') ? 'CONDITIONAL' : 'PASS',
  summary: findings.length ? findings.map((f) => f.message).slice(0, 2).join(' / ') : pass,
  findings,
});

function valueValid(c: Constraint, v: string) {
  if (c.operator.startsWith('NUM_')) return decimalCompare(v, v) !== null;
  if (c.operator.startsWith('SEMVER_')) return semverCompare(v, v) !== null;
  if (c.operator.startsWith('DATE_')) return time(v) !== null;
  return true;
}

/** D06-01 정책 검증 — 형식·제어점·충돌 */
export function validatePolicy(i: ValidationInput): ValidatorResult {
  const f: ValidatorResult['findings'] = [];
  const p = i.policy;
  if (!i.feature.controlPoints.includes(p.controlPoint)) f.push({ result: 'FAIL', message: `Feature에 ${p.controlPoint} Control Point가 없습니다 (${i.feature.controlPoints.join(', ') || '없음'})` });
  for (const s of p.strategies) {
    for (const c of s.constraints) {
      if (!(CONTEXT_NAMES as readonly string[]).includes(c.contextName)) f.push({ result: 'CONDITIONAL', message: `${s.name}: 알 수 없는 문맥 ${c.contextName} — 차량에서 UNKNOWN(HOLD)이 됩니다` });
      for (const v of c.values) if (!valueValid(c, v)) f.push({ result: 'FAIL', message: `${s.name}: ${c.operator} 값 ${v} 형식 오류` });
      if ((c.operator.startsWith('NUM_') || c.operator.startsWith('SEMVER_') || c.operator.startsWith('DATE_')) && c.values.length !== 1) f.push({ result: 'FAIL', message: `${s.name}: ${c.operator}는 값 1개만 받습니다` });
    }
    // 같은 전략 안 모순: 같은 문맥 IN 집합이 서로 겹치지 않으면 만족 불가
    const ins = s.constraints.filter((c) => c.operator === 'IN' && !c.inverted);
    for (let a = 0; a < ins.length; a++)
      for (let b = a + 1; b < ins.length; b++)
        if (ins[a].contextName === ins[b].contextName && !ins[a].values.some((v) => ins[b].values.includes(v)))
          f.push({ result: 'FAIL', message: `${s.name}: ${ins[a].contextName} 조건이 서로 모순 — 어떤 차량도 만족할 수 없습니다` });
  }
  for (const o of i.activePolicies.filter((x) => x.controlPoint === p.controlPoint && x.policyId !== p.policyId))
    f.push({ result: 'INFO', message: `같은 제어점의 ${o.status} 정책 ${o.policyId} r${o.revision}을(를) 대체합니다` });
  for (const o of i.flagKeyClash) f.push({ result: 'FAIL', message: `flagKey ${p.flagKey}를 ${o.featureId}의 ${o.policyId}가 이미 씁니다` });
  return done('D06-01', '정책 검증', f, '형식·제어점·충돌 이상 없음');
}

/** D03-01 컴플라이언스 룰 — 안전 등급별 Safe Default·단계 배포, 사용 권한 상품 구성 */
export function validateCompliance(i: ValidationInput): ValidatorResult {
  const f: ValidatorResult['findings'] = [];
  const asil = i.feature.asil;
  if (asil !== 'QM' && i.policy.safeDefault) f.push({ result: 'FAIL', message: `ASIL ${asil} Feature의 Safe Default는 OFF(false)여야 합니다` });
  if ((asil === 'C' || asil === 'D') && i.policy.rollout.mode === 'ALL') f.push({ result: 'CONDITIONAL', message: `ASIL ${asil}는 코호트 단계 배포를 먼저 거쳐야 합니다` });
  if (i.policy.entitlementCatalogId) {
    if (i.entitlementProductOk === null) f.push({ result: 'FAIL', message: `사용 권한 상품 ${i.policy.entitlementCatalogId}이(가) 없습니다` });
    else if (!i.entitlementProductOk) f.push({ result: 'FAIL', message: `${i.policy.entitlementCatalogId} 구성에 ${i.feature.featureId}가 없습니다` });
  }
  return done('D03-01', '컴플라이언스 룰 체커', f, `ASIL ${asil} 규칙 충족`);
}

/** D06-03 차량 시나리오 — 데모 Fleet에 정책을 배포했다고 가정하고 평가 */
/** vECU 가상검증 결과 → 검증기 근거. 미실행·미연결은 보완 필요(HOLD), Gate 판정 기준 FAIL은 FAIL. */
function virtualFindings(i: ValidationInput, validator: VirtualScenario['validator']): ValidatorResult['findings'] {
  const out: ValidatorResult['findings'] = [];
  for (const { scenario: s, run: r } of (i.virtual ?? []).filter((v) => v.scenario.validator === validator)) {
    if (!r) out.push({ result: 'CONDITIONAL', message: `vECU 가상검증 ${s.scenarioId} 미실행 — 현재 정책 내용으로 실행해야 합니다` });
    else if (r.source !== 'vecu') out.push({ result: 'CONDITIONAL', message: `vECU 미연결 — ${s.scenarioId} 결과는 증적으로 인정하지 않습니다` });
    else if (r.gateResult !== 'PASS') {
      const bad = r.criteria.filter((c) => c.deciding && c.status !== 'pass' && c.status !== 'na');
      out.push({ result: 'FAIL', message: `vECU ${s.scenarioId} FAIL (${r.testId}): ${bad.map((c) => `${c.label} ${c.value ?? '?'}${c.unit} (기준 ${c.op} ${c.limit})`).join(', ')}` });
    } else {
      out.push({ result: 'INFO', message: `vECU ${s.scenarioId} PASS (${r.testId})` });
      const intended = r.criteria.filter((c) => !c.deciding && c.status === 'fail');
      if (intended.length) out.push({ result: 'INFO', message: `오류 주입 구간 기준 미달(의도된 결과, Kill 이전): ${intended.map((c) => `${c.label} ${c.value}${c.unit}`).join(', ')}` });
    }
  }
  return out;
}

export async function validateScenario(i: ValidationInput): Promise<ValidatorResult> {
  const f: ValidatorResult['findings'] = virtualFindings(i, 'D06-03');
  const scope: PolicyScope = { country: i.feature.country, vehicleModel: i.feature.vehicleModel, trim: i.feature.trim };
  const inScope = i.fleet.filter((v) => v.country === scope.country && v.vehicleModel === scope.vehicleModel && v.trim === scope.trim);
  const asDeployed = { ...i.policy, status: 'DEPLOYED' as const };
  const counts = { ALLOW: 0, DENY: 0, HOLD: 0 };
  for (const v of inScope) {
    const r = await evaluateFlag({ policy: asDeployed, scope, killed: false, vehicle: v, entitlementActive: i.policy.entitlementCatalogId ? true : null });
    const k = r.decision === 'ALLOW' ? 'ALLOW' : r.decision === 'DENY' ? 'DENY' : 'HOLD';
    // HOLD(문맥 불명)는 P0가 정한 안전 동작(Safe Default 유지)이므로 결함이 아니다 — 수만 요약에 남긴다
    counts[k]++;
  }
  if (!inScope.length) f.push({ result: 'CONDITIONAL', message: `범위 ${scope.country}/${scope.vehicleModel}/${scope.trim} 시험 차량이 없습니다` });
  else if (counts.ALLOW === 0) f.push({ result: 'CONDITIONAL', message: '범위 안 시험 차량 중 활성화되는 차량이 없습니다' });
  return done('D06-03', '차량 시나리오 검증', f, `범위 차량 ${inScope.length}대: ALLOW ${counts.ALLOW} · DENY ${counts.DENY} · HOLD(Safe Default) ${counts.HOLD}`);
}

/** D06-06 안전 동작 — G4 Control Gate(Safe Default·Rollback·Kill 근거) */
export function validateSafeBehavior(i: ValidationInput): ValidatorResult {
  const g = i.gates.G4;
  const f: ValidatorResult['findings'] = g === 'PASS' ? [] : [{ result: g === '검토 중' ? 'CONDITIONAL' : 'FAIL', message: `G4 Control Gate ${g ?? '미판정'} — Safe Default·Rollback·Kill 근거 미확인` }];
  f.push(...virtualFindings(i, 'D06-06'));
  return done('D06-06', '안전 동작 검증', f, `G4 PASS · Safe Default ${i.policy.safeDefault ? 'ON' : 'OFF'}`);
}

/** D06-02 시스템 연동 — Function→SW→ECU가 기준정보와 맞고 활성인가 */
export function validateIntegration(i: ValidationInput): ValidatorResult {
  const f: ValidatorResult['findings'] = [];
  if (!i.trace.length) f.push({ result: 'FAIL', message: '구현 연결(Function→SW→ECU)이 없습니다' });
  for (const t of i.trace) {
    if (!t.swFound) f.push({ result: 'FAIL', message: `${t.swId}@${t.swVersion} on ${t.ecuPno}: SW 기준정보 없음` });
    if (!t.ecuActive) f.push({ result: 'FAIL', message: `${t.ecuPno}: 제어기 비활성·미등록` });
  }
  return done('D06-02', '시스템 연동 검증', f, `SW 형상 ${i.trace.length}건 일치`);
}

/** D06-05 변경 영향 — 필요로 하는 Feature의 성숙도, 영향 받는 출시 상품 */
export function validateChangeImpact(i: ValidationInput): ValidatorResult {
  const f: ValidatorResult['findings'] = [];
  for (const r of i.requiresTargets)
    if (!r.targetLifecycle || LIFECYCLE_RANK[r.targetLifecycle] < LIFECYCLE_RANK.VERIFIED)
      f.push({ result: 'CONDITIONAL', message: `${r.dependencyId}: 필요 Feature ${r.targetFeatureId} ${r.targetVersion ?? '?'}가 ${r.targetLifecycle ?? '미등록'}` });
  const released = i.affectedProducts.filter((p) => p.lifecycle === 'RELEASED');
  if (released.length) f.push({ result: 'INFO', message: `출시 상품 ${released.map((p) => p.catalogId).join(', ')}에 영향 — 상품 담당 통지` });
  return done('D06-05', '변경 영향 검증', f, `REQUIRES ${i.requiresTargets.length}건 충족 · 영향 상품 ${i.affectedProducts.length}건`);
}

/** D04-02 품질 기준 — G5 Verification Gate (TMS 시험 증적, IF-09) */
export function validateQuality(i: ValidationInput): ValidatorResult {
  const g = i.gates.G5;
  const f: ValidatorResult['findings'] = g === 'PASS' ? [] : [{ result: g === 'FAIL' ? 'FAIL' : 'CONDITIONAL', message: `G5 Verification Gate ${g ?? '미판정'} — TMS 시험 증적 필요(IF-09)` }];
  return done('D04-02', '품질 기준 검증', f, 'G5 PASS — 시험 증적 확인');
}

/** D06-07 안전 요구사항 추적 — 요구사항 연결·G2, 안전 등급이면 G7 */
export function validateSafetyTrace(i: ValidationInput): ValidatorResult {
  const f: ValidatorResult['findings'] = [];
  if (!i.feature.requirementIds.length) f.push({ result: 'FAIL', message: 'Requirement ID 연결 없음' });
  if (i.gates.G2 !== 'PASS') f.push({ result: 'CONDITIONAL', message: `G2 Requirement Gate ${i.gates.G2 ?? '미판정'}` });
  if (i.feature.asil !== 'QM' && i.gates.G7 !== 'PASS') f.push({ result: 'CONDITIONAL', message: `ASIL ${i.feature.asil}: G7 Safety/Security Gate ${i.gates.G7 ?? '미판정'}` });
  return done('D06-07', '안전 요구사항 추적', f, `요구사항 ${i.feature.requirementIds.join(', ')} 추적`);
}

/** 8종을 병렬 실행 (PPT: '분야별 검증은 병렬 수행') — 순서는 표시용으로 고정 */
export async function runValidators(i: ValidationInput): Promise<ValidatorResult[]> {
  return Promise.all([
    Promise.resolve(validatePolicy(i)),
    Promise.resolve(validateCompliance(i)),
    validateScenario(i),
    Promise.resolve(validateSafeBehavior(i)),
    Promise.resolve(validateIntegration(i)),
    Promise.resolve(validateChangeImpact(i)),
    Promise.resolve(validateQuality(i)),
    Promise.resolve(validateSafetyTrace(i)),
  ]);
}

/** D03-02 배포 안전성 — 보수적 종합: FAIL 하나라도 BLOCKED, CONDITIONAL이면 HOLD, 모두 PASS면 GO */
export function deploySafety(results: ValidatorResult[]): { decision: 'GO' | 'HOLD' | 'BLOCKED'; reasons: string[] } {
  const fails = results.filter((r) => r.result === 'FAIL');
  const conds = results.filter((r) => r.result === 'CONDITIONAL');
  if (fails.length) return { decision: 'BLOCKED', reasons: fails.map((r) => `${r.ko}: ${r.summary}`) };
  if (conds.length) return { decision: 'HOLD', reasons: conds.map((r) => `${r.ko}: ${r.summary}`) };
  return { decision: 'GO', reasons: [] };
}

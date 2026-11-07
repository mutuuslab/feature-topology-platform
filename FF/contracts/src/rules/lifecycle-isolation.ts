// 수명주기 격리 — 순수 규칙(zod 없음). 차량 시뮬레이터(시험·시연)와 백엔드 연습 기록이 같은 함수를 쓴다.
// ADS-LC01 Shadow 경로 격리(FFP-F061): Shadow 정책 봉투는 출력·활성화·설치 권한이 없다 — 차량은 판단만 기록하고 액추에이터·정책 수락·설치 상태를 바꾸지 않는다.
// ADS-LC02 지원 종료·서버 교체 연습(FFP-F063): 기준선·차단·키 갱신이 유지되고, 서버가 바뀌어도 차량이 미승인 ON으로 초기화되지 않는다(Retirement 6단계와 연결).

export interface ShadowEnvelope {
  mode: 'SHADOW' | string;
  experimentId: string;
  featureId: string;
  flagKey: string;
  capabilities: { output: boolean; activation: boolean; install: boolean };
  /** 차량은 판단만 기록한다 */
  decisionLogOnly: true;
}

/** Shadow 봉투 — 권한 세 칸은 늘 거짓(만드는 쪽이 바꿀 수 없다) */
export function shadowEnvelope(i: { experimentId: string; featureId: string; flagKey: string }): ShadowEnvelope {
  return { mode: 'SHADOW', experimentId: i.experimentId, featureId: i.featureId, flagKey: i.flagKey, capabilities: { output: false, activation: false, install: false }, decisionLogOnly: true };
}

/** 와이어 검사 — 차량·게이트웨이가 받기 전에 본다. 권한 하나라도 참이면 거부 */
export function shadowEnvelopeIssues(e: ShadowEnvelope): { code: 'SHADOW_MODE_REQUIRED' | 'SHADOW_CAPABILITY_FORBIDDEN'; message: string }[] {
  const out: { code: 'SHADOW_MODE_REQUIRED' | 'SHADOW_CAPABILITY_FORBIDDEN'; message: string }[] = [];
  if (e.mode !== 'SHADOW') out.push({ code: 'SHADOW_MODE_REQUIRED', message: `Shadow 봉투의 mode는 SHADOW여야 합니다(받은 값 ${e.mode}).` });
  const on = (Object.keys(e.capabilities) as (keyof ShadowEnvelope['capabilities'])[]).filter((k) => e.capabilities[k] !== false);
  if (on.length) out.push({ code: 'SHADOW_CAPABILITY_FORBIDDEN', message: `Shadow 정책에는 ${on.join('·')} 권한을 줄 수 없습니다 — 판단만 기록합니다.` });
  return out;
}

export interface SimVehicle {
  vin: string;
  actuator: 'IDLE' | 'ACTIVE';
  acceptedPolicyHash: string | null;
  installedSw: string | null;
  flagValue: boolean;
  shadowLog: { experimentId: string; decision: string; value: unknown }[];
  /** 차량이 믿는 서명 키(신뢰 앵커) */
  trustedKeys: string[];
  /** 마지막으로 서명·순번을 검증해 적용한 기준선 */
  lastVerified: { policyHash: string; value: boolean; keyId: string } | null;
}

/** 시뮬 차량의 Shadow 적용 — 봉투가 격리 조건을 어기면 통째로 버리고, 맞으면 판단 기록만 더한다(TC23) */
export function vehicleApplyShadow(v: SimVehicle, env: ShadowEnvelope, decisions: { decision: string; value: unknown }[]): SimVehicle {
  if (shadowEnvelopeIssues(env).length) return { ...v, shadowLog: [...v.shadowLog] };
  return { ...v, shadowLog: [...v.shadowLog, ...decisions.map((d) => ({ experimentId: env.experimentId, decision: d.decision, value: d.value }))] };
}

/**
 * 서버 교체 뒤 첫 게시본 — 모르는 키로 서명된 게시본은 받지 않고 마지막 검증 기준선을 유지한다.
 * 검증 기준선이 없으면 안전 기본값(OFF) — 미승인 ON으로 초기화하지 않는다.
 */
export function vehicleAfterServerSwap(v: SimVehicle, incoming: { keyId: string; value: boolean; policyHash: string } | null): SimVehicle {
  if (incoming && v.trustedKeys.includes(incoming.keyId)) return { ...v, flagValue: incoming.value, acceptedPolicyHash: incoming.policyHash, lastVerified: { ...incoming } };
  if (v.lastVerified) return { ...v, flagValue: v.lastVerified.value, acceptedPolicyHash: v.lastVerified.policyHash };
  return { ...v, flagValue: false, acceptedPolicyHash: null };
}

export type DrillCheckId = 'BASELINE_KEPT' | 'BLOCK_KEPT' | 'KEY_RENEWAL' | 'NO_UNAPPROVED_ON';
export const DRILL_CHECK_LABEL: Record<DrillCheckId, string> = { BASELINE_KEPT: '기준선 유지', BLOCK_KEPT: '차단 유지', KEY_RENEWAL: '키 갱신 유지', NO_UNAPPROVED_ON: '미승인 ON 없음' };
export interface DrillInput {
  featureId: string;
  version: string;
  lifecycle: string;
  /** 마지막 승인·배포 기준선(정책) — 없으면 기준선 유지 실패 */
  baseline: { policyId: string; contentHash: string; safeDefault: boolean } | null;
  kill: { active: boolean; killId: string | null } | null;
  keys: { keyId: string; purpose: string; status: string; notAfter: string }[];
  vehicles: SimVehicle[];
  now: number;
  /** 연습 지평 — 이 기간 안에 정책·차단 키가 만료되면 키 갱신 실패 */
  horizonDays: number;
}
export interface DrillResult {
  checks: { id: DrillCheckId; label: string; result: 'PASS' | 'FAIL'; basis: string }[];
  passed: boolean;
  vehiclesAfter: { vin: string; flagValue: boolean; acceptedPolicyHash: string | null }[];
}

/** 지원 종료 연습 — 서버를 새로 띄운 것처럼(모르는 키 게시본) 차량 상태를 다시 계산하고 네 칸을 판정한다 */
export function supportEndDrill(i: DrillInput): DrillResult {
  const horizon = i.now + i.horizonDays * 86_400_000;
  const after = i.vehicles.map((v) => vehicleAfterServerSwap(v, { keyId: 'KEY-REPLACED-SERVER', value: true, policyHash: 'sha256:replaced' }));
  const baselineOk = !!i.baseline && after.every((v) => v.lastVerified !== null);
  const blockOk = !i.kill?.active || after.every((v) => v.flagValue === false);
  const live = (p: string) => i.keys.filter((k) => k.purpose === p && k.status === 'ACTIVE');
  const renewalOk = ['policy', 'kill'].every((p) => live(p).some((k) => Date.parse(k.notAfter) > horizon));
  const approvedOn = (v: SimVehicle) => v.lastVerified?.value === true;
  const unapproved = after.filter((v) => v.flagValue && !approvedOn(v));
  const checks: DrillResult['checks'] = [
    { id: 'BASELINE_KEPT', label: DRILL_CHECK_LABEL.BASELINE_KEPT, result: baselineOk ? 'PASS' : 'FAIL', basis: i.baseline ? `${i.baseline.policyId} ${i.baseline.contentHash.slice(0, 15)} — 검증 기준선 보유 ${after.filter((v) => v.lastVerified).length}/${after.length}대` : '승인·배포 기준선 없음' },
    { id: 'BLOCK_KEPT', label: DRILL_CHECK_LABEL.BLOCK_KEPT, result: blockOk ? 'PASS' : 'FAIL', basis: i.kill?.active ? `차단 ${i.kill.killId ?? ''} 유지 — 켜진 차량 ${after.filter((v) => v.flagValue).length}대` : '진행 중 차단 없음' },
    { id: 'KEY_RENEWAL', label: DRILL_CHECK_LABEL.KEY_RENEWAL, result: renewalOk ? 'PASS' : 'FAIL', basis: `정책·차단 서명 키가 ${i.horizonDays}일 뒤에도 유효 — ${['policy', 'kill'].map((p) => `${p} ${live(p).map((k) => k.notAfter.slice(0, 10)).join('·') || '없음'}`).join(', ')}` },
    { id: 'NO_UNAPPROVED_ON', label: DRILL_CHECK_LABEL.NO_UNAPPROVED_ON, result: unapproved.length ? 'FAIL' : 'PASS', basis: unapproved.length ? `미승인 ON 차량 ${unapproved.map((v) => v.vin).join('·')}` : `서버 교체 뒤 미승인 ON 0대(${after.length}대 중)` },
  ];
  return { checks, passed: checks.every((c) => c.result === 'PASS'), vehiclesAfter: after.map((v) => ({ vin: v.vin, flagValue: v.flagValue, acceptedPolicyHash: v.acceptedPolicyHash })) };
}

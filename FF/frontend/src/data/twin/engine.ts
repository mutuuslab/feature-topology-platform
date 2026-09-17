/**
 * Vehicle Digital Twin — pure evaluation engine.
 *
 * Everything in here is a pure function: given twins + a clock it returns verdicts.
 * The same functions back the fleet overview, the impact preview, the vehicle detail
 * screen and the what-if simulation, so a simulated vehicle is judged with exactly the
 * same policy/local-guard logic as a fleet vehicle (§12.3).
 *
 * No actuator is ever commanded from here — the twin only produces intent
 * (Desired) and observes results (Reported / Effective).
 */

import * as T from './types';
import { verification } from '../engine';

/* ------------------------------------------------------------------ */
/* Reason code registry                                                */
/* ------------------------------------------------------------------ */

const R = (
  code: T.ReasonCode,
  kind: T.ReasonKind,
  severity: T.ReasonSeverity,
  label: T.Localized,
  desc: T.Localized,
  recommendation: T.Localized,
  incident = false,
): T.ReasonCodeDef => ({ code, kind, severity, label, desc, recommendation, incident });

export const REASON_CODES: Record<T.ReasonCode, T.ReasonCodeDef> = {
  CONVERGED: R(
    'CONVERGED',
    'RESULT',
    'PASS',
    { ko: '정상 수렴', en: 'Converged' },
    { ko: '중앙 정책·차량 보고·실행 상태가 모두 일치합니다.', en: 'Central policy, vehicle report and effective state all agree.' },
    { ko: '추가 조치 없음. 모니터링을 유지하세요.', en: 'No action required; keep monitoring.' },
  ),
  POLICY_APPLIED_OK: R(
    'POLICY_APPLIED_OK',
    'RESULT',
    'PASS',
    { ko: '정상 적용 (Policy-only 활성화 가능)', en: 'Applied normally (policy-only eligible)' },
    { ko: '차량이 정책을 수신·검증하고 실제로 활성화했습니다.', en: 'The vehicle received, verified and activated the policy.' },
    { ko: '추가 조치 없음.', en: 'No action required.' },
  ),
  PENDING_POLICY_DELIVERY: R(
    'PENDING_POLICY_DELIVERY',
    'POLICY',
    'PENDING',
    { ko: '정책 전달 대기', en: 'Awaiting policy delivery' },
    { ko: 'Desired 상태가 설정되었지만 차량이 아직 수신·보고하지 않았습니다.', en: 'Desired is set but the vehicle has not received/reported yet.' },
    { ko: '배포 채널과 차량 접속 상태를 확인하고, 수렴 임계 시간 내 재확인하세요.', en: 'Check the delivery channel and connectivity, then re-check within the convergence window.' },
  ),
  POLICY_NOT_RECEIVED: R(
    'POLICY_NOT_RECEIVED',
    'POLICY',
    'PENDING',
    { ko: 'Policy 미수신', en: 'Policy not received' },
    { ko: '차량이 해당 정책을 한 번도 수신하지 않았습니다.', en: 'The vehicle has never received this policy.' },
    { ko: 'Vehicle Agent 접속과 Policy 배포 로그를 확인하세요.', en: 'Verify vehicle-agent connectivity and the policy delivery log.' },
  ),
  POLICY_VERSION_OUTDATED: R(
    'POLICY_VERSION_OUTDATED',
    'POLICY',
    'FAIL',
    { ko: 'Policy Version 역전 거부', en: 'Policy version reversal rejected' },
    { ko: '차량 보유 버전보다 낮은 Policy Version이 수신되어 차량이 적용을 거부했습니다.', en: 'A lower policy version than the one already held was received and rejected.' },
    { ko: '배포 서버의 정책 순번을 확인하고 상위 버전으로 재배포하세요.', en: 'Check the policy sequence on the delivery server and re-publish a newer version.' },
    true,
  ),
  POLICY_SIGNATURE_INVALID: R(
    'POLICY_SIGNATURE_INVALID',
    'POLICY',
    'FAIL',
    { ko: 'Policy 서명 검증 실패', en: 'Policy signature invalid' },
    { ko: '서명이 일치하지 않아 차량이 정책 적용을 거부했습니다. (SIMULATED SECURITY)', en: 'Signature mismatch; the vehicle refused to apply the policy. (SIMULATED SECURITY)' },
    { ko: '서명 키/배포 파이프라인을 점검하고 재서명 후 재배포하세요.', en: 'Inspect signing keys/pipeline, re-sign and redeploy.' },
    true,
  ),
  OFFLINE_POLICY_CACHE_VALID: R(
    'OFFLINE_POLICY_CACHE_VALID',
    'LINK',
    'INFO',
    { ko: '오프라인 — 서명 Policy 캐시 유효', en: 'Offline — signed policy cache valid' },
    { ko: '차량이 접속되지 않아 마지막으로 수신한 서명 정책을 TTL 내에서 계속 사용했습니다.', en: 'Vehicle unreachable; the last signed policy is still used within its TTL.' },
    { ko: 'TTL 만료 전에 재접속을 확인하세요.', en: 'Confirm reconnection before the TTL expires.' },
  ),
  OFFLINE_POLICY_TTL_EXPIRED: R(
    'OFFLINE_POLICY_TTL_EXPIRED',
    'LINK',
    'FAIL',
    { ko: '오프라인 TTL 만료', en: 'Offline policy TTL expired' },
    { ko: '오프라인 캐시 정책의 유효 시간이 지나 더 이상 판단에 사용할 수 없습니다.', en: 'The cached policy exceeded its validity window and can no longer be used.' },
    { ko: '차량 접속을 복구하고 정책을 재수신하세요.', en: 'Restore connectivity and re-deliver the policy.' },
    true,
  ),
  SAFE_DEFAULT_APPLIED: R(
    'SAFE_DEFAULT_APPLIED',
    'SAFETY',
    'PENDING',
    { ko: 'Safe Default 적용 (OFF)', en: 'Safe default applied (OFF)' },
    { ko: '판단 근거가 유효하지 않아 안전 기본값 OFF로 복귀했습니다.', en: 'The basis for a decision was invalid, so the vehicle returned to its safe default OFF.' },
    { ko: '접속/텔레메트리를 복구한 뒤 정책을 재배포하세요.', en: 'Restore connectivity/telemetry, then redeploy the policy.' },
  ),
  HARDWARE_CAPABILITY_MISSING: R(
    'HARDWARE_CAPABILITY_MISSING',
    'ELIGIBILITY',
    'FAIL',
    { ko: 'HW Capability 부족', en: 'Hardware capability missing' },
    { ko: 'As-Built 구성에 필요한 HW(배터리 히터)가 없어 이 기능을 활성화할 수 없습니다.', en: 'The as-built configuration lacks the required hardware (battery heater).' },
    { ko: '해당 VIN을 대상에서 제외하거나 HW 사양을 확인하세요.', en: 'Exclude the VIN from the target or review the hardware spec.' },
  ),
  VARIANT_CODING_MISMATCH: R(
    'VARIANT_CODING_MISMATCH',
    'CONFIG',
    'FAIL',
    { ko: 'Variant Coding 불일치', en: 'Variant coding mismatch' },
    { ko: '차량 Variant Coding이 대상 Vehicle Configuration과 다릅니다.', en: 'The vehicle variant coding differs from the target vehicle configuration.' },
    { ko: 'Variant Rule과 차량 코딩을 대조하고 필요 시 Config 재적용하세요.', en: 'Compare the variant rule against the vehicle coding and re-apply config if needed.' },
  ),
  BMS_SOFTWARE_BELOW_MINIMUM: R(
    'BMS_SOFTWARE_BELOW_MINIMUM',
    'ELIGIBILITY',
    'FAIL',
    { ko: 'BMS SW 버전 부족', en: 'BMS software below minimum' },
    { ko: `BMS SW ${T.FEATURE_REQUIREMENTS.minimumBmsSoftware} 이상이 필요합니다. Policy-only로는 활성화할 수 없습니다.`, en: `BMS SW ${T.FEATURE_REQUIREMENTS.minimumBmsSoftware}+ is required; policy-only activation is not possible.` },
    { ko: 'Binary OTA로 BMS SW를 선행 업데이트한 뒤 다시 시도하세요.', en: 'Update BMS software via binary OTA first, then retry.' },
  ),
  ONE_BINARY_BELOW_MINIMUM: R(
    'ONE_BINARY_BELOW_MINIMUM',
    'ELIGIBILITY',
    'FAIL',
    { ko: 'One-Binary 버전 부족', en: 'One-binary version below minimum' },
    { ko: `설치된 One-Binary가 ${T.FEATURE_REQUIREMENTS.minimumOneBinary} 미만이라 기능 코드가 차량에 없습니다.`, en: `Installed one-binary is below ${T.FEATURE_REQUIREMENTS.minimumOneBinary}; the feature code is absent.` },
    { ko: '해당 VIN을 Binary OTA 대상에 포함하세요.', en: 'Include the VIN in the binary OTA campaign.' },
  ),
  ENTITLEMENT_INACTIVE: R(
    'ENTITLEMENT_INACTIVE',
    'ELIGIBILITY',
    'FAIL',
    { ko: 'Entitlement 없음', en: 'Entitlement inactive' },
    { ko: '해당 차량에 Entitlement(BAT_PRECOND_PLUS)가 활성화되어 있지 않습니다.', en: 'The entitlement (BAT_PRECOND_PLUS) is not active for this vehicle.' },
    { ko: 'Catalog/Entitlement 시스템에서 권한을 부여하거나 대상을 제외하세요.', en: 'Grant the entitlement in the catalog system or exclude the vehicle.' },
  ),
  BATTERY_TEMP_SIGNAL_STALE: R(
    'BATTERY_TEMP_SIGNAL_STALE',
    'GUARD',
    'FAIL',
    { ko: '배터리 온도 신호 Stale', en: 'Battery temperature signal stale' },
    { ko: '배터리 온도 신호가 TTL을 초과해 안전 판단을 할 수 없습니다.', en: 'Battery temperature exceeded its TTL, so no safe decision is possible.' },
    { ko: 'BMS 텔레메트리 수집을 복구하고 신호가 갱신된 뒤 재판정하세요.', en: 'Restore BMS telemetry, wait for a fresh signal and re-evaluate.' },
    true,
  ),
  BATTERY_TEMP_OUT_OF_RANGE: R(
    'BATTERY_TEMP_OUT_OF_RANGE',
    'GUARD',
    'FAIL',
    { ko: '배터리 온도 허용 범위 초과', en: 'Battery temperature out of range' },
    { ko: '배터리 온도가 사전 예열 허용 범위를 벗어났습니다.', en: 'Battery temperature is outside the preconditioning range.' },
    { ko: '온도가 안정될 때까지 기능을 차단하고 유지하세요.', en: 'Keep the feature blocked until temperature stabilises.' },
  ),
  SOC_BELOW_THRESHOLD: R(
    'SOC_BELOW_THRESHOLD',
    'GUARD',
    'FAIL',
    { ko: 'SOC 임계 미만', en: 'SOC below threshold' },
    { ko: 'SOC가 20% 미만이면 사전 예열을 실행하지 않습니다.', en: 'Preconditioning is not executed below 20% SOC.' },
    { ko: '충전 후 재평가하세요. Safe Default(OFF) 유지.', en: 'Re-evaluate after charging; safe default (OFF) stays.' },
  ),
  CHARGING_SCHEDULE_MISSING: R(
    'CHARGING_SCHEDULE_MISSING',
    'GUARD',
    'FAIL',
    { ko: '충전 스케줄 없음', en: 'No charging schedule' },
    { ko: '충전 스케줄이 등록되어 있지 않아 예열 시점을 계산할 수 없습니다.', en: 'No charging schedule is registered, so the preconditioning window cannot be computed.' },
    { ko: '차량 또는 앱에서 충전 스케줄을 설정하세요.', en: 'Set a charging schedule in the vehicle or app.' },
  ),
  CHARGING_CONNECTOR_OPEN: R(
    'CHARGING_CONNECTOR_OPEN',
    'GUARD',
    'FAIL',
    { ko: '충전 커넥터 미연결', en: 'Charging connector not connected' },
    { ko: '충전 커넥터가 연결되지 않아 예열 조건이 충족되지 않았습니다.', en: 'The charging connector is not connected, so preconditioning conditions are unmet.' },
    { ko: '커넥터 연결 후 재평가하세요.', en: 'Re-evaluate after connecting the charger.' },
  ),
  POWER_MODE_NOT_READY: R(
    'POWER_MODE_NOT_READY',
    'GUARD',
    'FAIL',
    { ko: '차량 전원 모드 미충족', en: 'Vehicle power mode not ready' },
    { ko: '차량 전원 모드가 OFF/ACC 상태여서 예열을 시작할 수 없습니다.', en: 'The vehicle power mode is OFF/ACC, so preconditioning cannot start.' },
    { ko: '전원 모드가 READY/ON 일 때 재평가하세요.', en: 'Re-evaluate when the power mode is READY/ON.' },
  ),
  SIGNAL_QUALITY_BAD: R(
    'SIGNAL_QUALITY_BAD',
    'GUARD',
    'FAIL',
    { ko: '신호 품질 불량', en: 'Signal quality bad' },
    { ko: '필수 신호의 품질이 GOOD이 아니어서 판단을 차단했습니다.', en: 'A required signal was not GOOD, so the decision was blocked.' },
    { ko: '신호 품질이 확보될 때까지 차단 상태를 유지하세요.', en: 'Keep the block until signal quality recovers.' },
  ),
  TELEMETRY_TIMEOUT: R(
    'TELEMETRY_TIMEOUT',
    'UNKNOWN',
    'FAIL',
    { ko: 'Telemetry 타임아웃', en: 'Telemetry timeout' },
    { ko: '수집 주기 내 텔레메트리가 도착하지 않아 상태를 확정할 수 없습니다.', en: 'Telemetry did not arrive within its collection interval.' },
    { ko: '게이트웨이·수집 파이프라인을 확인하고 재수집하세요.', en: 'Verify the gateway/ingestion pipeline and re-collect.' },
  ),
  TWIN_SNAPSHOT_MISSING: R(
    'TWIN_SNAPSHOT_MISSING',
    'UNKNOWN',
    'FAIL',
    { ko: '차량 상태 스냅샷 없음', en: 'Vehicle state snapshot missing' },
    { ko: '해당 VIN의 As-Built/배포 스냅샷이 없어 차량 상태를 구성할 수 없습니다.', en: 'No as-built/deployment snapshot for this VIN, so the vehicle state cannot be composed.' },
    { ko: 'EOL/Binary 스냅샷을 Ingest한 뒤 재판정하세요.', en: 'Ingest the EOL/binary snapshot and re-evaluate.' },
  ),
  POLICY_VERSION_UNKNOWN: R(
    'POLICY_VERSION_UNKNOWN',
    'UNKNOWN',
    'FAIL',
    { ko: 'Policy Version 미확인', en: 'Policy version unknown' },
    { ko: '차량이 보유한 Policy Version을 확인할 수 없습니다.', en: 'The policy version held by the vehicle cannot be determined.' },
    { ko: '배포 이력과 차량 수신 로그를 대조하세요.', en: 'Cross-check delivery history with vehicle receive logs.' },
  ),
  VEHICLE_AGENT_VERSION_UNSUPPORTED: R(
    'VEHICLE_AGENT_VERSION_UNSUPPORTED',
    'UNKNOWN',
    'FAIL',
    { ko: 'Vehicle Agent 버전 미지원', en: 'Vehicle agent version unsupported' },
    { ko: '차량의 Vehicle Agent 버전이 이 Feature를 해석할 수 없습니다.', en: 'The vehicle agent version cannot interpret this feature.' },
    { ko: '지원 버전으로 OTA 후 재시도하세요.', en: 'OTA to a supported version, then retry.' },
  ),
  CONFIGURATION_MISMATCH: R(
    'CONFIGURATION_MISMATCH',
    'UNKNOWN',
    'FAIL',
    { ko: 'Configuration 불일치', en: 'Configuration mismatch' },
    { ko: 'As-Designed/As-Built/As-Deployed 구성이 서로 맞지 않습니다.', en: 'As-designed/as-built/as-deployed configurations disagree.' },
    { ko: '구성 스냅샷을 재수집하고 Variant Coding을 확인하세요.', en: 'Re-ingest configuration snapshots and verify variant coding.' },
  ),
  SIGNAL_QUALITY_UNKNOWN: R(
    'SIGNAL_QUALITY_UNKNOWN',
    'UNKNOWN',
    'FAIL',
    { ko: '신호 품질 미확인', en: 'Signal quality unknown' },
    { ko: '신호 품질 값을 받지 못해 신뢰도를 판단할 수 없습니다.', en: 'Signal quality was not provided, so trustworthiness cannot be judged.' },
    { ko: '품질 값을 확보할 때까지 안전 판단을 보류하세요.', en: 'Hold safety decisions until quality is available.' },
  ),
  BACKEND_PROCESSING_FAILURE: R(
    'BACKEND_PROCESSING_FAILURE',
    'UNKNOWN',
    'FAIL',
    { ko: '백엔드 처리 실패', en: 'Backend processing failure' },
    { ko: '차량 상태 수렴 파이프라인이 실패했습니다.', en: 'The vehicle state reconciliation pipeline failed.' },
    { ko: '파이프라인 실패 로그를 확인하고 재처리하세요.', en: 'Inspect the pipeline failure and reprocess.' },
  ),
  CAUSE_ANALYSIS_REQUIRED: R(
    'CAUSE_ANALYSIS_REQUIRED',
    'UNKNOWN',
    'FAIL',
    { ko: '원인 분석 필요', en: 'Cause analysis required' },
    { ko: '자동 분류가 불가능한 상태입니다.', en: 'The state could not be classified automatically.' },
    { ko: '운영자가 원인 분석을 수행하고 Evidence를 남기세요.', en: 'An operator must analyse the cause and record evidence.' },
  ),
  VEHICLE_AGENT_OFFLINE: R(
    'VEHICLE_AGENT_OFFLINE',
    'LINK',
    'FAIL',
    { ko: 'Vehicle Agent 오프라인', en: 'Vehicle agent offline' },
    { ko: 'Vehicle Agent와의 접속이 끊겼습니다.', en: 'The link to the vehicle agent is down.' },
    { ko: '통신 상태를 복구하고 재접속을 확인하세요.', en: 'Restore connectivity and confirm reconnection.' },
    true,
  ),
  EFFECTIVE_DRIFT_DETECTED: R(
    'EFFECTIVE_DRIFT_DETECTED',
    'SAFETY',
    'FAIL',
    { ko: 'Effective Drift 감지', en: 'Effective drift detected' },
    { ko: '중앙 Desired가 OFF인데 차량 Effective가 ON으로 남아 있습니다.', en: 'Central desired is OFF while the vehicle effective state remains ON.' },
    { ko: '즉시 Incident를 열고 Kill-Switch 또는 Rollback을 검토하세요.', en: 'Open an incident immediately and consider kill-switch or rollback.' },
    true,
  ),
  ABNORMAL_DTC: R(
    'ABNORMAL_DTC',
    'SAFETY',
    'FAIL',
    { ko: '비정상 DTC 발생', en: 'Abnormal DTC' },
    { ko: '관련 DTC가 감지되어 신규 Rollout을 정지해야 합니다.', en: 'A related DTC was detected; new rollouts must pause.' },
    { ko: 'DTC 원인을 분석하고 필요 시 Kill-Switch를 실행하세요.', en: 'Analyse the DTC and apply a kill-switch if required.' },
    true,
  ),
  KILL_SWITCH_ACTIVE: R(
    'KILL_SWITCH_ACTIVE',
    'SAFETY',
    'FAIL',
    { ko: 'Kill-Switch 활성', en: 'Kill-switch active' },
    { ko: 'Kill-Switch가 Entitlement와 Policy보다 우선하여 기능을 OFF로 강제합니다.', en: 'The kill-switch outranks entitlement and policy and forces OFF.' },
    { ko: '복구 조건이 확인되면 운영자 승인 후 해제하세요.', en: 'Release after operator approval once recovery conditions are confirmed.' },
    true,
  ),
  ROLLBACK_APPLIED: R(
    'ROLLBACK_APPLIED',
    'POLICY',
    'INFO',
    { ko: 'Rollback 적용', en: 'Rollback applied' },
    { ko: '이전 정책 버전으로 복귀했습니다.', en: 'The previous policy version was restored.' },
    { ko: '수렴 상태로 재복귀하는지 확인하세요.', en: 'Confirm reconvergence.' },
  ),
  LOCAL_GUARD_PASSED: R(
    'LOCAL_GUARD_PASSED',
    'GUARD',
    'PASS',
    { ko: 'Local Guard 통과', en: 'Local Guard passed' },
    { ko: '차량 로컬 조건이 모두 충족되어 실행 가능합니다.', en: 'All local conditions are satisfied.' },
    { ko: '추가 조치 없음.', en: 'No action required.' },
  ),
  LOCAL_GUARD_BLOCKED: R(
    'LOCAL_GUARD_BLOCKED',
    'GUARD',
    'FAIL',
    { ko: 'Local Guard 차단', en: 'Local Guard blocked' },
    { ko: '차량 로컬 조건이 충족되지 않아 실행이 차단되었습니다.', en: 'Local conditions were unmet, so execution was blocked.' },
    { ko: '차단 조건이 해소될 때까지 Safe Default를 유지하세요.', en: 'Keep the safe default until the blocking condition clears.' },
  ),
};

export function reason(code: T.ReasonCode): T.ReasonCodeDef {
  return REASON_CODES[code] ?? REASON_CODES.CAUSE_ANALYSIS_REQUIRED;
}

/* ------------------------------------------------------------------ */
/* Small deterministic helpers                                         */
/* ------------------------------------------------------------------ */

/** FNV-1a — deterministic seeding for the synthetic fleet and simulator. */
export function fnv(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Semver-ish comparison: returns -1/0/1. Tolerates prefixes such as `OB-2.7.0`. */
export function cmpSemver(a: string, b: string): number {
  const nums = (s: string): number[] => {
    const m = String(s).match(/\d+(\.\d+)*/);
    return (m ? m[0] : '0').split('.').map((n) => parseInt(n, 10));
  };
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi !== yi) return xi < yi ? -1 : 1;
  }
  return 0;
}

/** `POL-0042` → 42. Used for the anti-reversal rule. */
export function parsePolicySeq(v: string | null | undefined): number {
  const m = String(v ?? '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function secondsSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

export function isoAt(nowMs: number, offsetMs = 0): string {
  return new Date(nowMs + offsetMs).toISOString().replace('.000Z', 'Z');
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

/* ------------------------------------------------------------------ */
/* Freshness / staleness                                               */
/* ------------------------------------------------------------------ */

export function isSampleStale(s: T.SignalSample | undefined, nowMs: number): boolean {
  if (!s) return true;
  return secondsSince(s.observedAt, nowMs) > s.ttlSeconds;
}

/** Any required signal past its TTL, or unknown quality, makes safety decisions invalid. */
export function staleSignals(twin: T.Twin, nowMs: number): T.SignalKey[] {
  return T.SIGNAL_SPECS.filter((spec) => isSampleStale(twin.context[spec.key], nowMs)).map((s) => s.key);
}

export function missingQualitySignals(twin: T.Twin): T.SignalKey[] {
  return T.SIGNAL_SPECS.filter((spec) => {
    const s = twin.context[spec.key];
    return !s || s.quality === 'BAD' || s.quality === 'UNKNOWN';
  }).map((s) => s.key);
}

/** Offline cache age — the signed policy is unusable after the offline TTL. */
export function offlineCacheExpired(twin: T.Twin, nowMs: number): boolean {
  return secondsSince(twin.link.lastSeenAt, nowMs) > T.DEMO_POLICY.offlineTtlSeconds;
}

/* ------------------------------------------------------------------ */
/* Unknown classification (§9 — Unknown must carry a cause)            */
/* ------------------------------------------------------------------ */

export const SUPPORTED_AGENT_VERSIONS = ['VA-4.1.0', 'VA-4.2.0', 'VA-4.3.0'];

export interface UnknownSignals {
  twin?: T.Twin | null;
  nowMs?: number;
  telemetryAgeSeconds?: number;
  telemetryTtlSeconds?: number;
  policyVersionKnown?: boolean;
  agentVersion?: string;
  configurationMismatch?: boolean;
  signalQualityUnknown?: boolean;
  backendFailure?: boolean;
}

export function classifyUnknown(sig: UnknownSignals): T.UnknownClassification {
  const cause: T.UnknownCause = (() => {
    if (!sig.twin) return 'TWIN_SNAPSHOT_MISSING';
    const ttl = sig.telemetryTtlSeconds ?? (sig.twin.context.BatteryTemperature?.ttlSeconds || 120);
    const age =
      sig.telemetryAgeSeconds ??
      secondsSince(sig.twin.context.BatteryTemperature?.observedAt, sig.nowMs ?? Date.now());
    if (age > ttl * 3) return 'TELEMETRY_TIMEOUT';
    if (sig.policyVersionKnown === false) return 'POLICY_VERSION_UNKNOWN';
    const agent = sig.agentVersion ?? sig.twin.link.vehicleAgentVersion;
    if (agent && !SUPPORTED_AGENT_VERSIONS.includes(agent)) return 'VEHICLE_AGENT_VERSION_UNSUPPORTED';
    if (sig.configurationMismatch) return 'CONFIGURATION_MISMATCH';
    if (sig.signalQualityUnknown) return 'SIGNAL_QUALITY_UNKNOWN';
    if (sig.backendFailure) return 'BACKEND_PROCESSING_FAILURE';
    return 'CAUSE_ANALYSIS_REQUIRED';
  })();

  const map: Record<T.UnknownCause, T.ReasonCode> = {
    TELEMETRY_TIMEOUT: 'TELEMETRY_TIMEOUT',
    TWIN_SNAPSHOT_MISSING: 'TWIN_SNAPSHOT_MISSING',
    POLICY_VERSION_UNKNOWN: 'POLICY_VERSION_UNKNOWN',
    VEHICLE_AGENT_VERSION_UNSUPPORTED: 'VEHICLE_AGENT_VERSION_UNSUPPORTED',
    CONFIGURATION_MISMATCH: 'CONFIGURATION_MISMATCH',
    SIGNAL_QUALITY_UNKNOWN: 'SIGNAL_QUALITY_UNKNOWN',
    BACKEND_PROCESSING_FAILURE: 'BACKEND_PROCESSING_FAILURE',
    CAUSE_ANALYSIS_REQUIRED: 'CAUSE_ANALYSIS_REQUIRED',
  };

  return {
    cause,
    reasonCode: map[cause],
    label: T.UNKNOWN_CAUSE_LABEL[cause],
    action: T.UNKNOWN_CAUSE_ACTION[cause],
  };
}

/* ------------------------------------------------------------------ */
/* Eligibility (§9) — target rule > entitlement, kill-switch first      */
/* ------------------------------------------------------------------ */

export interface EvalContext {
  nowMs: number;
  featureId?: string;
  minimumBinaryVersion?: string;
  requiredCapabilities?: string[];
  entitlementId?: string;
  /** Sequence of the policy currently being delivered (anti-reversal). */
  incomingPolicySeq?: number;
}

function capList(ctx: EvalContext): string[] {
  return ctx.requiredCapabilities ?? T.FEATURE_REQUIREMENTS.hardwareCapabilities;
}

export function evaluateEligibility(twin: T.Twin, ctx: EvalContext): T.EligibilityResult {
  const fid = ctx.featureId ?? T.FEATURE_ID;
  const inst = twin.featureInstances[fid];
  const minBinary = ctx.minimumBinaryVersion ?? T.FEATURE_REQUIREMENTS.minimumOneBinary;
  const entId = ctx.entitlementId ?? T.FEATURE_REQUIREMENTS.entitlementId;

  const out = (
    eligibility: T.Eligibility,
    reasonCode: T.ReasonCode,
    detail: T.Localized,
    unknownCause?: T.UnknownCause,
  ): T.EligibilityResult => ({
    eligibility,
    reasonCode,
    reason: reason(reasonCode),
    unknownCause,
    policyOnlyEligible: eligibility === 'ELIGIBLE_POLICY_ONLY',
    detail,
  });

  if (!inst) {
    return out('UNKNOWN', 'TWIN_SNAPSHOT_MISSING', {
      ko: '이 VIN에는 해당 Feature 인스턴스가 없습니다.',
      en: 'No feature instance exists for this VIN.',
    }, 'TWIN_SNAPSHOT_MISSING');
  }

  if (twin.killSwitch?.active) {
    return out('BLOCKED_BY_SAFETY_RULE', 'KILL_SWITCH_ACTIVE', {
      ko: 'Kill-Switch가 활성 상태여서 대상 선정에서 제외됩니다.',
      en: 'Excluded from targeting because the kill-switch is active.',
    });
  }

  const missingCaps = capList(ctx).filter((c) => !twin.asBuilt.hardwareCapabilities.includes(c));
  if (missingCaps.length) {
    return out('INCOMPATIBLE_HARDWARE', 'HARDWARE_CAPABILITY_MISSING', {
      ko: `필요 HW 미장착: ${missingCaps.join(', ')}`,
      en: `Required hardware absent: ${missingCaps.join(', ')}`,
    });
  }

  if (!T.FEATURE_REQUIREMENTS.variantCodingRequired.includes(twin.asBuilt.variantCodingVersion)) {
    return out('INCOMPATIBLE_VARIANT', 'VARIANT_CODING_MISMATCH', {
      ko: `Variant Coding 불일치 (${twin.asBuilt.variantCodingVersion})`,
      en: `Variant coding mismatch (${twin.asBuilt.variantCodingVersion})`,
    });
  }

  if (inst.entitlement.status === 'UNKNOWN' && !verifyEntitlement(inst, entId)) {
    return out('UNKNOWN', 'CAUSE_ANALYSIS_REQUIRED', {
      ko: 'Entitlement 상태를 확인할 수 없습니다.',
      en: 'The entitlement status cannot be determined.',
    }, 'CAUSE_ANALYSIS_REQUIRED');
  }
  if (!verifyEntitlement(inst, entId)) {
    return out('MISSING_ENTITLEMENT', 'ENTITLEMENT_INACTIVE', {
      ko: `Entitlement 미보유 (${entId})`,
      en: `Entitlement not held (${entId})`,
    });
  }

  if (cmpSemver(twin.asDeployed.oneBinaryVersion, minBinary) < 0) {
    return out('REQUIRES_BINARY_OTA', 'ONE_BINARY_BELOW_MINIMUM', {
      ko: `One-Binary ${twin.asDeployed.oneBinaryVersion} < ${minBinary}`,
      en: `One-binary ${twin.asDeployed.oneBinaryVersion} < ${minBinary}`,
    });
  }
  if (cmpSemver(twin.asDeployed.bmsSoftwareVersion, T.FEATURE_REQUIREMENTS.minimumBmsSoftware) < 0) {
    return out('REQUIRES_BINARY_OTA', 'BMS_SOFTWARE_BELOW_MINIMUM', {
      ko: `BMS SW ${twin.asDeployed.bmsSoftwareVersion} < ${T.FEATURE_REQUIREMENTS.minimumBmsSoftware}`,
      en: `BMS SW ${twin.asDeployed.bmsSoftwareVersion} < ${T.FEATURE_REQUIREMENTS.minimumBmsSoftware}`,
    });
  }

  if (!twin.link.online) {
    if (offlineCacheExpired(twin, ctx.nowMs)) {
      return out('STALE_TWIN', 'OFFLINE_POLICY_TTL_EXPIRED', {
        ko: '오프라인 TTL 만료 — 캐시 정책을 신뢰할 수 없습니다.',
        en: 'Offline TTL expired — the cached policy is no longer trustworthy.',
      }, 'TELEMETRY_TIMEOUT');
    }
    // 접속되지 않은 차량은 서명된 캐시 정책으로 계속 동작하지만, 중앙에서는
    // 현재 상태를 검증할 수 없으므로 신규 대상 선정에서 제외한다 (§15).
    return out('STALE_TWIN', 'OFFLINE_POLICY_CACHE_VALID', {
      ko: '차량 접속 없음 — TTL 내 서명 Policy 캐시로 동작 중이라 검증할 수 없습니다.',
      en: 'Vehicle unreachable — running on a signed policy cache within TTL, so it cannot be verified.',
    }, 'TELEMETRY_TIMEOUT');
  }

  if (!SUPPORTED_AGENT_VERSIONS.includes(twin.link.vehicleAgentVersion)) {
    return out('UNKNOWN', 'VEHICLE_AGENT_VERSION_UNSUPPORTED', {
      ko: `Vehicle Agent ${twin.link.vehicleAgentVersion} 미지원`,
      en: `Vehicle agent ${twin.link.vehicleAgentVersion} unsupported`,
    }, 'VEHICLE_AGENT_VERSION_UNSUPPORTED');
  }

  const stale = staleSignals(twin, ctx.nowMs);
  if (stale.length) {
    const code: T.ReasonCode =
      stale.includes('BatteryTemperature') ? 'BATTERY_TEMP_SIGNAL_STALE' : 'SIGNAL_QUALITY_UNKNOWN';
    return out('STALE_TWIN', code, {
      ko: `신호 TTL 초과: ${stale.join(', ')}`,
      en: `Signals past TTL: ${stale.join(', ')}`,
    }, 'TELEMETRY_TIMEOUT');
  }

  const badQuality = missingQualitySignals(twin);
  if (badQuality.length) {
    return out('STALE_TWIN', 'SIGNAL_QUALITY_BAD', {
      ko: `신호 품질 불량: ${badQuality.join(', ')}`,
      en: `Bad signal quality: ${badQuality.join(', ')}`,
    }, 'SIGNAL_QUALITY_UNKNOWN');
  }

  return out('ELIGIBLE_POLICY_ONLY', 'POLICY_APPLIED_OK', {
    ko: '모든 조건 충족 — Policy-only 활성화 가능',
    en: 'All conditions satisfied — policy-only activation possible',
  });
}

function verifyEntitlement(inst: T.FeatureInstance, entitlementId: string): boolean {
  return inst.entitlement.status === 'ACTIVE' && inst.entitlement.entitlementId === entitlementId;
}

/* ------------------------------------------------------------------ */
/* Local Guard — runs on the vehicle, works offline                    */
/* ------------------------------------------------------------------ */

export const GUARD_LIMITS = {
  minSoc: 20,
  maxBatteryTemp: 35,
  minBatteryTemp: -30,
  allowedPowerModes: ['READY', 'ON'],
  requiredSchedule: 'SCHEDULED',
  requiredConnector: 'CONNECTED',
};

export function evaluateLocalGuard(twin: T.Twin, ctx: EvalContext): T.LocalGuardResult {
  const fid = ctx.featureId ?? T.FEATURE_ID;
  const inst = twin.featureInstances[fid];
  const checks: T.GuardCheck[] = [];

  const add = (
    id: string,
    label: T.Localized,
    passed: boolean,
    observed: string,
    required: string,
    reasonCode: T.ReasonCode,
  ) => checks.push({ id, label, passed, observed, required, reasonCode });

  add(
    'GS-01',
    { ko: 'Kill-Switch 우선순위', en: 'Kill-switch priority' },
    !twin.killSwitch?.active,
    twin.killSwitch?.active ? 'ACTIVE' : 'INACTIVE',
    'INACTIVE',
    'KILL_SWITCH_ACTIVE',
  );

  add(
    'GS-02',
    { ko: 'Policy 서명 검증', en: 'Policy signature' },
    inst.policy.signatureStatus === 'VERIFIED',
    inst.policy.signatureStatus,
    'VERIFIED',
    'POLICY_SIGNATURE_INVALID',
  );

  if (ctx.incomingPolicySeq != null) {
    add(
      'GS-03',
      { ko: 'Policy Version 비역전', en: 'Policy version not reversed' },
      ctx.incomingPolicySeq >= inst.policy.cachedVersionSeq,
      `incoming ${ctx.incomingPolicySeq} / cached ${inst.policy.cachedVersionSeq}`,
      `>= ${inst.policy.cachedVersionSeq}`,
      'POLICY_VERSION_OUTDATED',
    );
  }

  const temp = twin.context.BatteryTemperature;
  const tempFresh = !isSampleStale(temp, ctx.nowMs) && temp?.quality === 'GOOD';
  add(
    'GS-04',
    { ko: '배터리 온도 신호 신선도', en: 'Battery temperature freshness' },
    tempFresh,
    temp ? `${fmtDuration(secondsSince(temp.observedAt, ctx.nowMs))} ago / TTL ${temp.ttlSeconds}s` : 'missing',
    `<= ${temp?.ttlSeconds ?? 120}s 내, 품질 GOOD`,
    'BATTERY_TEMP_SIGNAL_STALE',
  );

  const tempValue = typeof temp?.value === 'number' ? temp.value : NaN;
  add(
    'GS-05',
    { ko: '배터리 온도 허용 범위', en: 'Battery temperature range' },
    Number.isFinite(tempValue) && tempValue >= GUARD_LIMITS.minBatteryTemp && tempValue <= GUARD_LIMITS.maxBatteryTemp,
    Number.isFinite(tempValue) ? `${tempValue} °C` : 'unknown',
    `${GUARD_LIMITS.minBatteryTemp} ~ ${GUARD_LIMITS.maxBatteryTemp} °C`,
    'BATTERY_TEMP_OUT_OF_RANGE',
  );

  const soc = typeof twin.context.BatterySoc?.value === 'number' ? (twin.context.BatterySoc!.value as number) : NaN;
  add(
    'GS-06',
    { ko: 'SOC 임계', en: 'SOC threshold' },
    Number.isFinite(soc) && soc >= GUARD_LIMITS.minSoc,
    Number.isFinite(soc) ? `${soc} %` : 'unknown',
    `>= ${GUARD_LIMITS.minSoc} %`,
    'SOC_BELOW_THRESHOLD',
  );

  add(
    'GS-07',
    { ko: '충전 스케줄', en: 'Charging schedule' },
    twin.context.ChargingSchedule?.value === GUARD_LIMITS.requiredSchedule,
    String(twin.context.ChargingSchedule?.value ?? 'NONE'),
    GUARD_LIMITS.requiredSchedule,
    'CHARGING_SCHEDULE_MISSING',
  );

  add(
    'GS-08',
    { ko: '충전 커넥터', en: 'Charging connector' },
    twin.context.ChargingConnectorState?.value === GUARD_LIMITS.requiredConnector,
    String(twin.context.ChargingConnectorState?.value ?? 'DISCONNECTED'),
    GUARD_LIMITS.requiredConnector,
    'CHARGING_CONNECTOR_OPEN',
  );

  add(
    'GS-09',
    { ko: '차량 전원 모드', en: 'Vehicle power mode' },
    GUARD_LIMITS.allowedPowerModes.includes(String(twin.context.VehiclePowerMode?.value ?? '')),
    String(twin.context.VehiclePowerMode?.value ?? 'UNKNOWN'),
    GUARD_LIMITS.allowedPowerModes.join(' / '),
    'POWER_MODE_NOT_READY',
  );

  const bad = missingQualitySignals(twin);
  add('GS-10', { ko: '필수 신호 품질', en: 'Required signal quality' }, bad.length === 0, bad.length ? bad.join(', ') : 'ALL GOOD', 'GOOD', 'SIGNAL_QUALITY_BAD');

  const failed = checks.find((c) => !c.passed);
  const passed = !failed;
  return {
    passed,
    reasonCode: passed ? 'LOCAL_GUARD_PASSED' : failed!.reasonCode,
    reason: reason(passed ? 'LOCAL_GUARD_PASSED' : failed!.reasonCode),
    checks,
    evaluatedAt: isoAt(ctx.nowMs),
  };
}

/* ------------------------------------------------------------------ */
/* Reconciliation (§9 table)                                           */
/* ------------------------------------------------------------------ */

export function reconciliationTable(
  desired: T.DesiredState,
  reported: T.ReportedState,
  effective: T.EffectiveState,
): T.Reconciliation {
  if (desired === 'ON' && reported === 'ON' && effective === 'ON') return 'CONVERGED';
  if (desired === 'OFF' && reported === 'OFF' && effective === 'OFF') return 'CONVERGED';
  if (desired === 'ON' && reported === 'ON' && (effective === 'BLOCKED' || effective === 'DEGRADED')) return 'GUARDED';
  if (desired === 'ON' && reported === 'REJECTED') return 'REJECTED';
  if (desired === 'OFF' && effective === 'ON') return 'CRITICAL_DRIFT';
  if (desired === 'ON' && reported === 'UNKNOWN' && effective === 'UNKNOWN') return 'UNKNOWN';
  if (desired === 'OFF' && reported === 'NOT_RECEIVED' && effective === 'OFF') return 'CONVERGED';
  if (desired === 'ON' && (reported === 'NOT_RECEIVED' || reported === 'OFF' || reported === 'UNKNOWN')) return 'PENDING';
  if (desired === 'OFF' && (reported === 'UNKNOWN' || reported === 'ON')) return 'PENDING';
  if (effective === 'UNKNOWN') return 'UNKNOWN';
  return 'UNKNOWN';
}

export interface ReconcileInput {
  desired: T.DesiredState;
  reported: T.ReportedState;
  effective: T.EffectiveState;
  policyVersion: string | null;
  twinVersion: number;
  nowMs: number;
  /** Reason for a CONVERGED row when something notable happened (safe default, kill-switch, cache). */
  overrideReason?: T.ReasonCode;
  rejectionReason?: T.ReasonCode;
  guardReason?: T.ReasonCode;
  /** §15-5 — a kill-switch explains why a pending twin is not a delivery problem. */
  killSwitchActive?: boolean;
  firstSeenAt?: string;
  incidentId?: string | null;
  evidence?: string[];
  unknownSignals?: UnknownSignals;
}

/** Decorate a raw reconciliation with reason code, timing and evidence (§9). */
export function reconcile(input: ReconcileInput): T.ReconciliationResult {
  const result = reconciliationTable(input.desired, input.reported, input.effective);

  let code: T.ReasonCode;
  switch (result) {
    case 'CONVERGED':
      code = input.overrideReason ?? (input.desired === 'ON' ? 'POLICY_APPLIED_OK' : 'CONVERGED');
      break;
    case 'PENDING':
      code = input.killSwitchActive
        ? 'KILL_SWITCH_ACTIVE'
        : input.reported === 'NOT_RECEIVED'
          ? 'POLICY_NOT_RECEIVED'
          : 'PENDING_POLICY_DELIVERY';
      break;
    case 'GUARDED':
      code = input.guardReason ?? 'LOCAL_GUARD_BLOCKED';
      break;
    case 'REJECTED':
      code = input.rejectionReason ?? 'POLICY_SIGNATURE_INVALID';
      break;
    case 'CRITICAL_DRIFT':
      code = 'EFFECTIVE_DRIFT_DETECTED';
      break;
    default:
      code = classifyUnknown(input.unknownSignals ?? { twin: null }).reasonCode;
      break;
  }

  const def = reason(code);
  const nowIso = isoAt(input.nowMs);
  const evidence = input.evidence ?? [
    `twin:${input.twinVersion}`,
    `policy:${input.policyVersion ?? 'unknown'}`,
    `reason:${code}`,
  ];

  return {
    result,
    reasonCode: code,
    reason: def,
    desired: input.desired,
    reported: input.reported,
    effective: input.effective,
    policyVersion: input.policyVersion,
    twinVersion: input.twinVersion,
    firstSeenAt: input.firstSeenAt ?? nowIso,
    lastConfirmedAt: nowIso,
    incidentId: input.incidentId ?? (def.incident ? 'INC-BDC-2026-001' : null),
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Twin health                                                         */
/* ------------------------------------------------------------------ */

export function deriveHealth(twin: T.Twin, recon: T.Reconciliation, nowMs: number): T.TwinHealth {
  if (twin.killSwitch?.active) return 'DEGRADED';
  if (!twin.link.online) return 'OFFLINE';
  if (recon === 'CRITICAL_DRIFT') return 'DRIFTED';
  if (recon === 'UNKNOWN') return 'UNKNOWN';
  if (staleSignals(twin, nowMs).length) return 'STALE';
  if (recon === 'GUARDED' || recon === 'REJECTED') return 'DEGRADED';
  if (recon === 'PENDING') return 'DEGRADED';
  return 'HEALTHY';
}

/* ------------------------------------------------------------------ */
/* One evaluator to rule them all                                      */
/* ------------------------------------------------------------------ */

export interface TwinVerdict {
  twin: T.Twin;
  eligibility: T.EligibilityResult;
  guard: T.LocalGuardResult;
  reconciliation: T.ReconciliationResult;
  health: T.TwinHealth;
  /** The single most actionable reason for list/grid surfaces. */
  verdictReason: T.ReasonCodeDef;
}

export function evaluateTwin(twin: T.Twin, ctx: EvalContext): TwinVerdict {
  const fid = ctx.featureId ?? T.FEATURE_ID;
  const inst = twin.featureInstances[fid];
  const eligibility = evaluateEligibility(twin, ctx);
  const guard = evaluateLocalGuard(twin, {
    ...ctx,
    incomingPolicySeq: ctx.incomingPolicySeq ?? parsePolicySeq(inst?.policy.policyVersion),
  });

  const reconciliation = reconcile({
    desired: inst?.desired.state ?? 'OFF',
    reported: inst?.reported.state ?? 'UNKNOWN',
    effective: inst?.effective.state ?? 'UNKNOWN',
    policyVersion: inst?.policy.policyVersion ?? null,
    twinVersion: twin.twinVersion,
    nowMs: ctx.nowMs,
    overrideReason: overrideReasonFor(inst),
    killSwitchActive: !!twin.killSwitch?.active,
    rejectionReason: inst?.reported.state === 'REJECTED' ? rejectReasonFor(twin) : undefined,
    guardReason: inst?.effective.state === 'BLOCKED' ? (inst.reported.guardReason ?? guard.reasonCode) : undefined,
    unknownSignals: {
      twin,
      telemetryAgeSeconds: secondsSince(twin.context.BatteryTemperature?.observedAt, ctx.nowMs),
      telemetryTtlSeconds: twin.context.BatteryTemperature?.ttlSeconds,
      policyVersionKnown: !!inst?.policy.policyVersion,
      agentVersion: twin.link.vehicleAgentVersion,
      signalQualityUnknown: missingQualitySignals(twin).length > 0,
    },
  });

  const health = deriveHealth(twin, reconciliation.result, ctx.nowMs);
  const verdictReason =
    reconciliation.result === 'CONVERGED'
      ? eligibility.eligibility === 'ELIGIBLE_POLICY_ONLY'
        ? reconciliation.reason
        : eligibility.reason
      : reconciliation.reason;

  return { twin, eligibility, guard, reconciliation, health, verdictReason };
}

function overrideReasonFor(inst: T.FeatureInstance | undefined): T.ReasonCode | undefined {
  if (!inst) return undefined;
  if (inst.observed.dtcCodes.length) return undefined;
  if (inst.effective.reasonCode === 'KILL_SWITCH_ACTIVE') return 'KILL_SWITCH_ACTIVE';
  if (inst.effective.reasonCode === 'SAFE_DEFAULT_APPLIED') return 'SAFE_DEFAULT_APPLIED';
  if (inst.effective.reasonCode === 'OFFLINE_POLICY_CACHE_VALID') return 'OFFLINE_POLICY_CACHE_VALID';
  if (inst.effective.reasonCode === 'ROLLBACK_APPLIED') return 'ROLLBACK_APPLIED';
  return undefined;
}

function rejectReasonFor(twin: T.Twin): T.ReasonCode {
  const inst = twin.featureInstances[T.FEATURE_ID];
  if (!inst) return 'POLICY_SIGNATURE_INVALID';
  if (inst.policy.signatureStatus !== 'VERIFIED') return 'POLICY_SIGNATURE_INVALID';
  return 'POLICY_VERSION_OUTDATED';
}

/* ------------------------------------------------------------------ */
/* Fleet aggregation                                                   */
/* ------------------------------------------------------------------ */

const ALL_RECON: T.Reconciliation[] = ['CONVERGED', 'PENDING', 'GUARDED', 'REJECTED', 'CRITICAL_DRIFT', 'UNKNOWN'];
const ALL_HEALTH: T.TwinHealth[] = ['HEALTHY', 'DEGRADED', 'STALE', 'OFFLINE', 'DRIFTED', 'UNKNOWN'];
const ALL_ELIG: T.Eligibility[] = [
  'ELIGIBLE_POLICY_ONLY',
  'REQUIRES_BINARY_OTA',
  'INCOMPATIBLE_HARDWARE',
  'INCOMPATIBLE_VARIANT',
  'MISSING_ENTITLEMENT',
  'STALE_TWIN',
  'BLOCKED_BY_SAFETY_RULE',
  'UNKNOWN',
];

export function zeroCounts<K extends string>(keys: K[]): Record<K, number> {
  return keys.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {} as Record<K, number>);
}

export function computeFleetStats(verdicts: TwinVerdict[], nowMs: number): T.TwinFleetStats {
  const reconciliationCounts = zeroCounts(ALL_RECON);
  const healthCounts = zeroCounts(ALL_HEALTH);
  const eligibilityCounts = zeroCounts(ALL_ELIG);
  const reasonMap = new Map<T.ReasonCode, number>();
  const waveMap = new Map<string, { total: number; converged: number }>();

  verdicts.forEach((v) => {
    reconciliationCounts[v.reconciliation.result]++;
    healthCounts[v.health]++;
    eligibilityCounts[v.eligibility.eligibility]++;
    reasonMap.set(v.reconciliation.reasonCode, (reasonMap.get(v.reconciliation.reasonCode) || 0) + 1);
    const wave = v.twin.link.cohort;
    const cur = waveMap.get(wave) || { total: 0, converged: 0 };
    cur.total++;
    if (v.reconciliation.result === 'CONVERGED') cur.converged++;
    waveMap.set(wave, cur);
  });

  return {
    total: verdicts.length,
    policyOnly: eligibilityCounts.ELIGIBLE_POLICY_ONLY,
    requiresBinaryOta: eligibilityCounts.REQUIRES_BINARY_OTA,
    guardBlocked: reconciliationCounts.GUARDED,
    stale: healthCounts.STALE,
    drift: reconciliationCounts.CRITICAL_DRIFT,
    unknown: reconciliationCounts.UNKNOWN,
    incidentVehicles: verdicts.filter(
      (v) =>
        v.reconciliation.result === 'CRITICAL_DRIFT' ||
        v.reconciliation.result === 'REJECTED' ||
        v.reconciliation.result === 'GUARDED' ||
        v.twin.killSwitch?.active,
    ).length,
    lastSyncedAt: isoAt(nowMs),
    reconciliationCounts,
    healthCounts,
    eligibilityCounts,
    reasonCodeCounts: [...reasonMap.entries()]
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count),
    waveConvergence: [...waveMap.entries()]
      .map(([wave, v]) => ({ wave, total: v.total, converged: v.converged, rate: v.total ? v.converged / v.total : 0 }))
      .sort((a, b) => a.wave.localeCompare(b.wave)),
  };
}

export function applyFilters(
  verdicts: TwinVerdict[],
  f: T.TwinFilters,
): TwinVerdict[] {
  return verdicts.filter((v) => {
    const t = v.twin;
    const inst = t.featureInstances[T.FEATURE_ID];
    if (f.vehicleModel && t.identity.vehicleModel !== f.vehicleModel) return false;
    if (f.region && t.identity.region !== f.region) return false;
    if (f.modelYear && String(t.identity.modelYear) !== f.modelYear) return false;
    if (f.trim && t.identity.trim !== f.trim) return false;
    if (f.upgVc && t.identity.upgVc !== f.upgVc) return false;
    if (f.oneBinaryVersion && t.asDeployed.oneBinaryVersion !== f.oneBinaryVersion) return false;
    if (f.featureId && f.featureId !== T.FEATURE_ID) return false;
    if (f.policyVersion && (inst?.policy.policyVersion ?? '') !== f.policyVersion) return false;
    if (f.entitlement && (inst?.entitlement.status ?? '') !== f.entitlement) return false;
    if (f.twinHealth && v.health !== f.twinHealth) return false;
    if (f.eligibility && v.eligibility.eligibility !== f.eligibility) return false;
    if (f.reconciliation && v.reconciliation.result !== f.reconciliation) return false;
    return true;
  });
}

export function filterOptions(verdicts: TwinVerdict[]) {
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return {
    vehicleModel: uniq(verdicts.map((v) => v.twin.identity.vehicleModel)),
    region: uniq(verdicts.map((v) => v.twin.identity.region)),
    modelYear: uniq(verdicts.map((v) => String(v.twin.identity.modelYear))),
    trim: uniq(verdicts.map((v) => v.twin.identity.trim)),
    upgVc: uniq(verdicts.map((v) => v.twin.identity.upgVc)),
    oneBinaryVersion: uniq(verdicts.map((v) => v.twin.asDeployed.oneBinaryVersion)),
    policyVersion: uniq(verdicts.map((v) => v.twin.featureInstances[T.FEATURE_ID]?.policy.policyVersion ?? '')),
    entitlement: uniq(verdicts.map((v) => v.twin.featureInstances[T.FEATURE_ID]?.entitlement.status ?? '')),
    twinHealth: ALL_HEALTH.slice(),
    eligibility: ALL_ELIG.slice(),
    reconciliation: ALL_RECON.slice(),
  };
}

/* ------------------------------------------------------------------ */
/* Rollout convergence (§10 GET /api/rollouts/{id}/convergence)         */
/* ------------------------------------------------------------------ */

export function computeConvergence(
  verdicts: TwinVerdict[],
  nowMs: number,
  paused = false,
  pausedReason?: T.Localized,
): T.RolloutConvergence {
  const counts = zeroCounts(ALL_RECON);
  verdicts.forEach((v) => counts[v.reconciliation.result]++);
  const total = verdicts.length;
  const stats = computeFleetStats(verdicts, nowMs);
  return {
    rolloutId: T.DEMO_ROLLOUT_ID,
    policyVersion: T.DEMO_POLICY.policyVersion,
    featureId: T.FEATURE_ID,
    total,
    threshold: T.CONVERGENCE_THRESHOLD,
    counts,
    convergenceRate: total ? counts.CONVERGED / total : 0,
    paused,
    pausedReason,
    waves: stats.waveConvergence,
    generatedAt: isoAt(nowMs),
  };
}

/* ------------------------------------------------------------------ */
/* Impact analysis (§10 POST /api/twin-impact-analysis)                */
/* ------------------------------------------------------------------ */

export function runImpactAnalysis(
  verdicts: TwinVerdict[],
  rule: T.TargetRule,
  nowMs: number,
  gate: T.ImpactGate = { impactReviewed: false, qualityGatePassed: false },
): T.TwinImpactResult {
  // 지역·차종·연식은 "대상 범위" 조건이라 후보 집합을 좁히고,
  // HW/Entitlement/Binary 조건은 §12.2 의 제외 사유 버킷으로 보여줘야 하므로
  // 후보 필터가 아니라 Eligibility 판정에서 평가한다.
  const inScope = verdicts.filter((v) => {
    const t = v.twin;
    if (rule.region?.length && !rule.region.includes(t.identity.region)) return false;
    if (rule.vehicleModel?.length && !rule.vehicleModel.includes(t.identity.vehicleModel)) return false;
    if (rule.modelYear?.length && !rule.modelYear.includes(t.identity.modelYear)) return false;
    return true;
  });

  const evaluated = inScope.map((v) => {
    const elig = evaluateEligibility(v.twin, {
      nowMs,
      minimumBinaryVersion: rule.minimumBinaryVersion,
      requiredCapabilities: rule.requiredCapability,
      entitlementId: rule.entitlementId,
    });
    return { verdict: v, elig };
  });

  const counts = zeroCounts(ALL_ELIG);
  const unknownCauseBreakdown: Partial<Record<T.UnknownCause, number>> = {};
  evaluated.forEach(({ elig }) => {
    counts[elig.eligibility]++;
    if (elig.unknownCause) unknownCauseBreakdown[elig.unknownCause] = (unknownCauseBreakdown[elig.unknownCause] || 0) + 1;
  });

  const buckets: T.ImpactBucket[] = ALL_ELIG.map((e) => ({
    eligibility: e,
    label: T.ELIGIBILITY_LABEL[e],
    count: counts[e],
    vins: evaluated.filter((x) => x.elig.eligibility === e).map((x) => x.verdict.twin.vin),
    reasonCode: evaluated.find((x) => x.elig.eligibility === e)?.elig.reasonCode ?? 'CAUSE_ANALYSIS_REQUIRED',
  }));

  return {
    targetRule: rule,
    featureId: T.FEATURE_ID,
    featureVersion: T.FEATURE_VERSION,
    policyVersion: T.DEMO_POLICY.policyVersion,
    analyzedAt: isoAt(nowMs),
    snapshotAt: isoAt(nowMs),
    totalMatched: evaluated.length,
    counts,
    buckets,
    vehicleResults: evaluated.map(({ verdict: v, elig }) => ({
      vin: v.twin.vin,
      twinId: v.twin.twinId,
      vehicleModel: v.twin.identity.vehicleModel,
      region: v.twin.identity.region,
      modelYear: v.twin.identity.modelYear,
      upgVc: v.twin.identity.upgVc,
      oneBinaryVersion: v.twin.asDeployed.oneBinaryVersion,
      bmsSoftwareVersion: v.twin.asDeployed.bmsSoftwareVersion,
      entitlementStatus: v.twin.featureInstances[T.FEATURE_ID]?.entitlement.status ?? 'UNKNOWN',
      policyVersion: v.twin.featureInstances[T.FEATURE_ID]?.policy.policyVersion ?? null,
      desired: v.twin.featureInstances[T.FEATURE_ID]?.desired.state ?? 'OFF',
      reported: v.twin.featureInstances[T.FEATURE_ID]?.reported.state ?? 'UNKNOWN',
      effective: v.twin.featureInstances[T.FEATURE_ID]?.effective.state ?? 'UNKNOWN',
      eligibility: elig.eligibility,
      reconciliation: v.reconciliation.result,
      twinHealth: v.health,
      reasonCode: elig.reasonCode,
      unknownCause: elig.unknownCause,
      cohort: v.twin.link.cohort,
      lastSeenAt: v.twin.link.lastSeenAt,
    })),
    unknownCauseBreakdown,
    activationOutlook: activationOutlook(evaluated),
    ...impactGate(counts, gate),
  };
}

function activationOutlook(evaluated: Array<{ verdict: TwinVerdict }>): T.ActivationOutlook {
  const set = evaluated.filter((x) => x.verdict.eligibility.eligibility === 'ELIGIBLE_POLICY_ONLY');
  const out: T.ActivationOutlook = {
    total: set.length,
    converged: 0,
    pending: 0,
    guarded: 0,
    rejected: 0,
    drifted: 0,
    unknown: 0,
    notYetActivated: 0,
  };
  for (const { verdict } of set) {
    const recon = verdict.reconciliation.result;
    if (recon === 'CONVERGED') out.converged++;
    else if (recon === 'PENDING') out.pending++;
    else if (recon === 'GUARDED') out.guarded++;
    else if (recon === 'REJECTED') out.rejected++;
    else if (recon === 'CRITICAL_DRIFT') out.drifted++;
    else out.unknown++;
    const desired = verdict.twin.featureInstances[T.FEATURE_ID]?.desired.state;
    if (desired !== 'ON') out.notYetActivated++;
  }
  return out;
}

function impactGate(
  counts: Record<T.Eligibility, number>,
  gate: T.ImpactGate,
): Pick<T.TwinImpactResult, 'productionBlocked' | 'blockReasons' | 'gate'> {
  const blockReasons: T.Localized[] = [];
  if (!gate.impactReviewed)
    blockReasons.push({
      ko: '차량 영향도 사전 분석을 아직 확인하지 않았습니다.',
      en: 'The vehicle impact preview has not been reviewed yet.',
    });
  if (!gate.qualityGatePassed)
    blockReasons.push({
      ko: '차량 품질 Gate(What-if Simulation)가 아직 PASS 되지 않았습니다.',
      en: 'The vehicle quality gate (what-if simulation) has not passed yet.',
    });
  if (counts.ELIGIBLE_POLICY_ONLY === 0)
    blockReasons.push({
      ko: '즉시 활성화 가능한 차량이 없습니다.',
      en: 'No vehicle can be activated immediately.',
    });
  return { productionBlocked: blockReasons.length > 0, blockReasons, gate };
}

/* ------------------------------------------------------------------ */
/* Simulation twin (§12.3)                                             */
/* ------------------------------------------------------------------ */

export const SIM_SEED = 'VIN-DEMO-SIM';
export const SIM_VIN = 'VIN-DEMO-900';

export const DEFAULT_SIM_INPUTS: T.SimulationInputs = {
  ambientTemperature: -3,
  batteryTemperature: 8,
  batterySoc: 62,
  chargingSchedule: 'SCHEDULED',
  connectorState: 'CONNECTED',
  powerMode: 'READY',
  network: 'ONLINE',
  telemetryAgeSeconds: 12,
  bmsSoftwareVersion: T.FEATURE_REQUIREMENTS.minimumBmsSoftware,
  oneBinaryVersion: T.FEATURE_REQUIREMENTS.minimumOneBinary,
  entitlementStatus: 'ACTIVE',
  policyVersion: T.DEMO_POLICY.policyVersion,
  policyVersionSeq: T.DEMO_POLICY.policyVersionSeq,
  killSwitch: false,
  hardwareCapability: true,
};

/** The 10 required what-if scenarios (+1 drift variant modelled as a lost rollback ack). */
export const SIM_PRESETS: T.SimPreset[] = [
  {
    id: 'NORMAL',
    label: { ko: '정상 활성화', en: 'Normal activation' },
    desc: { ko: '모든 조건 충족 → Desired/Reported/Effective = ON', en: 'All conditions met → ON / ON / ON' },
    inputs: {},
  },
  {
    id: 'BINARY_OTA',
    label: { ko: 'Binary OTA 필요', en: 'Binary OTA required' },
    desc: { ko: 'BMS SW 3.1.4 — One-Binary는 충족하지만 BMS SW 부족', en: 'BMS SW 3.1.4 — one-binary OK but BMS SW below minimum' },
    inputs: { bmsSoftwareVersion: '3.1.4' },
  },
  {
    id: 'NO_HW',
    label: { ko: 'HW Capability 부족', en: 'Hardware missing' },
    desc: { ko: '배터리 히터 미장착 → 활성화 불가', en: 'No battery heater → cannot activate' },
    inputs: { hardwareCapability: false },
  },
  {
    id: 'NO_ENTITLEMENT',
    label: { ko: 'Entitlement 없음', en: 'Entitlement missing' },
    desc: { ko: 'BAT_PRECOND_PLUS 미보유 → 대상 제외', en: 'BAT_PRECOND_PLUS not held → excluded' },
    inputs: { entitlementStatus: 'INACTIVE' },
  },
  {
    id: 'TEMP_STALE',
    label: { ko: 'Battery Temp Stale', en: 'Battery temperature stale' },
    desc: { ko: '온도 신호 900초 경과 (TTL 120초 초과) → 안전 판단 불가', en: 'Temperature 900s old (TTL 120s) → no safe decision' },
    inputs: { telemetryAgeSeconds: 900 },
  },
  {
    id: 'OFFLINE_CACHE',
    label: { ko: 'Offline 유효 Policy Cache', en: 'Offline with valid policy cache' },
    desc: { ko: '오프라인 1시간 — TTL(24h) 내 서명 정책으로 계속 실행', en: 'Offline 1h — keeps running on the signed policy within its 24h TTL' },
    inputs: { network: 'OFFLINE', telemetryAgeSeconds: 3600 },
  },
  {
    id: 'OFFLINE_TTL',
    label: { ko: 'Offline TTL 만료 → Safe Default', en: 'Offline TTL expired → safe default' },
    desc: { ko: '오프라인 25시간 — 캐시 만료로 Safe Default OFF 복귀', en: 'Offline 25h — cache expired, falls back to safe default OFF' },
    inputs: { network: 'OFFLINE', telemetryAgeSeconds: 90000 },
  },
  {
    id: 'LOW_POLICY',
    label: { ko: '낮은 Policy Version 거부', en: 'Lower policy version rejected' },
    desc: { ko: 'POL-0039 수신 — 역전 방지 규칙으로 거부', en: 'POL-0039 received — rejected by anti-reversal' },
    inputs: { policyVersion: T.REVOKED_POLICY.policyVersion, policyVersionSeq: T.REVOKED_POLICY.policyVersionSeq },
  },
  {
    id: 'GUARD_BLOCK',
    label: { ko: 'Local Guard 차단', en: 'Local Guard blocked' },
    desc: { ko: 'SOC 12% — 차량 로컬 조건 미충족으로 Effective BLOCKED', en: 'SOC 12% — local condition unmet, Effective BLOCKED' },
    inputs: { batterySoc: 12 },
  },
  {
    id: 'KILL_SWITCH',
    label: { ko: 'Kill-Switch 우선', en: 'Kill-switch priority' },
    desc: { ko: 'Kill-Switch > Entitlement/Policy — Desired·Effective 강제 OFF', en: 'Kill-switch outranks entitlement/policy — forces OFF' },
    inputs: { killSwitch: true },
  },
  {
    id: 'DRIFT',
    label: { ko: 'Effective Drift (롤백 미적용)', en: 'Effective drift (rollback not applied)' },
    desc: {
      ko: '롤백(POL-0039) 전달 후 응답 유실 — Desired=OFF 인데 Effective=ON',
      en: 'Rollback (POL-0039) delivered but ack lost — Desired=OFF while Effective=ON',
    },
    inputs: {
      network: 'INTERMITTENT',
      policyVersion: T.REVOKED_POLICY.policyVersion,
      policyVersionSeq: T.REVOKED_POLICY.policyVersionSeq,
    },
  },
];

export function simInputsFor(preset: T.SimPreset): T.SimulationInputs {
  return { ...DEFAULT_SIM_INPUTS, ...preset.inputs };
}

/** Compose a synthetic twin from simulator inputs — the "virtual vehicle". */
export function buildSimTwin(inputs: T.SimulationInputs, nowMs: number): T.Twin {
  const observedAt = isoAt(nowMs, -inputs.telemetryAgeSeconds * 1000);
  const fresh = isoAt(nowMs, -20_000);
  const quality: T.SignalQuality = inputs.telemetryAgeSeconds > 120 ? 'UNCERTAIN' : 'GOOD';
  const seq = inputs.policyVersionSeq;
  // 간헐적 연결은 신호가 살아 있으면 접속된 것으로 본다 — 통신이 끊긴 것과
  // "응답이 유실된 것"(Drift 시나리오)은 다르다.
  const linkUp = inputs.network === 'ONLINE' || (inputs.network === 'INTERMITTENT' && inputs.telemetryAgeSeconds <= 300);
  const health: T.TwinHealth =
    inputs.network === 'OFFLINE' ? 'OFFLINE' : inputs.network === 'INTERMITTENT' ? 'DEGRADED' : 'HEALTHY';

  return {
    twinId: `TWIN-${SIM_SEED}`,
    vin: SIM_VIN,
    twinVersion: 1,
    dataClassification: 'SYNTHETIC',
    identity: {
      vin: SIM_VIN,
      vehicleModel: 'EV Demo Model',
      modelYear: 2027,
      region: 'KR',
      trim: 'Premium',
      vehicleConfigId: 'VC-EV-2027-KR',
      upgVc: 'UPG-VC-04',
    },
    asDesigned: {
      vehicleConfigVersion: 'VC-EV-2027-KR@1.6',
      featureBomVersion: 'BOM-F-BAT-PRECOND-2.0.0',
      topologyVersion: T.TOPOLOGY_VERSION,
    },
    asBuilt: {
      eolSnapshotId: 'EOL-SIM-0001',
      hardwareCapabilities: inputs.hardwareCapability ? ['BATTERY_HEATER', 'DC_DC_CONVERTER', 'BMS_GEN3'] : ['DC_DC_CONVERTER', 'BMS_GEN3'],
      variantCodingVersion: T.VARIANT_OK,
      recordedAt: '2026-08-01T00:00:00Z',
    },
    asDeployed: {
      oneBinaryVersion: inputs.oneBinaryVersion,
      bmsSoftwareVersion: inputs.bmsSoftwareVersion,
      ecuSoftware: { 'ECU-BMS': `BMS-${inputs.bmsSoftwareVersion}`, 'ECU-VCU': 'VCU-5.1.2', 'ECU-TCU': 'TCU-2.0.7' },
      otaCampaignId: 'OTA-BDC-2026-11',
      installationStatus: 'INSTALLED',
      installedAt: '2026-09-01T04:12:00Z',
    },
    featureInstances: {
      [T.FEATURE_ID]: {
        featureId: T.FEATURE_ID,
        featureVersion: T.FEATURE_VERSION,
        entitlement: { entitlementId: T.FEATURE_REQUIREMENTS.entitlementId, status: inputs.entitlementStatus },
        policy: {
          policyId: T.DEMO_POLICY.policyId,
          policyVersion: inputs.policyVersion,
          policyHash: T.DEMO_POLICY.policyHash,
          signatureStatus: 'VERIFIED',
          cachedVersionSeq: Math.max(seq, T.DEMO_POLICY.policyVersionSeq),
          lastSyncedAt: isoAt(nowMs, -Math.min(inputs.telemetryAgeSeconds, 3600) * 1000),
        },
        desired: { state: 'OFF', requestedAt: isoAt(nowMs, -60_000) },
        reported: { state: 'NOT_RECEIVED', receivedPolicyVersion: null, reportedAt: null, guardResult: 'UNKNOWN' },
        effective: { state: 'OFF', reasonCode: 'CONVERGED', evaluatedAt: fresh },
        observed: { health, lastTelemetryAt: observedAt, dtcCodes: [] },
      },
    },
    context: {
      BatterySoc: { value: inputs.batterySoc, unit: '%', quality: 'GOOD', observedAt: fresh, ttlSeconds: 300 },
      BatteryTemperature: { value: inputs.batteryTemperature, unit: '°C', quality, observedAt, ttlSeconds: 120 },
      AmbientTemperature: { value: inputs.ambientTemperature, unit: '°C', quality: 'GOOD', observedAt: fresh, ttlSeconds: 900 },
      ChargingSchedule: { value: inputs.chargingSchedule, unit: '', quality: 'GOOD', observedAt: fresh, ttlSeconds: 3600 },
      ChargingConnectorState: { value: inputs.connectorState, unit: '', quality: 'GOOD', observedAt: fresh, ttlSeconds: 60 },
      VehiclePowerMode: { value: inputs.powerMode, unit: '', quality: 'GOOD', observedAt: fresh, ttlSeconds: 60 },
    },
    link: {
      online: linkUp,
      vehicleAgentVersion: 'VA-4.3.0',
      lastSeenAt: isoAt(nowMs, -inputs.telemetryAgeSeconds * 1000),
      snapshotAt: fresh,
      archetype: 'READY',
      cohort: 'simulation',
    },
    killSwitch: inputs.killSwitch
      ? {
          active: true,
          requestedBy: 'operator-7',
          requestedAt: isoAt(nowMs, -120_000),
          reason: { ko: 'What-if 검증 — Kill-Switch 우선순위', en: 'What-if validation — kill-switch priority' },
          featureId: T.FEATURE_ID,
          policyVersion: T.DEMO_POLICY.policyVersion,
          safeState: 'OFF',
          affectedVins: 1,
        }
      : undefined,
    auditTrail: [
      { at: isoAt(nowMs, -300_000), actor: 'simulator', action: { ko: 'What-if 입력 적용', en: 'What-if inputs applied' } },
    ],
  };
}

export function runSimulation(inputs: T.SimulationInputs, nowMs: number): T.SimulationResult {
  const twin = buildSimTwin(inputs, nowMs);
  const ctx: EvalContext = { nowMs, incomingPolicySeq: inputs.policyVersionSeq };
  const eligibility = evaluateEligibility(twin, ctx);
  const guard = evaluateLocalGuard(twin, ctx);

  const offline = inputs.network === 'OFFLINE';
  const intermittent = inputs.network === 'INTERMITTENT';
  const cacheAge = inputs.telemetryAgeSeconds;
  const cacheExpired = offline && cacheAge > T.DEMO_POLICY.offlineTtlSeconds;
  const rollbackIntent = inputs.policyVersionSeq < T.DEMO_POLICY.policyVersionSeq;

  let desired: T.DesiredState = 'ON';
  let reported: T.ReportedState = 'NOT_RECEIVED';
  let effective: T.EffectiveState = 'OFF';
  let overrideReason: T.ReasonCode | undefined;
  let rejectionReason: T.ReasonCode | undefined;
  let safeDefaultApplied = false;
  const notes: T.Localized[] = [];

  if (inputs.killSwitch) {
    desired = 'OFF';
    reported = 'OFF';
    effective = 'OFF';
    overrideReason = 'KILL_SWITCH_ACTIVE';
    notes.push({
      ko: 'Kill-Switch가 Target Rule·Entitlement보다 우선하여 Desired와 Effective를 OFF로 강제합니다. 차량 상태 모델은 액추에이터를 직접 제어하지 않습니다.',
      en: 'The kill-switch outranks target rule and entitlement, forcing Desired and Effective to OFF. The vehicle state model never commands actuators directly.',
    });
  } else if (cacheExpired) {
    desired = 'OFF';
    reported = 'OFF';
    effective = 'OFF';
    overrideReason = 'SAFE_DEFAULT_APPLIED';
    safeDefaultApplied = true;
    notes.push({
      ko: '오프라인 캐시 TTL이 만료되어 중앙 의도 대신 Safe Default(OFF)로 수렴했습니다.',
      en: 'The offline cache TTL expired, so the vehicle converged on the safe default (OFF) instead of central intent.',
    });
  } else if (offline) {
    // TTL 내 서명 캐시로 이미 적용된 상태를 유지한다 — 중앙은 현재 상태를 검증할 수
    // 없지만(eligibility 는 STALE_TWIN) 차량 동작은 유효하다. 시드 Fleet 의 024 와 동일.
    desired = 'ON';
    reported = 'ON';
    effective = 'ON';
    overrideReason = 'OFFLINE_POLICY_CACHE_VALID';
    notes.push({
      ko: '오프라인 상태에서 마지막으로 수신한 서명 정책을 사용했습니다. Local Guard는 차량 내부에서 계속 동작합니다.',
      en: 'The last signed policy was used while offline; the local guard keeps running inside the vehicle.',
    });
  } else if (eligibility.eligibility !== 'ELIGIBLE_POLICY_ONLY') {
    desired = 'ON';
    reported = 'NOT_RECEIVED';
    effective = 'OFF';
    notes.push({
      ko: '대상 선정 단계에서 제외되어 정책이 차량으로 전달되지 않았습니다. (Policy 미전달)',
      en: 'The vehicle was excluded during targeting, so no policy was delivered.',
    });
  } else if (intermittent && rollbackIntent) {
    desired = 'OFF';
    reported = 'UNKNOWN';
    effective = 'ON';
    notes.push({
      ko: '롤백 정책(POL-0039)이 전달되었지만 차량 응답이 유실되어 적용 여부를 확인할 수 없습니다. Desired=OFF, Effective=ON → Critical Drift로 판정됩니다.',
      en: 'The rollback policy was delivered but the vehicle ack was lost, so Desired=OFF while Effective=ON → classified as critical drift.',
    });
  } else if (rollbackIntent) {
    desired = 'ON';
    reported = 'REJECTED';
    effective = 'OFF';
    rejectionReason = 'POLICY_VERSION_OUTDATED';
    notes.push({
      ko: '차량 보유 버전(42)보다 낮은 Policy Version(39)이 수신되어 차량이 적용을 거부했습니다.',
      en: 'A policy version (39) lower than the one held (42) was received, so the vehicle rejected it.',
    });
  } else {
    desired = 'ON';
    reported = 'ON';
    effective = guard.passed ? 'ON' : 'BLOCKED';
  }

  const recon = reconcile({
    desired,
    reported,
    effective,
    policyVersion: inputs.policyVersion,
    twinVersion: 1,
    nowMs,
    overrideReason,
    rejectionReason,
    guardReason: effective === 'BLOCKED' ? guard.reasonCode : undefined,
    unknownSignals: {
      twin,
      telemetryAgeSeconds: cacheAge,
      telemetryTtlSeconds: 120,
      policyVersionKnown: true,
      agentVersion: twin.link.vehicleAgentVersion,
      signalQualityUnknown: missingQualitySignals(twin).length > 0,
    },
  });

  const eventLog = buildEventLog(inputs, { offline, cacheExpired, rollbackIntent, intermittent, guardPassed: guard.passed, ineligible: eligibility.eligibility !== 'ELIGIBLE_POLICY_ONLY', nowMs });
  const qualityGates = buildQualityGates(inputs, recon, guard, eligibility, nowMs);
  const evidence = buildEvidence(inputs, recon, nowMs);

  notes.push({
    ko: 'What-if은 실제 정책 평가기와 Local Guard 로직을 동일하게 사용합니다. 결과는 합성 데이터이며 실제 차량에 배포되지 않습니다.',
    en: 'The what-if run uses the same policy evaluator and local-guard logic; results are synthetic and never deployed.',
  });

  return {
    simulationId: `SIM-${fnv(`${JSON.stringify(inputs)}:${nowMs}`).toString(16).slice(0, 8).toUpperCase()}`,
    seed: SIM_SEED,
    createdAt: isoAt(nowMs),
    inputs,
    eligibility: eligibility.eligibility,
    eligibilityReason: eligibility.reason,
    desired,
    reported,
    effective,
    localGuard: guard,
    safeDefaultApplied,
    reasonCode: recon.reason,
    reconciliation: recon.result,
    eventSequence: eventLog.map((e) => e.eventType),
    eventLog,
    qualityGates,
    evidence,
    twinVersionBefore: 1,
    twinVersionAfter: 2,
    dataClassification: 'SYNTHETIC',
    notes,
  };
}

function buildEventLog(
  inputs: T.SimulationInputs,
  flags: {
    offline: boolean;
    cacheExpired: boolean;
    rollbackIntent: boolean;
    intermittent: boolean;
    guardPassed: boolean;
    ineligible: boolean;
    nowMs: number;
  },
): T.SimulationResult['eventLog'] {
  const seq: Array<{ t: T.TwinEventType; desc: T.Localized; severity: T.ReasonSeverity }> = [];
  const push = (t: T.TwinEventType, desc: T.Localized, severity: T.ReasonSeverity = 'INFO') => seq.push({ t, desc, severity });

  push('vehicle.as-built.updated', { ko: 'As-Built 구성 스냅샷 반영', en: 'As-built snapshot applied' });
  if (inputs.killSwitch) {
    push('kill-switch.requested', { ko: 'Kill-Switch 요청 (운영자)', en: 'Kill-switch requested by operator' }, 'FAIL');
    push('kill-switch.applied', { ko: 'Kill-Switch 적용 — 안전 상태 OFF', en: 'Kill-switch applied — safe state OFF' }, 'FAIL');
  }
  if (flags.ineligible && inputs.bmsSoftwareVersion !== T.FEATURE_REQUIREMENTS.minimumBmsSoftware) {
    push('ota.binary.install.requested', { ko: 'BMS SW Binary OTA 요청', en: 'Binary OTA requested for BMS SW' }, 'PENDING');
  }
  push('policy.approved', { ko: `정책 승인 ${T.DEMO_POLICY.policyVersion} (2인 승인)`, en: `Policy approved ${T.DEMO_POLICY.policyVersion} (two-person)` });
  push('policy.desired.changed', {
    ko: `Desired 상태 변경 (${inputs.policyVersion})`,
    en: `Desired changed (${inputs.policyVersion})`,
  });
  push('policy.delivery.started', { ko: '정책 배포 시작', en: 'Policy delivery started' });
  if (flags.rollbackIntent) push('rollback.requested', { ko: '이전 정책으로 Rollback 요청', en: 'Rollback requested to previous policy' }, 'PENDING');
  if (flags.offline) {
    push('twin.stale.detected', { ko: '차량 접속 없음 감지', en: 'Vehicle link loss detected' }, 'PENDING');
  } else {
    push('vehicle.policy.received', { ko: '차량 정책 수신', en: 'Vehicle received policy' });
  }
  if (flags.cacheExpired) {
    push('vehicle.feature.effective', { ko: 'Safe Default(OFF) 적용', en: 'Safe default (OFF) applied' }, 'PENDING');
  } else if (flags.ineligible) {
    push('twin.reconciliation.changed', { ko: '대상 제외 — 정책 미전달', en: 'Excluded from targeting — no delivery' }, 'PENDING');
  } else if (flags.rollbackIntent && flags.intermittent) {
    push('twin.drift.detected', { ko: 'Effective Drift 감지 (Desired OFF / Effective ON)', en: 'Effective drift detected (Desired OFF / Effective ON)' }, 'FAIL');
  } else if (flags.rollbackIntent) {
    push('vehicle.policy.rejected', { ko: '낮은 Policy Version 거부', en: 'Lower policy version rejected' }, 'FAIL');
  } else {
    push('vehicle.feature.reported', { ko: 'Feature 상태 보고', en: 'Feature state reported' });
    if (!flags.guardPassed) push('vehicle.guard.blocked', { ko: 'Local Guard 차단 결과 보고', en: 'Local guard blocked' }, 'FAIL');
    push('vehicle.context.updated', { ko: '차량 신호 컨텍스트 갱신', en: 'Vehicle context updated' });
  }
  if (inputs.killSwitch) push('vehicle.feature.effective', { ko: 'Effective OFF 확정', en: 'Effective OFF confirmed' }, 'FAIL');
  else if (!flags.cacheExpired && !flags.ineligible) {
    push('vehicle.feature.effective', {
      ko: flags.guardPassed ? 'Effective ON 확정' : 'Effective BLOCKED 확정',
      en: flags.guardPassed ? 'Effective ON confirmed' : 'Effective BLOCKED confirmed',
    }, flags.guardPassed ? 'PASS' : 'FAIL');
  }
  push('twin.reconciliation.changed', { ko: '차량 상태 수렴 재계산', en: 'Vehicle state reconciliation recomputed' });

  return seq.map((s, i) => ({
    at: isoAt(flags.nowMs, i * 1000),
    eventType: s.t,
    desc: s.desc,
    severity: s.severity,
  }));
}

function buildQualityGates(
  inputs: T.SimulationInputs,
  recon: T.ReconciliationResult,
  guard: T.LocalGuardResult,
  eligibility: T.EligibilityResult,
  nowMs: number,
): T.SimQualityGate[] {
  const verificationResult = verification(T.FEATURE_ID);
  const staleBlocked = !guard.passed && guard.reasonCode === 'BATTERY_TEMP_SIGNAL_STALE';
  const offlineScenario = inputs.network !== 'ONLINE';
  const rollbackScenario = inputs.killSwitch || inputs.policyVersionSeq < T.DEMO_POLICY.policyVersionSeq;

  return [
    {
      id: 'QG-01',
      label: { ko: 'Eligibility 판정 근거', en: 'Eligibility justification' },
      status: 'PASS',
      detail: { ko: `${T.ELIGIBILITY_LABEL[eligibility.eligibility].ko} · ${eligibility.reasonCode}`, en: `${T.ELIGIBILITY_LABEL[eligibility.eligibility].en} · ${eligibility.reasonCode}` },
    },
    {
      id: 'QG-02',
      label: { ko: 'What-if Simulation 실행', en: 'What-if simulation executed' },
      status: 'PASS',
      detail: { ko: `시뮬레이션 시각 ${isoAt(nowMs)} · 결정적 시드 ${SIM_SEED}`, en: `Simulated at ${isoAt(nowMs)} · deterministic seed ${SIM_SEED}` },
    },
    {
      id: 'QG-03',
      label: { ko: 'Offline / Safe Default 검증', en: 'Offline / safe default verified' },
      status: offlineScenario ? 'PASS' : 'WARN',
      detail: offlineScenario
        ? { ko: '오프라인 분기 실행 — 캐시 TTL·Safe Default 동작 확인', en: 'Offline branch exercised — cache TTL and safe default checked' }
        : { ko: '온라인 시나리오 — 별도 오프라인 검증 필요', en: 'Online scenario — run an offline scenario separately' },
    },
    {
      id: 'QG-04',
      label: { ko: 'Rollback / Kill-Switch 검증', en: 'Rollback / kill-switch verified' },
      status: rollbackScenario ? 'PASS' : 'WARN',
      detail: rollbackScenario
        ? { ko: '롤백·Kill-Switch 경로 실행 확인', en: 'Rollback/kill-switch path exercised' }
        : { ko: '롤백 시나리오 미실행', en: 'Rollback scenario not executed' },
    },
    {
      id: 'QG-05',
      label: { ko: 'Stale 신호 차단 검증', en: 'Stale signal blocking verified' },
      status: staleBlocked ? 'PASS' : 'WARN',
      detail: staleBlocked
        ? { ko: 'TTL 초과 신호로 Effective 차단 확인 (Safe Default 유지)', en: 'Effective blocked on a stale signal (safe default kept)' }
        : { ko: 'Stale 신호 시나리오 미실행', en: 'Stale signal scenario not executed' },
    },
    {
      id: 'QG-06',
      label: { ko: 'Policy Version 역전 방지', en: 'Policy version anti-reversal' },
      status: recon.reasonCode === 'POLICY_VERSION_OUTDATED' ? 'PASS' : 'WARN',
      detail:
        recon.reasonCode === 'POLICY_VERSION_OUTDATED'
          ? { ko: '낮은 버전 거부 동작 확인', en: 'Lower-version rejection confirmed' }
          : { ko: '낮은 버전 시나리오 미실행', en: 'Lower-version scenario not executed' },
    },
    {
      id: 'QG-07',
      label: { ko: 'Unknown 원인 분류', en: 'Unknown cause classification' },
      status: recon.result === 'UNKNOWN' ? 'PASS' : 'WARN',
      detail:
        recon.result === 'UNKNOWN'
          ? { ko: `원인 분류 및 권장 조치 제공 (${recon.reasonCode})`, en: `Cause and recommendation provided (${recon.reasonCode})` }
          : { ko: 'Unknown 발생 시 원인 분류가 제공됩니다.', en: 'Cause classification is provided whenever Unknown occurs.' },
    },
    {
      id: 'QG-08',
      label: { ko: 'Local Guard 결과 기록', en: 'Local guard result recorded' },
      status: 'PASS',
      detail: { ko: `${guard.checks.filter((c) => c.passed).length}/${guard.checks.length} 조건 통과 — 결과 ${guard.reasonCode}`, en: `${guard.checks.filter((c) => c.passed).length}/${guard.checks.length} checks passed — ${guard.reasonCode}` },
    },
    {
      id: 'QG-09',
      label: { ko: 'Policy 서명 검증 (SIMULATED SECURITY)', en: 'Policy signature (SIMULATED SECURITY)' },
      status: 'PASS',
      detail: { ko: `서명 상태 VERIFIED · 해시 ${T.DEMO_POLICY.policyHash}`, en: `Signature VERIFIED · hash ${T.DEMO_POLICY.policyHash}` },
    },
    {
      id: 'QG-10',
      label: { ko: '차량 검증 Gate 연계 (HIL/OTA-RB/TEL)', en: 'Vehicle verification gates (HIL/OTA-RB/TEL)' },
      status: verificationResult.gateResult === 'PASS' ? 'PASS' : 'WARN',
      detail: {
        ko: verificationResult.missingEvidence.length
          ? `미완 증적: ${verificationResult.missingEvidence.join(', ')}`
          : '필수 증적 HIL-BDC-001 / OTA-RB-002 / TEL-BDC-001 완료',
        en: verificationResult.missingEvidence.length
          ? `Missing evidence: ${verificationResult.missingEvidence.join(', ')}`
          : 'Required evidence HIL-BDC-001 / OTA-RB-002 / TEL-BDC-001 complete',
      },
    },
  ];
}

function buildEvidence(
  inputs: T.SimulationInputs,
  recon: T.ReconciliationResult,
  nowMs: number,
): T.SimEvidence[] {
  const at = isoAt(nowMs);
  const out: T.SimEvidence[] = [
    { id: `EVD-SIM-POLICY-${nowMs}`, label: { ko: `Policy ${inputs.policyVersion} 서명·해시 기록`, en: `Policy ${inputs.policyVersion} signature/hash record` }, kind: 'POLICY', capturedAt: at },
    { id: `EVD-SIM-GUARD-${nowMs}`, label: { ko: `Local Guard 결과 ${recon.reasonCode}`, en: `Local guard result ${recon.reasonCode}` }, kind: 'GUARD', capturedAt: at },
    { id: `EVD-SIM-IMPACT-${nowMs}`, label: { ko: '차량 영향도 사전 분석 결과 (대상 VIN 분류)', en: 'Vehicle impact preview result (target VIN classes)' }, kind: 'IMPACT', capturedAt: at },
  ];
  if (inputs.network !== 'ONLINE') {
    out.push({ id: `EVD-SIM-OFFLINE-${nowMs}`, label: { ko: '오프라인 캐시 TTL / Safe Default 검증', en: 'Offline cache TTL / safe default evidence' }, kind: 'OFFLINE', capturedAt: at });
  }
  if (inputs.killSwitch || inputs.policyVersionSeq < T.DEMO_POLICY.policyVersionSeq) {
    out.push({ id: `EVD-SIM-ROLLBACK-${nowMs}`, label: { ko: 'Rollback / Kill-Switch 실행 기록', en: 'Rollback / kill-switch execution record' }, kind: 'ROLLBACK', capturedAt: at });
  }
  out.push({ id: `EVD-SIM-SAFETY-${nowMs}`, label: { ko: 'Safety-Related Operational 승인 (2인)', en: 'Safety-related operational approval (two-person)' }, kind: 'SAFETY', capturedAt: at });
  return out;
}

/* ------------------------------------------------------------------ */
/* Twin mutators (pure) — every change bumps twinVersion (§18)         */
/* ------------------------------------------------------------------ */

function bump(twin: T.Twin, at: string, actor: string, action: T.Localized, detail?: string): T.Twin {
  return {
    ...twin,
    twinVersion: twin.twinVersion + 1,
    auditTrail: [...twin.auditTrail, { at, actor, action, detail }].slice(-40),
  };
}

export function withFeatureInstance(
  twin: T.Twin,
  mutate: (inst: T.FeatureInstance) => T.FeatureInstance,
  audit: { at: string; actor: string; action: T.Localized; detail?: string },
): T.Twin {
  const inst = twin.featureInstances[T.FEATURE_ID];
  if (!inst) return twin;
  const next = mutate(inst);
  const updated: T.Twin = { ...twin, featureInstances: { ...twin.featureInstances, [T.FEATURE_ID]: next } };
  return bump(updated, audit.at, audit.actor, audit.action, audit.detail);
}

export function applyDesiredChange(twin: T.Twin, state: T.DesiredState, at: string, actor = 'operator-7'): T.Twin {
  return withFeatureInstance(
    twin,
    (inst) => ({ ...inst, desired: { state, requestedAt: at } }),
    { at, actor, action: { ko: `Desired 상태를 ${state}로 변경`, en: `Desired state set to ${state}` } },
  );
}

export function applyPolicyDelivery(twin: T.Twin, policy: T.TwinPolicyRef, at: string): T.Twin {
  const seq = parsePolicySeq(policy.policyVersion);
  const inst = twin.featureInstances[T.FEATURE_ID];
  const reversal = seq < inst.policy.cachedVersionSeq;
  const signatureOk = policy.signatureStatus === 'VERIFIED';
  return withFeatureInstance(
    twin,
    (i) => ({
      ...i,
      policy: {
        policyId: policy.policyId,
        policyVersion: reversal ? i.policy.policyVersion : policy.policyVersion,
        policyHash: reversal ? i.policy.policyHash : policy.policyHash,
        signatureStatus: policy.signatureStatus,
        cachedVersionSeq: Math.max(i.policy.cachedVersionSeq, seq),
        lastSyncedAt: at,
      },
      reported: reversal || !signatureOk
        ? { state: 'REJECTED', receivedPolicyVersion: policy.policyVersion, reportedAt: at, guardResult: 'BLOCK', guardReason: reversal ? 'POLICY_VERSION_OUTDATED' : 'POLICY_SIGNATURE_INVALID' }
        : { state: 'ON', receivedPolicyVersion: policy.policyVersion, reportedAt: at, guardResult: i.reported.guardResult },
    }),
    {
      at,
      actor: 'vehicle-agent',
      action: reversal
        ? { ko: `Policy ${policy.policyVersion} 수신 — 버전 역전으로 거부`, en: `Policy ${policy.policyVersion} received — rejected (version reversal)` }
        : !signatureOk
          ? { ko: `Policy ${policy.policyVersion} 수신 — 서명 검증 실패로 거부`, en: `Policy ${policy.policyVersion} received — rejected (signature)` }
          : { ko: `Policy ${policy.policyVersion} 수신·검증 완료`, en: `Policy ${policy.policyVersion} received and verified` },
    },
  );
}

export interface PolicyRefLike {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  signatureStatus: T.SignatureStatus;
}

export function applyVehicleReport(
  twin: T.Twin,
  report: { reported?: T.ReportedState; effective?: T.EffectiveState; guardResult?: 'PASS' | 'BLOCK' | 'UNKNOWN'; guardReason?: T.ReasonCode; reasonCode?: T.ReasonCode },
  at: string,
): T.Twin {
  return withFeatureInstance(
    twin,
    (inst) => ({
      ...inst,
      reported: {
        state: report.reported ?? inst.reported.state,
        receivedPolicyVersion: inst.policy.policyVersion,
        reportedAt: at,
        guardResult: report.guardResult ?? inst.reported.guardResult,
        guardReason: report.guardReason ?? inst.reported.guardReason,
      },
      effective: {
        state: report.effective ?? inst.effective.state,
        reasonCode: report.reasonCode ?? report.guardReason ?? inst.effective.reasonCode,
        evaluatedAt: at,
      },
    }),
    {
      at,
      actor: 'vehicle-agent',
      action: { ko: `차량 보고: Reported=${report.reported ?? '—'} / Effective=${report.effective ?? '—'}`, en: `Vehicle report: Reported=${report.reported ?? '—'} / Effective=${report.effective ?? '—'}` },
    },
  );
}

export function applyEffectiveState(twin: T.Twin, state: T.EffectiveState, code: T.ReasonCode, at: string, actor = 'vehicle-agent'): T.Twin {
  return withFeatureInstance(
    twin,
    (inst) => ({ ...inst, effective: { state, reasonCode: code, evaluatedAt: at } }),
    { at, actor, action: { ko: `Effective 상태 ${state} (${code})`, en: `Effective state ${state} (${code})` } },
  );
}

export function applyKillSwitch(twin: T.Twin, ks: T.KillSwitchState | undefined, at: string, actor = 'operator-7'): T.Twin {
  const base: T.Twin = { ...twin, killSwitch: ks };
  if (ks?.active) {
    return applyEffectiveState(
      bump(base, at, actor, { ko: 'Kill-Switch 활성화', en: 'Kill-switch activated' }, ks.reason.ko),
      'OFF',
      'KILL_SWITCH_ACTIVE',
      at,
      actor,
    );
  }
  return bump(base, at, actor, { ko: 'Kill-Switch 해제', en: 'Kill-switch released' });
}

export function applyOffline(twin: T.Twin, at: string, offline: boolean): T.Twin {
  const next: T.Twin = { ...twin, link: { ...twin.link, online: !offline, lastSeenAt: offline ? twin.link.lastSeenAt : at } };
  return bump(next, at, 'vehicle-agent', offline
    ? { ko: '차량 접속 단절 — 서명 Policy 캐시로 전환', en: 'Vehicle link lost — switching to signed policy cache' }
    : { ko: '차량 재접속 — 정책 재동기화', en: 'Vehicle reconnected — policy resynchronised' });
}

export function applyContextStale(twin: T.Twin, at: string, signal: T.SignalKey, ageSeconds: number): T.Twin {
  const cur = twin.context[signal];
  if (!cur) return twin;
  const next: T.Twin = {
    ...twin,
    context: {
      ...twin.context,
      [signal]: { ...cur, observedAt: isoAt(Date.parse(at), -ageSeconds * 1000), quality: 'UNCERTAIN' },
    },
  };
  return bump(next, at, 'vehicle-agent', { ko: `${signal} 신호 TTL 초과`, en: `${signal} signal past TTL` });
}

export function applyDtc(twin: T.Twin, at: string, code: string): T.Twin {
  const inst = twin.featureInstances[T.FEATURE_ID];
  const next: T.Twin = {
    ...twin,
    featureInstances: {
      ...twin.featureInstances,
      [T.FEATURE_ID]: { ...inst, observed: { ...inst.observed, dtcCodes: [...new Set([...inst.observed.dtcCodes, code])], health: 'DEGRADED' } },
    },
  };
  return bump(next, at, 'vehicle-agent', { ko: `DTC 발생 ${code}`, en: `DTC raised ${code}` });
}

/** OTA 결과 반영 — As-Deployed 가 올라가면 Binary OTA 필요 사유가 사라진다. */
export function applyDeployment(
  twin: T.Twin,
  d: { oneBinaryVersion?: string; bmsSoftwareVersion?: string },
  at: string,
  actor = 'ota-service',
): T.Twin {
  const next: T.Twin = {
    ...twin,
    asDeployed: {
      ...twin.asDeployed,
      oneBinaryVersion: d.oneBinaryVersion ?? twin.asDeployed.oneBinaryVersion,
      bmsSoftwareVersion: d.bmsSoftwareVersion ?? twin.asDeployed.bmsSoftwareVersion,
      installationStatus: 'INSTALLED' as const,
      installedAt: at,
    },
  };
  return bump(next, at, actor, {
    ko: `OTA 완료 — One-Binary ${next.asDeployed.oneBinaryVersion} / BMS ${next.asDeployed.bmsSoftwareVersion}`,
    en: `OTA completed — one-binary ${next.asDeployed.oneBinaryVersion} / BMS ${next.asDeployed.bmsSoftwareVersion}`,
  });
}

/** 신호 정상화 — 재접속/재수신 후 TTL·품질이 회복된 상태를 반영한다. */
export function applyContextRecovered(
  twin: T.Twin,
  at: string,
  signal: T.SignalKey,
  value?: number | string,
): T.Twin {
  const cur = twin.context[signal];
  if (!cur) return twin;
  const next: T.Twin = {
    ...twin,
    context: {
      ...twin.context,
      [signal]: { ...cur, value: value ?? cur.value, observedAt: at, quality: 'GOOD' },
    },
    link: { ...twin.link, lastSeenAt: at },
  };
  return bump(next, at, 'vehicle-agent', { ko: `${signal} 신호 정상화`, en: `${signal} signal recovered` });
}

/* ------------------------------------------------------------------ */
/* Closed loop (§12.5) — 12 steps                                      */
/* ------------------------------------------------------------------ */

export const CLOSED_LOOP_STEPS: T.Localized[] = [
  { ko: '장애 주입', en: 'Fault injected' },
  { ko: 'Simulator 이벤트 전송', en: 'Simulator event sent' },
  { ko: '차량 상태 갱신', en: 'Vehicle state updated' },
  { ko: 'Reconciliation 상태 변화', en: 'Reconciliation state changed' },
  { ko: 'Incident 자동 생성', en: 'Incident created' },
  { ko: '신규 Rollout 자동 Pause', en: 'New rollout auto-paused' },
  { ko: 'Kill-Switch / Rollback 실행', en: 'Kill-switch / rollback executed' },
  { ko: '차량 OFF 응답', en: 'Vehicle responds OFF' },
  { ko: 'Effective OFF 확인', en: 'Effective OFF confirmed' },
  { ko: 'Fleet Convergence 복구 확인', en: 'Fleet convergence recovery confirmed' },
  { ko: 'Incident Evidence 생성', en: 'Incident evidence produced' },
  { ko: 'Incident Close', en: 'Incident closed' },
];

export function closedLoopProgress(current: number): T.ClosedLoopStep[] {
  return CLOSED_LOOP_STEPS.map((label, i) => ({
    id: i + 1,
    label,
    status: i < current ? 'DONE' : i === current ? 'ACTIVE' : 'PENDING',
    detail: { ko: '', en: '' },
  }));
}

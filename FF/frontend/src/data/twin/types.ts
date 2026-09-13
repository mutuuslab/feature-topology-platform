/**
 * Vehicle Digital Twin — type & vocabulary layer.
 *
 * Scope note: this module only defines the operational twin (VIN-scoped facts) and the
 * simulation twin (what-if). Feature definitions, BOM and topology stay in the Feature
 * Registry; the twin only *references* them by id/version so there is no second source
 * of truth. See DIGITAL_TWIN_DEMO.md.
 *
 * All data flowing through these types is SYNTHETIC — no real VIN, no PII.
 */

export type Lang = 'ko' | 'en';

export interface Localized {
  ko: string;
  en: string;
}

export function pick(l: Localized | undefined, lang: Lang): string {
  if (!l) return '';
  return lang === 'en' ? l.en : l.ko;
}

/* ------------------------------------------------------------------ */
/* §9 — state enums                                                    */
/* ------------------------------------------------------------------ */

/** Central policy intent. */
export type DesiredState = 'ON' | 'OFF';

/** What the Vehicle Agent reports it received / applied. */
export type ReportedState = 'ON' | 'OFF' | 'NOT_RECEIVED' | 'REJECTED' | 'UNKNOWN';

/** What is actually runnable after the Vehicle Local Guard evaluates local conditions. */
export type EffectiveState = 'ON' | 'OFF' | 'BLOCKED' | 'DEGRADED' | 'UNKNOWN';

export type TwinHealth = 'HEALTHY' | 'DEGRADED' | 'STALE' | 'OFFLINE' | 'DRIFTED' | 'UNKNOWN';

export type Eligibility =
  | 'ELIGIBLE_POLICY_ONLY'
  | 'REQUIRES_BINARY_OTA'
  | 'INCOMPATIBLE_HARDWARE'
  | 'INCOMPATIBLE_VARIANT'
  | 'MISSING_ENTITLEMENT'
  | 'STALE_TWIN'
  | 'BLOCKED_BY_SAFETY_RULE'
  | 'UNKNOWN';

export type Reconciliation =
  | 'CONVERGED'
  | 'PENDING'
  | 'GUARDED'
  | 'REJECTED'
  | 'CRITICAL_DRIFT'
  | 'UNKNOWN';

/** Why a twin cannot be judged yet (§9 — Unknown must always carry a cause). */
export type UnknownCause =
  | 'TELEMETRY_TIMEOUT'
  | 'TWIN_SNAPSHOT_MISSING'
  | 'POLICY_VERSION_UNKNOWN'
  | 'VEHICLE_AGENT_VERSION_UNSUPPORTED'
  | 'CONFIGURATION_MISMATCH'
  | 'SIGNAL_QUALITY_UNKNOWN'
  | 'BACKEND_PROCESSING_FAILURE'
  | 'CAUSE_ANALYSIS_REQUIRED';

export type SignalQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'UNKNOWN';

export type InstallStatus = 'INSTALLED' | 'PENDING' | 'FAILED' | 'NOT_APPLICABLE';

/** Classification used by every surface so the demo is never mistaken for real data. */
export type DataClassification = 'SYNTHETIC';

/** §15 — mock signing is labelled as simulated security. */
export type SignatureStatus = 'VERIFIED' | 'INVALID' | 'MISSING' | 'NOT_VERIFIED';

/* ------------------------------------------------------------------ */
/* Reason codes                                                        */
/* ------------------------------------------------------------------ */

export type ReasonKind =
  | 'ELIGIBILITY'
  | 'POLICY'
  | 'GUARD'
  | 'LINK'
  | 'CONFIG'
  | 'SAFETY'
  | 'RESULT'
  | 'UNKNOWN';

export type ReasonSeverity = 'PASS' | 'INFO' | 'PENDING' | 'FAIL';

export interface ReasonCodeDef {
  code: ReasonCode;
  kind: ReasonKind;
  severity: ReasonSeverity;
  label: Localized;
  /** User friendly explanation (operator language, not engineering jargon). */
  desc: Localized;
  /** Recommended action. */
  recommendation: Localized;
  /** Whether this condition must raise / link an Incident. */
  incident: boolean;
}

export type ReasonCode =
  | 'CONVERGED'
  | 'POLICY_APPLIED_OK'
  | 'PENDING_POLICY_DELIVERY'
  | 'POLICY_NOT_RECEIVED'
  | 'POLICY_VERSION_OUTDATED'
  | 'POLICY_SIGNATURE_INVALID'
  | 'OFFLINE_POLICY_CACHE_VALID'
  | 'OFFLINE_POLICY_TTL_EXPIRED'
  | 'SAFE_DEFAULT_APPLIED'
  | 'HARDWARE_CAPABILITY_MISSING'
  | 'VARIANT_CODING_MISMATCH'
  | 'BMS_SOFTWARE_BELOW_MINIMUM'
  | 'ONE_BINARY_BELOW_MINIMUM'
  | 'ENTITLEMENT_INACTIVE'
  | 'BATTERY_TEMP_SIGNAL_STALE'
  | 'BATTERY_TEMP_OUT_OF_RANGE'
  | 'SOC_BELOW_THRESHOLD'
  | 'CHARGING_SCHEDULE_MISSING'
  | 'CHARGING_CONNECTOR_OPEN'
  | 'POWER_MODE_NOT_READY'
  | 'SIGNAL_QUALITY_BAD'
  | 'TELEMETRY_TIMEOUT'
  | 'TWIN_SNAPSHOT_MISSING'
  | 'POLICY_VERSION_UNKNOWN'
  | 'VEHICLE_AGENT_VERSION_UNSUPPORTED'
  | 'CONFIGURATION_MISMATCH'
  | 'SIGNAL_QUALITY_UNKNOWN'
  | 'BACKEND_PROCESSING_FAILURE'
  | 'CAUSE_ANALYSIS_REQUIRED'
  | 'VEHICLE_AGENT_OFFLINE'
  | 'EFFECTIVE_DRIFT_DETECTED'
  | 'ABNORMAL_DTC'
  | 'KILL_SWITCH_ACTIVE'
  | 'ROLLBACK_APPLIED'
  | 'LOCAL_GUARD_PASSED'
  | 'LOCAL_GUARD_BLOCKED';

/* ------------------------------------------------------------------ */
/* §7 — demo feature (registered in the Feature Registry, referenced
 *       here by id + version only)                                     */
/* ------------------------------------------------------------------ */

export const FEATURE_ID = 'F-BAT-PRECOND';
export const FEATURE_VERSION = '2.0.0';
export const FEATURE_DISPLAY: Localized = {
  ko: '배터리 사전 예열 최적화 v2',
  en: 'Battery Preconditioning Optimization v2',
};
export const FEATURE_CLASS: Localized = {
  ko: 'Operational / Safety-Related Operational',
  en: 'Operational / Safety-Related Operational',
};
export const FEATURE_FALLBACK: Localized = {
  ko: 'OFF (Safe Default)',
  en: 'OFF (Safe Default)',
};
export const FEATURE_OWNER = '조직: Thermal Energy Management (TEM)';
export const FEATURE_TARGET_SCOPE = 'EV Demo Model · KR · MY2027';

/** Variant coding the demo models against — single source for fleet + simulator. */
export const VARIANT_OK = 'VC-EV-2027-KR';
export const VARIANT_OLD = 'VC-EV-2026-KR';

/** Registry-side requirements the twin is evaluated against. */
export const FEATURE_REQUIREMENTS = {
  hardwareCapabilities: ['BATTERY_HEATER'],
  minimumBmsSoftware: '3.2.0',
  minimumOneBinary: '2.7.0',
  entitlementId: 'BAT_PRECOND_PLUS',
  safeDefault: 'OFF' as const,
  variantCodingRequired: [VARIANT_OK],
};

/** §9 — policy must survive an unsigned / older push. Values are demo constants. */
export const DEMO_POLICY = {
  policyId: 'POLICY-BDC-0042',
  policyVersion: 'POL-0042',
  policyVersionSeq: 42,
  policyHash: 'sha256:9f2c41d7…',
  signatureStatus: 'VERIFIED' as SignatureStatus,
  approvedBy: '김검증 / 이안전 (2인 승인)',
  approvedAt: '2026-09-12T08:40:00Z',
  /** Offline: a signed policy stays usable for this long. */
  offlineTtlSeconds: 86400,
};

export const REVOKED_POLICY = {
  policyId: 'POLICY-BDC-0039',
  policyVersion: 'POL-0039',
  policyVersionSeq: 39,
  policyHash: 'sha256:41ab77c2…',
  signatureStatus: 'VERIFIED' as SignatureStatus,
  approvedBy: '정책롤백 (자동)',
  approvedAt: '2026-09-05T02:10:00Z',
  offlineTtlSeconds: 86400,
};

/** 데모 Policy 상수를 차량에 전달되는 참조 형태로 바꾼다. */
export function policyRef(p: DemoPolicy, at: string): TwinPolicyRef {
  return {
    policyId: p.policyId,
    policyVersion: p.policyVersion,
    policyHash: p.policyHash,
    signatureStatus: p.signatureStatus,
    cachedVersionSeq: p.policyVersionSeq,
    lastSyncedAt: at,
  };
}

export type DemoPolicy = typeof DEMO_POLICY;

/* ------------------------------------------------------------------ */
/* Signals (twin context) — COVESA VSS reference paths are informational
 * only; the 2nd-stage PoC can swap the port implementation for KUKSA.  */
/* ------------------------------------------------------------------ */

export type SignalKey =
  | 'BatterySoc'
  | 'BatteryTemperature'
  | 'AmbientTemperature'
  | 'ChargingSchedule'
  | 'ChargingConnectorState'
  | 'VehiclePowerMode';

export interface SignalSpec {
  key: SignalKey;
  label: Localized;
  unit: string;
  /** Freshness budget — older than this and any safety decision is refused. */
  ttlSeconds: number;
  kind: 'number' | 'enum';
  vss: string;
}

export const SIGNAL_SPECS: SignalSpec[] = [
  {
    key: 'BatterySoc',
    label: { ko: '배터리 SOC', en: 'Battery SOC' },
    unit: '%',
    ttlSeconds: 300,
    kind: 'number',
    vss: 'Vehicle.Powertrain.TractionBattery.StateOfCharge.Current',
  },
  {
    key: 'BatteryTemperature',
    label: { ko: '배터리 온도', en: 'Battery Temperature' },
    unit: '°C',
    ttlSeconds: 120,
    kind: 'number',
    vss: 'Vehicle.Powertrain.TractionBattery.Temperature.Average',
  },
  {
    key: 'AmbientTemperature',
    label: { ko: '외기 온도', en: 'Ambient Temperature' },
    unit: '°C',
    ttlSeconds: 900,
    kind: 'number',
    vss: 'Vehicle.Exterior.AirTemperature',
  },
  {
    key: 'ChargingSchedule',
    label: { ko: '충전 스케줄', en: 'Charging Schedule' },
    unit: '',
    ttlSeconds: 3600,
    kind: 'enum',
    vss: 'Vehicle.Powertrain.TractionBattery.Charging.ChargeSchedules',
  },
  {
    key: 'ChargingConnectorState',
    label: { ko: '충전 커넥터 상태', en: 'Charging Connector State' },
    unit: '',
    ttlSeconds: 60,
    kind: 'enum',
    vss: 'Vehicle.Powertrain.TractionBattery.Charging.Connected',
  },
  {
    key: 'VehiclePowerMode',
    label: { ko: '차량 전원 모드', en: 'Vehicle Power Mode' },
    unit: '',
    ttlSeconds: 60,
    kind: 'enum',
    vss: 'Vehicle.LowVoltageSystemState',
  },
];

export const SIGNAL_BY_KEY: Record<SignalKey, SignalSpec> = SIGNAL_SPECS.reduce((acc, s) => {
  acc[s.key] = s;
  return acc;
}, {} as Record<SignalKey, SignalSpec>);

export interface SignalSample {
  value: number | string;
  unit: string;
  quality: SignalQuality;
  observedAt: string;
  ttlSeconds: number;
}

export type TwinContext = Partial<Record<SignalKey, SignalSample>>;

/* ------------------------------------------------------------------ */
/* §7 — topology conditions (reference to topology version, not a copy) */
/* ------------------------------------------------------------------ */

export interface TopologyCondition {
  id: string;
  label: Localized;
  /** What the platform does when the condition is not met. */
  effect: Localized;
}

export const TOPOLOGY_VERSION = 'TOPO-EV-2027.4';

export const TOPOLOGY_CONDITIONS: TopologyCondition[] = [
  {
    id: 'TC-01',
    label: { ko: '배터리 히터 미장착 → 활성화 불가', en: 'Battery heater absent → cannot activate' },
    effect: { ko: 'INCOMPATIBLE_HARDWARE', en: 'INCOMPATIBLE_HARDWARE' },
  },
  {
    id: 'TC-02',
    label: { ko: 'BMS SW 3.2.0 미만 → Binary OTA 선행', en: 'BMS SW < 3.2.0 → Binary OTA first' },
    effect: { ko: 'REQUIRES_BINARY_OTA', en: 'REQUIRES_BINARY_OTA' },
  },
  {
    id: 'TC-03',
    label: { ko: '배터리 온도 신호 Stale → 차단', en: 'Battery temperature stale → block' },
    effect: { ko: 'Effective = BLOCKED', en: 'Effective = BLOCKED' },
  },
  {
    id: 'TC-04',
    label: { ko: 'Local Guard 조건 미충족 → Effective 차단', en: 'Guard condition unmet → Effective blocked' },
    effect: { ko: 'Effective = BLOCKED', en: 'Effective = BLOCKED' },
  },
  {
    id: 'TC-05',
    label: { ko: '오프라인 → TTL 내 마지막 서명 Policy 사용', en: 'Offline → last signed policy within TTL' },
    effect: { ko: 'OFFLINE_POLICY_CACHE_VALID', en: 'OFFLINE_POLICY_CACHE_VALID' },
  },
  {
    id: 'TC-06',
    label: { ko: '오프라인 TTL 만료 → Safe Default', en: 'Offline TTL expired → Safe Default' },
    effect: { ko: 'SAFE_DEFAULT_APPLIED', en: 'SAFE_DEFAULT_APPLIED' },
  },
  {
    id: 'TC-07',
    label: { ko: '더 낮은 Policy Version 수신 → 거부', en: 'Lower policy version received → reject' },
    effect: { ko: 'POLICY_VERSION_OUTDATED', en: 'POLICY_VERSION_OUTDATED' },
  },
  {
    id: 'TC-08',
    label: { ko: 'Kill-Switch > Target Rule > Entitlement', en: 'Kill-switch > target rule > entitlement' },
    effect: { ko: 'KILL_SWITCH_ACTIVE', en: 'KILL_SWITCH_ACTIVE' },
  },
];

/* ------------------------------------------------------------------ */
/* §8 — twin model (no feature definitions are copied)                 */
/* ------------------------------------------------------------------ */

export interface TwinIdentity {
  vin: string;
  vehicleModel: string;
  modelYear: number;
  region: string;
  trim: string;
  vehicleConfigId: string;
  upgVc: string;
}

export interface TwinAsDesigned {
  vehicleConfigVersion: string;
  featureBomVersion: string;
  topologyVersion: string;
}

export interface TwinAsBuilt {
  eolSnapshotId: string;
  hardwareCapabilities: string[];
  variantCodingVersion: string;
  recordedAt: string;
}

export interface TwinAsDeployed {
  oneBinaryVersion: string;
  bmsSoftwareVersion: string;
  ecuSoftware: Record<string, string>;
  otaCampaignId?: string;
  installationStatus: InstallStatus;
  installedAt: string;
}

export interface TwinEntitlement {
  entitlementId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
}

export interface TwinPolicyRef {
  policyId: string;
  policyVersion: string;
  policyHash: string;
  signatureStatus: SignatureStatus;
  /** Cached sequence number while offline — drives anti-reversal. */
  cachedVersionSeq: number;
  lastSyncedAt: string;
}

export interface TwinDesired {
  state: DesiredState;
  requestedAt: string;
}

export interface TwinReported {
  state: ReportedState;
  receivedPolicyVersion: string | null;
  reportedAt: string | null;
  /** Local Guard verdict reported by the vehicle agent. */
  guardResult: 'PASS' | 'BLOCK' | 'UNKNOWN';
  guardReason?: ReasonCode;
}

export interface TwinEffective {
  state: EffectiveState;
  reasonCode: ReasonCode;
  evaluatedAt: string;
}

export interface TwinObserved {
  health: TwinHealth;
  lastTelemetryAt: string;
  dtcCodes: string[];
}

export interface FeatureInstance {
  featureId: string;
  featureVersion: string;
  entitlement: TwinEntitlement;
  policy: TwinPolicyRef;
  desired: TwinDesired;
  reported: TwinReported;
  effective: TwinEffective;
  observed: TwinObserved;
}

export interface Twin {
  twinId: string;
  vin: string;
  twinVersion: number;
  dataClassification: DataClassification;
  identity: TwinIdentity;
  asDesigned: TwinAsDesigned;
  asBuilt: TwinAsBuilt;
  asDeployed: TwinAsDeployed;
  featureInstances: Record<string, FeatureInstance>;
  context: TwinContext;
  /** Connectivity + snapshot freshness. */
  link: {
    online: boolean;
    vehicleAgentVersion: string;
    lastSeenAt: string;
    snapshotAt: string;
    /** Deterministic archetype the demo fleet built this twin from. */
    archetype: ArchetypeId;
    cohort: string;
    /** True when the twin was derived on demand instead of coming from the demo fleet. */
    syntheticDerived?: boolean;
  };
  killSwitch?: KillSwitchState;
  auditTrail: TwinAuditEntry[];
}

export interface KillSwitchState {
  active: boolean;
  requestedBy: string;
  requestedAt: string;
  reason: Localized;
  featureId: string;
  policyVersion: string;
  safeState: DesiredState;
  affectedVins: number;
}

export interface TwinAuditEntry {
  at: string;
  actor: string;
  action: Localized;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* §14 — demo fleet archetypes                                         */
/* ------------------------------------------------------------------ */

export type ArchetypeId =
  | 'READY'
  | 'NEEDS_BINARY_OTA'
  | 'NO_HARDWARE'
  | 'NO_ENTITLEMENT'
  | 'STALE_CONTEXT'
  | 'OFFLINE'
  | 'GUARD_BLOCK'
  | 'VERSION_CONFLICT'
  | 'DRIFT'
  /** 추가 구성 케이스 — Variant Coding 불일치 (Config 재적용 필요). */
  | 'VARIANT_MISMATCH';

export interface ArchetypeDef {
  id: ArchetypeId;
  label: Localized;
  desc: Localized;
}

export const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'READY',
    label: { ko: '즉시 활성화 가능', en: 'Ready to activate' },
    desc: { ko: 'HW·SW·Entitlement·신호 모두 충족', en: 'HW, SW, entitlement and signals all satisfied' },
  },
  {
    id: 'NEEDS_BINARY_OTA',
    label: { ko: 'Binary OTA 필요', en: 'Binary OTA required' },
    desc: { ko: 'BMS SW 3.2.0 미만 — Policy-only 불가', en: 'BMS SW below 3.2.0 — not policy-only' },
  },
  {
    id: 'NO_HARDWARE',
    label: { ko: 'HW Capability 부족', en: 'Hardware capability missing' },
    desc: { ko: '배터리 히터 미장착', en: 'Battery heater not fitted' },
  },
  {
    id: 'NO_ENTITLEMENT',
    label: { ko: 'Entitlement 없음', en: 'Entitlement missing' },
    desc: { ko: 'BAT_PRECOND_PLUS 미보유', en: 'BAT_PRECOND_PLUS not owned' },
  },
  {
    id: 'STALE_CONTEXT',
    label: { ko: 'Twin 정보 Stale', en: 'Twin context stale' },
    desc: { ko: '배터리 온도 신호 TTL 초과', en: 'Battery temperature signal past TTL' },
  },
  {
    id: 'OFFLINE',
    label: { ko: '오프라인 (Policy 캐시)', en: 'Offline (policy cache)' },
    desc: { ko: '차량 접속 없음 — TTL 내 캐시 정책으로 판단', en: 'Vehicle unreachable — last signed policy within TTL' },
  },
  {
    id: 'GUARD_BLOCK',
    label: { ko: 'Local Guard 차단', en: 'Local Guard blocked' },
    desc: { ko: 'Desired ON / Reported ON / Effective BLOCKED', en: 'Desired ON / Reported ON / Effective BLOCKED' },
  },
  {
    id: 'VERSION_CONFLICT',
    label: { ko: 'Policy Version 충돌', en: 'Policy version conflict' },
    desc: { ko: '더 낮은 Policy Version 수신 → 거부', en: 'Lower policy version received → rejected' },
  },
  {
    id: 'DRIFT',
    label: { ko: 'Effective Drift', en: 'Effective drift' },
    desc: { ko: 'Desired OFF 인데 Effective ON — Critical Drift', en: 'Desired OFF but Effective ON — critical drift' },
  },
  {
    id: 'VARIANT_MISMATCH',
    label: { ko: 'Variant Coding 불일치', en: 'Variant coding mismatch' },
    desc: { ko: '차량 구성 코드가 요구 Variant와 불일치 — Config 재적용 필요', en: 'Vehicle variant coding does not match the required variant' },
  },
];

export const ARCHETYPE_BY_ID: Record<ArchetypeId, ArchetypeDef> = ARCHETYPES.reduce((acc, a) => {
  acc[a.id] = a;
  return acc;
}, {} as Record<ArchetypeId, ArchetypeDef>);

/* ------------------------------------------------------------------ */
/* §11 — event sourcing envelope                                       */
/* ------------------------------------------------------------------ */

export type TwinEventType =
  | 'vehicle.as-built.updated'
  | 'ota.binary.install.requested'
  | 'ota.binary.install.completed'
  | 'policy.approved'
  | 'policy.desired.changed'
  | 'policy.delivery.started'
  | 'vehicle.policy.received'
  | 'vehicle.policy.rejected'
  | 'vehicle.feature.reported'
  | 'vehicle.feature.effective'
  | 'vehicle.context.updated'
  | 'vehicle.guard.blocked'
  | 'twin.reconciliation.changed'
  | 'twin.stale.detected'
  | 'twin.drift.detected'
  | 'rollout.threshold.exceeded'
  | 'rollout.paused'
  | 'kill-switch.requested'
  | 'kill-switch.applied'
  | 'rollback.requested'
  | 'rollback.completed'
  | 'incident.created'
  | 'incident.closed';

export type TwinEventSource = 'POLICY_ENGINE' | 'VEHICLE_AGENT' | 'TWIN_SERVICE' | 'OPERATOR' | 'SIMULATOR' | 'OTA_SERVICE';

export interface TwinEvent {
  /** Identity of the event itself — the ingestion log is idempotent on this. */
  eventId: string;
  eventType: TwinEventType;
  /** Wall clock (ISO, synthetic). */
  occurredAt: string;
  /** Simulation clock tick — used by the time-control slider. */
  simTick: number;
  correlationId: string;
  causationId?: string;
  source: TwinEventSource;
  vin: string;
  featureId?: string;
  policyVersion?: string | null;
  twinVersion?: number;
  payload?: Record<string, unknown>;
  /** Pre-localised one-line description shown in timelines. */
  desc: Localized;
  severity: ReasonSeverity;
}

/* ------------------------------------------------------------------ */
/* §9 — reconciliation + evaluation results                            */
/* ------------------------------------------------------------------ */

export interface ReconciliationResult {
  result: Reconciliation;
  reasonCode: ReasonCode;
  reason: ReasonCodeDef;
  desired: DesiredState;
  reported: ReportedState;
  effective: EffectiveState;
  policyVersion: string | null;
  twinVersion: number;
  /** First time this combination was seen. */
  firstSeenAt: string;
  /** Last confirmation of the combination. */
  lastConfirmedAt: string;
  incidentId?: string | null;
  evidence: string[];
}

export interface UnknownClassification {
  cause: UnknownCause;
  reasonCode: ReasonCode;
  label: Localized;
  action: Localized;
}

export interface EligibilityResult {
  eligibility: Eligibility;
  reasonCode: ReasonCode;
  reason: ReasonCodeDef;
  /** Populated for STALE_TWIN / UNKNOWN so the UI never shows a bare Unknown. */
  unknownCause?: UnknownCause;
  policyOnlyEligible: boolean;
  detail: Localized;
}

export interface GuardCheck {
  id: string;
  label: Localized;
  passed: boolean;
  observed: string;
  required: string;
  reasonCode: ReasonCode;
}

export interface LocalGuardResult {
  passed: boolean;
  reasonCode: ReasonCode;
  reason: ReasonCodeDef;
  /** Signals that drove the verdict, in evaluation order. */
  checks: GuardCheck[];
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* §10 / §12.2 — target rule + impact analysis                         */
/* ------------------------------------------------------------------ */

export interface TargetRule {
  region: string[];
  vehicleModel: string[];
  requiredCapability: string[];
  minimumBinaryVersion: string;
  entitlementId?: string;
  modelYear?: number[];
}

export interface ImpactBucket {
  eligibility: Eligibility;
  label: Localized;
  count: number;
  vins: string[];
  reasonCode: ReasonCode;
}

export interface TwinImpactResult {
  targetRule: TargetRule;
  featureId: string;
  featureVersion: string;
  policyVersion: string;
  analyzedAt: string;
  snapshotAt: string;
  totalMatched: number;
  counts: Record<Eligibility, number>;
  buckets: ImpactBucket[];
  /** Per-VIN verdict so operators can see excluded vehicles and why. */
  vehicleResults: VehicleImpactResult[];
  unknownCauseBreakdown: Partial<Record<UnknownCause, number>>;
  /**
   * 즉시 활성화 가능(ELIGIBLE_POLICY_ONLY) 차량의 "현재 상태" 분포.
   * Eligibility 는 적용 가능성, Reconciliation 은 실제 수렴 결과라서
   * 활성화 가능 15대 안에 이미 차단/Drift 차량이 섞여 있을 수 있다 (§12.2).
   */
  activationOutlook: ActivationOutlook;
  /** Production 배포 차단 여부와 그 사유 (§12.2 — Impact Preview + Quality Gate 확인 전 차단). */
  productionBlocked: boolean;
  blockReasons: Localized[];
  gate: ImpactGate;
}

export interface ActivationOutlook {
  total: number;
  converged: number;
  pending: number;
  guarded: number;
  rejected: number;
  drifted: number;
  unknown: number;
  /** 아직 desired=ON 이 아닌(활성화 대기) 차량. */
  notYetActivated: number;
}

/** Impact Preview 확인 + Quality Gate 통과가 모두 끝나야 Production 배포가 열린다. */
export interface ImpactGate {
  impactReviewed: boolean;
  qualityGatePassed: boolean;
}

export interface VehicleImpactResult {
  vin: string;
  twinId: string;
  vehicleModel: string;
  region: string;
  modelYear: number;
  upgVc: string;
  oneBinaryVersion: string;
  bmsSoftwareVersion: string;
  entitlementStatus: string;
  policyVersion: string | null;
  desired: DesiredState;
  reported: ReportedState;
  effective: EffectiveState;
  eligibility: Eligibility;
  reconciliation: Reconciliation;
  twinHealth: TwinHealth;
  reasonCode: ReasonCode;
  unknownCause?: UnknownCause;
  cohort: string;
  lastSeenAt: string;
}

/* ------------------------------------------------------------------ */
/* §12.3 — simulation twin                                             */
/* ------------------------------------------------------------------ */

export interface SimulationInputs {
  ambientTemperature: number;
  batteryTemperature: number;
  batterySoc: number;
  chargingSchedule: string;
  connectorState: string;
  powerMode: string;
  network: 'ONLINE' | 'OFFLINE' | 'INTERMITTENT';
  telemetryAgeSeconds: number;
  bmsSoftwareVersion: string;
  oneBinaryVersion: string;
  entitlementStatus: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  policyVersion: string;
  policyVersionSeq: number;
  killSwitch: boolean;
  /** 확장 입력 — HW Capability 부족 시나리오 검증용 (배터리 히터 장착 여부). */
  hardwareCapability: boolean;
}

export interface SimulationResult {
  simulationId: string;
  seed: string;
  createdAt: string;
  inputs: SimulationInputs;
  eligibility: Eligibility;
  eligibilityReason: ReasonCodeDef;
  desired: DesiredState;
  reported: ReportedState;
  effective: EffectiveState;
  localGuard: LocalGuardResult;
  safeDefaultApplied: boolean;
  reasonCode: ReasonCodeDef;
  reconciliation: Reconciliation;
  eventSequence: TwinEventType[];
  eventLog: Array<{ at: string; eventType: TwinEventType; desc: Localized; severity: ReasonSeverity }>;
  qualityGates: SimQualityGate[];
  evidence: SimEvidence[];
  twinVersionBefore: number;
  twinVersionAfter: number;
  dataClassification: DataClassification;
  notes: Localized[];
}

export interface SimQualityGate {
  id: string;
  label: Localized;
  status: 'PASS' | 'FAIL' | 'WARN' | 'NOT_RUN';
  detail: Localized;
}

export interface SimEvidence {
  id: string;
  label: Localized;
  kind: 'POLICY' | 'GUARD' | 'SAFETY' | 'OFFLINE' | 'ROLLBACK' | 'IMPACT';
  capturedAt: string;
}

export interface SimPreset {
  id: string;
  label: Localized;
  desc: Localized;
  inputs: Partial<SimulationInputs>;
}

/* ------------------------------------------------------------------ */
/* §12.5 — closed loop incidents                                       */
/* ------------------------------------------------------------------ */

export type FaultType =
  | 'BATTERY_TEMP_STALE'
  | 'VEHICLE_AGENT_OFFLINE'
  | 'POLICY_SIGNATURE_INVALID'
  | 'LOW_POLICY_VERSION'
  | 'LOCAL_GUARD_FAIL'
  | 'EFFECTIVE_DRIFT'
  | 'ABNORMAL_DTC';

export interface FaultDef {
  id: FaultType;
  label: Localized;
  desc: Localized;
  triggers: Localized;
}

export const FAULTS: FaultDef[] = [
  {
    id: 'BATTERY_TEMP_STALE',
    label: { ko: '배터리 온도 신호 Stale', en: 'Battery temperature signal stale' },
    desc: { ko: 'BMS 텔레메트리 중단 → 안전 판단 불가', en: 'BMS telemetry stopped → no safe decision' },
    triggers: { ko: '차단 + Rollout Pause', en: 'Block + rollout pause' },
  },
  {
    id: 'VEHICLE_AGENT_OFFLINE',
    label: { ko: 'Vehicle Agent 오프라인', en: 'Vehicle agent offline' },
    desc: { ko: '접속 단절 → TTL 경과 시 Safe Default', en: 'Link lost → safe default after TTL' },
    triggers: { ko: 'Stale → Offline → Safe Default', en: 'Stale → offline → safe default' },
  },
  {
    id: 'POLICY_SIGNATURE_INVALID',
    label: { ko: 'Policy 서명 검증 실패', en: 'Policy signature invalid' },
    desc: { ko: '서명 불일치 → 적용 거부 (SIMULATED SECURITY)', en: 'Signature mismatch → reject' },
    triggers: { ko: 'Rejected + Incident', en: 'Rejected + incident' },
  },
  {
    id: 'LOW_POLICY_VERSION',
    label: { ko: '더 낮은 Policy Version 수신', en: 'Lower policy version received' },
    desc: { ko: '역전 방지 규칙으로 거부', en: 'Refused by anti-reversal rule' },
    triggers: { ko: 'POLICY_VERSION_OUTDATED', en: 'POLICY_VERSION_OUTDATED' },
  },
  {
    id: 'LOCAL_GUARD_FAIL',
    label: { ko: 'Local Guard 실패', en: 'Local Guard failure' },
    desc: { ko: '차량 로컬 조건 미충족 → Effective BLOCKED', en: 'Local conditions unmet → Effective BLOCKED' },
    triggers: { ko: 'GUARDED 구간 발생', en: 'GUARDED cohort appears' },
  },
  {
    id: 'EFFECTIVE_DRIFT',
    label: { ko: 'Effective Drift', en: 'Effective drift' },
    desc: { ko: 'Desired OFF 인데 Effective ON', en: 'Desired OFF while Effective ON' },
    triggers: { ko: 'CRITICAL_DRIFT + Incident', en: 'CRITICAL_DRIFT + incident' },
  },
  {
    id: 'ABNORMAL_DTC',
    label: { ko: '비정상 DTC 발생', en: 'Abnormal DTC' },
    desc: { ko: '차량 이상 감지 → 신규 Rollout 정지', en: 'Vehicle fault → pause new rollout' },
    triggers: { ko: 'Rollout Paused', en: 'Rollout paused' },
  },
];

export type IncidentStatus = 'OPEN' | 'MITIGATING' | 'RECOVERING' | 'CLOSED';

export interface TwinIncident {
  incidentId: string;
  fault: FaultType;
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3';
  status: IncidentStatus;
  openedAt: string;
  closedAt?: string;
  featureId: string;
  policyVersion: string;
  affectedVins: string[];
  rolloutId: string;
  rolloutPaused: boolean;
  killSwitch: KillSwitchState;
  reasonCode: ReasonCode;
  rootCause: Localized;
  evidence: SimEvidence[];
  steps: ClosedLoopStep[];
  detectedBy: 'TWIN_RECONCILIATION' | 'TELEMETRY' | 'OPERATOR';
}

export interface ClosedLoopStep {
  id: number;
  label: Localized;
  status: 'DONE' | 'ACTIVE' | 'PENDING' | 'BLOCKED';
  detail: Localized;
  at?: string;
}

/* ------------------------------------------------------------------ */
/* §12.1 — fleet overview filters / stats                              */
/* ------------------------------------------------------------------ */

export interface TwinFilters {
  vehicleModel: string;
  region: string;
  modelYear: string;
  trim: string;
  upgVc: string;
  oneBinaryVersion: string;
  featureId: string;
  policyVersion: string;
  entitlement: string;
  twinHealth: string;
  eligibility: string;
  reconciliation: string;
}

export const EMPTY_FILTERS: TwinFilters = {
  vehicleModel: '',
  region: '',
  modelYear: '',
  trim: '',
  upgVc: '',
  oneBinaryVersion: '',
  featureId: '',
  policyVersion: '',
  entitlement: '',
  twinHealth: '',
  eligibility: '',
  reconciliation: '',
};

export interface TwinFleetStats {
  total: number;
  policyOnly: number;
  requiresBinaryOta: number;
  guardBlocked: number;
  stale: number;
  drift: number;
  unknown: number;
  incidentVehicles: number;
  lastSyncedAt: string;
  reconciliationCounts: Record<Reconciliation, number>;
  healthCounts: Record<TwinHealth, number>;
  eligibilityCounts: Record<Eligibility, number>;
  reasonCodeCounts: Array<{ reasonCode: ReasonCode; count: number }>;
  waveConvergence: Array<{ wave: string; total: number; converged: number; rate: number }>;
}

/* ------------------------------------------------------------------ */
/* §10 — DigitalTwinPort                                                */
/* ------------------------------------------------------------------ */

export interface RolloutConvergence {
  rolloutId: string;
  policyVersion: string;
  featureId: string;
  total: number;
  threshold: number;
  counts: Record<Reconciliation, number>;
  convergenceRate: number;
  paused: boolean;
  pausedReason?: Localized;
  waves: Array<{ wave: string; total: number; converged: number; rate: number }>;
  generatedAt: string;
}

export interface SimulationRequest {
  inputs: SimulationInputs;
  seed?: string;
}

export interface VehicleSimulatorEvent {
  vin: string;
  eventType: TwinEventType;
  payload?: Record<string, unknown>;
}

export const DEMO_TARGET_RULE: TargetRule = {
  region: ['KR'],
  vehicleModel: ['EV Demo Model'],
  requiredCapability: ['BATTERY_HEATER'],
  minimumBinaryVersion: '2.7.0',
  entitlementId: 'BAT_PRECOND_PLUS',
  modelYear: [2027],
};

export const DEMO_ROLLOUT_ID = 'ROLLOUT-BDC-2027-01';
export const CONVERGENCE_THRESHOLD = 0.95;

/* ------------------------------------------------------------------ */
/* Presentation helpers shared by every surface (§17)                  */
/* ------------------------------------------------------------------ */

export const CLASSIFICATION_LABEL: Localized = {
  ko: '합성 데이터 (SYNTHETIC) · 데모 환경',
  en: 'SYNTHETIC data · demo environment',
};

export const SECURITY_LABEL: Localized = {
  ko: 'SIMULATED SECURITY — 서명 검증은 모의 구현',
  en: 'SIMULATED SECURITY — signature verification is mocked',
};

export const RECONCILIATION_LABEL: Record<Reconciliation, Localized> = {
  CONVERGED: { ko: '수렴 (Converged)', en: 'Converged' },
  PENDING: { ko: '대기 (Pending)', en: 'Pending' },
  GUARDED: { ko: 'Guard 차단 (Guarded)', en: 'Guarded' },
  REJECTED: { ko: '거부 (Rejected)', en: 'Rejected' },
  CRITICAL_DRIFT: { ko: '위험 불일치 (Critical Drift)', en: 'Critical drift' },
  UNKNOWN: { ko: '판단 불가 (Unknown)', en: 'Unknown' },
};

export const RECONCILIATION_ICON: Record<Reconciliation, string> = {
  CONVERGED: '●',
  PENDING: '◐',
  GUARDED: '⛔',
  REJECTED: '✕',
  CRITICAL_DRIFT: '▲',
  UNKNOWN: '?',
};

export const RECONCILIATION_TOKEN: Record<Reconciliation, string> = {
  CONVERGED: 'pass',
  PENDING: 'pending',
  GUARDED: 'info',
  REJECTED: 'fail',
  CRITICAL_DRIFT: 'fail',
  UNKNOWN: 'muted',
};

export const ELIGIBILITY_LABEL: Record<Eligibility, Localized> = {
  ELIGIBLE_POLICY_ONLY: { ko: 'Policy-only 활성화 가능', en: 'Eligible (policy-only)' },
  REQUIRES_BINARY_OTA: { ko: 'Binary OTA 선행 필요', en: 'Binary OTA required' },
  INCOMPATIBLE_HARDWARE: { ko: 'HW Capability 부족', en: 'Hardware incompatible' },
  INCOMPATIBLE_VARIANT: { ko: 'Variant Coding 불일치', en: 'Variant incompatible' },
  MISSING_ENTITLEMENT: { ko: 'Entitlement 없음', en: 'Entitlement missing' },
  STALE_TWIN: { ko: 'Twin 정보 오래됨', en: 'Twin stale' },
  BLOCKED_BY_SAFETY_RULE: { ko: 'Safety Rule 차단', en: 'Blocked by safety rule' },
  UNKNOWN: { ko: '판단 불가', en: 'Unknown' },
};

export const HEALTH_LABEL: Record<TwinHealth, Localized> = {
  HEALTHY: { ko: '정상 (Healthy)', en: 'Healthy' },
  DEGRADED: { ko: '저하 (Degraded)', en: 'Degraded' },
  STALE: { ko: '정보 오래됨 (Stale)', en: 'Stale' },
  OFFLINE: { ko: '오프라인 (Offline)', en: 'Offline' },
  DRIFTED: { ko: '불일치 (Drifted)', en: 'Drifted' },
  UNKNOWN: { ko: '알 수 없음 (Unknown)', en: 'Unknown' },
};

export const UNKNOWN_CAUSE_LABEL: Record<UnknownCause, Localized> = {
  TELEMETRY_TIMEOUT: { ko: 'Telemetry 타임아웃', en: 'Telemetry timeout' },
  TWIN_SNAPSHOT_MISSING: { ko: 'Twin 스냅샷 없음', en: 'Twin snapshot missing' },
  POLICY_VERSION_UNKNOWN: { ko: 'Policy Version 미확인', en: 'Policy version unknown' },
  VEHICLE_AGENT_VERSION_UNSUPPORTED: { ko: 'Vehicle Agent 버전 미지원', en: 'Vehicle agent version unsupported' },
  CONFIGURATION_MISMATCH: { ko: 'Configuration 불일치', en: 'Configuration mismatch' },
  SIGNAL_QUALITY_UNKNOWN: { ko: 'Signal 품질 미확인', en: 'Signal quality unknown' },
  BACKEND_PROCESSING_FAILURE: { ko: '백엔드 처리 실패', en: 'Backend processing failure' },
  CAUSE_ANALYSIS_REQUIRED: { ko: '원인 분석 필요', en: 'Cause analysis required' },
};

export const UNKNOWN_CAUSE_ACTION: Record<UnknownCause, Localized> = {
  TELEMETRY_TIMEOUT: {
    ko: '차량 텔레메트리 수집 주기와 게이트웨이 상태를 확인하고, 재수집 후 Twin을 갱신하세요.',
    en: 'Check telemetry cadence and gateway, then refresh the twin snapshot.',
  },
  TWIN_SNAPSHOT_MISSING: {
    ko: '해당 VIN의 EOL/배포 스냅샷을 재수집(Ingest) 한 뒤 재판정하세요.',
    en: 'Re-ingest the EOL/deployment snapshot for this VIN, then re-evaluate.',
  },
  POLICY_VERSION_UNKNOWN: {
    ko: 'Policy 배포 이력과 Vehicle Agent 수신 로그를 대조하세요.',
    en: 'Cross-check policy delivery history against vehicle agent receive logs.',
  },
  VEHICLE_AGENT_VERSION_UNSUPPORTED: {
    ko: 'Vehicle Agent SW를 지원 버전으로 OTA한 뒤 재시도하세요.',
    en: 'OTA the vehicle agent to a supported version and retry.',
  },
  CONFIGURATION_MISMATCH: {
    ko: 'As-Built와 As-Deployed 구성을 비교하고 Variant Coding을 확인하세요.',
    en: 'Compare as-built vs as-deployed configuration and verify variant coding.',
  },
  SIGNAL_QUALITY_UNKNOWN: {
    ko: '신호 품질(GOOD/UNCERTAIN/BAD)을 확보할 때까지 안전 판단을 보류하세요.',
    en: 'Hold safety decisions until signal quality is known.',
  },
  BACKEND_PROCESSING_FAILURE: {
    ko: 'Twin Reconciliation 파이프라인 실패 로그를 확인하고 재처리하세요.',
    en: 'Inspect the reconciliation pipeline failure and reprocess.',
  },
  CAUSE_ANALYSIS_REQUIRED: {
    ko: '자동 분류가 불가합니다. 운영자가 원인 분석을 수행해야 합니다.',
    en: 'Automatic classification failed; operator analysis required.',
  },
};

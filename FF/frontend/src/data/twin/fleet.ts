/**
 * Vehicle Digital Twin — synthetic demo fleet (§14).
 *
 * 30 deterministic VINs (`VIN-DEMO-001` … `VIN-DEMO-030`) that cover every
 * operational state the platform has to distinguish. Nothing here is real:
 * no production VIN, no customer data, no actuator command — every value is
 * generated in the browser from a fixed seed so the demo is reproducible.
 *
 * The fleet is the input of every twin surface (fleet overview, impact preview,
 * vehicle detail, convergence). The what-if simulator builds its own twin with
 * the same builders so a simulated vehicle is judged by the same engine.
 */

import * as T from './types';
import { deriveHealth, evaluateTwin, fnv, isoAt } from './engine';

export const DEMO_VIN_PREFIX = 'VIN-DEMO-';
export const DEMO_FLEET_SIZE = 30;

export const vinFor = (n: number): string => `${DEMO_VIN_PREFIX}${String(n).padStart(3, '0')}`;

const EV = 'EV Demo Model';
const HEV = 'HEV Demo Model';
const VARIANT_OK = T.VARIANT_OK;
const VARIANT_OLD = T.VARIANT_OLD;
const AGENT_OK = 'VA-4.2.0';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Spec {
  n: number;
  archetype: T.ArchetypeId;
  region: string;
  model: string;
  modelYear: number;
  trim: string;
  cohort: string;
  oneBinary: string;
  bms: string;
  entitlement: T.TwinEntitlement['status'];
  /** READY 인데 아직 대상에 포함되지 않은 차량 (Impact Preview 활성화 후보). */
  pending?: boolean;
  /** 오프라인 유지 시간(초). TTL(24h) 초과 시 Safe Default 로 넘어간다. */
  offlineSeconds?: number;
  /** 데모용 DTC — 모두 SIMULATED. */
  dtc?: string[];
}

/**
 * Deterministic fleet layout. Region / model / modelYear are deliberate: the
 * demo target rule is `KR · EV Demo Model · MY2027`, so the Impact Preview has
 * real exclusions to show instead of an all-green list.
 */
const SPECS: Spec[] = [
  { n: 1, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium Plus', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 2, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 3, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 4, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.3', bms: '3.2.1', entitlement: 'ACTIVE' },
  { n: 5, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', pending: true },
  { n: 6, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium Plus', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.3', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 7, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', pending: true },
  { n: 8, archetype: 'READY', region: 'KR', model: HEV, modelYear: 2027, trim: 'Base', cohort: 'wave-2-kr', oneBinary: 'OB-2.8.0', bms: '3.3.0', entitlement: 'ACTIVE' },
  { n: 9, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-3-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 10, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-3-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', pending: true },
  { n: 11, archetype: 'READY', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium Plus', cohort: 'wave-3-kr', oneBinary: 'OB-2.7.3', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 12, archetype: 'READY', region: 'KR', model: EV, modelYear: 2026, trim: 'Base', cohort: 'wave-4-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', pending: true },
  { n: 13, archetype: 'NEEDS_BINARY_OTA', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'pilot-kr', oneBinary: 'OB-2.6.4', bms: '3.1.4', entitlement: 'ACTIVE' },
  { n: 14, archetype: 'NEEDS_BINARY_OTA', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'pilot-kr', oneBinary: 'OB-2.6.4', bms: '3.1.4', entitlement: 'ACTIVE' },
  { n: 15, archetype: 'NEEDS_BINARY_OTA', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-4-kr', oneBinary: 'OB-2.7.0', bms: '3.1.9', entitlement: 'ACTIVE' },
  { n: 16, archetype: 'NEEDS_BINARY_OTA', region: 'EU', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'eu-wave-2', oneBinary: 'OB-2.6.4', bms: '3.1.4', entitlement: 'ACTIVE' },
  { n: 17, archetype: 'NO_HARDWARE', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'legacy-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 18, archetype: 'VARIANT_MISMATCH', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'legacy-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 19, archetype: 'NO_ENTITLEMENT', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'INACTIVE' },
  { n: 20, archetype: 'NO_ENTITLEMENT', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-3-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'INACTIVE' },
  { n: 21, archetype: 'NO_ENTITLEMENT', region: 'US', model: EV, modelYear: 2027, trim: 'Base', cohort: 'us-wave-1', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'INACTIVE' },
  { n: 22, archetype: 'STALE_CONTEXT', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 23, archetype: 'STALE_CONTEXT', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 24, archetype: 'OFFLINE', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', offlineSeconds: 3600 },
  { n: 25, archetype: 'OFFLINE', region: 'EU', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'eu-wave-2', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', offlineSeconds: 30 * 3600 },
  { n: 26, archetype: 'GUARD_BLOCK', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 27, archetype: 'GUARD_BLOCK', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-3-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 28, archetype: 'VERSION_CONFLICT', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE' },
  { n: 29, archetype: 'DRIFT', region: 'KR', model: EV, modelYear: 2027, trim: 'Base', cohort: 'wave-1-kr', oneBinary: 'OB-2.7.0', bms: '3.2.0', entitlement: 'ACTIVE', dtc: ['P0A7F-00'] },
  { n: 30, archetype: 'DRIFT', region: 'KR', model: EV, modelYear: 2027, trim: 'Premium Plus', cohort: 'wave-2-kr', oneBinary: 'OB-2.7.3', bms: '3.2.0', entitlement: 'ACTIVE', dtc: ['P0A7F-00', 'U0111-87'] },
];

export const FLEET_SPECS: ReadonlyArray<Spec> = SPECS;

/* ------------------------------------------------------------------ */
/* Context (signals)                                                    */
/* ------------------------------------------------------------------ */

const sample = (
  key: T.SignalKey,
  value: number | string,
  quality: T.SignalQuality,
  atMs: number,
  ttlOverride?: number,
): T.SignalSample => {
  const spec = T.SIGNAL_BY_KEY[key];
  return {
    value,
    unit: spec.unit,
    quality,
    observedAt: isoAt(atMs),
    ttlSeconds: ttlOverride ?? spec.ttlSeconds,
  };
};

/** Fresh, deterministic per-VIN signal snapshot. */
function freshContext(vin: string, nowMs: number): T.TwinContext {
  const h = fnv(vin);
  const soc = 58 + (h % 25);
  const batteryTemp = -6 + (h % 14);
  const ambient = -5 + ((h >> 3) % 12);
  const at = nowMs - (10 + (h % 20)) * 1000;
  return {
    BatterySoc: sample('BatterySoc', soc, 'GOOD', at),
    BatteryTemperature: sample('BatteryTemperature', batteryTemp, 'GOOD', at),
    AmbientTemperature: sample('AmbientTemperature', ambient, 'GOOD', at),
    ChargingSchedule: sample('ChargingSchedule', 'SCHEDULED', 'GOOD', at),
    ChargingConnectorState: sample('ChargingConnectorState', 'CONNECTED', 'GOOD', at),
    VehiclePowerMode: sample('VehiclePowerMode', 'READY', 'GOOD', at),
  };
}

/* ------------------------------------------------------------------ */
/* Twin builders                                                        */
/* ------------------------------------------------------------------ */

function identity(spec: Spec): T.TwinIdentity {
  return {
    vin: vinFor(spec.n),
    vehicleModel: spec.model,
    modelYear: spec.modelYear,
    region: spec.region,
    trim: spec.trim,
    vehicleConfigId: `VC-${spec.model === EV ? 'EV' : 'HEV'}-${spec.modelYear}-${spec.region}`,
    upgVc: spec.modelYear === 2027 ? 'UPG-VC-04' : 'UPG-VC-03',
  };
}

function featureInstance(spec: Spec, nowMs: number, overrides: Partial<T.FeatureInstance> = {}): T.FeatureInstance {
  return {
    featureId: T.FEATURE_ID,
    featureVersion: T.FEATURE_VERSION,
    entitlement: { entitlementId: T.FEATURE_REQUIREMENTS.entitlementId, status: spec.entitlement },
    policy: {
      policyId: T.DEMO_POLICY.policyId,
      policyVersion: T.DEMO_POLICY.policyVersion,
      policyHash: T.DEMO_POLICY.policyHash,
      signatureStatus: T.DEMO_POLICY.signatureStatus,
      cachedVersionSeq: T.DEMO_POLICY.policyVersionSeq,
      lastSyncedAt: isoAt(nowMs - 2 * HOUR),
    },
    desired: { state: 'OFF', requestedAt: isoAt(nowMs - 6 * HOUR) },
    reported: {
      state: 'NOT_RECEIVED',
      receivedPolicyVersion: null,
      reportedAt: null,
      guardResult: 'UNKNOWN',
    },
    effective: { state: 'OFF', reasonCode: 'CONVERGED', evaluatedAt: isoAt(nowMs - 6 * HOUR) },
    observed: { health: 'HEALTHY', lastTelemetryAt: isoAt(nowMs - 2 * MINUTE), dtcCodes: [] },
    ...overrides,
  };
}

function audit(spec: Spec, nowMs: number): T.TwinAuditEntry[] {
  const entries: T.TwinAuditEntry[] = [
    {
      at: isoAt(nowMs - 90 * DAY),
      actor: 'EOL 시스템 (SIMULATED)',
      action: { ko: 'As-Built 스냅샷 수신 — Twin 등록', en: 'As-built snapshot received — twin created' },
      detail: `${spec.oneBinary} · BMS ${spec.bms}`,
    },
  ];
  if (spec.archetype !== 'READY' && spec.archetype !== 'NEEDS_BINARY_OTA') {
    entries.push({
      at: isoAt(nowMs - 5 * HOUR),
      actor: 'Policy Engine (SIMULATED)',
      action: { ko: 'Canary 대상 선정 — Desired ON 배포', en: 'Canary targeting — desired ON delivered' },
      detail: `${T.DEMO_POLICY.policyVersion} · ${spec.cohort}`,
    });
  }
  if (spec.archetype === 'DRIFT') {
    entries.push({
      at: isoAt(nowMs - 40 * MINUTE),
      actor: '운영자 (P7)',
      action: { ko: 'Rollback 승인 — Desired OFF', en: 'Rollback approved — desired OFF' },
      detail: '안전 조건 재평가 실패',
    });
    entries.push({
      at: isoAt(nowMs - 12 * MINUTE),
      actor: 'Reconciliation Service',
      action: { ko: 'Critical Drift 감지 — Incident 연결', en: 'Critical drift detected — incident linked' },
      detail: 'Desired OFF / Effective ON',
    });
  }
  if (spec.archetype === 'VERSION_CONFLICT') {
    entries.push({
      at: isoAt(nowMs - 25 * MINUTE),
      actor: 'Vehicle Agent (SIMULATED)',
      action: { ko: 'Policy 거부 — Version 역전', en: 'Policy rejected — version reversal' },
      detail: 'received POL-0039 < applied POL-0042',
    });
  }
  if (spec.archetype === 'STALE_CONTEXT') {
    entries.push({
      at: isoAt(nowMs - 55 * MINUTE),
      actor: 'Local Guard (SIMULATED)',
      action: { ko: 'Effective 차단 — 신호 TTL 초과', en: 'Effective blocked — signal past TTL' },
      detail: 'Safe Default OFF 유지',
    });
  }
  if (spec.archetype === 'OFFLINE' && (spec.offlineSeconds ?? 0) > T.DEMO_POLICY.offlineTtlSeconds) {
    entries.push({
      at: isoAt(nowMs - spec.offlineSeconds! * 1000),
      actor: 'Vehicle Agent (SIMULATED)',
      action: { ko: '접속 종료 — 캐시 정책 TTL 만료', en: 'Disconnected — cached policy TTL expired' },
      detail: 'Safe Default OFF 적용',
    });
  }
  if (spec.archetype === 'VARIANT_MISMATCH') {
    entries.push({
      at: isoAt(nowMs - 3 * DAY),
      actor: 'Config 서비스 (SIMULATED)',
      action: { ko: 'Variant Coding 회귀 감지', en: 'Variant coding regression detected' },
      detail: `${VARIANT_OLD} ≠ ${VARIANT_OK}`,
    });
  }
  return entries.reverse();
}

function buildBase(spec: Spec, nowMs: number, vinOverride?: string): T.Twin {
  const vin = vinOverride ?? vinFor(spec.n);
  const offline = spec.archetype === 'OFFLINE';
  const lastSeenMs = offline ? nowMs - (spec.offlineSeconds ?? 3600) * 1000 : nowMs - 20 * 1000;
  const context = freshContext(vin, nowMs);
  if (offline) {
    // 접속이 끊긴 뒤에는 마지막으로 수신한 스냅샷이 남아 있다 (신선도는 link 가 표현).
    for (const key of Object.keys(context) as T.SignalKey[]) {
      context[key] = { ...context[key]!, observedAt: isoAt(lastSeenMs) };
    }
  }
  return {
    twinId: `TWIN-${vin}`,
    vin,
    twinVersion: 7 + (fnv(vin) % 40),
    dataClassification: 'SYNTHETIC',
    identity: identity(spec),
    asDesigned: {
      vehicleConfigVersion: VARIANT_OK,
      featureBomVersion: `BOM-${T.FEATURE_ID}-${T.FEATURE_VERSION}`,
      topologyVersion: T.TOPOLOGY_VERSION,
    },
    asBuilt: {
      eolSnapshotId: `EOL-${vin.replace('VIN-DEMO-', '')}-${spec.modelYear}`,
      hardwareCapabilities:
        spec.archetype === 'NO_HARDWARE'
          ? ['HEAT_PUMP', 'V2L', 'ISG']
          : ['BATTERY_HEATER', 'HEAT_PUMP', 'V2L', 'ISG'],
      variantCodingVersion: spec.archetype === 'VARIANT_MISMATCH' ? VARIANT_OLD : VARIANT_OK,
      recordedAt: isoAt(nowMs - 90 * DAY),
    },
    asDeployed: {
      oneBinaryVersion: spec.oneBinary,
      bmsSoftwareVersion: spec.bms,
      ecuSoftware: { BMS: spec.bms, VCU: '5.1.0', HVAC: '3.4.1', CGW: '1.8.2' },
      otaCampaignId: `OTA-CAMP-${spec.modelYear}-${spec.n % 3 === 0 ? 'B' : 'A'}`,
      installationStatus: 'INSTALLED',
      installedAt: isoAt(nowMs - 45 * DAY),
    },
    featureInstances: { [T.FEATURE_ID]: featureInstance(spec, nowMs) },
    context,
    link: {
      online: !offline,
      vehicleAgentVersion: AGENT_OK,
      lastSeenAt: isoAt(lastSeenMs),
      snapshotAt: isoAt(offline ? lastSeenMs : nowMs - 30 * 1000),
      archetype: spec.archetype,
      cohort: spec.cohort,
    },
    auditTrail: audit(spec, nowMs),
  };
}

/** Apply the archetype's device-side outcome on top of the neutral twin. */
function applyArchetype(twin: T.Twin, spec: Spec, nowMs: number): T.Twin {
  const fid = T.FEATURE_ID;
  const set = (patch: Partial<T.FeatureInstance>): void => {
    const cur = twin.featureInstances[fid]!;
    twin.featureInstances = { ...twin.featureInstances, [fid]: { ...cur, ...patch } };
  };
  const delivered = isoAt(nowMs - 45 * MINUTE);
  const reportedAt = isoAt(nowMs - 40 * MINUTE);

  const desiredOn = (): Partial<T.TwinDesired> => ({ state: 'ON', requestedAt: isoAt(nowMs - 90 * MINUTE) });
  const deliver = (): void =>
    set({
      policy: {
        ...twin.featureInstances[fid]!.policy,
        lastSyncedAt: isoAt(nowMs - 88 * MINUTE),
      },
    });

  switch (spec.archetype) {
    case 'READY': {
      if (spec.pending) {
        // 대상 후보지만 아직 활성화하지 않음: Desired OFF / 미수신 / OFF → 정상 수렴.
        set({
          desired: { state: 'OFF', requestedAt: isoAt(nowMs - 90 * MINUTE) },
          effective: { state: 'OFF', reasonCode: 'CONVERGED', evaluatedAt: isoAt(nowMs - 50 * MINUTE) },
        });
        break;
      }
      deliver();
      set({
        desired: desiredOn() as T.TwinDesired,
        reported: {
          state: 'ON',
          receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
          reportedAt: isoAt(nowMs - 30 * MINUTE),
          guardResult: 'PASS',
        },
        effective: { state: 'ON', reasonCode: 'POLICY_APPLIED_OK', evaluatedAt: isoAt(nowMs - 30 * MINUTE) },
      });
      break;
    }

    case 'NEEDS_BINARY_OTA':
    case 'NO_HARDWARE':
    case 'NO_ENTITLEMENT':
    case 'VARIANT_MISMATCH': {
      // 대상 조건 미충족 → 활성화하지 않음. 사유는 eligibility가 표현한다.
      set({ desired: { state: 'OFF', requestedAt: isoAt(nowMs - 90 * MINUTE) } });
      break;
    }

    case 'STALE_CONTEXT': {
      deliver();
      if (spec.n === 23) {
        // 배터리 온도는 신선하지만 신호 품질을 신뢰할 수 없는 경우.
        twin.context = {
          ...twin.context,
          AmbientTemperature: sample('AmbientTemperature', 3, 'UNKNOWN', nowMs - 30 * 1000),
        };
        set({
          desired: desiredOn() as T.TwinDesired,
          reported: {
            state: 'ON',
            receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
            reportedAt,
            guardResult: 'BLOCK',
            guardReason: 'SIGNAL_QUALITY_BAD',
          },
          effective: { state: 'BLOCKED', reasonCode: 'SIGNAL_QUALITY_BAD', evaluatedAt: delivered },
        });
        break;
      }
      twin.context = {
        ...twin.context,
        BatteryTemperature: sample('BatteryTemperature', 6, 'UNCERTAIN', nowMs - 14 * MINUTE),
      };
      set({
        desired: desiredOn() as T.TwinDesired,
        reported: {
          state: 'ON',
          receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
          reportedAt,
          guardResult: 'BLOCK',
          guardReason: 'BATTERY_TEMP_SIGNAL_STALE',
        },
        effective: { state: 'BLOCKED', reasonCode: 'BATTERY_TEMP_SIGNAL_STALE', evaluatedAt: delivered },
      });
      break;
    }

    case 'OFFLINE': {
      const expired = (spec.offlineSeconds ?? 0) > T.DEMO_POLICY.offlineTtlSeconds;
      if (expired) {
        set({
          desired: desiredOn() as T.TwinDesired,
          reported: { state: 'UNKNOWN', receivedPolicyVersion: null, reportedAt: null, guardResult: 'UNKNOWN' },
          effective: { state: 'UNKNOWN', reasonCode: 'OFFLINE_POLICY_TTL_EXPIRED', evaluatedAt: isoAt(nowMs - 6 * HOUR) },
        });
        break;
      }
      set({
        desired: desiredOn() as T.TwinDesired,
        reported: {
          state: 'ON',
          receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
          reportedAt: isoAt(nowMs - (spec.offlineSeconds ?? 3600) * 1000 - 5 * MINUTE),
          guardResult: 'PASS',
        },
        effective: {
          state: 'ON',
          reasonCode: 'OFFLINE_POLICY_CACHE_VALID',
          evaluatedAt: isoAt(nowMs - (spec.offlineSeconds ?? 3600) * 1000),
        },
      });
      break;
    }

    case 'GUARD_BLOCK': {
      deliver();
      if (spec.n === 26) {
        twin.context = {
          ...twin.context,
          BatterySoc: sample('BatterySoc', 12, 'GOOD', nowMs - 15 * 1000),
        };
      } else {
        twin.context = {
          ...twin.context,
          VehiclePowerMode: sample('VehiclePowerMode', 'OFF', 'GOOD', nowMs - 15 * 1000),
        };
      }
      set({
        desired: desiredOn() as T.TwinDesired,
        reported: {
          state: 'ON',
          receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
          reportedAt,
          guardResult: 'BLOCK',
          guardReason: spec.n === 26 ? 'SOC_BELOW_THRESHOLD' : 'POWER_MODE_NOT_READY',
        },
        effective: {
          state: 'BLOCKED',
          reasonCode: spec.n === 26 ? 'SOC_BELOW_THRESHOLD' : 'POWER_MODE_NOT_READY',
          evaluatedAt: delivered,
        },
      });
      break;
    }

    case 'VERSION_CONFLICT': {
      // 이미 POL-0042가 적용된 차량에 더 낮은 POL-0039가 재전송되어 차량이 거부.
      set({
        desired: desiredOn() as T.TwinDesired,
        reported: {
          state: 'REJECTED',
          receivedPolicyVersion: T.REVOKED_POLICY.policyVersion,
          reportedAt,
          guardResult: 'UNKNOWN',
        },
        effective: { state: 'OFF', reasonCode: 'POLICY_VERSION_OUTDATED', evaluatedAt: reportedAt },
      });
      break;
    }

    case 'DRIFT': {
      // Rollback(Desired OFF)은 승인됐지만 차량 ack가 유실되어 Effective는 여전히 ON.
      set({
        desired: { state: 'OFF', requestedAt: isoAt(nowMs - 40 * MINUTE) },
        reported: {
          state: 'ON',
          receivedPolicyVersion: T.DEMO_POLICY.policyVersion,
          reportedAt,
          guardResult: 'PASS',
        },
        effective: { state: 'ON', reasonCode: 'EFFECTIVE_DRIFT_DETECTED', evaluatedAt: isoAt(nowMs - 12 * MINUTE) },
        observed: {
          health: 'DRIFTED',
          lastTelemetryAt: isoAt(nowMs - 60 * 1000),
          dtcCodes: spec.dtc ?? [],
        },
      });
      break;
    }
  }

  const inst2 = twin.featureInstances[fid]!;
  twin.featureInstances = {
    [fid]: {
      ...inst2,
      observed: { ...inst2.observed, lastTelemetryAt: twin.link.snapshotAt },
    },
  };
  return twin;
}

/** Finalize health from the shared evaluator so the model never contradicts the verdict. */
export function withHealth(twin: T.Twin, nowMs: number): T.Twin {
  const verdict = evaluateTwin(twin, { nowMs });
  const inst = twin.featureInstances[T.FEATURE_ID]!;
  return {
    ...twin,
    featureInstances: {
      ...twin.featureInstances,
      [T.FEATURE_ID]: {
        ...inst,
        observed: {
          ...inst.observed,
          health: deriveHealth(twin, verdict.reconciliation.result, nowMs),
        },
      },
    },
  };
}

/** The complete demo fleet, evaluated against `nowMs`. */
export function buildDemoFleet(nowMs: number): T.Twin[] {
  return SPECS.map((spec) => withHealth(applyArchetype(buildBase(spec, nowMs), spec, nowMs), nowMs));
}

/** Cohort / region option lists for the target-rule editor. */
export function fleetCohorts(twins: T.Twin[]): string[] {
  return Array.from(new Set(twins.map((t) => t.link.cohort))).sort();
}

/* ------------------------------------------------------------------ */
/* On-demand twin for a VIN that is not in the demo fleet               */
/* ------------------------------------------------------------------ */

const DERIVED_ARCHETYPES: T.ArchetypeId[] = [
  'READY',
  'READY',
  'NEEDS_BINARY_OTA',
  'NO_HARDWARE',
  'NO_ENTITLEMENT',
  'STALE_CONTEXT',
  'OFFLINE',
  'GUARD_BLOCK',
  'VERSION_CONFLICT',
  'DRIFT',
];

export const DERIVED_NOTE: T.Localized = {
  ko: '등록된 As-Built 정보가 없는 VIN이라 결정적(seed 기반) 가상 Twin을 생성했습니다. 실제 차량 데이터가 아닙니다.',
  en: 'No as-built record exists for this VIN, so a deterministic seeded twin was derived. This is not real vehicle data.',
};

/**
 * Deterministically derivable twin for an arbitrary VIN so that a deep link to
 * an unknown vehicle still renders a consistent, clearly-labelled twin.
 */
export function buildDerivedTwin(vin: string, nowMs: number): T.Twin {
  const h = fnv(vin);
  const archetype = DERIVED_ARCHETYPES[h % DERIVED_ARCHETYPES.length]!;
  const spec: Spec = {
    n: (h % 900) + 100,
    archetype,
    region: 'KR',
    model: EV,
    modelYear: 2027,
    trim: 'Base',
    cohort: 'derived-kr',
    oneBinary: archetype === 'NEEDS_BINARY_OTA' ? 'OB-2.6.4' : 'OB-2.7.0',
    bms: archetype === 'NEEDS_BINARY_OTA' ? '3.1.4' : '3.2.0',
    entitlement: archetype === 'NO_ENTITLEMENT' ? 'INACTIVE' : 'ACTIVE',
    offlineSeconds: archetype === 'OFFLINE' ? 3600 : undefined,
    dtc: archetype === 'DRIFT' ? ['P0A7F-00'] : undefined,
  };
  const twin = withHealth(applyArchetype(buildBase(spec, nowMs, vin), spec, nowMs), nowMs);
  return {
    ...twin,
    link: { ...twin.link, syntheticDerived: true },
    auditTrail: [
      {
        at: isoAt(nowMs),
        actor: 'Digital Twin Adapter (SIMULATED)',
        action: { ko: '미등록 VIN — 가상 Twin 파생 생성', en: 'Unregistered VIN — derived twin generated' },
        detail: `seed=${h}`,
      },
      ...twin.auditTrail,
    ],
  };
}

// 구현 Artifact · 제어점 레지스트리 (운영 데이터 계층)
//
// 기준 정본
//  · FP_SW_Detailed_Design v4.6 · MODEL Artifact  — id, artifactId, version, artifactKind, resolution,
//    contentDigest(SHA256 64자리), sourceRef(원천·객체·버전 고정), delivery, deploymentContent
//  · FP_SW_Detailed_Design v4.6 · MODEL ControlPoint — id, kind, role, valueType, unit, allowedRange,
//    accessMode, bindingRef(정확 버전), guardRef(쓰기 시 필수), flagClass
//  · MODEL ImplementationBOM — Feature 버전별 구현 구성 (version·featureRef·artifactRefs·items·sourceProfile)
//  · MODEL FlagBinding / RuntimeBinding — FeatureVersion→ControlPoint→FlagBinding→RuntimeBinding 연결
//  · BD-06 — 같은 제어점·같은 적용 조건에서 선택되는 Binding 은 정확히 하나여야 한다 (위반 = CONFIG_CONFLICT)
//  · UL-009 — Flag 목적 6종 (release experiment operational kill-switch permission sunset) + 수명·검토기한·소유자
//
// 이 모듈은 화면에 보여줄 설명문이 아니라 계산 가능한 레코드다. 위반·차단 건수는 필드에서 계산한다.
import { sha256Hex } from './sha256';

export type ArtifactKind = 'HW' | 'SW' | 'Signal' | 'DTC' | 'UIAsset' | 'Requirement' | 'ECU' | 'APIService' | 'TestCase' | 'DeploymentUnit' | 'VariantRule';
export type Resolution = 'RESOLVED' | 'UNRESOLVED';
export type Delivery = 'PHYSICAL_INSTALL' | 'OTA' | 'REFERENCE_ONLY';
export type SourceSystem = 'ALM' | 'PLM' | 'Git' | 'CI' | 'BOM';
export type FlagPurpose = 'release' | 'experiment' | 'operational' | 'kill-switch' | 'permission' | 'sunset';
export type ControlPointKind = 'FLAG' | 'PARAMETER' | 'SIGNAL' | 'DTC' | 'API';
export type ControlRole = 'EVALUATE' | 'WRITE_REQUEST' | 'OBSERVE';
export type ValueType = 'Boolean' | 'Number' | 'Enum' | 'Object';
export type AccessMode = 'READ_ONLY' | 'WRITE_GATED';

export interface SourceRef { system: SourceSystem; object: string; version: string }

export interface ArtifactRecord {
  id: string;
  /** 두 Feature 가 같은 Artifact 를 재사용할 수 있으므로 물리 id 와 참조 id 를 분리한다. */
  artifactId: string;
  /** latest·범위 표현 금지 — 정확 버전만 둔다. */
  version: string;
  artifactKind: ArtifactKind;
  resolution: Resolution;
  contentDigest: string;
  sourceRef: SourceRef;
  delivery: Delivery;
  deploymentContent: boolean;
  name: string;
  /** Feature 버전 참조 (FeatureVersion) */
  featureVersionRef: string;
}

export interface FlagClassRef {
  purpose: FlagPurpose;
  lifetimeDays: number;
  reviewDueAt: string;
  ownerRef: string;
}

export interface ControlPointRecord {
  id: string;
  kind: ControlPointKind;
  role: ControlRole;
  valueType: ValueType;
  unit?: string;
  allowedRange?: [number, number];
  accessMode: AccessMode;
  /** node API Port 의 정확 버전 */
  bindingRef: string;
  /** 쓰기 요청 시 필수 — 현재 차량 상태·권리·서명·TTL 확인 */
  guardRef?: string;
  flagClass?: FlagClassRef;
  featureVersionRef: string;
  observedValue: string | number | boolean;
}

export interface BindingBase {
  id: string;
  featureVersionRef: string;
  controlPointRef: string;
  /** 적용 조건 식별자 — 같은 제어점·같은 조건에서 하나만 선택되어야 한다 */
  applicabilityRef: string;
}

export interface FlagBindingRecord extends BindingBase {
  flagVersionRef: string;
  toolBindingRef: string;
  /** 도구 metadata profile 에서 온 값인지(승격 금지 대상) */
  toolDefaultLifetimeDays: number;
}

export interface RuntimeBindingRecord extends BindingBase {
  flagBindingRef: string;
  bomRef: string;
  topologyRef: string;
}

export interface BindingViolation {
  code: 'CONFIG_CONFLICT' | 'GUARD_REF_MISSING' | 'OBSERVE_WRITE_GRANT' | 'RANGE_MISMATCH' | 'UNRESOLVED_ARTIFACT' | 'HW_OTA_DELIVERY' | 'IMPLEMENTATION_ITEM_DRIFT' | 'DIGEST_INVALID' | 'FOCUS_FIELD_SHORTCUT'
  | 'FEATURE_MASTER_NOT_APPLICABLE' | 'MISSING_AREA_EVIDENCE' | 'DUPLICATE_BOM_ITEM' | 'IMPL_BOM_UNKNOWN';
  target: string;
  detail: string;
  /** 승인·발행을 막는 위반인지 */
  blocking: boolean;
}

// ── 원천 시스템 동기화 상태 (운영 화면 상단 상태줄이 쓰는 값) ──
export const SOURCE_SYNC: { system: SourceSystem; detail: string; at: string; state: 'OK' | 'STALE' }[] = [
  { system: 'ALM', detail: '요구사항·결함 412건', at: '2026-09-13 09:41', state: 'OK' },
  { system: 'PLM', detail: '부품·ECU 구성 128건', at: '2026-09-13 09:12', state: 'OK' },
  { system: 'Git', detail: 'adapter @8f2c1a4 · runtime @2d90be1', at: '2026-09-13 10:02', state: 'OK' },
  { system: 'CI', detail: 'build-2291 · HIL 42/42', at: '2026-09-13 08:58', state: 'STALE' },
];

const FEATURE_VERSION = 'FEAT-BDC-001@1.1.0';

// ── 구현 Artifact (11종 kind 포함) ──
// content 는 원천 산출물의 정규화된 내용 요약이며, digest 는 이 내용에서 실제로 계산한다.
interface ArtifactSeed extends Omit<ArtifactRecord, 'contentDigest'> { content: string }

const ARTIFACT_SEEDS: ArtifactSeed[] = [
  {
    id: 'ART-SYS-BODY-001', artifactId: 'AID-1001', version: '3.2.0', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'RMS-4471', version: '3.2' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'System Requirement — BDC Policy Control',
    featureVersionRef: FEATURE_VERSION, content: 'SYS-BODY-001|BDC policy control|v3.2|acc:7',
  },
  {
    id: 'ART-SWE-BDC-010', artifactId: 'AID-1010', version: '1.4.2', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'SWE-2210', version: '1.4' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'SW Requirement — Policy adapter',
    featureVersionRef: FEATURE_VERSION, content: 'SWE-BDC-010|policy adapter|v1.4.2|acc:9',
  },
  {
    id: 'ART-SWC-BDC-ADAPTER', artifactId: 'AID-1100', version: '2.7.0', artifactKind: 'SW',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/bdc-adapter', version: '8f2c1a4' },
    delivery: 'OTA', deploymentContent: true, name: 'BDC Adapter SW Component',
    featureVersionRef: FEATURE_VERSION, content: 'SWC-BDC-ADAPTER|2.7.0|8f2c1a4|iface:5',
  },
  {
    id: 'ART-ECU-BDC', artifactId: 'AID-1200', version: 'B', artifactKind: 'ECU',
    resolution: 'RESOLVED', sourceRef: { system: 'PLM', object: 'PLM-88213', version: 'B' },
    delivery: 'PHYSICAL_INSTALL', deploymentContent: false, name: 'BDC ECU (HW 교체 필요)',
    featureVersionRef: FEATURE_VERSION, content: 'ECU-BDC|HW rev B|PLM-88213|cyl:4',
  },
  {
    id: 'ART-HW-BDC-SENSOR', artifactId: 'AID-1250', version: 'C.1', artifactKind: 'HW',
    resolution: 'RESOLVED', sourceRef: { system: 'PLM', object: 'PLM-90117', version: 'C.1' },
    delivery: 'PHYSICAL_INSTALL', deploymentContent: false, name: 'Door lock sensor harness',
    featureVersionRef: FEATURE_VERSION, content: 'HW-BDC-SENSOR|rev C.1|PLM-90117|pin:6',
  },
  {
    id: 'ART-API-BDC-POLICY-CONTROL', artifactId: 'AID-1300', version: '1.5.0', artifactKind: 'APIService',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/policy-api', version: '1.5.0' },
    delivery: 'OTA', deploymentContent: true, name: 'BDC Policy API v1.5',
    featureVersionRef: FEATURE_VERSION, content: 'API-BDC-POLICY-CONTROL|1.5.0|openapi:12',
  },
  {
    id: 'ART-SIG-DOOR-LOCK', artifactId: 'AID-1400', version: 'DBC-2027.1', artifactKind: 'Signal',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/can-dbc', version: 'DBC-2027.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'Signal — DoorLockState',
    featureVersionRef: FEATURE_VERSION, content: 'SIG-DOOR-LOCK|0x2A1|16bit|DBC-2027.1',
  },
  {
    id: 'ART-DTC-BDC-POLICY-FAIL', artifactId: 'AID-1410', version: '2.0', artifactKind: 'DTC',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'DTC-7712', version: '2.0' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'DTC — Policy apply failure',
    featureVersionRef: FEATURE_VERSION, content: 'DTC-BDC-POLICY-FAIL|0x7712|recovery:12',
  },
  {
    id: 'ART-VAR-BDC-001', artifactId: 'AID-1500', version: '2027.1', artifactKind: 'VariantRule',
    resolution: 'RESOLVED', sourceRef: { system: 'PLM', object: 'PLM-77220', version: '2027.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'Variant rule — KR/EU · MY2027+ · Premium',
    featureVersionRef: FEATURE_VERSION, content: 'VAR-BDC-001|KR,EU|MY2027+|Premium|Gen3',
  },
  {
    id: 'ART-DEP-BDC-001', artifactId: 'AID-1600', version: '1.1.0', artifactKind: 'DeploymentUnit',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'build-2291', version: 'build-2291' },
    delivery: 'OTA', deploymentContent: true, name: 'Policy package (배포 콘텐츠)',
    featureVersionRef: FEATURE_VERSION, content: 'DEP-BDC-001|1.1.0|build-2291|targets:30',
  },
  {
    id: 'ART-HIL-BDC-001', artifactId: 'AID-1700', version: '1.3', artifactKind: 'TestCase',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'hil-suite-11', version: '1.3' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'HIL test — policy transition',
    featureVersionRef: FEATURE_VERSION, content: 'HIL-BDC-001|1.3|42 cases|pass:42',
  },
  {
    id: 'ART-UIA-BDC-SETTING', artifactId: 'AID-1800', version: '1.0.4', artifactKind: 'UIAsset',
    resolution: 'UNRESOLVED', sourceRef: { system: 'Git', object: 'mutuus/hmi-assets', version: '—' },
    delivery: 'OTA', deploymentContent: true, name: 'HMI 설정 화면 asset (원천 버전 미고정)',
    featureVersionRef: FEATURE_VERSION, content: 'UIA-BDC-SETTING|unversioned|pending-source',
  },
  {
    id: 'ART-SUP-BDC-A', artifactId: 'AID-1900', version: '1.0.0', artifactKind: 'SW',
    resolution: 'UNRESOLVED', sourceRef: { system: 'ALM', object: 'SUP-A-032', version: '—' },
    delivery: 'OTA', deploymentContent: true, name: 'Supplier A function (BDC_FUNC_032) 원천 미해석',
    featureVersionRef: FEATURE_VERSION, content: 'SUP-BDC-A|BDC_FUNC_032|trace:missing',
  },
  // ── FEAT-LIGHT-001@2.0.0 (Welcome Light Choreography) 구현 Artifact ──
  {
    id: 'ART-SWC-LIGHT-CTRL', artifactId: 'AID-2010', version: '2.0.0', artifactKind: 'SW',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/light-ctrl', version: 'c41d9a2' },
    delivery: 'OTA', deploymentContent: true, name: 'Welcome Light Choreography controller',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'SWC-LIGHT-CTRL|2.0.0|c41d9a2|seq:24',
  },
  {
    id: 'ART-API-LIGHT-SERVICE', artifactId: 'AID-2020', version: '1.2.0', artifactKind: 'APIService',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/light-api', version: '1.2.0' },
    delivery: 'OTA', deploymentContent: true, name: 'Lighting choreography API v1.2',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'API-LIGHT-SERVICE|1.2.0|openapi:9',
  },
  {
    id: 'ART-VAR-LIGHT-001', artifactId: 'AID-2030', version: '2027.1', artifactKind: 'VariantRule',
    resolution: 'RESOLVED', sourceRef: { system: 'PLM', object: 'PLM-77331', version: '2027.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'Variant rule — KR/EU · Premium 트림',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'VAR-LIGHT-001|KR,EU|MY2027+|Premium',
  },
  // ── FEAT-ADAS-001@2.4.0 (Longitudinal Assist) 구현 Artifact ──
  {
    id: 'ART-SWC-ADAS-LONG', artifactId: 'AID-2100', version: '3.0.1', artifactKind: 'SW',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/adas-long', version: '9ab77e0' },
    delivery: 'OTA', deploymentContent: true, name: 'Longitudinal assist SWC',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'SWC-ADAS-LONG|3.0.1|9ab77e0|asil:B',
  },
  {
    id: 'ART-HIL-ADAS-LONG', artifactId: 'AID-2110', version: '2.1', artifactKind: 'TestCase',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'hil-adas-07', version: '2.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'HIL test — longitudinal ramp',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'HIL-ADAS-LONG|2.1|58 cases|pass:57',
  },
  {
    id: 'ART-SWE-LIGHT-001', artifactId: 'AID-2000', version: '1.0.0', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'SWE-LIGHT-001', version: '1.0' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'SW Requirement — Lighting sequence',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'SWE-LIGHT-001|lighting sequence|v1.0.0',
  },
  {
    id: 'ART-DEP-LIGHT-001', artifactId: 'AID-2040', version: '2.0.0', artifactKind: 'DeploymentUnit',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'build-2290', version: 'build-2290' },
    delivery: 'OTA', deploymentContent: true, name: 'Lighting policy package',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'DEP-LIGHT-001|2.0.0|build-2290|targets:18',
  },
  {
    id: 'ART-HIL-LIGHT-001', artifactId: 'AID-2050', version: '1.0', artifactKind: 'TestCase',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'hil-light-03', version: '1.0' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'HIL test — choreography sequence',
    featureVersionRef: 'FEAT-LIGHT-001@2.0.0', content: 'HIL-LIGHT-001|1.0|24 cases|pass:24',
  },
  {
    id: 'ART-SWE-ADAS-001', artifactId: 'AID-2090', version: '2.4.0', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'SWE-ADAS-001', version: '2.4' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'SW Requirement — Longitudinal control',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'SWE-ADAS-001|longitudinal control|v2.4.0',
  },
  {
    id: 'ART-API-ADAS-TARGET', artifactId: 'AID-2120', version: '2.0.0', artifactKind: 'APIService',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/adas-api', version: '2.0.0' },
    delivery: 'OTA', deploymentContent: true, name: 'Target object API v2.0',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'API-ADAS-TARGET|2.0.0|openapi:14',
  },
  {
    id: 'ART-VAR-ADAS-001', artifactId: 'AID-2130', version: '2027.1', artifactKind: 'VariantRule',
    resolution: 'RESOLVED', sourceRef: { system: 'PLM', object: 'PLM-77410', version: '2027.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'Variant rule — KR · ASIL B 트림',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'VAR-ADAS-001|KR|MY2027+|ASILB',
  },
  {
    id: 'ART-DEP-ADAS-001', artifactId: 'AID-2140', version: '2.0.0', artifactKind: 'DeploymentUnit',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'build-2288', version: 'build-2288' },
    delivery: 'OTA', deploymentContent: true, name: 'ADAS longitudinal package',
    featureVersionRef: 'FEAT-ADAS-001@2.4.0', content: 'DEP-ADAS-001|2.0.0|build-2288|targets:12',
  },
  // ── FEAT-BDC-001@1.0.0 직전 승인 버전의 구현 Artifact (이전 기준선 비교 대상) ──
  {
    id: 'ART-SYS-BODY-001', artifactId: 'AID-1001', version: '3.1.0', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'RMS-4471', version: '3.1' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'System Requirement — BDC Policy Control (이전 개정)',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'SYS-BODY-001|BDC policy control|v3.1|acc:6',
  },
  {
    id: 'ART-SWE-BDC-010', artifactId: 'AID-1010', version: '1.3.0', artifactKind: 'Requirement',
    resolution: 'RESOLVED', sourceRef: { system: 'ALM', object: 'SWE-2210', version: '1.3' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'SW Requirement — Policy adapter (이전 개정)',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'SWE-BDC-010|policy adapter|v1.3.0|acc:8',
  },
  {
    id: 'ART-SWC-BDC-ADAPTER', artifactId: 'AID-1100', version: '2.6.0', artifactKind: 'SW',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/bdc-adapter', version: '4e19b73' },
    delivery: 'OTA', deploymentContent: true, name: 'BDC Adapter SW Component (이전 릴리스)',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'SWC-BDC-ADAPTER|2.6.0|4e19b73|iface:4',
  },
  {
    id: 'ART-API-BDC-POLICY-CONTROL', artifactId: 'AID-1300', version: '1.4.0', artifactKind: 'APIService',
    resolution: 'RESOLVED', sourceRef: { system: 'Git', object: 'mutuus/policy-api', version: '1.4.0' },
    delivery: 'OTA', deploymentContent: true, name: 'BDC Policy API v1.4',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'API-BDC-POLICY-CONTROL|1.4.0|openapi:11',
  },
  {
    id: 'ART-DEP-BDC-001', artifactId: 'AID-1600', version: '1.0.0', artifactKind: 'DeploymentUnit',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'build-2274', version: 'build-2274' },
    delivery: 'OTA', deploymentContent: true, name: 'Policy package (이전 배포 콘텐츠)',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'DEP-BDC-001|1.0.0|build-2274|targets:28',
  },
  {
    id: 'ART-HIL-BDC-001', artifactId: 'AID-1700', version: '1.2', artifactKind: 'TestCase',
    resolution: 'RESOLVED', sourceRef: { system: 'CI', object: 'hil-suite-11', version: '1.2' },
    delivery: 'REFERENCE_ONLY', deploymentContent: false, name: 'HIL test — policy transition (이전 회차)',
    featureVersionRef: 'FEAT-BDC-001@1.0.0', content: 'HIL-BDC-001|1.2|38 cases|pass:38',
  },
];

export const ARTIFACT_RECORDS: ArtifactRecord[] = ARTIFACT_SEEDS.map(({ content, ...a }) => ({
  ...a,
  contentDigest: sha256Hex(content),
}));

// ── ControlPoint 5종 ──
export const CONTROL_POINTS: ControlPointRecord[] = [
  {
    id: 'CP-BDC-001-FLAG-ENABLE', kind: 'FLAG', role: 'WRITE_REQUEST', valueType: 'Boolean', accessMode: 'WRITE_GATED',
    bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0', guardRef: 'GD-BDC-001@2.1', featureVersionRef: FEATURE_VERSION,
    flagClass: { purpose: 'release', lifetimeDays: 180, reviewDueAt: '2027-03-12', ownerRef: 'ROLE:operator@body' },
    observedValue: false,
  },
  {
    id: 'CP-BDC-001-FLAG-KILL', kind: 'FLAG', role: 'WRITE_REQUEST', valueType: 'Boolean', accessMode: 'WRITE_GATED',
    bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0', guardRef: 'GD-KILL-001@3.0', featureVersionRef: FEATURE_VERSION,
    flagClass: { purpose: 'kill-switch', lifetimeDays: 0, reviewDueAt: '2026-10-13', ownerRef: 'ROLE:operator@body' },
    observedValue: false,
  },
  {
    id: 'CP-BDC-001-FLAG-EXPERIMENT', kind: 'FLAG', role: 'EVALUATE', valueType: 'Enum', accessMode: 'READ_ONLY',
    bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0', featureVersionRef: FEATURE_VERSION,
    flagClass: { purpose: 'experiment', lifetimeDays: 60, reviewDueAt: '2026-11-12', ownerRef: 'ROLE:quality@body' },
    observedValue: 'COHORT_A',
  },
  {
    id: 'CP-BDC-001-SUNSET', kind: 'FLAG', role: 'EVALUATE', valueType: 'Boolean', accessMode: 'READ_ONLY',
    bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0', featureVersionRef: FEATURE_VERSION,
    flagClass: { purpose: 'sunset', lifetimeDays: 30, reviewDueAt: '2026-10-13', ownerRef: 'ROLE:steward@body' },
    observedValue: false,
  },
  {
    id: 'CP-BDC-001-PARAM-TEMP', kind: 'PARAMETER', role: 'WRITE_REQUEST', valueType: 'Number', unit: '°C',
    allowedRange: [-20, 60], accessMode: 'WRITE_GATED', bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0',
    guardRef: 'GD-BDC-001@2.1', featureVersionRef: FEATURE_VERSION, observedValue: 21.5,
  },
  {
    id: 'CP-BDC-001-PARAM-TIMEOUT', kind: 'PARAMETER', role: 'WRITE_REQUEST', valueType: 'Number', unit: 'ms',
    allowedRange: [200, 5000], accessMode: 'WRITE_GATED', bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0',
    featureVersionRef: FEATURE_VERSION, observedValue: 1500,
  },
  {
    id: 'CP-BDC-001-SIG-LOCK', kind: 'SIGNAL', role: 'OBSERVE', valueType: 'Boolean', accessMode: 'READ_ONLY',
    bindingRef: 'SIG-DOOR-LOCK@DBC-2027.1', featureVersionRef: FEATURE_VERSION, observedValue: true,
  },
  {
    id: 'CP-BDC-001-DTC-FAIL', kind: 'DTC', role: 'OBSERVE', valueType: 'Object', accessMode: 'READ_ONLY',
    bindingRef: 'DTC-BDC-POLICY-FAIL@2.0', featureVersionRef: FEATURE_VERSION, observedValue: 'NO_FAULT',
  },
  {
    id: 'CP-BDC-001-API-VERSION', kind: 'API', role: 'OBSERVE', valueType: 'Object', accessMode: 'READ_ONLY',
    bindingRef: 'API-BDC-POLICY-CONTROL@1.5.0', featureVersionRef: FEATURE_VERSION, observedValue: '1.5.0',
  },
  // ── FEAT-LIGHT-001@2.0.0 제어점 ──
  {
    id: 'CP-LIGHT-001-FLAG-ON', kind: 'FLAG', role: 'WRITE_REQUEST', valueType: 'Boolean', accessMode: 'WRITE_GATED',
    bindingRef: 'API-LIGHT-SERVICE@1.2.0', guardRef: 'GD-LIGHT-001@1.0', featureVersionRef: 'FEAT-LIGHT-001@2.0.0',
    flagClass: { purpose: 'release', lifetimeDays: 365, reviewDueAt: '2027-09-13', ownerRef: 'ROLE:operator@body' },
    observedValue: true,
  },
  {
    id: 'CP-LIGHT-001-SIG-STATE', kind: 'SIGNAL', role: 'OBSERVE', valueType: 'Boolean', accessMode: 'READ_ONLY',
    bindingRef: 'SIG-LIGHT-STATE@DBC-2027.1', featureVersionRef: 'FEAT-LIGHT-001@2.0.0', observedValue: true,
  },
  // ── FEAT-ADAS-001@2.4.0 제어점 ──
  {
    id: 'CP-ADAS-001-FLAG-ENABLE', kind: 'FLAG', role: 'WRITE_REQUEST', valueType: 'Boolean', accessMode: 'WRITE_GATED',
    bindingRef: 'API-ADAS-TARGET@2.0.0', guardRef: 'GD-ADAS-001@1.0', featureVersionRef: 'FEAT-ADAS-001@2.4.0',
    flagClass: { purpose: 'release', lifetimeDays: 180, reviewDueAt: '2027-03-13', ownerRef: 'ROLE:operator@body' },
    observedValue: false,
  },
  {
    id: 'CP-ADAS-001-PARAM-GAIN', kind: 'PARAMETER', role: 'WRITE_REQUEST', valueType: 'Number', unit: '%',
    allowedRange: [0, 100], accessMode: 'WRITE_GATED', bindingRef: 'API-ADAS-TARGET@2.0.0',
    guardRef: 'GD-ADAS-001@1.0', featureVersionRef: 'FEAT-ADAS-001@2.4.0', observedValue: 62,
  },
  {
    id: 'CP-ADAS-001-DTC-FAIL', kind: 'DTC', role: 'OBSERVE', valueType: 'Object', accessMode: 'READ_ONLY',
    bindingRef: 'DTC-ADAS-LONG-FAIL@1.4', featureVersionRef: 'FEAT-ADAS-001@2.4.0', observedValue: 'U0100',
  },
];

// ── FlagBinding / RuntimeBinding (BD-06 검증 대상) ──
export const FLAG_BINDINGS: FlagBindingRecord[] = [
  { id: 'FB-BDC-001', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-FLAG-ENABLE', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagVersionRef: 'FLAG-BDC-ENABLE@4', toolBindingRef: 'TOOL-RELEASE@2', toolDefaultLifetimeDays: 90 },
  { id: 'FB-BDC-002', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-FLAG-KILL', applicabilityRef: 'APL-ALL', flagVersionRef: 'FLAG-BDC-KILL@2', toolBindingRef: 'TOOL-KILL@1', toolDefaultLifetimeDays: 0 },
  { id: 'FB-BDC-003', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-FLAG-EXPERIMENT', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagVersionRef: 'FLAG-BDC-EXP@1', toolBindingRef: 'TOOL-EXP@3', toolDefaultLifetimeDays: 30 },
  { id: 'FB-BDC-004', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-SUNSET', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagVersionRef: 'FLAG-BDC-SUNSET@1', toolBindingRef: 'TOOL-RELEASE@2', toolDefaultLifetimeDays: 90 },
  // 동일 ControlPoint·동일 적용 조건에서 두 번째 Binding — BD-06 위반
  { id: 'FB-BDC-005', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-FLAG-ENABLE', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagVersionRef: 'FLAG-BDC-ENABLE@3', toolBindingRef: 'TOOL-RELEASE@1', toolDefaultLifetimeDays: 90 },
  { id: 'FB-BDC-006', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-FLAG-KILL', applicabilityRef: 'APL-EU-BASE', flagVersionRef: 'FLAG-BDC-KILL@2', toolBindingRef: 'TOOL-KILL@1', toolDefaultLifetimeDays: 0 },
];

export const RUNTIME_BINDINGS: RuntimeBindingRecord[] = [
  { id: 'RB-BDC-001', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-SIG-LOCK', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagBindingRef: 'FB-BDC-002', bomRef: 'IBOM-BDC-001@1.1.0', topologyRef: 'TOPO-BDC-001@1.4.0' },
  { id: 'RB-BDC-002', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-DTC-FAIL', applicabilityRef: 'APL-ALL', flagBindingRef: 'FB-BDC-002', bomRef: 'IBOM-BDC-001@1.1.0', topologyRef: 'TOPO-BDC-001@1.4.0' },
  { id: 'RB-BDC-003', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-PARAM-TEMP', applicabilityRef: 'APL-KR-PREMIUM-GEN3', flagBindingRef: 'FB-BDC-001', bomRef: 'IBOM-BDC-001@1.1.0', topologyRef: 'TOPO-BDC-001@1.4.0' },
  { id: 'RB-BDC-004', featureVersionRef: FEATURE_VERSION, controlPointRef: 'CP-BDC-001-API-VERSION', applicabilityRef: 'APL-EU-BASE', flagBindingRef: 'FB-BDC-006', bomRef: 'IBOM-BDC-001@1.1.0', topologyRef: 'TOPO-BDC-001@1.4.0' },
];

// ── ImplementationBOM (Feature 버전별 구현 구성) ──
//
// DD-03-3: Item 합집합·중복·출처·resolution 을 검사한 뒤 contentHash 를 만든다.
// 11개 관리 영역 각각에 PRESENT 와 정확 참조, 또는 허용된 NOT_APPLICABLE 근거가 있어야 한다.
// FeatureMaster 는 비해당으로 제거할 수 없다.

/** 11 관리 영역 — 이 순서가 검사 순서다(DD-03-3). */
export const BOM_AREAS = [
  'FeatureMaster', 'Requirement', 'Architecture', 'Interface', 'Variant', 'Control',
  'Deployment', 'Verification', 'Supplier', 'SafetySecurity', 'Operations',
] as const;
export type BomArea = (typeof BOM_AREAS)[number];

export const BOM_AREA_KO: Record<BomArea, string> = {
  FeatureMaster: 'Feature 기준정보', Requirement: '요구사항', Architecture: '아키텍처',
  Interface: '인터페이스', Variant: 'Variant', Control: '제어', Deployment: '배포',
  Verification: '검증', Supplier: '협력사', SafetySecurity: '안전·보안', Operations: '운영',
};

/** 제거할 수 없는 영역 — NOT_APPLICABLE 이면 승인 차단 */
export const BOM_REQUIRED_AREAS: BomArea[] = ['FeatureMaster'];

export type Presence = 'PRESENT' | 'NOT_APPLICABLE';

export interface BomItem {
  area: BomArea;
  presence: Presence;
  /** PRESENT 는 정확 참조(@버전 고정)만 둔다. 범위 표현·빈 참조는 drift 다. */
  refs: string[];
  /** 참조가 모두 정확 해석되면 RESOLVED, 아니면 UNRESOLVED — 원천에서 파생한다. */
  resolution: Resolution | 'NOT_APPLICABLE';
  source: SourceSystem | 'BOM';
  basis: string;
}

interface BomItemSeed { area: BomArea; presence: Presence; refs: string[]; basis: string; source: SourceSystem }

export interface ImplementationBomRecord {
  id: string;
  version: string;
  featureRef: string;
  /** items 의 PRESENT 참조에서 파생 — 별도로 손으로 적지 않는다. */
  artifactRefs: string[];
  /** 11개 관리 영역의 해당·비해당 근거 */
  items: BomItem[];
  predecessor?: string;
  sourceProfile: '시연' | '검증' | '운영';
}

interface ImplBomSeed extends Omit<ImplementationBomRecord, 'artifactRefs' | 'items'> { items: BomItemSeed[] }

type AreaSpec = [Presence, string, string, SourceSystem?];
const P = (refs: string, basis: string, source?: SourceSystem): AreaSpec => ['PRESENT', refs, basis, source];
const N = (basis: string): AreaSpec => ['NOT_APPLICABLE', '', basis];

function bomItems(spec: Record<BomArea, AreaSpec>): BomItemSeed[] {
  return BOM_AREAS.map(area => {
    const [presence, refs, basis, source] = spec[area];
    return {
      area, presence, basis, source: source || 'BOM',
      refs: presence === 'PRESENT' ? refs.split(',').map(s => s.trim()).filter(Boolean) : [],
    };
  });
}

const CP_IDS = new Set(CONTROL_POINTS.map(c => c.id));
const ARTIFACT_INDEX = new Map(ARTIFACT_RECORDS.map(a => [`${a.id}@${a.version}`, a]));

/** 참조가 가리키는 정확 대상이 해석되는지 — 못 찾으면 UNRESOLVED 로 남긴다. */
function refResolved(ref: string): boolean {
  if (CP_IDS.has(ref)) return true;
  if (/^FEAT-[A-Z0-9-]+@/.test(ref)) return true;
  const found = ARTIFACT_INDEX.get(ref);
  return !!found && found.resolution === 'RESOLVED';
}

const IMPL_BOM_SEEDS: ImplBomSeed[] = [
  {
    id: 'IBOM-BDC-001', version: '1.1.0', featureRef: FEATURE_VERSION, sourceProfile: '운영',
    predecessor: 'IBOM-BDC-001@1.0.0',
    items: bomItems({
      FeatureMaster: P('FEAT-BDC-001@1.1.0', 'Feature 정의 정확 버전과 1:1 결속', 'ALM'),
      Requirement: P('ART-SYS-BODY-001@3.2.0,ART-SWE-BDC-010@1.4.2', 'SYS-BODY-001 · SWE-BDC-010 승인 버전', 'ALM'),
      Architecture: P('ART-SWC-BDC-ADAPTER@2.7.0', 'SWC-BDC-ADAPTER 배치 · Body Domain 내부', 'Git'),
      Interface: P('ART-API-BDC-POLICY-CONTROL@1.5.0,ART-SIG-DOOR-LOCK@DBC-2027.1', 'API v1.5.0 · Signal DBC-2027.1 고정', 'Git'),
      Variant: P('ART-VAR-BDC-001@2027.1', 'KR/EU · MY2027+ · Premium · Gen3', 'PLM'),
      Control: P('CP-BDC-001-FLAG-ENABLE,CP-BDC-001-FLAG-KILL,CP-BDC-001-PARAM-TEMP', 'FLAG 4 · PARAMETER 2 · 관측 3', 'BOM'),
      Deployment: P('ART-DEP-BDC-001@1.1.0', 'build-2291 산출 배포 콘텐츠', 'CI'),
      Verification: P('ART-HIL-BDC-001@1.3', 'HIL 42/42 통과 · 전이 시험 포함', 'CI'),
      Supplier: P('ART-SUP-BDC-A@1.0.0', 'SUP-BDC-A BDC_FUNC_032 인계 대상', 'ALM'),
      SafetySecurity: N('QM 등급 — 기능안전 요구 없음. 정책 서명 요구는 Interface 영역에서 확인'),
      Operations: P('CP-BDC-001-SIG-LOCK,CP-BDC-001-DTC-FAIL', '관측 계약 · DTC 복구 경로 정의', 'BOM'),
    }),
  },
  {
    id: 'IBOM-BDC-001', version: '1.0.0', featureRef: 'FEAT-BDC-001@1.0.0', sourceProfile: '검증',
    items: bomItems({
      FeatureMaster: P('FEAT-BDC-001@1.0.0', '직전 승인 버전 — 변경 전 구성', 'ALM'),
      Requirement: P('ART-SYS-BODY-001@3.1.0,ART-SWE-BDC-010@1.3.0', '이전 요구사항 개정', 'ALM'),
      Architecture: P('ART-SWC-BDC-ADAPTER@2.6.0', 'SWC 2.6.0 배치', 'Git'),
      Interface: P('ART-API-BDC-POLICY-CONTROL@1.4.0', 'API v1.4.0 고정', 'Git'),
      Variant: P('ART-VAR-BDC-001@2027.1', 'KR/EU · MY2027+ · Premium', 'PLM'),
      Control: P('CP-BDC-001-FLAG-ENABLE,CP-BDC-001-PARAM-TEMP', 'FLAG 1 · PARAMETER 1', 'BOM'),
      Deployment: P('ART-DEP-BDC-001@1.0.0', 'build-2274', 'CI'),
      Verification: P('ART-HIL-BDC-001@1.2', 'HIL 38/38', 'CI'),
      Supplier: P('ART-SUP-BDC-A@1.0.0', '동일 인계 항목', 'ALM'),
      SafetySecurity: N('QM 등급 — 요구 없음'),
      Operations: P('CP-BDC-001-SIG-LOCK', '관측 계약 — DTC 항목은 1.1.0 에서 추가', 'BOM'),
    }),
  },
  {
    id: 'IBOM-LIGHT-001', version: '2.0.0', featureRef: 'FEAT-LIGHT-001@2.0.0', sourceProfile: '운영',
    items: bomItems({
      FeatureMaster: P('FEAT-LIGHT-001@2.0.0', 'Feature 정의 정확 버전', 'ALM'),
      Requirement: P('ART-SWE-LIGHT-001@1.0.0', '조명 시퀀스 요구사항', 'ALM'),
      Architecture: P('ART-SWC-LIGHT-CTRL@2.0.0', 'Lighting controller 배치', 'Git'),
      Interface: P('ART-API-LIGHT-SERVICE@1.2.0', 'Lighting API v1.2.0', 'Git'),
      Variant: P('ART-VAR-LIGHT-001@2027.1', 'KR/EU · Premium 트림 한정', 'PLM'),
      Control: P('CP-LIGHT-001-FLAG-ON', 'FLAG 1 · PARAMETER 0', 'BOM'),
      Deployment: P('ART-DEP-LIGHT-001@2.0.0', 'build-2290 deployment unit', 'CI'),
      Verification: P('ART-HIL-LIGHT-001@1.0', 'HIL 24/24', 'CI'),
      Supplier: N('내부 개발 — 협력사 인계 항목 없음'),
      SafetySecurity: N('QM 등급 — 실내 조명, 기능안전 요구 없음'),
      Operations: P('CP-LIGHT-001-SIG-STATE', '조명 상태 관측', 'BOM'),
    }),
  },
  {
    id: 'IBOM-ADAS-001', version: '2.0.0', featureRef: 'FEAT-ADAS-001@2.4.0', sourceProfile: '검증',
    items: bomItems({
      FeatureMaster: P('FEAT-ADAS-001@2.4.0', 'Feature 정의 정확 버전', 'ALM'),
      Requirement: P('ART-SWE-ADAS-001@2.4.0', '종방향 제어 요구사항', 'ALM'),
      Architecture: P('ART-SWC-ADAS-LONG@3.0.1', 'Longitudinal SWC 배치', 'Git'),
      Interface: P('ART-API-ADAS-TARGET@2.0.0', 'Target object API v2.0.0', 'Git'),
      Variant: P('ART-VAR-ADAS-001@2027.1', 'KR 한정 · ASIL B 트림', 'PLM'),
      Control: P('CP-ADAS-001-FLAG-ENABLE,CP-ADAS-001-PARAM-GAIN', 'FLAG 1 · PARAMETER 1', 'BOM'),
      Deployment: P('ART-DEP-ADAS-001@2.0.0', 'build-2288', 'CI'),
      Verification: P('ART-HIL-ADAS-LONG@2.1', 'HIL 57/58 — 잔여 1건 재시험 중', 'CI'),
      Supplier: N('내부 개발 — 협력사 항목 없음'),
      SafetySecurity: N('ASIL B 확장 아님 — 기존 안전 분석 범위 내 변경'),
      Operations: P('CP-ADAS-001-DTC-FAIL', 'DTC 관측 계약', 'BOM'),
    }),
  },
];

export const IMPLEMENTATION_BOMS: ImplementationBomRecord[] = IMPL_BOM_SEEDS.map(seed => ({
  ...seed,
  artifactRefs: seed.items.flatMap(i => i.presence === 'PRESENT' ? i.refs.filter(r => r.startsWith('ART-')) : []),
  items: seed.items.map(i => ({
    ...i,
    resolution: i.presence === 'NOT_APPLICABLE'
      ? 'NOT_APPLICABLE' as const
      : (i.refs.length > 0 && i.refs.every(refResolved) ? 'RESOLVED' : 'UNRESOLVED') as Resolution,
  })),
}));

/** ImplementationBOM 정확 버전 조회 — 멤버의 implementationRef 가 이 표에 있어야 한다. */
export const IMPL_BOM_INDEX = new Map(IMPLEMENTATION_BOMS.map(b => [`${b.id}@${b.version}`, b]));

// ── 위반 계산 (화면 KPI 와 상세가 이 결과만 쓴다) ──
export function computeViolations(
  artifacts: ArtifactRecord[] = ARTIFACT_RECORDS,
  cps: ControlPointRecord[] = CONTROL_POINTS,
  flags: FlagBindingRecord[] = FLAG_BINDINGS,
  runtimes: RuntimeBindingRecord[] = RUNTIME_BINDINGS,
  boms: ImplementationBomRecord[] = IMPLEMENTATION_BOMS,
): BindingViolation[] {
  const out: BindingViolation[] = [];

  artifacts.forEach(a => {
    if (a.resolution === 'UNRESOLVED') {
      out.push({ code: 'UNRESOLVED_ARTIFACT', target: a.id, detail: '정확 버전 미해석 — 이 구성을 포함한 Feature 승인 차단', blocking: true });
    }
    if (a.artifactKind === 'HW' && a.delivery === 'OTA') {
      out.push({ code: 'HW_OTA_DELIVERY', target: a.id, detail: 'HW 는 물리 설치 대상 — OTA 전송 대상 지정 금지', blocking: true });
    }
    if (!/^[0-9a-f]{64}$/.test(a.contentDigest)) {
      out.push({ code: 'DIGEST_INVALID', target: a.id, detail: 'contentDigest 가 64자리 SHA-256 이 아님', blocking: true });
    }
    if (/latest|^[~^*>]/.test(a.version)) {
      out.push({ code: 'IMPLEMENTATION_ITEM_DRIFT', target: a.id, detail: `정확 버전 대신 범위 표현(${a.version}) 사용`, blocking: true });
    }
  });

  cps.forEach(cp => {
    if (cp.role === 'OBSERVE' && cp.accessMode !== 'READ_ONLY') {
      out.push({ code: 'OBSERVE_WRITE_GRANT', target: cp.id, detail: '관측 항목에 실행 제어 권한 부여 금지', blocking: true });
    }
    if (cp.role === 'WRITE_REQUEST' && !cp.guardRef) {
      out.push({ code: 'GUARD_REF_MISSING', target: cp.id, detail: '쓰기 요청 제어점에 guardRef 없음 — 차량 상태·권리·서명·TTL 확인 불가', blocking: true });
    }
    if (cp.allowedRange && cp.unit && cp.kind === 'PARAMETER') {
      const v = Number(cp.observedValue);
      if (!Number.isFinite(v) || v < cp.allowedRange[0] || v > cp.allowedRange[1]) {
        out.push({ code: 'RANGE_MISMATCH', target: cp.id, detail: `관측값 ${cp.observedValue}${cp.unit} 가 허용 범위 ${cp.allowedRange[0]}~${cp.allowedRange[1]} 밖`, blocking: true });
      }
    }
    if (cp.flagClass && cp.flagClass.lifetimeDays === 0 && cp.flagClass.purpose !== 'kill-switch' && cp.flagClass.purpose !== 'operational') {
      out.push({ code: 'FOCUS_FIELD_SHORTCUT', target: cp.id, detail: '수명 0(기한 없음)은 kill-switch·operational 목적 외에 사용할 수 없음', blocking: false });
    }
  });

  // BD-06: 같은 제어점·같은 적용 조건에서 Binding 은 정확히 하나
  const byKey = new Map<string, FlagBindingRecord[]>();
  flags.forEach(f => {
    const k = `${f.controlPointRef}|${f.applicabilityRef}`;
    byKey.set(k, [...(byKey.get(k) || []), f]);
  });
  byKey.forEach((list, k) => {
    if (list.length > 1) {
      out.push({
        code: 'CONFIG_CONFLICT', target: k.replace('|', ' · '),
        detail: `같은 제어점·적용 조건에 FlagBinding ${list.length}개 (${list.map(f => f.id).join(', ')}) — 임의 첫 행 선택 금지, 발행 차단`,
        blocking: true,
      });
    }
  });

  // 구현 구성이 참조한 정확 버전이 원천 레지스트리와 어긋나면 drift
  const known = new Set(artifacts.map(a => `${a.id}@${a.version}`));
  const artifactIndex = new Map(artifacts.map(a => [`${a.id}@${a.version}`, a]));
  const cpIds = new Set(cps.map(c => c.id));
  const resolves = (ref: string) => {
    if (cpIds.has(ref)) return true;
    if (/^FEAT-[A-Z0-9-]+@/.test(ref)) return true;
    const found = artifactIndex.get(ref);
    return !!found && found.resolution === 'RESOLVED';
  };

  // DD-03-3 — 11개 관리 영역의 해당·비해당 근거와 정확 참조 검사
  boms.forEach(b => {
    const bomRef = `${b.id}@${b.version}`;
    const seen = new Set<string>();
    b.items.forEach(it => {
      const where = `${bomRef} → ${it.area}`;
      if (seen.has(it.area)) {
        out.push({ code: 'DUPLICATE_BOM_ITEM', target: where, detail: '같은 관리 영역이 두 번 이상 존재 — Item 합집합 정규화 필요', blocking: true });
      }
      seen.add(it.area);
      if (it.presence === 'NOT_APPLICABLE') {
        if (BOM_REQUIRED_AREAS.includes(it.area)) {
          out.push({ code: 'FEATURE_MASTER_NOT_APPLICABLE', target: where, detail: `${BOM_AREA_KO[it.area]} 는 비해당으로 제거할 수 없음`, blocking: true });
        }
        if (it.basis.trim().length < 6) {
          out.push({ code: 'MISSING_AREA_EVIDENCE', target: where, detail: 'NOT_APPLICABLE 인데 허용 근거가 없음', blocking: true });
        }
      } else if (it.refs.length === 0) {
        out.push({ code: 'IMPLEMENTATION_ITEM_DRIFT', target: where, detail: 'PRESENT 인데 정확 참조가 없음', blocking: true });
      } else if (!it.refs.every(resolves)) {
        out.push({
          code: 'UNRESOLVED_ARTIFACT', target: where,
          detail: `영역 참조 ${it.refs.filter(r => !resolves(r)).join(', ')} 를 정확 해석할 수 없음`, blocking: true,
        });
      }
    });
    BOM_AREAS.filter(a => !seen.has(a)).forEach(a => {
      out.push({ code: 'MISSING_AREA_EVIDENCE', target: `${bomRef} → ${a}`, detail: '11개 관리 영역 누락 — 해당·비해당 근거 필요', blocking: true });
    });
    b.artifactRefs.forEach(ref => {
      if (!known.has(ref)) {
        out.push({ code: 'IMPLEMENTATION_ITEM_DRIFT', target: `${b.id} → ${ref}`, detail: '구현 구성이 참조한 정확 버전이 Artifact 레지스트리에 없음', blocking: true });
      }
    });
  });

  // RuntimeBinding 이 가리키는 FlagBinding 이 실제로 있어야 한다
  const flagIds = new Set(flags.map(f => f.id));
  runtimes.forEach(r => {
    if (!flagIds.has(r.flagBindingRef)) {
      out.push({ code: 'CONFIG_CONFLICT', target: r.id, detail: `RuntimeBinding 이 없는 FlagBinding(${r.flagBindingRef}) 참조`, blocking: true });
    }
  });

  return out;
}

export const VIOLATIONS = computeViolations();

export const artifactStats = (rows: ArtifactRecord[] = ARTIFACT_RECORDS) => ({
  total: rows.length,
  resolved: rows.filter(a => a.resolution === 'RESOLVED').length,
  unresolved: rows.filter(a => a.resolution === 'UNRESOLVED').length,
  deployable: rows.filter(a => a.deploymentContent).length,
  physical: rows.filter(a => a.delivery === 'PHYSICAL_INSTALL').length,
  sources: new Set(rows.map(a => a.sourceRef.system)).size,
});

export const controlPointStats = (
  cps: ControlPointRecord[] = CONTROL_POINTS,
  flags: FlagBindingRecord[] = FLAG_BINDINGS,
  runtimes: RuntimeBindingRecord[] = RUNTIME_BINDINGS,
  violations: BindingViolation[] = VIOLATIONS,
) => {
  const write = cps.filter(c => c.role === 'WRITE_REQUEST');
  return {
    total: cps.length,
    kinds: new Set(cps.map(c => c.kind)).size,
    write: write.length,
    writeGuarded: write.filter(c => !!c.guardRef).length,
    observe: cps.filter(c => c.role === 'OBSERVE').length,
    flags: flags.length,
    runtimes: runtimes.length,
    blocking: violations.filter(v => v.blocking).length,
  };
};

/** ImplementationBOM 영역 완전성 — 화면은 이 결과를 그대로 보여준다. */
export function implementationBomStats(
  boms: ImplementationBomRecord[] = IMPLEMENTATION_BOMS,
  violations: BindingViolation[] = VIOLATIONS,
) {
  return {
    total: boms.length,
    complete: boms.filter(b => b.items.length === BOM_AREAS.length && b.items.every(i => i.presence === 'NOT_APPLICABLE' || i.resolution === 'RESOLVED')).length,
    areas: BOM_AREAS.length,
    present: boms.reduce((n, b) => n + b.items.filter(i => i.presence === 'PRESENT').length, 0),
    notApplicable: boms.reduce((n, b) => n + b.items.filter(i => i.presence === 'NOT_APPLICABLE').length, 0),
    items: boms.reduce((n, b) => n + b.items.length, 0),
    drift: violations.filter(v => v.code === 'IMPLEMENTATION_ITEM_DRIFT').length,
  };
}

/** Flag 목적 6종 정의 (UL-009 · FlagTypePolicy) — 화면은 이 표를 참조로만 보여준다. */
export const FLAG_PURPOSES: { purpose: FlagPurpose; ko: string; detail: string }[] = [
  { purpose: 'release', ko: '출시', detail: '승인된 Feature 를 출시 시점에 켠다' },
  { purpose: 'experiment', ko: '실험', detail: '코호트 비교 — 효과 검증 결과로 회수' },
  { purpose: 'operational', ko: '운영', detail: '운영 중 조건 변경 지원' },
  { purpose: 'kill-switch', ko: '긴급 차단', detail: '즉시 비활성화 — 수명 0 허용' },
  { purpose: 'permission', ko: '권리', detail: '구매·구독 권리에 따른 활성화' },
  { purpose: 'sunset', ko: '종료', detail: '기능 종료 예고와 단계적 회수' },
];

export const deliveryLabel: Record<Delivery, string> = {
  PHYSICAL_INSTALL: '물리 설치 (HW)',
  OTA: 'OTA 전송',
  REFERENCE_ONLY: '참조 전용 (실행 패키지 아님)',
};

export const kindLabel: Record<ControlPointKind, string> = {
  FLAG: 'FLAG 활성 제어', PARAMETER: 'PARAMETER 값 제어', SIGNAL: 'SIGNAL 관측', DTC: 'DTC 관측', API: 'API 계약',
};

export const roleLabel: Record<ControlRole, string> = {
  EVALUATE: '평가 (읽기·판정)', WRITE_REQUEST: '쓰기 요청 (Guard 필수)', OBSERVE: '관측 (제어 권한 없음)',
};

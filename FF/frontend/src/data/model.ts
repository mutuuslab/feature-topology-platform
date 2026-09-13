// 자체 완결형 도메인 (백엔드 GraphPort와 동일 계약을 클라이언트에서 재현).
// 나중에 이 모듈을 fetch('/api/...') 호출로 교체하면 백엔드 연동.

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type Lifecycle = 'Proposed' | 'Approved' | 'Developing' | 'Verified' | 'Released' | 'Retired';
export type DeployType = 'Binary' | 'Policy-only' | 'Config' | 'Calibration' | 'Manual' | 'TBD';

// 신규 PPT(S18/S20): Decision Package — 재현 가능한 의사결정 산출물 계약
export interface DecisionPackage {
  decisionId: string;        // DEC-BDC-0618
  graphSnapshotId: string;   // GPH-BDC-v1.4
  changeTarget: string;
  deployType: DeployType;
  confidence: 'High' | 'Medium' | 'Low';
  requiredGates: string[];
  requiredTests: string[];
  evidenceLinks: string[];
  reasonCodes: string[];     // NO_SWC_CHANGE, API_COMPATIBLE …
  costImpact?: { changeWon: number; binaryWon: number; savingsWon: number };  // SW 개발비 영향
}
export type GateStatus = 'PASS' | 'PENDING' | 'FAIL';
export type EdgeType = 'parent_of'|'child_of'|'composed_of'|'requires'|'excludes'|'overrides'|'fallback_to'|'degrades_to'|'replaces'|'duplicates';
// 정본 관계 사전(DD-03-5)의 15종을 모두 담는다. 앞 9종은 정본 이름이고,
// `derives`/`uses_api`/`applies_to`/`controlled_by`/`deployed_as`/`realized_by` 는 초기 모델의
// 원천 이름으로 남긴 이관 대상(GAP-03)이다 — 자동 변환하지 않고 화면에서 별칭으로 드러낸다.
export type RelType =
  | 'parent_of'|'composed_of'|'requires'|'excludes'|'overrides'|'fallback_to'|'degrades_to'|'replaces'|'duplicates'
  | 'implemented_by'|'verified_by'|'observed_by'|'deployed_on'|'governed_by'|'emits'
  | 'derives'|'uses_api'|'applies_to'|'controlled_by'|'deployed_as'|'realized_by';

/** `FEAT-BDC-001@1.1.0` → `FEAT-BDC-001` — 정확 버전 pin 을 떼어낸 기준 ID. */
export const baseRef = (ref: string): string => {
  const s = String(ref);
  const at = s.indexOf('@');
  return at < 0 ? s : s.slice(0, at);
};

export interface Feature {
  id: string; level: Level; displayName: string; domain: string; ownerOrg: string;
  lifecycle: Lifecycle; safety: string; security: string; deployType: DeployType;
  baselineVer?: string; internalAlias?: Record<string,string>;
}
export interface Edge { id: string; source: string; target: string; type: EdgeType; criticality?: string; safeDefault?: string; }
export interface ArtifactNode { id: string; kind: string; displayName: string; meta?: any; }
export interface Relation { id: string; source: string; target: string; type: RelType; }

export const features: Feature[] = [
  { id:'FEAT-BDC-001', level:'L2', displayName:'BDC Policy Control', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Approved', safety:'QM', security:'Medium', deployType:'Policy-only', baselineVer:'v1.1', internalAlias:{기획:'스마트 도어 잠금',시스템:'Remote Door Lock Command',SW:'BDC_PolicyControl_v3',협력사:'BDC_FUNC_032'} },
  { id:'FEAT-BDC-002', level:'L3', displayName:'BDC Legacy Logic', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Retired', safety:'QM', security:'Low', deployType:'Binary' },
  { id:'FEAT-BODY-001', level:'L1', displayName:'Body Comfort', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Released', safety:'QM', security:'Low', deployType:'TBD' },
  { id:'FEAT-RUNTIME-001', level:'L3', displayName:'Policy Agent Runtime', domain:'Runtime', ownerOrg:'Platform Team', lifecycle:'Released', safety:'QM', security:'Medium', deployType:'Binary' },
  { id:'FEAT-MANUAL-001', level:'L3', displayName:'Manual Override', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Released', safety:'QM', security:'Low', deployType:'Binary' },
  { id:'FEAT-ADAS-001', level:'L2', displayName:'AEB Emergency Brake', domain:'ADAS', ownerOrg:'ADAS Team', lifecycle:'Released', safety:'ASIL-D', security:'High', deployType:'Binary' },
  { id:'FEAT-CONN-001', level:'L1', displayName:'Remote Door Lock', domain:'Connectivity', ownerOrg:'Conn. Team', lifecycle:'Developing', safety:'QM', security:'Medium', deployType:'Policy-only' },
  { id:'FEAT-SEAT-001', level:'L2', displayName:'Seat Heat Auth', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Proposed', safety:'QM', security:'Low', deployType:'TBD' },
  { id:'FEAT-LIGHT-001', level:'L2', displayName:'Welcome Light', domain:'Body', ownerOrg:'Body Platform Team', lifecycle:'Verified', safety:'QM', security:'Low', deployType:'Policy-only' },
  { id:'FEAT-PARK-001', level:'L2', displayName:'Remote Parking', domain:'ADAS', ownerOrg:'ADAS Team', lifecycle:'Approved', safety:'ASIL-B', security:'High', deployType:'Binary' },
];

export const edges: Edge[] = [
  { id:'E1', source:'FEAT-BODY-001', target:'FEAT-BDC-001', type:'parent_of' },
  { id:'E2', source:'FEAT-BDC-001', target:'FEAT-RUNTIME-001', type:'requires', criticality:'high' },
  { id:'E3', source:'FEAT-BDC-001', target:'FEAT-MANUAL-001', type:'excludes' },
  // 정본 `fallback_to` 는 Feature → Feature 다. 미등록 참조(POLICY-BDC-PREV)는 Import 검사
  // 표본(DEFAULT_IMPORT)에만 남겨 적재 시점 차단이 계속 보이도록 한다.
  { id:'E4', source:'FEAT-BDC-001', target:'FEAT-BDC-002', type:'fallback_to', safeDefault:'disabled' },
  { id:'E5', source:'FEAT-BDC-001', target:'FEAT-BDC-002', type:'replaces' },
  { id:'E6', source:'FEAT-BODY-001', target:'FEAT-MANUAL-001', type:'composed_of' },
  { id:'E7', source:'FEAT-BODY-001', target:'FEAT-SEAT-001', type:'composed_of' },
  { id:'E8', source:'FEAT-BODY-001', target:'FEAT-LIGHT-001', type:'composed_of' },
  { id:'E9', source:'FEAT-MANUAL-001', target:'FEAT-BDC-001', type:'overrides' },
  { id:'E10', source:'FEAT-ADAS-001', target:'FEAT-MANUAL-001', type:'degrades_to' },
  { id:'E11', source:'FEAT-CONN-001', target:'FEAT-BDC-001', type:'duplicates' },
  { id:'E12', source:'FEAT-ADAS-001', target:'FEAT-PARK-001', type:'composed_of' },
  { id:'E13', source:'FEAT-SEAT-001', target:'FEAT-RUNTIME-001', type:'requires' },
  { id:'E14', source:'FEAT-LIGHT-001', target:'FEAT-RUNTIME-001', type:'requires' },
  { id:'E15', source:'FEAT-PARK-001', target:'FEAT-RUNTIME-001', type:'requires' },
];

export const artifacts: ArtifactNode[] = [
  { id:'SYS-BODY-001', kind:'Requirement', displayName:'System Req' },
  { id:'SWE-BDC-010', kind:'Requirement', displayName:'SW Req' },
  { id:'SEC-POLICY-004', kind:'Requirement', displayName:'Security Req' },
  { id:'SWC-BDC-ADAPTER', kind:'SWComponent', displayName:'BDC Adapter' },
  { id:'ECU-BDC', kind:'ECU', displayName:'BDC ECU' },
  { id:'API-BDC-POLICY-CONTROL', kind:'APIService', displayName:'BDC Policy API (v1.5)' },
  { id:'SIG-DOOR-LOCK', kind:'Signal', displayName:'Door Lock Signal' },
  { id:'DTC-BDC-POLICY-FAIL', kind:'DTC', displayName:'Policy Fail DTC' },
  { id:'VAR-BDC-001', kind:'VariantRule', displayName:'KR/EU·MY2027+·Premium·Gen3' },
  { id:'POLICY-BDC-ENABLE', kind:'ControlPoint', displayName:'Enable Policy' },
  { id:'CP-BDC-001-KILL', kind:'ControlPoint', displayName:'Kill Switch' },
  { id:'DEP-BDC-001', kind:'DeploymentUnit', displayName:'Policy Package' },
  { id:'HIL-BDC-001', kind:'TestCase', displayName:'HIL Test' },
  { id:'OTA-RB-002', kind:'TestCase', displayName:'OTA Rollback Test' },
  { id:'TEL-BDC-001', kind:'TestCase', displayName:'Telemetry Test' },
  { id:'SUP-BDC-A', kind:'SupplierFunction', displayName:'Supplier A (BDC_FUNC_032)' },
  { id:'RULE-BDC-VARIANT', kind:'Rule', displayName:'KR/EU Variant Rule' },
  { id:'OBS-BDC-FLEET', kind:'ObservationPoint', displayName:'BDC Fleet Observation' },
  // ADAS — AEB 종방향 보조(ASIL-D)
  { id:'SWC-ADAS-AEB', kind:'SWComponent', displayName:'AEB Controller' },
  { id:'API-ADAS-AEB', kind:'APIService', displayName:'AEB Policy API (v3.1)' },
  { id:'ECU-ADAS', kind:'ECU', displayName:'ADAS Domain ECU' },
  { id:'DTC-ADAS-AEB-FAIL', kind:'DTC', displayName:'AEB Suppress DTC' },
  { id:'HIL-ADAS-001', kind:'TestCase', displayName:'HIL-ADAS-07' },
  { id:'OBS-ADAS-FLEET', kind:'ObservationPoint', displayName:'ADAS Fleet Observation' },
  { id:'RULE-ADAS-ASIL', kind:'Rule', displayName:'ASIL-B Trim Rule' },
  // Body Comfort — Welcome Light
  { id:'SWC-LIGHT-ANIM', kind:'SWComponent', displayName:'Light Animation' },
  { id:'API-LIGHT-CTRL', kind:'APIService', displayName:'Light Choreography API (v2.1)' },
  { id:'ECU-BCM', kind:'ECU', displayName:'Body Control Module' },
  { id:'SIG-LIGHT-STATE', kind:'Signal', displayName:'Light State Signal' },
  { id:'HIL-LIGHT-003', kind:'TestCase', displayName:'HIL-LIGHT-03' },
  { id:'OBS-LIGHT-FLEET', kind:'ObservationPoint', displayName:'Light Fleet Observation' },
  { id:'RULE-LIGHT-LIFECYCLE', kind:'Rule', displayName:'Light Lifecycle Rule' },
  { id:'CP-LIGHT-001', kind:'ControlPoint', displayName:'Light Animation Switch' },
  // ADAS — Remote Parking
  { id:'SWC-PARK-AEB-ACT', kind:'SWComponent', displayName:'Parking Actuator Adapter' },
];

/**
 * 정본 15종 + 이관 대상 원천 이름. 모든 관계는 그래프 노드 안에서 해석되며,
 * `derives`/`uses_api`/`applies_to`/`controlled_by`/`deployed_as`/`realized_by` 6종은
 * GAP-03 이관 backlog 로 남긴 실제 원천 이름이다(사전 밖 타입이 0건이 되면 이관 완료).
 */
export const relations: Relation[] = [
  // ── 이관 대상(사전 밖 원천 이름) — 화면 UI05-S03 의 "사전 외" 표본
  { id:'R1', source:'SYS-BODY-001', target:'FEAT-BDC-001', type:'derives' },
  { id:'R2', source:'FEAT-BDC-001', target:'VAR-BDC-001', type:'applies_to' },
  { id:'R3', source:'FEAT-CONN-001', target:'API-BDC-POLICY-CONTROL', type:'uses_api' },
  { id:'R4', source:'FEAT-LIGHT-001', target:'CP-LIGHT-001', type:'controlled_by' },
  { id:'R5', source:'FEAT-BDC-001', target:'DEP-BDC-001', type:'deployed_as' },
  { id:'R6', source:'FEAT-BDC-001', target:'SUP-BDC-A', type:'realized_by' },
  // ── FEAT-BDC-001 (BOM 멤버 · BL-BDC-2027.1)
  { id:'K1', source:'FEAT-BDC-001', target:'SWC-BDC-ADAPTER@3.2.1', type:'implemented_by' },
  { id:'K2', source:'FEAT-BDC-001', target:'API-BDC-POLICY-CONTROL@1.5.0', type:'implemented_by' },
  { id:'K3', source:'FEAT-BDC-001', target:'HIL-BDC-001@2027.4', type:'verified_by' },
  { id:'K4', source:'FEAT-BDC-001', target:'OTA-RB-002@2027.4', type:'verified_by' },
  { id:'K5', source:'FEAT-BDC-001', target:'TEL-BDC-001@2027.4', type:'verified_by' },
  { id:'K6', source:'FEAT-BDC-001', target:'OBS-BDC-FLEET@1.2.0', type:'observed_by' },
  { id:'K7', source:'FEAT-BDC-001', target:'RULE-BDC-VARIANT@2.0.0', type:'governed_by' },
  { id:'K8', source:'API-BDC-POLICY-CONTROL', target:'ECU-BDC', type:'deployed_on' },
  { id:'K9', source:'API-BDC-POLICY-CONTROL', target:'SIG-DOOR-LOCK', type:'emits' },
  { id:'K10', source:'API-BDC-POLICY-CONTROL', target:'DTC-BDC-POLICY-FAIL', type:'emits' },
  { id:'K11', source:'POLICY-BDC-ENABLE', target:'RULE-BDC-VARIANT@2.0.0', type:'governed_by' },
  { id:'K12', source:'CP-BDC-001-KILL', target:'RULE-BDC-VARIANT@2.0.0', type:'governed_by' },
  { id:'K13', source:'SWE-BDC-010', target:'RULE-BDC-VARIANT@2.0.0', type:'governed_by' },
  { id:'K14', source:'SEC-POLICY-004', target:'RULE-BDC-VARIANT@2.0.0', type:'governed_by' },
  // ── FEAT-ADAS-001 (BOM 멤버 · BL-LIGHT-ADAS-2027.1)
  { id:'K15', source:'FEAT-ADAS-001', target:'SWC-ADAS-AEB@2.4.0', type:'implemented_by' },
  { id:'K16', source:'FEAT-ADAS-001', target:'API-ADAS-AEB@3.1.0', type:'implemented_by' },
  { id:'K17', source:'FEAT-ADAS-001', target:'HIL-ADAS-001@2027.4', type:'verified_by' },
  { id:'K18', source:'FEAT-ADAS-001', target:'OBS-ADAS-FLEET@1.2.0', type:'observed_by' },
  { id:'K19', source:'FEAT-ADAS-001', target:'RULE-ADAS-ASIL@4.0.0', type:'governed_by' },
  { id:'K20', source:'API-ADAS-AEB', target:'ECU-ADAS', type:'deployed_on' },
  { id:'K21', source:'API-ADAS-AEB', target:'DTC-ADAS-AEB-FAIL', type:'emits' },
  // ── FEAT-LIGHT-001 (BOM 멤버 · BL-LIGHT-2027.1)
  { id:'K22', source:'FEAT-LIGHT-001', target:'SWC-LIGHT-ANIM@2.0.0', type:'implemented_by' },
  { id:'K23', source:'FEAT-LIGHT-001', target:'API-LIGHT-CTRL@2.1.0', type:'implemented_by' },
  { id:'K24', source:'FEAT-LIGHT-001', target:'HIL-LIGHT-003@2027.4', type:'verified_by' },
  { id:'K25', source:'FEAT-LIGHT-001', target:'OBS-LIGHT-FLEET@1.2.0', type:'observed_by' },
  { id:'K26', source:'FEAT-LIGHT-001', target:'RULE-LIGHT-LIFECYCLE@1.4.0', type:'governed_by' },
  { id:'K27', source:'API-LIGHT-CTRL', target:'ECU-BCM', type:'deployed_on' },
  { id:'K28', source:'API-LIGHT-CTRL', target:'SIG-LIGHT-STATE', type:'emits' },
  // ── 범위 외 노드 — Topology node 집합과 BOM 멤버의 차이를 그대로 드러낸다
  { id:'K29', source:'FEAT-PARK-001', target:'SWC-PARK-AEB-ACT@1.0.0', type:'implemented_by' },
];

export const evidence = [
  { testCaseId:'HIL-BDC-001', result:'pass', coverage:0.9 },
  { testCaseId:'OTA-RB-002', result:'pending', coverage:0 },
  { testCaseId:'TEL-BDC-001', result:'pass', coverage:0.8 },
];

export const telemetry: Record<string, any> = {
  'FEAT-BDC-001': { activationSuccess:0.987, policyApplyFail:'12/10K', rollbackCount:3, runtimeState:'enabled',
    p95Latency:'42ms', staleCacheCount:7,
    recentEvents:[
      { type:'POLICY_APPLY_SUCCESS', detail:'VIN cohort pilot_kr_01' },
      { type:'POLICY_APPLY_FAIL', detail:'Reason: ECU version mismatch' },
      { type:'POLICY_ROLLBACK', detail:'Target: previous stable policy' },
    ] },
};

export const changeSets: Record<string, any[]> = {
  'FEAT-BDC-001': [
    { type:'ADD', area:'Requirement', detail:'SEC-POLICY-004 추가 (보안 요구사항)' },
    { type:'ADD', area:'Architecture', detail:'SWC-POLICY-EVALUATOR 추가' },
    { type:'ADD', area:'Architecture', detail:'ECU-CCU 추가 (통신 연계)' },
    { type:'MODIFY', area:'Variant', detail:'EU 지역 추가 (KR → KR/EU)' },
    { type:'ADD', area:'Control', detail:'POLICY-BDC-KILL-SWITCH 추가' },
    { type:'ADD', area:'Verification', detail:'OTA-ROLLBACK-002, TEL-BDC-001 추가' },
    { type:'MODIFY', area:'Supplier', detail:'API Contract v1.4 → v1.5' },
  ],
};

export const healthByFeature: Record<string, number> = {
  'FEAT-BDC-001':5,'FEAT-BDC-002':6,'FEAT-BODY-001':4,'FEAT-RUNTIME-001':5,'FEAT-MANUAL-001':4,
  'FEAT-ADAS-001':6,'FEAT-CONN-001':3,'FEAT-SEAT-001':1,'FEAT-LIGHT-001':5,'FEAT-PARK-001':4,
};

// 신규 PPT(S15): applicability ∈ allowed|blocked|review + effectiveRange
export const variantMatrix = [
  { platform:'A', my:'2027', region:'KR', trim:'Premium', hw:'Gen3', sw:'≥3.2.0', status:'Allowed', applicability:'allowed', effectiveRange:'MY2027~' },
  { platform:'A', my:'2027', region:'EU', trim:'Premium', hw:'Gen3', sw:'≥3.2.0', status:'Allowed', applicability:'allowed', effectiveRange:'MY2027~' },
  { platform:'A', my:'2027', region:'US', trim:'Premium', hw:'Gen3', sw:'≥3.2.0', status:'Blocked', applicability:'blocked', effectiveRange:'-' },
  { platform:'B', my:'2026', region:'KR', trim:'Premium', hw:'Gen2', sw:'2.x', status:'Blocked', applicability:'blocked', effectiveRange:'-' },
  { platform:'A', my:'2028', region:'KR', trim:'Standard', hw:'Gen3', sw:'3.1.x', status:'Review', applicability:'review', effectiveRange:'검토중' },
];

// 신규 PPT(S18/S20): BDC Decision Package 시드 (ID는 S20 표기로 정규화)
export const decisionPackages: DecisionPackage[] = [
  { decisionId:'DEC-BDC-0618', graphSnapshotId:'GPH-BDC-v1.4', changeTarget:'API-BDC-POLICY-CONTROL v1.4→v1.5',
    deployType:'Policy-only', confidence:'High',
    requiredGates:['Policy Approval','Variant Review','Rollback Test','Telemetry Validation'],
    requiredTests:['HIL-BDC-001','OTA-RB-002','TEL-BDC-001'],
    evidenceLinks:['HIL-BDC-001','TEL-BDC-001'],
    reasonCodes:['NO_SWC_CHANGE','API_COMPATIBLE','ROLLBACK_DEFINED'] },
];

// ── SW 개발비(Cost) — 공수(M/M)→금액(₩) 환산 Rate Card (추정 시드값) ──
export const rateCard = {
  wonPerMM: 12_000_000,                 // ₩/Man-Month (가설)
  unitMM: {                              // 아티팩트 종류별 변경 공수(M/M)
    SWComponent: 2, APIService: 1, ECU: 1.5, Signal: 0.3, DTC: 0.3,
    TestCase: 0.5, SupplierFunction: 3, Requirement: 0.5, VariantRule: 0.4, ControlPoint: 0.3,
  } as Record<string, number>,
  deployMultiplier: {                    // 배포방식별 비용 배수 (Binary 비쌈, Policy-only 저렴)
    Binary: 1.0, 'Policy-only': 0.3, Config: 0.4, Calibration: 0.5, Manual: 1.2, TBD: 1.0,
  } as Record<string, number>,
};

// Feature별 예상/실적 공수(M/M) 시드 (없으면 엔진이 BOM 연결로 추정)
export const featureCostSeed: Record<string, { estMM: number; actualMM: number }> = {
  'FEAT-BDC-001': { estMM: 8, actualMM: 9.2 },
  'FEAT-BDC-002': { estMM: 6, actualMM: 6 },
  'FEAT-BODY-001': { estMM: 3, actualMM: 2.5 },
  'FEAT-RUNTIME-001': { estMM: 10, actualMM: 12 },
  'FEAT-MANUAL-001': { estMM: 4, actualMM: 4.4 },
  'FEAT-ADAS-001': { estMM: 24, actualMM: 27 },
  'FEAT-CONN-001': { estMM: 7, actualMM: 5 },
  'FEAT-SEAT-001': { estMM: 2, actualMM: 0 },
  'FEAT-LIGHT-001': { estMM: 3, actualMM: 3.1 },
  'FEAT-PARK-001': { estMM: 18, actualMM: 16 },
};

// 협력사 개발비/계약금 시드
export const supplierCostSeed: Record<string, { contractMM: number; note: string }> = {
  'SUP-BDC-A': { contractMM: 5, note: 'BDC_FUNC_032 Adapter 개발·검증' },
};

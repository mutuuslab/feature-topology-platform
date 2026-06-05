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
export type RelType = 'derives'|'implemented_by'|'uses_api'|'applies_to'|'controlled_by'|'deployed_as'|'verified_by'|'realized_by'|'emits_event';

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
  { id:'E4', source:'FEAT-BDC-001', target:'POLICY-BDC-PREV', type:'fallback_to', safeDefault:'disabled' },
  { id:'E5', source:'FEAT-BDC-001', target:'FEAT-BDC-002', type:'replaces' },
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
];

export const relations: Relation[] = [
  { id:'R1', source:'SYS-BODY-001', target:'FEAT-BDC-001', type:'derives' },
  { id:'R2', source:'FEAT-BDC-001', target:'SWC-BDC-ADAPTER', type:'implemented_by' },
  { id:'R3', source:'FEAT-BDC-001', target:'API-BDC-POLICY-CONTROL', type:'uses_api' },
  { id:'R4', source:'FEAT-BDC-001', target:'VAR-BDC-001', type:'applies_to' },
  { id:'R5', source:'FEAT-BDC-001', target:'POLICY-BDC-ENABLE', type:'controlled_by' },
  { id:'R6', source:'FEAT-BDC-001', target:'DEP-BDC-001', type:'deployed_as' },
  { id:'R7', source:'FEAT-BDC-001', target:'HIL-BDC-001', type:'verified_by' },
  { id:'R8', source:'FEAT-BDC-001', target:'OTA-RB-002', type:'verified_by' },
  { id:'R9', source:'FEAT-BDC-001', target:'TEL-BDC-001', type:'verified_by' },
  { id:'R10', source:'FEAT-BDC-001', target:'SUP-BDC-A', type:'realized_by' },
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

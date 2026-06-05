// BDC 레퍼런스 시드 (docs/99-reference-data/99-10-bdc-topology.yaml 기반) + Catalog 7종 (PPT S35)
import {
  Feature, Edge, ArtifactNode, Relation, TestEvidence, TelemetrySummary, ChangeSet,
} from './types';

export const features: Feature[] = [
  { id: 'FEAT-BDC-001', level: 'L2', displayName: 'BDC Policy Control', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Approved', safety: 'QM', security: 'Medium',
    deployType: 'Policy-only', baselineVer: 'v1.1',
    internalAlias: { 기획: '스마트 도어 잠금', 시스템: 'Remote Door Lock Command', SW: 'BDC_PolicyControl_v3' } },
  { id: 'FEAT-BDC-002', level: 'L3', displayName: 'BDC Legacy Logic', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Retired', safety: 'QM', security: 'Low', deployType: 'Binary' },
  { id: 'FEAT-BODY-001', level: 'L1', displayName: 'Body Comfort', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Released', safety: 'QM', security: 'Low', deployType: 'TBD' },
  { id: 'FEAT-RUNTIME-001', level: 'L3', displayName: 'Policy Agent Runtime', domain: 'Runtime',
    ownerOrg: 'Platform Team', lifecycle: 'Released', safety: 'QM', security: 'Medium', deployType: 'Binary' },
  { id: 'FEAT-MANUAL-001', level: 'L3', displayName: 'Manual Override', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Released', safety: 'QM', security: 'Low', deployType: 'Binary' },
  { id: 'FEAT-ADAS-001', level: 'L2', displayName: 'AEB Emergency Brake', domain: 'ADAS',
    ownerOrg: 'ADAS Team', lifecycle: 'Released', safety: 'ASIL-D', security: 'High', deployType: 'Binary' },
  { id: 'FEAT-CONN-001', level: 'L1', displayName: 'Remote Door Lock', domain: 'Connectivity',
    ownerOrg: 'Conn. Team', lifecycle: 'Developing', safety: 'QM', security: 'Medium', deployType: 'Policy-only' },
  { id: 'FEAT-SEAT-001', level: 'L2', displayName: 'Seat Heat Auth', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Proposed', safety: 'QM', security: 'Low', deployType: 'TBD' },
  { id: 'FEAT-LIGHT-001', level: 'L2', displayName: 'Welcome Light', domain: 'Body',
    ownerOrg: 'Body Platform Team', lifecycle: 'Verified', safety: 'QM', security: 'Low', deployType: 'Policy-only' },
  { id: 'FEAT-PARK-001', level: 'L2', displayName: 'Remote Parking', domain: 'ADAS',
    ownerOrg: 'ADAS Team', lifecycle: 'Approved', safety: 'ASIL-B', security: 'High', deployType: 'Binary' },
];

// Typed Edges (Feature↔Feature)
export const edges: Edge[] = [
  { id: 'E1', source: 'FEAT-BODY-001', target: 'FEAT-BDC-001', type: 'parent_of' },
  { id: 'E2', source: 'FEAT-BDC-001', target: 'FEAT-RUNTIME-001', type: 'requires', criticality: 'high' },
  { id: 'E3', source: 'FEAT-BDC-001', target: 'FEAT-MANUAL-001', type: 'excludes' },
  { id: 'E4', source: 'FEAT-BDC-001', target: 'POLICY-BDC-PREV', type: 'fallback_to', safeDefault: 'disabled' },
  { id: 'E5', source: 'FEAT-BDC-001', target: 'FEAT-BDC-002', type: 'replaces' },
];

// Feature 외 엔티티
export const artifacts: ArtifactNode[] = [
  { id: 'SYS-BODY-001', kind: 'Requirement', displayName: 'System Req' },
  { id: 'SWE-BDC-010', kind: 'Requirement', displayName: 'SW Req' },
  { id: 'SEC-POLICY-004', kind: 'Requirement', displayName: 'Security Req' },
  { id: 'SWC-BDC-ADAPTER', kind: 'SWComponent', displayName: 'BDC Adapter' },
  { id: 'SWC-POLICY-EVALUATOR', kind: 'SWComponent', displayName: 'Policy Evaluator' },
  { id: 'ECU-BDC', kind: 'ECU', displayName: 'BDC ECU', meta: { hw: 'Gen3' } },
  { id: 'ECU-CCU', kind: 'ECU', displayName: 'Comm ECU' },
  { id: 'API-BDC-POLICY-CONTROL', kind: 'APIService', displayName: 'BDC Policy API', meta: { version: 'v1.5' } },
  { id: 'SIG-DOOR-LOCK', kind: 'Signal', displayName: 'Door Lock Signal' },
  { id: 'DTC-BDC-POLICY-FAIL', kind: 'DTC', displayName: 'Policy Fail DTC' },
  { id: 'VAR-BDC-001', kind: 'VariantRule', displayName: 'KR/EU·MY2027+·Premium·Gen3·SW>=3.2' },
  { id: 'POLICY-BDC-ENABLE', kind: 'ControlPoint', displayName: 'Enable Policy', meta: { type: 'POLICY', safeDefault: 'disabled' } },
  { id: 'CP-BDC-001-KILL', kind: 'ControlPoint', displayName: 'Kill Switch', meta: { type: 'KILL' } },
  { id: 'DEP-BDC-001', kind: 'DeploymentUnit', displayName: 'Policy Package', meta: { deployType: 'Policy-only' } },
  { id: 'RB-BDC-001', kind: 'RollbackPlan', displayName: 'Previous Stable' },
  { id: 'HIL-BDC-001', kind: 'TestCase', displayName: 'HIL Test' },
  { id: 'OTA-RB-002', kind: 'TestCase', displayName: 'OTA Rollback Test' },
  { id: 'TEL-BDC-001', kind: 'TestCase', displayName: 'Telemetry Test' },
  { id: 'SUP-BDC-A', kind: 'SupplierFunction', displayName: 'Supplier A (BDC_FUNC_032)' },
];

// Feature → Artifact 관계 (FEAT-BDC-001 중심)
export const relations: Relation[] = [
  { id: 'R1', source: 'SYS-BODY-001', target: 'FEAT-BDC-001', type: 'derives' },
  { id: 'R2', source: 'FEAT-BDC-001', target: 'SWC-BDC-ADAPTER', type: 'implemented_by' },
  { id: 'R3', source: 'FEAT-BDC-001', target: 'API-BDC-POLICY-CONTROL', type: 'uses_api' },
  { id: 'R4', source: 'FEAT-BDC-001', target: 'VAR-BDC-001', type: 'applies_to' },
  { id: 'R5', source: 'FEAT-BDC-001', target: 'POLICY-BDC-ENABLE', type: 'controlled_by' },
  { id: 'R6', source: 'FEAT-BDC-001', target: 'DEP-BDC-001', type: 'deployed_as' },
  { id: 'R7', source: 'FEAT-BDC-001', target: 'HIL-BDC-001', type: 'verified_by' },
  { id: 'R8', source: 'FEAT-BDC-001', target: 'OTA-RB-002', type: 'verified_by' },
  { id: 'R9', source: 'FEAT-BDC-001', target: 'TEL-BDC-001', type: 'verified_by' },
  { id: 'R10', source: 'FEAT-BDC-001', target: 'SUP-BDC-A', type: 'realized_by' },
];

export const evidence: TestEvidence[] = [
  { id: 'EV1', testCaseId: 'HIL-BDC-001', result: 'pass', coverage: 0.9 },
  { id: 'EV2', testCaseId: 'OTA-RB-002', result: 'pending', coverage: 0 },
  { id: 'EV3', testCaseId: 'TEL-BDC-001', result: 'pass', coverage: 0.8 },
];

export const telemetry: TelemetrySummary[] = [
  { featureId: 'FEAT-BDC-001', activationSuccess: 0.987, policyApplyFail: '12/10K', rollbackCount: 3,
    runtimeState: 'enabled',
    recentEvents: [
      { type: 'POLICY_APPLY_SUCCESS', detail: 'VIN cohort pilot_kr_01' },
      { type: 'POLICY_APPLY_FAIL', detail: 'Reason: ECU version mismatch' },
      { type: 'POLICY_ROLLBACK', detail: 'Target: previous stable policy' },
    ] },
];

export const changeSets: ChangeSet[] = [
  { id: 'CS-BDC-001', featureId: 'FEAT-BDC-001', fromVer: 'v1.0', toVer: 'v1.1', entries: [
    { type: 'ADD', area: 'Requirement', detail: 'SEC-POLICY-004 추가 (보안 요구사항)' },
    { type: 'ADD', area: 'Architecture', detail: 'SWC-POLICY-EVALUATOR 추가' },
    { type: 'ADD', area: 'Architecture', detail: 'ECU-CCU 추가 (통신 연계)' },
    { type: 'MODIFY', area: 'Variant', detail: 'EU 지역 추가 (KR → KR/EU)' },
    { type: 'ADD', area: 'Control', detail: 'POLICY-BDC-KILL-SWITCH 추가' },
    { type: 'ADD', area: 'Verification', detail: 'OTA-ROLLBACK-002, TEL-BDC-001 추가' },
    { type: 'MODIFY', area: 'Supplier', detail: 'API Contract v1.4 → v1.5' },
  ] },
];

// 카탈로그 Health (n/6): Requirement·Test·Supplier·Variant·Rollback·Telemetry
export const healthByFeature: Record<string, number> = {
  'FEAT-BDC-001': 5, 'FEAT-BDC-002': 6, 'FEAT-BODY-001': 4, 'FEAT-RUNTIME-001': 5,
  'FEAT-MANUAL-001': 4, 'FEAT-ADAS-001': 6, 'FEAT-CONN-001': 3, 'FEAT-SEAT-001': 1,
  'FEAT-LIGHT-001': 5, 'FEAT-PARK-001': 4,
};

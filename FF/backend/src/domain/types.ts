// 도메인 타입 — 18 Entity / 10 Edge / Lifecycle / Gate (docs/30-data-model, 40-rules-engines 기반)

export type Level = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type Lifecycle = 'Proposed' | 'Approved' | 'Developing' | 'Verified' | 'Released' | 'Retired';
export type DeployType = 'Binary' | 'Policy-only' | 'Calibration' | 'Manual' | 'TBD';
export type Safety = 'QM' | 'ASIL-A' | 'ASIL-B' | 'ASIL-C' | 'ASIL-D';
export type Security = 'Low' | 'Medium' | 'High';
export type GateStatus = 'PASS' | 'PENDING' | 'FAIL';

export type EdgeType =
  | 'parent_of' | 'child_of' | 'composed_of' | 'requires' | 'excludes'
  | 'overrides' | 'fallback_to' | 'degrades_to' | 'replaces' | 'duplicates';

export type RelType =
  | 'derives' | 'implemented_by' | 'uses_api' | 'applies_to' | 'controlled_by'
  | 'deployed_as' | 'verified_by' | 'realized_by' | 'emits_event';

export interface Feature {
  id: string;
  level: Level;
  displayName: string;
  internalAlias?: Record<string, string>;
  ownerOrg: string;
  domain: string;
  lifecycle: Lifecycle;
  safety: Safety;
  security: Security;
  deployType: DeployType;
  baselineVer?: string;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  criticality?: 'low' | 'med' | 'high';
  safeDefault?: string;
  note?: string;
}

// Feature 외 엔티티(요약 노드) — impact 탐색 대상
export interface ArtifactNode {
  id: string;
  kind: 'Requirement' | 'SWComponent' | 'ECU' | 'APIService' | 'Signal' | 'DTC'
      | 'VariantRule' | 'ControlPoint' | 'DeploymentUnit' | 'RollbackPlan'
      | 'TestCase' | 'TestEvidence' | 'SupplierFunction' | 'TelemetryEvent';
  displayName: string;
  meta?: Record<string, any>;
}

// Feature ↔ Artifact 관계
export interface Relation {
  id: string;
  source: string; // feature id
  target: string; // artifact id
  type: RelType;
}

export interface TestEvidence {
  id: string;
  testCaseId: string;
  result: 'pass' | 'fail' | 'pending';
  coverage?: number;
}

export interface TelemetrySummary {
  featureId: string;
  activationSuccess: number; // 0..1
  policyApplyFail: string;   // "12/10K"
  rollbackCount: number;
  runtimeState: string;
  recentEvents: { type: string; detail: string }[];
}

export interface ChangeSetEntry {
  type: 'ADD' | 'MODIFY' | 'REMOVE';
  area: string;
  detail: string;
}

export interface ChangeSet {
  id: string;
  featureId: string;
  fromVer: string;
  toVer: string;
  entries: ChangeSetEntry[];
}

// Decision Engine I/O
export interface ImpactResult {
  features: string[];
  requirements: string[];
  swcs: string[];
  ecus: string[];
  apis: string[];
  variants: string[];
  tests: string[];
  suppliers: string[];
  deploymentImpact: string;
  safetySecurity: string;
  confidence: 'High' | 'Medium' | 'Low';
}

export interface VerificationResult {
  mandatoryTests: string[];
  missingEvidence: string[];
  coverageGap: string[];
  gateResult: GateStatus;
}

export interface DeployResult {
  deployType: DeployType;
  requiredGates: string[];
  rollbackTest: boolean;
  manualReview: boolean;
  confidence: 'High' | 'Medium' | 'Low';
  rationale: string[];
}

export interface SupplierResult {
  supplierScope: string[];
  acceptanceCriteria: string;
  contractGap: string;
  evidenceStatus: string;
}

export interface Gate { id: string; name: string; status: GateStatus; detail: string; }
export interface ReadinessResult { featureId: string; gates: Gate[]; passCount: number; decision: 'RELEASE' | 'HOLD'; }

export interface RuleViolation {
  rule: string;
  featureId: string;
  severity: 'blocking' | 'warning';
  message: string;
}

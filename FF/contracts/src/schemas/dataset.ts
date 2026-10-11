// Catalog BOM DATASET v0.81 정규화 스키마 — 적재기(tools/dataset)와 백엔드 시드가 공유한다.
// 자리표시 문자열(미입력/미발급/해당 없음/의존 관계 없음.)은 null·[]로 바꾸고 _missing에 사유를 남긴다.
import { z } from 'zod';
import { Asil, CatalogType, ControlPointType, DependencyVerdict, GateId, GateResult, GateStatus, Lifecycle, RelationType, SaleType, TargetVersionCheck } from '../enums';

export const MissingReason = z.enum(['미입력', '미발급', '해당 없음', '의존 관계 없음']);
export type MissingReason = z.infer<typeof MissingReason>;
const Missing = z.record(z.string(), MissingReason);

const FeatureId = z.string().regex(/^FEAT-\d{5}$/);
const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
const BaselineId = z.string().regex(/^BL-\d{5}$/);

export const FunctionRef = z.object({ functionId: z.string().regex(/^FUNC-\d{6}$/), label: z.string() });

/** Feature Registry 시트 1행 = Feature 1버전 (19 속성 + 참고 열) */
export const FeatureVersionRow = z.object({
  featureId: FeatureId,
  name: z.string().min(1),
  description: z.string(),
  requirementIds: z.array(z.string()),
  country: z.string(),
  vehicleModel: z.string(),
  trim: z.string(),
  version: Version,
  baselineId: BaselineId.nullable(),
  lifecycle: Lifecycle,
  ownerId: z.string(),
  tags: z.array(z.string()),
  asil: Asil,
  upgVc: z.array(z.string()),
  functions: z.array(FunctionRef),
  swIds: z.array(z.string()),
  swVersions: z.array(z.string()),
  ecuPnos: z.array(z.string()),
  controlPoints: z.array(ControlPointType),
  dependencyIds: z.array(z.string().regex(/^DEP-\d{5}$/)),
  catalogIds: z.array(z.string()),
  gateRecordIds: z.array(z.string()),
  _missing: Missing,
});
export type FeatureVersionRow = z.infer<typeof FeatureVersionRow>;

/** BOM_Item — 확정 Baseline 스냅샷 */
export const BomItemRow = FeatureVersionRow.omit({ catalogIds: true, gateRecordIds: true, baselineId: true }).extend({
  baselineId: BaselineId,
});
export type BomItemRow = z.infer<typeof BomItemRow>;

export const ProductRow = z.object({
  catalogId: z.string().regex(/^CAT-\d{5}$/),
  name: z.string(),
  description: z.string(),
  country: z.string(),
  vehicleModel: z.string(),
  trim: z.string(),
  version: Version,
  tags: z.array(z.string()),
  saleType: SaleType,
  baselineIds: z.array(BaselineId),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ownerId: z.string(),
  lifecycle: Lifecycle,
  type: CatalogType,
  _missing: Missing,
});
export type ProductRow = z.infer<typeof ProductRow>;

export const DependencyRow = z.object({
  dependencyId: z.string().regex(/^DEP-\d{5}$/),
  type: RelationType,
  sourceFeatureId: FeatureId,
  sourceVersion: Version,
  targetFeatureId: FeatureId,
  targetVersion: Version.nullable(),
  country: z.string(),
  vehicleModel: z.string(),
  trim: z.string(),
  targetVersionCheck: TargetVersionCheck,
  verdict: DependencyVerdict,
  ruleVersion: z.string(),
  rationale: z.string(),
  _missing: Missing,
});
export type DependencyRow = z.infer<typeof DependencyRow>;

export const GateRecordRow = z.object({
  gateRecordId: z.string().regex(/^SIM-G[1-9]-\d{6}$/),
  featureId: FeatureId,
  featureVersion: Version,
  country: z.string(),
  gate: GateId,
  gateName: z.string(),
  inputResult: GateResult,
  rationale: z.string(),
  evidenceRef: z.string().nullable(),
  judgeRole: z.string(),
  /** ISO 8601, +09:00 (원본 'YYYY-MM-DD HH:MM KST') */
  judgedAt: z.string(),
  status: GateStatus,
  gateStageLifecycle: Lifecycle,
  currentLifecycle: Lifecycle,
  transitionNote: z.string(),
  _missing: Missing,
});
export type GateRecordRow = z.infer<typeof GateRecordRow>;

export const FeatureFunctionRow = z.object({
  functionId: z.string().regex(/^FUNC-\d{6}$/),
  featureId: FeatureId,
  featureVersion: Version,
  name: z.string(),
  description: z.string(),
  type: z.enum(['ATOMIC', 'SUPPORTING']),
  sequence: z.number().int(),
  swId: z.string(),
  swVersion: z.string(),
  ecuPno: z.string(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']),
  _missing: Missing,
});
export type FeatureFunctionRow = z.infer<typeof FeatureFunctionRow>;

export const SwMasterRow = z.object({
  swId: z.string(),
  name: z.string(),
  version: z.string(),
  artifactId: z.string(),
  purpose: z.string(),
  description: z.string(),
  swType: z.string(),
  executionUnit: z.string(),
  package: z.string(),
  ecuPno: z.string(),
  runtime: z.string(),
  owner: z.string(),
  supplier: z.string(),
  repository: z.string(),
  safetyClass: z.string(),
  securityClass: z.string(),
  lifecycle: z.string(),
  checksum: z.string(),
  requirementId: z.string(),
  testEvidence: z.string(),
  _missing: Missing,
});
export type SwMasterRow = z.infer<typeof SwMasterRow>;

export const EcuMasterRow = z.object({
  ecuPno: z.string(),
  name: z.string(),
  domain: z.string(),
  vehiclePlatform: z.string(),
  hwRevision: z.string(),
  osRuntime: z.string(),
  network: z.string(),
  supplier: z.string(),
  asil: z.string(),
  owner: z.string(),
  lifecycle: z.string(),
  _missing: Missing,
});
export type EcuMasterRow = z.infer<typeof EcuMasterRow>;

export const VersionRationaleRow = z.object({
  featureId: FeatureId,
  fromVersion: Version,
  toVersion: Version.nullable(),
  toBaselineId: BaselineId.nullable(),
  fromDescription: z.string(),
  toDescription: z.string().nullable(),
  toTags: z.array(z.string()),
  toAtomicFunctionId: z.string().nullable(),
  rationale: z.string(),
  fromCoreSwVersion: z.string().nullable(),
  toCoreSwVersion: z.string().nullable(),
  _missing: Missing,
});
export type VersionRationaleRow = z.infer<typeof VersionRationaleRow>;

export const PrecheckRuleRow = z.object({
  ruleId: z.string().regex(/^DATA-PRECHECK-1\.0-\d{2}$/),
  criterion: z.string(),
  condition: z.string(),
  exampleResult: z.enum(['PASS', 'CONDITIONAL', 'FAIL']),
  exampleReason: z.string(),
  _missing: Missing,
});
export type PrecheckRuleRow = z.infer<typeof PrecheckRuleRow>;

export const EvidenceRow = z.object({
  evidenceRef: z.string(),
  gate: GateId,
  gateRecordId: z.string(),
  featureId: FeatureId,
  featureVersion: Version,
  featureName: z.string(),
  featureDescription: z.string(),
  scope: z.string(),
  owner: z.string(),
  lifecycle: Lifecycle,
  inputResult: GateResult,
  resultReason: z.string(),
  additionalEvidence: z.string().nullable(),
  _missing: Missing,
});
export type EvidenceRow = z.infer<typeof EvidenceRow>;

/** 픽스처 파일 이름 ↔ 스키마 — 적재기·검사기·백엔드 시드의 단일 목록 */
export const DATASET_FILES = {
  features: FeatureVersionRow,
  products: ProductRow,
  bomItems: BomItemRow,
  dependencies: DependencyRow,
  gateRecords: GateRecordRow,
  featureFunctions: FeatureFunctionRow,
  swMaster: SwMasterRow,
  ecuMaster: EcuMasterRow,
  versionRationale: VersionRationaleRow,
  precheckRules: PrecheckRuleRow,
  evidence: EvidenceRow,
} as const;
export type DatasetFile = keyof typeof DATASET_FILES;

export interface Dataset {
  features: FeatureVersionRow[];
  products: ProductRow[];
  bomItems: BomItemRow[];
  dependencies: DependencyRow[];
  gateRecords: GateRecordRow[];
  featureFunctions: FeatureFunctionRow[];
  swMaster: SwMasterRow[];
  ecuMaster: EcuMasterRow[];
  versionRationale: VersionRationaleRow[];
  precheckRules: PrecheckRuleRow[];
  evidence: EvidenceRow[];
}

export interface DatasetWarning {
  file: DatasetFile;
  row: number; // 원본 엑셀 행 번호
  key: string;
  code: 'SCHEMA' | 'DATA_QUALITY';
  message: string;
}

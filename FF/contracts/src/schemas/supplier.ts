// 협력사 패키지·검수(D05-01, 80-60) — OEM Feature ID ↔ 협력사 Function ID·SW Component 매핑, Feature ID 단위 Supplier API Release Package(10항목),
// Feature별 검수 기준(개정 추가만), 검수 요청·결과. 요청 본문 스키마만 둔다 — 경로 표(routes)가 첫 화면에 실리므로 규칙·이름표는 rules/supplier.ts.
import { z } from 'zod';
import { Asil, type Role } from '../enums';

/** 역할 — 매핑은 구현·Feature 작성, 패키지 등록·산출물 제출·검수 요청은 협력사 연계를 맡는 구현 담당, 검수 기준·결과는 협력사 품질 승인(Gate 판정자, G6) */
export const SUPPLIER_MAPPING_ROLES: Role[] = ['IMPLEMENTER', 'FEATURE_AUTHOR'];
export const SUPPLIER_PACKAGE_ROLES: Role[] = ['IMPLEMENTER'];
export const SUPPLIER_REVIEW_ROLES: Role[] = ['GATE_JUDGE'];
export const SUPPLIER_CRITERIA_ROLES: Role[] = ['GATE_JUDGE'];

/** Supplier API Release Package 10항목(80-60 §1, 명세 FR-SPM-002-001 비고 순서) — 10항목 모두 필수(결정 D-GAP-2) */
export const SUPPLIER_ARTIFACT_TYPES = ['API_CONTRACT', 'HUMAN_DOC', 'FEATURE_MAPPING', 'CAPABILITY_MANIFEST', 'VARIANT_COMPAT', 'DIAGNOSTICS', 'SAFETY_SECURITY', 'SDK_STUB_MOCK', 'TEST_EVIDENCE', 'RELEASE_NOTE'] as const;
export const SupplierArtifactType = z.enum(SUPPLIER_ARTIFACT_TYPES);
export type SupplierArtifactType = z.infer<typeof SupplierArtifactType>;

export const SUPPLIER_PACKAGE_STATUSES = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED'] as const;
export type SupplierPackageStatus = (typeof SUPPLIER_PACKAGE_STATUSES)[number];

/** 검수 기준 종류 — 협력사 산출물 값으로 자동 판정한다(FR-SPM-003-002). 필수 산출물 10항목은 기준이 아니라 고정 규칙(검수 요청 때 확인) */
export const SUPPLIER_CRITERION_KINDS = ['MIN_COVERAGE', 'ALL_TESTS_PASS', 'BUILD_CLEAN', 'ASIL_COVERS_FEATURE', 'VARIANT_COVERS_FEATURE', 'CAPABILITY_COVERS_SW', 'BREAKING_HAS_MIGRATION'] as const;
export const SupplierCriterionKind = z.enum(SUPPLIER_CRITERION_KINDS);
export type SupplierCriterionKind = z.infer<typeof SupplierCriterionKind>;

const FeatureId = z.string().regex(/^FEAT-\d{5}$/);
const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/, 'x.y.z 형식');
const Code = z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/, '영문·숫자·_ . : / - 만');
const Label = z.string().trim().min(1).max(200);
const Supplier = z.string().trim().min(2).max(60);
const Reason = z.string().trim().min(2).max(500);
const List = <T extends z.ZodTypeAny>(s: T, max = 40) => z.array(s).min(1).max(max);

/** OEM Feature ID ↔ 협력사 Function ID 매핑 등록(FR-SPM-001-001) */
export const CreateSupplierMappingBody = z
  .object({
    featureId: FeatureId,
    supplier: Supplier,
    supplierFunctionId: Code,
    name: Label,
    /** 대응하는 OEM 기능 분해 ID(선택) */
    oemFunctionId: z.string().regex(/^FUNC-\d{6}$/).nullable().default(null),
  })
  .strict();
export type CreateSupplierMappingBody = z.infer<typeof CreateSupplierMappingBody>;

/** 협력사 Function ID ↔ 협력사 SW Component 매핑 등록(FR-SPM-001-002). swId는 OEM SW 마스터 ID(선택, 있으면 같은 협력사 SW여야 한다) */
export const AddSupplierSwcBody = z
  .object({
    swcId: Code,
    name: Label,
    swId: z.string().trim().min(2).max(60).nullable().default(null),
    ecuPno: z.string().trim().min(2).max(40).nullable().default(null),
  })
  .strict();
export type AddSupplierSwcBody = z.infer<typeof AddSupplierSwcBody>;

/** Feature ID 단위 Release Package(FR-SPM-002-004) — 같은 Feature·협력사 안에서 버전은 겹치지 않는다. basedOn이면 그 패키지의 마지막 산출물을 이어받는다 */
export const CreateSupplierPackageBody = z
  .object({
    featureId: FeatureId,
    featureVersion: SemVer,
    supplier: Supplier,
    version: SemVer,
    basedOn: z.string().regex(/^SPK-\d{5}$/).nullable().default(null),
  })
  .strict();
export type CreateSupplierPackageBody = z.infer<typeof CreateSupplierPackageBody>;

const Checksum = z.string().trim().max(80);
const SwVer = z.object({ swId: z.string().trim().min(2).max(60), version: SemVer }).strict();
/** Capability Manifest(FR-SPM-002-005) — 지원 HW 버전·SW 버전·ECU Capability */
export const CapabilityManifest = z
  .object({
    hwVersions: List(z.string().trim().min(1).max(20)),
    swVersions: List(SwVer),
    ecuCapabilities: List(z.object({ ecuPno: z.string().trim().min(2).max(40), capabilities: List(z.string().trim().min(2).max(60)) }).strict()),
  })
  .strict();
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;
/** Variant Compatibility(FR-SPM-002-006) — 차종(또는 플랫폼)·지역·트림·모델연도 */
export const VariantCompat = z
  .object({
    vehicleModel: z.string().trim().min(1).max(40),
    region: z.string().trim().min(2).max(10),
    /** 비우면 모든 트림 */
    trim: z.string().trim().min(1).max(40).nullable().default(null),
    modelYears: List(z.number().int().min(2015).max(2045), 12),
  })
  .strict();
export type VariantCompat = z.infer<typeof VariantCompat>;
export const TestEvidenceSummary = z
  .object({
    unitPassed: z.number().int().min(0),
    unitTotal: z.number().int().min(0),
    integrationPassed: z.number().int().min(0),
    integrationTotal: z.number().int().min(0),
    coveragePct: z.number().min(0).max(100),
    buildStatus: z.enum(['SUCCESS', 'FAILED']),
    buildWarnings: z.number().int().min(0),
    evidenceIds: List(Code, 50),
  })
  .strict()
  .refine((t) => t.unitPassed <= t.unitTotal && t.integrationPassed <= t.integrationTotal, '통과 건수가 전체보다 많을 수 없습니다');
export type TestEvidenceSummary = z.infer<typeof TestEvidenceSummary>;

/** 산출물 제출(FR-SPM-002-001·002) — 유형·버전·위치·체크섬. 제출자·제출 시각은 요청 계정·서버 시각. 본문(text)이 있으면 서버가 SHA-256을 다시 계산해 대조한다 */
export const SubmitSupplierArtifactBody = z
  .object({
    type: SupplierArtifactType,
    version: z.string().trim().min(1).max(40),
    title: Label,
    uri: z.string().trim().min(3).max(300),
    checksum: Checksum,
    text: z.string().max(20_000).nullable().default(null),
    apiFormat: z.enum(['OPENAPI', 'PROTOBUF']).nullable().default(null),
    mappingIds: z.array(z.string().regex(/^SFM-\d{5}$/)).max(40).nullable().default(null),
    capability: CapabilityManifest.nullable().default(null),
    variants: z.array(VariantCompat).max(40).nullable().default(null),
    diagnostics: z.object({ dtcs: z.array(Code).max(80), events: z.array(Code).max(80) }).strict().nullable().default(null),
    safety: z.object({ asil: Asil, cybersecurityClaim: Label, certRef: z.string().trim().min(2).max(80).nullable().default(null) }).strict().nullable().default(null),
    testEvidence: TestEvidenceSummary.nullable().default(null),
    releaseNote: z.object({ releaseId: z.string().trim().max(60), breakingChanges: z.boolean(), migration: z.string().trim().max(1000).nullable().default(null) }).strict().nullable().default(null),
  })
  .strict()
  .superRefine((b, ctx) => {
    const need: Partial<Record<SupplierArtifactType, keyof typeof b>> = {
      API_CONTRACT: 'apiFormat',
      FEATURE_MAPPING: 'mappingIds',
      CAPABILITY_MANIFEST: 'capability',
      VARIANT_COMPAT: 'variants',
      DIAGNOSTICS: 'diagnostics',
      SAFETY_SECURITY: 'safety',
      TEST_EVIDENCE: 'testEvidence',
      RELEASE_NOTE: 'releaseNote',
    };
    const key = need[b.type];
    if (key && (b[key] === null || (Array.isArray(b[key]) && !(b[key] as unknown[]).length))) ctx.addIssue({ code: 'custom', path: [key], message: `${b.type} 산출물은 ${String(key)} 내용이 필요합니다` });
    for (const [t, k] of Object.entries(need)) if (t !== b.type && b[k] !== null) ctx.addIssue({ code: 'custom', path: [k], message: `${String(k)}은(는) ${t} 산출물에만 넣습니다` });
  });
export type SubmitSupplierArtifactBody = z.infer<typeof SubmitSupplierArtifactBody>;

/** 검수 요청 — 요청 의견(선택) */
export const SubmitSupplierPackageBody = z.object({ note: z.string().trim().max(500).nullable().default(null) }).strict();
export type SubmitSupplierPackageBody = z.infer<typeof SubmitSupplierPackageBody>;

/** 검수 결과·의견 저장(FR-SPM-003-003) — 산출물마다 결과·의견, 불합격 항목은 의견 필수 */
export const ReviewSupplierPackageBody = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    comment: Reason,
    items: z.array(z.object({ type: SupplierArtifactType, result: z.enum(['PASS', 'FAIL']), comment: z.string().trim().max(500).nullable().default(null) }).strict()).min(1).max(10),
  })
  .strict()
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    b.items.forEach((i, n) => {
      if (seen.has(i.type)) ctx.addIssue({ code: 'custom', path: ['items', n, 'type'], message: `${i.type}이(가) 두 번 있습니다` });
      seen.add(i.type);
      if (i.result === 'FAIL' && !(i.comment && i.comment.length >= 2)) ctx.addIssue({ code: 'custom', path: ['items', n, 'comment'], message: '불합격 항목은 의견이 필요합니다' });
    });
    if (b.decision === 'ACCEPT' && b.items.some((i) => i.result === 'FAIL')) ctx.addIssue({ code: 'custom', path: ['decision'], message: '불합격 항목이 있으면 합격으로 판정할 수 없습니다' });
  });
export type ReviewSupplierPackageBody = z.infer<typeof ReviewSupplierPackageBody>;

/** 검수 기준 등록(FR-SPM-003-001) — Feature ID별, 등록하면 새 개정(이전 개정은 이력) */
export const SupplierCriterion = z.object({ kind: SupplierCriterionKind, threshold: z.number().min(0).max(100).nullable().default(null), note: z.string().trim().max(200).nullable().default(null) }).strict();
export type SupplierCriterion = z.infer<typeof SupplierCriterion>;
export const CreateSupplierCriteriaBody = z
  .object({ featureId: FeatureId, items: z.array(SupplierCriterion).min(1).max(SUPPLIER_CRITERION_KINDS.length), reason: Reason })
  .strict()
  .superRefine((b, ctx) => {
    const kinds = b.items.map((i) => i.kind);
    if (new Set(kinds).size !== kinds.length) ctx.addIssue({ code: 'custom', path: ['items'], message: '같은 기준 종류가 두 번 있습니다' });
    b.items.forEach((i, n) => {
      const needs = i.kind === 'MIN_COVERAGE' || i.kind === 'BUILD_CLEAN';
      if (needs && i.threshold === null) ctx.addIssue({ code: 'custom', path: ['items', n, 'threshold'], message: `${i.kind}은(는) 기준값이 필요합니다` });
      if (!needs && i.threshold !== null) ctx.addIssue({ code: 'custom', path: ['items', n, 'threshold'], message: `${i.kind}은(는) 기준값을 받지 않습니다` });
    });
  });
export type CreateSupplierCriteriaBody = z.infer<typeof CreateSupplierCriteriaBody>;

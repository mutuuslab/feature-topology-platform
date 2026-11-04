// Feature DB — 차종과 무관한 기능 정의·규모·근거 기준 행 (설계 docs/30-data-model/30-95, 엑셀 03_FeatureDB v1.3 이전).
// 적재기(tools/refdb)와 백엔드 시드·API·화면이 공유한다. 파생 값(Overall·포인트)은 저장하지 않고 rules/refdb가 계산한다.
import { z } from 'zod';
import { Asil } from '../enums';

/** 기준 행 ID — '도메인약어-컴포넌트약어-일련번호' (예: CH-BRK-009). 한 번 쓴 ID는 다시 쓰지 않는다 */
export const FeatureRefId = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{2,5}-\d{3}$/);
export type FeatureRefId = z.infer<typeof FeatureRefId>;

/** 관리 상태 — 엑셀 BQ열(활성·검토 필요·폐기 예정·폐기) + FF에서 생긴 '요청 중' */
export const FEATURE_REF_STATUSES = ['ACTIVE', 'REVIEW', 'DEPRECATED', 'RETIRED', 'PENDING'] as const;
export const FeatureRefStatus = z.enum(FEATURE_REF_STATUSES);
export type FeatureRefStatus = z.infer<typeof FeatureRefStatus>;

export const TshirtSize = z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
export type TshirtSize = z.infer<typeof TshirtSize>;
export const SwStack = z.enum(['Application', 'Platform', 'Back-end']);
export const RefLifecycle = z.enum(['Commodity', 'Differentiating', 'Innovation']);
export const QualityLevel = z.enum(['High', 'Mid', 'Low']);
export const SizeEvidenceGrade = z.enum(['A', 'B', 'C', 'D']);

/** 03b 카탈로그 상세 정의(116행 파일럿만 값이 있다) */
export const FeatureRefDefinition = z.object({
  level: z.string().nullable(),
  parentRefId: z.string().nullable(),
  summary: z.string().nullable(),
  trigger: z.string().nullable(),
  scopeIn: z.array(z.string()),
  scopeOut: z.array(z.string()),
  scopeOutRefs: z.array(z.string()),
  io: z.object({ entry: z.array(z.string()), exit: z.array(z.string()), read: z.array(z.string()), write: z.array(z.string()) }),
  drivers: z.object({ states: z.number().nullable(), dtcs: z.number().nullable(), calibrations: z.number().nullable(), variants: z.number().nullable() }),
  regulations: z.string().nullable(),
  verification: z.string().nullable(),
  typicalChanges: z.array(z.string()),
  sharedFunctions: z.array(z.string()),
  authoringStatus: z.string().nullable(),
});
export type FeatureRefDefinition = z.infer<typeof FeatureRefDefinition>;

/** 기준 행 1개 = 엑셀 03_FeatureDB 1행의 마스터 열 */
export const FeatureRefRow = z.object({
  refId: FeatureRefId,
  status: FeatureRefStatus,
  replacedBy: FeatureRefId.nullable(),
  registeredIn: z.string().nullable(),
  evidenceCheckedAt: z.string().nullable(),
  domain: z.string().min(1),
  cluster: z.string().min(1),
  component: z.string().min(1),
  swStack: SwStack,
  nameEn: z.string().min(1),
  nameKo: z.string().min(1),
  aliases: z.array(z.string()),
  lifecycle: RefLifecycle,
  techStack: z.string().nullable(),
  autoQuality: QualityLevel,
  techQuality: QualityLevel.nullable(),
  asilRep: Asil,
  method: z.string().nullable(),
  tshirt: TshirtSize,
  bundleId: z.string().nullable(),
  bundleRep: z.boolean(),
  sizeEvidenceGrade: SizeEvidenceGrade.nullable(),
  /** 금액 필드 — 산정 역할만 열람(20-94 §8). 공개 API 응답에서는 지운다 */
  benchmarkEur: z.number().nullable(),
  kearneyNote: z.string().nullable(),
  makeBuyVolume: z.string().nullable(),
  makeBuyPremium: z.string().nullable(),
  relevance: z.string().nullable(),
  sourceIds: z.array(z.string()),
  sourceDetail: z.string().nullable(),
  remark: z.string().nullable(),
  basisType: z.string().nullable(),
  vehicleType: z.string().nullable(),
  region: z.string().nullable(),
  duplicateOf: z.string().nullable(),
  requires: z.array(z.string()),
  excludes: z.array(z.string()),
  procurement: z.string().nullable(),
  swPackage: z.string().nullable(),
  licenseItem: z.string().nullable(),
  billing: z.string().nullable(),
  adminMemo: z.string().nullable(),
  definition: FeatureRefDefinition.nullable(),
});
export type FeatureRefRow = z.infer<typeof FeatureRefRow>;

/** 공개 응답 — 금액 필드를 뺀 기준 행 */
export type FeatureRefPublic = Omit<FeatureRefRow, 'benchmarkEur'>;

export const RefSourceRow = z.object({
  sourceId: z.string().min(1),
  title: z.string(),
  publisher: z.string().nullable(),
  edition: z.string().nullable(),
  url: z.string().nullable(),
  note: z.string().nullable(),
});
export type RefSourceRow = z.infer<typeof RefSourceRow>;

export const RefGlossaryRow = z.object({
  term: z.string().min(1),
  meaning: z.string(),
  refIds: z.array(z.string()),
  confirmed: z.boolean(),
});
export type RefGlossaryRow = z.infer<typeof RefGlossaryRow>;

export const RefSubfunctionRow = z.object({
  candidateId: z.string().min(1),
  groupId: z.string().nullable(),
  group: z.string().nullable(),
  nameEn: z.string(),
  nameKo: z.string(),
  component: z.string(),
  domain: z.string(),
  anchor: z.string().nullable(),
  scope: z.string().nullable(),
  verificationFocus: z.string().nullable(),
});
export type RefSubfunctionRow = z.infer<typeof RefSubfunctionRow>;

/** 분류 — 도메인(L0) → 클러스터(L1) → 컴포넌트(L1 하위). 약어는 ID 규칙에 쓴다 */
export const TaxonomyNodeRow = z.object({
  nodeId: z.string().min(1),
  level: z.enum(['DOMAIN', 'CLUSTER', 'COMPONENT']),
  parentId: z.string().nullable(),
  name: z.string().min(1),
  abbr: z.string().nullable(),
});
export type TaxonomyNodeRow = z.infer<typeof TaxonomyNodeRow>;

/** Feature 버전 ↔ 기준 행 연결 — 대표 1 + 포함 N (D-REF-2) */
export const FeatureRefLink = z.object({
  refId: FeatureRefId,
  role: z.enum(['PRIMARY', 'INCLUDED']),
  /** 연결 당시 Feature DB 발행 버전 — 서버가 채운다 */
  refRelease: z.string().optional(),
});
export type FeatureRefLink = z.infer<typeof FeatureRefLink>;

/** 연결 목록 — 대표 정확히 1개, 같은 행 두 번 금지 */
export const FeatureRefLinks = z
  .array(FeatureRefLink)
  .min(1)
  .refine((xs) => xs.filter((x) => x.role === 'PRIMARY').length === 1, { message: '대표 기준 행은 정확히 1개여야 합니다' })
  .refine((xs) => new Set(xs.map((x) => x.refId)).size === xs.length, { message: '같은 기준 행을 두 번 연결할 수 없습니다' });

/** 기준 DB에 없는 기능의 추가 요청(D-REF-7) — 서버가 정식 ID를 즉시 부여하고 PENDING으로 만든다 */
export const FeatureRefRequestBody = z
  .object({
    domain: z.string().min(1).max(80),
    cluster: z.string().min(1).max(80),
    component: z.string().min(1).max(80),
    nameEn: z.string().min(1).max(200),
    nameKo: z.string().min(1).max(200),
    tshirt: TshirtSize,
    asilRep: Asil,
    swStack: SwStack.default('Application'),
    evidence: z.string().min(1).max(2000),
  })
  .strict();
export type FeatureRefRequestBody = z.infer<typeof FeatureRefRequestBody>;

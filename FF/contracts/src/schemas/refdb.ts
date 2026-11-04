// Feature DB(기준 기능 정보) 계약 — 엑셀 03_FeatureDB와 딸린 시트를 FF로 옮긴 참조 표의 모양(docs/30-data-model/30-95 §5).
// 기준 행은 차종과 무관한 기능 정의·특성·근거다. FF Feature는 등록 때 기준 행을 대표 1 + 포함 N으로 참조한다(D-REF-2·3).
// 엑셀 열거형 글자 열(SW 계층·수명주기·차량 유형 …)은 엑셀 값을 그대로 받는다 — 값 목록은 Feature DB가 원천이고 여기서 닫지 않는다.
// §9 필수 정보(도메인·클러스터·컴포넌트·영/한 기능명·T-shirt·대표 ASIL)만 빈 값을 막는다.
import { z } from 'zod';
import { Asil } from '../enums';

const text = z.string().trim();
const required = text.min(1);

/** 기준 행 ID — `도메인약어-컴포넌트약어-일련번호`(예: BC-BCM-001 · CO-V2X-003 · PL-SOVD-001). 한 번 쓴 ID는 폐기해도 다시 쓰지 않는다 */
export const REF_ID_PATTERN = /^[A-Z]{2}-[A-Z][A-Z0-9]{1,3}-\d{3}$/;
export const RefId = z.string().regex(REF_ID_PATTERN, '기준 행 ID는 도메인약어-컴포넌트약어-일련번호(예: BC-BCM-001) 형식입니다.');
export type RefId = z.infer<typeof RefId>;

/** Feature DB 발행 버전 — 엑셀 가져옴 v1.3, 이후 v1.4 … */
export const RefReleaseId = z.string().regex(/^v\d+\.\d+$/);
/** 출처 ID(09_출처) — S01 … */
export const RefSourceId = z.string().regex(/^S\d{2,}$/);
/** 변경 요청 번호 — 엑셀 15_DB운영 6절과 같은 CR-연도-일련번호 */
export const RefChangeId = z.string().regex(/^CR-\d{4}-\d{3,}$/);

/** 기준 행 상태(§5.2) — 엑셀 BQ 활성·검토 필요·폐기 예정·폐기 + FF 신규 요청 중 */
export const REF_STATUSES = ['ACTIVE', 'REVIEW', 'DEPRECATED', 'RETIRED', 'PENDING'] as const;
export const RefStatus = z.enum(REF_STATUSES);
export type RefStatus = z.infer<typeof RefStatus>;

/** 규모 근거 등급(BK) — A 공개 금액 · B 사내 실적 · C 비교 판단 · D 작성자 판단 */
export const SizeEvidenceGrade = z.enum(['A', 'B', 'C', 'D']);
export type SizeEvidenceGrade = z.infer<typeof SizeEvidenceGrade>;

/** 03b 상세 정의(파일럿 116행만 값이 있다) — 모두 선택, 엑셀 원문 번호 ①~⑳ */
export const FeatureRefDefinition = z.object({
  level: text.nullable().optional(), // ① 카탈로그 레벨 L1 패키지 · L2 Feature · L3 모듈
  parentRefId: text.nullable().optional(), // ② 상위 ID('; ' 구분, 기본 제어 Feature면 '없음')
  summary: text.nullable().optional(), // ③ 기능 요약
  trigger: text.nullable().optional(), // ④ 동작 조건
  scopeIn: z.array(text).optional(), // ⑤ 견적 범위 포함
  scopeOut: z.array(text).optional(), // ⑥ 견적 범위 제외
  scopeOutRefs: z.array(text).optional(), // ⑦ 제외 범위를 맡는 기준 행
  io: z
    .object({
      entry: text.nullable().optional(), // ⑧ 진입
      exit: text.nullable().optional(), // ⑨ 종료
      read: text.nullable().optional(), // ⑩ 읽는 신호
      write: text.nullable().optional(), // ⑪ 쓰는 신호
    })
    .optional(),
  drivers: z
    .object({
      states: text.nullable().optional(), // ⑫ 상태 수
      dtcs: text.nullable().optional(), // ⑬ 고장 코드
      calibrations: text.nullable().optional(), // ⑭ 보정 값
      variants: text.nullable().optional(), // ⑮ 변형
    })
    .optional(),
  regulations: text.nullable().optional(), // ⑯ 규제·표준
  verification: text.nullable().optional(), // ⑰ 검증 방법
  typicalChanges: text.nullable().optional(), // ⑱ 흔한 변경
  sharedFunctions: text.nullable().optional(), // ⑳ 공유 기능 (⑲ 별칭은 aliases)
  authoringStatus: text.nullable().optional(), // 작성 상태
});
export type FeatureRefDefinition = z.infer<typeof FeatureRefDefinition>;

/** 기준 행(feature_ref.doc) — §5.1 열 대응. 파생 값(M overall·T points·U nominalPoints)은 저장하지 않고 규칙으로 계산한다 */
export const FeatureRefRow = z.object({
  // 식별
  refId: RefId, // A
  status: RefStatus, // BQ
  replacedBy: RefId.nullable(), // 폐기 예정 행의 대체 행
  registeredIn: text, // BO 등록 버전(v0.5 …)
  evidenceCheckedAt: z.string().nullable(), // BP 최종 근거 확인일(ISO 날짜)
  // 분류
  domain: required, // B
  cluster: required, // C
  component: required, // D
  swStack: text, // E Application·Platform·Back-end
  lifecycle: text, // H Commodity·Differentiating·Innovation
  techStack: text, // I
  vehicleType: text, // AC
  region: text, // AD
  // 이름 — 검색 대상
  nameEn: required, // F
  nameKo: required, // G
  aliases: z.array(text), // 03b ⑲ + 사내 용어집
  // 특성
  autoQuality: text, // J
  techQuality: text, // K
  asilRep: Asil, // L 대표 ASIL(QM·A~D)
  method: text, // N
  // 규모
  tshirt: required, // S XS~XXXL
  bundleId: text.nullable(), // Q
  bundleRep: z.boolean().nullable(), // R
  sizeEvidenceGrade: SizeEvidenceGrade.nullable(), // BK
  // 벤치마크 — 금액 필드는 산정 역할만 열람(20-94 §8)
  benchmarkEur: z.number().nullable(), // O
  kearneyNote: text, // P
  makeBuyVolume: text, // V
  makeBuyPremium: text, // W
  relevance: text, // X
  // 근거
  sourceIds: z.array(text), // Y → ref_source
  sourceDetail: text, // Z 표준 조항·VSS 경로
  remark: text, // AA
  basisType: text, // AB
  // 관계(§5.4)
  duplicateOf: RefId.nullable(), // BJ 중복 점검 기준 ID
  requires: z.array(RefId), // BL 선행(AND)
  excludes: z.array(RefId), // UVL 교차 제약
  // 조달 — 초기 분류
  procurement: text, // BS
  swPackage: text, // BT
  licenseItem: text, // BU
  billing: text, // BV
  // 정의(03b)
  definition: FeatureRefDefinition.nullable(),
  // 메모
  adminMemo: text, // BR — 변경 요청 번호 함께
});
export type FeatureRefRow = z.infer<typeof FeatureRefRow>;

/**
 * 산정 역할만 보는 벤치마크 필드(엑셀 O·P·V·W 열) — 금액(benchmarkEur)·Kearney 메모·Make/Buy 판단(물량·프리미엄).
 * 등록 화면·일반 조회 응답·내보내기에서 뺀다. 이 목록 하나만 쓴다(백엔드 read-view·export, 변경 요청 차이).
 */
export const REF_MONEY_FIELDS = ['benchmarkEur', 'kearneyNote', 'makeBuyVolume', 'makeBuyPremium'] as const satisfies readonly (keyof FeatureRefRow)[];
export type RefMoneyField = (typeof REF_MONEY_FIELDS)[number];

/** 분류 표(§4) — 도메인 10 → 클러스터 → 컴포넌트 69. 컴포넌트 약어(BCM·BRK …)는 ID 규칙에 쓴다 */
export const TaxonomyLevel = z.enum(['DOMAIN', 'CLUSTER', 'COMPONENT']);
export type TaxonomyLevel = z.infer<typeof TaxonomyLevel>;
export const TaxonomyNode = z.object({
  nodeId: required,
  level: TaxonomyLevel,
  parentId: text.nullable(),
  nameEn: required,
  nameKo: text,
  /** 도메인 약어(BC …)·컴포넌트 약어(BCM …). 클러스터는 약어가 없을 수 있다 */
  abbr: text.nullable(),
  status: z.enum(['ACTIVE', 'RETIRED']),
});
export type TaxonomyNode = z.infer<typeof TaxonomyNode>;

/** 출처(09_출처) — 다음 점검일은 정기 점검(§8.5) 알림에 쓴다 */
export const RefSource = z.object({
  sourceId: RefSourceId,
  title: required,
  publisher: text,
  version: text,
  url: text,
  checkedAt: z.string().nullable(),
  nextReviewAt: z.string().nullable(),
});
export type RefSource = z.infer<typeof RefSource>;

/** 사내 용어집(03b C절) — 검색 별칭 */
export const RefGlossary = z.object({
  term: required,
  meaning: text,
  refIds: z.array(RefId),
  status: text,
});
export type RefGlossary = z.infer<typeof RefGlossary>;

/** 세부기능 후보(13_세부기능후보) — 읽기 전용 참고 */
export const RefSubfunction = z.object({
  component: required,
  name: required,
  note: text,
});
export type RefSubfunction = z.infer<typeof RefSubfunction>;

/** 발행 버전(14_개정이력) — 승인된 변경 요청을 묶어 발행, 전체 Feature DB 정규화 해시. 추가만 가능 */
export const RefRelease = z.object({
  release: RefReleaseId,
  publishedBy: required,
  publishedAt: z.string(),
  changeIds: z.array(RefChangeId),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  note: text.optional(),
});
export type RefRelease = z.infer<typeof RefRelease>;

// ── 변경 요청(§8.2) ─────────────────────────────────────────────

export const RefChangeKind = z.enum(['ADD', 'MODIFY', 'DEPRECATE', 'RETIRE']);
export type RefChangeKind = z.infer<typeof RefChangeKind>;
export const RefChangeStatus = z.enum(['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED']);
export type RefChangeStatus = z.infer<typeof RefChangeStatus>;
/** 도메인 검토 의견 — 동의·보완·반대 */
export const RefReviewOpinion = z.enum(['AGREE', 'REVISE', 'OPPOSE']);
export type RefReviewOpinion = z.infer<typeof RefReviewOpinion>;

/** 기준 행 필드 단위 차이 — 바뀐 필드만 담는다(ADD는 after에 새 행 전체) */
export const RefFieldDiff = FeatureRefRow.partial();
export type RefFieldDiff = z.infer<typeof RefFieldDiff>;

export const RefChangeReview = z.object({
  reviewerId: required,
  opinion: RefReviewOpinion,
  comment: required,
  at: z.string(),
});
export type RefChangeReview = z.infer<typeof RefChangeReview>;

export const RefChangeDecision = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  decidedBy: required,
  reason: required,
  at: z.string(),
});
export type RefChangeDecision = z.infer<typeof RefChangeDecision>;

/** 자동 점검(registration-criteria) 결과 한 줄 */
export const RefCriterionResult = z.object({
  id: required,
  ok: z.boolean(),
  /** true면 승인을 막는다(필수 정보 누락 등), false면 '보완 필요' 표시만 */
  blocking: z.boolean(),
  message: text,
});
export type RefCriterionResult = z.infer<typeof RefCriterionResult>;

/** 변경 요청(ref_change.doc) */
export const RefChange = z.object({
  changeId: RefChangeId,
  kind: RefChangeKind,
  refId: RefId,
  before: RefFieldDiff.nullable(),
  after: RefFieldDiff,
  reason: text,
  requestedBy: required,
  requestedAt: z.string(),
  status: RefChangeStatus,
  reviews: z.array(RefChangeReview),
  decision: RefChangeDecision.nullable(),
  /** 묶여 발행된 버전 — 발행 전 null */
  release: RefReleaseId.nullable(),
  checks: z.array(RefCriterionResult).optional(),
  /** 등록 화면 추가 요청에서 만든 ADD — 요청 중(PENDING) 행과 같이 생겼다 */
  fromRegistration: z.boolean().optional(),
  /** ADD가 제안한 새 컴포넌트(분류 표에 없던 것) — 발행 때 분류 표에 컴포넌트(필요하면 클러스터)를 만든다 */
  newComponent: z.object({ component: required, abbr: z.string().regex(/^[A-Z][A-Z0-9]{1,3}$/), cluster: required }).optional(),
});
export type RefChange = z.infer<typeof RefChange>;

// ── FF Feature ↔ 기준 행 연결(§5.3) ─────────────────────────────

export const FeatureRefRole = z.enum(['PRIMARY', 'INCLUDED']);
export type FeatureRefRole = z.infer<typeof FeatureRefRole>;

/** 저장된 연결 — refVersion은 연결 당시 Feature DB 발행 버전 */
export const FeatureRefLink = z.object({ refId: RefId, role: FeatureRefRole, refVersion: RefReleaseId });
export type FeatureRefLink = z.infer<typeof FeatureRefLink>;

/** 등록·수정 요청의 연결 — refVersion은 서버가 채운다 */
export const FeatureRefLinkInput = z.object({ refId: RefId, role: FeatureRefRole }).strict();
export type FeatureRefLinkInput = z.infer<typeof FeatureRefLinkInput>;

/** 대표 정확히 1개 · 같은 행 중복 금지 — 위반 문구 목록(빈 배열 = 통과) */
export function featureRefsProblems(links: readonly { refId: string; role: FeatureRefRole }[]): string[] {
  const out: string[] = [];
  const primary = links.filter((l) => l.role === 'PRIMARY').length;
  if (primary !== 1) out.push(primary === 0 ? '대표(PRIMARY) 기준 행을 하나 고르세요.' : `대표(PRIMARY) 기준 행은 하나만 둘 수 있습니다(지금 ${primary}개).`);
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.refId)) out.push(`같은 기준 행 ${l.refId}을(를) 두 번 연결할 수 없습니다.`);
    seen.add(l.refId);
  }
  return out;
}

export const featureRefsValid = (links: readonly { refId: string; role: FeatureRefRole }[]) => featureRefsProblems(links).length === 0;

/** zod superRefine — 배열 스키마에 건다(객체에 걸면 omit·extend를 쓸 수 없다) */
const refineLinks = (links: readonly { refId: string; role: FeatureRefRole }[], ctx: z.RefinementCtx) => {
  for (const message of featureRefsProblems(links)) ctx.addIssue({ code: 'custom', message });
};

/** 등록·수정 요청의 연결 목록 */
export const FeatureRefLinkInputs = z.array(FeatureRefLinkInput).min(1, '기준 기능(Feature DB)을 하나 이상 연결하세요.').superRefine(refineLinks);
/** 저장된 연결 목록(FeatureVersionRow.featureRefs) */
export const FeatureRefLinks = z.array(FeatureRefLink).superRefine(refineLinks);

/** 대표 ASIL과 다른 ASIL — 사유 필수(필수 여부는 서버가 대표 행과 비교해 판단), G2 검토 대상 */
export const AsilDeviation = z.object({ from: Asil, to: Asil, reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500) }).strict();
export type AsilDeviation = z.infer<typeof AsilDeviation>;

// ── API 본문(§6.4·§8) ───────────────────────────────────────────

const reason = z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(1000);

/** 등록 화면 "Feature DB에 없음 → 요청" — 서버가 정식 ID를 바로 부여하고 PENDING 행 + ADD 변경 요청을 만든다 */
export const RequestRefAddBody = z
  .object({
    domain: required.max(80),
    cluster: required.max(120).optional(),
    component: required.max(120),
    /** 새 컴포넌트일 때 약어 제안(분류 표 추가도 DB 관리자 승인) */
    componentAbbr: z.string().regex(/^[A-Z][A-Z0-9]{1,3}$/).optional(),
    nameEn: required.max(200),
    nameKo: required.max(200),
    tshirt: required.max(8),
    asilRep: Asil,
    sourceIds: z.array(RefSourceId).default([]),
    /** 출처 ID가 없을 때 근거 메모 */
    basisNote: text.max(1000).default(''),
  })
  .strict()
  .refine((b) => b.sourceIds.length > 0 || b.basisNote.length >= 2, { message: '출처 ID 또는 근거 메모를 입력하세요.', path: ['basisNote'] });
export type RequestRefAddBody = z.infer<typeof RequestRefAddBody>;

/** 변경 요청 작성(감사 조회자 외 사람 역할, routes REFDB_CHANGE_REQUESTERS) — MODIFY·DEPRECATE·RETIRE는 대상 refId, ADD는 after에 새 행 */
export const CreateRefChangeBody = z
  .object({
    kind: RefChangeKind,
    refId: RefId.optional(),
    after: RefFieldDiff.default({}),
    reason,
  })
  .strict()
  .refine((b) => b.kind === 'ADD' || !!b.refId, { message: '대상 기준 행 ID(refId)를 입력하세요.', path: ['refId'] })
  .refine((b) => b.kind !== 'DEPRECATE' || b.after.replacedBy !== undefined, { message: '폐기 예정은 대체 행(replacedBy)을 지정하세요(없으면 null).', path: ['after', 'replacedBy'] });
export type CreateRefChangeBody = z.infer<typeof CreateRefChangeBody>;

/** 도메인 검토 의견 — 의견 필수 */
export const ReviewRefChangeBody = z.object({ opinion: RefReviewOpinion, comment: reason }).strict();
export type ReviewRefChangeBody = z.infer<typeof ReviewRefChangeBody>;

/** DB 관리자 승인·반려 */
export const DecideRefChangeBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason }).strict();
export type DecideRefChangeBody = z.infer<typeof DecideRefChangeBody>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식입니다.');

/** 출처 정기 점검 기록(§8.5, DB 관리자) — 확인한 출처의 확인일·다음 점검일을 바꾼다. 확인일을 비우면 오늘 */
export const RecordSourceReviewBody = z
  .object({
    sourceIds: z.array(RefSourceId).min(1, '점검한 출처를 하나 이상 고르세요.').max(200),
    checkedAt: isoDate.optional(),
    nextReviewAt: isoDate,
    note: reason,
  })
  .strict()
  .refine((b) => new Set(b.sourceIds).size === b.sourceIds.length, { message: '같은 출처를 두 번 고를 수 없습니다.', path: ['sourceIds'] })
  .refine((b) => !b.checkedAt || b.nextReviewAt > b.checkedAt, { message: '다음 점검일은 확인일보다 뒤여야 합니다.', path: ['nextReviewAt'] });
export type RecordSourceReviewBody = z.infer<typeof RecordSourceReviewBody>;

/** 버전 발행 — 승인된 요청을 묶는다(비우면 승인된 요청 전부) */
export const PublishRefReleaseBody = z.object({ changeIds: z.array(RefChangeId).default([]), note: text.max(1000).default('') }).strict();
export type PublishRefReleaseBody = z.infer<typeof PublishRefReleaseBody>;

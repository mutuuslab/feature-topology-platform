// 공용 enum — 통합 상세설계서 v0.81 표기 그대로(대문자 Lifecycle, 한글 판정 상태).
import { z } from 'zod';

/** Feature·Catalog 공통 Lifecycle 7단계 (상세설계서 §2.5, §2.8) */
export const LIFECYCLE = ['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'] as const;
export const Lifecycle = z.enum(LIFECYCLE);
export type Lifecycle = z.infer<typeof Lifecycle>;

/** BOM Baseline 확정 대상 상태 (PROPOSED 제외, DEPRECATED/RETIRED 신규 발급 금지) */
export const BASELINE_ELIGIBLE: readonly Lifecycle[] = ['APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED'];

export const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'] as const;
export const GateId = z.enum(GATES);
export type GateId = z.infer<typeof GateId>;

/** Gate 명칭·판정자 역할·Gate 단계 Lifecycle (표 11, 표 12) */
export const GATE_META: Record<GateId, { name: string; judgeRole: string; stage: Lifecycle }> = {
  G1: { name: 'Feature Gate', judgeRole: 'Feature 정의 승인자', stage: 'PROPOSED' },
  G2: { name: 'Requirement Gate', judgeRole: '요구사항 검토 책임자', stage: 'PROPOSED' },
  G3: { name: 'Variant Gate', judgeRole: '차량 사양 승인자', stage: 'PROPOSED' },
  G4: { name: 'Control Gate', judgeRole: '제어 통합 책임자', stage: 'DEVELOPING' },
  G5: { name: 'Verification Gate', judgeRole: '검증시험 책임자', stage: 'DEVELOPING' },
  G6: { name: 'Supplier Gate', judgeRole: '협력사 품질 승인자', stage: 'DEVELOPING' },
  G7: { name: 'Safety/Security Gate', judgeRole: '기능안전·보안 승인자', stage: 'DEVELOPING' },
  G8: { name: 'OTA Gate', judgeRole: 'OTA 릴리스 승인자', stage: 'VERIFIED' },
  G9: { name: 'Operations Gate', judgeRole: '운영 출시 승인자', stage: 'VERIFIED' },
};

/** 입력 검사 결과 */
export const GateResult = z.enum(['PASS', 'CONDITIONAL', 'FAIL']);
export type GateResult = z.infer<typeof GateResult>;

/** 판정 상태 — CONDITIONAL 이후는 '검토 중'. 미실행 Gate는 레코드 없음(=미판정). */
export const GateStatus = z.enum(['PASS', '검토 중', 'FAIL']);
export type GateStatus = z.infer<typeof GateStatus>;

/** 의존관계 판정 결과 (원천이 PROPOSED면 미판정) */
export const DependencyVerdict = z.enum(['PASS', 'CONDITIONAL', 'FAIL', '미판정']);
export type DependencyVerdict = z.infer<typeof DependencyVerdict>;

export const RelationType = z.enum(['REQUIRES', 'EXCLUDES']);
export type RelationType = z.infer<typeof RelationType>;

export const TargetVersionCheck = z.enum(['단일 후보', '버전 확정']);

export const ControlPointType = z.enum(['Flag', 'Parameter', 'Signal', 'DTC']);
export type ControlPointType = z.infer<typeof ControlPointType>;

export const Asil = z.enum(['QM', 'A', 'B', 'C', 'D']);
export type Asil = z.infer<typeof Asil>;

export const SaleType = z.enum(['구독', '구매', '체험']);
export type SaleType = z.infer<typeof SaleType>;

/** BUNDLE은 확장 유형 — 규칙 추후 정의 */
export const CatalogType = z.enum(['PACKAGE', 'SINGLE', 'BUNDLE']);
export type CatalogType = z.infer<typeof CatalogType>;

/** 플랫폼 역할 (표 6) — 데모 IAM의 X-Actor-Role 값 */
export const ROLES = [
  'FEATURE_AUTHOR', // Feature 작성자
  'SAFETY_OFFICER', // 기능안전/보안 담당자
  'VARIANT_OWNER', // 차량 사양/Variant 담당자
  'FEATURE_APPROVER', // Feature 승인자
  'IMPLEMENTER', // 구현 담당자
  'RELEASE_MANAGER', // Feature 출시 담당자
  'BOM_APPROVER', // BOM 승인자 (Baseline 승인권자)
  'PRODUCT_AUTHOR', // 상품 작성자
  'PRODUCT_APPROVER', // 상품 승인자
  'GATE_JUDGE', // Gate 판정자
  'OPERATOR', // 운영자 (긴급 차단·복구)
  'AUDITOR', // 운영/감사 조회자 (읽기 전용)
  'SYSTEM', // 시스템(Registry) 자동 전이
  'VEHICLE', // 차량 (차량 발신 요청 채널 — 사람 역할 아님)
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ROLE_LABEL: Record<Role, string> = {
  FEATURE_AUTHOR: 'Feature 작성자',
  SAFETY_OFFICER: '기능안전·보안 담당자',
  VARIANT_OWNER: '차량 사양·Variant 담당자',
  FEATURE_APPROVER: 'Feature 승인자',
  IMPLEMENTER: '구현 담당자',
  RELEASE_MANAGER: 'Feature 출시 담당자',
  BOM_APPROVER: 'BOM 승인자',
  PRODUCT_AUTHOR: '상품 작성자',
  PRODUCT_APPROVER: '상품 승인자',
  GATE_JUDGE: 'Gate 판정자',
  OPERATOR: '운영자',
  AUDITOR: '운영·감사 조회자',
  SYSTEM: '시스템',
  VEHICLE: '차량',
};

/** ID 형식 (ID_체계_안내) */
export const ID_PATTERNS = {
  feature: /^FEAT-\d{5}$/,
  baseline: /^BL-\d{5}$/,
  catalog: /^CAT-\d{5}$/,
  dependency: /^DEP-\d{5}$/,
  function: /^FUNC-\d{6}$/,
  gateRecord: /^SIM-G[1-9]-\d{6}$/,
  version: /^\d+\.\d+\.\d+$/,
} as const;

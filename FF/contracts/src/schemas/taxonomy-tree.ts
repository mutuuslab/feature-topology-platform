// 분류 계층 L0~L5(B7 (b), docs/30-data-model/30-70 §1·30-95 §4) — Feature DB 분류 표(도메인 L0·클러스터/컴포넌트 L1)를 그대로 두고
// 그 아래 L2~L5 노드(차량·시스템 기능 → SW 기능 → 정책·Flag·파라미터 → 코드·신호·로직)를 플랫폼이 관리한다. Feature는 자기 분류 수준의 노드에 배치한다.
import { z } from 'zod';

export const TAXONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
export const TaxonomyLevelCode = z.enum(TAXONOMY_LEVELS);
export type TaxonomyLevelCode = z.infer<typeof TaxonomyLevelCode>;
/** 명세 표기(FR-REG-001-008 비고) */
export const TAXONOMY_LEVEL_LABEL: Record<TaxonomyLevelCode, string> = {
  L0: 'Domain/Capability',
  L1: 'Customer/Business',
  L2: 'Vehicle/System',
  L3: 'Software Feature',
  L4: 'Policy/Flag/Parameter',
  L5: 'Config Element',
};
/** Feature Master의 기준 수준(30-70 §1 — 요구·검증·Variant·Gate 기준 단위). 등록 화면의 기본값 */
export const FEATURE_BASE_LEVEL: TaxonomyLevelCode = 'L2';

/** Feature DB 발행 분류(읽기 전용) · 플랫폼 노드 */
export const TAXONOMY_SOURCES = ['FEATURE_DB', 'PLATFORM'] as const;
export type TaxonomySource = (typeof TAXONOMY_SOURCES)[number];

const NodeId = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/, 'Node ID는 영문 대문자·숫자로 시작하고 영문 대문자·숫자·점·밑줄·하이픈만 씁니다(2~40자).');
const name = z.string().trim().min(2, 'Node 명칭을 2자 이상 입력하세요.').max(120);
const reason = z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500);

/** 노드 등록(FR-CAT-004-001) — 등록자는 요청한 계정 */
export const CreateTaxonomyNodeBody = z
  .object({
    nodeId: NodeId,
    name,
    level: TaxonomyLevelCode,
    /** L0은 null. Feature DB 분류 노드 ID(BC·BC:Access·BC/Body control …)도 상위로 쓸 수 있다 */
    parentId: z.string().trim().min(1).max(120).nullable(),
    description: z.string().trim().max(500).nullable().default(null),
    reason: reason.optional(),
  })
  .strict();
export type CreateTaxonomyNodeBody = z.infer<typeof CreateTaxonomyNodeBody>;

/** 노드 수정(FR-CAT-004-006) — 명칭·설명만. 수준·상위를 바꾸면 하위 정합성이 깨지므로 새 노드를 만든다 */
export const UpdateTaxonomyNodeBody = z
  .object({ name: name.optional(), description: z.string().trim().max(500).nullable().optional(), reason })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, { message: '바꿀 항목(명칭·설명)을 하나 이상 넣으세요.', path: ['name'] });
export type UpdateTaxonomyNodeBody = z.infer<typeof UpdateTaxonomyNodeBody>;

export const DeleteTaxonomyNodeBody = z.object({ reason }).strict();
export type DeleteTaxonomyNodeBody = z.infer<typeof DeleteTaxonomyNodeBody>;

/** Feature 배치(FR-CAT-004-009) — 한 Feature는 노드 하나. 다시 배치하면 바뀐다(감사에 이전 노드) */
export const PlaceFeatureBody = z.object({ nodeId: z.string().trim().min(1).max(120), reason: reason.optional() }).strict();
export type PlaceFeatureBody = z.infer<typeof PlaceFeatureBody>;

export interface TaxonomyTreeNode {
  nodeId: string;
  name: string;
  level: TaxonomyLevelCode;
  parentId: string | null;
  description: string | null;
  source: TaxonomySource;
  status: 'ACTIVE' | 'RETIRED';
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface TaxonomyTreeView extends TaxonomyTreeNode {
  childCount: number;
  featureCount: number;
  children: TaxonomyTreeView[];
}

export interface FeaturePlacement {
  featureId: string;
  nodeId: string;
  placedBy: string;
  placedAt: string;
}

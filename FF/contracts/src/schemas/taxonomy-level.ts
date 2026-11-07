// 분류 수준 L0~L5 값(B7 (b), 30-70 §1) — Feature 등록 본문·목록이 쓰는 값만 담은 작은 모듈(첫 화면 묶음에 노드 본문 스키마가 끌려오지 않게)
import { z } from 'zod';

export const TAXONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;
export const TaxonomyLevelCode = z.enum(TAXONOMY_LEVELS);
export type TaxonomyLevelCode = z.infer<typeof TaxonomyLevelCode>;

// ISO/IEC 26580 feature 기반 PLE 정합(docs/20-architecture/20-60) — Feature 변이 프로필·variation point·자동 채움 출처.
// 26580 용어: feature catalogue(3.5)·bill-of-features(3.1)·variation point(3.20)·variant(3.19)·mutually exclusive/inclusive(3.9·3.10).
// 'feature profile'은 26580 용어가 아니다 — FF는 한 Feature의 변이 프로필(이 스키마)과 제품별 선택(bill-of-features)을 나눈다(D-26580-1).
import { z } from 'zod';

/** 카탈로그 안 위치 — 주요 feature(상위) 또는 하위 feature */
export const CatalogueRole = z.enum(['PRIMARY', 'SUB']);
export type CatalogueRole = z.infer<typeof CatalogueRole>;

/** feature 유형(Gears 공개 해설) — 켬/끔 · 대안 중 하나 · 여럿 · 수치 */
export const FeatureValueType = z.enum(['BOOLEAN', 'ENUM', 'SET', 'INTEGER']);
export type FeatureValueType = z.infer<typeof FeatureValueType>;

/** 변이성 — 공통(모든 제품, 26580상 feature가 아님) · 선택 · 대안(배타, 3.9) · 다중(3.10) */
export const Variability = z.enum(['MANDATORY', 'OPTIONAL', 'ALTERNATIVE', 'OR']);
export type Variability = z.infer<typeof Variability>;

/** 결합 시점 — 변이점이 정해지는 때 */
export const BindingTime = z.enum(['BUILD', 'CALIBRATION', 'RUNTIME_FLAG', 'OTA']);
export type BindingTime = z.infer<typeof BindingTime>;

/** variation point가 걸린 공유 자산의 종류 */
export const VpAssetKind = z.enum(['FLAG', 'PARAMETER', 'SIGNAL', 'DTC', 'SW_COMPONENT', 'POLICY']);
export type VpAssetKind = z.infer<typeof VpAssetKind>;

/** variation point(3.20) — 공유 자산의 어느 내용이, feature 선택에 따라 제품에서 어떤 형태가 되는가 */
export const VariationPoint = z.object({
  vpId: z.string().trim().min(1).max(80),
  assetKind: VpAssetKind,
  asset: z.string().trim().min(1).max(200),
  /** 선택 → 형태 대응(사람이 읽는 규칙) — 예: '선택 → 켬 · 미선택 → 끔' */
  mapping: z.string().trim().min(1).max(300),
});
export type VariationPoint = z.infer<typeof VariationPoint>;

/** Feature 변이 프로필 — Feature Version마다 하나(표 feature_variability) */
export const FeatureVariability = z.object({
  catalogueRole: CatalogueRole,
  /** 상위 feature의 기준 행 ID — 하위 feature면 필수 */
  parentRefId: z.string().trim().min(1).max(40).nullable(),
  featureType: FeatureValueType,
  variability: Variability,
  bindingTime: BindingTime,
  variationPoints: z.array(VariationPoint).max(40),
}).refine((v) => v.catalogueRole !== 'SUB' || !!v.parentRefId, { message: '하위 feature는 상위 feature(기준 행)를 정해야 합니다.', path: ['parentRefId'] });
export type FeatureVariability = z.infer<typeof FeatureVariability>;

/** 자동 채움 출처 종류 — 기준 행 열 · 사내 용어 · 카탈로그(등록된 다른 Feature·상품 범위) · 규칙 */
export const AutofillSourceKind = z.enum(['REF', 'GLOSSARY', 'CATALOGUE', 'RULE']);
export type AutofillSourceKind = z.infer<typeof AutofillSourceKind>;

/** 칸 결정 — 제안 그대로 · 사람이 고침 · 제안 없던 칸을 사람이 채움 */
export const AutofillDecision = z.enum(['ACCEPTED', 'EDITED', 'ADDED']);
export type AutofillDecision = z.infer<typeof AutofillDecision>;

/** 자동 채움 이력 한 줄(표 feature_autofill) */
export interface AutofillHistoryRow {
  id: number;
  featureId: string;
  version: string;
  field: string;
  sourceKind: AutofillSourceKind | null;
  sourceRef: string | null;
  suggested: unknown;
  final: unknown;
  decision: AutofillDecision;
  actorId: string;
  at: string;
}

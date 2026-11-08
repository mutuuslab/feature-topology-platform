// 정책 글로벌 적용 조건(B7 (b), FR-GLB-001-001~004) — Feature 정책 하나에 브랜드(현대·기아·제네시스)·권역(적용 지역 코드)·법규 조건(컴플라이언스 룰)을 잇는다.
// 정책 본문(policy.service)은 바꾸지 않고 따로 저장한다(정책 ID 하나에 조건 하나, 수정은 revision을 올린다).
import { z } from 'zod';
import { regionCodeFormatIssues } from '../rules/region-code';

export const BRANDS = ['HYUNDAI', 'KIA', 'GENESIS'] as const;
export type Brand = (typeof BRANDS)[number];
export const BRAND_LABEL: Record<Brand, string> = { HYUNDAI: '현대', KIA: '기아', GENESIS: '제네시스' };
export const isBrand = (v: string): v is Brand => (BRANDS as readonly string[]).includes(v);

const brand = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (!isBrand(v)) ctx.addIssue({ code: 'custom', message: `등록할 수 없는 브랜드입니다: ${v} — ${BRANDS.map((b) => BRAND_LABEL[b]).join('·')} 중에서 고르세요.` });
  });
const unique = (label: string) => (xs: string[], ctx: z.RefinementCtx) => {
  const dup = xs.find((x, i) => xs.indexOf(x) !== i);
  if (dup) ctx.addIssue({ code: 'custom', message: `${label} ${dup}를 두 번 넣었습니다.` });
};

/** 등록·수정 본문 — 브랜드 1개 이상, 지역 코드·법규 조건(룰 ID)은 선택 @req FR-GLB-001-001 FR-GLB-001-002 */
export const PolicyGlobalScopeBody = z
  .object({
    brands: z.array(brand).min(1, '브랜드를 하나 이상 고르세요.').max(BRANDS.length).superRefine(unique('브랜드')),
    regionCodes: z
      .array(z.string().trim().max(2))
      .max(14)
      .default([])
      .superRefine((xs, ctx) => {
        for (const message of regionCodeFormatIssues(xs)) ctx.addIssue({ code: 'custom', message });
      }),
    complianceRuleIds: z.array(z.string().trim().min(2).max(32)).max(20).default([]).superRefine(unique('법규 조건')),
    reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500),
  })
  .strict();
export type PolicyGlobalScopeBody = z.infer<typeof PolicyGlobalScopeBody>;

export interface PolicyGlobalScope {
  policyId: string;
  featureId: string;
  brands: Brand[];
  regionCodes: string[];
  complianceRuleIds: string[];
  revision: number;
  updatedBy: string;
  updatedAt: string;
  reason: string;
}

// 권한 범위(ADS-BE15) 요청 본문 — 축마다 null = 제한 없음(규칙은 rules/role-scope.ts)
import { z } from 'zod';

const Axis = z.array(z.string().trim().min(1).max(40)).max(100).nullable();

export const PutRoleScopeBody = z
  .object({
    markets: Axis.default(null),
    featureIds: z.array(z.string().regex(/^FEAT-\d{5}$/)).max(500).nullable().default(null),
    environments: Axis.default(null),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type PutRoleScopeBody = z.infer<typeof PutRoleScopeBody>;

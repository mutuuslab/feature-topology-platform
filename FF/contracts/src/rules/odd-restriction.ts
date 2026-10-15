// ODD 축소 정책 (보고서 v1.1 14.7 · FFG-SOT-002) — 트리거 조건 대응으로 Feature를 특정 조건에서 제한하는 정책은 새 Feature Version으로 등록하고,
// 7장의 등급(안전 분류 확정)과 승인 절차를 그대로 따른다. 정책에 oddRestriction(트리거 조건·근거 건·축소 전 Version)을 달면 배포 전에 이 판정을 지나야 한다.
// 승인 절차는 일반 정책과 같다(검증 GO·다른 사람 승인) — 여기서는 Version·등급만 본다.
import { z } from 'zod';
import type { FClass } from '../schemas/safety';
import { compareVersion } from './lifecycle';

export const OddRestriction = z
  .object({
    /** 대응하는 트리거 조건(시나리오 저장소 ID 또는 설명) */
    triggerId: z.string().trim().min(2).max(120),
    /** 근거 건 — 이상 건·장애 ID */
    basisRef: z.string().trim().max(40).nullable().default(null),
    /** 축소 전 Version — 새 Version은 이보다 커야 한다 */
    baseVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  })
  .strict();
export type OddRestriction = z.infer<typeof OddRestriction>;

const F_RANK: Record<FClass, number> = { F0: 0, F1: 1, F2: 2, F3: 3, F4: 4 };

export interface OddRestrictionInput {
  featureVersion: string;
  restriction: OddRestriction;
  /** 축소 전 Version이 Registry에 있는지 */
  baseExists: boolean;
  /** 새 Version의 안전 분류 — 확정 서명이 검증된 경우만 confirmed */
  profile: { confirmed: boolean; fClass: FClass } | null;
  baseProfile: { fClass: FClass } | null;
}

export type OddRestrictionFinding = { code: 'BASE_UNKNOWN' | 'NOT_NEW_VERSION' | 'CLASS_UNCONFIRMED' | 'CLASS_DOWNGRADE'; message: string };

/**
 * ODD 축소 정책 판정 — 발견이 하나라도 있으면 배포하지 않는다.
 * @rule FFG-SOT-002 — ODD 축소 정책은 새 Feature Version·확정 등급·일반 승인 절차(등급 없는 축소 정책 배포 0건)
 */
export function oddRestrictionFindings(i: OddRestrictionInput): OddRestrictionFinding[] {
  const out: OddRestrictionFinding[] = [];
  const { baseVersion } = i.restriction;
  if (!i.baseExists) out.push({ code: 'BASE_UNKNOWN', message: `축소 전 Version ${baseVersion}이(가) Registry에 없습니다` });
  if (compareVersion(i.featureVersion, baseVersion) <= 0) out.push({ code: 'NOT_NEW_VERSION', message: `ODD 축소는 새 Feature Version으로 등록해야 합니다 (${i.featureVersion} ≤ 축소 전 ${baseVersion})` });
  if (!i.profile?.confirmed) out.push({ code: 'CLASS_UNCONFIRMED', message: `${i.featureVersion}의 안전 분류(F/DC/R)가 확정되지 않았습니다 — 7장 등급 없이 배포할 수 없습니다` });
  else if (i.baseProfile && F_RANK[i.profile.fClass] < F_RANK[i.baseProfile.fClass])
    out.push({ code: 'CLASS_DOWNGRADE', message: `축소 Version의 등급 ${i.profile.fClass}이(가) 축소 전 ${i.baseProfile.fClass}보다 낮습니다 — 같은 등급 절차를 따라야 합니다` });
  return out;
}

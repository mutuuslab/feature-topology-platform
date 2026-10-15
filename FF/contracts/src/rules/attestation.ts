// 실제 구성 Attestation (보고서 v1.1 · FFG-VEH-007) — 차량은 적용 중인 정책 해시·Feature Version·BOM 식별자를 주기적으로 보고(차량 보고 ATTESTATION)하고,
// 플랫폼은 그 차량에 보낸 정책 게시본(기대 구성)과 비교해 불일치를 이상 건으로 연다(보고를 받는 즉시 — 다음 보고 주기 안).
// 비교 단위는 정책 하나(flagKey) — 한 Feature에 Control Point Flag가 여럿일 수 있다. BOM 기대값은 Feature Version의 BOM Baseline이고,
// Registry에 없으면 비교하지 않는다.
import { z } from 'zod';

export const AttestationEntry = z
  .object({
    featureId: z.string().regex(/^FEAT-\d{5}$/),
    featureVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    flagKey: z.string().min(3).max(64),
    policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    bomBaselineId: z.string().regex(/^BL-\d{5}$/).nullable(),
  })
  .strict();
export type AttestationEntry = z.infer<typeof AttestationEntry>;

export interface ExpectedConfig {
  featureId: string;
  flagKey: string;
  featureVersion: string;
  policyHash: string;
  /** 정책 게시본 — 불일치 근거 */
  publicationId: string;
  bomBaselineId: string | null;
}

export type AttestationMismatchCode = 'FEATURE_VERSION' | 'POLICY_HASH' | 'BOM' | 'MISSING' | 'UNEXPECTED';
export interface AttestationMismatch {
  code: AttestationMismatchCode;
  featureId: string;
  flagKey: string;
  expected: string | null;
  reported: string | null;
}

/** 무단 구성으로 볼 불일치(이상 건 CRITICAL) — 나머지는 WARNING */
export const ATTESTATION_CRITICAL: AttestationMismatchCode[] = ['FEATURE_VERSION', 'POLICY_HASH', 'UNEXPECTED'];

/**
 * 보고 구성 ↔ 기대 구성 비교.
 * @rule FFG-VEH-007 — 적용 중 정책 해시·Feature Version·BOM 식별자 Attestation과 불일치 검출(→ 이상 건)
 */
export function attestationMismatches(reported: AttestationEntry[], expected: ExpectedConfig[]): AttestationMismatch[] {
  const out: AttestationMismatch[] = [];
  for (const e of expected) {
    const r = reported.find((x) => x.flagKey === e.flagKey);
    const at = { featureId: e.featureId, flagKey: e.flagKey };
    if (!r) {
      out.push({ code: 'MISSING', ...at, expected: e.policyHash, reported: null });
      continue;
    }
    if (r.featureVersion !== e.featureVersion) out.push({ code: 'FEATURE_VERSION', ...at, expected: e.featureVersion, reported: r.featureVersion });
    if (r.policyHash !== e.policyHash) out.push({ code: 'POLICY_HASH', ...at, expected: e.policyHash, reported: r.policyHash });
    if (e.bomBaselineId && r.bomBaselineId !== e.bomBaselineId) out.push({ code: 'BOM', ...at, expected: e.bomBaselineId, reported: r.bomBaselineId });
  }
  for (const r of reported) if (!expected.some((e) => e.flagKey === r.flagKey)) out.push({ code: 'UNEXPECTED', featureId: r.featureId, flagKey: r.flagKey, expected: null, reported: r.policyHash });
  return out;
}

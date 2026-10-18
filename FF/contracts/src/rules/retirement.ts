// Flag Retirement 6단계 (보고서 v1.1 6.5 · FFG-LCY-011 플랫폼 몫) — Retirement 결정·승인 → 남은 차량 확인 → 최종 상태 고정 → 코드·설정·시험 삭제 →
// Registry 퇴역(ID 재사용 금지) → 기록 보존. 단계는 순서대로만 진행하고, 코드 삭제 기한은 승인 후 6개월과 다음 정기 릴리스 중 이른 쪽이다.
// 배포 완료율 기준·정적 분석 결과·보존 시장은 담당자가 근거와 함께 기록한다(플랫폼이 값을 정하지 않는다).
import { z } from 'zod';

export const RETIREMENT_STEPS = [
  { step: 1, key: 'APPROVED', label: 'Retirement 결정과 승인(Feature 승인자, F2 이상은 Safety Manager)', done: 'Decision Record' },
  { step: 2, key: 'REMAINING_VEHICLES', label: '남은 차량 확인 — 상태 보고로 구 Version 사용 차량 수 집계', done: '집계 보고' },
  { step: 3, key: 'FINAL_STATE', label: '최종 상태 고정 — Flag 값을 최종 값으로 고정하는 SW 배포', done: '배포 완료율 기준 충족' },
  { step: 4, key: 'CODE_REMOVED', label: '코드·설정·시험 삭제', done: '정적 분석에서 Flag 참조 0건' },
  { step: 5, key: 'REGISTRY_RETIRED', label: 'Registry 퇴역과 ID 재사용 금지', done: 'Registry 상태 RETIRED' },
  { step: 6, key: 'RECORDS_RETAINED', label: '기록 보존', done: '시장별 보존 기간 설정' },
] as const;
export type RetirementStepKey = (typeof RETIREMENT_STEPS)[number]['key'];

const DAY = 86_400_000;
export const CODE_REMOVAL_MAX_MS = 182 * DAY; // 6개월

export const RetirementRequestBody = z
  .object({
    flagKey: z.string().min(3).max(64),
    reason: z.string().trim().min(4).max(500),
    /** 다음 정기 릴리스 예정일 — 6개월보다 이르면 이 날이 코드 삭제 기한 */
    nextReleaseAt: z.string().datetime().nullable().default(null),
  })
  .strict();
export type RetirementRequestBody = z.infer<typeof RetirementRequestBody>;

export const RetirementStepBody = z.discriminatedUnion('step', [
  z.object({ step: z.literal('REMAINING_VEHICLES') }).strict(),
  z.object({ step: z.literal('FINAL_STATE'), swVersion: z.string().regex(/^\d+\.\d+\.\d+$/), completionRate: z.number().min(0).max(100), requiredRate: z.number().min(0).max(100), evidenceRef: z.string().trim().min(2) }).strict(),
  z.object({ step: z.literal('CODE_REMOVED'), analysisRef: z.string().trim().min(2), references: z.number().int().min(0) }).strict(),
  z.object({ step: z.literal('REGISTRY_RETIRED') }).strict(),
  z.object({ step: z.literal('RECORDS_RETAINED'), markets: z.array(z.string().min(2)).min(1), basis: z.string().trim().min(2).max(300) }).strict(),
]);
export type RetirementStepBody = z.infer<typeof RetirementStepBody>;

export interface RetirementState {
  approvals: { by: string; role: string; at: string }[];
  approvedAt: string | null;
  steps: Partial<Record<RetirementStepKey, { at: string; by: string; data: Record<string, unknown> }>>;
}

/** 코드 삭제 기한 — 승인 후 6개월과 다음 정기 릴리스 중 이른 쪽 */
export function codeRemovalDue(approvedAt: string | null, nextReleaseAt: string | null): string | null {
  if (!approvedAt) return null;
  const six = Date.parse(approvedAt) + CODE_REMOVAL_MAX_MS;
  const rel = nextReleaseAt ? Date.parse(nextReleaseAt) : Infinity;
  return new Date(Math.min(six, rel)).toISOString();
}

/** 필요한 승인 역할 — Feature Owner(승인자), F2 이상은 Safety Manager도 */
export const retirementApprovers = (fClass: string): string[] => (['F2', 'F3', 'F4'].includes(fClass) ? ['FEATURE_APPROVER', 'SAFETY_OFFICER'] : ['FEATURE_APPROVER']);

/**
 * 다음 단계 진행 가능 여부 — 순서·완료 조건.
 * 보고서 6.5 Retirement 순서와 완료 조건(코드 참조 0건 전 퇴역 금지, 퇴역 뒤 ID 재사용 금지는 flag_registry) — FFG-LCY-011은 Feature Owner·차량 SW 규칙이고 플랫폼은 절차를 지원한다.
 */
export function retirementBlocker(s: RetirementState, next: RetirementStepBody, requiredApprovals: string[]): string | null {
  if (!s.approvedAt) return `Retirement 승인 전입니다 — 필요한 승인: ${requiredApprovals.join(', ')}`;
  const order = RETIREMENT_STEPS.map((x) => x.key);
  const idx = order.indexOf(next.step);
  const missing = order.slice(1, idx).filter((k) => !s.steps[k]);
  if (missing.length) return `앞 단계가 끝나지 않았습니다: ${missing.join(', ')}`;
  if (s.steps[next.step]) return `${next.step} 단계는 이미 기록되었습니다`;
  if (next.step === 'FINAL_STATE' && next.completionRate < next.requiredRate) return `배포 완료율 ${next.completionRate}% < 기준 ${next.requiredRate}%`;
  if (next.step === 'CODE_REMOVED' && next.references > 0) return `정적 분석에서 Flag 참조 ${next.references}건 — 0건이어야 합니다`;
  return null;
}

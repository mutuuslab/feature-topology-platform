// Data Lake 연계·Closed loop 요청 본문(서버 검증) — 화면은 경로 표에서 본문을 뺀다(tools/browser-routes.ts).
import { z } from 'zod';
import { CANARY_METRICS, FINDING_ACTIONS, FINDING_STATUSES } from '../rules/lake';

/** 모델 사용 승인·거부 — 판 하나에 대한 결정(2인·직무 분리는 서버가 검사) */
export const LakeModelDecisionBody = z.object({ version: z.string().trim().min(1).max(40), decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(2).max(500) }).strict();
export type LakeModelDecisionBody = z.infer<typeof LakeModelDecisionBody>;

/** 점검 결과 상태 이동 — 조치를 같이 연결할 수 있다 */
export const FindingTransitionBody = z
  .object({
    to: z.enum(FINDING_STATUSES),
    note: z.string().trim().min(2).max(500),
    action: z.object({ kind: z.enum(FINDING_ACTIONS), ref: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200) }).strict().optional(),
  })
  .strict();
export type FindingTransitionBody = z.infer<typeof FindingTransitionBody>;

/** 중단 기준 사전 등록(FR-ROL-002-006) — 지표·상대위험 경계·신뢰수준·관측 시간·신선도 */
export const AbortCriteriaBody = z
  .object({
    metrics: z.array(z.object({ metric: z.enum(CANARY_METRICS), maxRelativeRisk: z.number().min(1).max(10) }).strict()).min(1).max(CANARY_METRICS.length),
    confidence: z.number().min(0.8).max(0.999),
    observeHours: z.number().int().min(1).max(336),
    maxLagMinutes: z.number().int().min(1).max(1440),
    reason: z.string().trim().min(2).max(500),
  })
  .strict();
export type AbortCriteriaBody = z.infer<typeof AbortCriteriaBody>;

// 연계·과금·서명·파이프라인 오류 이력(기능명세서 B6, D04-04) — 실패한 변경은 롤백되므로 오류는 독립 기록으로 남긴다(추가만, 지우지 않음).
// 한 건 = 오류 유형 · 발생 시점 · 대상 시스템 · 대상 · 오류 내용. 같은 기록에서 알림(수신자 규칙)이 나간다.
import { z } from 'zod';

export const INTEGRATION_ERROR_SYSTEMS = ['LEGACY', 'BILLING', 'SIGNING', 'PIPELINE'] as const;
export type IntegrationErrorSystem = (typeof INTEGRATION_ERROR_SYSTEMS)[number];
export const IntegrationErrorSystem = z.enum(INTEGRATION_ERROR_SYSTEMS);

export const INTEGRATION_ERROR_SYSTEM_LABEL: Record<IntegrationErrorSystem, string> = {
  LEGACY: 'Legacy 연계(해외공장 ERP)',
  BILLING: '과금 시스템',
  SIGNING: '정책 서명(PKI)',
  PIPELINE: 'CI/CD 파이프라인',
};

/** 오류 → 알림 이벤트 */
export const INTEGRATION_ERROR_EVENT: Record<IntegrationErrorSystem, string> = {
  LEGACY: 'legacy.import.failed',
  BILLING: 'billing.call.failed',
  SIGNING: 'signing.failed',
  PIPELINE: 'pipeline.run.failed',
};

export const INTEGRATION_ERROR_TYPES = ['CONNECTION_OFF', 'NOT_CONNECTED', 'REJECTED', 'KEY_EXPIRED', 'SIGN_FAILED', 'PIPELINE_FAILED', 'UNKNOWN'] as const;
export type IntegrationErrorType = (typeof INTEGRATION_ERROR_TYPES)[number];
export const INTEGRATION_ERROR_TYPE_LABEL: Record<IntegrationErrorType, string> = {
  CONNECTION_OFF: '연계 꺼짐',
  NOT_CONNECTED: '연결 안 됨',
  REJECTED: '상대 시스템 거부',
  KEY_EXPIRED: '서명 키 만료',
  SIGN_FAILED: '서명 실패',
  PIPELINE_FAILED: '실행 실패',
  UNKNOWN: '알 수 없는 오류',
};

export interface IntegrationError {
  errorId: string;
  at: string;
  system: IntegrationErrorSystem;
  systemName: string;
  errorType: IntegrationErrorType;
  /** 대상 — 공장 코드·체험권·정책 ID·실행 ID */
  target: string;
  message: string;
  actorId: string;
  featureId: string | null;
  correlationId: string | null;
}

// ─── CI/CD 파이프라인 실행 결과 수신(IF-13) ───────────────────

export const PIPELINE_RUN_STATUSES = ['STARTED', 'SUCCEEDED', 'FAILED'] as const;
export const PipelineRunStatus = z.enum(PIPELINE_RUN_STATUSES);

/** CI가 보내는 실행 결과 — 실패면 실패 단계·사유가 있어야 한다 */
export const PipelineRunBody = z
  .object({
    runId: z.string().trim().min(2).max(80),
    pipeline: z.string().trim().min(2).max(120),
    environment: z.string().trim().min(1).max(40),
    status: PipelineRunStatus,
    featureId: z.string().regex(/^FEAT-\d{5}$/).optional(),
    stage: z.string().trim().min(1).max(80).optional(),
    reason: z.string().trim().min(2).max(1000).optional(),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((b) => b.status !== 'FAILED' || (!!b.stage && !!b.reason), { message: '실패한 실행은 실패 단계(stage)와 사유(reason)가 있어야 합니다', path: ['stage'] });
export type PipelineRunBody = z.infer<typeof PipelineRunBody>;

export interface PipelineRun extends PipelineRunBody {
  receivedAt: string;
  receivedBy: string;
}

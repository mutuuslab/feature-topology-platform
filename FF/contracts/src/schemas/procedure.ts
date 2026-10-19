// 업무 절차 실행 계약 — 활동 완료(서버 저장)·Evidence·개인 서명·검토함 요약.
// 활동 정의는 docs/65-workflows 모델이 원천이고(WORKFLOW_INDEX), 여기서는 실행 기록의 모양만 정한다.
import { z } from 'zod';

export const PROCEDURE_EVIDENCE_KINDS = ['LINK', 'TEST', 'GATE', 'DOC'] as const;
export const ProcedureEvidenceKind = z.enum(PROCEDURE_EVIDENCE_KINDS);
export type ProcedureEvidenceKind = z.infer<typeof ProcedureEvidenceKind>;

export const ProcedureEvidence = z
  .object({
    kind: ProcedureEvidenceKind.default('LINK'),
    /** 사람이 읽는 이름 — 무엇을 확인했는가 */
    name: z.string().trim().min(1).max(80),
    /** 링크·시험 ID·Gate 기록 ID — 화면에서 열거나 조회할 수 있는 값 */
    ref: z.string().trim().min(1).max(500),
  })
  .strict();
export type ProcedureEvidence = z.infer<typeof ProcedureEvidence>;

/** 활동 완료 — 완료 기준(checks)을 확인했다는 기록. sign=true면 HSM 개인 키로 서명한다 */
export const ProcedureCompleteBody = z
  .object({
    note: z.string().trim().max(1000).optional(),
    evidence: z.array(ProcedureEvidence).max(10).default([]),
    sign: z.boolean().default(false),
  })
  .strict();
export type ProcedureCompleteBody = z.infer<typeof ProcedureCompleteBody>;

/** 개인 서명 — Release Sign-off와 같은 HSM 승인 서명(대상 본문의 JCS 해시에 묶인다) */
export interface ProcedureSignature {
  kid: string;
  signedBy: string;
  signedAt: string;
  /** 서명 대상 본문의 sha256(16진) — 기록이 바뀌면 서명이 맞지 않는다 */
  digest: string;
  value: string;
}

/** 현재 유효한 완료 기록(활동마다 최신 1건) */
export interface ProcedureCompletion {
  activityId: string;
  processId: string;
  /** 완료를 맡은 조직 역할(R·A 중 하나) */
  roleId: string;
  completedBy: string;
  /** 요청 때의 IAM 역할 — 감사 추적용(조직 역할과 함께 남긴다) */
  completedRole: string;
  completedAt: string;
  note: string | null;
  evidence: ProcedureEvidence[];
  signature: ProcedureSignature | null;
  /** 서명 검증 결과 — 서명이 없으면 null, 본문이 바뀌었으면 false(감사로 확인) */
  signatureValid: boolean | null;
}

export interface ProcedureStateView {
  items: ProcedureCompletion[];
  done: string[];
  updatedAt: string | null;
}

export type ProcedureInboxKind = 'TODO' | 'REVIEW';

export interface ProcedureInboxItem {
  activityId: string;
  processId: string;
  processName: string;
  activityName: string;
  /** TODO = 내가 수행(R) · REVIEW = 내가 책임(A) — 검토함 */
  kind: ProcedureInboxKind;
  roleId: string;
  roleName: string;
  /** 이 활동이 준비된 시각(앞 활동 완료) — 없으면 처음부터 준비 */
  readyAt: string | null;
  /** SLA 기한(준비 시각 + sla_hours) — 없으면 기한 없음 */
  dueAt: string | null;
  overdue: boolean;
  gateDecision: string | null;
  anchor: string | null;
}

/** 프로세스 한 건의 진행 — 메인 화면 절차 지도가 쓴다(이름·Gate는 생성된 WORKFLOW_MAP이 갖는다) */
export interface ProcedureProcessCount {
  id: string;
  /** 프로세스 활동 전체 */
  total: number;
  /** 완료된 활동(역할 무관) */
  done: number;
  /** 내가 수행(R)이고 지금 할 수 있는 활동 */
  todo: number;
  /** 내가 책임(A)이고 지금 검토할 수 있는 활동 */
  review: number;
  /** 기한이 지난 내 활동 */
  overdue: number;
}

export interface ProcedureSummary {
  /** 내가 수행(R)이고 지금 할 수 있는 활동 */
  todo: number;
  /** 내가 책임(A)이고 지금 검토할 수 있는 활동 */
  review: number;
  /** 기한이 지난 내 활동 */
  overdue: number;
  /** 내가 맡은 활동 중 완료 */
  done: number;
  /** 내가 맡은 활동 전체 */
  total: number;
  /** 프로세스 13개 — 메인 화면 절차 지도(순서는 모델 그대로) */
  processes: ProcedureProcessCount[];
}

export interface ProcedureInboxView {
  items: ProcedureInboxItem[];
  summary: ProcedureSummary;
  /** 이 역할로 확인된 조직 역할 — 화면이 "왜 비었는지"를 설명할 수 있게 */
  roleIds: string[];
}

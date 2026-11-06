// FF가 주인인 Lake 연계 기록 읽기(80-70 4장 모델 사용 승인 · FR-ROL-002-006 중단 기준) — 여러 도메인이 같이 읽는 작은 조회만.
// 쓰기는 각 도메인 서비스(감사·이벤트와 같은 트랜잭션)가 한다.
import { MODEL_USE_REQUIRED, type AbortCriteria, type ModelApproval, type ModelUseStatus } from '@ff/contracts';
import type { Db } from '../../kernel/db';

/** 판 하나의 사용 승인 — 2인(서로 다른 사람) 승인이면 APPROVED, 거부가 하나라도 있으면 REJECTED */
export function modelUseOf(db: Db, modelId: string, version: string): { use: ModelUseStatus; approvals: ModelApproval[] } {
  const approvals = db
    .all<{ decided_by: string; role: string; decision: 'APPROVE' | 'REJECT'; reason: string; at: string }>('SELECT decided_by, role, decision, reason, at FROM lake_model_use WHERE model_id = ? AND version = ? ORDER BY id', modelId, version)
    .map((r) => ({ by: r.decided_by, role: r.role, at: r.at, decision: r.decision, reason: r.reason }));
  const use: ModelUseStatus = approvals.some((a) => a.decision === 'REJECT') ? 'REJECTED' : new Set(approvals.filter((a) => a.decision === 'APPROVE').map((a) => a.by)).size >= MODEL_USE_REQUIRED ? 'APPROVED' : 'PENDING';
  return { use, approvals };
}

/** 사전 등록된 중단 기준 — 추가만, 마지막 등록이 유효(변경 이력은 감사·표에 남는다) */
export function abortCriteriaOf(db: Db, policyId: string): AbortCriteria | null {
  const r = db.get<{ doc: string }>('SELECT doc FROM policy_abort_criteria WHERE policy_id = ? ORDER BY id DESC LIMIT 1', policyId);
  return r ? (JSON.parse(r.doc) as AbortCriteria) : null;
}

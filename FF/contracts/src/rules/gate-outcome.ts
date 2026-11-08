// Gate 결과 집계·해당 없음(N/A) 판정 (P10, D01-02) — 9 Gate 상태를 명세 4값(PASS·PENDING·FAIL·N/A)으로 보이고,
// Feature Version별 최종 Go/No-Go를 계산한다. N/A는 판정자가 사유와 함께 요청하고 다른 사람(Safety Manager)이 승인해야 기록된다.
// 순수 함수 — 백엔드(Gate 조회·전이)와 화면(Gate 탭)이 같은 결과를 본다.
import { z } from 'zod';
import { GATE_META, GATES, GateId, type Asil, type GateStatus } from '../enums';
export { GATE_NA_APPROVERS, GATE_NA_REQUESTERS } from './lifecycle-gate-roles';

// @req FR-REG-005-008 FR-REG-005-009 FR-REG-005-013
/** 저장 상태 → 명세 상태값(FR-REG-005-008) — '검토 중'(CONDITIONAL)이 명세의 PENDING */
export const GATE_STATUS_SPEC: Record<GateStatus, 'PASS' | 'PENDING' | 'FAIL' | 'N/A'> = { PASS: 'PASS', '검토 중': 'PENDING', FAIL: 'FAIL', 'N/A': 'N/A' };

/** 이 상태면 그 Gate는 통과로 본다 — 승인된 N/A는 '해당 없음'이라 전이·단계 순서를 막지 않는다 */
export const gateSatisfied = (s: string | null | undefined): boolean => s === 'PASS' || s === 'N/A';

export type GoNoGo = 'GO' | 'NO_GO' | 'PENDING';
export const GO_NO_GO_LABEL: Record<GoNoGo, string> = { GO: 'Go', NO_GO: 'No-Go', PENDING: '판정 중' };

export interface GoNoGoResult {
  result: GoNoGo;
  /** 필수 Gate(N/A 승인된 것을 뺀 나머지) */
  required: GateId[];
  failed: GateId[];
  /** 미판정·검토 중 — Go도 No-Go도 아직 아님 */
  open: GateId[];
  notApplicable: GateId[];
  passed: GateId[];
}

/**
 * 최종 Go/No-Go(FR-REG-005-009) — 필수 Gate 중 FAIL이 1건이라도 있으면 No-Go, 모두 PASS면 Go, 그 밖(미판정·검토 중)은 판정 중.
 * N/A는 필수 Gate에서 빠진다.
 */
export function goNoGo(latest: Partial<Record<GateId, string | null | undefined>>): GoNoGoResult {
  const notApplicable = GATES.filter((g) => latest[g] === 'N/A');
  const required = GATES.filter((g) => latest[g] !== 'N/A');
  const failed = required.filter((g) => latest[g] === 'FAIL');
  const passed = required.filter((g) => latest[g] === 'PASS');
  const open = required.filter((g) => latest[g] !== 'PASS' && latest[g] !== 'FAIL');
  const result: GoNoGo = failed.length ? 'NO_GO' : open.length ? 'PENDING' : 'GO';
  return { result, required, failed, open, notApplicable, passed };
}

// ── 해당 없음(N/A) ─────────────────────────────────────────────
/** 언제나 해당되는 Gate — Feature 정의(Owner·필수 관계)·제어 수단(Safe Default·Rollback·긴급 차단)·운영 관측(Telemetry·감사·경보)은 모든 Feature에 있다 */
export const GATE_NA_NEVER: readonly GateId[] = ['G1', 'G4', 'G9'];
/** ASIL이 QM이 아니면 해당 없음으로 뺄 수 없는 Gate — 요구·위험 분석(G2)과 기능안전·보안(G7) */
export const GATE_NA_SAFETY: readonly GateId[] = ['G2', 'G7'];


/** 이 Gate를 N/A로 둘 수 없는 사유 — 둘 수 있으면 null */
export function gateNaBlocker(gate: GateId, asil: Asil | string): string | null {
  if (GATE_NA_NEVER.includes(gate)) return `${gate} ${GATE_META[gate].name}은(는) 모든 Feature에 해당합니다 — 해당 없음으로 둘 수 없습니다.`;
  if (GATE_NA_SAFETY.includes(gate) && asil !== 'QM') return `ASIL ${asil} Feature의 ${gate} ${GATE_META[gate].name}은(는) 해당 없음으로 둘 수 없습니다 — QM Feature만 가능합니다.`;
  return null;
}

export const GateNaRequestBody = z
  .object({
    gate: GateId,
    /** 해당 없음 사유 — 승인자가 읽고 판단한다 */
    reason: z.string().trim().min(5, '해당 없음 사유를 5자 이상 입력하세요.').max(512),
  })
  .strict();
export type GateNaRequestBody = z.infer<typeof GateNaRequestBody>;

export const GateNaDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(2, '사유를 2자 이상 입력하세요.').max(500) }).strict();
export type GateNaDecisionBody = z.infer<typeof GateNaDecisionBody>;

export type GateNaStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface GateNaRequest {
  requestId: string;
  featureId: string;
  version: string;
  gate: GateId;
  reason: string;
  status: GateNaStatus;
  requestedBy: string;
  requestedRole: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedRole: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** 승인되면 남는 Gate Record(N/A) */
  gateRecordId: string | null;
}

// Gate Decision Record (보고서 v1.1 6.6 FFG-LCY-001) — 모든 Gate 결정은 대상(Feature·Version·Baseline)·판정·근거 Evidence ID·
// 승인자 역할·시각을 담은 기록으로 남기고 전자서명한다(HSM 'gate' 용도 키, JCS 정규화 바이트). 서명이 맞지 않거나 없는 Gate 기록은
// Lifecycle 전이의 근거가 되지 못한다(rules/lifecycle evaluateTransition GATE_UNSIGNED).
// 상세설계서 v0.81 이관 기록(시드)은 부팅 때 플랫폼이 provenance=IMPORT로 서명한다 — "플랫폼이 내린 결정"이 아니라 "이관된 결정을
// 그 내용 그대로 봉인했다"는 뜻이고, 화면은 이관 기록으로 구분해 보인다.
import type { GateRecordRow } from '../schemas/dataset';

export const DECISION_SCHEMA = 'ffp-gate-decision/1' as const;
export type DecisionProvenance = 'PLATFORM' | 'IMPORT';

export interface GateDecisionPayload {
  schema: typeof DECISION_SCHEMA;
  gateRecordId: string;
  target: { featureId: string; featureVersion: string; baselineId: string | null };
  gate: GateRecordRow['gate'];
  inputResult: GateRecordRow['inputResult'];
  status: GateRecordRow['status'];
  evidenceRef: string | null;
  rationale: string;
  /** 판정한 사람과 그때의 역할 — 이관 기록은 원본의 판정 역할(사람 ID 없음) */
  approver: { id: string | null; role: string };
  judgedAt: string;
  provenance: DecisionProvenance;
}

export interface GateDecision {
  payload: GateDecisionPayload;
  signature: { alg: 'EdDSA'; kid: string; value: string };
  signedAt: string;
}

/** Gate 기록 → 서명할 결정 본문. 기록의 판정 필드가 바뀌면(변조) 본문도 달라져 서명이 맞지 않는다 */
export function decisionPayload(
  r: GateRecordRow,
  approver: { id: string | null; role: string },
  provenance: DecisionProvenance,
  baselineId: string | null = null,
): GateDecisionPayload {
  return {
    schema: DECISION_SCHEMA,
    gateRecordId: r.gateRecordId,
    target: { featureId: r.featureId, featureVersion: r.featureVersion, baselineId },
    gate: r.gate,
    inputResult: r.inputResult,
    status: r.status,
    evidenceRef: r.evidenceRef,
    rationale: r.rationale,
    approver,
    judgedAt: r.judgedAt,
    provenance,
  };
}

export type DecisionState = 'SIGNED' | 'IMPORTED' | 'MISSING' | 'INVALID';

/**
 * 결정 기록 대조 — 서명 검증 결과(sigValid)와 지금 Gate 기록에서 다시 만든 본문이 서명된 본문과 같은지.
 * @rule FFG-LCY-001 — 서명된 Decision Record 없이는 전이 금지. 승인자 개인 서명(Gate 판정자 키)은 플랫폼 gate 키로 대신한다(개인 키 서명은 WP 이후 IAM)
 */
export function decisionState(r: GateRecordRow, d: GateDecision | null, sigValid: boolean): { state: DecisionState; reason: string | null } {
  if (!d) return { state: 'MISSING', reason: `${r.gateRecordId}: 서명된 Decision Record가 없습니다` };
  if (!sigValid) return { state: 'INVALID', reason: `${r.gateRecordId}: Decision Record 서명이 맞지 않습니다` };
  const now = decisionPayload(r, d.payload.approver, d.payload.provenance, d.payload.target.baselineId);
  const changed = (Object.keys(now) as (keyof GateDecisionPayload)[]).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(d.payload[k]));
  if (changed.length) return { state: 'INVALID', reason: `${r.gateRecordId}: 서명 뒤 Gate 기록이 바뀌었습니다 (${changed.join(', ')})` };
  return { state: d.payload.provenance === 'IMPORT' ? 'IMPORTED' : 'SIGNED', reason: null };
}

/** 전이 근거로 쓸 수 있는 결정 — 플랫폼 서명 또는 이관 봉인 */
export const decisionUsable = (s: DecisionState) => s === 'SIGNED' || s === 'IMPORTED';

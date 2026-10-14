// SUMS 기록 (보고서 v1.1 6.6 · FFG-LCY-008) — Flag나 파라미터를 바꾸는 모든 명령은 SW 업데이트로 기록한다.
// 기록 항목은 ① 대상 RXSWIN ② 형식승인 영향 평가 ③ 사용자 고지 내용 ④ 결과. 보존 기간은 가장 긴 시장 요건(compliance-profile sumsRetention).
// 순수 함수: 명령(kill_command v2) → 기록 본문과 빠진 항목. 결과는 회신 집계가 끝날 때 따로 덧붙인다(기록은 추가만).
import type { KillCommandV2 } from '../schemas/wire';

export interface SumsEntry {
  commandId: string;
  featureId: string;
  featureVersion: string;
  request: KillCommandV2['request'];
  market: string;
  vehicles: number;
  /** ① 대상 RXSWIN */
  rxswin: string;
  /** ② 형식승인 영향 평가 */
  typeApproval: { impact: string; r156AssessmentId: string };
  /** ③ 사용자 고지 */
  userNotice: { required: boolean; textRef: string | null; userConfirmationRequired: boolean };
  /** 기록에 빠진 항목(있으면 SUMS 감사 FAIL) */
  missing: string[];
}

/**
 * 명령 → SUMS 기록 본문.
 * @rule FFG-LCY-008 — 네 항목 기록(결과는 회신 집계 종료 시 덧붙임), 보존 기간은 Profile 최대값
 */
export function sumsEntry(cmd: KillCommandV2): SumsEntry {
  const missing: string[] = [];
  if (!cmd.target.rxswin) missing.push('RXSWIN');
  if (!cmd.regulatory.r156_assessment_id) missing.push('형식승인 영향 평가 ID');
  if (cmd.user_notice.required && !cmd.user_notice.text_ref) missing.push('사용자 고지 문안');
  return {
    commandId: cmd.command_id,
    featureId: cmd.feature.id,
    featureVersion: cmd.feature.version,
    request: cmd.request,
    market: cmd.target.market,
    vehicles: cmd.scope.vehicle_ids.length,
    rxswin: cmd.target.rxswin,
    typeApproval: { impact: cmd.regulatory.type_approval_impact, r156AssessmentId: cmd.regulatory.r156_assessment_id },
    userNotice: { required: cmd.user_notice.required, textRef: cmd.user_notice.text_ref ?? null, userConfirmationRequired: !!cmd.user_notice.user_confirmation_required },
    missing,
  };
}

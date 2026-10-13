// 이상 징후 대응 (D06-12) · 품질 피드백 반영 (D04-06) — PoC ⑥ "이상 확인 → 긴급 차단 → 품질 반영".
// 현장 신호(차량 고장 보고·서명 거부 회신·배포 회신 이상)를 Feature별 이상 건으로 묶고, 심각도·권고를 이 표로 정한다.
// 조치된 이상 건은 Feature에 품질 피드백으로 남아 새 Version의 재검증(G5·vECU 회귀)을 요구한다.
import { z } from 'zod';

export const AnomalyKind = z.enum(['FEATURE_FAULT', 'SECURITY', 'DELIVERY']);
export type AnomalyKind = z.infer<typeof AnomalyKind>;
export const AnomalySeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type AnomalySeverity = z.infer<typeof AnomalySeverity>;
export const AnomalyStatus = z.enum(['OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'DISMISSED']);
export type AnomalyStatus = z.infer<typeof AnomalyStatus>;

/** 권고 — KILL은 긴급 차단 권고(운영자가 판단해 발령), 나머지는 조사·재전달·보안 검토 */
export type AnomalyAdvice = 'KILL' | 'INVESTIGATE' | 'REDELIVER' | 'SECURITY_REVIEW' | 'MONITOR';

/** 이상 신호 하나 — 플랫폼 이벤트에서 정규화한다 */
export interface AnomalySignal {
  kind: AnomalyKind;
  featureId: string;
  vin: string | null;
  /** FEATURE_FAULT: 고장 코드 / SECURITY: 거부 사유 / DELIVERY: 게시본 상태 */
  code: string;
  severity: AnomalySeverity;
  at: string;
  ref: string | null;
}

/** 차량 서명 거부 사유 → 보안 이상 심각도 (재전송은 공격일 수도, 지연 중복일 수도 있다) */
export const SECURITY_REJECT: Record<string, AnomalySeverity> = {
  PAYLOAD_TAMPERED: 'CRITICAL',
  BAD_SIGNATURE: 'CRITICAL',
  UNKNOWN_KEY: 'CRITICAL',
  KEY_EXPIRED: 'WARNING',
  REPLAY: 'WARNING',
  MALFORMED: 'WARNING',
};

/** 배포 회신 집계 결과 → 전달 이상 심각도 */
export const DELIVERY_STATUS: Record<string, AnomalySeverity> = { DIVERGED: 'CRITICAL', TIMEOUT: 'WARNING', PARTIAL: 'INFO' };

const RANK: Record<AnomalySeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const max = (a: AnomalySeverity, b: AnomalySeverity) => (RANK[a] >= RANK[b] ? a : b);

/**
 * 이상 건 판정 — 같은 (종류, Feature)의 신호를 모아 심각도·권고·근거를 낸다.
 * FEATURE_FAULT: 차량이 CRITICAL을 보고했거나, 서로 다른 차량 3대 이상, 또는 ASIL B 이상에서 2대 이상이면 CRITICAL → 긴급 차단 권고.
 */
/** 상태 보고 수신 검사 위반 심각도(FFG-TEL-003) — 증명 실패·해제 없는 ACTIVE·명령 없는 상태는 CRITICAL */
export const STATUS_VIOLATION_SEVERITY: Record<string, AnomalySeverity> = {
  AUTH_FAILED: 'CRITICAL',
  ACTIVE_WITHOUT_RESTORE: 'CRITICAL',
  STATE_WITHOUT_COMMAND: 'CRITICAL',
  SEQ_AHEAD: 'CRITICAL',
  PSEUDONYM_MISMATCH: 'CRITICAL',
  REPLAY: 'WARNING',
  SCHEMA: 'WARNING',
  UNKNOWN_FEATURE: 'WARNING',
  VERSION_MISMATCH: 'WARNING',
};

export function classifyAnomaly(kind: AnomalyKind, signals: AnomalySignal[], ctx: { asil: string | null }): { severity: AnomalySeverity; advice: AnomalyAdvice; reasons: string[] } {
  const vins = new Set(signals.map((s) => s.vin).filter(Boolean));
  const reported = signals.reduce<AnomalySeverity>((m, s) => max(m, s.severity), 'INFO');
  const reasons: string[] = [];
  if (kind === 'FEATURE_FAULT') {
    let sev = reported;
    if (reported === 'CRITICAL') reasons.push('차량이 CRITICAL 고장을 보고');
    if (vins.size >= 3) (sev = 'CRITICAL'), reasons.push(`서로 다른 차량 ${vins.size}대에서 보고`);
    const safety = !!ctx.asil && ctx.asil !== 'QM' && ctx.asil !== 'A';
    if (safety && vins.size >= 2) (sev = 'CRITICAL'), reasons.push(`ASIL ${ctx.asil} 기능 — 2대 이상에서 보고`);
    if (!reasons.length) reasons.push(`차량 ${vins.size}대 · 최고 보고 수준 ${reported}`);
    return { severity: sev, advice: sev === 'CRITICAL' ? 'KILL' : sev === 'WARNING' ? 'INVESTIGATE' : 'MONITOR', reasons };
  }
  if (kind === 'SECURITY') {
    // ref가 STATUS:로 시작하면 상태 보고 수신 검사 위반(D04-03), 아니면 차량이 게시본을 거부
    const rejects = [...new Set(signals.filter((s) => !(s.ref ?? '').startsWith('STATUS:')).map((s) => s.code))];
    const status = [...new Set(signals.filter((s) => (s.ref ?? '').startsWith('STATUS:')).map((s) => s.code))];
    if (rejects.length) reasons.push(`차량이 서명 게시본을 거부: ${rejects.join(', ')}`);
    if (status.length) reasons.push(`상태 보고 검사 위반: ${status.join(', ')}`);
    return { severity: reported, advice: 'SECURITY_REVIEW', reasons };
  }
  const worst = signals.reduce<AnomalySeverity>((m, s) => max(m, s.severity), 'INFO');
  reasons.push(`배포 회신 ${[...new Set(signals.map((s) => s.code))].join(', ')}`);
  return { severity: worst, advice: worst === 'CRITICAL' ? 'INVESTIGATE' : 'REDELIVER', reasons };
}

export const AnomalySchema = z.object({
  anomalyId: z.string().regex(/^ANM-\d{5}$/),
  kind: AnomalyKind,
  featureId: z.string(),
  status: AnomalyStatus,
  severity: AnomalySeverity,
  advice: z.enum(['KILL', 'INVESTIGATE', 'REDELIVER', 'SECURITY_REVIEW', 'MONITOR']),
  reasons: z.array(z.string()),
  vins: z.array(z.string()),
  signals: z.array(z.object({ kind: AnomalyKind, featureId: z.string(), vin: z.string().nullable(), code: z.string(), severity: AnomalySeverity, at: z.string(), ref: z.string().nullable() })),
  openedAt: z.string(),
  updatedAt: z.string(),
  acknowledgedBy: z.string().nullable(),
  closedBy: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
  killId: z.string().nullable(),
});
export type Anomaly = z.infer<typeof AnomalySchema>;

export const AnomalyActionBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type AnomalyActionBody = z.infer<typeof AnomalyActionBody>;

// ---- 품질 피드백 (D04-06) ----

export const FeedbackStatus = z.enum(['OPEN', 'ACCEPTED', 'RESOLVED']);
export type FeedbackStatus = z.infer<typeof FeedbackStatus>;

export interface QualityFeedback {
  feedbackId: string;
  featureId: string;
  /** 현장에서 문제가 난 Version (해소는 이보다 높은 Version의 G5 PASS) */
  featureVersion: string;
  anomalyId: string;
  kind: AnomalyKind;
  summary: string;
  /** 다음 Version이 해야 할 일 — 재판정 Gate·vECU 회귀 시나리오 */
  actions: { kind: 'REJUDGE_GATE' | 'VIRTUAL_REGRESSION'; ref: string; label: string }[];
  status: FeedbackStatus;
  createdAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
}

/** 조치된 이상 건 → 다음 Version이 할 일. 고장·보안은 G5(검증) 재판정, ASIL B 이상은 G7(안전·보안)도. vECU 시나리오가 있으면 회귀 실행. */
export function feedbackActions(a: Pick<Anomaly, 'kind'>, ctx: { asil: string | null; virtualScenarios: string[] }): QualityFeedback['actions'] {
  if (a.kind === 'DELIVERY') return [];
  const out: QualityFeedback['actions'] = [{ kind: 'REJUDGE_GATE', ref: 'G5', label: 'G5 Verification Gate 재판정' }];
  if (a.kind === 'SECURITY' || (ctx.asil && ctx.asil !== 'QM')) out.push({ kind: 'REJUDGE_GATE', ref: 'G7', label: 'G7 Safety/Security Gate 재판정' });
  for (const s of ctx.virtualScenarios) out.push({ kind: 'VIRTUAL_REGRESSION', ref: s, label: `vECU 회귀 ${s}` });
  return out;
}

const semver = (v: string) => v.split('.').map((x) => Number(x) || 0);
/** a가 b보다 높은 Version인가 */
export function versionAfter(a: string, b: string): boolean {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export const FeedbackAcceptBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type FeedbackAcceptBody = z.infer<typeof FeedbackAcceptBody>;

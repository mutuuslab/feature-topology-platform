// 배포와 효력 분리·단계적 확대 (보고서 v1.1 6.6 · FFG-LCY-009) — 패키지 전달(정책 배포, D01-06)과 차량 내 효력 확대(단계적 기능 배포,
// D01-08)는 따로 승인한다: 효력을 넓히는 사람은 그 정책을 배포한 사람이 아니어야 한다. F2 이상은 Canary Cohort(≤ CANARY_MAX_BP)에서
// 시작하고, 정해진 관측 기간이 지나고 중단 기준(열린 기능·보안 이상 징후 없음, 진행 중 차단 없음)을 만족해야 범위를 넓힌다.
// 줄이기·멈추기(0%)는 언제나 된다. 판정은 기록(중단 기준 판정)으로 남긴다.
import type { FClass } from '../schemas/safety';

/** Canary Cohort 상한 — 5% */
export const CANARY_MAX_BP = 500;
/** Canary 관측 기간 — 24시간 */
export const CANARY_OBSERVE_MS = 24 * 3600_000;

export interface StageChangeInput {
  fClass: FClass | null;
  /** 지금 효력 범위(bp) */
  current: number;
  to: number;
  /** 지금 범위가 시작된 시각(마지막 단계 조정 또는 배포) */
  since: string;
  now: string;
  actorId: string;
  deployedBy: string | null;
  /** 이 Feature의 열린 FEATURE_FAULT·SECURITY 이상 징후 */
  openAnomalies: string[];
  /** 이 Feature에 진행 중인 차단 */
  activeKills: string[];
}

export interface StageJudgement {
  kind: 'SHRINK' | 'CANARY' | 'EXPAND';
  ok: boolean;
  blockers: { code: 'SAME_AS_DEPLOYER' | 'CANARY_FIRST' | 'OBSERVATION' | 'STOP_CRITERIA'; message: string }[];
  /** 중단 기준 판정 기록 */
  criteria: { observedMs: number; requiredMs: number; openAnomalies: string[]; activeKills: string[] } | null;
}

const safetyRelated = (f: FClass | null) => f == null || f >= 'F2';

/**
 * 단계 조정 판정.
 * @rule FFG-LCY-009 — 배포·효력 승인 분리, F2 이상 Canary 시작과 관측 기간·중단 기준 판정. 배포 직후 범위는 deployStartBasisPoints
 */
export function judgeStageChange(i: StageChangeInput): StageJudgement {
  if (i.to <= i.current) return { kind: 'SHRINK', ok: true, blockers: [], criteria: null };
  const blockers: StageJudgement['blockers'] = [];
  if (i.deployedBy && i.actorId === i.deployedBy)
    blockers.push({ code: 'SAME_AS_DEPLOYER', message: '정책을 배포한 사람은 차량 내 효력을 넓힐 수 없습니다 — 배포(전달)와 효력 확대는 다른 사람이 승인합니다' });
  if (!safetyRelated(i.fClass) || i.to <= CANARY_MAX_BP) return { kind: i.to <= CANARY_MAX_BP ? 'CANARY' : 'EXPAND', ok: !blockers.length, blockers, criteria: null };
  // F2 이상, Canary 범위를 넘어 넓히기 — Canary에서 관측 중이어야 하고 관측 기간·중단 기준을 만족해야 한다
  const observedMs = Math.max(0, new Date(i.now).getTime() - new Date(i.since).getTime());
  if (i.current <= 0) blockers.push({ code: 'CANARY_FIRST', message: `${i.fClass ?? '분류 없음'} Feature — 먼저 Canary(≤ ${CANARY_MAX_BP / 100}%)로 시작해야 합니다` });
  else if (observedMs < CANARY_OBSERVE_MS) blockers.push({ code: 'OBSERVATION', message: `관측 기간 ${Math.floor(observedMs / 3600_000)}시간 < ${CANARY_OBSERVE_MS / 3600_000}시간` });
  if (i.openAnomalies.length || i.activeKills.length)
    blockers.push({ code: 'STOP_CRITERIA', message: `중단 기준 충족 — ${[...i.openAnomalies.map((a) => `이상 징후 ${a}`), ...i.activeKills.map((k) => `차단 ${k}`)].join(', ')}` });
  return { kind: 'EXPAND', ok: !blockers.length, blockers, criteria: { observedMs, requiredMs: CANARY_OBSERVE_MS, openAnomalies: i.openAnomalies, activeKills: i.activeKills } };
}

/**
 * 배포 직후 효력 범위 — F2 이상(분류 없음 포함)은 승인 범위가 Canary 상한보다 넓어도 Canary(≤ CANARY_MAX_BP)에서 시작한다.
 * null이면 단계 없이 승인 범위 그대로. 이후 확대는 judgeStageChange(관측 기간·중단 기준·다른 승인자)를 거친다.
 * @rule FFG-LCY-009 — F2 이상 활성화는 Canary Cohort부터
 */
export function deployStartBasisPoints(fClass: FClass | null, approvedBp: number): number | null {
  return safetyRelated(fClass) && approvedBp > CANARY_MAX_BP ? CANARY_MAX_BP : null;
}

// 배포와 효력 분리·단계적 확대 (보고서 v1.1 6.6 · FFG-LCY-009) — 패키지 전달(정책 배포, D01-06)과 차량 내 효력 확대(단계적 기능 배포,
// D01-08)는 따로 승인한다: 효력을 넓히는 사람은 그 정책을 배포한 사람이 아니어야 한다. F2 이상은 Canary Cohort(≤ CANARY_MAX_BP)에서
// 시작하고, 정해진 관측 기간이 지나고 중단 기준(열린 기능·보안 이상 징후 없음, 진행 중 차단 없음)을 만족해야 범위를 넓힌다.
// 줄이기·멈추기(0%)는 언제나 된다. 판정은 기록(중단 기준 판정)으로 남긴다.
// 넓히기 보류·중단 판정(지표 신선도·사전 등록 중단 기준·축별 근거·관측 기간·열린 이상 징후·진행 중 차단)은 judgeExpansion 하나다(통합 D-INT-4) —
// 단계 조정 거부와 정책 상세 '확대 판정' 패널이 같은 결과를 읽는다.
import type { FClass } from '../schemas/safety';
import type { ExpansionInput, ExpansionResult, ExpansionVerdict, ExpansionView } from './ads-change';
import type { CanaryObservation, CanaryVerdict } from './lake';

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
  /** 확대 판정 근거(Canary 규칙 ①·신선도 TL-B01·B02, 축별 근거 ADS-BE12) — 단계 기준과 함께 judgeExpansion 하나로 판정해 막는 사유만 거부로 쓴다. 근거가 없으면 null. 모델 점수는 넣지 않는다(INV-17) */
  expansion?: ExpansionSources | null;
}

export interface StageJudgement {
  kind: 'SHRINK' | 'CANARY' | 'EXPAND';
  ok: boolean;
  blockers: { code: 'SAME_AS_DEPLOYER' | 'CANARY_FIRST' | 'OBSERVATION' | 'STOP_CRITERIA' | 'STALE_DATA' | 'ABORT_CRITERIA' | 'FROZEN' | 'INSUFFICIENT_EVIDENCE'; message: string }[];
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
  // 확대 판정 하나(judgeExpansion) — 근거(지표 지연 → 보류 INV-16, 경계·경보 → 중단, 동결 → 거부)와 단계 기준(F2 이상이 Canary를 넘어 넓힐 때: Canary 먼저·관측 기간·
  // 열린 이상 징후·진행 중 차단)을 같은 규칙으로 판정해 막는 사유만 거부로 쓴다. 알림(표본 부족·미등록 기준·가정값 근거)은 막지 않고 화면이 알린다
  const beyondCanary = safetyRelated(i.fClass) && i.to > CANARY_MAX_BP;
  const observedMs = Math.max(0, new Date(i.now).getTime() - new Date(i.since).getTime());
  const d = judgeExpansion({ canary: i.expansion?.canary ?? null, evidence: i.expansion?.evidence ?? null, stage: { fClass: i.fClass, current: i.current, beyondCanary, observedMs, openAnomalies: i.openAnomalies, activeKills: i.activeKills } });
  blockers.push(...stageBlockers(d.findings));
  if (!beyondCanary) return { kind: i.to <= CANARY_MAX_BP ? 'CANARY' : 'EXPAND', ok: !blockers.length, blockers, criteria: null };
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

/* ───────────────────────── 확대 판정 — 하나의 규칙 (통합 D-INT-4) ───────────────────────── */

/** 사유 코드 — Canary(Lake 규칙 ①), 축별 근거(동결·감시 지표·조합), 단계 기준(FFG-LCY-009 — Canary 먼저·관측 기간·열린 이상 징후·진행 중 차단) */
export type ExpansionFindingCode =
  | 'FROZEN'
  | 'ABORT_CRITERIA'
  | 'METRIC_ALERT'
  | 'STALE_DATA'
  | 'METRIC_DELAY'
  | 'INSUFFICIENT'
  | 'CANARY_INSUFFICIENT'
  | 'CANARY_FIRST'
  | 'OBSERVATION'
  | 'OPEN_ANOMALY'
  | 'ACTIVE_KILL';

export interface ExpansionFinding {
  source: 'CANARY' | 'EVIDENCE' | 'STAGE';
  code: ExpansionFindingCode;
  verdict: Exclude<ExpansionVerdict, 'EXPAND'>;
  /** 서버가 단계 확대를 막는가 — 아니면 화면 알림만 */
  blocking: boolean;
  /** 막지 않는 까닭 — 중단 기준 미등록 · 가정값 근거 · 판단 불가(알림) */
  waived: 'UNREGISTERED' | 'ASSUMED' | 'ADVISORY' | null;
  /** 지연(분) — 지연 사유만. 들어오지 않았으면 null */
  lagMinutes: number | null;
  /** 경계·경보를 넘은 지표·조합, 지연 지표, 동결 사유·범위, 열린 이상 징후·진행 중 차단, Canary 먼저의 안전 분류 */
  items: string[];
  /** 관측한 시간(ms) — 관측 기간 사유만(기준 CANARY_OBSERVE_MS) */
  observedMs: number | null;
}

export interface ExpansionDecision {
  /** 근거 전체에서 가장 무거운 판정 — 동결 > 중단 > 확대 보류 > 확대 가능 */
  verdict: ExpansionVerdict;
  /** 막는 사유가 하나라도 있다 — 단계 조정 거부(judgeStageChange)와 같은 뜻 */
  blocked: boolean;
  /** 무거운 순 */
  findings: ExpansionFinding[];
}

export interface ExpansionJudgeInput {
  /** Canary 관측(judgeCanary) — Lake가 연결되지 않았으면 null */
  canary: { verdict: CanaryVerdict; lagMinutes: number | null; breached: string[]; registered: boolean } | null;
  /** 축별 근거(expansionVerdict, ADS-BE12) — 이 Feature Version에 입력이 없으면 null */
  evidence: { result: ExpansionResult; metrics: { key: string; breached: boolean }[]; frozen: ExpansionInput['frozen']; assumed: boolean } | null;
  /** 단계 기준(FFG-LCY-009) — 없으면 보지 않는다 */
  stage?: StageCriteriaInput | null;
}

/** 단계 기준이 사유가 되는가 — F2 이상(분류 없음 포함)이 Canary 범위를 넘어 넓힐 때 */
export function stageCriteriaApply(s: Pick<StageCriteriaInput, 'fClass' | 'beyondCanary'>): boolean {
  return s.beyondCanary && safetyRelated(s.fClass);
}

/** 확대 판정의 근거 — Canary 관측과 축별 근거(단계 조정은 단계 기준을 스스로 붙인다) */
export type ExpansionSources = Pick<ExpansionJudgeInput, 'canary' | 'evidence'>;

/** 단계 기준 입력 — F2 이상(분류 없음 포함)이 Canary 범위를 넘어 넓힐 때만 사유가 된다 */
export interface StageCriteriaInput {
  fClass: FClass | null;
  /** 지금 효력 범위(bp) */
  current: number;
  /** Canary 범위(≤ CANARY_MAX_BP)를 넘어 넓히는가 */
  beyondCanary: boolean;
  /** 지금 범위에서 관측한 시간(ms) */
  observedMs: number;
  /** 이 Feature의 열린 FEATURE_FAULT·SECURITY·FIELD_SOTIF 이상 징후 */
  openAnomalies: string[];
  /** 이 Feature에 진행 중인 차단 */
  activeKills: string[];
}

const WEIGHT: Record<ExpansionVerdict, number> = { FROZEN: 3, STOP: 2, HOLD: 1, EXPAND: 0 };

/**
 * 확대 판정 — Canary 규칙 ①(지연 → 보류, 사전 등록 경계 초과 → 중단, 표본 부족 → 알림)과 축별 근거(동결·감시 지표 경보·조합 경보·지표 지연·표본 부족)를
 * 축마다 사유로 낸다. 막는 사유: Canary 지연은 언제나, Canary 경계 초과는 사전 등록했을 때만, 축별 근거는 실측일 때만(가정값은 알림).
 * 단계 조정 거부(judgeStageChange)는 이 결과의 막는 사유만 쓴다 — 서버와 화면이 같은 판정을 읽는다.
 * @rule FFG-LCY-009 · 80-70 4장 ① · ADS-BE12 — 신선도 초과 지표로 넓히지 않는다(INV-16), 모델 점수는 판정에 쓰지 않는다(INV-17)
 */
export function judgeExpansion(i: ExpansionJudgeInput): ExpansionDecision {
  const out: ExpansionFinding[] = [];
  const add = (f: Omit<ExpansionFinding, 'lagMinutes' | 'items' | 'observedMs'> & Partial<Pick<ExpansionFinding, 'lagMinutes' | 'items' | 'observedMs'>>) => out.push({ lagMinutes: null, items: [], observedMs: null, ...f });
  const c = i.canary;
  if (c?.verdict === 'HOLD_STALE') add({ source: 'CANARY', code: 'STALE_DATA', verdict: 'HOLD', blocking: true, waived: null, lagMinutes: c.lagMinutes });
  if (c?.verdict === 'ABORT') add({ source: 'CANARY', code: 'ABORT_CRITERIA', verdict: 'STOP', blocking: c.registered, waived: c.registered ? null : 'UNREGISTERED', items: c.breached });
  if (c?.verdict === 'INSUFFICIENT') add({ source: 'CANARY', code: 'CANARY_INSUFFICIENT', verdict: 'HOLD', blocking: false, waived: 'ADVISORY' });
  const e = i.evidence;
  if (e) {
    const gate = { source: 'EVIDENCE' as const, blocking: !e.assumed, waived: e.assumed ? ('ASSUMED' as const) : null };
    const comboOf = (v: string) => e.result.combos.filter((x) => x.verdict === v).map((x) => x.comboId);
    if (e.frozen) add({ ...gate, code: 'FROZEN', verdict: 'FROZEN', items: [e.frozen.reason, e.frozen.scope] });
    const alert = [...e.metrics.filter((m) => m.breached).map((m) => m.key), ...comboOf('ALERT')];
    if (alert.length) add({ ...gate, code: 'METRIC_ALERT', verdict: 'STOP', items: alert });
    if (e.result.staleMetrics.length)
      add({ ...gate, code: 'METRIC_DELAY', verdict: 'HOLD', items: e.result.staleMetrics, lagMinutes: Number.isFinite(e.result.maxDelayMs) ? Math.round(e.result.maxDelayMs / 60_000) : null });
    if (!e.result.combos.some((x) => x.verdict === 'OK')) add({ ...gate, code: 'INSUFFICIENT', verdict: 'HOLD', items: comboOf('INSUFFICIENT') });
  }
  // 단계 기준 — F2 이상이 Canary를 넘어 넓힐 때: Canary에서 관측 중이어야 하고 관측 기간이 지나야 하며 열린 이상 징후·진행 중 차단이 없어야 한다(언제나 막음)
  const s = i.stage;
  if (s && stageCriteriaApply(s)) {
    const gate = { source: 'STAGE' as const, blocking: true, waived: null };
    if (s.current <= 0) add({ ...gate, code: 'CANARY_FIRST', verdict: 'HOLD', items: [s.fClass ?? '분류 없음'] });
    else if (s.observedMs < CANARY_OBSERVE_MS) add({ ...gate, code: 'OBSERVATION', verdict: 'HOLD', observedMs: s.observedMs });
    if (s.openAnomalies.length) add({ ...gate, code: 'OPEN_ANOMALY', verdict: 'STOP', items: s.openAnomalies });
    if (s.activeKills.length) add({ ...gate, code: 'ACTIVE_KILL', verdict: 'STOP', items: s.activeKills });
  }
  // 무거운 순, 같은 무게면 막는 사유 먼저(입력 순서 유지)
  const findings = out.map((f, n) => ({ f, n })).sort((a, b) => WEIGHT[b.f.verdict] - WEIGHT[a.f.verdict] || Number(b.f.blocking) - Number(a.f.blocking) || a.n - b.n).map((x) => x.f);
  return { verdict: findings[0]?.verdict ?? 'EXPAND', blocked: findings.some((f) => f.blocking), findings };
}

/** 막는 사유 → 단계 조정 거부 사유(감사·이벤트 글자) — 열린 이상 징후·진행 중 차단은 중단 기준 충족 하나로 묶는다 */
function stageBlockers(findings: ExpansionFinding[]): StageJudgement['blockers'] {
  const out: StageJudgement['blockers'] = [];
  const stop = findings.filter((f) => f.blocking && (f.code === 'OPEN_ANOMALY' || f.code === 'ACTIVE_KILL'));
  for (const f of findings) {
    if (!f.blocking) continue;
    if (f.code !== 'OPEN_ANOMALY' && f.code !== 'ACTIVE_KILL') out.push(stageBlocker(f));
    else if (f === stop[0]) out.push({ code: 'STOP_CRITERIA', message: `중단 기준 충족 — ${stop.flatMap((x) => x.items.map((id) => `${x.code === 'OPEN_ANOMALY' ? '이상 징후' : '차단'} ${id}`)).join(', ')}` });
  }
  return out;
}

function stageBlocker(f: ExpansionFinding): StageJudgement['blockers'][number] {
  const list = f.items.join(', ');
  switch (f.code) {
    case 'CANARY_FIRST':
      return { code: 'CANARY_FIRST', message: `${list} Feature — 먼저 Canary(≤ ${CANARY_MAX_BP / 100}%)로 시작해야 합니다` };
    case 'OBSERVATION':
      return { code: 'OBSERVATION', message: `관측 기간 ${Math.floor((f.observedMs ?? 0) / 3600_000)}시간 < ${CANARY_OBSERVE_MS / 3600_000}시간` };
    case 'STALE_DATA':
      return { code: 'STALE_DATA', message: `지표가 ${f.lagMinutes == null ? '들어오지 않아' : `${f.lagMinutes}분 지연되어`} 확대를 보류합니다 — 신선도 기준을 넘긴 지표로는 판단하지 않습니다` };
    case 'METRIC_DELAY':
      return { code: 'STALE_DATA', message: `감시 지표 ${list}이(가) ${f.lagMinutes == null ? '들어오지 않아' : `${f.lagMinutes}분 지연되어`} 확대를 보류합니다 — 기준 시간을 넘긴 지표로는 판단하지 않습니다` };
    case 'ABORT_CRITERIA':
      return { code: 'ABORT_CRITERIA', message: `사전 등록한 중단 기준을 넘었습니다 — ${list}` };
    case 'METRIC_ALERT':
      return { code: 'ABORT_CRITERIA', message: `감시 지표·조합 경보로 확대를 멈춥니다 — ${list}` };
    case 'FROZEN':
      return { code: 'FROZEN', message: `확대가 동결되어 있습니다 — ${list}` };
    default:
      return { code: 'INSUFFICIENT_EVIDENCE', message: `조합별 근거의 표본이 하한보다 적어 확대를 보류합니다${list ? ` — ${list}` : ''}` };
  }
}

/** GET /api/policies/:id/expansion — 정책 상세 '확대 판정' 패널 하나가 읽는다. 판정은 단계 조정 거부와 같은 judgeExpansion 결과 */
export interface PolicyExpansionView {
  policyId: string;
  featureId: string;
  featureVersion: string;
  decision: ExpansionDecision;
  /** Canary 관측(TL-UI02) — Lake가 연결되지 않았거나 그 시장 집계가 없으면 null */
  canary: CanaryObservation | null;
  /** 축별 근거(ADS-UI11) — 이 Feature Version에 판정 입력이 없으면 null */
  evidence: ExpansionView | null;
  /** 단계 기준 기록(FFG-LCY-009) — 지금 범위·승인 범위·관측 시간·열린 이상 징후·진행 중 차단. applies는 F2 이상이 Canary를 넘어 넓힐 수 있을 때 */
  stage: { fClass: FClass | null; current: number; ceiling: number; applies: boolean; observedMs: number; requiredMs: number; openAnomalies: string[]; activeKills: string[] };
}

// 확대 판정 문장(통합 D-INT-4) — 정책 상세 '확대 판정' 패널과 단계 조정 Drawer가 같은 판정(PolicyExpansionView.decision)을 같은 글자로 읽는다.
import { CANARY_MAX_BP, CANARY_OBSERVE_MS, type CanaryObservation, type ExpansionFinding, type PolicyExpansionView } from '@ff/contracts';
import { adsChange } from '../../copy/ads-change';
import { lake as L } from '../../copy/lake';

const E = adsChange.exp;
const K = L.canary;
const REQ_H = CANARY_OBSERVE_MS / 3600_000;

export const delayText = (ms: number) => (ms >= 3600_000 ? E.hours(Math.round(ms / 3600_000)) : E.minutes(Math.round(ms / 60_000)));

/** Canary 판정 문장 — 규칙 ① 결과 */
export function canaryVerdictText(o: CanaryObservation): string {
  if (o.verdict === 'OK') return K.verdict.OK(o.nextBasisPoints);
  if (o.verdict === 'HOLD_STALE') return K.verdict.HOLD_STALE(o.freshness.lagSeconds == null ? null : Math.round(o.freshness.lagSeconds / 60));
  if (o.verdict === 'INSUFFICIENT') return K.verdict.INSUFFICIENT;
  const s = o.stats.find((x) => x.metric === o.breached[0]);
  return K.verdict.ABORT(K.metric[o.breached[0]] ?? o.breached[0], s?.relativeRisk ?? 0);
}

/** 단계 기준 사유 문장 — 관측 기간·Canary 먼저·열린 이상 징후·진행 중 차단 */
function stageText(f: ExpansionFinding): string {
  const S = E.stageReason;
  if (f.code === 'OBSERVATION') return S.OBSERVATION(Math.floor((f.observedMs ?? 0) / 3600_000), REQ_H);
  if (f.code === 'CANARY_FIRST') return S.CANARY_FIRST(f.items[0] ?? '');
  if (f.code === 'OPEN_ANOMALY') return S.OPEN_ANOMALY(f.items.length);
  return S.ACTIVE_KILL(f.items.length);
}

/** 판정 머리 사유 — 가장 무거운 사유 하나 */
export function headlineReason(v: PolicyExpansionView): string {
  const f = v.decision.findings[0];
  if (!f) return v.canary ? K.verdict.OK(v.canary.nextBasisPoints) : E.reason.OK;
  if (f.source === 'CANARY' && v.canary) return canaryVerdictText(v.canary);
  if (f.source === 'STAGE') return stageText(f);
  if (f.code === 'METRIC_DELAY' && v.evidence) return E.delay(delayText(v.evidence.result.maxDelayMs));
  return E.reason[f.code] ?? E.code[f.code];
}

/** 판정 사유 한 줄 — 사유 이름, 넘은 지표·조합·ID, 지연·관측 시간 */
export function findingText(f: ExpansionFinding): string {
  const items = f.code === 'CANARY_FIRST' ? [] : f.items.map((x) => E.metricName[x] ?? K.metric[x] ?? x);
  const observed = f.observedMs != null ? ` · ${E.observed(Math.floor(f.observedMs / 3600_000), REQ_H)}` : '';
  return `${E.code[f.code]}${items.length ? ` — ${items.join(', ')}` : ''}${f.lagMinutes != null ? ` · ${E.lag(f.lagMinutes)}` : ''}${observed}`;
}

/** 막는 사유 → 확대 행동을 막은 글자(Drawer·패널 공통) */
export function blockedText(f: ExpansionFinding, v: PolicyExpansionView): string {
  if (f.code === 'STALE_DATA') return K.stage.hold;
  if (f.code === 'ABORT_CRITERIA') return K.stage.abort;
  if (f.code === 'METRIC_DELAY') return E.blockedDelay(Math.round(Math.min(...(v.evidence?.metrics ?? []).map((m) => m.staleAfterMs)) / 60_000));
  if (f.source === 'STAGE') return E.blockedOther(stageText(f));
  return E.blockedOther(E.reason[f.code] ?? E.code[f.code]);
}

/**
 * 넓히기 전 안내 — 막는 사유가 있으면 그 글자(block), 없으면 알림(중단 기준 미등록·표본 부족·가정값 근거) 또는 이상 없음.
 * 단계 기준은 Canary 범위를 넘어 넓힐 때만 본다(서버 judgeStageChange와 같다) — to가 Canary 상한 이하면 뺀다.
 */
export function stageGuard(v: PolicyExpansionView | null | undefined, to: number): { block?: string; note: string | null } {
  if (!v) return { note: null };
  const findings = v.decision.findings.filter((f) => f.source !== 'STAGE' || to > CANARY_MAX_BP);
  const blocking = findings.filter((f) => f.blocking);
  if (blocking.length) return { block: [...new Set(blocking.map((f) => blockedText(f, v)))].join(' '), note: null };
  const notes: string[] = [];
  if (v.canary && !v.canary.criteria.registered) notes.push(K.stage.noCriteria);
  if (findings.some((f) => f.code === 'CANARY_INSUFFICIENT')) notes.push(K.stage.insufficient);
  if (findings.some((f) => f.waived === 'ASSUMED')) notes.push(E.assumedNote);
  if (!notes.length && v.canary) notes.push(K.stage.ok);
  return { note: notes.length ? notes.join(' ') : null };
}

// 생산 출고(EOL) 실물 구성 대조·품질 보류 (ORC-UI08, Orca B06) — 순수 규칙(zod 없음, 화면·백엔드 공용)
// 실물 구성 원장은 공장 품질 시스템(IF-12) — FF는 주문 사양과 VIN 스캔을 대조해 불일치를 품질 보류로 두고, 보류 해제는 공장 품질 기록(재작업·재대조)을 반영한다.
// 부품 누락을 정책 ON으로 덮지 않는다: 지원 판정 HW 칸이 출고 구성 기록을 읽는다(eligibility decideEligibility asBuiltEcus).
// 결정 주체 '생산 품질' — 계약 역할에 없어 결정 D-ADS-7 기본안(기존 역할 대응)으로 BOM 승인자(BOM_APPROVER)에 위임한다.

export interface EolPart {
  ecuPno: string;
  /** 스캔이 개정을 읽지 못하면 null — 실물 미확인 */
  hwRevision: string | null;
}
export type EolVerdict = 'MATCH' | 'MISMATCH' | 'UNCONFIRMED';
export const EOL_VERDICT_LABEL: Record<EolVerdict, string> = { MATCH: '일치', MISMATCH: '불일치', UNCONFIRMED: '실물 미확인' };
export interface EolPartDiff {
  ecuPno: string;
  ordered: string | null;
  built: string | null;
  kind: 'MISSING' | 'REVISION' | 'EXTRA';
}
export interface EolCompare {
  verdict: EolVerdict;
  parts: EolPartDiff[];
  reason: string;
}

/** 주문 사양 ↔ 실물 구성 — 스캔이 없거나 개정을 못 읽은 부품이 있으면 실물 미확인(일치로 세지 않는다), 누락·다른 개정·추가 부품은 불일치 */
export function compareAsBuilt(order: { ecuPno: string; hwRevision: string }[], built: EolPart[] | null): EolCompare {
  if (!built || !built.length) return { verdict: 'UNCONFIRMED', parts: [], reason: '실물 미확인 — VIN 스캔 기록 없음' };
  const parts: EolPartDiff[] = [];
  for (const o of order) {
    const b = built.find((x) => x.ecuPno === o.ecuPno);
    if (b && b.hwRevision !== null && b.hwRevision !== o.hwRevision) parts.push({ ecuPno: o.ecuPno, ordered: o.hwRevision, built: b.hwRevision, kind: 'REVISION' });
  }
  const unread = built.filter((b) => b.hwRevision === null).map((b) => b.ecuPno);
  // 일부 부품만 읽힌 스캔(개정 미판독)은 확정된 다른 개정이 없으면 실물 미확인 — 누락으로 단정하지 않는다
  if (!parts.length && unread.length) return { verdict: 'UNCONFIRMED', parts: [], reason: `실물 미확인 — ${unread.join('·')} 개정 스캔 안 됨` };
  for (const o of order) if (!built.some((x) => x.ecuPno === o.ecuPno)) parts.push({ ecuPno: o.ecuPno, ordered: o.hwRevision, built: null, kind: 'MISSING' });
  for (const b of built) if (!order.some((o) => o.ecuPno === b.ecuPno)) parts.push({ ecuPno: b.ecuPno, ordered: null, built: b.hwRevision, kind: 'EXTRA' });
  if (parts.length) return { verdict: 'MISMATCH', parts, reason: `불일치 부품 ${parts.length}개 — ${parts.map((p) => `${p.ecuPno} 주문 ${p.ordered ?? '없음'} · 실물 ${p.built ?? '없음'}`).join(', ')}` };
  return { verdict: 'MATCH', parts: [], reason: `일치 — 주문 사양 부품 ${order.length}개` };
}

export const EOL_DECISIONS = ['HOLD', 'REWORK', 'RELEASE'] as const;
export type EolDecision = (typeof EOL_DECISIONS)[number];
export const EOL_DECISION_LABEL: Record<EolDecision, string> = { HOLD: '품질 보류', REWORK: '재작업', RELEASE: '품질 보류 해제' };
/** 생산 품질 결정 역할 — D-ADS-7 기본안: 기존 BOM 승인자에 위임(신설 시 이 표만 바꾼다) */
export const EOL_DECIDER_ROLES = ['BOM_APPROVER'] as const;

export interface EolCheckRecord {
  decision: EolDecision;
  recheckResult: 'PASS' | 'FAIL' | null;
  shippedEvidence: string | null;
}

/** 결정 저장 검사 — 역할·재대조 없는 출고 근거·불일치가 남은 해제를 거부한다(B06 불일치 유출 0) */
export function eolCheckBlockers(i: { role: string; decision: EolDecision; recheckResult: 'PASS' | 'FAIL' | null; shippedEvidence: string | null; compare: EolCompare }): { code: string; message: string }[] {
  if (!(EOL_DECIDER_ROLES as readonly string[]).includes(i.role)) return [{ code: 'DECIDER_ROLE', message: '품질 보류 결정은 생산 품질(BOM 승인자 위임) 역할만 저장할 수 있습니다.' }];
  const out: { code: string; message: string }[] = [];
  if (i.shippedEvidence && !i.recheckResult) out.push({ code: 'RECHECK_MISSING', message: '재대조 결과 없이 출고 근거를 저장할 수 없습니다 — 공장 품질 시스템에서 다시 대조하세요.' });
  if (i.decision === 'RELEASE') {
    if (i.recheckResult === 'FAIL') out.push({ code: 'RECHECK_FAILED', message: `재대조 불일치 — ${i.compare.parts.length}개 부품이 남아 보류를 해제할 수 없습니다.` });
    else if (!i.recheckResult && i.compare.verdict !== 'MATCH' && !out.length) out.push({ code: 'MISMATCH_OPEN', message: `불일치 부품 ${i.compare.parts.length}개가 남아 있습니다 — 공장 품질 시스템에서 해소한 뒤 다시 대조하세요.` });
  }
  return out;
}

export type EolStatus = 'READY' | 'QUALITY_HOLD' | 'REWORK' | 'RECHECK_PASSED' | 'SHIPPED' | 'UNCONFIRMED';
export const EOL_STATUS_LABEL: Record<EolStatus, string> = { READY: '출고 가능', QUALITY_HOLD: '품질 보류', REWORK: '재작업 중', RECHECK_PASSED: '재대조 일치', SHIPPED: '출고', UNCONFIRMED: '실물 미확인' };

/** VIN 상태 — 결정 기록(시간순)의 마지막과 대조 결과 */
export function eolStatus(c: EolCompare, checks: EolCheckRecord[]): EolStatus {
  const last = checks.at(-1);
  if (last?.decision === 'RELEASE' && last.recheckResult === 'PASS') return last.shippedEvidence ? 'SHIPPED' : 'RECHECK_PASSED';
  if (c.verdict === 'MATCH') return last?.shippedEvidence ? 'SHIPPED' : 'READY';
  if (last?.decision === 'REWORK') return 'REWORK';
  return c.verdict === 'UNCONFIRMED' ? 'UNCONFIRMED' : 'QUALITY_HOLD';
}

/** 인도 인수 — 계약 기능 × 최신 차량 보고. 주행 조건에서 확인할 항목은 '인도 후 확인 대기'로 남고 인수 완료 수에 넣지 않는다 */
export type AcceptanceGroup = 'STATIONARY' | 'DRIVING';
export type AcceptanceState = 'CONFIRMED' | 'UNCONFIRMED' | 'POST_DELIVERY';
export const ACCEPTANCE_GROUP_LABEL: Record<AcceptanceGroup, string> = { STATIONARY: '정차 중 확인 가능', DRIVING: '주행 조건에서 확인할 항목' };
export const ACCEPTANCE_STATE_LABEL: Record<AcceptanceState, string> = { CONFIRMED: '확인됨', UNCONFIRMED: '미확인', POST_DELIVERY: '인도 후 확인 대기' };
export function acceptanceItems(features: { featureId: string; name: string; drivingCondition: boolean; reported: boolean }[]) {
  const items = features.map((f) => {
    const group: AcceptanceGroup = f.drivingCondition ? 'DRIVING' : 'STATIONARY';
    const state: AcceptanceState = f.drivingCondition ? 'POST_DELIVERY' : f.reported ? 'CONFIRMED' : 'UNCONFIRMED';
    return { featureId: f.featureId, name: f.name, group, state };
  });
  return {
    items,
    summary: { accepted: items.filter((i) => i.state === 'CONFIRMED').length, total: items.length, postDelivery: items.filter((i) => i.state === 'POST_DELIVERY').length, unconfirmed: items.filter((i) => i.state === 'UNCONFIRMED').length },
  };
}

// UI28 변경요청과 Revision 비교 — 정본 단계·전이 조건.
//
// 변경요청은 **변경 사유와 영향·검증·승인 대상을 하나의 요청으로 추적**한다.
// 상태는 정본 6단계이며, 요청을 닫으려면 원천 반영(BOM·정책) 대사와 검증 증적이 있어야 한다.
export const CR_STAGES = ['DRAFT', 'ASSESSED', 'IN_REVIEW', 'APPROVED', 'IMPLEMENTED', 'CLOSED'] as const;
export type CrStage = (typeof CR_STAGES)[number];

export const CR_STAGE_KO: Record<CrStage, string> = {
  DRAFT: '초안',
  ASSESSED: '영향 평가',
  IN_REVIEW: '검토',
  APPROVED: '승인',
  IMPLEMENTED: '반영',
  CLOSED: '종료',
};

/** 옛 표기(Draft/Analyzed/Reviewed/…)를 정본 6단계로 정규화한다. 저장된 초안·시드가 섞여 있어도 화면은 한 축을 쓴다. */
export function crStageOf(status: string): CrStage {
  const s = String(status || '').toUpperCase().replace(/[\s_-]/g, '');
  if (s === 'DRAFT') return 'DRAFT';
  if (s === 'ASSESSED' || s === 'ANALYZED') return 'ASSESSED';
  if (s === 'INREVIEW' || s === 'REVIEWED' || s === 'REVIEW') return 'IN_REVIEW';
  if (s === 'APPROVED' || s === 'APPROVE') return 'APPROVED';
  if (s === 'IMPLEMENTED' || s === 'IMPLEMENT') return 'IMPLEMENTED';
  if (s === 'CLOSED' || s === 'CLOSE') return 'CLOSED';
  if (s === 'REJECTED' || s === 'REJECT') return 'DRAFT';
  return 'DRAFT';
}

export const CR_TRANSITIONS: Record<CrStage, CrStage[]> = {
  DRAFT: ['ASSESSED'],
  ASSESSED: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'ASSESSED'],
  APPROVED: ['IMPLEMENTED'],
  IMPLEMENTED: ['CLOSED'],
  CLOSED: [],
};

export interface CrFacts {
  id: string;
  /** 변경 대상 (Feature 또는 SW Structure) */
  feature: string;
  type: string;
  status: string;
  owner: string;
  risk: string;
  /** 변경 사유와 영향 */
  reason?: string;
  /** 기준 Revision */
  baselineRev?: string;
  /** 새 Revision */
  newRev?: string;
  /** 영향 대상 요약 */
  impact?: string;
  /** 검증 증적 참조 */
  evidence?: string[];
  /** 반영된 BOM 기준선 */
  appliedBaseline?: string;
  due?: string;
}

/** 변경요청이 다음 단계로 갈 수 있는가 — 미충족 조건을 사유로 돌려준다. */
export function crGate(cr: CrFacts, to: CrStage): { ok: boolean; reasons: string[] } {
  const from = crStageOf(cr.status);
  const reasons: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) reasons.push(msg); };

  if (!CR_TRANSITIONS[from].includes(to)) {
    return { ok: false, reasons: [`${CR_STAGE_KO[from]} → ${CR_STAGE_KO[to]} 전이는 허용되지 않는다`] };
  }
  if (to === 'ASSESSED') need(!!cr.reason?.trim(), '변경 사유와 영향이 없다');
  if (to === 'IN_REVIEW') {
    need(!!cr.baselineRev?.trim(), '기준 Revision 없음');
    need(!!cr.newRev?.trim(), '새 Revision 없음');
    need(!!cr.impact?.trim(), '영향 대상 미기재');
  }
  if (to === 'APPROVED') {
    need((cr.evidence || []).length > 0, '검증 증적 없음 — 재승인은 영향 검증 결과가 있어야 한다');
    need(cr.risk !== 'High' || (cr.evidence || []).length > 1, 'High Risk 는 단일 증적으로 승인하지 않는다');
  }
  if (to === 'IMPLEMENTED') need(!!cr.appliedBaseline?.trim(), '반영한 BOM 기준선 미지정');
  if (to === 'CLOSED') need(from === 'IMPLEMENTED', '반영 단계를 거치지 않고 종료할 수 없다');
  return { ok: reasons.length === 0, reasons };
}

export const crStats = (rows: CrFacts[]) => ({
  total: rows.length,
  open: rows.filter(r => !['CLOSED'].includes(crStageOf(r.status))).length,
  high: rows.filter(r => r.risk === 'High').length,
  awaitingEvidence: rows.filter(r => crStageOf(r.status) === 'IN_REVIEW').length,
  implemented: rows.filter(r => crStageOf(r.status) === 'IMPLEMENTED').length,
  closed: rows.filter(r => crStageOf(r.status) === 'CLOSED').length,
});

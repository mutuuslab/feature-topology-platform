// Feature 등록 심사·업무 Lifecycle — 기준 FP-UI-UX-DD v4.6 UI02-R1 (2026-09-13) 의
// "등록 7기준 / 업무 Lifecycle 9전이 / 안전 등급 4단계 / Taxonomy 최소 관리단위" 를
// 실행 가능한 결정적 로직으로 옮긴 것. 값과 문구는 specRegistrationR1.ts(정본 DOCX 생성물)에서 온다.
//
// 중요한 구분(UI02-R1): 업무 Lifecycle 은 Revision 상태(DRAFT·IN_REVIEW·CHANGES_REQUESTED·APPROVED·RETIRED,
// FRI-162) 및 구현·시험·상품·차량 적용 상태와 **별도 축**이다. 두 축을 한 필드로 합치지 않는다.
import { SPEC_REG_CRITERIA, SPEC_REG_CRITERIA_MIN, SPEC_REG_R1, SPEC_REG_TAXONOMY, SPEC_REG_TRANSITIONS } from './specRegistrationR1';
import type { RegTransition } from './specRegistrationR1';
import type { ControlPointRecord } from './implementation';

/** 업무 Lifecycle 단계 (UI02-R1) — Revision 상태와 별개 */
export type BusinessState = 'Proposed' | 'Approved' | 'Developing' | 'Verified' | 'Released' | 'Deprecated' | 'Retired';

/** 안전 등급 4단계 — 미검토(UNASSESSED)는 등급이 아니며 QM 으로 기본 확정하지 않는다. */
export type SafetyGrade = 'QM' | 'ASIL_IMPACT_NONE' | 'ASIL_IMPACT_POSSIBLE' | 'ASIL_IMPACT';
export type SafetyAssessment = SafetyGrade | 'UNASSESSED';

/** 등록 심사 결과 — 점수·우선순위를 만들지 않고 후보 여부만 결정한다. */
export type RegistrationOutcome = 'FEATURE_CANDIDATE' | 'ARTIFACT_OR_HOLD';

export const BUSINESS_STATES: BusinessState[] =
  ['Proposed', 'Approved', 'Developing', 'Verified', 'Released', 'Deprecated', 'Retired'];

export const BUSINESS_STATE_KO: Record<BusinessState, string> = {
  Proposed: '제안', Approved: '승인', Developing: '개발', Verified: '검증',
  Released: '출시', Deprecated: '사용 중단 예정', Retired: '종료',
};

export const BUSINESS_STATE_COLOR: Record<BusinessState, string> = {
  Proposed: '#8895A7', Approved: '#0B5FFF', Developing: '#D9822B', Verified: '#1F9D55',
  Released: '#0F766E', Deprecated: '#B45309', Retired: '#6B7280',
};

/** 데모 기준일 — 수명·노후 판정의 기준 시각(정본 release 20260913-v1.3) */
export const REVIEW_AT = '2026-09-13';

export interface ReviewEvidence {
  /** 값이 채워진 속성 ID (직접 입력·정확 참조). 자동·파생은 서버 계산이므로 여기 들어오지 않는다. */
  filledAttrs: string[];
  /** 연결된 요구사항 정확 참조 수 (RC-02 / LC-T01) */
  requirementRefs: number;
  /** 독립 검증 증적·판정 근거 수 (RC-03) */
  evidenceRefs: number;
  /** 적용 조건 행 수 (RC-04) */
  applicabilityConditions: number;
  /** 연결된 Control Point(Flag) 수 (RC-05 / LC-T03) */
  controlPoints: number;
  /** 운영 모니터링 참조 수 (RC-07) */
  monitorRefs: number;
  /** 안전·보안 영향 Feature 여부 (LC-T03 등급 분류 요구 대상) */
  safetyRelevant: boolean;
  /** 안전 등급 — 시작값은 UNASSESSED 이며 QM 으로 기본 확정하지 않는다 */
  safetyGrade: SafetyAssessment;
  /** 검증 증적·판정 근거가 정확 버전에 결속되어 유효 (LC-T04) */
  evidenceValid: boolean;
  /** Release Readiness 9 Gate 통과 — UI10·UI06 소관이며 이 화면은 결과만 받는다 (LC-T06) */
  releaseGatesPassed: boolean;
  /** 폐기 사유·요청자·승인자 확인 (LC-T07) */
  retireRequest: boolean;
  /** 대체 Feature 지정 또는 사용 종료 확인 (LC-T09) */
  successorOrSunset: boolean;
  /** 정책·패키지가 이 정의를 참조 (삭제 차단) */
  referencedByPolicy: boolean;
  /** Control Point 가 이 정의를 참조 (삭제 차단) */
  referencedByControlPoint: boolean;
}

export const EMPTY_EVIDENCE: ReviewEvidence = {
  filledAttrs: [], requirementRefs: 0, evidenceRefs: 0, applicabilityConditions: 0, controlPoints: 0,
  monitorRefs: 0, safetyRelevant: false, safetyGrade: 'UNASSESSED', evidenceValid: false,
  releaseGatesPassed: false, retireRequest: false, successorOrSunset: false,
  referencedByPolicy: false, referencedByControlPoint: false,
};

export interface CriterionEvaluation {
  id: string; name: string; question: string; verdict: string;
  areas: string[]; attrs: string[];
  met: boolean;
  /** 충족·미충족 판정 근거 (실제 값의 출처) */
  why: string;
  /** 미충족 시 해소해야 할 항목 */
  missing: string;
}

/** 기준별 심사 근거 — 어떤 실제 값이 판정에 쓰이는지 명시한다(감사 이벤트의 판정 근거). */
const CRITERION_CHECK: Record<string, (ev: ReviewEvidence) => { met: boolean; why: string; missing: string }> = {
  'RC-01': ev => {
    const v = ev.filledAttrs.includes('FRI-012');
    return {
      met: v, why: v ? 'FRI-012 기대 가치·소비 주체 입력됨' : 'FRI-012 미입력',
      missing: '목적·기대 가치와 사용자·소비 주체를 입력하세요.',
    };
  },
  'RC-02': ev => {
    const refs = ['FRI-015', 'FRI-016'].filter(a => ev.filledAttrs.includes(a));
    const met = ev.requirementRefs > 0 && refs.length === 2;
    return {
      met,
      why: `정확 참조 ${refs.join('·') || '없음'} · 연결 요구사항 ${ev.requirementRefs}건`,
      missing: met ? '' : '포함·제외 범위(FRI-015·FRI-016)를 정확 참조로 연결하고 상위 요구 1건 이상을 연결하세요.',
    };
  },
  'RC-03': ev => {
    const met = ev.evidenceRefs > 0;
    return { met, why: `독립 검증 증적 ${ev.evidenceRefs}건`, missing: met ? '' : '판정 근거가 있는 시험·검증 증적을 연결하세요.' };
  },
  'RC-04': ev => {
    const met = ev.applicabilityConditions > 0;
    return { met, why: `적용 조건 행 ${ev.applicabilityConditions}건`, missing: met ? '' : '적용 조건(대상 차종·사양·지역·시점)을 1건 이상 정의하세요.' };
  },
  'RC-05': ev => {
    const met = ev.controlPoints > 0;
    return { met, why: `Control Point(Flag) ${ev.controlPoints}건`, missing: met ? '' : '배포·활성화를 제어할 Control Point(Flag)를 연결하세요.' };
  },
  'RC-06': ev => {
    const refs = ['FRI-024', 'FRI-025'].filter(a => ev.filledAttrs.includes(a));
    const met = refs.length === 2;
    return { met, why: `Owner 정확 참조 ${refs.join('·') || '없음'}`, missing: met ? '' : 'Owner 와 대리 Owner(FRI-024·FRI-025)를 지정하세요.' };
  },
  'RC-07': ev => {
    const met = ev.monitorRefs > 0;
    return { met, why: `운영 모니터링 참조 ${ev.monitorRefs}건`, missing: met ? '' : '운영 모니터링 지표·로그 참조를 연결하세요.' };
  },
};

/** 등록 7기준 심사 — 각 기준의 충족 여부와 근거를 계산한다. */
export function criteriaEvaluation(ev: ReviewEvidence): CriterionEvaluation[] {
  return SPEC_REG_CRITERIA.map(c => {
    const check = CRITERION_CHECK[c.id];
    const r = check ? check(ev) : { met: false, why: '판정 규칙 없음', missing: '기준 판정 규칙을 확인하세요.' };
    return { id: c.id, name: c.name, question: c.question, verdict: c.verdict, areas: c.areas, attrs: c.attrs, ...r };
  });
}

export interface RegistrationReview {
  count: number;
  total: number;
  min: number;
  outcome: RegistrationOutcome;
  /** 후보 여부에 따른 처리 문구 (정본 threshold.pass / fail) */
  verdict: string;
  /** 미충족 기준의 해소 항목 */
  missing: { id: string; text: string }[];
  /** 감사 이벤트 문구 — REGISTER {featureId} 7-criteria {n}/7 */
  audit: (featureId: string) => string;
  rows: CriterionEvaluation[];
}

export function evaluateRegistration(ev: ReviewEvidence): RegistrationReview {
  const rows = criteriaEvaluation(ev);
  const count = rows.filter(r => r.met).length;
  const total = rows.length;
  const outcome: RegistrationOutcome = count >= SPEC_REG_CRITERIA_MIN ? 'FEATURE_CANDIDATE' : 'ARTIFACT_OR_HOLD';
  return {
    count, total, min: SPEC_REG_CRITERIA_MIN, outcome,
    verdict: outcome === 'FEATURE_CANDIDATE' ? SPEC_REG_R1.threshold.pass : SPEC_REG_R1.threshold.fail,
    missing: rows.filter(r => !r.met).map(r => ({ id: r.id, text: r.missing })),
    audit: (id: string) => `REGISTER ${id} 7-criteria ${count}/7`,
    rows,
  };
}

// ── 업무 Lifecycle ────────────────────────────────────────────────────────────

export interface TransitionEvaluation {
  t: RegTransition;
  from: boolean;
  allowed: boolean;
  /** Guard 미충족 사유 — 전이 불가 메시지와 미충족 항목 (UI02-AC: 비활성 사유 표시) */
  reasons: string[];
  /** 이 화면 소관이 아닌 조건(Release Readiness 9 Gate 등)이 걸린 전이 */
  external: boolean;
}

/** Guard 판정 — 정본 UI02-R1 의 전이 Guard 9개를 실제 값으로 검사한다. */
const TRANSITION_GUARD: Record<string, (ev: ReviewEvidence, outcome: RegistrationOutcome) => string[]> = {
  'LC-T01': (ev, outcome) => [
    ...(outcome === 'FEATURE_CANDIDATE' ? [] : [`등록 심사 ${SPEC_REG_CRITERIA_MIN}/7 미달 — Feature 후보가 아니므로 업무 Lifecycle 을 시작할 수 없습니다.`]),
    ...(ev.requirementRefs > 0 ? [] : ['연결된 요구사항 정확 참조가 1건 이상 있어야 합니다.']),
  ],
  'LC-T03': ev => [
    ...(ev.controlPoints > 0 ? [] : ['연결된 Control Point(Flag)가 1건 이상 있어야 합니다.']),
    ...(ev.safetyRelevant && ev.safetyGrade === 'UNASSESSED'
      ? ['안전·보안 영향 Feature 는 안전 등급 분류를 완료해야 합니다(미검토를 QM 으로 기본 확정하지 않습니다).'] : []),
  ],
  'LC-T04': ev => (ev.evidenceValid ? [] : ['검증 증적과 판정 근거가 정확 버전에 결속되어 유효해야 합니다.']),
  'LC-T06': ev => (ev.releaseGatesPassed ? [] : ['Release Readiness 9 Gate 미충족 — 차단 사유를 표시하고 상태를 바꾸지 않습니다.']),
  'LC-T07': ev => (ev.retireRequest ? [] : ['폐기 사유·요청자·승인자를 기록해야 합니다.']),
  'LC-T09': ev => (ev.successorOrSunset ? [] : ['대체 Feature 를 지정하거나 사용 종료를 확인해야 합니다.']),
};

/** 이 화면 소관이 아닌 Guard — 상태를 바꾸지 않고 차단 사유만 표시한다. */
export const EXTERNAL_GUARDS: Record<string, string> = {
  'LC-T06': 'Release Readiness 9 Gate 는 UI10·UI06 소관이며 이 화면은 상태·차단 사유만 표시한다.',
};

/** 현재 업무 Lifecycle 상태에서 가능한 전이 9개와 Guard 판정. */
export function evaluateTransitions(state: BusinessState, ev: ReviewEvidence): TransitionEvaluation[] {
  const outcome = evaluateRegistration(ev).outcome;
  return SPEC_REG_TRANSITIONS.map(t => {
    const from = t.from.includes(state);
    const reasons = from
      ? (TRANSITION_GUARD[t.id]?.(ev, outcome) ?? [])
      : [`현재 상태 ${state} 에서 허용된 전이가 아닙니다(${t.from.join(' | ')} 에서만 가능).`];
    return { t, from, allowed: from && reasons.length === 0, reasons, external: !!EXTERNAL_GUARDS[t.id] };
  });
}

/** 다음 단계로 갈 수 있는 전이만 — 화면의 전이 버튼 목록. */
export const actionableTransitions = (state: BusinessState, ev: ReviewEvidence) =>
  evaluateTransitions(state, ev).filter(x => x.from);

/** 등록 심사 결과에 따라 업무 Lifecycle 을 시작할 수 있는지 — 정본: 후보 등록 시 Proposed 로 시작한다. */
export function canStartLifecycle(ev: ReviewEvidence): { ok: boolean; reason: string } {
  const r = evaluateRegistration(ev);
  return r.outcome === 'FEATURE_CANDIDATE'
    ? { ok: true, reason: `${r.count}/${r.total} 충족 — Lifecycle 을 Proposed 로 시작합니다.` }
    : { ok: false, reason: `${r.count}/${r.total} — ${SPEC_REG_R1.threshold.fail}` };
}

// ── 안전 등급 ────────────────────────────────────────────────────────────────

const GRADE_KO: Record<SafetyGrade, { label: string; meaning: string }> = {
  QM: { label: 'QM', meaning: '안전 목표에 영향 없음' },
  ASIL_IMPACT_NONE: { label: 'ASIL 영향없음', meaning: '기존 안전 요구에 영향 없음' },
  ASIL_IMPACT_POSSIBLE: { label: 'ASIL 영향가능', meaning: '영향 가능성 검토 필요' },
  ASIL_IMPACT: { label: 'ASIL 영향', meaning: '안전 요구에 영향 — 할당·근거 필수' },
};

export const SAFETY_RELEVANCE_NOTE =
  '등록 시점 안전 관련성은 NON_SAFETY·RELATED·UNASSESSED 3값이고 안전 등급은 4단계다. 두 값은 별개 축이며 서로 대체하지 않는다.';

export interface SafetyAssessmentResult {
  code: SafetyAssessment;
  label: string;
  meaning: string;
  /** 등급이 확정되었는지 — UNASSESSED 는 등급이 아니다 */
  classified: boolean;
  note: string;
}

export function safetyAssessment(code: SafetyAssessment): SafetyAssessmentResult {
  if (code === 'UNASSESSED') {
    return {
      code, label: '미검토', meaning: '안전·보안 영향 검토가 끝나지 않았다. QM 으로 기본 확정하지 않는다.',
      classified: false, note: SAFETY_RELEVANCE_NOTE,
    };
  }
  const ko = GRADE_KO[code];
  return { code, label: ko.label, meaning: ko.meaning, classified: true, note: SAFETY_RELEVANCE_NOTE };
}

/** Developing 전이 전에 등급 분류가 필요한지 (안전·보안 영향 Feature 한정). */
export function needsGradeBeforeDeveloping(ev: ReviewEvidence) {
  return ev.safetyRelevant && ev.safetyGrade === 'UNASSESSED';
}

// ── Taxonomy 최소 관리단위 ───────────────────────────────────────────────────

export interface TaxonomyCheck {
  level: string;
  name: string;
  minUnit: boolean;
  ok: boolean;
  verdict: string;
}

/** 등록 대상이 L2 원자 Feature(최소 관리단위)인지 판정한다. */
export function taxonomyCheck(level: string): TaxonomyCheck {
  const l = SPEC_REG_TAXONOMY.find(x => x.level === level);
  const l2 = SPEC_REG_TAXONOMY.find(x => x.minUnit);
  if (!l) {
    return { level, name: '미정의 단계', minUnit: false, ok: false, verdict: 'Taxonomy 에 없는 단계입니다(L0~L5 만 허용).' };
  }
  const ok = l.level === (l2?.level ?? 'L2');
  return {
    level: l.level, name: l.name, minUnit: l.minUnit, ok,
    verdict: ok
      ? `${l.level} ${l.name} — 등록·Lifecycle 의 최소 관리단위입니다.`
      : `${l.level} 은 Feature 등록 단위가 아닙니다. L3 이하는 Feature 하위 Artifact 로 관리합니다.`,
  };
}

export const TAXONOMY_MIN_LEVEL = SPEC_REG_TAXONOMY.find(x => x.minUnit)?.level ?? 'L2';

// ── 삭제 정책 ────────────────────────────────────────────────────────────────

export interface DeleteDecision {
  allowed: boolean;
  blockers: string[];
  tombstone: string;
  note: string;
}

/** 차단 조건 문구는 정본(deletePolicy.blocks)에서만 온다 — 화면·엔진·문서가 같은 문자열을 쓴다. */
const blockOf = (needle: string) =>
  SPEC_REG_R1.deletePolicy.blocks.find(b => b.includes(needle)) ?? needle;

export const DELETE_BLOCK_RELEASED = blockOf('Released');
export const DELETE_BLOCK_POLICY = blockOf('정책');
export const DELETE_BLOCK_CONTROL_POINT = blockOf('Control Point');

/** 삭제 가능 여부 — 차단 조건과 tombstone 보존 규칙(UI02-R1). */
export function deleteDecision(businessState: BusinessState, ev: ReviewEvidence): DeleteDecision {
  const blockers: string[] = [];
  if (businessState === 'Released') blockers.push(DELETE_BLOCK_RELEASED);
  if (ev.referencedByPolicy) blockers.push(DELETE_BLOCK_POLICY);
  if (ev.referencedByControlPoint) blockers.push(DELETE_BLOCK_CONTROL_POINT);
  const allowed = blockers.length === 0;
  return {
    allowed, blockers, tombstone: SPEC_REG_R1.deletePolicy.tombstone,
    note: allowed
      ? `초안·미사용 정의만 삭제할 수 있습니다. 삭제해도 감사 이력·정확 참조·tombstone(${SPEC_REG_R1.deletePolicy.tombstone})은 보존됩니다.`
      : '삭제 대신 Deprecated 전이와 사용 종료 기록으로 처리합니다.',
  };
}

/** 사용 중 정의는 삭제 대신 Deprecated 로 보낸다. */
export const deleteAlternative = (state: BusinessState) =>
  state === 'Released'
    ? 'Released → Deprecated(LC-T08) 로 사용 중단하고 사용 종료 확인 후 Retired(LC-T09) 로 종료한다.'
    : '미사용 초안이면 삭제 가능하고, 사용 중이면 Deprecated 경로를 사용한다.';

// ── 노후(기대 수명) 정책 ──────────────────────────────────────────────────────

export interface AgingRow {
  id: string;
  purpose: string;
  lifetimeDays: number;
  reviewDueAt: string;
  /** 수명 경과 시점 도달 여부 — 도달 시 노후 후보로 표시하고 담당자에게 통보한다 */
  due: boolean;
  daysLeft: number;
  state: 'AGING' | 'CURRENT' | 'PERMANENT';
  ownerRef: string;
}

const DAY = 86400000;

/** Control Point 의 기대 수명 정책으로 노후 후보를 계산한다(기대 수명 0 = 상시 유지). */
export function agingCandidates(points: ControlPointRecord[], at: string = REVIEW_AT): AgingRow[] {
  const t0 = Date.parse(at);
  return points
    .filter(p => !!p.flagClass)
    .map(p => {
      const f = p.flagClass!;
      const daysLeft = Math.round((Date.parse(f.reviewDueAt) - t0) / DAY);
      const permanent = f.lifetimeDays === 0;
      const state: AgingRow['state'] = permanent ? 'PERMANENT' : daysLeft <= 0 ? 'AGING' : 'CURRENT';
      return {
        id: p.id, purpose: f.purpose, lifetimeDays: f.lifetimeDays, reviewDueAt: f.reviewDueAt,
        due: state === 'AGING', daysLeft, state, ownerRef: f.ownerRef,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export const agingSummary = (rows: AgingRow[]) => ({
  total: rows.length,
  aging: rows.filter(r => r.due).length,
  permanent: rows.filter(r => r.state === 'PERMANENT').length,
  next: rows.find(r => r.state === 'CURRENT')?.reviewDueAt ?? rows[0]?.reviewDueAt ?? '',
});

// ── 화면 계약 ────────────────────────────────────────────────────────────────

/** UI02-R1 이 UI02 화면에 요구하는 항목 — 화면이 모두 노출하는지 테스트가 확인한다. */
export const R1_SCREEN_CONTRACT = {
  criteria: '등록 7기준',
  threshold: '4/7 임계값',
  lifecycle: '업무 Lifecycle 7단계',
  transitions: '전이 9개 Guard',
  safety: '안전 등급 4단계(미검토 비확정)',
  taxonomy: 'Taxonomy L2 최소 관리단위',
  delete: '삭제 차단·tombstone',
  aging: '기대 수명·노후 후보',
  plane: 'Plane = Control / C01',
  revisionAxis: 'Revision 상태와 별도 축',
} as const;

export const r1PlaneLabel = `Plane ${SPEC_REG_R1.plane.plane} · 소유 Core ${SPEC_REG_R1.plane.ownerCore}`;
export const r1CollabLabel = SPEC_REG_R1.plane.collab.join(' · ');

/** 두 축의 관계 문구 — 화면에 그대로 쓴다. */
export const AXIS_NOTE = SPEC_REG_R1.lifecycleLabel;

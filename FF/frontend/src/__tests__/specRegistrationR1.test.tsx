/**
 * UI02-R1 등록 심사 · 업무 Lifecycle — 엔진 순수 함수 + 화면 계약.
 *
 * 이 화면의 계약은 "개정 문구가 문서에 있다"가 아니라 **7기준·9전이 Guard 가 실제 입력값과 실제
 * Control Point 데이터 위에서 계산된다**는 것이다. 그래서 순수 함수는 실제 evidence 로 검증하고,
 * 화면은 실제 Provider 스택(MemoryRouter + AppProvider)과 실제 props 로 검증한다.
 *
 * 별도 축 원칙도 여기서 고정한다 — 업무 Lifecycle 전이는 Revision 상태를 바꾸지 않고,
 * Release Readiness 9 Gate(LC-T06, UI10·UI06 소관)는 상태를 바꾸지 않고 차단 사유만 남긴다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../store';
import { DefineRevision } from '../pages/defineRevision';
import { RegistrationReviewPanel } from '../components/registrationReview';
import { ARTIFACT_RECORDS, CONTROL_POINTS, type ControlPointRecord } from '../data/implementation';
import { SPEC_REG_AREA_ATTRS, SPEC_REG_ATTRS } from '../data/specRegistration';
import {
  SPEC_REG_ACCEPTANCE, SPEC_REG_CRITERIA, SPEC_REG_CRITERIA_MIN, SPEC_REG_LIFECYCLE, SPEC_REG_R1,
  SPEC_REG_SAFETY_GRADES, SPEC_REG_TAXONOMY, SPEC_REG_TRANSITIONS, SPEC_REG_UL,
} from '../data/specRegistrationR1';
import {
  AXIS_NOTE, BUSINESS_STATES, DELETE_BLOCK_CONTROL_POINT, DELETE_BLOCK_RELEASED, EMPTY_EVIDENCE,
  EXTERNAL_GUARDS, R1_SCREEN_CONTRACT, REVIEW_AT, TAXONOMY_MIN_LEVEL, agingCandidates, agingSummary,
  canStartLifecycle, criteriaEvaluation, deleteDecision, evaluateRegistration, evaluateTransitions,
  needsGradeBeforeDeveloping, safetyAssessment, taxonomyCheck, type ReviewEvidence,
} from '../data/registrationReview';

afterEach(() => cleanup());

// ── 실측 입력 ───────────────────────────────────────────────────────────────

const ev = (over: Partial<ReviewEvidence> = {}): ReviewEvidence => ({ ...EMPTY_EVIDENCE, ...over });

/** RC-02 가 요구하는 정확 참조 두 개 + 관계와 원천(UI02-S03) 참조 한 건을 채운 상태 */
const S03_REFERENCE = (SPEC_REG_AREA_ATTRS['UI02-S03'] ?? []).filter(id => SPEC_REG_ATTRS[id]?.responsibility === 'REFERENCE');
const FILLED_MIN = ['FRI-012', 'FRI-015', 'FRI-016', 'FRI-024', 'FRI-025', S03_REFERENCE[0]];

const filledMin = { filledAttrs: FILLED_MIN, requirementRefs: 1 };

/** 후보(4/7) 임계를 넘는 최소 조합 — RC-01·02·06 + 연결 1건 */
const candidate = (over: Partial<ReviewEvidence> = {}) => ev({ ...filledMin, controlPoints: 1, ...over });

// ── 1. 정본 데이터 무결성 ───────────────────────────────────────────────────

describe('UI02-R1 정본 데이터', () => {
  it('등록 7기준 · Lifecycle 7단계 · 전이 9개 · 안전 등급 4단계 · Taxonomy L0~L5 를 정본에서 그대로 갖는다', () => {
    expect(SPEC_REG_CRITERIA.map(c => c.id)).toEqual(['RC-01', 'RC-02', 'RC-03', 'RC-04', 'RC-05', 'RC-06', 'RC-07']);
    expect(SPEC_REG_CRITERIA_MIN).toBe(4);
    expect(SPEC_REG_R1.threshold.total).toBe(7);
    expect(SPEC_REG_LIFECYCLE.map(s => s.id)).toEqual(BUSINESS_STATES);
    expect(SPEC_REG_TRANSITIONS.map(t => t.id))
      .toEqual(['LC-T01', 'LC-T02', 'LC-T03', 'LC-T04', 'LC-T05', 'LC-T06', 'LC-T07', 'LC-T08', 'LC-T09']);
    expect(SPEC_REG_SAFETY_GRADES.map(g => g.code))
      .toEqual(['QM', 'ASIL_IMPACT_NONE', 'ASIL_IMPACT_POSSIBLE', 'ASIL_IMPACT']);
    expect(SPEC_REG_TAXONOMY.map(l => l.level)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
    expect(SPEC_REG_TAXONOMY.filter(l => l.minUnit).map(l => l.level)).toEqual(['L2']);
    expect(SPEC_REG_ACCEPTANCE).toHaveLength(24);
    expect(SPEC_REG_UL).toHaveLength(5);
    expect(SPEC_REG_R1.revision).toBe('UI02-R1');
    expect(SPEC_REG_R1.plane).toMatchObject({ plane: 'Control', ownerCore: 'C01 Feature Registry' });
  });

  it('Release Readiness 9 Gate 는 이 화면 소관에서 제외된다', () => {
    expect(SPEC_REG_R1.fsRequirement.excluded.map(f => f.id).join(' ')).toContain('FR-REG-005');
    expect(SPEC_REG_R1.fsRequirement.included.map(f => f.id).join(' ')).toContain('FR-REG-001');
    expect(EXTERNAL_GUARDS['LC-T06']).toContain('UI10');
  });

  it('기준별 근거 영역·속성이 정본과 일치한다 (RC-05 → UI02-S04 배포·활성화 제어)', () => {
    const rc05 = SPEC_REG_CRITERIA.find(c => c.id === 'RC-05')!;
    expect(rc05.areas).toEqual(['UI02-S04']);
    expect(rc05.attrs).toEqual(['FRI-115']);
    expect(SPEC_REG_CRITERIA.find(c => c.id === 'RC-03')!.areas).toEqual(['UI02-S05']);
  });

  it('화면 계약 라벨이 개정 문구 그대로다', () => {
    expect(R1_SCREEN_CONTRACT.criteria).toBe('등록 7기준');
    expect(R1_SCREEN_CONTRACT.safety).toContain('미검토 비확정');
    expect(R1_SCREEN_CONTRACT.taxonomy).toContain('L2');
    expect(AXIS_NOTE).toContain('별도 축');
  });
});

// ── 2. 7기준 심사 ──────────────────────────────────────────────────────────

describe('등록 7기준 심사', () => {
  it('아무 입력도 없으면 0/7 이고 후보가 아니다', () => {
    const r = evaluateRegistration(ev());
    expect(r.count).toBe(0);
    expect(r.outcome).toBe('ARTIFACT_OR_HOLD');
    expect(r.missing).toHaveLength(7);
    expect(r.verdict).toBe(SPEC_REG_R1.threshold.fail);
  });

  it('임계 4개에서만 Feature 후보가 된다 (3/7 경계)', () => {
    const three = ev({ filledAttrs: ['FRI-012'], requirementRefs: 1, evidenceRefs: 1, applicabilityConditions: 1 });
    const r3 = evaluateRegistration(three);
    expect(r3.count).toBe(3);
    expect(r3.outcome).toBe('ARTIFACT_OR_HOLD');

    const r4 = evaluateRegistration({ ...three, controlPoints: 1 });
    expect(r4.count).toBe(4);
    expect(r4.outcome).toBe('FEATURE_CANDIDATE');
    expect(r4.verdict).toBe(SPEC_REG_R1.threshold.pass);
    expect(r4.missing).toHaveLength(3);
  });

  it('감사 이벤트 문구가 REGISTER {id} 7-criteria {n}/7 형식이다', () => {
    expect(evaluateRegistration(ev()).audit('FEAT-DEMO-001')).toBe('REGISTER FEAT-DEMO-001 7-criteria 0/7');
    expect(evaluateRegistration(candidate()).audit('FEAT-DEMO-001')).toBe('REGISTER FEAT-DEMO-001 7-criteria 4/7');
  });

  it('기준마다 실제 값의 출처를 판정 근거로 남긴다', () => {
    const rows = criteriaEvaluation(ev({ ...filledMin, controlPoints: 2, monitorRefs: 1 }));
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(by['RC-01'].met).toBe(true);
    expect(by['RC-01'].why).toContain('FRI-012');
    expect(by['RC-05'].met).toBe(true);
    expect(by['RC-05'].why).toContain('2건');
    expect(by['RC-07'].met).toBe(true);
    expect(by['RC-03'].met).toBe(false);
    expect(by['RC-03'].missing).toContain('증적');
    expect(by['RC-04'].met).toBe(false);
  });

  it('RC-02 는 정확 참조 두 개와 연결 요구사항이 모두 있어야 충족된다', () => {
    expect(criteriaEvaluation(ev({ filledAttrs: ['FRI-015'], requirementRefs: 3 }))[1].met).toBe(false);
    expect(criteriaEvaluation(ev({ filledAttrs: ['FRI-015', 'FRI-016'], requirementRefs: 0 }))[1].met).toBe(false);
    expect(criteriaEvaluation(ev({ filledAttrs: ['FRI-015', 'FRI-016'], requirementRefs: 1 }))[1].met).toBe(true);
  });

  it('심사 미달이면 Lifecycle 을 시작할 수 없다', () => {
    expect(canStartLifecycle(ev()).ok).toBe(false);
    expect(canStartLifecycle(ev()).reason).toContain('0/7');
    expect(canStartLifecycle(candidate()).ok).toBe(true);
    expect(canStartLifecycle(candidate()).reason).toContain('Proposed');
  });
});

// ── 3. 업무 Lifecycle 9전이 Guard ──────────────────────────────────────────

describe('업무 Lifecycle 전이 Guard', () => {
  const find = (over: ReviewEvidence, state = BUSINESS_STATES[0]) => {
    const list = evaluateTransitions(state, over);
    return Object.fromEntries(list.map(x => [x.t.id, x]));
  };

  it('현재 상태에서 출발하지 않는 전이는 사유와 함께 비활성이다', () => {
    const t = find(candidate());
    expect(t['LC-T01'].from).toBe(true);
    expect(t['LC-T03'].from).toBe(false);
    expect(t['LC-T03'].reasons[0]).toContain('현재 상태 Proposed');
    expect(t['LC-T03'].allowed).toBe(false);
  });

  it('LC-T01 은 후보이면서 연결 요구사항이 있을 때만 허용된다', () => {
    expect(find(candidate())['LC-T01'].allowed).toBe(true);
    const noRef = find(ev({ ...filledMin, requirementRefs: 0, controlPoints: 2 }));
    expect(noRef['LC-T01'].allowed).toBe(false);
    expect(noRef['LC-T01'].reasons.join(' ')).toContain('요구사항 정확 참조');
    const notCandidate = find(ev({ requirementRefs: 2 }));
    expect(notCandidate['LC-T01'].allowed).toBe(false);
    expect(notCandidate['LC-T01'].reasons.join(' ')).toContain('미달');
  });

  it('LC-T03 은 Control Point 와 (안전 Feature 라면) 등급 분류를 모두 요구한다', () => {
    const approved = 'Approved' as const;
    const noCp = find(candidate({ controlPoints: 0 }), approved);
    expect(noCp['LC-T03'].allowed).toBe(false);
    expect(noCp['LC-T03'].reasons.join(' ')).toContain('Control Point(Flag)');

    const safetyNoGrade = find(candidate({ controlPoints: 1, safetyRelevant: true }), approved);
    expect(safetyNoGrade['LC-T03'].allowed).toBe(false);
    expect(safetyNoGrade['LC-T03'].reasons.join(' ')).toContain('안전 등급 분류');

    const graded = find(candidate({ controlPoints: 1, safetyRelevant: true, safetyGrade: 'ASIL_IMPACT_POSSIBLE' }), approved);
    expect(graded['LC-T03'].allowed).toBe(true);

    const nonSafety = find(candidate({ controlPoints: 1, safetyRelevant: false }), approved);
    expect(nonSafety['LC-T03'].allowed).toBe(true);
  });

  it('LC-T04 는 증적 유효성, LC-T07 은 폐기 기록, LC-T09 는 대체·종료 확인을 요구한다', () => {
    const verified = 'Verified' as const;
    expect(find(candidate({ evidenceValid: false }), 'Developing')['LC-T04'].allowed).toBe(false);
    expect(find(candidate({ evidenceValid: true }), 'Developing')['LC-T04'].allowed).toBe(true);

    expect(find(ev(), 'Developing')['LC-T07'].allowed).toBe(false);
    expect(find(ev({ retireRequest: true }), 'Developing')['LC-T07'].allowed).toBe(true);

    expect(find(ev(), 'Deprecated')['LC-T09'].allowed).toBe(false);
    expect(find(ev({ successorOrSunset: true }), 'Deprecated')['LC-T09'].allowed).toBe(true);
    // LC-T09 는 Deprecated → Retired 전용이며 Verified 에서 출발하지 않는다
    expect(find(candidate(), 'Deprecated')['LC-T09'].from).toBe(true);
    expect(find(candidate(), 'Verified')['LC-T09'].from).toBe(false);
  });

  it('LC-T06 은 9 Gate 미충족 시 차단하고, 소관 밖임을 표시한다', () => {
    const blocked = find(candidate({ evidenceValid: true }), 'Verified')['LC-T06'];
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons.join(' ')).toContain('9 Gate');
    expect(blocked.external).toBe(true);
    const ok = find(candidate({ evidenceValid: true, releaseGatesPassed: true }), 'Verified')['LC-T06'];
    expect(ok.allowed).toBe(true);
    expect(ok.external).toBe(true);
  });

  it('가드 없는 전이(LC-T02·T05·T08)는 상태만 맞으면 허용된다', () => {
    expect(find(ev(), 'Approved')['LC-T02'].allowed).toBe(true);
    expect(find(ev(), 'Verified')['LC-T05'].allowed).toBe(true);
    expect(find(ev(), 'Released')['LC-T08'].allowed).toBe(true);
  });
});

// ── 4. 안전 등급 · Taxonomy · 삭제 · 노후 ──────────────────────────────────

describe('안전 등급', () => {
  it('미검토를 QM 으로 기본 확정하지 않는다', () => {
    const u = safetyAssessment('UNASSESSED');
    expect(u.classified).toBe(false);
    expect(u.code).toBe('UNASSESSED');
    expect(u.meaning).toContain('기본 확정하지 않는다');
    const qm = safetyAssessment('QM');
    expect(qm.classified).toBe(true);
    expect(qm.label).toBe('QM');
    expect(qm.label).not.toBe(u.label);
  });

  it('등급 4단계의 뜻이 정본에서 오고 미검토는 등급 목록에 없다', () => {
    for (const g of SPEC_REG_SAFETY_GRADES) {
      expect(safetyAssessment(g.code as 'QM').classified).toBe(true);
      expect(g.meaning.length).toBeGreaterThan(2);
    }
    expect(SPEC_REG_SAFETY_GRADES.map(g => g.code)).not.toContain('UNASSESSED');
  });

  it('Developing 전에는 안전·보안 영향 Feature 만 등급 분류를 요구한다', () => {
    expect(needsGradeBeforeDeveloping(ev({ safetyRelevant: true }))).toBe(true);
    expect(needsGradeBeforeDeveloping(ev({ safetyRelevant: true, safetyGrade: 'QM' }))).toBe(false);
    expect(needsGradeBeforeDeveloping(ev({ safetyRelevant: false }))).toBe(false);
  });
});

describe('Taxonomy 최소 관리단위', () => {
  it('L2 만 등록 단위이고 L3 이하는 하위 Artifact 다', () => {
    expect(TAXONOMY_MIN_LEVEL).toBe('L2');
    expect(taxonomyCheck('L2')).toMatchObject({ ok: true, minUnit: true });
    expect(taxonomyCheck('L3').ok).toBe(false);
    expect(taxonomyCheck('L5').ok).toBe(false);
    expect(taxonomyCheck('L3').verdict).toContain('하위 Artifact');
    expect(taxonomyCheck('L9').ok).toBe(false);
  });
});

describe('삭제 정책', () => {
  it('Released · 정책 참조 · Control Point 참조를 차단하고 tombstone 을 남긴다', () => {
    const free = deleteDecision('Proposed', ev());
    expect(free.allowed).toBe(true);
    expect(free.tombstone).toBe(SPEC_REG_R1.deletePolicy.tombstone);
    expect(free.note).toContain('보존');

    // 차단 사유는 정본 deletePolicy.blocks 문구를 그대로 쓴다
    expect(deleteDecision('Released', ev()).blockers).toContain(DELETE_BLOCK_RELEASED);
    expect(deleteDecision('Proposed', ev({ referencedByPolicy: true })).allowed).toBe(false);
    const cp = deleteDecision('Proposed', ev({ referencedByControlPoint: true }));
    expect(cp.allowed).toBe(false);
    expect(cp.blockers).toContain(DELETE_BLOCK_CONTROL_POINT);
    expect(SPEC_REG_R1.deletePolicy.blocks).toContain(DELETE_BLOCK_CONTROL_POINT);
    expect(cp.note).toContain('Deprecated');
  });
});

describe('기대 수명·노후 후보', () => {
  const mk = (id: string, days: number, due: string): ControlPointRecord => ({
    id, kind: 'FLAG', role: 'WRITE_REQUEST', valueType: 'Boolean', accessMode: 'WRITE_GATED',
    bindingRef: `BIND-${id}`, featureVersionRef: 'FEAT-X@1.0.0',
    flagClass: { purpose: 'release', lifetimeDays: days, reviewDueAt: due, ownerRef: 'ROLE:operator@body' },
    observedValue: false,
  });

  it('수명 경과 시점이 기준일 이전이면 노후 후보, 이후면 유지, 수명 0 은 상시 유지다', () => {
    const rows = agingCandidates([
      mk('CP-OLD', 90, '2026-08-01'),
      mk('CP-NEW', 180, '2027-01-01'),
      mk('CP-KILL', 0, '2026-10-13'),
    ], REVIEW_AT);
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    expect(by['CP-OLD'].state).toBe('AGING');
    expect(by['CP-OLD'].due).toBe(true);
    expect(by['CP-OLD'].daysLeft).toBeLessThan(0);
    expect(by['CP-NEW'].state).toBe('CURRENT');
    expect(by['CP-KILL'].state).toBe('PERMANENT');
    expect(rows[0].id).toBe('CP-OLD');
  });

  it('실제 Control Point 데이터에서 노후 후보와 다음 수명 경과를 계산한다', () => {
    const rows = agingCandidates(CONTROL_POINTS);
    const withPolicy = CONTROL_POINTS.filter(c => c.flagClass).length;
    expect(rows).toHaveLength(withPolicy);
    const s = agingSummary(rows);
    expect(s.total).toBe(withPolicy);
    expect(s.aging + s.permanent).toBeLessThanOrEqual(s.total);
    expect(s.next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(agingSummary([]).next).toBe('');
  });
});

// ── 5. UI02 화면 결속 ──────────────────────────────────────────────────────

const FLAG_IDS = CONTROL_POINTS.filter(c => c.kind === 'FLAG').map(c => c.id);
const MONITOR_IDS = CONTROL_POINTS.filter(c => c.role === 'OBSERVE').map(c => c.id);
const EVIDENCE_IDS = ARTIFACT_RECORDS
  .filter(a => a.artifactKind === 'TestCase')
  .map(a => `${a.id}@${a.version}`);

/** 실제 화면 조작으로 심사 근거를 연결한다 — 근거는 패널 상태이므로 props 로 넣을 수 없다. */
const link = (select: string, button: string, option: string) => {
  fireEvent.change(screen.getByLabelText(select), { target: { value: option } });
  fireEvent.click(screen.getByRole('button', { name: button }));
};

interface PanelInput extends Partial<ReviewEvidence> {
  /** 연결할 Control Point(Flag) 건수 */
  flags?: number;
  /** 연결할 운영 모니터링 건수 */
  monitors?: number;
  /** 연결할 검증 증적 건수 */
  evidences?: number;
}

const renderPanel = (over: PanelInput = {}) => {
  const { flags = 0, monitors = 0, evidences = 0, ...rest } = over;
  const view = render(
    <MemoryRouter>
      <RegistrationReviewPanel
        featureId="FEAT-DEMO-017"
        revisionState="DRAFT"
        filled={Object.fromEntries((rest.filledAttrs ?? FILLED_MIN).map(a => [a, 'v']))}
        conditions={rest.applicabilityConditions ?? 3}
      />
    </MemoryRouter>,
  );
  for (let i = 0; i < flags; i++) link('Flag 선택', 'Flag 연결', FLAG_IDS[i]);
  for (let i = 0; i < monitors; i++) link('모니터링 제어점 선택', '모니터링 연결', MONITOR_IDS[i]);
  for (let i = 0; i < evidences; i++) link('검증 증적 선택', '증적 연결', EVIDENCE_IDS[i]);
  if (rest.evidenceValid) fireEvent.click(screen.getByLabelText(/증적이 정확 버전에 결속되어 유효하다/));
  return view;
};

describe('UI02 화면 — 등록 심사 패널', () => {
  it('7기준 표와 임계 판정, 감사 문구를 실제 값으로 표시한다', () => {
    // 적용조건 0행 — RC-01·02·06 만 충족해 3/7 이고 후보가 아니다
    renderPanel({ applicabilityConditions: 0 });
    const panel = screen.getByTestId('ui02-r1');
    expect(within(panel).getByText('등록 7기준')).toBeTruthy();
    expect(within(panel).getByTestId('r1-criteria-count').textContent).toContain('3 / 7');
    expect(within(panel).getByText('BOM 하위 Artifact 후보 또는 보류')).toBeTruthy();
    expect(within(panel).getByText('REGISTER FEAT-DEMO-017 7-criteria 3/7')).toBeTruthy();
    for (const c of SPEC_REG_CRITERIA) expect(within(panel).getAllByText(c.id).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('미충족').length).toBe(4);
  });

  it('심사 근거를 연결하면 충족 수와 후보 판정이 즉시 바뀐다', () => {
    renderPanel({ applicabilityConditions: 0 });
    const panel = screen.getByTestId('ui02-r1');
    link('Flag 선택', 'Flag 연결', FLAG_IDS[0]);
    expect(within(panel).getByTestId('r1-criteria-count').textContent).toContain('4 / 7');
    expect(within(panel).getByText('Feature 후보')).toBeTruthy();
    expect(within(panel).getByText('REGISTER FEAT-DEMO-017 7-criteria 4/7')).toBeTruthy();
    // 후보가 되면 LC-T01 이 열린다
    expect((screen.getByRole('button', { name: 'Approved 로 전이' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('검증 증적 후보는 id@version 으로 구분한다 — 같은 시험의 v1.2·v1.3 이 함께 올라온다', () => {
    renderPanel();
    const select = screen.getByLabelText('검증 증적 선택') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value).filter(Boolean);
    expect(values).toEqual(EVIDENCE_IDS);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('ART-HIL-BDC-001@1.3');
    expect(values).toContain('ART-HIL-BDC-001@1.2');
    // 연결하면 그 버전을 특정해 표시한다
    link('검증 증적 선택', '증적 연결', 'ART-HIL-BDC-001@1.2');
    expect(screen.getByText('ART-HIL-BDC-001@1.2 ✕')).toBeTruthy();
  });

  it('업무 Lifecycle 은 Revision 축과 분리해 표시하고 전이 기록을 남긴다', () => {
    renderPanel({ flags: 1 });
    const panel = screen.getByTestId('ui02-r1');
    expect(within(panel).getByText('Revision 상태 DRAFT')).toBeTruthy();
    expect(within(panel).getByText(AXIS_NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approved 로 전이' }));
    expect(within(panel).getByText(/LC-T01 Proposed → Approved/)).toBeTruthy();
    // Approved 로 가면 LC-T03 이 열리고, Control Point 는 이미 1건 연결되어 있다
    expect((screen.getByRole('button', { name: 'Developing 로 전이' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('안전·보안 영향 Feature 는 등급 미검토 상태에서 Developing 이 막히고, 등급을 정하면 열린다', () => {
    renderPanel({ flags: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Approved 로 전이' }));
    fireEvent.change(screen.getByLabelText('안전 관련성'), { target: { value: 'RELATED' } });
    expect((screen.getByRole('button', { name: 'Developing 로 전이' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/안전 등급 분류를 완료해야 합니다/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('안전 등급'), { target: { value: 'ASIL_IMPACT_POSSIBLE' } });
    expect((screen.getByRole('button', { name: 'Developing 로 전이' }) as HTMLButtonElement).disabled).toBe(false);
    const panel = screen.getByTestId('ui02-r1');
    expect(within(panel).getByText('등급 확정 ASIL 영향가능')).toBeTruthy();
  });

  it('LC-T06 은 소관 밖 전이로 상태를 바꾸지 않고 차단 사유만 남긴다', () => {
    renderPanel({ flags: 1, monitors: 1, evidences: 1, evidenceValid: true, applicabilityConditions: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Approved 로 전이' }));
    fireEvent.click(screen.getByRole('button', { name: 'Developing 로 전이' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verified 로 전이' }));
    const panel = screen.getByTestId('ui02-r1');
    expect(within(panel).getByText(/LC-T04 Developing → Verified/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Released 로 전이' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(within(panel).getAllByText(/9 Gate/).length).toBeGreaterThan(1);
    expect(within(panel).getByText('이 화면 소관 아님')).toBeTruthy();
  });

  it('Taxonomy L2 최소 관리단위와 삭제·노후 정책을 실제 값으로 표시한다', () => {
    renderPanel({ flags: 1 });
    const panel = screen.getByTestId('ui02-r1');
    expect(within(panel).getByText(/L2 원자 Feature · 최소 관리단위/)).toBeTruthy();
    expect(within(panel).getAllByText(/OPA-077/).length).toBeGreaterThan(0);
    // Control Point 가 연결되면 삭제 차단
    expect(within(panel).getByText('삭제 요청 거부')).toBeTruthy();
    const cpBlocks = within(panel).getAllByText(new RegExp(DELETE_BLOCK_CONTROL_POINT));
    expect(cpBlocks.length).toBeGreaterThan(1);
    expect(cpBlocks.some(n => (n.textContent ?? '').includes('✕'))).toBe(true);
    // 기준일은 심사 기준일과 노후 계산 기준일 양쪽에 노출된다
    expect(within(panel).getByText(`심사 기준일 ${REVIEW_AT}`)).toBeTruthy();
    expect(within(panel).getByText(new RegExp(`노후 후보 — Control Point \\d+건 기준일 ${REVIEW_AT}`))).toBeTruthy();
  });

  it('UI02 화면이 R1 패널을 실제 초안 입력 위에서 렌더한다', () => {
    render(
      <MemoryRouter initialEntries={['/master/define']}>
        <AppProvider><DefineRevision /></AppProvider>
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('ui02-r1');
    // 아무 속성도 채우지 않은 초안 — 적용조건 시드 3행만 있어 RC-04 하나가 충족된다
    expect(within(panel).getByTestId('r1-criteria-count').textContent).toContain('1 / 7');
    expect(within(panel).getAllByText('등록 7기준').length).toBeGreaterThan(0);
    // 근거 영역 버튼이 실제 영역 이동을 수행한다 (오른쪽 영역 상세 카드가 바뀐다)
    const rc05 = SPEC_REG_CRITERIA.find(c => c.id === 'RC-05')!;
    fireEvent.click(within(panel).getAllByText(rc05.areas[0])[0]);
    expect(screen.getAllByText(/UI02-S04 구현과 제어/).length).toBeGreaterThan(0);
  });
});

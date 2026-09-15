// UI02-R1 (2026-09-13) 등록 심사·업무 Lifecycle 패널 — 정본 FP-UI-UX-DD v4.6 UI02-R1 절의
// 7기준 심사 / Lifecycle 9전이 Guard / 안전 등급 4단계 / Taxonomy 최소 관리단위 / 삭제·노후 정책을
// UI02 Feature 등록 화면 안에서 실제 동작하도록 구현한 패널이다. 값·문구는 specRegistrationR1.ts 에서만 온다.
//
// 경계: 이 패널은 Revision 상태(DRAFT·IN_REVIEW·…)를 바꾸지 않는다. 업무 Lifecycle 은 별도 축이며
// Release Readiness 9 Gate(UI10·UI06 소관)는 상태를 바꾸지 않고 차단 사유만 표시한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SPEC_REG_R1, SPEC_REG_SAFETY_GRADES, SPEC_REG_TAXONOMY, SPEC_REG_ACCEPTANCE, SPEC_REG_UL } from '../data/specRegistrationR1';
import {
  AXIS_NOTE, BUSINESS_STATE_COLOR, BUSINESS_STATE_KO, BUSINESS_STATES, EMPTY_EVIDENCE, EXTERNAL_GUARDS,
  R1_SCREEN_CONTRACT, REVIEW_AT, SAFETY_RELEVANCE_NOTE, TAXONOMY_MIN_LEVEL, agingCandidates, agingSummary,
  deleteAlternative, deleteDecision, evaluateRegistration, evaluateTransitions, needsGradeBeforeDeveloping,
  r1CollabLabel, r1PlaneLabel, safetyAssessment, taxonomyCheck,
  type BusinessState, type CriterionEvaluation, type RegistrationOutcome, type ReviewEvidence,
  type SafetyAssessment, type TransitionEvaluation,
} from '../data/registrationReview';
import { ARTIFACT_RECORDS, CONTROL_POINTS, kindLabel, roleLabel } from '../data/implementation';
import { SPEC_REG_AREA_ATTRS, SPEC_REG_ATTRS } from '../data/specRegistration';

const RELEVANCE: { code: 'NON_SAFETY' | 'RELATED' | 'UNASSESSED'; label: string }[] = [
  { code: 'NON_SAFETY', label: '비안전' },
  { code: 'RELATED', label: '안전 관련' },
  { code: 'UNASSESSED', label: '미검토' },
];

const FLAG_POINTS = CONTROL_POINTS.filter(c => c.kind === 'FLAG');
const MONITOR_POINTS = CONTROL_POINTS.filter(c => c.role === 'OBSERVE');
const TEST_EVIDENCE = ARTIFACT_RECORDS.filter(a => a.artifactKind === 'TestCase');

/**
 * Artifact 신원은 `id@version` 이다 — 같은 HIL 시험의 v1.2·v1.3 이 모두 후보로 올라오므로
 * 버전까지 포함해야 연결 대상을 하나로 특정할 수 있다(implementation.ts 의 ARTIFACT_INDEX 와 동일 규칙).
 */
const artifactIdentity = (a: { id: string; version: string }) => `${a.id}@${a.version}`;

/** UI02-S03 관계와 원천의 정확 참조 입력 — 연결된 요구사항 참조 수의 실제 출처(AUTO가 아니라 화면 입력값). */
const S03_REFERENCE_ATTRS = (SPEC_REG_AREA_ATTRS['UI02-S03'] ?? [])
  .filter(id => SPEC_REG_ATTRS[id]?.responsibility === 'REFERENCE');

export interface RegistrationReviewPanelProps {
  featureId: string;
  /** Revision 축 현재 상태 — 업무 Lifecycle 과 별개임을 화면에 표시한다(FRI-162) */
  revisionState: string;
  /** 초안 입력값 (직접 입력·정확 참조) — 심사 근거로 그대로 쓰인다 */
  filled: Record<string, string>;
  /** UI02-S02 적용조건 행 수 */
  conditions: number;
  /** 근거 영역·속성 버튼을 눌렀을 때 그 영역으로 이동 */
  onJumpArea?: (areaId: string) => void;
  /** 감사 이벤트·전이 기록을 화면 상단에 남긴다 */
  onEvent?: (text: string) => void;
  /**
   * 심사 결과를 상위 화면에 보고한다 — 등록 실행 버튼의 게이트가 이 값만 쓴다.
   * 7기준 x/7 을 화면마다 따로 계산하면 판정 근거가 갈라지므로 패널 계산을 그대로 넘긴다.
   */
  onReviewChange?: (snapshot: ReviewSnapshot) => void;
}

/** 등록 실행 게이트가 쓰는 심사 스냅샷 — 근거·판정·두 축(업무 Lifecycle·안전)을 함께 넘긴다. */
export interface ReviewSnapshot {
  evidence: ReviewEvidence;
  count: number;
  total: number;
  min: number;
  outcome: RegistrationOutcome;
  /** 정본 threshold.pass / fail 문구 — 등록 결과 카드가 그대로 인용한다. */
  verdict: string;
  /** 기준별 판정과 근거 — 등록 화면의 미충족 목록이 이 값을 그린다. */
  rows: CriterionEvaluation[];
  missing: { id: string; text: string }[];
  /** 감사 이벤트 문구 — REGISTER {featureId} 7-criteria {n}/7 (정본 형식) */
  audit: (featureId: string) => string;
  safetyRelevance: 'NON_SAFETY' | 'RELATED' | 'UNASSESSED';
  safetyGrade: SafetyAssessment;
  businessState: BusinessState;
}

export function RegistrationReviewPanel({
  featureId, revisionState, filled, conditions, onJumpArea, onEvent, onReviewChange,
}: RegistrationReviewPanelProps) {
  const [linkedFlags, setLinkedFlags] = useState<string[]>([]);
  const [linkedEvidence, setLinkedEvidence] = useState<string[]>([]);
  const [linkedMonitors, setLinkedMonitors] = useState<string[]>([]);
  const [business, setBusiness] = useState<BusinessState>('Proposed');
  const [safetyGrade, setSafetyGrade] = useState<SafetyAssessment>('UNASSESSED');
  const [relevance, setRelevance] = useState<'NON_SAFETY' | 'RELATED' | 'UNASSESSED'>('UNASSESSED');
  const [evidenceValid, setEvidenceValid] = useState(false);
  const [gatesPassed, setGatesPassed] = useState(false);
  const [retire, setRetire] = useState({ reason: '', requester: '', approver: '' });
  const [successor, setSuccessor] = useState('');
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [reopen, setReopen] = useState(REVIEW_AT);
  const [log, setLog] = useState<{ ts: string; text: string }[]>([]);

  const filledAttrs = useMemo(
    () => Object.entries(filled).filter(([, v]) => (v ?? '').trim() !== '').map(([k]) => k),
    [filled],
  );
  const requirementRefs = useMemo(
    () => S03_REFERENCE_ATTRS.filter(id => filledAttrs.includes(id)).length,
    [filledAttrs],
  );

  const evidence: ReviewEvidence = {
    ...EMPTY_EVIDENCE,
    filledAttrs,
    requirementRefs,
    evidenceRefs: linkedEvidence.length,
    applicabilityConditions: conditions,
    controlPoints: linkedFlags.length,
    monitorRefs: linkedMonitors.length,
    safetyRelevant: relevance === 'RELATED',
    safetyGrade,
    evidenceValid,
    releaseGatesPassed: gatesPassed,
    retireRequest: !!(retire.reason.trim() && retire.requester.trim() && retire.approver.trim()),
    successorOrSunset: successor.trim() !== '',
    referencedByControlPoint: linkedFlags.length > 0,
  };

  const review = evaluateRegistration(evidence);
  const transitions = evaluateTransitions(business, evidence);
  const upcoming = transitions.filter(t => t.from);
  const del = deleteDecision(business, evidence);
  const grade = safetyAssessment(safetyGrade);
  const taxonomy = taxonomyCheck(TAXONOMY_MIN_LEVEL);
  const gradeGate = needsGradeBeforeDeveloping(evidence);
  const aging = agingCandidates(CONTROL_POINTS);
  const agingSum = agingSummary(aging);
  const [openFlag, setOpenFlag] = useState('');
  const [openEvidence, setOpenEvidence] = useState<string>(() => (TEST_EVIDENCE[0] ? artifactIdentity(TEST_EVIDENCE[0]) : ''));
  const [openMonitor, setOpenMonitor] = useState(MONITOR_POINTS[0]?.id ?? '');

  const record = (text: string) => {
    setLog(l => [{ ts: REVIEW_AT, text }, ...l].slice(0, 8));
    onEvent?.(text);
  };

  const runTransition = (e: TransitionEvaluation) => {
    if (!e.allowed) return;
    const to = e.t.to as BusinessState;
    if (e.external) {
      record(`${e.t.id} ${business} → ${to} 은 이 화면 소관이 아니다 — ${EXTERNAL_GUARDS[e.t.id]} 상태는 바꾸지 않고 차단 사유만 남긴다.`);
      return;
    }
    setBusiness(to);
    record(`${e.t.id} ${business} → ${to} · 기록 ${e.t.record}`);
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    if (!id) return;
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const candidate = review.outcome === 'FEATURE_CANDIDATE';

  // 심사 결과를 상위 화면에 보고한다. 값이 실제로 바뀔 때만 알리고(매 렌더 새 객체를 만들지 않는다)
  // 콜백 identity 변화로는 다시 알리지 않는다.
  const reportRef = useRef(onReviewChange);
  useEffect(() => { reportRef.current = onReviewChange; });
  const snapshotKey = [
    review.count, review.total, review.outcome,
    evidence.filledAttrs.join(','), requirementRefs, evidence.evidenceRefs, evidence.monitorRefs,
    evidence.applicabilityConditions, safetyGrade, relevance, business,
  ].join('|');
  useEffect(() => {
    reportRef.current?.({
      evidence, count: review.count, total: review.total, min: review.min, outcome: review.outcome,
      verdict: review.verdict, rows: review.rows, missing: review.missing, audit: review.audit,
      safetyRelevance: relevance, safetyGrade, businessState: business,
    });
    // snapshotKey 가 보고 대상 값 전체를 문자열로 담고 있어 의존성은 이 키 하나로 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);

  return (
    <div className="card mt" data-testid="ui02-r1">
      <div className="row">
        <div className="col" style={{ flex: 1, minWidth: 280 }}>
          <b>UI02-R1 · Feature 등록 심사와 업무 Lifecycle</b>
          <div className="mt">
            <span className="pill">정본 {SPEC_REG_R1.revision}</span>{' '}
            <span className="pill">{SPEC_REG_R1.date}</span>{' '}
            <span className="pill">기준 {SPEC_REG_R1.baseline}</span>{' '}
            <span className="pill">{r1PlaneLabel}</span>{' '}
            <span className="pill">협업 {r1CollabLabel}</span>{' '}
            <span className="pill">심사 기준일 {REVIEW_AT}</span>
          </div>
        </div>
        <div className="col" style={{ flex: 1, minWidth: 280 }}>
          <p className="small muted">{SPEC_REG_R1.summary}</p>
          <p className="small muted">{SPEC_REG_R1.criteriaLabel}</p>
        </div>
      </div>

      {/* ── 7기준 심사 ─────────────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>{R1_SCREEN_CONTRACT.criteria}</b>
        <div className="row mt" style={{ alignItems: 'stretch' }}>
          <div className="col" style={{ flex: '0 0 auto', minWidth: 0 }}>
            <div className="kpi">
              <div className="v" data-testid="r1-criteria-count">{review.count} / {review.total}</div>
              <div className="l">충족 (임계 {review.min}개)</div>
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 300 }}>
            <div className="card" style={{ borderColor: candidate ? 'var(--pass)' : 'var(--pending)', marginTop: 0 }}>
              <b style={{ color: candidate ? 'var(--pass)' : 'var(--pending)' }}>
                {candidate ? 'Feature 후보' : 'BOM 하위 Artifact 후보 또는 보류'}
              </b>
              <p className="small mt">{review.verdict}</p>
              <div className="small mono mt">{review.audit(featureId)}</div>
              <p className="small muted mt">{SPEC_REG_R1.threshold.audit}</p>
            </div>
          </div>
        </div>

        <div className="table-wrap mt">
          <table>
            <thead>
              <tr><th>기준</th><th>심사 질문</th><th>근거 영역 · 속성</th><th>판정</th><th>판정 근거</th></tr>
            </thead>
            <tbody>
              {review.rows.map(r => (
                <tr key={r.id}>
                  <td><span className="mono small">{r.id}</span><div>{r.name}</div></td>
                  <td className="small">{r.question}<div className="small muted">{r.verdict}</div></td>
                  <td className="small">
                    {r.areas.map(a => (
                      <button
                        key={a} className="btn small" style={{ marginRight: 4 }}
                        onClick={() => onJumpArea?.(a)}
                      >{a}</button>
                    ))}
                    <div className="mono small muted">{r.attrs.join(' · ')}</div>
                  </td>
                  <td><span className="pill" style={{ color: r.met ? 'var(--pass)' : 'var(--pending)' }}>{r.met ? '충족' : '미충족'}</span></td>
                  <td className="small">{r.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {review.missing.length > 0 && (
          <div className="mt">
            <b className="small">미충족 {review.missing.length}건 — 해소 담당자와 재심사 시점을 기록한다</b>
            {review.missing.map(m => (
              <div key={m.id} className="row mt" style={{ gap: 6, alignItems: 'center' }}>
                <span className="mono small" style={{ minWidth: 54 }}>{m.id}</span>
                <span className="small" style={{ flex: 1 }}>{m.text}</span>
                <input
                  className="input" style={{ maxWidth: 150 }} placeholder="해소 담당자"
                  value={owners[m.id] ?? ''} onChange={e => setOwners(o => ({ ...o, [m.id]: e.target.value }))}
                  aria-label={`${m.id} 해소 담당자`}
                />
              </div>
            ))}
            <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
              <span className="small">재심사 시점</span>
              <input className="input" type="date" value={reopen} onChange={e => setReopen(e.target.value)} aria-label="재심사 시점" />
              <button
                className="btn"
                onClick={() => record(`보류 등록 — ${featureId} ${review.count}/${review.total} · 미충족 ${review.missing.length}건 · 재심사 ${reopen} · 담당자 ${review.missing.map(m => owners[m.id] || '미지정').join(', ')}`)}
              >보류 목록에 등록</button>
            </div>
          </div>
        )}
      </div>

      {/* ── 심사 근거 연결 ─────────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>심사 근거 연결</b>
        <p className="small muted">
          직접 입력·정확 참조로 채운 값 {filledAttrs.length}건 · 관계와 원천(UI02-S03) 정확 참조 {requirementRefs}건 ·
          적용조건(UI02-S02) {conditions}행. 자동·파생 항목(안전 검토 결과 등)은 서버 계산이며 여기서 타이핑하지 않습니다(IA-R04).
        </p>
        <div className="row mt" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b className="small">Control Point(Flag) 연결 — RC-05 · LC-T03</b>
            <div className="row mt" style={{ gap: 6 }}>
              <select className="input" value={openFlag} onChange={e => setOpenFlag(e.target.value)} aria-label="Flag 선택">
                <option value="">선택</option>
                {FLAG_POINTS.map(c => <option key={c.id} value={c.id}>{c.id} · {c.flagClass?.purpose ?? 'policy 없음'}</option>)}
              </select>
              <button
                className="btn" aria-label="Flag 연결"
                onClick={() => toggle(linkedFlags, setLinkedFlags, openFlag)} disabled={!openFlag}
              >연결</button>
            </div>
            <div className="small mt">연결 {linkedFlags.length}건 {linkedFlags.map(id => (
              <button key={id} className="pill" style={{ marginRight: 4 }} onClick={() => toggle(linkedFlags, setLinkedFlags, id)}>{id} ✕</button>
            ))}</div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b className="small">독립 검증 증적 연결 — RC-03 · LC-T04</b>
            <div className="row mt" style={{ gap: 6 }}>
              <select className="input" value={openEvidence} onChange={e => setOpenEvidence(e.target.value)} aria-label="검증 증적 선택">
                {TEST_EVIDENCE.map(a => <option key={artifactIdentity(a)} value={artifactIdentity(a)}>{artifactIdentity(a)} · {kindLabel[a.artifactKind]}</option>)}
              </select>
              <button
                className="btn" aria-label="증적 연결"
                onClick={() => toggle(linkedEvidence, setLinkedEvidence, openEvidence)} disabled={!openEvidence}
              >연결</button>
            </div>
            <div className="small mt">연결 {linkedEvidence.length}건 {linkedEvidence.map(id => (
              <button key={id} className="pill" style={{ marginRight: 4 }} onClick={() => toggle(linkedEvidence, setLinkedEvidence, id)}>{id} ✕</button>
            ))}</div>
            <label className="small mt" style={{ display: 'block' }}>
              <input type="checkbox" checked={evidenceValid} onChange={e => setEvidenceValid(e.target.checked)} /> 증적이 정확 버전에 결속되어 유효하다(LC-T04)
            </label>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b className="small">운영 모니터링 연결 — RC-07</b>
            <div className="row mt" style={{ gap: 6 }}>
              <select className="input" value={openMonitor} onChange={e => setOpenMonitor(e.target.value)} aria-label="모니터링 제어점 선택">
                {MONITOR_POINTS.map(c => <option key={c.id} value={c.id}>{c.id} · {roleLabel[c.role]}</option>)}
              </select>
              <button
                className="btn" aria-label="모니터링 연결"
                onClick={() => toggle(linkedMonitors, setLinkedMonitors, openMonitor)} disabled={!openMonitor}
              >연결</button>
            </div>
            <div className="small mt">연결 {linkedMonitors.length}건 {linkedMonitors.map(id => (
              <button key={id} className="pill" style={{ marginRight: 4 }} onClick={() => toggle(linkedMonitors, setLinkedMonitors, id)}>{id} ✕</button>
            ))}</div>
          </div>
        </div>
      </div>

      {/* ── 업무 Lifecycle ────────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>{R1_SCREEN_CONTRACT.lifecycle} · {R1_SCREEN_CONTRACT.transitions}</b>
        <p className="small muted">{AXIS_NOTE}</p>
        <p className="small">
          <span className="pill mono">Revision 상태 {revisionState}</span> 와 별도 축 — 이 패널의 전이는 Revision 상태를 바꾸지 않습니다.
        </p>
        <div className="mt" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {BUSINESS_STATES.map((s, i) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className="pill" data-state={s}
                style={s === business
                  ? { background: BUSINESS_STATE_COLOR[s], color: '#fff', borderColor: BUSINESS_STATE_COLOR[s] }
                  : { color: BUSINESS_STATE_COLOR[s] }}
              >{s} {BUSINESS_STATE_KO[s]}</span>
              {i < BUSINESS_STATES.length - 1 && <span className="muted small">→</span>}
            </span>
          ))}
        </div>
        <div className="mt">
          {upcoming.map(e => (
            <div key={e.t.id} className="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <span className="mono small">{e.t.id}</span> <b>{e.t.from.join(' | ')} → {e.t.to}</b>
              {e.external && <span className="pill" style={{ marginLeft: 6 }}>이 화면 소관 아님</span>}
              <div className="small muted">Guard: {e.t.guard || '추가 조건 없음'}</div>
              <div className="small muted">기록: {e.t.record}</div>
              {e.reasons.map(r => <div key={r} className="small" style={{ color: 'var(--pending)' }}>✕ {r}</div>)}
              {e.external && <div className="small muted">{EXTERNAL_GUARDS[e.t.id]}</div>}
              <button
                className="btn mt" disabled={!e.allowed} onClick={() => runTransition(e)}
                title={e.reasons[0] ?? ''}
              >
                {e.t.to} 로 전이
              </button>
            </div>
          ))}
          {upcoming.length === 0 && <p className="small muted">현재 상태 {business} 에서 허용된 전이가 없습니다.</p>}
        </div>
        {log.length > 0 && (
          <ul className="small mt">
            {log.map((l, i) => <li key={i} className="mono">{l.ts} {l.text}</li>)}
          </ul>
        )}
      </div>

      {/* ── 안전 등급 ─────────────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>{R1_SCREEN_CONTRACT.safety}</b>
        <p className="small muted">{SPEC_REG_R1.safetyRule}</p>
        <div className="row mt" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="col" style={{ flex: 1, minWidth: 240 }}>
            <b className="small">안전 관련성 (FRI-129 검토 상태 · 3값)</b>
            <select className="input mt" value={relevance} onChange={e => setRelevance(e.target.value as typeof relevance)} aria-label="안전 관련성">
              {RELEVANCE.map(r => <option key={r.code} value={r.code}>{r.code} {r.label}</option>)}
            </select>
            <p className="small muted mt">{SAFETY_RELEVANCE_NOTE}</p>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 240 }}>
            <b className="small">안전 등급 (FRI-130 안전 검토 결과 · 4단계)</b>
            <select className="input mt" value={safetyGrade} onChange={e => setSafetyGrade(e.target.value as SafetyAssessment)} aria-label="안전 등급">
              <option value="UNASSESSED">UNASSESSED 미검토</option>
              {SPEC_REG_SAFETY_GRADES.map(g => <option key={g.code} value={g.code}>{g.code}</option>)}
            </select>
            <div className="small mt">
              <span className="pill" style={{ color: grade.classified ? 'var(--pass)' : 'var(--pending)' }}>
                {grade.classified ? `등급 확정 ${grade.label}` : '등급 미확정'}
              </span>{' '}
              {grade.meaning}
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 240 }}>
            <b className="small">Developing 전이 조건 (LC-T03)</b>
            <div className="small mt">
              {gradeGate
                ? <span style={{ color: 'var(--pending)' }}>✕ 안전·보안 영향 Feature 이고 등급이 미검토이므로 Developing 으로 갈 수 없습니다. 등급 분류를 완료하고 할당·근거(FRI-131)를 남기세요.</span>
                : <span style={{ color: 'var(--pass)' }}>✓ 등급 분류 완료 또는 비안전 Feature — Developing 전이의 등급 조건이 충족되었습니다.</span>}
            </div>
            <div className="small muted mt">
              {SPEC_REG_SAFETY_GRADES.map(g => <div key={g.code} className="mono">{g.code} — {g.meaning}</div>)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Taxonomy 최소 관리단위 ─────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>{R1_SCREEN_CONTRACT.taxonomy}</b>
        <p className="small muted">{SPEC_REG_R1.taxonomyRule}</p>
        <div className="mt" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {SPEC_REG_TAXONOMY.map(l => (
            <span key={l.level} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                className="pill" data-level={l.level}
                style={l.minUnit
                  ? { background: 'var(--brand)', color: '#fff', borderColor: 'var(--brand)' }
                  : undefined}
              >{l.level} {l.name}{l.minUnit ? ' · 최소 관리단위' : ''}</span>
              {l.level !== 'L5' && <span className="muted small">↓</span>}
            </span>
          ))}
        </div>
        <div className="small mt">
          <span className="pill" style={{ color: taxonomy.ok ? 'var(--pass)' : 'var(--pending)' }}>
            {taxonomy.ok ? 'L2 등록 단위' : '등록 단위 아님'}
          </span>{' '}
          {taxonomy.verdict} L3 이하는 하위 Artifact(Flag·Parameter·Signal·DTC)이며 UPG·UPG-VC 는 N:M 별도 축으로 등록 폼에 합치지 않습니다.
        </div>
      </div>

      {/* ── 삭제 정책과 노후 ──────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <b>{R1_SCREEN_CONTRACT.delete} · {R1_SCREEN_CONTRACT.aging}</b>
        <div className="row mt" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="col" style={{ flex: 1, minWidth: 280 }}>
            <div className="card" style={{ marginTop: 0, borderColor: del.allowed ? undefined : 'var(--fail)' }}>
              <b className="small">{`삭제 요청 ${del.allowed ? '가능' : '거부'}`}</b>
              <div className="small mt">차단 조건 {SPEC_REG_R1.deletePolicy.blocks.length}개: {SPEC_REG_R1.deletePolicy.blocks.join(' / ')}</div>
              {del.blockers.map(b => <div key={b} className="small" style={{ color: 'var(--fail)' }}>✕ {b}</div>)}
              <div className="small mt">tombstone <span className="mono">{del.tombstone}</span> 보존 · {del.note}</div>
              <div className="small muted mt">{deleteAlternative(business)}</div>
              <button
                className="btn mt"
                disabled={!del.allowed}
                onClick={() => record(`DELETE ${featureId} — tombstone ${del.tombstone} 유지, 감사 이력·정확 참조 보존`)}
              >삭제 대신 tombstone 기록</button>
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 280 }}>
            <b className="small">기대 수명·노후 후보 — Control Point {agingSum.total}건 기준일 {REVIEW_AT}</b>
            <div className="small muted">노후 후보 {agingSum.aging}건 · 상시 유지(수명 0) {agingSum.permanent}건 · 다음 수명 경과 {agingSum.next}</div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>제어점</th><th>목적</th><th>기대 수명</th><th>수명 경과 시점</th><th>상태</th></tr></thead>
                <tbody>
                  {aging.slice(0, 6).map(a => (
                    <tr key={a.id}>
                      <td className="mono small">{a.id}</td>
                      <td className="small">{a.purpose}</td>
                      <td className="small">{a.lifetimeDays === 0 ? '상시' : `${a.lifetimeDays}일`}</td>
                      <td className="mono small">{a.reviewDueAt}</td>
                      <td className="small">
                        <span className="pill" style={{ color: a.state === 'AGING' ? 'var(--fail)' : a.state === 'CURRENT' ? 'var(--pass)' : undefined }}>
                          {a.state === 'AGING' ? `노후 후보 ${a.daysLeft}일 경과` : a.state === 'CURRENT' ? `유지 ${a.daysLeft}일 남음` : '상시 유지'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn mt"
              onClick={() => record(`노후 후보 ${agingSum.aging}건을 검토함(UI06) 항목으로 통보 — 통보 이력과 처리 결과를 이 화면에 기록한다`)}
            >노후 후보 통보 (검토함 UI06)</button>
          </div>
        </div>
      </div>

      {/* ── 근거와 무결성 ─────────────────────────────────────────── */}
      <div className="mt" style={{ borderTop: '2px solid var(--line)', paddingTop: 10 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="col" style={{ flex: 1, minWidth: 280 }}>
            <b className="small">정본 근거 — FS {SPEC_REG_R1.fsRequirement.basis}</b>
            <ul className="small mt">
              {SPEC_REG_R1.fsRequirement.included.map(f => <li key={f.id}><span className="mono">{f.id}</span> {f.desc}</li>)}
            </ul>
            <p className="small muted">
              제외: <span className="mono">{SPEC_REG_R1.fsRequirement.excluded.map(f => f.id).join(' · ')}</span> — {SPEC_REG_R1.fsRequirement.excludedNote}
            </p>
            <p className="small muted">설계 결속: <span className="mono">{SPEC_REG_R1.designLink}</span></p>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 280 }}>
            <b className="small">기준정보 추적 링크</b>
            <div className="mt">
              {SPEC_REG_R1.traceLinks.links.map(l => (
                <div key={l.to} className="small"><b>{l.to}</b> → <span className="mono">{l.screen}</span> {l.desc}</div>
              ))}
            </div>
            <b className="small mt" style={{ display: 'block' }}>인수 조건 {SPEC_REG_ACCEPTANCE.length}건 · UL 계약 {SPEC_REG_UL.length}건</b>
            <div className="small muted">
              {SPEC_REG_UL.map(u => <div key={u.id}><span className="mono">{u.id}</span> {u.rule}</div>)}
            </div>
            <Link className="btn mt" to="/arch/topology">Topology 동작 메커니즘 보기</Link>
          </div>
        </div>
        <div className="small muted mt">
          화면 계약: {Object.values(R1_SCREEN_CONTRACT).join(' · ')}
        </div>
      </div>
    </div>
  );
}

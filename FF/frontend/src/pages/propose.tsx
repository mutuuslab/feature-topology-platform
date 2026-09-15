// UI19 Feature 제안 — 기준 C01 / 영역 UI19-S01…S06.
//
// Feature Registry(UI02, /master/define)와 다른 화면이다.
//   · 제안 = 아직 Feature 가 아닌 **상류 후보**. Feature ID·정확 버전이 없고 Lifecycle(Proposed/Released…)도 없다.
//   · 제안은 초안 → 접수 → 검토 → 결정 → 이관 5단계를 지나고, 결정(DECISION)에서 3개 경로로 갈라진다.
//   · Feature 전환 경로만 Feature ID 를 발급해 정본 등록(UI02)으로 넘긴다. **이관은 착수 승인이 아니다.**
// 변경요청(CR)은 이 화면에 없다 — 변경요청은 UI28(/change/cr) 이 소유한다.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useToast } from '../store';
import { BOM_CONDITION_PROFILES } from '../data/featureBom';
import {
  DECISION_ROUTES, FORM_KO, FORM_TYPES, KIND_KO, PROPOSAL_KINDS, PROPOSAL_STAGES, STAGE_KO, STAGE_TONE,
  initialProfileDecisions, nextProposalId, proposalGate, proposalStats,
  type DecisionRoute, type HandoffAck, type Proposal, type ProposalState, type ProfileDecision,
} from '../data/proposal';
import { CanonicalScreen, FIELD, Gated, Reasons, StageRail, Table } from '../components/AreaScreen';

const RAIL = PROPOSAL_STAGES.map(s => ({ key: s, ko: STAGE_KO[s] }));
const ROUTES = DECISION_ROUTES.map(r => ({ key: r.key, ko: r.ko }));

const PROFILE_LABEL: Record<string, string> = Object.fromEntries(
  BOM_CONDITION_PROFILES.map(p => [p.id, `${p.market} · ${p.model} · ${p.trim}${p.option !== 'ANY' && p.option !== 'NOT_APPLICABLE' ? ` · ${p.option}` : ''}`]),
);

const nowTs = () => `2026-09-14 ${new Date().toTimeString().slice(0, 5)}`;

export function ProposalRegistry() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const rows = state.proposals as Proposal[];
  const stats = proposalStats(rows);

  const [sel, setSel] = useState<string>(rows[0]?.id || '');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', kind: 'NEW', form: 'STANDARD', value: '', quantitative: '', org: '', due: '', category: '' });
  const [hand, setHand] = useState({ receiver: '', note: '' });
  const [featureId, setFeatureId] = useState('');
  const [reasonEdit, setReasonEdit] = useState('');

  const p = rows.find(r => r.id === sel) || rows[0];
  const patch = (v: Partial<Proposal>) => { if (p) dispatch({ t: 'PROPOSAL_PATCH', id: p.id, patch: v }); };

  const canCreate = can('create');
  const canEdit = can('edit');
  const canDecide = can('approve');

  const gate = useMemo(() => (to: ProposalState) => (p ? proposalGate(p, to) : { ok: false, reasons: ['제안을 선택하세요'] }), [p]);

  const create = () => {
    const id = nextProposalId(rows);
    const next: Proposal = {
      id, title: form.title.trim(), kind: form.kind as Proposal['kind'], form: form.form as Proposal['form'],
      category: form.category.trim() || '-', stage: 'DRAFT', org: form.org.trim(), due: form.due.trim(),
      owner: state.role, value: form.value.trim(), quantitative: form.quantitative.trim(), technical: '',
      salesTalk: 'NO', techReview: 'NO', profiles: initialProfileDecisions(), handoff: null,
      history: [{ ts: nowTs(), actor: state.role, from: 'DRAFT', to: 'DRAFT', note: '초안 생성' }],
    };
    dispatch({ t: 'ADD_PROPOSAL', p: next });
    setSel(id);
    setCreating(false);
    setForm({ title: '', kind: 'NEW', form: 'STANDARD', value: '', quantitative: '', org: '', due: '', category: '' });
    toast(`${id} 초안 생성 — 접수 전에는 Feature 가 아니다`, 'ok');
  };

  const go = (to: ProposalState, note: string) => {
    if (!p) return;
    const g = proposalGate(p, to);
    if (!g.ok) { toast(`전이 거부 — ${g.reasons[0]}`, 'warn'); return; }
    dispatch({ t: 'PROPOSAL_STAGE', id: p.id, to, note, actor: state.role });
  };

  const request = () => {
    if (!p) return;
    const seq = String(rows.length + 21).padStart(2, '0');
    const ack: HandoffAck = {
      correlationId: `corr-${seq}${p.id.slice(-2)}`, commandId: `cmd-${p.id.slice(-2)}${seq}`,
      requestedAt: nowTs(), state: 'REQUESTED', receiver: hand.receiver.trim() || p.org, note: hand.note.trim(),
    };
    dispatch({ t: 'PROPOSAL_HANDOFF', id: p.id, ack, actor: state.role });
    setHand({ receiver: '', note: '' });
  };

  const ackNow = () => {
    if (!p?.handoff) return;
    dispatch({ t: 'PROPOSAL_HANDOFF', id: p.id, ack: { ...p.handoff, state: 'ACKED', ackAt: nowTs() }, actor: state.role });
  };

  const setProfile = (id: string, decision: ProfileDecision['decision'], reason?: string) => {
    if (!p) return;
    patch({ profiles: p.profiles.map(x => x.profile === id ? { ...x, decision, reason: reason ?? x.reason } : x) });
  };

  const setRoute = (route: DecisionRoute) => {
    if (!p) return;
    const to = DECISION_ROUTES.find(r => r.key === route)!.to;
    if (route === 'FEATURE') {
      const suggested = featureId || `FEAT-${(p.category.split(/[^A-Za-z]/)[0] || 'NEW').toUpperCase().slice(0, 4)}-${String(state.features.length + 1).padStart(3, '0')}`;
      setFeatureId(suggested);
      patch({ route, decisionReason: reasonEdit || p.decisionReason || '' });
      return;
    }
    if (route === 'REJECT') {
      if (!reasonEdit.trim() && !p.decisionReason?.trim()) { toast('반려는 사유가 필요하다', 'warn'); return; }
      patch({ route, decisionReason: reasonEdit || p.decisionReason });
      dispatch({ t: 'PROPOSAL_STAGE', id: p.id, to: 'REJECTED', note: reasonEdit || p.decisionReason || '반려', actor: state.role });
      return;
    }
    if (!reasonEdit.trim()) { toast('보류는 사유가 필요하다', 'warn'); return; }
    patch({ route, decisionReason: reasonEdit });
    toast(`${p.id} 보류 — 결정 단계에 남긴다`, 'warn');
  };

  // Feature 전환 = Feature ID 발급 + **정본 등록(UI02)으로 이관**이다. 여기서 Feature 를 만들지 않는다 —
  // Feature 를 만드는 곳은 UI02 등록(7기준 심사 + R0 필수 + Revision 기록) 하나뿐이다.
  const convert = () => {
    if (!p) return;
    const id = featureId.trim();
    if (!id) { toast('Feature ID 를 발급하세요', 'warn'); return; }
    if (state.features.some(f => f.id === id)) { toast(`${id} 는 이미 Feature Registry 에 있다 (409)`, 'err'); return; }
    dispatch({ t: 'PROPOSAL_CONVERT', id: p.id, featureId: id, reason: p.decisionReason || reasonEdit || 'Feature 전환', actor: state.role });
    toast(`${p.id} → ${id} 발급 · UI02 정본 등록으로 이관 (제안 화면은 Feature 를 만들지 않는다)`, 'ok');
  };

  if (!p) return <CanonicalScreen screenId="UI19" title="Feature 제안" core="C01" kpis={[]} areas={{}} />;

  const gReceive = gate('RECEIVED');
  const gReview = gate('REVIEWING');
  const gDecision = gate('DECISION');
  const gHandoff = gate('HANDOFF');
  const routeNote = DECISION_ROUTES.find(r => r.key === p.route);
  const openProfile = p.profiles.filter(x => x.decision === 'INCLUDE').length;

  const areas: Record<string, () => ReactNode> = {
    // ── UI19-S01 제안 목록과 단계 ──
    'UI19-S01': () => (
      <div>
        <div className="row">
          <div className="col" style={{ flex: 2, minWidth: 420 }}>
            <Table head={['제안 ID', '제목', '신규·변경', '양식', '분류', '단계', '담당 조직', '기한']}>
              {rows.map(r => (
                <tr key={r.id} onClick={() => setSel(r.id)} style={{ cursor: 'pointer', background: r.id === p.id ? 'var(--surface-3)' : undefined }}>
                  <td className="mono">{r.id}</td>
                  <td>{r.title}</td>
                  <td><span className="pill">{KIND_KO[r.kind]}</span></td>
                  <td className="small">{FORM_KO[r.form]}</td>
                  <td className="small">{r.category}</td>
                  <td><span className="badge" style={{ background: STAGE_TONE[r.stage] }}>{STAGE_KO[r.stage]}</span></td>
                  <td className="small">{r.org}</td>
                  <td className="small mono">{r.due}</td>
                </tr>
              ))}
            </Table>
            {canCreate
              ? <button className="btn primary mt" onClick={() => setCreating(v => !v)}>{creating ? '닫기' : '＋ 새 Feature 제안'}</button>
              : <div className="small muted mt">🔒 새 제안은 create 권한이 필요하다</div>}
            {creating && canCreate && (
              <div className="card mt">
                <b className="small">새 Feature 제안 (R0 최초 초안)</b>
                <div className="row mt">
                  <div className="col"><label className="small">제안 제목</label>
                    <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={FIELD} /></div>
                  <div className="col"><label className="small">신규 또는 변경</label>
                    <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={FIELD}>
                      {PROPOSAL_KINDS.map(k => <option key={k} value={k}>{KIND_KO[k]}</option>)}</select></div>
                  <div className="col"><label className="small">작성 양식</label>
                    <select value={form.form} onChange={e => setForm({ ...form, form: e.target.value })} style={FIELD}>
                      {FORM_TYPES.map(f => <option key={f} value={f}>{FORM_KO[f]}</option>)}</select></div>
                </div>
                <div className="row mt">
                  <div className="col"><label className="small">분류</label>
                    <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="예: ADAS · Safety" style={FIELD} /></div>
                  <div className="col"><label className="small">검토 조직</label>
                    <input value={form.org} onChange={e => setForm({ ...form, org: e.target.value })} style={FIELD} /></div>
                  <div className="col"><label className="small">기한</label>
                    <input value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} placeholder="2026-10-31" style={FIELD} /></div>
                </div>
                <div className="row mt">
                  <div className="col"><label className="small">고객 가치</label>
                    <textarea rows={2} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} style={FIELD} /></div>
                  <div className="col"><label className="small">정량 근거 (없으면 접수 불가)</label>
                    <textarea rows={2} value={form.quantitative} onChange={e => setForm({ ...form, quantitative: e.target.value })} style={FIELD} /></div>
                </div>
                <div className="mt"><Gated label="초안 생성" kind="primary" reasons={form.title.trim() && form.org.trim() ? [] : ['제목 없음', '검토 조직 없음']} onClick={create} /></div>
              </div>
            )}
          </div>
          <div className="col">
            <b className="small">{p.id} · {p.title}</b>
            <div className="mt"><StageRail steps={RAIL} current={p.stage} terminal={p.stage === 'DECISION' ? ROUTES : undefined}
              note="5단계(초안·접수·검토·결정·이관)와 3개 경로(Feature 전환·보류·반려)를 구분한다. 개발 이관은 투자·개발 착수 승인이 아니다." /></div>
            <div className="kv mt">
              <div>신규·변경</div><div>{KIND_KO[p.kind]}</div>
              <div>양식</div><div>{FORM_KO[p.form]}</div>
              <div>분류</div><div>{p.category}</div>
              <div>담당 조직</div><div>{p.org}</div>
              <div>기한</div><div className="mono">{p.due}</div>
              <div>제안자</div><div>{p.owner}</div>
              {p.reviewer && <><div>기술 검토자</div><div>{p.reviewer}</div></>}
              {p.route && <><div>선택 경로</div><div>{routeNote?.ko}</div></>}
              {p.featureId && <><div>발급 Feature</div><div className="mono">{p.featureId}</div></>}
            </div>
            <div className="row mt" style={{ gap: 8 }}>
              <Gated label="접수 (RECEIVED)" kind="primary" reasons={canEdit ? gReceive.reasons : ['edit 권한 필요']} onClick={() => go('RECEIVED', '접수 — 접수 ACK 를 추적한다')} />
              <Gated label="검토 (REVIEWING)" reasons={canEdit ? gReview.reasons : ['edit 권한 필요']} onClick={() => go('REVIEWING', '기술 검토 착수')} />
              <Gated label="결정 (DECISION)" reasons={canDecide ? gDecision.reasons : ['approve 권한 필요']} onClick={() => go('DECISION', '적용 후보와 기술 검토 확정')} />
            </div>
            <Reasons title="결정 단계 진입 조건" list={gDecision.reasons} ok={gDecision.ok} />
          </div>
        </div>
      </div>
    ),

    // ── UI19-S02 고객 가치와 근거 ──
    'UI19-S02': () => (
      <div>
        <div className="row">
          <div className="col"><label className="small">고객 가치</label>
            <textarea rows={4} value={p.value} onChange={e => patch({ value: e.target.value })} style={FIELD} /></div>
          <div className="col"><label className="small">정량 근거</label>
            <textarea rows={4} value={p.quantitative} onChange={e => patch({ quantitative: e.target.value })} style={FIELD} /></div>
        </div>
        <div className="row mt">
          <div className="col"><label className="small">판매 설명 활용</label>
            <select value={p.salesTalk} onChange={e => patch({ salesTalk: e.target.value as 'YES' | 'NO' })} style={FIELD}>
              <option value="YES">YES — 판매 설명에 활용</option><option value="NO">NO</option></select></div>
          <div className="col"><label className="small">법규·설계·아키텍처 검토</label>
            <select value={p.techReview} onChange={e => patch({ techReview: e.target.value as 'YES' | 'NO' })} style={FIELD}>
              <option value="NO">NO — 별도 개발 절차 불필요</option><option value="YES">YES — 별도 검토 필요</option></select>
            <p className="small muted">YES 인 제안은 개발 절차로 넘기고 수신 ACK 를 추적한다.</p></div>
        </div>
        <div className="row mt">
          <div className="col"><label className="small">검토 조직</label>
            <input value={p.org} onChange={e => patch({ org: e.target.value })} style={FIELD} /></div>
          <div className="col"><label className="small">기한</label>
            <input value={p.due} onChange={e => patch({ due: e.target.value })} style={FIELD} /></div>
        </div>
        <Reasons title="접수 조건 (초안 → 접수)" list={gReceive.reasons} ok={gReceive.ok} />
      </div>
    ),

    // ── UI19-S03 기술 검토와 적용 후보 ──
    'UI19-S03': () => (
      <div>
        <div className="row">
          <div className="col"><label className="small">기술 타당성 또는 협의 근거</label>
            <textarea rows={4} value={p.technical} onChange={e => patch({ technical: e.target.value })} style={FIELD} /></div>
          <div className="col"><label className="small">기술 검토자</label>
            <input value={p.reviewer || ''} onChange={e => patch({ reviewer: e.target.value })} style={FIELD} />
            <p className="small muted mt">검토 단계 진입에는 접수 ACK 와 검토자 지정이 함께 필요하다.</p>
            <Reasons title="검토 단계 진입 조건" list={gReview.reasons} ok={gReview.ok} /></div>
        </div>
        <b className="small">적용 후보 판정 — 포함·제외를 확정하고 제외에는 사유를 남긴다 (미정 {p.profiles.filter(x => x.decision === 'UNDECIDED').length}건)</b>
        <Table head={['적용 후보', '조건', '판정', '사유']}>
          {p.profiles.map(x => (
            <tr key={x.profile}>
              <td className="mono">{x.profile}@{BOM_CONDITION_PROFILES.find(c => c.id === x.profile)?.version}</td>
              <td className="small muted">{PROFILE_LABEL[x.profile]}</td>
              <td>
                <select value={x.decision} onChange={e => setProfile(x.profile, e.target.value as ProfileDecision['decision'])} style={{ ...FIELD, width: 110 }}>
                  <option value="UNDECIDED">미정</option><option value="INCLUDE">포함</option><option value="EXCLUDE">제외</option></select>
              </td>
              <td><input value={x.reason} disabled={x.decision !== 'EXCLUDE'} onChange={e => setProfile(x.profile, x.decision, e.target.value)}
                placeholder={x.decision === 'EXCLUDE' ? '제외 사유 (필수)' : '—'} style={FIELD} /></td>
            </tr>
          ))}
        </Table>
        <p className="small muted mt">포함 {openProfile}건 · 제외 {p.profiles.filter(x => x.decision === 'EXCLUDE').length}건 — 결정 단계 진입 시 미정이 남아 있으면 거부된다.</p>
      </div>
    ),

    // ── UI19-S04 협의와 개발 이관 ──
    'UI19-S04': () => (
      <div>
        <div className="decision INFO">개발 이관은 개발 **착수 승인**이 아니다 — 이관은 접수(ACK)로만 확인하고, 착수 판단은 투자·개발 절차에서 따로 내린다.</div>
        <div className="row mt">
          <div className="col"><label className="small">검토·이관 대상 조직</label>
            <input value={hand.receiver || p.org} onChange={e => setHand({ ...hand, receiver: e.target.value })} style={FIELD} /></div>
          <div className="col"><label className="small">협의 메모</label>
            <input value={hand.note} onChange={e => setHand({ ...hand, note: e.target.value })} style={FIELD} /></div>
        </div>
        <div className="row mt" style={{ gap: 8 }}>
          <Gated label="이관 요청 (correlation·command ID 발급)" kind="primary" reasons={canEdit ? [] : ['edit 권한 필요']} onClick={request} />
          <Gated label="접수 ACK 확인" reasons={p.handoff ? [] : ['이관 요청이 없다']} onClick={ackNow} />
        </div>
        {p.handoff ? (
          <Table head={['correlation ID', 'command ID', '요청 시각', '수신 조직', '상태', 'ACK 시각', '메모']}>
            <tr>
              <td className="mono">{p.handoff.correlationId}</td><td className="mono">{p.handoff.commandId}</td>
              <td className="small mono">{p.handoff.requestedAt}</td><td className="small">{p.handoff.receiver}</td>
              <td><span className="badge" style={{ background: p.handoff.state === 'ACKED' ? 'var(--pass)' : p.handoff.state === 'FAILED' ? 'var(--fail)' : 'var(--pending)' }}>{p.handoff.state}</span></td>
              <td className="small mono">{p.handoff.ackAt || '—'}</td><td className="small muted">{p.handoff.note || '—'}</td>
            </tr>
          </Table>
        ) : <p className="small muted mt">이관 요청 전 — 같은 correlation·command ID 로 요청·처리·결과를 연결한다.</p>}
        <Reasons title="검토 단계 진입 조건 (ACK 확인 포함)" list={gReview.reasons} ok={gReview.ok} />
      </div>
    ),

    // ── UI19-S05 Feature 전환과 추적 ──
    'UI19-S05': () => (
      <div>
        <div className="row">
          <div className="col">
            <b className="small">3개 경로 — 결정 단계에서만 갈라진다</b>
            <div className="row mt" style={{ gap: 8 }}>
              {DECISION_ROUTES.map(r => (
                <button key={r.key} className={`btn ${p.route === r.key ? 'primary' : ''}`} onClick={() => setRoute(r.key)} title={r.note}>{r.ko}</button>
              ))}
            </div>
            <div className="mt"><label className="small">결정 사유 (보류·반려는 필수)</label>
              <input value={reasonEdit} onChange={e => setReasonEdit(e.target.value)} placeholder={p.decisionReason || '사유'} style={FIELD} /></div>
            <p className="small muted mt">{routeNote?.note || '경로를 선택하세요.'}</p>
          </div>
          <div className="col">
            <b className="small">Feature 전환 — Feature ID 발급 → 정본 등록 이관</b>
            <div className="mt"><label className="small">발급할 Feature ID</label>
              <input value={featureId} onChange={e => setFeatureId(e.target.value)}
                placeholder={`FEAT-${(p.category.split(/[^A-Za-z]/)[0] || 'NEW').toUpperCase().slice(0, 4)}-${String(state.features.length + 1).padStart(3, '0')}`} style={FIELD} /></div>
            <div className="mt"><Gated label="Feature ID 발급 (UI02 등록으로 이관)" kind="primary" reasons={gHandoff.reasons} onClick={convert} /></div>
            <Reasons title="이관(전환) 조건" list={gHandoff.reasons} ok={gHandoff.ok} />
            <p className="small muted mt">이 화면은 Feature 를 만들지 않는다 — 발급한 ID 로 정본 등록(UI02)을 마쳐야 Feature 가 된다.</p>
          </div>
        </div>
        <b className="small mt">전환 결과와 추적</b>
        {p.featureId ? (() => {
          const registered = state.features.find(f => f.id === p.featureId);
          return (
            <div>
              <Table head={['발급 Feature', '정본 등록', 'Lifecycle', '담당 조직', '원천 제안', '다음 단계']}>
                <tr>
                  <td className="mono">{p.featureId}</td>
                  <td><span className="pill" style={{ color: registered ? 'var(--pass)' : 'var(--fail)', borderColor: registered ? 'var(--pass)' : 'var(--fail)' }}>
                    {registered ? '등록 완료' : '이관 대기 — Feature 가 아직 아니다'}</span></td>
                  <td><span className="pill">{registered?.lifecycle || '—'}</span></td>
                  <td className="small">{p.org}</td>
                  <td className="mono">{p.id}</td>
                  <td><Link className="small" to={`/master/define?from=${p.id}`}>UI02 Feature Registry 에서 등록 이어하기 ▸</Link></td>
                </tr>
              </Table>
              <p className="small muted mt">이관은 접수(ACK)까지만 확인한다 — 개발 착수 판단은 별도 절차이고, 정본 등록(7기준 심사 · R0 필수 · Revision 기록)은 UI02 가 수행한다.</p>
            </div>
          );
        })() : <p className="small muted mt">아직 Feature 로 전환되지 않았다 — 이 화면의 제안은 Feature Registry 목록에 나타나지 않는다.</p>}
      </div>
    ),

    // ── UI19-S06 검토와 변경 이력 ──
    'UI19-S06': () => (
      <div>
        <Table head={['시각', '행위자', '이전', '이후', '메모']}>
          {p.history.map((h, i) => (
            <tr key={i}><td className="small mono">{h.ts}</td><td className="small">{h.actor}</td>
              <td><span className="pill">{STAGE_KO[h.from]}</span></td><td><span className="pill">{STAGE_KO[h.to]}</span></td>
              <td className="small muted">{h.note}</td></tr>
          ))}
        </Table>
        <b className="small mt">감사 이력 (이 제안)</b>
        <Table head={['시각', '행위자', '동작', '대상', '내용']}>
          {state.audit.filter(a => a.target === p.id || a.detail.includes(p.id)).slice(0, 12).map((a, i) => (
            <tr key={i}><td className="small mono">{a.ts}</td><td className="small">{a.actor}</td>
              <td className="small">{a.action}</td><td className="mono small">{a.target}</td><td className="small muted">{a.detail}</td></tr>
          ))}
        </Table>
      </div>
    ),
  };

  return (
    <CanonicalScreen
      screenId="UI19" title="Feature 제안" core="C01"
      kpis={[
        { v: stats.total, l: '전체 제안' },
        { v: stats.open, l: '진행 중' },
        { v: stats.review, l: '접수·검토' },
        { v: stats.convertible, l: '전환 대기 (결정)' },
        { v: stats.handedOff, l: 'Feature 전환 완료' },
        { v: stats.ackPending, l: 'ACK 대기' },
        { v: stats.rejected, l: '반려' },
      ]}
      areas={areas}
    />
  );
}

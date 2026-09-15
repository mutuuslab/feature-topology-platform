// UI28 변경요청과 Revision 비교 — 정본 6단계 · 6개 상세 영역.
//
// 변경요청은 사유·Revision 차이·영향·검증 증적·원천 반영·감사를 한 줄기로 남긴다.
// 전이 가능 여부는 data/changeRequest.crGate 가 정하고 화면은 그 사유를 그대로 보여준다(서버 재검사 전제).
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { changeSets } from '../data/model';
import { useApp, useToast, type CR } from '../store';
import { CanonicalScreen, FIELD, Gated, Reasons, StageRail, Table, type Kpi } from '../components/AreaScreen';
import { Breadcrumb } from '../components/Breadcrumb';
import { Donut, Bars, Steps, Timeline, tally, dist } from '../components/charts';
import { CR_STAGES, CR_STAGE_KO, crGate, crStageOf, type CrStage } from '../data/changeRequest';

const RAIL = CR_STAGES.map(s => ({ key: s as string, ko: CR_STAGE_KO[s] }));

/** 정본 화면이 다루는 변경요청 유형. */
const CR_TYPES = ['Targeting Rule 변경', 'Variant 추가', 'SWC 변경', '정책 변경', '정확 버전 개정', '안전 등급 재평가'];

const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;

export function CRList() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { state, dispatch, can } = useApp();
  const toast = useToast();
  const crs = state.crs;
  const [pick, setPick] = useState(crs[0]?.id || '');
  const [open, setOpen] = useState(params.get('new') === '1');
  const [evidence, setEvidence] = useState('');
  const [form, setForm] = useState({ feature: state.features[0]?.id || '', type: CR_TYPES[0], risk: 'Low', reason: '', baselineRev: '', newRev: '' });
  const cur = crs.find(c => c.id === pick) || crs[0];
  const stage = cur ? crStageOf(cur.status) : 'DRAFT';
  const audited = (action: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:40', actor: state.role, action, target: cur?.id || '-', detail } });

  const newId = () => {
    const max = crs.reduce((n, c) => { const m = /CR-(\d{4})-(\d+)/.exec(c.id); return m ? Math.max(n, Number(m[2])) : n; }, 0);
    return `CR-2026-${String(max + 1).padStart(4, '0')}`;
  };

  const move = (to: CrStage) => {
    if (!cur) return;
    const g = crGate(cur, to);
    if (!g.ok) { toast(g.reasons[0], 'err'); return; }
    dispatch({ t: 'CR_SAVE', cr: { ...cur, status: to } });
    audited('CR_STAGE', `${stage} → ${to}`);
    toast(`${cur.id} — ${CR_STAGE_KO[to]}`, 'ok');
  };

  /** 영향 대상은 요구·제어점·시험 연결에서 계산한다 — 목록을 손으로 적지 않는다. */
  const impact = useMemo(() => {
    if (!cur) return [] as { kind: string; ref: string; note: string }[];
    const rels = state.relations.filter(r => r.source.startsWith(cur.feature) || r.target.startsWith(cur.feature));
    const by = (t: string, kind: string) =>
      rels.filter(r => r.type === t).map(r => ({ kind, ref: r.target.split('@')[0], note: `${r.type} 연결` }));
    return [
      ...by('derives', '요구사항'),
      ...by('controlled_by', 'Feature 제어점'),
      ...by('verified_by', '시험 증적'),
      { kind: 'Variant', ref: `${cur.feature} 적용 조건`, note: '조건행 재평가 대상' },
      { kind: '기준선', ref: cur.newRev ? `${cur.feature}@${cur.newRev}` : '—', note: 'New Revision 구성원' },
    ];
  }, [cur?.id, cur?.feature, state.relations]);

  if (!cur) return <div className="card">변경요청이 없다 — 목록에서 새 변경요청을 등록한다.</div>;

  const areas: Record<string, () => ReactNode> = {
    'UI28-S01': () => (
      <div>
        <StageRail steps={RAIL} current={stage} note="종료는 승인·반영까지 끝난 뒤에만 열린다 — 반려된 요청은 초안으로 돌아가 다시 사유부터 채운다." />
        <div className="mt"><Table head={['변경요청', 'Feature', '유형', '단계', 'Owner', 'Risk', '사유']}>
          {crs.map(c => (
            <tr key={c.id} onClick={() => setPick(c.id)} style={{ cursor: 'pointer', background: c.id === pick ? 'var(--surface-3)' : undefined }}>
              <td className="mono">{c.id}</td><td className="mono small">{c.feature}</td><td className="small">{c.type}</td>
              <td><span className="pill">{CR_STAGE_KO[crStageOf(c.status)]}</span></td>
              <td>{c.owner}</td>
              <td><span className="badge" style={{ background: c.risk === 'High' ? 'var(--fail)' : c.risk === 'Med' ? 'var(--pending)' : 'var(--pass)' }}>{c.risk}</span></td>
              <td className="small muted">{(c.reason || '—').slice(0, 40)}</td>
            </tr>
          ))}
        </Table></div>
        <div className="row mt" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => setOpen(!open)}>{open ? '닫기' : '+ 새 변경요청'}</button>
          <button className="btn" onClick={() => nav('/change/cr/' + cur.id)}>상세 열기 →</button>
        </div>
        {open && (
          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <b className="small">변경요청 등록</b>
            <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(110px, 1fr))', gap: 8 }}>
              <label className="small muted">Feature
                <select style={{ ...FIELD, marginTop: 4 }} value={form.feature} onChange={e => setForm({ ...form, feature: e.target.value })}>
                  {state.features.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
                </select>
              </label>
              <label className="small muted">유형
                <select style={{ ...FIELD, marginTop: 4 }} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {CR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="small muted">Risk
                <select style={{ ...FIELD, marginTop: 4 }} value={form.risk} onChange={e => setForm({ ...form, risk: e.target.value })}>
                  {['Low', 'Med', 'High'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="small muted">기준 Revision
                <input style={{ ...FIELD, marginTop: 4 }} value={form.baselineRev} placeholder="1.0" onChange={e => setForm({ ...form, baselineRev: e.target.value })} />
              </label>
              <label className="small muted">새 Revision
                <input style={{ ...FIELD, marginTop: 4 }} value={form.newRev} placeholder="1.1" onChange={e => setForm({ ...form, newRev: e.target.value })} />
              </label>
              <label className="small muted">사유
                <input style={{ ...FIELD, marginTop: 4 }} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
              </label>
            </div>
            <div className="row mt" style={{ gap: 8 }}>
              <Gated label="등록 (초안)" kind="primary"
                reasons={!form.reason.trim() ? ['변경 사유 없음'] : can('create') ? [] : ['등록 권한 없음']}
                onClick={() => {
                  const cr: CR = { id: newId(), feature: form.feature, type: form.type, status: 'DRAFT', owner: state.role, risk: form.risk, reason: form.reason, baselineRev: form.baselineRev, newRev: form.newRev, evidence: [] };
                  dispatch({ t: 'CREATE_CR', cr });
                  dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:40', actor: state.role, action: 'CR_CREATE', target: cr.id, detail: `${form.type} · ${form.reason.slice(0, 30)}` } });
                  setPick(cr.id); setOpen(false); setForm({ ...form, reason: '', baselineRev: '', newRev: '' });
                }} />
              <span className="small muted">사유 없는 변경요청은 만들 수 없다 — 사유가 영향 평가의 입력이 된다.</span>
            </div>
          </div>
        )}
        <div className="row analytics-strip mt">
          <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>단계 분포</b>
            <Donut size={120} center={`${crs.length}`} segments={dist(tally(crs, c => CR_STAGE_KO[crStageOf(c.status)]))} />
          </div>
          <div className="col card" style={{ flex: 2 }}><b>유형별 건수</b><div className="mt"><Bars data={tally(crs, c => c.type)} /></div></div>
        </div>
      </div>
    ),
    'UI28-S02': () => (
      <div>
        <div className="kv small">기준 <span className="mono">{cur.baselineRev || '—'}</span> → 새 Revision <span className="mono">{cur.newRev || '—'}</span> · Feature <span className="mono">{cur.feature}</span></div>
        <div className="mt"><Table head={['영역', '기준 Revision', '새 Revision', '차이']}>
          {impact.slice(0, 8).map((i, n) => (
            <tr key={n}><td>{i.kind}</td><td className="mono small">{cur.baselineRev || '—'}</td><td className="mono small">{cur.newRev || '—'}</td><td className="small muted">{i.note}</td></tr>
          ))}
        </Table></div>
        <div className="mt"><Table head={['Revision 입력', '값']}>
          <tr><td>기준 Revision</td><td><input style={FIELD} value={cur.baselineRev || ''} disabled={!can('edit')} onChange={e => dispatch({ t: 'CR_SAVE', cr: { ...cur, baselineRev: e.target.value } })} /></td></tr>
          <tr><td>새 Revision</td><td><input style={FIELD} value={cur.newRev || ''} disabled={!can('edit')} onChange={e => dispatch({ t: 'CR_SAVE', cr: { ...cur, newRev: e.target.value } })} /></td></tr>
        </Table></div>
        <Note>Revision 비교는 승인된 버전을 덮어쓰지 않는다 — 새 Revision 은 반영 단계에서 별도로 발행된다.</Note>
      </div>
    ),
    'UI28-S03': () => (
      <div>
        <Table head={['구분', '대상', '근거']}>
          {impact.map((i, n) => <tr key={n}><td>{i.kind}</td><td className="mono small">{i.ref}</td><td className="small muted">{i.note}</td></tr>)}
        </Table>
        <div className="row mt" style={{ gap: 8 }}>
          <Gated label="영향 평가 기록" reasons={impact.length === 0 ? ['연결된 영향 대상이 없다'] : can('edit') ? [] : ['편집 권한 없음']}
            onClick={() => { dispatch({ t: 'CR_SAVE', cr: { ...cur, impact: `${impact.length}건 — ${impact.map(i => i.kind).join(', ')}` } }); audited('CR_IMPACT', `${impact.length}건`); toast('영향 평가를 기록했다', 'ok'); }} />
        </div>
        <Note>영향은 요구·Feature 제어점·시험 증적 연결에서 계산한다 — 손으로 적은 목록은 평가로 인정하지 않는다.</Note>
      </div>
    ),
    'UI28-S04': () => (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {CR_STAGES.map(s => (
            <Gated key={s} label={`${CR_STAGE_KO[s]} 로`} kind={s === 'APPROVED' ? 'primary' : undefined}
              reasons={crGate(cur, s).reasons} onClick={() => move(s)} />
          ))}
        </div>
        <div className="mt"><Reasons list={crGate(cur, 'APPROVED').reasons} title="승인 조건" ok={crGate(cur, 'APPROVED').ok} /></div>
        <div className="mt" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="small muted">만료 예정
            <input style={{ ...FIELD, marginTop: 4 }} value={cur.due || ''} disabled={!can('edit')} onChange={e => dispatch({ t: 'CR_SAVE', cr: { ...cur, due: e.target.value } })} />
          </label>
          <label className="small muted">검증 증적
            <input style={{ ...FIELD, marginTop: 4 }} value={evidence} placeholder="EVD-2026-0412" onChange={e => setEvidence(e.target.value)} />
          </label>
        </div>
        <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
          <Gated label="증적 추가" reasons={!evidence.trim() ? ['증적 ID 없음'] : []}
            onClick={() => { dispatch({ t: 'CR_SAVE', cr: { ...cur, evidence: [...(cur.evidence || []), evidence.trim()] } }); audited('CR_EVIDENCE', evidence.trim()); setEvidence(''); }} />
          {(cur.evidence || []).map(e => <span key={e} className="pill">{e}</span>)}
          {(cur.evidence || []).length === 0 && <span className="small muted">등록된 증적이 없다</span>}
        </div>
      </div>
    ),
    'UI28-S05': () => (
      <div>
        <Table head={['원천', '요청', '결과', '반영 기준선']}>
          {[
            ['PLM-BOM', `${cur.feature} 구성 반영`, cur.appliedBaseline ? '반영 완료' : '미반영', cur.appliedBaseline || '—'],
            ['UNLEASH', '정책 버전 발행', cur.appliedBaseline ? '대기' : '미요청', '—'],
            ['품질 시스템', '검증 결과 회수', (cur.evidence || []).length ? '회수됨' : '미요청', '—'],
          ].map(r => (
            <tr key={r[0]}><td>{r[0]}</td><td className="small">{r[1]}</td><td><span className="pill">{r[2]}</span></td><td className="mono small">{r[3]}</td></tr>
          ))}
        </Table>
        <div className="mt" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="small muted">반영 기준선
            <input style={{ ...FIELD, marginTop: 4 }} value={cur.appliedBaseline || ''} placeholder="BL-BDC-2027.1@1.0.0" disabled={!can('edit')}
              onChange={e => dispatch({ t: 'CR_SAVE', cr: { ...cur, appliedBaseline: e.target.value } })} />
          </label>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <Gated label="원천 반영 요청"
              reasons={stage !== 'APPROVED' && stage !== 'IMPLEMENTED' ? ['승인 이후에만 원천 반영을 요청한다'] : !cur.appliedBaseline ? ['반영 기준선 미지정'] : can('run-engine') ? [] : ['연계 권한 없음']}
              onClick={() => { audited('CR_APPLY', cur.appliedBaseline || ''); toast('원천 반영 요청을 보냈다', 'ok'); }} />
            <button className="btn" onClick={() => nav('/change/timeline')}>Version Timeline →</button>
          </div>
        </div>
        <Note>반영 요청과 승인은 별개다 — 원천 결과가 돌아오기 전에는 종료할 수 없다.</Note>
      </div>
    ),
    'UI28-S06': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          <Gated label="종료로" kind="primary" reasons={crGate(cur, 'CLOSED').reasons} onClick={() => move('CLOSED')} />
        </div>
        <div className="mt"><Table head={['완료 조건', '상태']}>
          <tr><td>승인</td><td>{CR_STAGES.indexOf(stage) >= CR_STAGES.indexOf('APPROVED') ? '완료' : '미완료'}</td></tr>
          <tr><td>검증 증적</td><td>{(cur.evidence || []).length > 0 ? `${(cur.evidence || []).length}건` : '없음'}</td></tr>
          <tr><td>반영 기준선</td><td className="mono">{cur.appliedBaseline || '미지정'}</td></tr>
        </Table></div>
        <div className="mt"><Table head={['시각', '행위자', '행위', '내용']}>
          {state.audit.filter(a => a.target === cur.id).slice(0, 12).map((a, i) => (
            <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>
          ))}
        </Table></div>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: crs.length, l: '변경요청' },
    { v: crs.filter(c => crStageOf(c.status) === 'IN_REVIEW').length, l: '검토 중' },
    { v: crs.filter(c => crStageOf(c.status) === 'APPROVED').length, l: '승인' },
    { v: impact.length, l: '선택 영향' },
  ];
  return <CanonicalScreen screenId="UI28" title="변경요청과 Revision 비교" core="C12 감사 이력 관리" kpis={kpis} areas={areas} />;
}

export function CRDetail() {
  const nav = useNavigate();
  const { id } = useParams();
  const { state, dispatch } = useApp();
  const toast = useToast();
  const cr = state.crs.find(c => c.id === id) || state.crs[0];
  if (!cr) return <div className="card">변경요청 없음</div>;
  const stage = crStageOf(cr.status);
  const idx = CR_STAGES.indexOf(stage);
  const next = CR_STAGES[idx + 1];
  const set = (to: CrStage) => {
    const g = crGate(cr, to);
    if (!g.ok) { toast(g.reasons[0], 'err'); return; }
    dispatch({ t: 'CR_SAVE', cr: { ...cr, status: to } });
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:45', actor: state.role, action: 'CR_STAGE', target: cr.id, detail: `${stage} → ${to}` } });
    toast(`${cr.id} — ${CR_STAGE_KO[to]}`, 'ok');
  };
  return (
    <div>
      <Breadcrumb title="변경요청 상세" />
      <h1 className="page-title">{cr.id} · <span className="mono">{cr.feature}</span></h1>
      <div className="row">
        <div className="col card"><b>단계 진행</b>
          <Steps steps={CR_STAGES.map(s => CR_STAGE_KO[s])} current={idx} done={stage === 'CLOSED'} />
          <div className="mt"><StageRail steps={RAIL} current={stage} /></div>
          <p className="small mt">유형: {cr.type} · Risk {cr.risk} · Owner {cr.owner}</p>
          {cr.reason && <p className="small muted">사유 — {cr.reason}</p>}
          <p className="small muted">기준 Revision <span className="mono">{cr.baselineRev || '—'}</span> → 새 Revision <span className="mono">{cr.newRev || '—'}</span></p>
          <div className="row mt" style={{ gap: 8 }}>
            <button className="btn" onClick={() => nav('/change/timeline')}>이력 →</button>
            <button className="btn" onClick={() => nav('/change/cr')}>목록 ←</button>
          </div>
        </div>
        <div className="col card"><b>전이</b><p className="small">현재 단계: <span className="pill">{CR_STAGE_KO[stage]}</span></p>
          {next ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Gated label={`${CR_STAGE_KO[next]} 로`} kind="primary" reasons={crGate(cr, next).reasons} onClick={() => set(next)} />
            </div>
          ) : <span className="small muted">종료된 변경요청이다 — 후속은 새 변경요청으로 만든다.</span>}
          {next && <div className="mt"><Reasons list={crGate(cr, next).reasons} title={`${CR_STAGE_KO[next]} 전이 조건`} ok={crGate(cr, next).ok} /></div>}
          <p className="small muted mt">상태 변경은 store에 저장 — 새로고침해도 유지된다.</p>
        </div>
      </div>
    </div>
  );
}

export function BaselineDiff() {
  const cs = changeSets['FEAT-BDC-001'] || [];
  return (
    <div>
      <Breadcrumb title="Baseline Diff" />
      <h1 className="page-title">Baseline Diff — v1.0 ↔ v1.1</h1>
      <div className="card">{cs.map((c, i) => (
        <div key={i} className="evt">
          <span className="pill" style={{ background: c.type === 'ADD' ? 'var(--pass)' : 'var(--pending)', color: '#fff' }}>{c.type === 'ADD' ? '➕' : '✏'} {c.type}</span>
          <b>{c.area}</b><span className="muted">{c.detail}</span>
        </div>
      ))}</div>
    </div>
  );
}

export function VersionTimeline() {
  return (
    <div>
      <Breadcrumb title="Version Timeline" />
      <h1 className="page-title">Version Timeline · FEAT-BDC-001</h1>
      <div className="card">
        <Timeline items={[
          { ts: '2026.06', tag: 'v1.1', title: 'ADD 5 / MODIFY 2', detail: '자동 Impact Analysis 트리거 (RULE-R12)' },
          { ts: '2026.05', tag: 'v1.0', title: '최초 Baseline', detail: 'Feature 등록 · BOM 11영역 구성' },
        ]} />
      </div>
    </div>
  );
}

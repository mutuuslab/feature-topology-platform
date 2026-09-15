// UI26 연계 작업과 재처리 · UI30 요구사항과 설계 추적
//
// 연계 작업은 원천 요청의 결과를 격리·재처리·인계까지 추적하고,
// 설계 추적은 요구 원문이 실제 화면·설계·시험으로 이어졌는지를 판정 상태로 남긴다.
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, useLiveSlices, useToast } from '../store';
import { CanonicalScreen, FIELD, Gated, Reasons, Table, type Kpi } from '../components/AreaScreen';
import { designAreasOf, menuPathOfScreen } from '../data/traceLinks';
import {
  JOB_STAGE_KO, JOB_STAGE_TONE, JOB_STAGES, SEED_JOBS, SEED_TRACES, TRACE_STATE_KO, TRACE_STATE_TONE, traceStats,
  type IntegrationJob, type JobStage, type TraceRow, type TraceState,
} from '../data/plmData';

const Pill = ({ s, tone }: { s: string; tone?: string }) => (
  <span className="pill" style={{ background: tone || 'var(--surface-2)', color: tone ? '#fff' : 'var(--muted)', borderColor: 'transparent' }}>{s}</span>
);
const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;

const MAX_ATTEMPTS = 5;

// ═══════════════════════════════════ UI26 ═══════════════════════════════════
export function IntegrationJobs() {
  const { state, dispatch, can } = useApp();
  const { syncLogs } = useLiveSlices();
  const toast = useToast();
  const [jobs, setJobs] = useState<IntegrationJob[]>(() => SEED_JOBS.map(j => ({ ...j })));
  const [pick, setPick] = useState(SEED_JOBS[0].id);
  const [form, setForm] = useState({ source: 'PLM-UPG', object: '' });
  const [cancel, setCancel] = useState({ reason: '', handedTo: 'steward' });
  const cur = jobs.find(j => j.id === pick) || jobs[0];
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:05', actor: state.role, action, target: cur?.id || '-', detail } });
  const patch = (p: Partial<IntegrationJob>) => setJobs(list => list.map(j => (j.id === cur.id ? { ...j, ...p } : j)));

  /** 재처리 판단 — 원천 캡처가 있고 시도 한도를 넘지 않아야 다시 돌린다. */
  const retryGate = (j?: IntegrationJob) => {
    const reasons: string[] = [];
    if (!j) return ['선택된 작업이 없다'];
    if (!j.capture) reasons.push('요청 Capture 가 없어 같은 입력으로 재처리할 수 없다');
    if (j.stage === 'SUCCEEDED') reasons.push('이미 성공한 작업이다');
    if (j.stage === 'CANCELLED') reasons.push('취소된 작업은 재처리 대상이 아니다');
    if (j.stage === 'DEAD_LETTER' && j.attempts >= MAX_ATTEMPTS) reasons.push(`시도 한도(${MAX_ATTEMPTS}회) 초과 — 인계 후 재등록해야 한다`);
    if (!can('run-engine')) reasons.push('재처리 권한 없음');
    return reasons;
  };

  const areas: Record<string, () => ReactNode> = {
    'UI26-S01': () => (
      <div>
        <Table head={['작업', '원천', '대상 객체', '단계', '시도', '다음 재처리', '담당']}>
          {jobs.map(j => (
            <tr key={j.id} onClick={() => setPick(j.id)} style={{ cursor: 'pointer', background: j.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{j.id}</td><td>{j.source}</td><td className="mono small">{j.object}</td>
              <td><Pill s={JOB_STAGE_KO[j.stage]} tone={JOB_STAGE_TONE[j.stage]} /></td>
              <td>{j.attempts}</td><td className="mono small">{j.nextRetry || '—'}</td><td className="small">{j.owner}</td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="small muted">원천
            <select style={{ ...FIELD, marginTop: 4 }} value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
              {['PLM-UPG', 'PLM-BOM', 'SUPPLIER-API', 'BOM-SYNC'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="small muted" style={{ flex: 1 }}>대상 객체
            <input style={{ ...FIELD, marginTop: 4 }} value={form.object} placeholder="UPG-… / BOM-…@버전" onChange={e => setForm({ ...form, object: e.target.value })} />
          </label>
          <Gated label="연계 작업 등록" kind="primary"
            reasons={!form.object.trim() ? ['대상 객체 없음'] : jobs.some(j => j.object === form.object && j.stage !== 'SUCCEEDED' && j.stage !== 'CANCELLED') ? [`${form.object} 에 진행 중인 작업이 있다 — 중복 요청은 만들지 않는다`] : []}
            onClick={() => {
              const id = `JOB-2026-${String(913 + jobs.length).padStart(4, '0')}`;
              const j: IntegrationJob = { id, source: form.source, object: form.object, stage: 'PENDING', attempts: 0, nextRetry: '', error: '', owner: state.role, capture: { requestId: `req-${id.toLowerCase()}`, payloadHash: `sha256:${id.slice(-4)}`, origin: form.source } };
              setJobs([j, ...jobs]); setPick(id); setForm({ ...form, object: '' });
              dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:05', actor: state.role, action: 'JOB_CREATE', target: id, detail: form.object } });
              toast(`${id} 등록됨 (대기)`, 'ok');
            }} />
        </div>
      </div>
    ),
    'UI26-S02': () => (
      <div>
        <div className="kv small"><b>{cur?.id}</b> · {cur?.source} · <span className="mono">{cur?.object}</span> <Pill s={JOB_STAGE_KO[cur?.stage || 'PENDING']} tone={JOB_STAGE_TONE[cur?.stage || 'PENDING']} /></div>
        <div className="mt"><Table head={['항목', '값']}>
          <tr><td>시도</td><td>{cur?.attempts} / {MAX_ATTEMPTS}</td></tr>
          <tr><td>다음 재처리</td><td className="mono">{cur?.nextRetry || '—'}</td></tr>
          <tr><td>오류</td><td className="small">{cur?.error || '—'}</td></tr>
          <tr><td>담당</td><td>{cur?.owner}</td></tr>
        </Table></div>
        <div className="mt"><Table head={['시각', '연계', '이벤트', '상태']}>
          {syncLogs.slice(0, 6).map((l, i) => <tr key={i}><td className="mono small">{l.ts}</td><td>{l.conn}</td><td className="small">{l.event}</td><td><span className="pill">{l.status}</span></td></tr>)}
        </Table></div>
        <Note>오류가 사라졌다고 성공으로 바꾸지 않는다 — 성공 전이는 원천 응답으로만 한다.</Note>
      </div>
    ),
    'UI26-S03': () => (
      <div>
        <Table head={['단계', '재처리 가능', '사유']}>
          {([['PENDING', '가능', '아직 시도하지 않음'], ['ACK_WAIT', '가능', '응답 타임아웃 — 같은 입력으로 재요청'], ['RETRY_READY', '가능', '속성 보완 후 재처리'], ['DEAD_LETTER', '한도 내 가능', `${MAX_ATTEMPTS}회 초과 시 인계`], ['SUCCEEDED', '불가', '이미 반영됨'], ['CANCELLED', '불가', '취소된 작업']] as [JobStage, string, string][]).map(r => (
            <tr key={r[0]}><td>{JOB_STAGE_KO[r[0]]}</td><td>{r[1]}</td><td className="small muted">{r[2]}</td></tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8 }}>
          <Gated label="재처리 실행" kind="primary" reasons={retryGate(cur)}
            onClick={() => { patch({ stage: 'RETRY_READY', attempts: cur.attempts + 1, error: '재처리 요청됨' }); audited('JOB_RETRY', `시도 ${cur.attempts + 1}회`); toast(`${cur.id} 재처리 요청 (시도 ${cur.attempts + 1}회)`, 'ok'); }} />
          <Gated label="성공으로 표시" reasons={['원천 응답 없이 성공으로 바꿀 수 없다']} />
        </div>
        <Note>성공 표시는 원천 응답을 받은 뒤에만 열린다 — 지금은 잠겨 있다.</Note>
      </div>
    ),
    'UI26-S04': () => (
      <div>
        <Table head={['항목', '값']}>
          <tr><td>Request ID</td><td className="mono">{cur?.capture?.requestId || '—'}</td></tr>
          <tr><td>Payload Hash</td><td className="mono">{cur?.capture?.payloadHash || '—'}</td></tr>
          <tr><td>원천</td><td className="mono">{cur?.capture?.origin || '—'}</td></tr>
        </Table>
        <div className="row mt" style={{ gap: 8 }}>
          <Gated label="원천 대사" reasons={!cur?.capture ? ['Capture 없음 — 대사할 입력이 없다'] : cur.stage === 'ACK_WAIT' ? ['원천 응답 대기 중'] : []}
            onClick={() => { audited('JOB_RECONCILE', cur?.capture?.payloadHash || ''); toast('원천 대사 결과를 기록했다', 'ok'); }} />
        </div>
        <Note>대사는 캡처한 요청 해시를 다시 보내 결과를 비교한다 — 화면에서 만들어낸 값으로 대체하지 않는다.</Note>
      </div>
    ),
    'UI26-S05': () => (
      <div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="small muted" style={{ flex: 1 }}>취소 사유
            <input style={{ ...FIELD, marginTop: 4 }} value={cancel.reason} onChange={e => setCancel({ ...cancel, reason: e.target.value })} placeholder="상위 변경요청 반려 등" />
          </label>
          <label className="small muted">인계 대상
            <select style={{ ...FIELD, marginTop: 4 }} value={cancel.handedTo} onChange={e => setCancel({ ...cancel, handedTo: e.target.value })}>
              {['steward', 'integrator', 'quality', 'coordinator'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Gated label="취소하고 격리" kind="danger"
            reasons={!cancel.reason.trim() ? ['취소 사유를 적어야 한다'] : cur?.stage === 'SUCCEEDED' ? ['이미 반영된 작업은 취소할 수 없다'] : can('edit') ? [] : ['권한 없음']}
            onClick={() => { patch({ stage: 'CANCELLED', cancel: { reason: cancel.reason, isolated: true, handedTo: cancel.handedTo }, error: `요청 취소 — ${cancel.reason}` }); audited('JOB_CANCEL', `${cancel.reason} · 인계 ${cancel.handedTo}`); toast(`${cur.id} 취소 · ${cancel.handedTo} 인계`, 'ok'); setCancel({ ...cancel, reason: '' }); }} />
        </div>
        <div className="mt"><Table head={['작업', '격리', '인계', '사유']}>
          {jobs.filter(j => j.cancel).map(j => <tr key={j.id}><td className="mono">{j.id}</td>
            <td><Pill s={j.cancel!.isolated ? '격리' : '미격리'} tone={j.cancel!.isolated ? '#c53030' : undefined} /></td>
            <td>{j.cancel!.handedTo}</td><td className="small muted">{j.cancel!.reason}</td></tr>)}
        </Table></div>
        <Note>격리는 원천에 남은 잔여 상태를 지우지 않는다 — 인계 대상이 후속 조치를 이어받는다.</Note>
      </div>
    ),
    'UI26-S06': () => (
      <div>
        <Table head={['시각', '행위자', '행위', '내용']}>
          {state.audit.filter(a => a.target === cur?.id).slice(0, 12).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}
        </Table>
        {state.audit.filter(a => a.target === cur?.id).length === 0 && <Note>이 작업에는 아직 감사 기록이 없다 — 등록·재처리·취소가 모두 기록된다.</Note>}
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: jobs.length, l: '연계 작업' },
    { v: jobs.filter(j => j.stage === 'DEAD_LETTER').length, l: '격리' },
    { v: jobs.filter(j => j.stage === 'RETRY_READY' || j.stage === 'ACK_WAIT').length, l: '재처리 대상' },
    { v: jobs.reduce((n, j) => n + j.attempts, 0), l: '누적 시도' },
  ];
  return <CanonicalScreen screenId="UI26" title="연계 작업과 재처리" core="C33 데이터 동기화" kpis={kpis} areas={areas} />;
}

// ═══════════════════════════════════ UI30 ═══════════════════════════════════
export function DesignTrace() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<TraceRow[]>(SEED_TRACES);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(SEED_TRACES[0].id);
  const cur = rows.find(r => r.id === pick) || rows[0];
  const st = traceStats(rows);
  const hit = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(r => [r.id, r.requirement, r.source, r.screen, r.design, TRACE_STATE_KO[r.verdict]].some(v => (v || '').toLowerCase().includes(k)));
  }, [q, rows]);
  const audited = (action: string, detail: string) => dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:20', actor: 'viewer', action, target: cur?.id || '-', detail } });
  const patch = (p: Partial<TraceRow>) => setRows(list => list.map(r => (r.id === cur.id ? { ...r, ...p } : r)));
  /** 설계 항목이 있는 기준 SW 영역 — 영역 ID 접두가 화면 ID 와 같아야 잇힌다. */
  const designRows = useMemo(() => designAreasOf(cur?.screen || ''), [cur?.screen]);

  const areas: Record<string, () => ReactNode> = {
    'UI30-S01': () => (
      <div>
        <label className="small muted">요구 원문 검색
          <input style={{ ...FIELD, marginTop: 4 }} value={q} onChange={e => setQ(e.target.value)} placeholder="요구 ID · 문장 · 원천 · 판정" />
        </label>
        <div className="mt"><Table head={['요구', '요구 원문', '원천', '판정']}>
          {hit.map(r => (
            <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
              <td className="mono">{r.id}</td><td className="small">{r.requirement}</td><td className="mono small">{r.source}</td>
              <td><Pill s={TRACE_STATE_KO[r.verdict]} tone={TRACE_STATE_TONE[r.verdict]} /></td>
            </tr>
          ))}
        </Table></div>
        <Note>검색은 원문·원천·화면·설계에 걸린다 — 원천 표기(SRC38 …!20)를 그대로 찾을 수 있다.</Note>
      </div>
    ),
    'UI30-S02': () => (
      <div>
        <Table head={['요구', '기준 화면', '설계 영역', '구현 화면']}>
          {rows.map(r => (
            <tr key={r.id}><td className="mono">{r.id}</td><td>{r.screen}</td><td className="small">{r.design}</td>
              <td className="small mono">{menuPathOfScreen(r.screen) || '—'}</td></tr>
          ))}
        </Table>
        <div className="mt"><Table head={['설계 영역', '객체', '페이로드', '목적']}>
          {designRows.slice(0, 12).map(r => <tr key={r.id}><td className="small">{r.id}</td><td className="small">{r.object}</td><td className="mono small">{r.payload}</td><td className="small muted">{r.purpose}</td></tr>)}
        </Table></div>
        {designRows.length === 0 && <Note>이 기준 화면({cur?.screen})에 연결된 설계 영역이 아직 없다 — 기준 화면 ID 와 설계 영역 ID 접두가 같아야 잇힌다.</Note>}
      </div>
    ),
    'UI30-S03': () => (
      <div>
        <Table head={['속성', '성격', '필수', '사용처']}>
          {[['Feature 정확 버전', '식별', '예', 'BOM 구성원 · OfferingItem'], ['Revision', '식별', '예', '변경요청 · SW EO'], ['scope', '범위', '예', 'BOM 범위 · 적용 대상'], ['원천 표기', '추적', '예', '요구 추적 · 감사'], ['tombstone', '이력', '예', '삭제된 Feature 이력 보존']].map(r => (
            <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="small muted">{r[3]}</td></tr>
          ))}
        </Table>
        <Note>관계 사전은 화면에서 새로 만들지 않는다 — 없는 관계는 모델에 추가하고 여기에 반영한다.</Note>
      </div>
    ),
    'UI30-S04': () => (
      <div>
        <Table head={['항목', '제품 값', '원천 값', '호환']}>
          {[['정확 버전 표기', 'v1.1.0', '1.1.0', '정규화 필요'], ['Revision', 'r1.1', '1.1', '호환'], ['Feature ID', 'FEAT-BDC-001', 'FEAT-BDC-001', '호환'], ['scope', 'BDC-BODY', 'BDC-BODY', '호환']].map(r => (
            <tr key={r[0]}><td>{r[0]}</td><td className="mono">{r[1]}</td><td className="mono">{r[2]}</td>
              <td><Pill s={r[3]} tone={r[3] === '호환' ? '#2f855a' : '#b8860b'} /></td></tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8 }}>
          <Gated label="호환성 재검사" reasons={[]}
            onClick={() => { audited('TRACE_COMPAT', cur?.id || ''); toast('호환성 재검사 결과를 기록했다', 'ok'); }} />
        </div>
        <Note>표기 정규화가 필요한 항목은 자동 변환하지 않고 정본 표기로 옮기는 작업을 남긴다.</Note>
      </div>
    ),
    'UI30-S05': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          {(['SOURCE', 'DESIGN_LINKED', 'REVIEW_REQUIRED', 'TEST_NOT_RUN'] as TraceState[]).map(s => (
            <Gated key={s} label={`${TRACE_STATE_KO[s]} 로`}
              reasons={cur?.verdict === s ? ['이미 같은 상태다'] : s === 'DESIGN_LINKED' && !cur?.design ? ['설계 연결 없이 설계 연결 상태로 둘 수 없다'] : s === 'DESIGN_LINKED' && !cur?.test ? ['시험 연결이 없으면 TEST_NOT_RUN 이어야 한다'] : []}
              onClick={() => { patch({ verdict: s }); audited('TRACE_VERDICT', `${cur?.verdict} → ${s}`); toast(`${cur?.id} ${TRACE_STATE_KO[s]}`, 'ok'); }} />
          ))}
        </div>
        <div className="mt"><Table head={['요구', '문장', '원천', '시험', '판정']}>
          {rows.filter(r => r.verdict !== 'DESIGN_LINKED').map(r => (
            <tr key={r.id}><td className="mono">{r.id}</td><td className="small">{r.requirement}</td><td className="mono small">{r.source}</td>
              <td className="mono small">{r.test || '—'}</td><td><Pill s={TRACE_STATE_KO[r.verdict]} tone={TRACE_STATE_TONE[r.verdict]} /></td></tr>
          ))}
        </Table></div>
        <Note>GAP 은 Backlog 로 넘기지 않고 판정 상태로 남긴다 — 연결되지 않은 요구가 숨겨지면 추적이 끊긴다.</Note>
      </div>
    ),
    'UI30-S06': () => (
      <div>
        <div className="row" style={{ gap: 8 }}>
          <Gated label="추적표 내보내기" reasons={[]} onClick={() => { audited('TRACE_EXPORT', `${rows.length}행`); toast(`추적표 ${rows.length}행을 내보냈다`, 'ok'); }} />
          <button className="btn" onClick={() => nav('/insights/audit')}>감사 이력 →</button>
        </div>
        <div className="mt"><Table head={['항목', '값']}>
          <tr><td>요구</td><td>{st.total}</td></tr>
          <tr><td>설계 연결</td><td>{st.linked}</td></tr>
          <tr><td>검토 필요</td><td>{st.review}</td></tr>
          <tr><td>시험 미실시</td><td>{st.notRun}</td></tr>
          <tr><td>원문만</td><td>{st.sourceOnly}</td></tr>
        </Table></div>
        <div className="mt"><Table head={['시각', '행위자', '행위', '대상']}>
          {state.audit.filter(a => a.action.startsWith('TRACE_')).slice(0, 10).map((a, i) => <tr key={i}><td className="mono small">{a.ts}</td><td>{a.actor}</td><td>{a.action}</td><td className="mono small">{a.target}</td></tr>)}
        </Table></div>
        <Note>내보낸 추적표는 시점을 남긴다 — 이후 연결이 바뀌어도 당시 판정을 덮어쓰지 않는다.</Note>
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: st.total, l: '요구' },
    { v: st.linked, l: '설계 연결' },
    { v: st.review, l: '검토 필요' },
    { v: st.notRun + st.sourceOnly, l: '미연결' },
  ];
  return <CanonicalScreen screenId="UI30" title="요구사항과 설계 추적" core="C45 안전 요구사항 추적" kpis={kpis} areas={areas} />;
}

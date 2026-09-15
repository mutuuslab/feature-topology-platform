// Feature BOM 기준선 — 화면 UI04 (UI04-S01~S06). Feature Platform 기준정보 ▸ Feature BOM.
//
// 기준 정본
//  · Feature_Topology_Definition v0.8 §2 — Feature BOM 은 승인 대상 Feature 버전 집합과 선택 구현 참조를
//    고정한 상위 구성 기준선이고 ImplementationBOM 은 하나의 FeatureVersion 을 구현하는 정확 구성이다.
//  · FP_SW_Detailed_Design v4.6 · MODEL BOMBaseline — members(중복 금지), items(부모는 같은 기준선),
//    contentHash(SHA-256 자동), assessmentRef, approval(작성자와 다른 주체), predecessor, revokedAt.
//  · DD-03-3 (Item 합집합·중복·출처·resolution 검증 후 hash 생성), DD-03-4 / UL-017 (조건행은 AND, 행 사이 OR),
//    DD-03-3 확장 경계 (Master·Configured·Effective 는 파생 표현이며 원천 승인 데이터로 되쓰지 않는다).
//  · C03 Feature BOM · 구성·의존관계 관리 — 실패코드 IMPLEMENTATION_ITEM_DRIFT, UNRESOLVED_ARTIFACT.
//
// 이 화면은 문장을 쓰지 않는다. 승인 가능 여부·구현 선택·hash 결속은 data/featureBom.ts 의 계산 결과를
// 그대로 노출하고, 각 상세 영역의 탭은 아래 로컬 목록이 정의한다(요구사양서 원문은 제품에 두지 않는다).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bars, Donut, Heatmap } from '../components/charts';
import {
  ARTIFACT_RECORDS, BOM_AREAS, BOM_AREA_KO, BOM_REQUIRED_AREAS, CONTROL_POINTS, IMPL_BOM_INDEX,
  deliveryLabel, kindLabel, type ArtifactRecord, type BomArea,
} from '../data/implementation';
import {
  BASELINE_ACTION_KO, BASELINE_STATE_KO, BASELINE_STATES, BOM_APPROVAL_NON_CIRCULAR, BOM_APPROVAL_ORDER,
  BOM_BASELINES, BOM_CONDITION_PROFILES, BOM_VIEW_KO, CONDITION_AXES, PROFILE_OUTCOME_KO,
  baselineTransition, baselineUsageOf, bomContentHash,
  bomStats, buildBomViews, computeBaselineViolations, evaluateProfiles, implementationBomsOf, memberCheckReport,
  type BaselineAction, type BaselineMember, type BaselineState, type BomBaseline, type BomContext, type BomViolation,
  type ConditionAxis, type ProfileOutcome, type TransitionResult,
} from '../data/featureBom';
import { SPEC_TOPOLOGY_RELATIONS } from '../data/specNav';
import { useApp, useToast } from '../store';
import { Breadcrumb } from '../components/Breadcrumb';

const ART_INDEX = new Map(ARTIFACT_RECORDS.map(a => [`${a.id}@${a.version}`, a]));
const CP_INDEX = new Map(CONTROL_POINTS.map(c => [c.id, c]));

const STATE_COLOR: Record<BaselineState, string> = {
  DRAFT: '#8895A7', IN_REVIEW: '#D9822B', CHANGES_REQUESTED: '#D64545', APPROVED: '#1F9D55', REVOKED: '#6B7280',
};
const OUTCOME_COLOR: Record<ProfileOutcome, string> = {
  SELECTED: '#1F9D55', NOT_SUPPORTED: '#D64545', UNVERIFIED: '#D9822B', CONFIG_CONFLICT: '#D64545',
};
const REVIEW_KO: Record<string, string> = { NONE: '일치', REVIEW: '확인 필요', BLOCKED: '차단' };
const REVIEW_COLOR: Record<string, string> = { NONE: '#1F9D55', REVIEW: '#D9822B', BLOCKED: '#D64545' };

/** 그래프 연결 — store 의 edges/relations 와 같은 형태. */
interface GraphLink { id: string; source: string; target: string; type: string }

const ACTIONS: BaselineAction[] = ['submit', 'approve', 'requestChanges', 'revise', 'revoke'];

/** 기준 업무 명령 표(UI04-S06)와 엔진 액션의 대응 — 화면은 기준 명령 이름으로 조작한다. */
const SPEC_CMD: Record<BaselineAction, { cmd: string; role: string; from: string; to: string; note?: string }> = {
  submit: { cmd: 'SUBMIT_REVIEW', role: 'author', from: 'DRAFT · CHANGES_REQUESTED', to: 'IN_REVIEW' },
  approve: { cmd: 'APPROVE', role: 'approver', from: 'IN_REVIEW', to: 'APPROVED' },
  requestChanges: { cmd: 'REQUEST_CHANGES', role: 'approver', from: 'IN_REVIEW', to: 'CHANGES_REQUESTED', note: '사유·담당자·기한 필수' },
  revise: { cmd: 'REVISE_DRAFT', role: 'author', from: 'CHANGES_REQUESTED', to: 'DRAFT' },
  revoke: { cmd: 'REVOKE_BASELINE', role: 'approver', from: 'APPROVED', to: 'REVOKED' },
};

const ACTORS = [
  { id: 'kim.taeho@body', ko: '김태호 · Feature 설계(작성자)', role: 'author' },
  { id: 'lee.jihyun@quality', ko: '이지현 · Quality 승인자', role: 'approver' },
  { id: 'park.minsoo@quality', ko: '박민수 · Quality 승인자', role: 'approver' },
];

/** 조건 축 예시 문맥 — 기준 조건행에서 뽑은 실제 값만 쓴다. */
const PRESETS: { id: string; ko: string; ctx: BomContext }[] = [
  { id: 'KR-PREMIUM', ko: 'KR · BDC-BODY · MY2027+ · Premium', ctx: { market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-B', sw: 'ANY', upgvc: 'UPGVC-X' } },
  { id: 'EU-PREMIUM', ko: 'EU · BDC-BODY · MY2027+ · Premium', ctx: { market: 'EU', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-C', sw: 'ANY', upgvc: 'UPGVC-Y' } },
  { id: 'KR-TRIM-UNKNOWN', ko: 'KR · Trim UNKNOWN', ctx: { market: 'KR', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'UNKNOWN', option: 'ANY', hw: 'ANY', sw: 'ANY', upgvc: 'UPGVC-X' } },
  { id: 'JP', ko: 'JP — 지원 없음', ctx: { market: 'JP', model: 'BDC-BODY', modelYear: 'MY2027+', trim: 'Premium', option: 'ANY', hw: 'ECU-BDC-B', sw: 'ANY', upgvc: 'UPGVC-X' } },
];

/** 기준 15 관계 어휘와 정의 방향 — 실제 그래프 edge/relation 을 이 어휘로 검증한다(UI05-AC01). */
const RELATION_DIR: Record<string, { ko: string; dir: string }> = {
  parent_of: { ko: '상위 → 하위 포함', dir: 'source=상위' },
  composed_of: { ko: '구성 → 구성요소', dir: 'source=구성' },
  requires: { ko: '동작 선행 조건', dir: 'source=요구 주체' },
  excludes: { ko: '동시 활성 금지', dir: 'source=배제 주체' },
  overrides: { ko: '조건·우선순위 대체', dir: 'source=대체 주체' },
  fallback_to: { ko: '실패·미지원 시 대체 경로', dir: 'source=원래 대상' },
  degrades_to: { ko: '성능 저하 모드', dir: 'source=정상 모드' },
  replaces: { ko: '버전·기능 대체', dir: 'source=신규' },
  duplicates: { ko: '동일 의미 중복', dir: '방향 없음' },
  implemented_by: { ko: '구현 artifact 결속', dir: 'source=Feature' },
  verified_by: { ko: '검증 artifact 결속', dir: 'source=Feature' },
  observed_by: { ko: '관측 계약 결속', dir: 'source=Feature' },
  deployed_on: { ko: '배포 대상 결속', dir: 'source=Feature' },
  governed_by: { ko: '정책·거버넌스 결속', dir: 'source=Feature' },
  emits: { ko: '신호·이벤트 방출', dir: 'source=Feature' },
};

const SHORT = (s: string, n = 12) => (s.length > n ? `${s.slice(0, n)}…` : s);
const baseIdOf = (ref: string) => ref.split('@')[0];
const bumpPatch = (v: string) => {
  const p = v.split('.').map(n => Number.parseInt(n, 10));
  while (p.length < 3) p.push(0);
  p[2] += 1;
  return p.join('.');
};
const memberItemId = (m: BaselineMember, area: BomArea) => `${m.memberId}-${m.conditionProfileRef}-${area}`;

interface LogRow { ts: string; actor: string; cmd: string; from: BaselineState; to: BaselineState; http: number; code?: string; message: string }

function StateBadge({ state }: { state: BaselineState }) {
  return <span className="badge" style={{ background: STATE_COLOR[state] }}>{BASELINE_STATE_KO[state]} · {state}</span>;
}

function OutcomeBadge({ outcome }: { outcome: ProfileOutcome }) {
  return <span className="badge" style={{ background: OUTCOME_COLOR[outcome] }}>{PROFILE_OUTCOME_KO[outcome]}</span>;
}

function CheckIcon({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? 'var(--pass)' : 'var(--fail)', fontWeight: 700 }}>{ok ? '✔' : '✖'}</span>;
}

function HashCell({ hash, expected, label }: { hash: string; expected?: string; label?: string }) {
  const ok = expected === undefined ? true : hash === expected;
  return (
    <span className="mono small" style={{ color: ok ? 'inherit' : 'var(--fail)' }} title={hash}>
      {label ? `${label} ` : ''}{SHORT(hash, 16)}
    </span>
  );
}

export function FeatureBom() {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const baselines = state.bomBaselines;

  const violations = useMemo(() => computeBaselineViolations(baselines), [baselines]);
  const stats = useMemo(() => bomStats(baselines, violations), [baselines, violations]);

  const [selKey, setSelKey] = useState(`${BOM_BASELINES[0].id}@${BOM_BASELINES[0].version}`);
  const [tab, setTab] = useState('UI04-S01');
  const [stateFilter, setStateFilter] = useState<'ALL' | BaselineState>('ALL');
  const [q, setQ] = useState('');
  const [actor, setActor] = useState(ACTORS[1].id);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<TransitionResult | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [ctx, setCtx] = useState<BomContext>(PRESETS[0].ctx);
  const [obs, setObs] = useState<Record<string, string | number | boolean>>(() => {
    const out: Record<string, string | number | boolean> = {};
    CONTROL_POINTS.forEach(c => { if (c.observedValue !== undefined) out[c.id] = c.observedValue as string | number | boolean; });
    return out;
  });

  const sel = baselines.find(b => `${b.id}@${b.version}` === selKey) ?? baselines[0];

  const selViolations = useMemo<BomViolation[]>(
    () => (sel ? violations.filter(v => v.target.startsWith(`${sel.id}@${sel.version}`)) : []),
    [violations, sel],
  );

  const profile = useMemo(() => evaluateProfiles(ctx), [ctx]);
  const views = useMemo(() => (sel ? buildBomViews(sel, ctx, obs) : []), [sel, ctx, obs]);
  const report = useMemo(() => (sel ? memberCheckReport(sel) : undefined), [sel]);
  const hashNow = useMemo(() => (sel ? bomContentHash(sel) : ''), [sel]);
  const nodes = useMemo(() => baselineNodeJoin(sel, state.edges, state.relations), [sel, state.edges, state.relations]);
  const check = useMemo(() => approvalChecklist(sel, selViolations, nodes), [sel, selViolations, nodes]);

  // 정본 §2.4 승인 순서 — 검사 결과를 순서에 묶는다. 순서를 건너뛴 승인은 남기지 않는다.
  const approval = useMemo(() => {
    const byKey = new Map(check.map(c => [c.key, c]));
    return BOM_APPROVAL_ORDER.map(s => {
      const rows = s.checks.flatMap(k => { const c = byKey.get(k); return c ? [c] : []; });
      return { ...s, rows, ok: rows.every(r => r.ok), failed: rows.filter(r => !r.ok) };
    });
  }, [check]);
  const stepOf = useMemo(() => {
    const m = new Map<string, number>();
    BOM_APPROVAL_ORDER.forEach(s => s.checks.forEach(k => m.set(k, s.no)));
    return m;
  }, []);

  // 상세 영역 탭 — 구현 화면이 실제로 가진 6개 영역.
  const tabs = [
    { id: 'UI04-S01', name: '기준선 목록과 상세', type: '표' },
    { id: 'UI04-S02', name: 'Feature 구성원', type: '표' },
    { id: 'UI04-S03', name: '구현 구성과 11개 영역', type: '표' },
    { id: 'UI04-S04', name: 'Master·Configured·Effective', type: '비교' },
    { id: 'UI04-S05', name: '조건과 Topology 검증', type: '검증' },
    { id: 'UI04-S06', name: '기준선 승인과 이력', type: '승인' },
  ];

  if (!sel) return <div className="card">기준선 데이터가 없습니다.</div>;

  const listed = baselines.filter(b =>
    (stateFilter === 'ALL' || b.state === stateFilter)
    && (!q.trim() || `${b.id}@${b.version} ${b.memberSetRef} ${b.author}`.toLowerCase().includes(q.trim().toLowerCase())));

  const runTransition = (action: BaselineAction) => {
    const r = baselineTransition(sel, action, actor, { reason, role: ACTORS.find(a => a.id === actor)?.role, violations });
    setResult(r);
    if (!r.ok) { toast(`${r.http} ${r.code} — ${r.message}`, 'warn'); return; }
    const next: BomBaseline = {
      ...sel,
      state: r.next || sel.state,
      approval: r.approval,
      revokedAt: action === 'revoke' ? r.approval?.at || '2026-09-13 10:20' : sel.revokedAt,
      revokedReason: action === 'revoke' ? (reason.trim() || '승인 후 구성 불일치 — 철회') : sel.revokedReason,
    };
    dispatch({ t: 'BOM_SAVE', b: next });
    setLog(rows => [{ ts: '2026-09-13 10:20', actor, cmd: SPEC_CMD[action].cmd, from: sel.state, to: next.state, http: r.http, code: r.code, message: r.message }, ...rows]);
    toast(`${r.http} ${SPEC_CMD[action].cmd} 접수 — ${sel.id}@${sel.version} → ${BASELINE_STATE_KO[next.state]}`, 'ok');
    setReason('');
  };

  const createDraft = () => {
    const draft: BomBaseline = {
      ...sel,
      version: bumpPatch(sel.version),
      state: 'DRAFT',
      predecessor: `${sel.id}@${sel.version}`,
      author: ACTORS.find(a => a.id === actor)?.id || sel.author,
      approval: undefined,
      revokedAt: undefined,
      revokedReason: undefined,
      changeReason: `${sel.id}@${sel.version} 구성 복사 — 구성 변경은 UI04-S02 구성원·UI04-S03 구현 영역에서 한다`,
    };
    dispatch({ t: 'BOM_SAVE', b: draft });
    setSelKey(`${draft.id}@${draft.version}`);
    setTab('UI04-S02');
    setLog(rows => [{ ts: '2026-09-13 10:20', actor, cmd: 'UI04-S01-A02 기준선 초안 생성', from: sel.state, to: 'DRAFT', http: 201, message: `${draft.id}@${draft.version} 생성 — 구성 내용 동일, contentHash 유지`, }, ...rows]);
    toast(`${draft.id}@${draft.version} 초안 생성 — 구성 내용 동일(contentHash 유지)`, 'ok');
  };

  // ── S01 상세 diff (A03) — 승인 버전과 현재 후보의 구성 차이 ──
  const approved = baselines.find(b => b.id === sel.id && b.state === 'APPROVED' && `${b.id}@${b.version}` !== `${sel.id}@${sel.version}`)
    || (sel.predecessor ? baselines.find(b => `${b.id}@${b.version}` === sel.predecessor) : undefined);
  const diff = approved ? baselineDiff(approved, sel) : undefined;

  const renderS01 = () => (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>기준선 목록</b>
          <span className="small muted">A01 BOM ID·버전·상태 조회 · A02 기준선 초안 생성 · A03 승인 버전과 차이 비교</span>
          <span style={{ flex: 1 }} />
          <input className="btn" style={{ minWidth: 200 }} placeholder="ID · 범위 · 작성자" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn" onClick={() => setStateFilter('ALL')} disabled={stateFilter === 'ALL'}>전체 {baselines.length}</button>
          {BASELINE_STATES.map(s => (
            <button key={s} className="btn" onClick={() => setStateFilter(s)} style={stateFilter === s ? { borderColor: STATE_COLOR[s], color: STATE_COLOR[s] } : undefined}>
              {BASELINE_STATE_KO[s]} {stats.byState[s]}
            </button>
          ))}
        </div>
        <div className="table-wrap mt">
          <table>
            <thead>
              <tr>
                <th>기준선 ID</th><th>버전</th><th>상태</th><th>구성원</th><th>Item</th>
                <th>contentHash</th><th>승인 hash</th><th>차단</th><th>이전 기준선</th><th>책임자</th><th>변경 사유</th>
              </tr>
            </thead>
            <tbody>
              {listed.map(b => {
                const vs = violations.filter(v => v.target.startsWith(`${b.id}@${b.version}`));
                const blocking = vs.filter(v => v.blocking).length;
                const hashOk = !b.approval || b.approval.contentHashRef === b.contentHash;
                const key = `${b.id}@${b.version}`;
                return (
                  <tr key={key} onClick={() => setSelKey(key)} style={{ cursor: 'pointer', background: key === selKey ? 'var(--surface-2)' : undefined }}>
                    <td className="mono small">{b.id}</td>
                    <td className="mono small">{b.version}</td>
                    <td><span className="badge" style={{ background: STATE_COLOR[b.state] }}>{BASELINE_STATE_KO[b.state]}</span></td>
                    <td className="mono small">{b.members.length}</td>
                    <td className="mono small">{b.items.length}</td>
                    <td><HashCell hash={b.contentHash} /></td>
                    <td className="small">{b.approval ? <><HashCell hash={b.approval.contentHashRef} expected={b.contentHash} />{hashOk ? '' : ' 불일치'}</> : '미승인'}</td>
                    <td className="small" style={{ color: blocking ? 'var(--fail)' : 'var(--pass)' }}>{blocking || '—'}</td>
                    <td className="mono small">{b.predecessor || '—'}</td>
                    <td className="small">{b.author}</td>
                    <td className="small">{b.changeReason || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 420px' }}>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <b className="mono">{sel.id}@{sel.version}</b>
            <StateBadge state={sel.state} />
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => { setSelKey(`${sel.id}@${sel.version}`); toast(`조회 ${sel.id}@${sel.version} · ${BASELINE_STATE_KO[sel.state]} · hash ${SHORT(sel.contentHash, 16)}`); }}>A01 조회</button>
            <button className="btn primary" onClick={createDraft}>A02 기준선 초안 생성</button>
          </div>
          <div className="kv mt">
            <div>기준선 범위</div><div>{sel.memberSetRef}</div>
            <div>책임자</div><div className="mono small">{sel.ownerRef}</div>
            <div>작성자</div><div className="mono small">{sel.author}</div>
            <div>contentHash</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{sel.contentHash}</div>
            <div>재계산 검사</div>
            <div className="small">
              <CheckIcon ok={hashNow === sel.contentHash} /> members+items 정규 직렬화 재계산 {hashNow === sel.contentHash ? '일치' : `불일치 (${SHORT(hashNow, 16)})`}
            </div>
            <div>승인 결속</div>
            <div className="small">
              {sel.approval
                ? <><HashCell hash={sel.approval.contentHashRef} expected={sel.contentHash} label="승인 hash" /> · {sel.approval.actor} ({sel.approval.role}) · {sel.approval.at} · {sel.approval.reason}</>
                : '<span className="muted">승인 기록 없음</span>'}
              {sel.approval && sel.approval.contentHashRef !== sel.contentHash ? <div style={{ color: 'var(--fail)' }}>승인 후 구성이 바뀌어 승인 효력이 없다 — 새 버전과 재검토가 필요하다</div> : null}
            </div>
            <div>검증(Assessment)</div>
            <div className="small">{sel.assessmentRef ? <>{sel.assessmentRef.id} · {sel.assessmentRef.result} · {sel.assessmentRef.harness} · {sel.assessmentRef.at} · hash {sel.assessmentRef.hashRef}</> : <span className="muted">없음</span>}</div>
            <div>Topology</div><div className="mono small">{sel.topologyRef} · 노드 {sel.topologyNodes.length}개</div>
            <div>이전 기준선</div><div className="mono small">{sel.predecessor || '—'}</div>
            <div>변경 사유</div><div className="small">{sel.changeReason || '—'}</div>
            <div>철회</div><div className="small">{sel.revokedAt ? `${sel.revokedAt} · ${sel.revokedReason}` : '—'}</div>
          </div>
          <p className="small muted mt">
            승인 대상 Feature 사용처 역조회: {sel.members[0]
              ? baselineUsageOf(sel.members[0].featureVersionRef, baselines).map(u => `${u.ref} ${BASELINE_STATE_KO[u.state]}${u.independent ? ' 독립 승인' : ''}`).join(' · ') || '없음'
              : '—'}
          </p>
        </div>

        <div className="card" style={{ flex: '1 1 360px' }}>
          <b>상태 분포와 차단 사유</b>
          <div className="row mt" style={{ gap: 16, alignItems: 'flex-start' }}>
            <Donut
              segments={BASELINE_STATES.map(s => ({ label: BASELINE_STATE_KO[s], value: stats.byState[s], color: STATE_COLOR[s] }))}
              center={`${stats.total}`}
            />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="small muted">기준선별 차단 위반</div>
              <Bars data={Object.fromEntries(baselines.map(b => [`${b.id}@${b.version}`, violations.filter(v => v.target.startsWith(`${b.id}@${b.version}`) && v.blocking).length]))} />
            </div>
          </div>
          <div className="kv mt">
            <div>승인</div><div className="small">{stats.approved}건 · hash 결속 {stats.hashVerified} / 불일치 {stats.hashMismatch}</div>
            <div>독립 승인</div><div className="small">{stats.independentApproval}건 (작성자 ≠ 승인자)</div>
            <div>구성원 / Item</div><div className="small">{stats.members} / {stats.items} · 영역 {stats.areas}</div>
            <div>차단 위반</div><div className="small">{stats.blocking}건</div>
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <b>A03 승인 버전과 차이 비교</b>
          {approved ? <span className="small muted">기준 {approved.id}@{approved.version} ({BASELINE_STATE_KO[approved.state]}) → {sel.id}@{sel.version}</span> : <span className="small muted">비교할 승인 버전 또는 이전 기준선이 없다</span>}
        </div>
        {diff ? (
          <>
            <div className="kv mt">
              <div>contentHash</div>
              <div className="small">
                {diff.hashSame
                  ? <><CheckIcon ok /> 구성 내용 동일 — {SHORT(approved!.contentHash, 16)}</>
                  : <><CheckIcon ok={false} /> 구성 변경 — {SHORT(approved!.contentHash, 16)} → {SHORT(sel.contentHash, 16)}</>}
              </div>
              <div>구성원 / Item 차이</div><div className="small">추가 {diff.membersAdded.length} · 삭제 {diff.membersRemoved.length} · 변경 {diff.membersChanged.length} · Item 변경 {diff.itemsChanged.length}</div>
            </div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>구분</th><th>대상</th><th>이전</th><th>현재</th></tr></thead>
                <tbody>
                  {diff.membersAdded.map(m => <tr key={`ma-${m.memberId}`}><td className="small" style={{ color: 'var(--pass)' }}>구성원 추가</td><td className="mono small">{m.memberId}</td><td className="small muted">—</td><td className="small">{m.featureVersionRef} · {m.implementationRef} · {m.conditionProfileRef}</td></tr>)}
                  {diff.membersRemoved.map(m => <tr key={`mr-${m.memberId}`}><td className="small" style={{ color: 'var(--fail)' }}>구성원 삭제</td><td className="mono small">{m.memberId}</td><td className="small">{m.featureVersionRef} · {m.implementationRef}</td><td className="small muted">—</td></tr>)}
                  {diff.membersChanged.map(c => <tr key={`mc-${c.memberId}`}><td className="small" style={{ color: 'var(--pending)' }}>구현·조건 변경</td><td className="mono small">{c.memberId}</td><td className="small">{c.before}</td><td className="small">{c.after}</td></tr>)}
                  {diff.itemsChanged.map(c => <tr key={`ic-${c.id}`}><td className="small" style={{ color: 'var(--pending)' }}>Item 변경</td><td className="mono small">{BOM_AREA_KO[c.area as BomArea] || c.area}</td><td className="small">{c.before}</td><td className="small">{c.after}</td></tr>)}
                  {!diff.membersAdded.length && !diff.membersRemoved.length && !diff.membersChanged.length && !diff.itemsChanged.length
                    ? <tr><td colSpan={4} className="small muted">구성 차이가 없다 — 승인 구성 그대로다</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="small muted mt">비교 대상이 없으면 이 영역은 비어 있다. 승인 기준선을 고르면 차이표가 계산된다.</p>}
      </div>
    </>
  );

  const renderS02 = () => (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>Feature 구성원</b>
          <span className="small muted">구성원 ID·부모·정확 버전·구현 참조·조건 Profile·수량 · A02 전 구성원 구현 참조 검사 · A03 기준선 밖 참조와 중복 확인</span>
          <span style={{ flex: 1 }} />
          <span className="mono small">{sel.id}@{sel.version}</span>
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>구성원</th><th>부모</th><th>Feature 정확 버전</th><th>구현 참조</th><th>조건 Profile</th><th>수량</th><th>정합 검사</th></tr></thead>
            <tbody>
              {sel.members.map(m => {
                const row = report?.rows.find(r => r.memberId === m.memberId && r.implementationRef === m.implementationRef);
                return (
                  <tr key={`${m.memberId}-${m.conditionProfileRef}-${m.implementationRef}`}>
                    <td className="mono small">{m.memberId}{m.parentRef !== m.featureVersionRef ? <div className="muted">부모 {m.parentRef}</div> : null}</td>
                    <td className="mono small">{m.parentRef} {m.parentRef === m.featureVersionRef ? <span className="pill">최상위</span> : null}</td>
                    <td className="mono small">{m.featureVersionRef}</td>
                    <td className="mono small">{m.implementationRef}{!IMPL_BOM_INDEX.has(m.implementationRef) ? <span className="pill" style={{ color: 'var(--fail)', borderColor: 'var(--fail)' }}>미등록</span> : null}</td>
                    <td className="mono small">{m.conditionProfileRef}{row && !row.profileKnown ? <span className="pill" style={{ color: 'var(--fail)', borderColor: 'var(--fail)' }}>없음</span> : null}</td>
                    <td className="mono small">{m.quantity}</td>
                    <td className="small">
                      {row ? <><CheckIcon ok={row.ok} /> {row.ok ? '정합' : [row.implKnown ? '' : '구현 미등록', row.featureMatches ? '' : 'Feature 불일치', row.profileKnown ? '' : '조건 Profile 미등록', ...row.unresolvedAreas.map(a => `${a} 미해석`)].filter(Boolean).join(' · ')}</> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 380px' }}>
          <b>구성 계층</b>
          <p className="small muted">부모가 자기 FeatureVersion 과 같으면 최상위 구성원이다. 기준선 밖 부모를 참조하는 Item 은 승인 차단이다.</p>
          <div className="mt">
            {[...new Set(sel.members.map(m => m.featureVersionRef))].map(fv => {
              const own = sel.members.filter(m => m.featureVersionRef === fv);
              const strayItems = sel.items.filter(i => i.parentRef === fv && !own.some(m => memberItemId(m, i.area) === i.id));
              return (
                <div key={fv} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 10, marginBottom: 8 }}>
                  <div className="mono small">{fv} <span className="muted">· 구성원 {own.length} · Item {sel.items.filter(i => i.parentRef === fv).length}</span></div>
                  {own.map(m => (
                    <div key={`${m.memberId}-${m.conditionProfileRef}`} className="small" style={{ marginLeft: 12 }}>
                      └ <span className="mono">{m.memberId}</span> → {m.implementationRef} <span className="muted">조건 {m.conditionProfileRef} · 수량 {m.quantity}</span>
                    </div>
                  ))}
                  {strayItems.map(i => (
                    <div key={i.id} className="small" style={{ marginLeft: 12, color: 'var(--fail)' }}>└ 기준선 밖 Item <span className="mono">{i.id}</span> ({BOM_AREA_KO[i.area]})</div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 380px' }}>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <b>A02 구성원 구현 참조 검사</b>
            <span className="mono small muted">hash {SHORT(report?.hash || sel.contentHash, 16)} · {report?.checkedAt}</span>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => toast(`구성원 검사 ${report?.rows.filter(r => r.ok).length}/${report?.rows.length} 정합 · hash ${SHORT(report?.hash || '', 16)}`, report?.rows.every(r => r.ok) ? 'ok' : 'warn')}>검사 실행</button>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>구성원</th><th>구현 등록</th><th>Feature 정합</th><th>조건 Profile</th><th>미해석 영역</th></tr></thead>
              <tbody>
                {report?.rows.map((r, i) => (
                  <tr key={`${r.memberId}-${i}`}>
                    <td className="mono small">{r.memberId}</td>
                    <td className="small"><CheckIcon ok={r.implKnown} /></td>
                    <td className="small"><CheckIcon ok={r.featureMatches} /></td>
                    <td className="small"><CheckIcon ok={r.profileKnown} /></td>
                    <td className="small">{r.unresolvedAreas.length ? r.unresolvedAreas.join(' · ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted mt">
            동일 기준선 안에서 같은 FeatureVersion 에 구현이 둘 이상이면 UL-017 위반이다 —
            {' '}{selViolations.filter(v => v.code === 'MULTI_IMPLEMENTATION_MEMBER').length}건 검출.
          </p>
        </div>
      </div>
    </>
  );

  const implBoms = implementationBomsOf(sel);
  const itemIndex = new Map(sel.items.map(i => [i.id, i]));

  const renderS03 = () => (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>구현 구성과 11개 관리 영역</b>
          <span className="small muted">행은 관리 영역, 열은 구성원이다. 값은 구성원의 ImplementationBOM 에서 전개한 Item 이다.</span>
        </div>
        <Heatmap
          rows={BOM_AREAS.map(a => `${BOM_AREA_KO[a]}`)}
          cols={sel.members.map(m => m.memberId)}
          cell={(areaKo, memberId) => {
            const area = BOM_AREAS.find(a => BOM_AREA_KO[a] === areaKo);
            const m = sel.members.find(x => x.memberId === memberId);
            if (!area || !m) return { v: null };
            const it = itemIndex.get(memberItemId(m, area));
            if (!it) return { v: 0.12, label: '—', title: 'Item 없음' };
            if (it.valueRef === 'NOT_APPLICABLE') return { v: 0.25, label: 'N/A', title: '비해당' };
            const refs = it.valueRef ? it.valueRef.split(',').length : 0;
            return it.resolution === 'RESOLVED'
              ? { v: 0.65, label: `${refs}`, title: `정확 참조 ${refs}건` }
              : { v: 0.95, label: '미해석', title: it.valueRef };
          }}
          legend="진한 칸은 정확 참조 수, 옅은 칸은 비해당(NOT_APPLICABLE), 미해석 칸은 정확 버전이 해석되지 않아 승인을 차단한다."
        />
      </div>

      <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 440px' }}>
          <b>Item 과 해석 결과</b>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>영역</th><th>부모 FeatureVersion</th><th>값 참조</th><th>해석</th></tr></thead>
              <tbody>
                {sel.items.map(i => (
                  <tr key={i.id}>
                    <td className="small">{BOM_AREA_KO[i.area]}{BOM_REQUIRED_AREAS.includes(i.area) ? <span className="pill">필수</span> : null}</td>
                    <td className="mono small">{i.parentRef}</td>
                    <td className="mono small" style={{ wordBreak: 'break-all' }}>{i.valueRef}</td>
                    <td className="small" style={{ color: i.resolution === 'UNRESOLVED' ? 'var(--fail)' : 'var(--pass)' }}>{i.resolution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 440px' }}>
          <b>ImplementationBOM 정확 구성</b>
          <p className="small muted">구성원의 구현 참조가 이 표에 있어야 한다. 없는 참조는 IMPL_BOM_UNKNOWN 이다.</p>
          {implBoms.map(({ ref, bom }) => (
            <div key={ref} className="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span className="mono small">{ref}</span>
                {bom ? <span className="pill">{bom.sourceProfile}</span> : <span className="pill" style={{ color: 'var(--fail)', borderColor: 'var(--fail)' }}>미등록</span>}
                {bom?.predecessor ? <span className="small muted">이전 {bom.predecessor}</span> : null}
              </div>
              {bom ? (
                <>
                  <div className="small muted">대상 {bom.featureRef} · artifact 참조 {bom.artifactRefs.length}건</div>
                  <div className="table-wrap mt">
                    <table>
                      <thead><tr><th>영역</th><th>해당</th><th>참조</th><th>해석</th><th>출처</th><th>근거</th></tr></thead>
                      <tbody>
                        {bom.items.map(it => (
                          <tr key={it.area}>
                            <td className="small">{BOM_AREA_KO[it.area]}</td>
                            <td className="small">{it.presence === 'PRESENT' ? '해당' : '비해당'}</td>
                            <td className="mono small" style={{ wordBreak: 'break-all' }}>{it.refs.join(', ') || '—'}</td>
                            <td className="small" style={{ color: it.resolution === 'UNRESOLVED' ? 'var(--fail)' : 'inherit' }}>{it.resolution}</td>
                            <td className="small">{it.source}</td>
                            <td className="small">{it.basis}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : <p className="small" style={{ color: 'var(--fail)' }}>이 구현 참조는 등록되지 않았다 — 승인 전에 정확 버전을 연결해야 한다.</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="card mt">
        <b>A03 누락 항목과 승인 근거 연결 (artifact 단위)</b>
        <p className="small muted">참조된 artifact 를 원천 시스템·정확 버전·contentDigest 로 확인한다. 해석되지 않는 artifact 는 승인 차단이다.</p>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>Artifact</th><th>버전</th><th>종류</th><th>전달</th><th>원천</th><th>contentDigest</th><th>해석</th><th>이름</th></tr></thead>
            <tbody>
              {refArtifacts(sel).map(a => (
                <tr key={`${a.id}@${a.version}`}>
                  <td className="mono small">{a.id}</td><td className="mono small">{a.version}</td>
                  <td className="small">{a.artifactKind}</td><td className="small">{deliveryLabel[a.delivery] || a.delivery}</td>
                  <td className="small">{a.sourceRef.system} · {a.sourceRef.object}</td>
                  <td className="mono small">{SHORT(a.contentDigest, 16)}</td>
                  <td className="small" style={{ color: a.resolution === 'UNRESOLVED' ? 'var(--fail)' : 'var(--pass)' }}>{a.resolution}</td>
                  <td className="small">{a.name}</td>
                </tr>
              ))}
              {refArtifacts(sel).length === 0 ? <tr><td colSpan={8} className="small muted">이 기준선의 구현 참조에서 artifact 를 해석하지 못했다</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderS04 = () => (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>Master · Configured · Effective</b>
          <span className="small muted">세 표현은 계산 결과다 — 어느 view 에서도 원천 승인 데이터를 고치지 않는다.</span>
        </div>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.id} className="btn" onClick={() => { setPresetId(p.id); setCtx(p.ctx); }} style={presetId === p.id ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : undefined}>{p.ko}</button>
          ))}
        </div>
        <div className="row mt" style={{ gap: 10, flexWrap: 'wrap' }}>
          {CONDITION_AXES.map(axis => (
            <label key={axis} className="small">
              <span className="muted">{axis}</span>{' '}
              <select className="btn" value={ctx[axis] ?? ''} onChange={e => { setCtx({ ...ctx, [axis as ConditionAxis]: e.target.value || undefined }); setPresetId('MANUAL'); }}>
                <option value="">(미지정)</option>
                {[...new Set(BOM_CONDITION_PROFILES.map(r => r[axis]).concat(['ANY', 'UNKNOWN']))].filter(Boolean).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="card mt" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <OutcomeBadge outcome={profile.outcome} />
            <span className="small">{profile.reason}</span>
            <span style={{ flex: 1 }} />
            <span className="mono small muted">{profile.matched.join(' · ') || '일치 행 없음'}</span>
          </div>
          <div className="small muted mt">
            선택 구현: <span className="mono">{profile.implementationRef || '—'}</span>
            {profile.implementationRef && IMPL_BOM_INDEX.get(profile.implementationRef) ? ` · ${IMPL_BOM_INDEX.get(profile.implementationRef)!.sourceProfile} 구성` : ''}
          </div>
        </div>
      </div>

      <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {views.map(v => (
          <div key={v.kind} className="card" style={{ flex: '1 1 380px' }}>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <b>{BOM_VIEW_KO[v.kind]}</b>
              <span className="pill">조회 전용</span>
            </div>
            <p className="small muted">{v.note}</p>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>항목</th><th>승인 구성</th><th>{v.kind} 값</th><th>검토</th><th>영향</th></tr></thead>
                <tbody>
                  {v.rows.map(r => (
                    <tr key={`${v.kind}-${r.key}`}>
                      <td className="mono small">{r.key}<div className="muted">{r.label}</div></td>
                      <td className="mono small">{r.baselineValue}</td>
                      <td className="mono small" style={{ color: r.baselineValue !== r.viewValue ? REVIEW_COLOR[r.review] : 'inherit' }}>{r.viewValue}</td>
                      <td className="small" style={{ color: REVIEW_COLOR[r.review] }}>{REVIEW_KO[r.review]}</td>
                      <td className="small">{r.impact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="card mt">
        <b>Effective 관측 입력 (제어 계약)</b>
        <p className="small muted">관측값은 실행 권한이 아니다. 쓰기는 Guard 확인 후 요청한다. 미보고는 미보고로 남기고 임의 기본값을 만들지 않는다.</p>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>제어점</th><th>종류</th><th>역할</th><th>접근</th><th>Guard</th><th>관측값</th><th>조작</th></tr></thead>
            <tbody>
              {refControlPointIds(sel).map(id => {
                const cp = CP_INDEX.get(id);
                if (!cp) return <tr key={id}><td className="mono small">{id}</td><td colSpan={6} className="small" style={{ color: 'var(--fail)' }}>제어점 정의 없음</td></tr>;
                const has = Object.prototype.hasOwnProperty.call(obs, cp.id);
                return (
                  <tr key={cp.id}>
                    <td className="mono small">{cp.id}</td>
                    <td className="small">{kindLabel[cp.kind]}</td>
                    <td className="small">{cp.role}</td>
                    <td className="small">{cp.accessMode === 'WRITE_GATED' ? '쓰기 gated' : '읽기 전용'}</td>
                    <td className="mono small">{cp.guardRef || '—'}</td>
                    <td className="mono small">{has ? String(obs[cp.id]) : <span className="muted">미보고</span>}</td>
                    <td className="small">
                      <button className="btn" onClick={() => setObs({ ...obs, [cp.id]: typeof cp.observedValue === 'boolean' ? !obs[cp.id] : String(obs[cp.id] ?? cp.observedValue ?? 'ON') })}>수신</button>{' '}
                      <button className="btn" onClick={() => { const n = { ...obs }; delete n[cp.id]; setObs(n); }}>미보고</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted mt">
          값 변경은 정본 소유 화면에서 한다 — <Link to="/master/define">Feature 등록 (UI02)</Link> · <Link to="/master/control-points">Feature 제어점</Link>
        </p>
      </div>
    </>
  );

  const renderS05 = () => (
    <>
      <div className="card">
        <b>조건 행과 구현 선택 판정</b>
        <p className="small muted">한 행 안의 조건은 AND, 행 사이는 OR 다. 교차곱으로 전개하지 않고 UNKNOWN 을 임의로 확정하지 않는다.</p>
        <div className="table-wrap mt">
          <table>
            <thead>
              <tr>
                <th>행</th>{CONDITION_AXES.map(a => <th key={a}>{a}</th>)}<th>구현 참조</th><th>확인 상태</th>
                <th>현재 문맥 판정</th><th>행 단독 판정</th>
              </tr>
            </thead>
            <tbody>
              {BOM_CONDITION_PROFILES.map(row => {
                const ref = `${row.id}@${row.version}`;
                const single = evaluateProfiles(ctx, [row]);
                const conflict = selViolations.some(v => v.code === 'CONFIG_CONFLICT' && v.target.includes(ref));
                const unknown = CONDITION_AXES.some(a => row[a] === 'UNKNOWN');
                const st = conflict ? '조건 충돌' : unknown ? '확인 보류' : '확정';
                const stColor = conflict ? 'var(--fail)' : unknown ? 'var(--pending)' : 'var(--pass)';
                return (
                  <tr key={ref}>
                    <td className="mono small">{row.id}<div className="muted">@{row.version}</div></td>
                    {CONDITION_AXES.map(a => <td key={a} className="mono small" style={{ color: row[a] === 'UNKNOWN' ? 'var(--pending)' : row[a] === 'ANY' || row[a] === 'NOT_APPLICABLE' ? 'var(--muted)' : 'inherit' }}>{row[a]}</td>)}
                    <td className="mono small">{row.implementationRef}{!IMPL_BOM_INDEX.has(row.implementationRef) ? <span className="pill" style={{ color: 'var(--fail)', borderColor: 'var(--fail)' }}>미등록</span> : null}</td>
                    <td className="small" style={{ color: stColor }}>{st}</td>
                    <td className="small">{single.matched.includes(ref) ? <span style={{ color: OUTCOME_COLOR[single.outcome] }}>{PROFILE_OUTCOME_KO[single.outcome]}</span> : <span className="muted">조건 불일치</span>}</td>
                    <td className="small" style={{ color: OUTCOME_COLOR[single.outcome] }}>{PROFILE_OUTCOME_KO[single.outcome]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>A01·A02·A03 검증 결과</b>
          <span className="small muted">국가·차종·Trim·Variant 조건 · 의존 충돌·유효기간 · 상품 사용처와 변경 영향</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => { setCtx(PRESETS[0].ctx); setPresetId(PRESETS[0].id); }}>조건 초기화</button>
          <button className="btn primary" onClick={() => toast(`${sel.id}@${sel.version} 검증 — 차단 ${selViolations.filter(v => v.blocking).length}건 · 관계 미검증 ${(nodes?.unmapped || []).length}건`, selViolations.some(v => v.blocking) ? 'warn' : 'ok')}>A01~A03 검증 실행</button>
        </div>
        <div className="kv mt">
          <div>조건 판정</div><div className="small">{PROFILE_OUTCOME_KO[profile.outcome]} — {profile.reason}</div>
          <div>노드 대조</div>
          <div className="small">
            기준선 구성원 {nodes?.memberFeatures.length}개 · Topology 노드 {sel.topologyNodes.length}개 ·
            누락 {nodes?.missing.length || 0} · 초과 {nodes?.extra.length || 0}
            {nodes?.missing.length ? <span style={{ color: 'var(--fail)' }}> (구성원에 없는 노드 {nodes.missing.join(', ')})</span> : null}
            {nodes?.extra.length ? <span style={{ color: 'var(--fail)' }}> (Topology 에 없는 구성원 {nodes.extra.join(', ')})</span> : null}
          </div>
          <div>15 관계 어휘</div>
          <div className="small">그래프 연결 {nodes?.edges.length || 0}건 중 어휘 {nodes?.mapped.length || 0}건 · 미검증 {nodes?.unmapped.length || 0}건</div>
        </div>

        <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px' }}>
            <div className="small muted">기준선 노드에 걸린 실제 그래프 연결</div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>연결</th><th>관계</th><th>정의 방향</th><th>기준선 경계</th><th>판정</th></tr></thead>
                <tbody>
                  {(nodes?.edges || []).map(e => (
                    <tr key={e.id}>
                      <td className="mono small">{e.source} → {e.target}</td>
                      <td className="mono small">{e.type}<div className="muted">{RELATION_DIR[e.type]?.ko || '어휘 밖'}</div></td>
                      <td className="small">{RELATION_DIR[e.type]?.dir || '—'}</td>
                      <td className="small">{e.inside ? '기준선 내부' : '기준선 밖 참조'}</td>
                      <td className="small" style={{ color: e.mapped && e.directionOk ? 'var(--pass)' : 'var(--fail)' }}>
                        {e.mapped ? (e.directionOk ? '관계·방향 유효' : '방향 위반') : '어휘 미검증'}
                      </td>
                    </tr>
                  ))}
                  {(nodes?.edges || []).length === 0 ? <tr><td colSpan={5} className="small muted">기준선 노드에 연결된 그래프 edge/relation 이 없다</td></tr> : null}
                </tbody>
              </table>
            </div>
            <p className="small muted mt">관계 그래프는 <Link to="/arch/topology">Topology 동작 메커니즘</Link> 화면에서 같은 데이터로 진행된다.</p>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <div className="small muted">기준 15 관계 어휘</div>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>관계</th><th>의미</th><th>이 기준선</th></tr></thead>
                <tbody>
                  {SPEC_TOPOLOGY_RELATIONS.map(r => {
                    const used = (nodes?.edges || []).some(e => e.type === r);
                    return <tr key={r}><td className="mono small">{r}</td><td className="small">{RELATION_DIR[r]?.ko || '—'}</td><td className="small" style={{ color: used ? 'var(--pass)' : 'var(--muted)' }}>{used ? '사용' : '—'}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt">
        <b>기준선 위반 {selViolations.length}건 (차단 {selViolations.filter(v => v.blocking).length}건)</b>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>코드</th><th>대상</th><th>내용</th><th>차단</th></tr></thead>
            <tbody>
              {selViolations.map((v, i) => (
                <tr key={`${v.code}-${v.target}-${i}`}>
                  <td className="mono small">{v.code}</td><td className="mono small">{v.target}</td><td className="small">{v.detail}</td>
                  <td className="small" style={{ color: v.blocking ? 'var(--fail)' : 'var(--muted)' }}>{v.blocking ? '차단' : '경고'}</td>
                </tr>
              ))}
              {selViolations.length === 0 ? <tr><td colSpan={4} className="small" style={{ color: 'var(--pass)' }}>위반 없음</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt">
          <Bars data={Object.fromEntries([...new Set(violations.map(v => v.code))].map(c => [c, violations.filter(v => v.code === c).length]))} />
        </div>
      </div>
    </>
  );

  const renderS06 = () => (
    <>
      <div className="card mt">
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b>승인 순서 — 정본 §2.4</b>
          <span className="small muted">참조 해결 → Item 정합·hash 고정 → 검증 결과 결속 → 독립 승인·재평가</span>
          <span style={{ flex: 1 }} />
          <span className="small">{approval.filter(s => s.ok).length}/{approval.length} 단계 충족</span>
        </div>
        <div className="steps" data-testid="bom-approval-rail">
          {approval.map((s, i) => (
            <div key={s.no} className={`step ${s.ok ? 'done' : 'fail'}`} data-step={s.no} data-ok={s.ok}>
              <span className="dot">{s.ok ? '✓' : s.no}</span>
              <span className="lbl">{s.ko}</span>
              {i < approval.length - 1 && <span className="bar" />}
            </div>
          ))}
        </div>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>순서</th><th>단계</th><th>확인 항목</th><th>상태</th></tr></thead>
            <tbody>
              {approval.map(s => (
                <tr key={s.no} data-step={s.no} data-ok={s.ok}>
                  <td className="mono small">{s.no}</td>
                  <td className="small">{s.ko}<div className="muted">{s.what}</div></td>
                  <td className="small">{s.rows.map(r => r.label).join(' · ')}</td>
                  <td className="small" style={{ color: s.ok ? 'inherit' : 'var(--fail)' }}>
                    {s.ok ? '충족' : `미충족 — ${s.failed.map(r => r.label).join(' · ')}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted mt" data-testid="bom-approval-noncircular">{BOM_APPROVAL_NON_CIRCULAR}</p>
      </div>

      <div className="row mt" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 420px' }}>
          <b>승인 전 검사 ({check.filter(c => c.ok).length}/{check.length} 통과)</b>
          <div className="table-wrap mt" data-testid="bom-approval-checks">
            <table>
              <thead><tr><th></th><th>순서</th><th>검사</th><th>근거</th></tr></thead>
              <tbody>
                {check.map(c => (
                  <tr key={c.key}>
                    <td className="small"><CheckIcon ok={c.ok} /></td>
                    <td className="mono small">{stepOf.get(c.key) ?? '—'}</td>
                    <td className="small">{c.label}</td>
                    <td className="small" style={{ color: c.ok ? 'inherit' : 'var(--fail)' }}>{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 420px' }}>
          <b>업무 명령 실행</b>
          <p className="small muted">상태는 직접 바꾸지 않는다. 명령 전이로만 진행하고, 접수와 업무 완료를 구분한다.</p>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="btn" value={actor} onChange={e => setActor(e.target.value)}>
              {ACTORS.map(a => <option key={a.id} value={a.id}>{a.ko}</option>)}
            </select>
            <input className="btn" style={{ flex: 1, minWidth: 180 }} placeholder="사유 (REQUEST_CHANGES 는 필수)" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            {ACTIONS.map(a => {
              const allowed = SPEC_CMD[a].from.split(' · ').includes(sel.state);
              return (
                <button
                  key={a}
                  className={a === 'approve' ? 'btn primary' : a === 'requestChanges' ? 'btn danger' : 'btn'}
                  disabled={!allowed}
                  title={allowed ? `${SPEC_CMD[a].cmd} · ${SPEC_CMD[a].role}` : `${BASELINE_STATE_KO[sel.state]} 에서는 ${SPEC_CMD[a].cmd} 을 할 수 없다`}
                  onClick={() => runTransition(a)}
                >
                  {SPEC_CMD[a].cmd}
                </button>
              );
            })}
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>업무 명령</th><th>역할</th><th>전이</th><th>조건</th></tr></thead>
              <tbody>
                {ACTIONS.map(a => (
                  <tr key={a}>
                    <td className="mono small">{SPEC_CMD[a].cmd}<div className="muted">{BASELINE_ACTION_KO[a]}</div></td>
                    <td className="small">{SPEC_CMD[a].role}</td>
                    <td className="small">{SPEC_CMD[a].from} → {SPEC_CMD[a].to}</td>
                    <td className="small">{SPEC_CMD[a].note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result ? (
            <div className="card mt" style={{ borderColor: result.ok ? 'var(--pass)' : 'var(--fail)' }}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <b style={{ color: result.ok ? 'var(--pass)' : 'var(--fail)' }}>HTTP {result.http}</b>
                {result.code ? <span className="pill" style={{ color: 'var(--fail)', borderColor: 'var(--fail)' }}>{result.code}</span> : null}
                <span className="small">{result.message}</span>
              </div>
              {result.approval ? (
                <div className="kv mt">
                  <div>승인자</div><div className="small">{result.approval.actor} ({result.approval.role}) · {result.approval.at}</div>
                  <div>승인 hash</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{result.approval.contentHashRef}</div>
                  <div>사유</div><div className="small">{result.approval.reason}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card mt">
        <b>기준선 이력</b>
        <div className="table-wrap mt">
          <table>
            <thead><tr><th>시각</th><th>주체</th><th>명령</th><th>전이</th><th>HTTP</th><th>내용</th></tr></thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={`log-${i}`}>
                  <td className="mono small">{l.ts}</td><td className="small">{l.actor}</td><td className="mono small">{l.cmd}</td>
                  <td className="small">{BASELINE_STATE_KO[l.from]} → {BASELINE_STATE_KO[l.to]}</td>
                  <td className="small">{l.http}{l.code ? ` ${l.code}` : ''}</td><td className="small">{l.message}</td>
                </tr>
              ))}
              {log.length === 0 ? (
                <>
                  <tr><td className="mono small">—</td><td className="small">{sel.author}</td><td className="mono small">CREATE_DRAFT</td><td className="small">— → {BASELINE_STATE_KO.DRAFT}</td><td className="small">201</td><td className="small">{sel.changeReason || '기준선 작성'}</td></tr>
                  {sel.approval ? <tr><td className="mono small">{sel.approval.at}</td><td className="small">{sel.approval.actor}</td><td className="mono small">APPROVE</td><td className="small">{BASELINE_STATE_KO.IN_REVIEW} → {BASELINE_STATE_KO.APPROVED}</td><td className="small">202{sel.approval.contentHashRef !== sel.contentHash ? ' · hash 불일치' : ''}</td><td className="small">{sel.approval.reason}</td></tr> : null}
                  {sel.revokedAt ? <tr><td className="mono small">{sel.revokedAt}</td><td className="small">—</td><td className="mono small">REVOKE_BASELINE</td><td className="small">{BASELINE_STATE_KO.APPROVED} → {BASELINE_STATE_KO.REVOKED}</td><td className="small">202</td><td className="small">{sel.revokedReason}</td></tr> : null}
                </>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="small muted mt">이 화면의 조작은 저장소에 영속되고 다시 열어도 유지된다(BOM_SAVE). 서버 연계는 LOCAL_UI_ONLY 다.</p>
      </div>
    </>
  );

  return (
    <>
      <Breadcrumb />
      <h1 className="page-title">Feature BOM 기준선 <span className="pill">UI04</span> <span className="pill">C03</span></h1>
      <p className="small muted">
        승인 대상 Feature 버전 집합과 선택 구현 참조를 고정한 상위 구성 기준선이다. contentHash(SHA-256)가 승인·검증·증적을 결속하고,
        Approval 은 작성자와 다른 주체가 현재 hash 에 대해 남긴다. Master·Configured·Effective 는 파생 표현이며 원천 승인 데이터로 되쓰지 않는다.
      </p>

      <div className="kpis mt">
        <div className="kpi"><div className="v">{stats.total}</div><div className="l">기준선</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pass)' }}>{stats.approved}</div><div className="l">승인</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--pending)' }}>{stats.inReview}</div><div className="l">검토 중</div></div>
        <div className="kpi"><div className="v">{stats.draft}</div><div className="l">작성 중</div></div>
        <div className="kpi"><div className="v" style={{ color: stats.blocking ? 'var(--fail)' : 'inherit' }}>{stats.blocking}</div><div className="l">차단 위반</div></div>
        <div className="kpi"><div className="v">{stats.members}</div><div className="l">구성원</div></div>
        <div className="kpi"><div className="v">{stats.items}</div><div className="l">Item · {stats.areas}개 영역</div></div>
        <div className="kpi"><div className="v">{stats.hashVerified}</div><div className="l">hash 결속 승인</div></div>
        <div className="kpi"><div className="v" style={{ color: stats.hashMismatch ? 'var(--fail)' : 'inherit' }}>{stats.hashMismatch}</div><div className="l">승인 hash 불일치</div></div>
        <div className="kpi"><div className="v">{stats.independentApproval}</div><div className="l">독립 승인</div></div>
      </div>

      <div className="card mt">
        <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="small muted">기준선 선택</span>
          <select className="btn" value={selKey} onChange={e => setSelKey(e.target.value)}>
            {baselines.map(b => <option key={`${b.id}@${b.version}`} value={`${b.id}@${b.version}`}>{b.id}@{b.version} · {BASELINE_STATE_KO[b.state]}</option>)}
          </select>
          <StateBadge state={sel.state} />
          <span className="mono small muted">{sel.memberSetRef}</span>
          <span style={{ flex: 1 }} />
          <span className="small muted">구현 선택 판정</span>
          <OutcomeBadge outcome={profile.outcome} />
        </div>
      </div>

      <div className="tabs mt">
        {tabs.map(t => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} title={t.type}>
            {t.id} {t.name}
          </button>
        ))}
      </div>

      {tab === 'UI04-S01' ? renderS01() : null}
      {tab === 'UI04-S02' ? renderS02() : null}
      {tab === 'UI04-S03' ? renderS03() : null}
      {tab === 'UI04-S04' ? renderS04() : null}
      {tab === 'UI04-S05' ? renderS05() : null}
      {tab === 'UI04-S06' ? renderS06() : null}
    </>
  );
}

// ── 파생 계산 ─────────────────────────────────────────────

/** 기준선 Item 이 참조하는 artifact 를 정확 버전으로 해석한다. */
function refArtifacts(b: BomBaseline): ArtifactRecord[] {
  const refs = new Set<string>();
  b.members.forEach(m => (IMPL_BOM_INDEX.get(m.implementationRef)?.artifactRefs || []).forEach(r => refs.add(r)));
  return [...refs].map(r => ART_INDEX.get(r)).filter((a): a is ArtifactRecord => !!a);
}

/** 기준선의 Control·Operations 영역이 참조하는 제어점 ID — Effective 관측 입력 대상. */
function refControlPointIds(b: BomBaseline): string[] {
  const ids = new Set<string>();
  b.members.forEach(m => {
    const bom = IMPL_BOM_INDEX.get(m.implementationRef);
    bom?.items.filter(i => i.area === 'Control' || i.area === 'Operations').forEach(i => i.refs.forEach(r => { if (CP_INDEX.has(r)) ids.add(r); }));
  });
  return [...ids];
}

/** 기준선 구성원 노드와 실제 그래프 연결을 15 관계 어휘로 대조한다. */
function baselineNodeJoin(b: BomBaseline, edges: GraphLink[], relations: GraphLink[]) {
  const memberFeatures = [...new Set(b.members.map(m => m.featureVersionRef))];
  const membersBase = new Set(memberFeatures.map(baseIdOf));
  const topoBase = new Set(b.topologyNodes.map(baseIdOf));
  const missing = b.topologyNodes.filter(n => !membersBase.has(baseIdOf(n)));
  const extra = memberFeatures.filter(n => !topoBase.has(baseIdOf(n)));

  const all = new Set([...membersBase, ...topoBase]);
  const out: { id: string; source: string; target: string; type: string; inside: boolean; mapped: boolean; directionOk: boolean }[] = [];
  const seen = new Set<string>();
  const push = (id: string, source: string, target: string, type: string) => {
    if (!all.has(baseIdOf(source)) && !all.has(baseIdOf(target))) return;
    const key = `${source}|${type}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    const inside = membersBase.has(baseIdOf(source)) && membersBase.has(baseIdOf(target));
    const mapped = SPEC_TOPOLOGY_RELATIONS.includes(type);
    const dir = RELATION_DIR[type]?.dir || '';
    const directionOk = !mapped || dir === '방향 없음' || dir.startsWith('source=Feature')
      ? mapped
      : dir.startsWith('source=상위') ? source.startsWith('FEAT-')
        : true;
    out.push({ id, source, target, type, inside, mapped, directionOk });
  };
  edges.forEach(e => push(e.id, e.source, e.target, e.type));
  relations.forEach(r => push(r.id, r.source, r.target, r.type));

  return {
    memberFeatures, missing, extra, edges: out,
    mapped: out.filter(e => e.mapped), unmapped: out.filter(e => !e.mapped),
  };
}

/** 승인 전 검사 — 문장이 아니라 필드에서 계산한다. */
function approvalChecklist(b: BomBaseline, violations: BomViolation[], nodes: ReturnType<typeof baselineNodeJoin>) {
  const report = memberCheckReport(b);
  const bad = report.rows.filter(r => !r.ok);
  const unresolved = b.items.filter(i => i.resolution === 'UNRESOLVED');
  const missingRequired = BOM_REQUIRED_AREAS.filter(a => !b.items.some(i => i.area === a && i.valueRef !== 'NOT_APPLICABLE' && i.valueRef !== '—'));
  const blocking = violations.filter(v => v.blocking);
  const conflict = violations.filter(v => v.code === 'CONFIG_CONFLICT');
  const stray = violations.filter(v => v.code === 'MEMBER_OUTSIDE_BASELINE');
  const assessmentCurrent = !!b.assessmentRef && (b.assessmentRef.hashRef === 'CURRENT' || b.assessmentRef.hashRef === b.contentHash);
  const hashOk = bomContentHash(b) === b.contentHash;
  const approvalHashOk = !b.approval || b.approval.contentHashRef === b.contentHash;
  const independent = !b.approval || b.approval.actor !== b.author;
  const nodesMatch = nodes.missing.length === 0 && nodes.extra.length === 0;

  return [
    { key: 'members', label: '구성원 전원 해석', ok: bad.length === 0, detail: bad.length ? bad.map(r => r.memberId).join(' · ') : `구성원 ${b.members.length}건 정합` },
    { key: 'required', label: '필수 영역 해당', ok: missingRequired.length === 0, detail: missingRequired.length ? `누락 영역 ${missingRequired.join(', ')}` : `필수 ${BOM_REQUIRED_AREAS.join(', ')} 해당` },
    { key: 'items', label: 'Item 해석 완료', ok: unresolved.length === 0, detail: unresolved.length ? `미해석 ${unresolved.length}건 — ${[...new Set(unresolved.map(i => BOM_AREA_KO[i.area]))].join(', ')}` : `Item ${b.items.length}건 해석` },
    { key: 'stray', label: '기준선 밖 참조 없음', ok: stray.length === 0, detail: stray.length ? stray.map(v => v.target).join(' · ') : '모든 Item 부모가 이 기준선 구성원' },
    { key: 'conflict', label: '조건 충돌 없음', ok: conflict.length === 0, detail: conflict.length ? conflict.map(v => v.target).join(' · ') : '조건 판정 ' + PROFILE_OUTCOME_KO[evaluateProfiles(PRESETS[0].ctx).outcome] },
    { key: 'topology', label: 'Topology 노드 일치', ok: nodesMatch, detail: nodesMatch ? `${b.topologyRef} 노드 ${b.topologyNodes.length}개 일치` : `누락 ${nodes.missing.join(', ') || '—'} · 초과 ${nodes.extra.join(', ') || '—'}` },
    { key: 'hash', label: 'contentHash 재계산 일치', ok: hashOk, detail: hashOk ? SHORT(b.contentHash, 24) : `재계산 ${SHORT(bomContentHash(b), 24)} 불일치` },
    { key: 'approvalHash', label: '승인 기록 hash 결속', ok: approvalHashOk, detail: b.approval ? (approvalHashOk ? `승인 시점 hash 와 현재 내용 일치` : `승인 ${SHORT(b.approval.contentHashRef, 16)} ≠ 현재 ${SHORT(b.contentHash, 16)}`) : '승인 기록 없음(최초 승인 시 생성)' },
    { key: 'assessment', label: '현재 hash 의 검증 결과', ok: assessmentCurrent && b.assessmentRef?.result !== 'FAIL', detail: b.assessmentRef ? `${b.assessmentRef.id} · ${b.assessmentRef.result} · hash ${b.assessmentRef.hashRef}` : '검증 결과 없음 — 승인 시 412' },
    { key: 'independent', label: '독립 승인 가능', ok: independent, detail: b.approval ? `${b.approval.actor} vs 작성자 ${b.author}` : `작성자 ${b.author} 와 다른 주체가 승인` },
    { key: 'blocking', label: '차단 위반 0건', ok: blocking.length === 0, detail: blocking.length ? blocking.map(v => `${v.code}(${v.target})`).join(' · ') : '차단 위반 없음' },
  ];
}

/** 기준선 두 개의 구성 차이 — A03 승인 버전과 차이 비교. */
function baselineDiff(from: BomBaseline, to: BomBaseline) {
  const keyOf = (m: BaselineMember) => m.memberId;
  const fromById = new Map(from.members.map(m => [keyOf(m), m]));
  const toById = new Map(to.members.map(m => [keyOf(m), m]));
  const membersAdded = to.members.filter(m => !fromById.has(keyOf(m)));
  const membersRemoved = from.members.filter(m => !toById.has(keyOf(m)));
  const membersChanged = to.members.flatMap(m => {
    const f = fromById.get(keyOf(m));
    if (!f) return [];
    const before = `${f.implementationRef} · ${f.conditionProfileRef} · 수량 ${f.quantity}`;
    const after = `${m.implementationRef} · ${m.conditionProfileRef} · 수량 ${m.quantity}`;
    return before === after ? [] : [{ memberId: m.memberId, before, after }];
  });
  const fromItems = new Map(from.items.map(i => [i.id, i]));
  const itemsChanged = to.items.flatMap(i => {
    const f = fromItems.get(i.id);
    if (!f) return [{ id: i.id, area: i.area, before: '—', after: `${i.valueRef} (${i.resolution})` }];
    return f.valueRef === i.valueRef && f.resolution === i.resolution ? [] : [{ id: i.id, area: i.area, before: `${f.valueRef} (${f.resolution})`, after: `${i.valueRef} (${i.resolution})` }];
  });
  return { hashSame: from.contentHash === to.contentHash, membersAdded, membersRemoved, membersChanged, itemsChanged };
}

// Feature 등록 — 화면 UI02 Feature Registry · 기준 FP-DETAILED-1.1 / FP-UI-MENU-1.3 / C01-R01~R19
//
// 이 화면은 기준의 7개 상세 영역(UI02-S01~S07)을 그대로 노출한다. 등록 속성 196개(FRI 184 + OPA 12)는
// 입력 책임에 따라 직접 입력(EDITABLE) / 정확 참조(REFERENCE) / 자동·파생(DERIVED) 으로 구분되며
// 화면에서 값을 타이핑하는 항목은 직접 입력뿐이다(IA-R04 · IA-R13). 업무 상태는 직접 수정하지 않고
// 기준 워크플로 전이(WF-DRAFT · WF-SUBMIT · WF-APPROVE · WF-RETURN · WF-REVISE · WF-RETIRE)로만
// 진행하고, 동시성은 If-Match(ETag) + Idempotency-Key 로 제어한다(IA-R01 · R06 · R07 · R10).
// 검토 요청 이후 승인 원본의 hash 가 바뀌면 승인 효력이 사라지고 새 버전·재검토로 분기한다.
// 제품 서버는 미연결(LOCAL_UI_ONLY)이며 리비전 레지스트리는 브라우저에 영속된다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bars, Donut, RadialProgress, Steps, tally } from '../components/charts';
import { EmptyState } from '../components/patterns';
import { SpecAreaFacts } from '../components/SpecAreaFacts';
import { RegistrationReviewPanel } from '../components/registrationReview';
import { SPEC_C01_SECTIONS, SPEC_CLOSURE } from '../data/specArch';
import { SPEC_FRI_SCOPE, SPEC_P0_BASELINE, SPEC_REGISTRY_CONTRACT, SPEC_RULES } from '../data/specNav';
import { SPEC_FRI_GROUP_TOTAL } from '../data/specFri';
import {
  SPEC_REG_APPROVAL, SPEC_REG_AREA_ATTRS, SPEC_REG_AREA_ATTR_COUNTS, SPEC_REG_AREAS, SPEC_REG_ATTRS,
  SPEC_REG_R0_REQUIRED, SPEC_REG_SCREEN,
} from '../data/specRegistration';
import {
  ARTIFACT_RECORDS, CONTROL_POINTS, FLAG_BINDINGS, IMPLEMENTATION_BOMS, RUNTIME_BINDINGS, VIOLATIONS,
  kindLabel, roleLabel as cpRoleLabel,
} from '../data/implementation';
import {
  DEFINITION_STATES, STATE_FIELD, UI02_S01_RULES, actionsFor, applyTransition, contentHash, etagOf, nextFeatureId,
  payloadHash, registrationIssues, specError,
  type RevisionRecord, type SpecError, type TransitionContext, type UnresolvedItem,
} from '../data/revision';
import { type SpecRegAction, type SpecRegArea, type SpecRegAttr } from '../data/specTypes';
import { useApp, useAppShell } from '../store';
import { roleLabel, roleKeyOf } from '../data/refdata';

const ATTRS = SPEC_REG_ATTRS as Record<string, SpecRegAttr>;
const AREA_IDS = SPEC_REG_AREAS.map(a => a.id);
const ATTR_TOTAL = Object.keys(ATTRS).length;
const attrOf = (id: string) => ATTRS[id];
const areaOf = (id: string) => SPEC_REG_AREAS.find(a => a.id === id)!;
const rowIdsOf = (areaId: string) => SPEC_REG_AREA_ATTRS[areaId] ?? [];
const countsOf = (areaId: string) => SPEC_REG_AREA_ATTR_COUNTS[areaId];

/** 입력 책임 — 화면이 값을 받는지, 정확 참조를 고르는지, 서버가 계산하는지. */
const RESP_KO: Record<string, string> = { EDITABLE: '직접 입력', REFERENCE: '정확 참조', DERIVED: '자동·파생' };
const RESP_COLOR: Record<string, string> = { EDITABLE: '#0B5FFF', REFERENCE: '#D9822B', DERIVED: '#8895A7' };

const STATE_COLOR: Record<string, string> = {
  DRAFT: '#8895A7', IN_REVIEW: '#D9822B', CHANGES_REQUESTED: '#B45309', APPROVED: '#1F9D55', RETIRED: '#6B7280',
};

/** 워크플로 전이를 실행하는 기준 액션 — 없으면 WORKFLOW 가드만 적용한다. */
const WF_SPEC_ACTION: Record<string, string | null> = {
  'WF-DRAFT': 'UI02-S01-A01',
  'WF-SUBMIT': 'UI02-S07-A03',
  'WF-RETURN': 'UI02-S07-A03',
  'WF-REVISE': 'UI28-S04-A02',
  'WF-APPROVE': 'UI06-S04-A03',
  'WF-RETIRE': null,
};

/** 등록 단계(R0~R4) — C01-R04 표를 그대로 쓰고, 현재 업무 상태가 어느 단계인지 표시한다. */
const STAGE_ROWS: string[][] = (() => {
  const t = SPEC_C01_SECTIONS.find(s => s.id === 'C01-R04')?.blocks.find(b => b.kind === 'table') as
    | { kind: 'table'; rows: string[][] }
    | undefined;
  return t ? t.rows.slice(1) : [];
})();
const STAGE_OF_STATE: Record<string, number> = {
  DRAFT: 0, CHANGES_REQUESTED: 1, IN_REVIEW: 1, APPROVED: 2, RETIRED: 4,
};

const ALL_ACTIONS: { area: SpecRegArea; act: SpecRegAction }[] = [
  ...SPEC_REG_AREAS.map(a => a.actions.map(act => ({ area: a, act }))).flat(),
  ...SPEC_REG_APPROVAL.map(a => a.actions.map(act => ({ area: a, act }))).flat(),
];
const actionOf = (id: string) => ALL_ACTIONS.find(x => x.act.id === id);

/** R0 최초 초안 필수 후보 20개 중 실제로 사람이 채우는 항목과 서버가 만드는 항목을 나눈다(IA-R04). */
const R0_REQUIRED_INPUT = SPEC_REG_R0_REQUIRED.filter(id => attrOf(id) && attrOf(id).responsibility !== 'DERIVED');
const R0_REQUIRED_AUTO = SPEC_REG_R0_REQUIRED.filter(id => !attrOf(id) || attrOf(id).responsibility === 'DERIVED');
const labelOf = (id: string) => attrOf(id)?.label || id;

/** 합성 예제 값 — 원천 사전 미연결 데모이므로 참조 유형별 예시 ID 를 쓴다(SYNTHETIC). */
const SAMPLE: Record<string, string> = {
  'FRI-004': 'SCOPE-KR-PROGRAM', 'FRI-024': 'ROLE-BODY-PLATFORM-OWNER', 'FRI-025': 'ORG-BODY-PLATFORM',
  'FRI-028': 'BODY', 'FRI-029': 'TAXO-BODY-2027#L2', 'FRI-032': 'CUSTOMER', 'FRI-034': 'POL-ACCESS-P1',
  'FRI-037': 'REQ-SYNTH-0171', 'FRI-038': 'REQ-SYNTH-0171@3', 'FRI-043': 'SRC-REQ-0171', 'FRI-045': 'alm://req/0171',
  'FRI-048': 'sha256:7c1f…', 'FRI-049': 'SRC-PROP-2026-04', 'FRI-054': 'PROFILE-KR-A-2027', 'FRI-055': 'STATE-CONFIRMED',
  'FRI-098': 'RELATION-REVIEW-OPEN', 'FRI-113': 'PLATFORM_MANAGED', 'FRI-120': '[0, 120]', 'FRI-129': 'SAFETY-RELATED',
  'FRI-134': 'SEC-NONE', 'FRI-169': 'R0 최초 초안 등록', 'FRI-173': 'INTERNAL_DEFINITION',
};
const sampleFor = (a: SpecRegAttr) => {
  if (SAMPLE[a.id]) return SAMPLE[a.id];
  if (a.type === 'Date') return '2026-10-15';
  if (a.type.startsWith('Text[]') || a.type.startsWith('LocaleText[]')) return 'KR-PROGRAM; BODY-PLATFORM';
  if (a.type === 'Text') return `${a.label} — 합성 예제`;
  return `SYNTH-${a.key}`;
};

/** 적용조건 행 — 행 안은 AND, 행 사이는 OR(C01-R04). 교차곱을 자동 생성하지 않는다. */
interface CondRow { id: string; nation: string; market: string; model: string; trim: string; variant: string; impl: string; review: string; note: string }
const CONDITION_SEED: CondRow[] = [
  { id: 'CR-1', nation: 'KR', market: 'KR', model: 'A / 2027', trim: 'Trim-P', variant: 'VC-KR-TRIMP', impl: 'IMPL-BDC-12', review: 'CONFIRMED', note: '' },
  { id: 'CR-2', nation: 'DE', market: 'DE', model: 'B / 2027', trim: 'Trim-S', variant: 'VC-DE-TRIMS', impl: 'IMPL-BDC-14', review: 'CONFIRMED', note: '' },
  { id: 'CR-3', nation: 'UNKNOWN', market: '—', model: '—', trim: '—', variant: '—', impl: '—', review: 'DEFERRED', note: '국가 확정 미정 — 법규 확인 후 결정' },
];
const CONDITION_COLORS: Record<string, string> = { CONFIRMED: '#1F9D55', DEFERRED: '#D9822B', REJECTED: '#D64545' };

const nowTs = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function StateChip({ state }: { state: string }) {
  return <span className="badge" style={{ background: STATE_COLOR[state] || '#6B7280' }}>{state}</span>;
}

function RequiredBadge({ value }: { value: string }) {
  const color: Record<string, string> = { 필수: '#D64545', 조건부: '#D9822B', 자동: '#8895A7', 선택: '#8895A7' };
  return <span className="pill" style={{ color: color[value] || 'inherit', borderColor: color[value] || 'var(--line)' }}>{value || '—'}</span>;
}

function RespBadge({ value }: { value: string }) {
  const c = RESP_COLOR[value] || '#6B7280';
  return <span className="pill" style={{ color: c, borderColor: c }}>{RESP_KO[value] || value}</span>;
}

export function DefineRevision() {
  const { state, dispatch } = useApp();
  const { role } = useAppShell();
  const roleKey = roleKeyOf(role);

  const [areaId, setAreaId] = useState(AREA_IDS[0]);
  const [sel, setSel] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [unresolved, setUnresolved] = useState<UnresolvedItem[]>([]);
  const [conditions, setConditions] = useState<CondRow[]>(CONDITION_SEED);
  const [reason, setReason] = useState('R0 최초 초안 등록');
  const [counterReason, setCounterReason] = useState('');
  const [counterOwner, setCounterOwner] = useState('');
  const [counterDue, setCounterDue] = useState('');
  const [ifMatch, setIfMatch] = useState(true);
  const [idemKey, setIdemKey] = useState(true);
  const [checkedRules, setCheckedRules] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState<ReturnType<typeof registrationIssues> | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<SpecError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rec, setRec] = useState<RevisionRecord>(() => {
    const id = nextFeatureId([...state.features.map(f => f.id), ...state.revisions.map(r => r.id)]);
    return {
      id, version: '1.0.0', recordRevision: 1, state: 'DRAFT', contentHash: contentHash(id),
      actor: roleKey, ts: nowTs(), scope: 'KR-PROGRAM', unresolved: [], history: [],
    };
  });

  const area = areaOf(areaId);
  const rows = rowIdsOf(areaId);
  const counts = countsOf(areaId);
  const key = `${rec.id}@${rec.version}`;
  const values = drafts[key] ?? {};
  const draftHash = useMemo(() => payloadHash(values), [values]);
  const locked = rec.state === 'IN_REVIEW' || rec.state === 'APPROVED' || rec.state === 'RETIRED';
  const bound = draftHash === rec.contentHash;
  const stage = STAGE_OF_STATE[rec.state] ?? 0;
  const commandId = `CMD-${contentHash(`${rec.id}@${rec.version}:${draftHash}`).slice(0, 8)}`;
  const idempotencyKey = idemKey ? `${commandId}-IK` : '(미포함)';
  const selected = sel ? attrOf(sel) : undefined;

  const setValue = (fid: string, v: string) =>
    setDrafts(d => ({ ...d, [key]: { ...(d[key] ?? {}), [fid]: v } }));

  const respTally = useMemo(
    () => tally(Object.values(ATTRS).map(a => a.responsibility), a => a),
    [],
  );
  const cpStats = useMemo(() => {
    const write = CONTROL_POINTS.filter(c => c.role === 'WRITE_REQUEST');
    return {
      total: CONTROL_POINTS.length,
      write: write.length,
      writeGuarded: write.filter(c => !!c.guardRef).length,
      observe: CONTROL_POINTS.filter(c => c.role === 'OBSERVE').length,
      blocking: VIOLATIONS.filter(v => v.blocking).length,
    };
  }, []);

  /** 기준 액션 권한 검사 — actions.roles 는 기준 9역할 키다. */
  const permitted = (act: SpecRegAction) => act.roles.includes(roleKey);

  const runAction = (wfId: string, act?: SpecRegAction, extra: Partial<TransitionContext> = {}) => {
    if (act && !permitted(act)) {
      setError(specError(403, `${act.id} ${act.label} 은 ${act.roles.map(roleLabel).join(' / ')} 담당이며 현재 역할 ${roleLabel(roleKey)} 로는 실행할 수 없습니다. 미허용 객체의 내용은 공개하지 않습니다.`));
      setNotice(null);
      return false;
    }
    const res = applyTransition(rec, wfId, {
      actor: roleKey, expectRevision: ifMatch ? rec.recordRevision : undefined,
      preconditionMissing: !ifMatch, reason, sameAuthor: roleKey === rec.actor, ...extra,
    });
    if (!res.ok) {
      setError(res.error!);
      setNotice(null);
      return false;
    }
    const binds = wfId === 'WF-DRAFT' || wfId === 'WF-SUBMIT' || wfId === 'WF-REVISE';
    const next: RevisionRecord = {
      ...rec, ...res.patch, actor: roleKey, ts: nowTs(),
      contentHash: binds ? draftHash : rec.contentHash,
    } as RevisionRecord;
    if (wfId === 'WF-DRAFT') next.unresolved = unresolved;
    if (wfId === 'WF-REVISE') setUnresolved(rec.unresolved);
    if (wfId === 'WF-REVISE' && next.version !== rec.version) {
      setDrafts(d => ({ ...d, [`${next.id}@${next.version}`]: { ...(d[key] ?? {}) } }));
    }
    setRec(next);
    dispatch({ t: 'REVISION_SAVE', r: next });
    setError(null);
    setNotice(`${next.id}@${next.version} · ${next.state} (rev ${next.recordRevision}) · ${act ? act.id : wfId} — 리비전 레지스트리에 저장했습니다.`);
    return true;
  };

  const validate = (act?: SpecRegAction) => {
    const r = registrationIssues(R0_REQUIRED_INPUT, values, unresolved, labelOf);
    setIssues(r);
    if (act) setCheckedRules(c => ({ ...c, [act.id]: true }));
    if (r.complete) {
      setError(null);
      setNotice(`완전성 검사 통과 — R0 입력 필수 ${R0_REQUIRED_INPUT.length}건 · 미정 항목 ${unresolved.length}건 해소 · findings 0건. 같은 hash 의 ValidationResult 를 반환하며 업무 상태는 바뀌지 않습니다.`);
    } else {
      setError(specError(422, '승인 요청(WF-SUBMIT)의 fieldErrors 로 그대로 이어집니다.', r.fieldErrors));
      setNotice(null);
    }
    return r;
  };

  const fillSample = () => {
    const filled: Record<string, string> = {};
    R0_REQUIRED_INPUT.forEach(id => { const a = attrOf(id); if (a) filled[id] = sampleFor(a); });
    setDrafts(d => ({ ...d, [key]: { ...(d[key] ?? {}), ...filled } }));
    setError(null);
    setNotice(`합성 예제 값 ${Object.keys(filled).length}건을 채웠습니다 (SYNTHETIC · 실제 원천 아님)`);
  };

  const approve = () => {
    if (!bound) {
      setError(specError(409, `입력값 hash ${draftHash} 가 승인 후보 hash ${rec.contentHash} 와 다릅니다. 승인 후보 변경은 이전 승인 효력을 제거하므로 새 검토가 필요합니다(IA-R06 · UI06-S05-A02).`));
      return;
    }
    const a = actionOf('UI06-S04-A03');
    runAction('WF-APPROVE', a?.act);
  };

  const loadRecord = (r: RevisionRecord) => {
    setRec(r);
    setUnresolved(r.unresolved);
    setIssues(null);
    setError(null);
    setSel(null);
    setNotice(`레지스트리에서 ${r.id}@${r.version} (${r.state}) 을 열었습니다. 승인 원본은 덮어쓰지 않고 새 Revision 으로 분기합니다.`);
  };

  /** 기준 액션 실행 — 접수(202)와 업무 완료를 구분한다(IA-R07). */
  const runSpecAction = (a: SpecRegArea, act: SpecRegAction) => {
    if (!permitted(act)) {
      setError(specError(403, `${act.id} ${act.label} 은 ${act.roles.map(roleLabel).join(' / ')} 담당이며 현재 역할 ${roleLabel(roleKey)} 로는 실행할 수 없습니다.`));
      setNotice(null);
      return;
    }
    if (act.type === 'inspect' || act.type === 'navigate') {
      setError(null);
      setReceipt(null);
      setNotice(`${act.id} ${act.label} · GET ${a.readApi.path || `/api/ui/v1/views/${a.id}`} → projection ${a.readApi.projection || 'FeatureVersion'} · ${rowIdsOf(a.id).length}행 · limit ${a.readApi.query?.limit || '1..100 default 25'}. 조회는 업무 상태를 바꾸지 않습니다.`);
      return;
    }
    if (act.intent === 'VALIDATE') {
      setReceipt(`${act.id} · 200 ValidationResult (state 변경 없음)`);
      validate(act);
      return;
    }
    if (act.intent === 'SAVE_DRAFT') {
      setReceipt(null);
      runAction('WF-DRAFT', act);
      return;
    }
    if (act.intent === 'SUBMIT_COMMAND') {
      const wf = act.id === 'UI28-S04-A02' ? 'WF-REVISE' : 'WF-SUBMIT';
      setReceipt(`${act.id} · 202 ACCEPTED · commandId ${commandId} · Idempotency-Key ${idempotencyKey} — 접수는 완료가 아니며 결과는 WF-RESULT(SUCCEEDED|FAILED) 로 확정됩니다(IA-R07).`);
      runAction(wf, act);
    }
  };

  const requiredPct = Math.round(((R0_REQUIRED_INPUT.length - (issues?.missing.length ?? 0)) / R0_REQUIRED_INPUT.length) * 100);
  const checkedPct = Math.round((UI02_S01_RULES.filter(r => checkedRules[r]).length / UI02_S01_RULES.length) * 100);
  const conditionsOk = conditions.every(c => c.review === 'CONFIRMED' || (c.review === 'DEFERRED' && c.note.trim().length > 0));
  const relatedAreaIds = areaId === 'UI02-S03'
    ? [...new Set(state.relations.slice(0, 8).map(r => r.type))]
    : [];

  /** 선택 객체 상세 패널의 탭 내용 — 영역의 detailTabs 를 그대로 쓴다. */
  const detailBody = (a: SpecRegAttr) => {
    if (detailTab === 0) return (
      <div className="kv">
        <div>속성 ID</div><div className="mono">{a.id} <span className="pill">{a.kind}</span></div>
        <div>속성명</div><div>{a.label} <span className="mono small muted">{a.key}</span></div>
        <div>영역</div><div className="small">{a.section}</div>
        <div>자료형</div><div className="mono small">{a.type}</div>
        <div>필수성</div><div><RequiredBadge value={a.required} /></div>
        <div>입력 책임</div><div><RespBadge value={a.responsibility} /> <span className="small muted">{a.input}</span></div>
        <div>정본 객체</div><div className="mono small">{a.canonical || '—'}</div>
        <div>정본 Owner</div><div className="small">{a.owner || '—'}</div>
        <div>관리 위치</div><div className="small">{a.location || '—'}</div>
        <div>의미·검증</div><div className="small">{a.meaning || '—'}</div>
      </div>
    );
    if (detailTab === 1) return (
      <div className="kv">
        <div>필요 시점</div><div className="small">{a.phase || '—'}</div>
        <div>입력 방식</div><div className="small">{a.input || '—'}</div>
        <div>근거 수준</div><div className="small">{a.basis || '—'}</div>
        <div>적용 단위·조건</div><div className="small">{a.applyUnit || '—'}</div>
        <div>변경 규칙</div><div className="small">{a.changeRule || '—'}</div>
        <div>요청 schema</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{a.schema || '—'}</div>
        <div>조회 API</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{a.viewApi || '—'}</div>
        <div>현재 API 대응</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{a.api || '—'}</div>
      </div>
    );
    if (detailTab === 2) return (
      <div>
        <div className="kv">
          <div>소유 영역</div><div><Link to={`/ui/UI02/${areaId}`}>{areaId}</Link> {area.name}</div>
          <div>연결 영역</div><div className="small">{a.areas.join(' · ')}</div>
          <div>다른 화면 사용처</div><div className="small">{a.otherAreas.length ? a.otherAreas.map(o => (
            <Link key={o} to={`/ui/${o.split('-')[0]}/${o}`} className="pill" style={{ marginRight: 4 }}>{o}</Link>
          )) : <span className="muted">단일 화면 속성</span>}</div>
          <div>작업</div><div className="small">{a.actionIds.length ? a.actionIds.map(x => <span key={x} className="pill" style={{ marginRight: 4 }}>{x}</span>) : '—'}</div>
          <div>Topology 정의서</div><div className="mono small">{a.topo || '—'}</div>
          <div>SW 설계 위치</div><div className="mono small">{a.swRef || '—'}</div>
        </div>
        {relatedAreaIds.length > 0 && (
          <p className="small muted mt">관계 유형: {relatedAreaIds.join(' · ')} — 정확 참조가 없으면 404 REFERENCE_NOT_FOUND 로 원천 재선택을 요구합니다.</p>
        )}
      </div>
    );
    if (detailTab === 3) return (
      <div>
        <div className="kv">
          <div>대상</div><div className="mono">{key}</div>
          <div>{STATE_FIELD}</div><div><StateChip state={rec.state} /></div>
          <div>recordRevision</div><div className="mono">{rec.recordRevision}</div>
          <div>contentHash</div><div className="mono">{rec.contentHash}</div>
          <div>If-Match</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{etagOf(rec)}</div>
        </div>
        <div className="mt">
          {rec.history.length === 0 && <p className="small muted">이 Revision 에는 아직 전이 이력이 없습니다(초안 상태).</p>}
          {rec.history.map((h, i) => (
            <div key={i} className="small" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <span className="mono">{h.ts}</span> <b>{h.action}</b> <span className="muted">{h.from} → {h.to}</span>
              <div className="muted small">{h.actor} · rev {h.hash ? h.hash.slice(0, 12) : '—'} {h.note ? `· ${h.note}` : ''}</div>
            </div>
          ))}
        </div>
      </div>
    );
    return (
      <div>
        <div className="kv">
          <div>구현 검증 상태</div><div className="small">{a.verification || '미실행'}</div>
          <div>업무 규칙</div><div className="small">{a.rules.length ? a.rules.join(' · ') : '—'}</div>
          <div>인수 조건</div><div className="small">{a.acceptance.length ? a.acceptance.join(' · ') : '—'}</div>
          <div>원천 API</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{a.api || '—'}</div>
        </div>
        <div className="mt">
          {a.rules.length === 0 && <p className="small muted">이 속성에 직접 연결된 업무 규칙이 없습니다.</p>}
          {a.rules.map(id => {
            const r = SPEC_RULES.find(x => x.id === id);
            return (
              <div key={id} className="small" style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
                <b>{id}</b> {r?.title} <span className="muted">· {r?.source}</span>
                <div className="muted small">{r?.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Feature 등록</div>
      <h1 className="page-title">Feature 등록 — {SPEC_REG_SCREEN.id} {SPEC_REG_SCREEN.name}</h1>
      <p className="page-sub">
        {SPEC_REG_SCREEN.group} 그룹 · 담당 역할 {roleLabel('author')} · 상세 영역 {SPEC_REG_SCREEN.counts.areas}개 · 작업 {SPEC_REG_SCREEN.counts.tasks}개 ·
        액션 {SPEC_REG_SCREEN.counts.actions}개 · 상태 필드 <span className="mono">{STATE_FIELD}</span> · 등록 기준선 {SPEC_P0_BASELINE} · 규칙 C01-R01~R19
      </p>
      <p className="small muted">{SPEC_REG_SCREEN.goal}</p>
      <p className="small muted">예외 처리 — {SPEC_REG_SCREEN.exception} / 완료 조건 — {SPEC_REG_SCREEN.done}</p>

      <div className="kpis mt">
        <div className="kpi"><div className="v">{state.revisions.length}</div><div className="l">등록 Revision (영속)</div></div>
        <div className="kpi"><div className="v">{ATTR_TOTAL}</div><div className="l">등록 속성 (FRI 184 + OPA 12)</div></div>
        <div className="kpi"><div className="v">{respTally.EDITABLE || 0}</div><div className="l">화면 직접 입력</div></div>
        <div className="kpi"><div className="v">{respTally.REFERENCE || 0}</div><div className="l">정확 참조 선택</div></div>
        <div className="kpi"><div className="v">{respTally.DERIVED || 0}</div><div className="l">자동·파생 (읽기 전용)</div></div>
        <div className="kpi"><div className="v">{R0_REQUIRED_INPUT.length}<span className="small muted"> / {R0_REQUIRED_AUTO.length}</span></div><div className="l">R0 입력 필수 / 자동 산출</div></div>
        <div className="kpi"><div className="v">{SPEC_FRI_GROUP_TOTAL}</div><div className="l">전체 등록 사전(FRI)</div></div>
      </div>
      <p className="small muted">{SPEC_FRI_SCOPE}</p>

      <div className="card mt">
        <p className="small muted">{SPEC_REG_SCREEN.firstScreen.layout} · 초기 조회 {SPEC_REG_SCREEN.firstScreen.initialQuery} · 선택 {SPEC_REG_SCREEN.firstScreen.selection}</p>
        <div className="row mt">
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b>리비전 요약</b>
            <div className="kv mt">
              <div>Feature ID <span className="pill">FRI-001 · 자동</span></div><div className="mono">{rec.id} {state.features.some(f => f.id === rec.id) ? <span className="pill" style={{ color: 'var(--fail)' }}>기존 ID</span> : <span className="pill" style={{ color: 'var(--pass)' }}>신규 ID</span>}</div>
              <div>업무 버전</div><div className="mono">{rec.version} <span className="muted small">(동시성 Revision 과 분리 · FRI-002)</span></div>
              <div>recordRevision <span className="pill">FRI-163 · 자동</span></div><div className="mono">{rec.recordRevision}</div>
              <div>{STATE_FIELD} <span className="pill">FRI-162 · 자동</span></div><div><StateChip state={rec.state} /> <span className="muted small">{SPEC_REGISTRY_CONTRACT.stateNote}</span></div>
              <div>If-Match</div><div className="mono small" style={{ wordBreak: 'break-all' }}>{etagOf(rec)}</div>
              <div>contentHash <span className="pill">FRI-164 · 자동</span></div><div className="mono">{rec.contentHash}</div>
              <div>입력값 hash</div><div className="mono">{draftHash} {bound ? <span className="pill" style={{ color: 'var(--pass)' }}>승인 후보와 결속</span> : <span className="pill" style={{ color: 'var(--pending)' }}>변경됨 → 재검토</span>}</div>
              <div>등록자 / 최종 변경자</div><div>{roleLabel(rec.actor)} <span className="muted small">현재 접속 {roleLabel(roleKey)}</span></div>
              <div>scope</div><div className="mono">{rec.scope || 'KR-PROGRAM'}</div>
              <div>commandId / Idempotency-Key</div><div className="mono small">{commandId} / {idempotencyKey}</div>
            </div>
            <div className="row mt">
              <div className="col"><label className="small"><input type="checkbox" checked={ifMatch} onChange={e => setIfMatch(e.target.checked)} /> If-Match(ETag) 포함</label><div className="small muted">미포함 시 428 PRECONDITION_REQUIRED</div></div>
              <div className="col"><label className="small"><input type="checkbox" checked={idemKey} onChange={e => setIdemKey(e.target.checked)} /> Idempotency-Key 포함</label><div className="small muted">같은 키 + 다른 payload 는 409</div></div>
            </div>
            <div className="mt">
              <label className="small">변경 사유(reason) — 요청 봉투에 포함</label>
              <input value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%', padding: 6, border: '1px solid var(--line)', borderRadius: 6 }} />
              {!bound && <p className="small" style={{ color: 'var(--pending)' }}>저장되지 않은 입력이 있습니다. 초안 저장(WF-DRAFT)으로 승인 후보 hash 를 새로 결속하십시오.</p>}
            </div>
            <div className="mt">
              <button className="btn primary" onClick={() => runAction('WF-DRAFT', actionOf('UI02-S01-A01')?.act)} disabled={locked}>초안 저장 (SAVE_DRAFT) · rev {rec.recordRevision}</button>{' '}
              <button className="btn" onClick={fillSample} disabled={locked}>R0 합성 예제 값 채우기</button>{' '}
              <button className="btn" onClick={() => runAction('WF-DRAFT', undefined, { derivedWrite: true })} disabled={locked} title="IA-R04: 자동·원천 값은 입력하지 않는다">파생 값 직접 입력 시도 → 422</button>
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b>등록 단계 (C01-R04)</b>
            <Steps steps={STAGE_ROWS.map(r => r[0])} current={stage} />
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>단계</th><th>완료 기준</th><th>미정 정보 처리</th><th /></tr></thead>
                <tbody>
                  {STAGE_ROWS.map((r, i) => (
                    <tr key={r[0]} style={{ opacity: i <= stage ? 1 : 0.45 }}>
                      <td className="small"><b>{r[0]}</b></td>
                      <td className="small">{r[1]}</td>
                      <td className="small">{r[2]}</td>
                      <td className="small">{i === stage ? <span className="pill" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>현재</span> : i < stage ? <span className="pill" style={{ color: 'var(--pass)' }}>통과</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <b className="mt">현재 상태에서 허용된 전이</b>
            <p className="small muted">상태 직접 수정은 금지되며 아래 전이만 허용됩니다(SPEC_REGISTRY_CONTRACT).</p>
            {actionsFor(rec.state).map(w => {
              const mapped = WF_SPEC_ACTION[w.id];
              const act = mapped ? actionOf(mapped)?.act : undefined;
              const ok = !act || permitted(act);
              return (
                <div key={w.id} className="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <span className="mono small">{w.id}</span> <b>{w.action}</b>
                  <div className="small muted">{w.from.join(' | ')} → {w.to}</div>
                  <div className="small">{w.guard}</div>
                  <div className="small muted">{act ? `${act.id} ${act.method} ${act.path} · ${act.roles.map(roleLabel).join(' / ')}` : '전용 기준 액션 미구현(RETIRED 전용 Operations action)'}</div>
                  <button
                    className="btn mt"
                    disabled={locked || !ok || (w.id === 'WF-SUBMIT' && !issues?.complete)}
                    onClick={() => (w.id === 'WF-APPROVE' ? approve() : runAction(w.id, act))}
                  >{w.action}</button>
                  {!ok && <span className="small muted"> ← {act?.roles.map(roleLabel).join(' / ')} 담당</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--fail)' }}>
          <b style={{ color: 'var(--fail)' }}>{error.status} {error.reason}</b>
          <p className="small mt">{error.description}</p>
          {error.behavior && <p className="small muted">화면 상태: {error.behavior}</p>}
          {error.fieldErrors?.length ? <ul className="small mt">{error.fieldErrors.map(f => <li key={f}>{f}</li>)}</ul> : null}
          <button className="btn mt" onClick={() => setError(null)}>입력은 보존한 채 닫기</button>
        </div>
      )}
      {notice && <div className="card" style={{ borderColor: 'var(--pass)' }}><span className="small">{notice}</span></div>}
      {receipt && <div className="card" style={{ borderColor: 'var(--pending)' }}><span className="small mono">{receipt}</span></div>}

      {/* ── 상세 메뉴 탭 — 기준 7개 영역 ───────────────────────────── */}
      <div className="card mt">
        <b>상세 영역 {SPEC_REG_SCREEN.counts.areas}개</b>
        <p className="small muted">{SPEC_REG_SCREEN.firstScreen.primaryAction} · 빈 목록: {SPEC_REG_SCREEN.firstScreen.emptyAction}</p>
        <div className="mt" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SPEC_REG_AREAS.map(a => {
            const c = countsOf(a.id);
            const on = a.id === areaId;
            return (
              <button
                key={a.id} className="btn" onClick={() => { setAreaId(a.id); setSel(null); setDetailTab(0); }}
                style={{ borderColor: on ? 'var(--brand)' : undefined, background: on ? 'var(--brand)' : undefined, color: on ? '#fff' : undefined, textAlign: 'left' }}
              >
                <span className="mono small">{a.id}</span> {a.name}
                <span className="small" style={{ opacity: 0.75 }}> · {c.total} · 입력 {c.editable}/참조 {c.reference}/자동 {c.derived}</span>
                {!a.editable && <span className="small"> · 조회 전용</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── UI02-R1 등록 심사 · 업무 Lifecycle (2026-09-13 정본 개정) ─── */}
      <RegistrationReviewPanel
        featureId={rec.id}
        revisionState={rec.state}
        filled={values}
        conditions={conditions.length}
        onJumpArea={id => { setAreaId(id); setSel(null); setDetailTab(0); }}
        onEvent={setNotice}
      />

      <div className="card">
        <div className="row">
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b>{area.id} {area.name}</b>
            <div className="kv mt">
              <div>영역 유형</div><div><span className="pill">{area.type}</span> {area.layoutName} {area.editable ? <span className="pill" style={{ color: 'var(--pass)' }}>편집 가능</span> : <span className="pill" style={{ color: 'var(--pending)' }}>조회 전용</span>}</div>
              <div>정본 객체 / 모듈</div><div className="mono small">{area.canonicalObject} · {area.module}</div>
              <div>연결 속성</div><div><b>{counts.total}</b> — 직접 입력 {counts.editable} · 정확 참조 {counts.reference} · 자동·파생 {counts.derived} · 필수 {counts.required}</div>
              <div>상태 규칙</div><div className="small">{area.stateRule}</div>
              <div>역할 정책</div><div className="small">조회 {area.rolePolicy.read} · 편집 {area.rolePolicy.edit} · 승인 {area.rolePolicy.approve} · 원천 {area.rolePolicy.sourceWrite}</div>
              <div>조회 API</div><div className="mono small">{area.readApi.profile} · {area.readApi.method} {area.readApi.path} → {area.readApi.projection} <span className="pill">{area.readApi.status}</span></div>
              <div>영역 경로</div><div className="mono small">{area.route} <Link to={`/ui/${area.id.split('-')[0]}/${area.id}`} className="pill">상세 화면 열기</Link></div>
              <div>구현 상태</div><div className="small">{area.coverage} · {area.implementation}</div>
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 260 }}>
            <b>작업 {area.tasks.length}개</b>
            <ol className="small mt">{area.tasks.map((t, i) => <li key={i}>{t}</li>)}</ol>
            <div className="mt">
              <b className="small">화면 목록 열</b>
              <div className="mt">{area.columns.map(c => <span key={c} className="pill" style={{ marginRight: 4, marginBottom: 4 }}>{c}</span>)}</div>
            </div>
            <div className="mt">
              <b className="small">업무 규칙 {area.rules.length}개</b>
              <div className="mt">{area.rules.map(r => {
                const info = SPEC_RULES.find(x => x.id === r);
                return <div key={r} className="small" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
                  <b>{r}</b> {info?.title} <span className="muted">· {info?.source}</span>
                  <div className="muted">{info?.text}</div>
                </div>;
              })}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 속성 목록 + 선택 객체 상세 패널 ───────────────────────── */}
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ flex: 3, minWidth: 420 }}>
            <b>등록 속성 {counts.total}개 — {SPEC_REG_SCREEN.firstScreen.title} 목록</b>
            <p className="small muted">입력 책임이 직접 입력인 항목만 값을 타이핑합니다. 정확 참조는 원천 객체를 선택하고, 자동·파생은 서버가 계산하므로 읽기 전용입니다(IA-R04 · IA-R13).</p>
            <div className="table-wrap mt">
              <table>
                <thead>
                  <tr><th>속성 ID</th><th>속성</th><th>구분</th><th>자료형</th><th>필요 시점</th><th>필수</th><th>입력 책임</th><th>값 · 원천</th></tr>
                </thead>
                <tbody>
                  {rows.map(id => {
                    const a = attrOf(id);
                    if (!a) return <tr key={id}><td className="mono">{id}</td><td colSpan={7} className="muted">사전에 없는 속성</td></tr>;
                    const editable = a.responsibility === 'EDITABLE' && area.editable;
                    return (
                      <tr key={id} onClick={() => { setSel(id); setDetailTab(0); }} style={{ cursor: 'pointer', background: sel === id ? 'var(--bg-2)' : undefined }}>
                        <td className="mono small">{id}</td>
                        <td><div>{a.label}</div><div className="mono small muted">{a.key} · {a.section}</div></td>
                        <td className="small"><span className="pill">{a.kind}</span></td>
                        <td className="mono small">{a.type}</td>
                        <td className="small">{a.phase || '—'}</td>
                        <td><RequiredBadge value={a.required} /></td>
                        <td><RespBadge value={a.responsibility} />{a.responsibility === 'EDITABLE' && !area.editable && <div className="small muted">영역 조회 전용</div>}</td>
                        <td style={{ minWidth: 220 }} onClick={e => e.stopPropagation()}>
                          {editable ? (
                            <input
                              value={values[id] ?? ''} disabled={locked} title={a.meaning}
                              placeholder={a.type === 'Text' ? a.label : a.type}
                              onChange={e => setValue(id, e.target.value)}
                              style={{ width: '100%', padding: 6, border: '1px solid var(--line)', borderRadius: 6 }}
                            />
                          ) : a.responsibility === 'REFERENCE' ? (
                            <div className="small">
                              <span className="mono">{a.owner || a.canonical || '원천'}</span>
                              <div className="muted">{a.input || '선택/참조'} · {a.location || '—'}</div>
                            </div>
                          ) : (
                            <div className="small muted">{a.meaning || '서버 계산값'}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt small muted">
              인수 조건 {area.acceptanceId} — {area.acceptanceCriteria.map((c, i) => <div key={i}>· {c}</div>)}
            </div>
          </div>

          <div className="col" style={{ flex: 1, minWidth: 300 }}>
            <b>선택 객체 상세</b>
            {!selected && <p className="small muted mt">목록에서 속성을 선택하면 상세 패널이 열립니다(선택 scope · exactRef 보존).</p>}
            {selected && (
              <div className="mt">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {area.detailTabs.map((t, i) => (
                    <button key={t} className="btn" onClick={() => setDetailTab(i)}
                      style={{ borderColor: detailTab === i ? 'var(--brand)' : undefined, background: detailTab === i ? 'var(--brand)' : undefined, color: detailTab === i ? '#fff' : undefined }}>{t}</button>
                  ))}
                </div>
                <div className="mt">{detailBody(selected)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 영역별 실행 ─────────────────────────────────────────── */}
      {areaId === 'UI02-S02' && (
        <div className="card">
          <b>적용조건 행 — {area.columns.join(' · ')}</b>
          <p className="small muted">행 안은 AND, 행 사이는 OR 입니다. KR/A/Trim-P 와 DE/B/Trim-S 가 있어도 KR/B/Trim-S 를 자동 지원하지 않으며 독립 배열의 교차곱을 생성하지 않습니다(C01-R04).</p>
          <div className="table-wrap mt">
            <table>
              <thead><tr>{area.columns.map(c => <th key={c}>{c}</th>)}<th>미정 사유</th><th /></tr></thead>
              <tbody>
                {conditions.map((c, i) => {
                  const set = (patch: Partial<CondRow>) => setConditions(p => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  const incomplete = c.review === 'DEFERRED' && !c.note.trim();
                  return (
                    <tr key={c.id} style={{ background: incomplete ? 'var(--fail-bg, #FDF2F2)' : undefined }}>
                      <td className="small" onClick={() => { setSel('FRI-049'); setDetailTab(0); }}>{c.id} <span className="muted">({i + 1}행)</span></td>
                      <td><input value={c.nation} disabled={locked} onChange={e => set({ nation: e.target.value })} style={{ width: 90 }} /></td>
                      <td><input value={c.market} disabled={locked} onChange={e => set({ market: e.target.value })} style={{ width: 70 }} /></td>
                      <td><input value={c.model} disabled={locked} onChange={e => set({ model: e.target.value })} style={{ width: 90 }} /></td>
                      <td><input value={c.trim} disabled={locked} onChange={e => set({ trim: e.target.value })} style={{ width: 80 }} /></td>
                      <td><input value={c.variant} disabled={locked} onChange={e => set({ variant: e.target.value })} style={{ width: 110 }} /></td>
                      <td className="mono small">{c.impl}</td>
                      <td>
                        <select value={c.review} disabled={locked} onChange={e => set({ review: e.target.value })} style={{ color: CONDITION_COLORS[c.review] }}>
                          <option value="CONFIRMED">CONFIRMED</option>
                          <option value="DEFERRED">DEFERRED</option>
                          <option value="REJECTED">REJECTED</option>
                        </select>
                      </td>
                      <td><input value={c.note} disabled={locked} onChange={e => set({ note: e.target.value })} style={{ width: '100%' }} placeholder="UNKNOWN·미정 사유" /></td>
                      <td><button className="btn" disabled={locked} onClick={() => setConditions(p => p.filter((_, j) => j !== i))}>삭제</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt">
            <button className="btn" disabled={locked} onClick={() => setConditions(p => [...p, { id: `CR-${p.length + 1}`, nation: 'UNKNOWN', market: '—', model: '—', trim: '—', variant: '—', impl: '—', review: 'DEFERRED', note: '' }])}>＋ 조건행 추가</button>{' '}
            <span className="small" style={{ color: conditionsOk ? 'var(--pass)' : 'var(--fail)' }}>
              {conditionsOk ? '미정·비해당 사유가 모두 기록되었습니다.' : 'DEFERRED 행에는 미정 사유가 필요하며 없으면 검토 요청이 422 로 차단됩니다.'}
            </span>
          </div>
        </div>
      )}

      {areaId === 'UI02-S03' && (
        <div className="card">
          <b>관계와 원천 — Topology 영향</b>
          <p className="small muted">정확 참조가 없는 관계는 승인 보류 대상입니다. 원천 digest 가 바뀌면 승인 후보 hash 가 달라져 재검토로 이어집니다(UI02-S03-A04 VALIDATE).</p>
          <div className="row mt">
            <div className="col" style={{ flex: 1, minWidth: 260 }}>
              <b className="small">현재 등록된 관계 유형</b>
              <div className="mt"><Bars data={tally(state.relations.map(r => r.type), x => x)} /></div>
            </div>
            <div className="col" style={{ flex: 1, minWidth: 260 }}>
              <b className="small">참조 원천 후보 (정확 참조 · digest 검증)</b>
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>원천</th><th>Artifact</th><th>버전</th><th>해석</th><th>digest</th></tr></thead>
                  <tbody>
                    {ARTIFACT_RECORDS.slice(0, 8).map(x => (
                      <tr key={`${x.id}@${x.version}`}>
                        <td className="small"><span className="pill">{x.sourceRef.system}</span></td>
                        <td className="mono small">{x.artifactId}</td>
                        <td className="mono small">{x.version}</td>
                        <td className="small">{x.resolution}</td>
                        <td className="mono small">{String(x.contentDigest || '').slice(0, 12) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {areaId === 'UI02-S04' && (
        <div className="card">
          <b>구현과 제어 — Feature 제어점 (Feature ControlPoint)</b>
          <p className="small muted">결속 사슬 FeatureVersion → ControlPoint → FlagBinding → RuntimeBinding. 관측(OBSERVE) 항목에는 실행 제어 권한을 주지 않습니다(accessMode READ_ONLY).</p>
          <div className="kpis mt">
            <div className="kpi"><div className="v">{cpStats.total}</div><div className="l">등록 제어점</div></div>
            <div className="kpi"><div className="v">{cpStats.write}<span className="small muted"> / {cpStats.writeGuarded}</span></div><div className="l">쓰기 요청 / Guard 연결</div></div>
            <div className="kpi"><div className="v">{cpStats.observe}</div><div className="l">관측 전용</div></div>
            <div className="kpi"><div className="v">{FLAG_BINDINGS.length}<span className="small muted"> / {RUNTIME_BINDINGS.length}</span></div><div className="l">Flag / Runtime Binding</div></div>
            <div className="kpi"><div className="v">{cpStats.blocking}</div><div className="l">승인 차단 위반</div></div>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>제어점</th><th>종류</th><th>역할</th><th>값·단위</th><th>접근</th><th>bindingRef</th><th>Guard</th><th>Flag 분류</th></tr></thead>
              <tbody>
                {CONTROL_POINTS.map(cp => (
                  <tr key={cp.id} onClick={() => { setSel('FRI-114'); setDetailTab(0); }} style={{ cursor: 'pointer' }}>
                    <td className="mono small">{cp.id}</td>
                    <td className="small">{kindLabel[cp.kind]}</td>
                    <td className="small">{cpRoleLabel[cp.role]}</td>
                    <td className="mono small">{cp.valueType}{cp.unit ? ` ${cp.unit}` : ''}{cp.allowedRange ? ` [${cp.allowedRange[0]}, ${cp.allowedRange[1]}]` : ''}</td>
                    <td className="small">{cp.accessMode === 'READ_ONLY' ? <span className="pill">READ_ONLY</span> : <span className="pill" style={{ color: 'var(--pending)' }}>WRITE_GATED</span>}</td>
                    <td className="mono small">{cp.bindingRef}</td>
                    <td className="mono small">{cp.guardRef || '—'}</td>
                    <td className="small">{cp.flagClass ? `${cp.flagClass.purpose} · ${cp.flagClass.lifetimeDays}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt">
            <b className="small">결속 사슬 검사 결과 {VIOLATIONS.length}건</b>
            {VIOLATIONS.length === 0 && <p className="small muted">차단 위반이 없습니다.</p>}
            {VIOLATIONS.slice(0, 8).map((v, i) => (
              <div key={i} className="small" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
                <span className="mono">{v.code}</span> <b>{v.target}</b> <span className="pill" style={{ color: v.blocking ? 'var(--fail)' : 'var(--pending)' }}>{v.blocking ? 'BLOCKING' : 'WARN'}</span>
                <div className="muted">{v.detail}</div>
              </div>
            ))}
            <p className="small muted mt">ImplementationBOM {IMPLEMENTATION_BOMS.length}건 · 관리 영역 11개(DD-03-3). 구현 Artifact {ARTIFACT_RECORDS.length}건이 참조 후보입니다.</p>
          </div>
        </div>
      )}

      {areaId === 'UI02-S05' && (
        <div className="card">
          <b>품질과 제한 — 증적과 차단 근거</b>
          <p className="small muted">안전·보안·개인정보·외부 제한은 원천 소유 객체의 정확 버전으로만 연결합니다. 증적 digest 불일치·미해결 참조는 승인을 막습니다.</p>
          <div className="row">
            <div className="col" style={{ flex: 1, minWidth: 260 }}>
              <b className="small">연결 속성 {counts.total}개 (필수 {counts.required})</b>
              <div className="table-wrap mt">
                <table>
                  <thead><tr><th>속성</th><th>필수</th><th>책임</th><th>정본 원천</th></tr></thead>
                  <tbody>
                    {rows.map(id => { const a = attrOf(id); if (!a) return null; return (
                      <tr key={id}><td><div className="small">{a.label}</div><div className="mono small muted">{id} · {a.key}</div></td>
                        <td><RequiredBadge value={a.required} /></td><td><RespBadge value={a.responsibility} /></td>
                        <td className="small">{a.owner || '—'}</td></tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="col" style={{ flex: 1, minWidth: 260 }}>
              <b className="small">품질·제한 위반</b>
              <div className="mt">
                {VIOLATIONS.filter(v => ['GUARD_REF_MISSING', 'OBSERVE_WRITE_GRANT', 'UNRESOLVED_ARTIFACT', 'MISSING_AREA_EVIDENCE', 'DIGEST_INVALID', 'HW_OTA_DELIVERY'].includes(v.code)).map((v, i) => (
                  <div key={i} className="small" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
                    <span className="mono">{v.code}</span> <b>{v.target}</b>
                    <div className="muted">{v.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {areaId === 'UI02-S06' && (
        <div className="card">
          <b>상품과 운영 연결 — 조회 전용</b>
          <p className="small muted">이 영역은 편집할 수 없습니다(editable=false). 승인된 구성과 그 사용처를 조회하고 배포·실제 적용 결과 화면으로 이동합니다.</p>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th>ImplementationBOM</th><th>버전</th><th>Feature 참조</th><th>구성 항목</th><th>Artifact 참조</th><th>Profile</th><th /></tr></thead>
              <tbody>
                {IMPLEMENTATION_BOMS.map(b => (
                  <tr key={`${b.id}@${b.version}`}>
                    <td className="mono small">{b.id}</td>
                    <td className="mono small">{b.version}</td>
                    <td className="mono small">{b.featureRef}</td>
                    <td className="small">{b.items.length}개 영역 · PRESENT {b.items.filter(i => i.presence === 'PRESENT').length} / 비해당 {b.items.filter(i => i.presence === 'NOT_APPLICABLE').length}</td>
                    <td className="small">{b.artifactRefs.length}건 {b.items.some(i => i.resolution === 'UNRESOLVED') ? ' · 미해석 있음' : ' · 전건 해석'}</td>
                    <td className="small"><span className="pill">{b.sourceProfile}</span></td>
                    <td><Link className="pill" to="/master/bom">Feature BOM 보기</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {areaId === 'UI02-S07' && (
        <div>
          <div className="card">
            <b>리비전 레지스트리 — 이력과 영속</b>
            <p className="small muted">{SPEC_REG_SCREEN.firstScreen.columns.join(' · ')} · 승인 원본은 직접 수정하지 않고 새 업무 버전으로 분기합니다(IA-R06).</p>
            {state.revisions.length === 0 ? (
              <div className="mt"><EmptyState title="저장된 등록 Revision 이 없습니다. 초안 저장(SAVE_DRAFT)으로 첫 Revision 을 만드십시오." cta={<button className="btn primary mt" onClick={() => runAction('WF-DRAFT', actionOf('UI02-S01-A01')?.act)}>초안 저장</button>} /></div>
            ) : (
              <div className="table-wrap mt">
                <table>
                  <thead><tr>{SPEC_REG_SCREEN.firstScreen.columns.map(c => <th key={c}>{c}</th>)}<th>recordRevision</th><th>contentHash</th><th /></tr></thead>
                  <tbody>
                    {state.revisions.map(r => (
                      <tr key={`${r.id}@${r.version}`} style={{ background: key === `${r.id}@${r.version}` ? 'var(--bg-2)' : undefined }}>
                        <td className="mono small">{r.id}</td>
                        <td className="small">{r.name || '—'}</td>
                        <td className="mono small">{r.version}</td>
                        <td className="small">{r.scope || 'KR-PROGRAM'}</td>
                        <td><StateChip state={r.state} /></td>
                        <td className="small">{roleLabel(r.actor)}</td>
                        <td className="mono small">{r.ts}</td>
                        <td className="mono small">{r.recordRevision}</td>
                        <td className="mono small">{r.contentHash.slice(0, 12)}</td>
                        <td>
                          <button className="btn" onClick={() => loadRecord(r)}>열기</button>{' '}
                          <button className="btn" onClick={() => { setRec(r); setCounterReason(r.reason || ''); runAction('WF-REVISE', actionOf('UI28-S04-A02')?.act); }}>새 버전 분기</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row mt">
              <div className="col" style={{ flex: 1, minWidth: 240 }}>
                <b className="small">전이 이력 (열린 Revision)</b>
                {rec.history.length === 0 && <p className="small muted">이력이 없습니다.</p>}
                {rec.history.map((h, i) => (
                  <div key={i} className="small" style={{ borderTop: '1px solid var(--line)', padding: '5px 0' }}>
                    <span className="mono">{h.ts}</span> <b>{h.action}</b> <span className="muted">{h.from} → {h.to}</span>
                    <div className="muted">{h.actor} · rev hash {h.hash ? h.hash.slice(0, 12) : '—'}{h.note ? ` · ${h.note}` : ''}</div>
                  </div>
                ))}
              </div>
              <div className="col" style={{ flex: 1, minWidth: 240 }}>
                <b className="small">완전성 검사 (UI02-S07-A02)</b>
                <div className="row mt" style={{ alignItems: 'center' }}>
                  <div className="col">
                    <button className="btn primary" onClick={() => runSpecAction(area, area.actions.find(a => a.id === 'UI02-S07-A02')!)}>완전성 검사 실행 (VALIDATE)</button>{' '}
                    <button className="btn" onClick={() => setCheckedRules(Object.fromEntries(UI02_S01_RULES.map(r => [r, true])))}>규칙 확인 전체 체크</button>
                    {issues && <span className={'pill mt ' + (issues.complete ? 'ok' : 'warn')}>{issues.complete ? '통과' : `미비 ${issues.missing.length} · 미정 ${issues.unresolved.length}`}</span>}
                  </div>
                  <div className="col" style={{ flex: 0, minWidth: 170, textAlign: 'center' }}>
                    <RadialProgress value={requiredPct} label={`R0 입력 ${R0_REQUIRED_INPUT.length - (issues?.missing.length ?? 0)}/${R0_REQUIRED_INPUT.length}`} />
                    <div className="small muted">규칙 확인 {checkedPct}%</div>
                  </div>
                </div>
                <div className="mt">
                  <Donut
                    center={`${ATTR_TOTAL}`}
                    segments={[
                      { label: '직접 입력', value: respTally.EDITABLE || 0, color: '#0B5FFF' },
                      { label: '정확 참조', value: respTally.REFERENCE || 0, color: '#D9822B' },
                      { label: '자동·파생', value: respTally.DERIVED || 0, color: '#8895A7' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <b>미정 항목과 해소 조건 (FRI-177~183 · UI02-S07-A05)</b>
            <p className="small muted">어떤 국가·Trim·관계·구현 참조가 미정인지 위치·사유·담당자·기한을 기록합니다. 미해소 항목은 승인 요청을 차단합니다(IA-R04).</p>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>위치(FieldPath · RowRef)</th><th>미정 사유</th><th>확인 책임자</th><th>목표 확인일</th><th /></tr></thead>
                <tbody>
                  {unresolved.length === 0 && <tr><td colSpan={5} className="muted">등록된 미정 항목이 없습니다.</td></tr>}
                  {unresolved.map((u, i) => (
                    <tr key={i}>
                      <td><input value={u.field} disabled={locked} placeholder="FRI-054 / 조건행 3" onChange={e => setUnresolved(p => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} style={{ width: '100%' }} /></td>
                      <td><input value={u.reason} disabled={locked} placeholder="Trim 별 적용 기준 미결정" onChange={e => setUnresolved(p => p.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))} style={{ width: '100%' }} /></td>
                      <td><input value={u.owner} disabled={locked} placeholder="ORG-BODY-PLATFORM" onChange={e => setUnresolved(p => p.map((x, j) => j === i ? { ...x, owner: e.target.value } : x))} style={{ width: '100%' }} /></td>
                      <td><input value={u.due} disabled={locked} placeholder="2026-10-15" onChange={e => setUnresolved(p => p.map((x, j) => j === i ? { ...x, due: e.target.value } : x))} style={{ width: '100%' }} /></td>
                      <td><button className="btn" disabled={locked} onClick={() => setUnresolved(p => p.filter((_, j) => j !== i))}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn mt" disabled={locked} onClick={() => setUnresolved(p => [...p, { field: '', reason: '', owner: '', due: '' }])}>＋ 미정 항목 추가</button>
          </div>

          <div className="card">
            <b>검토 요청 · 반려 보완</b>
            <p className="small muted">보완 요청은 사유·책임자·완료 기한을 모두 요구하며 누락 시 422 fieldErrors 로 반환됩니다(FRI-169·180·182).</p>
            <div className="row mt">
              <div className="col"><label className="small">반려 사유(FRI-169)</label><input value={counterReason} onChange={e => setCounterReason(e.target.value)} style={{ width: '100%', padding: 6 }} /></div>
              <div className="col"><label className="small">확인 책임자(FRI-180)</label><input value={counterOwner} onChange={e => setCounterOwner(e.target.value)} style={{ width: '100%', padding: 6 }} /></div>
              <div className="col"><label className="small">완료 기한(FRI-182)</label><input value={counterDue} onChange={e => setCounterDue(e.target.value)} style={{ width: '100%', padding: 6 }} /></div>
            </div>
            <div className="mt">
              <button className="btn" onClick={() => runAction('WF-RETURN', actionOf('UI02-S07-A03')?.act, { reason: counterReason, owner: counterOwner, due: counterDue })}>보완 요청 (WF-RETURN)</button>{' '}
              <button className="btn" onClick={() => runAction('WF-RETIRE', undefined)}>폐기 (WF-RETIRE)</button>{' '}
              <span className="small muted">RETIRED 전용 Operations action 은 미구현이므로 WORKFLOW 가드만 적용됩니다.</span>
            </div>
          </div>

          <div className="card">
            <b>승인 단계 참조 — 이 화면 밖 승인 (UI06 · UI28)</b>
            <p className="small muted">정의 승인과 구성 승인은 별도 화면 소유입니다. 자기 승인·직무 분리는 서버가 추가 검사합니다(SPEC_REG_APPROVAL).</p>
            <div className="table-wrap mt">
              <table>
                <thead><tr><th>영역</th><th>이름</th><th>유형</th><th>편집</th><th>액션</th><th>담당 역할</th><th /></tr></thead>
                <tbody>
                  {SPEC_REG_APPROVAL.map(a => (
                    <tr key={a.id}>
                      <td className="mono small">{a.id}</td>
                      <td className="small">{a.name}</td>
                      <td className="small"><span className="pill">{a.type}</span></td>
                      <td className="small">{a.editable ? '가능' : '조회'}</td>
                      <td className="small">{a.actions.map(x => x.intent).join(' · ')}</td>
                      <td className="small">{[...new Set(a.actions.flatMap(x => x.roles))].map(roleLabel).join(' / ')}</td>
                      <td><Link className="pill" to={`/ui/${a.id.split('-')[0]}/${a.id}`}>{a.id}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 영역 액션 ─────────────────────────────────────────── */}
      <div className="card">
        <b>{area.id} 액션 {area.actions.length}개 — 역할·상태에 따른 실행과 차단 이유</b>
        <p className="small muted">모든 실행은 요청 봉투 {area.actions[0]?.payloadFields.join(', ')} 를 쓰고, 동일 키 + 동일 hash 는 같은 결과를 돌려줍니다. 접수(202)와 업무 완료를 구분합니다(IA-R07).</p>
        {area.actions.map(act => {
          const ok = permitted(act);
          return (
            <div key={act.id} className="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="row">
                <div className="col" style={{ flex: 1, minWidth: 240 }}>
                  <span className="mono small">{act.id}</span> <b>{act.label}</b>
                  <div className="small muted">
                    {act.type} · intent <span className="mono">{act.intent}</span> · 권한 {act.permission} · 담당 {act.roles.map(roleLabel).join(' / ')}
                  </div>
                  <div className="small mono" style={{ wordBreak: 'break-all' }}>{act.method} {act.path}</div>
                  <div className="small muted">{act.result}</div>
                  <div className="small muted">실패 시 — {act.failure}</div>
                  <div className="mt">{act.preconditions.map(p => <span key={p} className="pill" style={{ marginRight: 4 }}>{p}</span>)}</div>
                  <div className="mt">{act.errors.map(e => <span key={e} className="mono small muted" style={{ marginRight: 6 }}>{e}</span>)}</div>
                  <div className="small muted mt">멱등성 — {act.idempotency}</div>
                </div>
                <div className="col" style={{ flex: 0, minWidth: 200 }}>
                  <button className="btn primary" disabled={locked || !ok || (act.intent === 'SUBMIT_COMMAND' && !issues?.complete)} onClick={() => runSpecAction(area, act)}>
                    {act.type === 'inspect' ? '조회' : act.type === 'navigate' ? '이동' : act.intent === 'VALIDATE' ? '검사 실행' : act.intent === 'SUBMIT_COMMAND' ? '검토 요청' : '저장'}
                  </button>
                  {!ok && <div className="small" style={{ color: 'var(--fail)' }}>403 — {act.roles.map(roleLabel).join(' / ')} 담당</div>}
                  {act.intent === 'SUBMIT_COMMAND' && !issues?.complete && <div className="small muted">완전성 검사를 먼저 통과해야 합니다.</div>}
                  <div className="small muted mt">인수 조건 {act.acceptanceId}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <b>기준 연결</b>
        <div className="kv mt">
          <div>화면 정의서</div><div className="small">{SPEC_REG_SCREEN.sourceRefs.join(' · ')}</div>
          <div>정의 상태</div><div className="small">{SPEC_REG_SCREEN.designStatus} · 구현 {SPEC_REG_SCREEN.implementationStatus}</div>
          <div>상태 사전</div><div className="small">{DEFINITION_STATES.join(' · ')} (RETIRED 포함 {DEFINITION_STATES.length}개)</div>
          <div>OpenAPI 오퍼레이션</div><div className="small">{SPEC_CLOSURE.openApiOperations} · typed request {SPEC_CLOSURE.typedRequestCount} · 런타임 검증 {SPEC_CLOSURE.runtimeValidation}</div>
          <div>데모 범위</div><div className="small">제품 서버 미연결(LOCAL_UI_ONLY) — 상태 전이·멱등키·ETag·완전성 검사는 이 브라우저에서 실제로 계산되고 영속됩니다.</div>
        </div>
      </div>

      {/* ── 정본 영역 계약 — 클릭한 영역의 Task·액션·API·인수 조건 원문 ── */}
      <SpecAreaFacts uiId="UI02" areaId={areaId} />
    </div>
  );
}

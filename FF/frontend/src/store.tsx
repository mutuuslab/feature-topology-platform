import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import * as M from './data/model';
import { permMatrix } from './data/refdata';
import { setDB, readiness, relationsOf, edgesOf } from './data/engine';

// ── 상태 ──────────────────────────────────────────────
export interface CR { id: string; feature: string; type: string; status: string; owner: string; risk: string; }
export interface AuditEntry { ts: string; actor: string; action: string; target: string; detail: string; }
export interface ActState { enabled: boolean; rollout: number; killed: boolean }   // 차종(모델)별 활성화
export interface Experiment { id: string; feature: string; variant: string; metric: string; status: 'Draft' | 'Running' | 'Stopped'; uplift: number }
export interface Exception { id: string; feature: string; reason: string; approver: string; expiry: string; active: boolean }

export const LIFECYCLE_ORDER: M.Lifecycle[] = ['Proposed', 'Approved', 'Developing', 'Verified', 'Released', 'Retired'];

// 전이 가드 — 단계별 구조 완전성 조건 (엑셀 FR-REG-002/005)
export function canTransition(f: M.Feature, to: M.Lifecycle): { ok: boolean; reason: string } {
  const rels = relationsOf(f.id);
  const has = (t: string) => rels.some(r => r.type === t);
  if (to === 'Approved' && !has('derives')) return { ok: false, reason: 'R01: 연결된 Requirement 없음' };
  if (to === 'Developing' && !has('controlled_by')) return { ok: false, reason: 'Control Point(Flag) 미연결' };
  if (to === 'Verified' && !has('verified_by')) return { ok: false, reason: 'Test Evidence 미등록' };
  if (to === 'Released') { const r = readiness(f.id); if (r.decision !== 'RELEASE') return { ok: false, reason: `9-Gate 미통과 (${r.passCount}/9)` }; }
  return { ok: true, reason: '' };
}

export interface LiveData {
  tick: number;
  activation: number;      // 0..100 활성화 성공률(실시간)
  failRate: number;        // % 실패율
  rollback: number;
  p95: number;             // ms
  series: number[];        // 활성화율 시계열(최근 N)
  events: { type: string; detail: string; ts: string }[];
}

export interface AppState {
  features: M.Feature[];
  edges: M.Edge[];
  relations: M.Relation[];
  crs: CR[];
  runtime: Record<string, string>;        // featureId → runtime state
  audit: AuditEntry[];
  role: string;
  theme: 'light' | 'dark';
  lang: 'ko' | 'en';
  live: LiveData;
  activation: Record<string, ActState>;   // key `${featureId}@${model}`
  experiments: Experiment[];
  exceptions: Exception[];
  toast?: { msg: string; kind: 'ok' | 'warn' | 'err' } | null;
}

const initialLive: LiveData = {
  tick: 0, activation: 98.7, failRate: 1.3, rollback: 3, p95: 42,
  series: [97, 98, 96, 99, 98.7, 95, 98, 99, 97, 98.7],
  events: [
    { type: 'POLICY_APPLY_SUCCESS', detail: 'VIN cohort pilot_kr_01', ts: '08:25' },
    { type: 'POLICY_APPLY_FAIL', detail: 'ECU version mismatch', ts: '08:24' },
  ],
};

const SEED_CRS: CR[] = [
  { id:'CR-2026-0142', feature:'FEAT-BDC-001', type:'Targeting Rule 변경', status:'Reviewed', owner:'박민준', risk:'Low' },
  { id:'CR-2026-0138', feature:'FEAT-CONN-001', type:'Variant 추가', status:'Analyzed', owner:'정하늘', risk:'Med' },
  { id:'CR-2026-0131', feature:'FEAT-ADAS-001', type:'SWC 변경', status:'Approved', owner:'이서연', risk:'High' },
];

const SEED_ACT: Record<string, ActState> = {
  'FEAT-BDC-001@IONIQ5': { enabled: true, rollout: 100, killed: false },
  'FEAT-BDC-001@GV80': { enabled: true, rollout: 60, killed: false },
  'FEAT-BDC-001@KONA': { enabled: false, rollout: 0, killed: false },
  'FEAT-ADAS-001@GV80': { enabled: true, rollout: 100, killed: false },
  'FEAT-CONN-001@IONIQ5': { enabled: true, rollout: 30, killed: false },
};
const SEED_EXP: Experiment[] = [
  { id: 'EXP-BDC-01', feature: 'FEAT-BDC-001', variant: 'A/B Targeting Rule', metric: '활성화율', status: 'Running', uplift: 3.2 },
  { id: 'EXP-LIGHT-02', feature: 'FEAT-LIGHT-001', variant: 'Welcome Light cohort 5%', metric: '만족도', status: 'Draft', uplift: 0 },
];
const SEED_EXC: Exception[] = [
  { id: 'EXC-2026-004', feature: 'FEAT-CONN-001', reason: '긴급 우회(현장 이슈)', approver: '정하늘', expiry: '2026-06-12', active: true },
];

const initial: AppState = {
  features: M.features, edges: M.edges, relations: M.relations,
  crs: SEED_CRS, runtime: { 'FEAT-BDC-001': 'enabled' }, audit: [],
  role: '운영 P7', theme: 'light', lang: 'ko', live: initialLive,
  activation: SEED_ACT, experiments: SEED_EXP, exceptions: SEED_EXC, toast: null,
};

function clock() { try { return new Date().toTimeString().slice(0, 8); } catch { return '08:25:00'; } }
const EVK = [['POLICY_APPLY_SUCCESS', 'cohort pilot_kr_01'], ['POLICY_APPLY_FAIL', 'ECU version mismatch'], ['POLICY_ROLLBACK', 'previous stable policy'], ['TELEMETRY', 'fleet heartbeat']];

type Action =
  | { t: 'ADD_FEATURE'; f: M.Feature }
  | { t: 'ADD_EDGE'; e: M.Edge }
  | { t: 'CREATE_CR'; cr: CR }
  | { t: 'KILL'; feature: string; actor: string }
  | { t: 'RECOVER'; feature: string }
  | { t: 'AUDIT'; entry: AuditEntry }
  | { t: 'ROLE'; role: string }
  | { t: 'THEME'; theme: 'light' | 'dark' }
  | { t: 'LANG'; lang: 'ko' | 'en' }
  | { t: 'TOAST'; toast: AppState['toast'] }
  | { t: 'SET_ACTIVATION'; key: string; patch: Partial<ActState>; actor?: string }
  | { t: 'SET_LIFECYCLE'; feature: string; to: M.Lifecycle; actor: string }
  | { t: 'SET_CR_STATUS'; id: string; status: string }
  | { t: 'ADD_EXPERIMENT'; exp: Experiment }
  | { t: 'EXP_STATUS'; id: string; status: 'Draft' | 'Running' | 'Stopped' }
  | { t: 'ADD_EXCEPTION'; exc: Exception }
  | { t: 'EXC_REVOKE'; id: string }
  | { t: 'LIVE_TICK' }
  | { t: 'RESET' };

function reducer(s: AppState, a: Action): AppState {
  switch (a.t) {
    case 'ADD_FEATURE': return { ...s, features: [...s.features, a.f], toast: { msg: `${a.f.id} 등록됨`, kind: 'ok' } };
    case 'ADD_EDGE': return { ...s, edges: [...s.edges, a.e], toast: { msg: `엣지 추가: ${a.e.type}`, kind: 'ok' } };
    case 'CREATE_CR': return { ...s, crs: [a.cr, ...s.crs], toast: { msg: `${a.cr.id} 생성됨`, kind: 'ok' } };
    case 'KILL': return { ...s, runtime: { ...s.runtime, [a.feature]: 'disabled' },
      audit: [{ ts: nowish(), actor: a.actor, action: 'KILL', target: a.feature, detail: 'Safe Default=disabled' }, ...s.audit],
      toast: { msg: `${a.feature} Kill 실행 → Safe Default`, kind: 'warn' } };
    case 'RECOVER': return { ...s, runtime: { ...s.runtime, [a.feature]: 'enabled' } };
    case 'AUDIT': return { ...s, audit: [a.entry, ...s.audit] };
    case 'ROLE': return { ...s, role: a.role };
    case 'THEME': return { ...s, theme: a.theme };
    case 'LANG': return { ...s, lang: a.lang };
    case 'TOAST': return { ...s, toast: a.toast };
    case 'SET_ACTIVATION': {
      const cur = s.activation[a.key] || { enabled: false, rollout: 0, killed: false };
      const next = { ...cur, ...a.patch };
      const [fid, model] = a.key.split('@');
      return { ...s, activation: { ...s.activation, [a.key]: next },
        audit: [{ ts: nowish(), actor: a.actor || s.role, action: 'ACTIVATION', target: fid, detail: `${model}: ${next.killed ? 'KILLED' : next.enabled ? `ON ${next.rollout}%` : 'OFF'}` }, ...s.audit],
        toast: { msg: `${fid} · ${model} → ${next.killed ? 'Kill' : next.enabled ? `활성 ${next.rollout}%` : '비활성'}`, kind: next.killed ? 'warn' : 'ok' } };
    }
    case 'SET_LIFECYCLE':
      return { ...s, features: s.features.map(f => f.id === a.feature ? { ...f, lifecycle: a.to } : f),
        audit: [{ ts: nowish(), actor: a.actor, action: 'LIFECYCLE', target: a.feature, detail: `→ ${a.to}` }, ...s.audit],
        toast: { msg: `${a.feature} → ${a.to}`, kind: 'ok' } };
    case 'SET_CR_STATUS':
      return { ...s, crs: s.crs.map(c => c.id === a.id ? { ...c, status: a.status } : c), toast: { msg: `${a.id} → ${a.status}`, kind: 'ok' } };
    case 'ADD_EXPERIMENT': return { ...s, experiments: [a.exp, ...s.experiments], toast: { msg: `${a.exp.id} 실험 생성`, kind: 'ok' } };
    case 'EXP_STATUS': return { ...s, experiments: s.experiments.map(e => e.id === a.id ? { ...e, status: a.status } : e), toast: { msg: `실험 ${a.id} → ${a.status}`, kind: 'ok' } };
    case 'ADD_EXCEPTION': return { ...s, exceptions: [a.exc, ...s.exceptions], toast: { msg: `${a.exc.id} 예외정책 승인`, kind: 'ok' } };
    case 'EXC_REVOKE': return { ...s, exceptions: s.exceptions.map(e => e.id === a.id ? { ...e, active: false } : e), toast: { msg: `${a.id} 해제`, kind: 'warn' } };
    case 'LIVE_TICK': {
      const t = s.live.tick + 1;
      const activation = Math.max(90, Math.min(99.9, s.live.activation + (Math.random() - 0.5) * 1.4));
      const series = [...s.live.series.slice(1), Number(activation.toFixed(1))];
      const p95 = Math.max(28, Math.min(95, s.live.p95 + (Math.random() - 0.5) * 6));
      let events = s.live.events;
      let rollback = s.live.rollback;
      if (t % 2 === 0) {
        const k = EVK[t % EVK.length];
        if (k[0] === 'POLICY_ROLLBACK') rollback += 1;
        events = [{ type: k[0], detail: k[1], ts: clock() }, ...s.live.events].slice(0, 8);
      }
      return { ...s, live: { tick: t, activation: Number(activation.toFixed(1)), failRate: Number((100 - activation).toFixed(1)), rollback, p95: Math.round(p95), series, events } };
    }
    case 'RESET': { localStorage.removeItem('fp.state.v1'); return { ...initial }; }
    default: return s;
  }
}

// new Date()는 환경 제약과 무관 — 브라우저에서만 실행되므로 사용 가능
function nowish() { try { return new Date().toISOString().slice(0, 16).replace('T', ' '); } catch { return '2026-06-05 08:30'; } }

function load(): AppState {
  try {
    const raw = localStorage.getItem('fp.state.v1');
    if (raw) { const p = JSON.parse(raw); return { ...initial, ...p, toast: null }; }
  } catch {}
  return initial;
}

interface Ctx { state: AppState; dispatch: Dispatch<Action>; can: (verb: string) => boolean; }
const AppCtx = createContext<Ctx>(null as any);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  // 엔진 DB 동기화 + 영속 + 테마/언어 DOM 반영 (live·toast 제외 영속)
  useEffect(() => {
    setDB({ features: state.features, edges: state.edges, relations: state.relations });
    const { toast, live, ...persist } = state;
    try { localStorage.setItem('fp.state.v1', JSON.stringify(persist)); } catch {}
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.lang = state.lang;
  }, [state.features, state.edges, state.relations, state.crs, state.runtime, state.audit, state.role, state.theme, state.lang, state.activation, state.experiments, state.exceptions]);

  // 실시간 시뮬레이션 틱 (2초)
  useEffect(() => {
    const id = setInterval(() => dispatch({ t: 'LIVE_TICK' }), 2000);
    return () => clearInterval(id);
  }, []);

  const can = (verb: string) => (permMatrix[state.role] || []).includes(verb);
  return <AppCtx.Provider value={{ state, dispatch, can }}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

// 간편 토스트 — 비동작 버튼에 피드백 부여
export const useToast = () => {
  const { dispatch } = useApp();
  return (msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => dispatch({ t: 'TOAST', toast: { msg, kind } });
};

// 역할별 기본 랜딩(프리셋) — 역할 변경 시 이 화면으로 이동
export const roleHome: Record<string, string> = {
  '기획 P1': '/catalog',
  '시스템 P2': '/topology/FEAT-BDC-001',
  'SW P3': '/decisions/center',
  '검증 P4': '/readiness/FEAT-BDC-001',
  'OTA P5': '/ops/campaign',
  '협력사 P6': '/supplier/portal',
  '운영 P7': '/ops/FEAT-BDC-001',
  'Admin': '/admin/permissions',
};

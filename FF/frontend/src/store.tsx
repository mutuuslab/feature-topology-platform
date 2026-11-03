// 앱 UI 상태 — 역할·부서 보기·테마·언어·토스트만 둔다. 업무 데이터(Feature·Baseline·정책·차단…)는 서버가 원천이고 react-query(api/hooks)로 읽는다.
// P10-C3: 레거시 인메모리 모델(구 Feature 시드·CR·제안·Revision·활성화·실시간 시뮬레이션 틱)을 걷어냈다.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { permMatrix, roles } from './data/refdata';
import { ALL_DEPARTMENTS, departmentById, isDepartment } from './data/departments';

export interface AppState {
  role: string;
  /** 부서 보기(데모) — 'ALL'이면 전체 보기(MENU 2.0 8그룹), 부서 ID면 그 부서의 메뉴·작업공간 */
  department: string;
  theme: 'light' | 'dark';
  lang: 'ko' | 'en';
  toast?: { msg: string; kind: 'ok' | 'warn' | 'err' } | null;
}

export const initial: AppState = { role: 'author', department: ALL_DEPARTMENTS, theme: 'light', lang: 'ko', toast: null };

type Action =
  | { t: 'ROLE'; role: string }
  /** 부서를 바꾸면 역할도 그 부서의 데모 계정으로 — role을 주지 않으면 부서의 기본 계정 */
  | { t: 'DEPT'; department: string; role?: string }
  | { t: 'THEME'; theme: 'light' | 'dark' }
  | { t: 'LANG'; lang: 'ko' | 'en' }
  | { t: 'TOAST'; toast: AppState['toast'] };

export function reducer(s: AppState, a: Action): AppState {
  switch (a.t) {
    // 부서 보기에서 그 부서의 데모 계정이 아닌 역할로 바뀌면(따라하기 단계 등) 전체 보기로 — 부서 안 역할 선택기와 어긋나지 않게
    case 'ROLE': return { ...s, role: a.role, department: isDepartment(s.department) && !departmentById(s.department)!.personas.includes(a.role) ? ALL_DEPARTMENTS : s.department };
    case 'DEPT': {
      if (!isDepartment(a.department)) return { ...s, department: ALL_DEPARTMENTS, role: a.role && roles.includes(a.role) ? a.role : s.role };
      const d = departmentById(a.department)!;
      const role = a.role && d.personas.includes(a.role) ? a.role : d.personas.includes(s.role) && !a.role ? s.role : d.personas[0];
      return { ...s, department: d.id, role };
    }
    case 'THEME': return { ...s, theme: a.theme };
    case 'LANG': return { ...s, lang: a.lang };
    case 'TOAST': return { ...s, toast: a.toast };
    default: return s;
  }
}

const KEY = 'fp.state.v2';

function load(): AppState {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p) {
      // 저장된 역할이 기준 9역할 키가 아니면(구버전 라벨) 기본 역할로 — 권한 게이트는 permMatrix[역할키]로만 판정한다.
      const role = roles.includes(p.role) ? p.role : initial.role;
      // 저장된 부서가 없거나 바뀐 모델에 없으면 전체 보기 — 부서의 데모 계정이 아닌 역할이면 부서의 기본 계정으로
      const d = isDepartment(p.department) ? departmentById(p.department)! : null;
      return {
        role: d && !d.personas.includes(role) ? d.personas[0] : role,
        department: d ? d.id : ALL_DEPARTMENTS,
        theme: p.theme === 'dark' ? 'dark' : 'light',
        lang: p.lang === 'en' ? 'en' : 'ko',
        toast: null,
      };
    }
  } catch {}
  return initial;
}

interface Ctx { state: AppState; dispatch: Dispatch<Action>; can: (verb: string) => boolean; }
interface ApiCtx { dispatch: Dispatch<Action>; can: (verb: string) => boolean; }
/** 셸이 참조하는 안정 슬라이스 — 토스트가 바뀌어도 값이 그대로다. */
interface ShellCtx { role: string; department: string; navMode: 'function'; lang: string; theme: string; }

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
const AppApiCtx = createContext<ApiCtx>({ dispatch: () => {}, can: () => false });
const AppShellCtx = createContext<ShellCtx>({ role: initial.role, department: initial.department, navMode: 'function', lang: initial.lang, theme: initial.theme });

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  // 영속(토스트 제외) + 테마·언어 DOM 반영
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ role: state.role, department: state.department, theme: state.theme, lang: state.lang })); } catch {}
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.lang = state.lang;
  }, [state.role, state.department, state.theme, state.lang]);

  const can = useCallback((verb: string) => (permMatrix[state.role] || []).includes(verb), [state.role]);
  const api = useMemo<ApiCtx>(() => ({ dispatch, can }), [can]);
  const shell = useMemo<ShellCtx>(
    () => ({ role: state.role, department: state.department, navMode: 'function', lang: state.lang, theme: state.theme }),
    [state.role, state.department, state.lang, state.theme],
  );
  const app = useMemo<Ctx>(() => ({ state, dispatch, can }), [state, can]);

  return (
    <AppApiCtx.Provider value={api}>
      <AppShellCtx.Provider value={shell}>
        <AppCtx.Provider value={app}>{children}</AppCtx.Provider>
      </AppShellCtx.Provider>
    </AppApiCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);

/** 액션·권한 전용 구독. */
export const useAppApi = () => useContext(AppApiCtx);

/** 언어·테마·역할 전용 구독. */
export const useAppShell = () => useContext(AppShellCtx);

// 간편 토스트
export const useToast = () => {
  const { dispatch } = useAppApi();
  return (msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => dispatch({ t: 'TOAST', toast: { msg, kind } });
};

/** 역할별 첫 진입 화면 (v2 경로). '내 대시보드'는 메뉴로 간다. */
export const roleHome: Record<string, string> = {
  author: '/master/define', // Feature 등록
  approver: '/admin/approval', // 검토함
  quality: '/verify/evidence', // 품질 기준·Evidence
  operator: '/fleet/live', // 차량 운영 현황
  steward: '/master/upg', // UPG·UPG-VC
  commerce: '/products', // Catalog 상품
  integrator: '/integration/connectors', // 외부 시스템 연계
  coordinator: '/analysis/impact', // 변경 영향 분석
  viewer: '/audit', // 감사 이력
};

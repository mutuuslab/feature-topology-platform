// 대시보드 저장 — 서버 우선(/api/dashboards: 소유·역할 공유·버전 412). 정적 데모(VITE_DATA_MODE=static, 백엔드 없음)는
// 같은 규칙으로 이 브라우저의 localStorage에 둔다. 역할별 시스템 대시보드는 저장하지 않는다(catalog.ts systemBoard).
// 판을 바꾸면 화면 캐시를 먼저 바꾸고(낙관적), 저장은 차례로 보낸다 — 앞 저장의 새 버전으로 다음 저장의 If-Match를 건다.
// 겹친 저장(412)·실패면 서버 판을 다시 읽어 화면을 맞춘다. 옛 판(v1, 역할별 localStorage)은 처음 한 번 내 대시보드로 옮긴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canViewDashboard, type DashboardView, type Role } from '@ff/contracts';
import { actorFor, rolesFor } from '../../../api/actor';
import { ApiError, call, STATIC_MODE } from '../../../api/client';
import { dashboard } from '../../../copy/dashboard';
import { systemBoard } from './catalog';
import { clearV1, emptyBoard, readV1, type Board } from './layout';

const B = dashboard.board;
export const SYSTEM_ID = 'system';

export interface Dash extends DashboardView {
  /** 역할별 시스템 대시보드 — 저장하지 않고 바꿀 수 없다(편집하면 사본) */
  system?: boolean;
}

type Patch = { name?: string; board?: Board; sharedRoles?: Role[] };

export interface DashboardBackend {
  list(): Promise<DashboardView[]>;
  create(input: { name: string; board: Board; sharedRoles: Role[] }): Promise<DashboardView>;
  update(id: string, version: number, patch: Patch): Promise<DashboardView>;
  remove(id: string, version: number): Promise<void>;
  favourite(id: string, favourite: boolean): Promise<DashboardView>;
}

/** 서버 — 행위자 머리글·Idempotency-Key는 API 클라이언트가 붙인다 */
export function serverBackend(role: string): DashboardBackend {
  return {
    list: () => call<{ items: DashboardView[] }>('listDashboards', { role }).then((r) => (Array.isArray(r?.items) ? r.items : [])),
    create: (body) => call<DashboardView>('createDashboard', { role, body }),
    update: (id, version, patch) => call<DashboardView>('updateDashboard', { role, params: { id }, body: patch, ifMatch: version }),
    remove: (id, version) => call('deleteDashboard', { role, params: { id }, body: {}, ifMatch: version }).then(() => undefined),
    favourite: (id, favourite) => call<DashboardView>('favouriteDashboard', { role, params: { id }, body: { favourite } }),
  };
}

// ───────── 정적 데모 — 서버와 같은 규칙(소유·공유·버전)을 이 브라우저 안에서 ─────────

const LOCAL_KEY = 'ff.dashboards.v2';
interface Stored {
  id: string;
  ownerId: string;
  name: string;
  board: Board;
  sharedRoles: Role[];
  version: number;
  createdAt: string;
  updatedAt: string;
  stars: string[];
}

function readLocal(): Stored[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null');
    return Array.isArray(v?.items) ? v.items : [];
  } catch {
    return [];
  }
}
function writeLocal(items: Stored[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ items }));
  } catch {
    /* 저장소를 못 쓰면 이번 세션만 */
  }
}

const conflict = (version: number) => new ApiError(412, 'PRECONDITION_FAILED', B.saveFailed, { version });
const forbidden = () => new ApiError(403, 'FORBIDDEN', B.saveFailed);
const notFound = () => new ApiError(404, 'NOT_FOUND', B.saveFailed);

export function localBackend(me: { id: string; roles: string[] }): DashboardBackend {
  const view = (s: Stored): DashboardView => ({
    id: s.id,
    name: s.name,
    ownerId: s.ownerId,
    sharedRoles: s.sharedRoles,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    favourite: s.stars.includes(me.id),
    mine: s.ownerId === me.id,
    board: s.board,
  });
  const find = (id: string) => {
    const items = readLocal();
    const i = items.findIndex((x) => x.id === id && canViewDashboard(x, me));
    if (i < 0) throw notFound();
    return { items, i };
  };
  const owned = (id: string, version: number) => {
    const r = find(id);
    if (r.items[r.i].ownerId !== me.id) throw forbidden();
    if (r.items[r.i].version !== version) throw conflict(r.items[r.i].version);
    return r;
  };
  return {
    list: async () =>
      readLocal()
        .filter((x) => canViewDashboard(x, me))
        .sort((a, b) => Number(b.ownerId === me.id) - Number(a.ownerId === me.id) || b.updatedAt.localeCompare(a.updatedAt))
        .map(view),
    create: async ({ name, board, sharedRoles }) => {
      const at = new Date().toISOString();
      const s: Stored = { id: `DSH-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`, ownerId: me.id, name, board, sharedRoles, version: 1, createdAt: at, updatedAt: at, stars: [] };
      writeLocal([...readLocal(), s]);
      return view(s);
    },
    update: async (id, version, patch) => {
      const { items, i } = owned(id, version);
      items[i] = { ...items[i], ...patch, version: items[i].version + 1, updatedAt: new Date().toISOString() };
      writeLocal(items);
      return view(items[i]);
    },
    remove: async (id, version) => {
      const { items, i } = owned(id, version);
      items.splice(i, 1);
      writeLocal(items);
    },
    favourite: async (id, favourite) => {
      const { items, i } = find(id);
      const stars = new Set(items[i].stars);
      if (favourite) stars.add(me.id);
      else stars.delete(me.id);
      items[i] = { ...items[i], stars: [...stars] };
      writeLocal(items);
      return view(items[i]);
    },
  };
}

// ───────── 화면 선호(지금 연 대시보드·시스템 대시보드 별) — 계정별 localStorage ─────────

const pref = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    } catch {
      /* 무시 */
    }
  },
};
const CURRENT = (actor: string) => `ff.dashboard.current.${actor}`;
const SYSTEM_STAR = (actor: string) => `ff.dashboard.systemStar.${actor}`;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** 대시보드 목록·지금 대시보드·저장 동작 — Dashboard.tsx가 쓴다 */
export function useDashboards(role: string) {
  const me = actorFor(role);
  const myRoles = rolesFor(role);
  const backend = useMemo(() => (STATIC_MODE ? localBackend({ id: me.id, roles: myRoles }) : serverBackend(role)), [role, me.id, myRoles.join()]);
  const qc = useQueryClient();
  const key = useMemo(() => ['listDashboards', {}, {}, role], [role]);
  const q = useQuery<DashboardView[], ApiError>({ queryKey: key, queryFn: () => backend.list(), staleTime: 30_000, retry: false });
  const [systemStar, setSystemStar] = useState(() => pref.get(SYSTEM_STAR(me.id)) === '1');
  const [currentId, setCurrentId] = useState<string>(() => pref.get(CURRENT(me.id)) ?? SYSTEM_ID);
  const [forActor, setForActor] = useState(me.id);
  if (forActor !== me.id) {
    // 역할(계정)을 바꾸면 그 계정이 마지막으로 연 대시보드
    setForActor(me.id);
    setCurrentId(pref.get(CURRENT(me.id)) ?? SYSTEM_ID);
    setSystemStar(pref.get(SYSTEM_STAR(me.id)) === '1');
  }
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const system: Dash = useMemo(
    () => ({ id: SYSTEM_ID, name: B.systemName, ownerId: 'system', sharedRoles: [], version: 0, createdAt: '', updatedAt: '', favourite: systemStar, mine: false, system: true, board: systemBoard(role) }),
    [role, systemStar],
  );
  const items: Dash[] = q.data ?? [];
  const known = items.find((d) => d.id === currentId);
  // 아직 목록을 받는 중이면 지금 대시보드를 판정하지 않는다(시스템 판이 잠깐 보였다 바뀌지 않게)
  const loading = currentId !== SYSTEM_ID && q.isPending;
  const current: Dash = known ?? system;

  const select = useCallback(
    (id: string) => {
      setCurrentId(id);
      pref.set(CURRENT(me.id), id === SYSTEM_ID ? null : id);
    },
    [me.id],
  );

  // 화면 캐시를 바꾸기 전에 받는 중인 목록 조회를 멈춘다 — 늦게 온 옛 목록이 방금 만든·바꾼 판을 덮지 않게
  const patchCache = useCallback(
    (id: string, fn: (d: DashboardView) => DashboardView) => {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<DashboardView[]>(key, (old) => old?.map((d) => (d.id === id ? fn(d) : d)));
    },
    [qc, key],
  );
  const addCache = useCallback(
    (d: DashboardView) => {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<DashboardView[]>(key, (old) => [d, ...(old ?? []).filter((x) => x.id !== d.id)]);
    },
    [qc, key],
  );
  const resync = useCallback(() => qc.invalidateQueries({ queryKey: ['listDashboards'] }), [qc]);

  /** 차례로 저장 — 앞 저장이 받은 버전으로 다음 저장의 If-Match를 건다 */
  const persist = useCallback(
    (id: string, patch: Patch) => {
      setSaveState('saving');
      chain.current = chain.current.then(async () => {
        const latest = qc.getQueryData<DashboardView[]>(key)?.find((d) => d.id === id);
        if (!latest) return;
        try {
          const doc = await backend.update(id, latest.version, patch);
          patchCache(id, (d) => ({ ...d, version: doc.version, updatedAt: doc.updatedAt, name: patch.name !== undefined ? doc.name : d.name, sharedRoles: patch.sharedRoles ? doc.sharedRoles : d.sharedRoles }));
          setSaveError(null);
          setSaveState('saved');
        } catch (e) {
          setSaveError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', B.saveFailed));
          setSaveState('error');
          await resync();
        }
      });
      return chain.current;
    },
    [backend, key, patchCache, qc, resync],
  );

  /** 판 바꾸기 — 내 대시보드만(시스템·공유받은 판은 화면이 사본을 먼저 만든다) */
  const updateBoard = useCallback(
    (fn: (b: Board) => Board) => {
      if (!current.mine) return;
      const next = fn(current.board);
      if (next === current.board) return;
      patchCache(current.id, (d) => ({ ...d, board: next }));
      void persist(current.id, { board: next });
    },
    [current, patchCache, persist],
  );

  const create = useCallback(
    async (name: string, board: Board = emptyBoard('2')) => {
      const d = await backend.create({ name, board, sharedRoles: [] });
      addCache(d);
      select(d.id);
      return d;
    },
    [addCache, backend, select],
  );

  const rename = useCallback(
    (name: string) => {
      if (!current.mine) return;
      patchCache(current.id, (d) => ({ ...d, name }));
      return persist(current.id, { name });
    },
    [current, patchCache, persist],
  );

  const share = useCallback(
    (sharedRoles: Role[]) => {
      if (!current.mine) return;
      patchCache(current.id, (d) => ({ ...d, sharedRoles }));
      return persist(current.id, { sharedRoles });
    },
    [current, patchCache, persist],
  );

  const remove = useCallback(async () => {
    if (!current.mine) return;
    await chain.current;
    const v = qc.getQueryData<DashboardView[]>(key)?.find((d) => d.id === current.id)?.version ?? current.version;
    await backend.remove(current.id, v);
    qc.setQueryData<DashboardView[]>(key, (old) => old?.filter((d) => d.id !== current.id));
    select(SYSTEM_ID);
  }, [backend, current, key, qc, select]);

  const favourite = useCallback(
    async (d: Dash) => {
      if (d.system) {
        const on = !systemStar;
        setSystemStar(on);
        pref.set(SYSTEM_STAR(me.id), on ? '1' : null);
        return;
      }
      patchCache(d.id, (x) => ({ ...x, favourite: !d.favourite }));
      try {
        const doc = await backend.favourite(d.id, !d.favourite);
        patchCache(d.id, (x) => ({ ...x, favourite: doc.favourite }));
      } catch {
        await resync();
      }
    },
    [backend, me.id, patchCache, resync, systemStar],
  );

  // 옛 판(v1) 옮기기 — 목록을 받은 뒤 한 번. 만들기에 성공해야 v1을 지운다(실패하면 다음에 다시)
  const migrating = useRef(false);
  useEffect(() => {
    if (!q.data || migrating.current) return;
    const v1 = readV1(role);
    if (!v1) return;
    migrating.current = true;
    backend
      .create({ name: B.migratedName, board: v1, sharedRoles: [] })
      .then((d) => {
        clearV1(role);
        addCache(d);
        select(d.id);
      })
      .catch(() => undefined)
      .finally(() => {
        migrating.current = false;
      });
  }, [q.data, role, backend, addCache, select]);

  return {
    me,
    items,
    system,
    current,
    loading,
    listError: q.error ?? null,
    select,
    updateBoard,
    create,
    rename,
    share,
    remove,
    favourite,
    resetLayout: () => updateBoard(() => systemBoard(role)),
    saveState,
    saveError,
    clearSaveError: () => setSaveError(null),
    local: STATIC_MODE,
  };
}

export type DashboardsApi = ReturnType<typeof useDashboards>;

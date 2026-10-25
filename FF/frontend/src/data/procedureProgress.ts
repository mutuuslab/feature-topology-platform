// 업무 절차 진행 상태 — 서버(활동 완료 API)가 정본이고, 화면은 낙관적으로 먼저 그린 뒤 저장한다.
// 백엔드가 없거나 정적 데모(STATIC_MODE)면 localStorage만 쓴다(예전 ff.proc.done 키는 활동 ID로 옮긴다).
// 화면 패널·절차 상세·허브가 같은 상태를 보도록 외부 스토어로 둔다.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ProcedureCompleteBody, ProcedureCompletion, ProcedureInboxView, ProcedureStateView, ProcedureSummary } from '@ff/contracts';
import { call, STATIC_MODE, type ApiError } from '../api/client';

const KEY = 'ff.proc.done.v2';
const OLD_KEY = 'ff.proc.done';
type Done = Record<string, boolean>;

const readLocal = (): Done => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Done;
    // 예전(역할:활동) 저장 — 활동 ID만 남긴다
    const old = localStorage.getItem(OLD_KEY);
    if (!old) return {};
    const parsed = JSON.parse(old) as Record<string, boolean>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v).map(([k]) => [k.split(':').pop()!, true]));
  } catch {
    return {};
  }
};
const writeLocal = (m: Done) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 저장할 수 없는 브라우저(사생활 모드)에서도 화면은 동작한다 */
  }
};

let done: Done = typeof localStorage === 'undefined' ? {} : readLocal();
let items: ProcedureCompletion[] = [];
let status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let error: string | null = null;
let loadedRole: string | null = null;
/** 백엔드에 닿지 않으면 이 브라우저 저장으로 계속한다 — 완료를 되돌리지 않는다(데모·오프라인) */
let offline = false;
let version = 0;
/** 완료 집합이 실제로 바뀐 횟수 — 검토함·요약은 이것이 바뀔 때만 다시 읽는다(불러오는 중·오류 표시 변화로 다시 읽지 않는다) */
let doneVersion = 0;
const sameDone = (a: Done, b: Done) => {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => b[k]);
};
const listeners = new Set<() => void>();
let hydrating: Promise<void> | null = null;

const emit = () => {
  version += 1;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const setDone = (next: Done) => {
  if (!sameDone(done, next)) doneVersion += 1;
  done = next;
  writeLocal(next);
  emit();
};

const snapshot = () => ({ done, items, status, error, version });
export type ProcedureSnapshot = ReturnType<typeof snapshot>;

/** 서버 완료 상태를 한 번 읽는다 — 역할이 바뀌면 다시 읽는다. 실패해도 로컬 상태로 화면은 계속 동작한다. */
function hydrate(role: string): void {
  if (STATIC_MODE) {
    status = 'ready';
    return;
  }
  if (loadedRole === role && status !== 'error' && status !== 'idle') return;
  if (hydrating) return;
  loadedRole = role;
  status = 'loading';
  error = null;
  emit();
  hydrating = call<ProcedureStateView>('procedureState', { role })
    .then((s) => {
      items = s.items;
      // 서버가 정본 — 이 브라우저에만 있던 완료는 서버에 없으면 지운다(정적 데모에서는 그대로 둔다)
      const next: Done = Object.fromEntries(s.done.map((id) => [id, true]));
      if (!sameDone(done, next)) doneVersion += 1;
      done = next;
      writeLocal(done);
      status = 'ready';
    })
    .catch((e: ApiError) => {
      // 백엔드가 없는 데모에서도 로컬 완료 표시는 유지한다
      if (e.status === 0) offline = true;
      status = 'error';
      error = e.status === 0 ? '플랫폼 백엔드에 연결할 수 없어 이 브라우저에만 저장합니다.' : e.message;
    })
    .finally(() => {
      hydrating = null;
      emit();
    });
}

async function complete(role: string, activityId: string, body: ProcedureCompleteBody): Promise<void> {
  if (done[activityId]) return;
  const before = { ...done };
  setDone({ ...done, [activityId]: true });
  if (STATIC_MODE || offline) return;
  try {
    const r = await call<{ completion: ProcedureCompletion }>('completeProcedureActivity', { role, params: { id: activityId }, body });
    items = [...items.filter((i) => i.activityId !== activityId), r.completion];
    status = 'ready';
    error = null;
    // 서버가 완료를 기록했다 — 검토함·요약(기한·다음 차례)을 다시 읽게 한다
    doneVersion += 1;
  } catch (e) {
    const err = e as ApiError;
    // 백엔드에 닿지 않으면 로컬 저장으로 계속한다 — 방금 표시한 완료를 되돌리지 않는다
    if (err.status === 0) {
      offline = true;
      status = 'error';
      error = '플랫폼 백엔드에 연결할 수 없어 이 브라우저에만 저장합니다.';
      emit();
      return;
    }
    setDone(before);
    error = err.message;
    emit();
    throw err;
  }
  emit();
}

async function undo(role: string, activityId: string): Promise<void> {
  if (!done[activityId]) return;
  const before = { ...done };
  const next = { ...done };
  delete next[activityId];
  setDone(next);
  if (STATIC_MODE || offline) return;
  try {
    const s = await call<ProcedureStateView>('undoProcedureActivity', { role, params: { id: activityId } });
    items = s.items;
    status = 'ready';
    error = null;
    doneVersion += 1;
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 0) {
      offline = true;
      status = 'error';
      error = '플랫폼 백엔드에 연결할 수 없어 이 브라우저에만 저장합니다.';
      emit();
      return;
    }
    setDone(before);
    error = err.message;
    emit();
    throw err;
  }
  emit();
}

export const procedureStore = {
  subscribe,
  snapshot,
  hydrate,
  complete,
  undo,
  isDone: (activityId: string) => !!done[activityId],
  doneOf: () => done,
};

/** 활동 완료 상태 — 역할 기준 진행률과 완료/취소를 함께 준다 */
export function useProgress(role: string, enabled = true) {
  useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    // enabled=false — 서버를 읽지 않는다(디자인 갤러리 견본처럼 고정 상태로 그릴 때)
    if (enabled) hydrate(role);
  }, [role, enabled]);
  return {
    isDone: (activityId: string) => !!done[activityId],
    complete: (activityId: string, body: ProcedureCompleteBody) => complete(role, activityId, body),
    undo: (activityId: string) => undo(role, activityId),
    // 빠른 토글은 화면을 막지 않는다 — 거부(403/422)면 스토어가 되돌리고, 화면은 오류를 따로 보여 준다
    toggle: (activityId: string) =>
      (done[activityId] ? undo(role, activityId) : complete(role, activityId, { evidence: [], sign: false })).catch(() => undefined),
    doneCount: (activityIds: readonly string[]) => activityIds.filter((id) => done[id]).length,
    doneIds: () => Object.keys(done),
    items,
    status,
    error,
  };
}

/** 시험 전용 — localStorage를 비운 뒤 모듈 상태를 다시 읽는다 */
export function __resetProcedureStore(): void {
  done = typeof localStorage === 'undefined' ? {} : readLocal();
  items = [];
  status = 'idle';
  error = null;
  loadedRole = null;
  offline = false;
  hydrating = null;
  emit();
}

export interface InboxState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: ProcedureInboxView | null;
  error: string | null;
}

/** 내 검토함 — 서버가 계산한 준비 활동(수행·책임)과 SLA. 완료가 바뀌면 다시 읽는다. */
export function useProcedureInbox(role: string): InboxState {
  useSyncExternalStore(subscribe, () => doneVersion, () => doneVersion);
  const [state, setState] = useState<InboxState>({ status: STATIC_MODE ? 'ready' : 'idle', data: null, error: null });
  useEffect(() => {
    if (STATIC_MODE) return;
    let live = true;
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading' }));
    call<ProcedureInboxView>('procedureInbox', { role })
      .then((data) => live && setState({ status: 'ready', data, error: null }))
      .catch((e: ApiError) => live && setState({ status: 'error', data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [role, doneVersion]);
  return state;
}

/** 메뉴 배지용 요약 — 가볍게 한 번(할 일·검토·기한 초과) */
export function useProcedureSummary(role: string, enabled = true): ProcedureSummary | null {
  useSyncExternalStore(subscribe, () => doneVersion, () => doneVersion);
  const [summary, setSummary] = useState<ProcedureSummary | null>(null);
  useEffect(() => {
    if (STATIC_MODE || !enabled) return;
    let live = true;
    call<ProcedureSummary>('procedureSummary', { role })
      // 옛 백엔드·모의 응답(processes 없음)은 지도에 쓰지 않는다 — 잘못된 진행률보다 빈 상태가 낫다
      .then((s) => live && setSummary(s && Array.isArray(s.processes) ? s : null))
      // 백엔드가 없으면 배지를 그리지 않는다 — 실패로 화면을 흔들지 않는다
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [role, enabled, doneVersion]);
  return summary;
}

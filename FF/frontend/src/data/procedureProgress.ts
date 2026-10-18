// 업무 절차 진행 상태 — 데모는 이 브라우저에만 저장한다(서버 저장은 후속: 활동 완료 API).
// 화면 패널·절차 상세·허브가 같은 상태를 보도록 외부 스토어로 둔다.
import { useSyncExternalStore } from 'react';

const KEY = 'ff.proc.done';
type DoneMap = Record<string, boolean>;

let version = 0;
const listeners = new Set<() => void>();

const read = (): DoneMap => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DoneMap) : {};
  } catch {
    return {};
  }
};
const write = (m: DoneMap) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 저장할 수 없는 브라우저(사생활 모드)에서도 화면은 동작한다 */
  }
};
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
const keyOf = (role: string, activityId: string) => `${role}:${activityId}`;

export const isDone = (role: string, activityId: string): boolean => !!read()[keyOf(role, activityId)];

export const setDone = (role: string, activityId: string, done: boolean): void => {
  const m = read();
  const k = keyOf(role, activityId);
  if (done) m[k] = true;
  else delete m[k];
  write(m);
  emit();
};

/** 역할 기준 진행 상태 — 토글하면 이 스토어를 쓰는 모든 화면이 다시 그린다 */
export function useProgress(role: string) {
  useSyncExternalStore(subscribe, () => version, () => version);
  return {
    isDone: (activityId: string) => isDone(role, activityId),
    toggle: (activityId: string) => setDone(role, activityId, !isDone(role, activityId)),
    doneCount: (activityIds: readonly string[]) => activityIds.filter((id) => isDone(role, id)).length,
  };
}

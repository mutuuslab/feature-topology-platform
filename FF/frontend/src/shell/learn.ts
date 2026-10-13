// 따라하기 진행 상태 — 화면 이동·새로고침에도 가이드 패널이 이어지도록 localStorage에 둔다. 여러 부품이 같은 값을 보도록 외부 저장소로 구독한다.
import { useSyncExternalStore } from 'react';

export type LearnMode = 'view' | 'auto' | 'self';
export interface LearnState {
  scenarioId: string;
  step: number;
  mode: LearnMode;
  startedAt: string;
  collapsed?: boolean;
}

const KEY = 'ff.learn.v1';
const EXPLAIN = 'ff.explain';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(): LearnState | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.scenarioId === 'string' && Number.isInteger(v.step) ? v : null;
  } catch {
    return null;
  }
}

let cache: LearnState | null = typeof localStorage === 'undefined' ? null : read();
let explain = typeof localStorage === 'undefined' ? false : localStorage.getItem(EXPLAIN) === '1';

export const learnStore = {
  get: () => cache,
  set(next: LearnState | null) {
    cache = next;
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
    emit();
  },
  patch(p: Partial<LearnState>) {
    if (cache) learnStore.set({ ...cache, ...p });
  },
  start(scenarioId: string, mode: LearnMode = 'view') {
    learnStore.set({ scenarioId, step: 0, mode, startedAt: new Date().toISOString() });
  },
  explain: () => explain,
  setExplain(on: boolean) {
    explain = on;
    localStorage.setItem(EXPLAIN, on ? '1' : '0');
    document.documentElement.setAttribute('data-explain', on ? 'on' : 'off');
    emit();
  },
  /** 시험용 — 저장소를 localStorage에서 다시 읽는다 */
  reload() {
    cache = read();
    explain = localStorage.getItem(EXPLAIN) === '1';
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useLearn = () => useSyncExternalStore(learnStore.subscribe, learnStore.get, () => null);
export const useExplain = () => useSyncExternalStore(learnStore.subscribe, learnStore.explain, () => false);

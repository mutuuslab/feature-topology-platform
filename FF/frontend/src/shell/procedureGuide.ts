// 표준 따라하기(활동판) 상태 — 화면 패널의 "따라하기"가 서랍을 닫고 셸의 가이드를 연다.
// 가이드 호스트는 이 상태가 있을 때만 업무 절차 데이터(211 KB)를 지연 로딩한다.
import { useSyncExternalStore } from 'react';

export interface ProcedureGuideTarget {
  activityId: string;
  processId: string;
}

let current: ProcedureGuideTarget | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};

export const procedureGuideStore = {
  open(activityId: string, processId: string) {
    current = { activityId, processId };
    emit();
  },
  close() {
    current = null;
    emit();
  },
  get: () => current,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export const useProcedureGuide = () => useSyncExternalStore(procedureGuideStore.subscribe, procedureGuideStore.get, () => null);
export const useProcedureGuideVersion = () => useSyncExternalStore(procedureGuideStore.subscribe, () => version, () => version);

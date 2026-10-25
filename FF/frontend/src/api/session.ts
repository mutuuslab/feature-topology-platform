// 로그인 세션 만료 상태(출시 준비 RD-UX-01) — 401을 받았는데 저장하지 않은 입력이 있으면 바로 로그인 화면으로 옮기지 않고
// 셸의 안내 띠(SessionExpiredBanner)가 "다시 로그인"을 묻는다. 입력이 없으면 지금 화면으로 돌아오는 로그인으로 바로 간다.
import { useSyncExternalStore } from 'react';

let expired = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isSessionExpired = () => expired;

export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  emit();
}

export function clearSessionExpired(): void {
  if (!expired) return;
  expired = false;
  emit();
}

export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => expired,
    () => false,
  );
}

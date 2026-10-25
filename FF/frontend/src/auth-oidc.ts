// 운영 빌드(VITE_AUTH=oidc) 로그인 상태 — 브라우저는 토큰을 보지 않는다. 백엔드(BFF)가 httpOnly 세션 쿠키를 쥐고,
// 화면은 GET /api/auth/me로 사용자·부여 역할을 읽는다. 로그인은 /api/auth/login(IdP로 이동), 로그아웃은 POST /api/auth/logout.
import type { Role } from '@ff/contracts';
import { useSyncExternalStore } from 'react';

export interface SsoUser {
  id: string;
  name: string | null;
  email: string | null;
  roles: Role[];
}

export type SsoStatus = 'loading' | 'authed' | 'anon';

let status: SsoStatus = 'loading';
let user: SsoUser | null = null;
let started = false;
/** 사용자가 로그아웃했다 — 그 뒤 늦게 돌아온 요청의 401로 IdP 로그인을 다시 시작하지 않는다(로그아웃이 되돌려지는 결함) */
let loggedOut = false;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};

/** 서버에 묻는다(처음 한 번 + 로그아웃 뒤) */
export async function refreshSso(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const me = res.ok ? ((await res.json()) as { authenticated?: boolean; user?: SsoUser }) : null;
    user = me?.authenticated && me.user ? me.user : null;
  } catch {
    user = null;
  }
  status = user ? 'authed' : 'anon';
  if (user) loggedOut = false;
  emit();
}

const ensure = () => {
  if (started) return;
  started = true;
  void refreshSso();
};

export const ssoUser = (): SsoUser | null => user;
export const ssoStatus = (): SsoStatus => status;
/** 이 화면에서 로그아웃했는가 — 401 자동 재로그인을 멈춘다(로그인 버튼은 그대로 IdP로 간다) */
export const ssoLoggedOut = (): boolean => loggedOut;

/** 지금 화면 경로를 되돌아올 곳으로 IdP 로그인을 시작한다 — 경로는 서버가 다시 거른다(같은 출처 상대 경로만) */
export function startSsoLogin(returnTo?: string): void {
  const back = returnTo ?? window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(back.startsWith('/login') ? '/' : back)}`);
}

/** 로그아웃 — 서버 세션을 지우고, IdP 로그아웃 주소가 있으면 그리로 */
export async function ssoLogout(): Promise<string | null> {
  // 서버 세션을 지우는 동안·뒤에 끝나는 요청(대시보드·알림 조회)은 401을 받는다 — 먼저 표시해 둔다
  loggedOut = true;
  let end: string | null = null;
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
    if (res.ok) end = ((await res.json()) as { endSessionUrl?: string }).endSessionUrl ?? null;
  } catch {
    /* 서버에 닿지 않아도 화면 상태는 로그아웃 */
  }
  user = null;
  status = 'anon';
  emit();
  return end;
}

export function useSso(): { status: SsoStatus; user: SsoUser | null } {
  ensure();
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => version,
    () => version,
  );
  return { status, user };
}

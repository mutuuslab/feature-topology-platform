// 로그인 상태 창구 — 빌드 상수 OIDC_AUTH(auth-mode.ts)로 데모(auth-demo.ts)·SSO(auth-oidc.ts) 중 하나만 쓴다.
// 갈래가 상수라 운영 빌드에서는 데모 모듈이 번들에서 빠진다(tools/prod-bundle.test.ts).
import * as demo from './auth-demo';
import { OIDC_AUTH } from './auth-mode';
import * as sso from './auth-oidc';
import { clearSessionExpired } from './api/session';

export type AuthStatus = 'loading' | 'authed' | 'anon';

/** 화면 게이트 — 로그인 확인 중이면 loading(SSO는 서버에 묻는 동안) */
export function useAuthStatus(): AuthStatus {
  if (OIDC_AUTH) return sso.useSso().status;
  return demo.useDemoAuth() ? 'authed' : 'anon';
}

export const useAuth = (): boolean => useAuthStatus() === 'authed';

/** 로그아웃 — SSO면 IdP 로그아웃 주소(있으면)를 돌려준다 */
export async function logout(): Promise<string | null> {
  if (OIDC_AUTH) return sso.ssoLogout();
  demo.logout();
  return null;
}

/** 다시 로그인(세션 만료 401 뒤, RD-UX-01) — SSO는 지금 화면으로 돌아오는 IdP 로그인, 데모는 로그인 화면으로 */
export function relogin(): void {
  clearSessionExpired();
  if (OIDC_AUTH) sso.startSsoLogin();
  else demo.logout();
}

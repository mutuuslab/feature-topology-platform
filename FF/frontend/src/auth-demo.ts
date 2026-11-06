// 데모 로그인 — 데모 빌드(VITE_AUTH=demo, 기본)에서만 쓴다. 정적 데모(Cloudflare)에서도 동작하도록 브라우저에만 세션을 둔다.
// 실제 IAM·SSO가 아니라 화면 게이트다: ID/PW는 번들에 있고 서버 인증이 아니다. 운영 빌드(VITE_AUTH=oidc)는 이 모듈을 싣지 않는다
// (auth.ts가 상수 OIDC_AUTH로 갈래를 고르고, tools/prod-bundle.test.ts가 표식 DEMO_LOGIN_MARKER·비밀번호가 번들에 없는지 본다).
// 세션은 localStorage(ff.auth) — e2e의 storageState와 단위 시험이 같은 키로 미리 로그인 상태를 만든다.
// 상태를 모듈에 캐시하지 않고 매번 저장소를 읽는다: 하네스가 모듈 로드 뒤에 키를 심어도 즉시 반영된다.
import { useSyncExternalStore } from 'react';

/** 번들 검사 표식 — 데모 로그인 폼(data-demo-login)이 쓴다. 운영 빌드에 이 문자열이 있으면 데모 로그인이 실린 것이다 */
export const DEMO_LOGIN_MARKER = 'ff-demo-login-v1';
export const DEMO_ID = 'FF';
export const DEMO_PW = 'FF';
const KEY = 'ff.auth';

let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** 화면 로그인 표식(ff.auth)을 세운다 — 서버 게이트가 승인했을 때(auth-gate.ts)도 쓴다 */
export function markAuthed(): true {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* 저장할 수 없는 브라우저에서도 이 탭에서는 로그인 상태를 유지한다 */
  }
  emit();
  return true;
}

/** 공개 데모 ID·비밀번호는 대소문자를 구분하지 않는다. ID의 앞뒤 공백만 지운다. */
export function login(id: string, password: string): boolean {
  if (id.trim().toUpperCase() !== DEMO_ID || password.toUpperCase() !== DEMO_PW) return false;
  return markAuthed();
}

// 공개 사이트 접속 게이트(Cloudflare Pages, FF/functions/_middleware.ts) — 정적 빌드의 로그인은 auth-gate.ts(로그인 누를 때 지연 로드)가 맡는다.
// 빌드 상수지만 호출할 때 읽는다(시험이 vi.stubEnv로 바꾼다).
export const staticSite = (): boolean => import.meta.env.VITE_DATA_MODE === 'static';

export function logout(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  // 정적 사이트는 서버 쿠키도 지운다(게이트가 없으면 404 — 무시)
  if (staticSite()) void fetch(`${import.meta.env.BASE_URL}__auth/logout`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  emit();
}

export const isAuthed = (): boolean => read();

export function useDemoAuth(): boolean {
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
  return read();
}

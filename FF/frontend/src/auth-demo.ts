// 데모 로그인 — 데모 빌드(VITE_AUTH=demo, 기본)에서만 쓴다. 정적 데모(Cloudflare)에서도 동작하도록 브라우저에만 세션을 둔다.
// 실제 IAM·SSO가 아니라 화면 게이트다: ID/PW는 번들에 있고 서버 인증이 아니다. 운영 빌드(VITE_AUTH=oidc)는 이 모듈을 싣지 않는다
// (auth.ts가 상수 OIDC_AUTH로 갈래를 고르고, tools/prod-bundle.test.ts가 표식 DEMO_LOGIN_MARKER·비밀번호가 번들에 없는지 본다).
// 세션은 localStorage(ff.auth) — e2e의 storageState와 단위 시험이 같은 키로 미리 로그인 상태를 만든다.
// 상태를 모듈에 캐시하지 않고 매번 저장소를 읽는다: 하네스가 모듈 로드 뒤에 키를 심어도 즉시 반영된다.
// 공개 데모 게이트(백엔드 FF_DEMO_GATE=on, 클라우드 VM 20-99): 서버가 같은 ID/PW로 세션 쿠키를 준다 — 그때는 서버 판정이 기준이고
// (서버 비밀번호를 바꿔도 동작), 서버 세션이 끝나면(401) 화면도 로그인으로 돌아간다. 게이트 없는 백엔드·정적 데모는 지금처럼 브라우저 판정.
import { useSyncExternalStore } from 'react';
import { isLocalFile } from './file-routing';

/** 번들 검사 표식 — 데모 로그인 폼(data-demo-login)이 쓴다. 운영 빌드에 이 문자열이 있으면 데모 로그인이 실린 것이다 */
export const DEMO_LOGIN_MARKER = 'ff-demo-login-v1';
export const DEMO_ID = 'FF';
export const DEMO_PW = 'FF';
const KEY = 'ff.auth';
/** 서버 게이트 세션으로 로그인했다 — 401이면 화면 로그인도 끝낸다 */
const GATE_KEY = 'ff.auth.gate';

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

/**
 * 로그인 — 백엔드가 있으면 먼저 서버 게이트에 묻는다. 200이면 서버 세션(httpOnly 쿠키), 401·403·429면 거절,
 * 게이트가 없는 백엔드(404)·정적 데모·연결 실패·프록시 오류(5xx)는 브라우저 판정(login)으로 넘어간다.
 * 정적 사이트의 게이트(Pages 미들웨어)는 auth-gate.ts가 맡는다(DemoLoginForm이 나눈다).
 */
export async function loginWithServer(id: string, password: string): Promise<boolean> {
  if (isLocalFile() || staticSite()) return login(id, password);
  let res: Response;
  try {
    res = await fetch('/api/auth/demo-login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id, password }) });
  } catch {
    return login(id, password);
  }
  // 게이트 없는 백엔드(404)·백엔드 없이 띄운 개발 화면(프록시 5xx)은 브라우저 판정
  if (res.status === 404 || res.status >= 500) return login(id, password);
  if (!res.ok) return false;
  try {
    localStorage.setItem(GATE_KEY, '1');
  } catch {
    /* 이 탭에서는 로그인 상태 */
  }
  return markAuthed();
}

export function logout(): void {
  const gate = isGateSession();
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(GATE_KEY);
  } catch {
    /* noop */
  }
  // 정적 사이트는 Pages 게이트 쿠키를 지운다(게이트가 없으면 404 — 무시). 서버 게이트 세션도 지운다(응답을 기다리지 않는다 — 화면은 바로 로그인으로)
  if (!isLocalFile() && staticSite()) void fetch(`${import.meta.env.BASE_URL}__auth/logout`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  else if (!isLocalFile() && gate) void fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }).catch(() => undefined);
  emit();
}

const isGateSession = (): boolean => {
  try {
    return localStorage.getItem(GATE_KEY) === '1';
  } catch {
    return false;
  }
};

/** 서버 게이트 세션이 끝났다(401) — 게이트로 로그인한 화면만 로그인으로 돌려보낸다. 처리했으면 true */
export function gateSessionEnded(): boolean {
  if (!isGateSession()) return false;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(GATE_KEY);
  } catch {
    /* noop */
  }
  emit();
  return true;
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

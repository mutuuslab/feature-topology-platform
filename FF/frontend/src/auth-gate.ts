// 공개 사이트 접속 게이트의 화면 쪽(Cloudflare Pages, 서버는 FF/functions/_middleware.ts) — 정적 빌드에서 로그인을 누를 때만 읽는다(첫 화면 묶음 밖).
// 서버에 로그인을 보내 서명 쿠키를 받고, 승인되면 기존 표식 ff.auth도 세운다.
// 게이트가 없는 정적 호스팅(로컬 vite preview·정적 e2e·GitHub Pages)은 응답 표식이 없으니 기존 브라우저 로그인(auth-demo.ts)으로 처리한다.
import { login, markAuthed } from './auth-demo';
import { isLocalFile } from './file-routing';

/** 게이트 응답 표식 — 미들웨어 GATE_MARK와 같다 */
export const GATE_MARK = 'ff-gate-v1';

/** 정적 사이트 로그인 — 게이트가 승인하면 쿠키(서버)와 ff.auth(화면)를 함께, 게이트가 거부하면 false */
export async function gateLogin(id: string, password: string): Promise<boolean> {
  if (isLocalFile()) return login(id, password);
  let body: { gate?: unknown; ok?: unknown } | null = null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}__auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id, password }),
    });
    if ((res.headers.get('content-type') ?? '').includes('json')) body = await res.json();
  } catch {
    body = null;
  }
  if (body?.gate !== GATE_MARK) return login(id, password);
  return body.ok === true ? markAuthed() : false;
}

/** 돌아갈 주소(?next=) — 같은 사이트의 경로만(열린 리다이렉트 금지). 미들웨어 safeNext와 같은 규칙 */
export function safeNextPath(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  let u: URL;
  try {
    u = new URL(raw, 'https://gate.invalid');
  } catch {
    return undefined;
  }
  // 점 구간(/./, /../, %2e)이 정규화되면 '//'로 시작할 수 있다 — 브라우저에선 다른 사이트 주소
  if (u.origin !== 'https://gate.invalid' || u.pathname.startsWith('//')) return undefined;
  if (u.pathname === '/login' || u.pathname === '/login/' || u.pathname.startsWith('/__auth/')) return undefined;
  return u.pathname + u.search + u.hash;
}

// 운영 빌드(VITE_AUTH=oidc) 화면 규칙 — 역할은 IdP가 부여한 것 안에서만, 행위자 ID 머리글 없음, 401이면 다시 로그인, 로그인은 SSO 버튼 하나.
// 빌드 상수(OIDC_AUTH)는 모듈을 읽을 때 정해지므로 env를 바꾼 뒤 모듈을 새로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const USER = { id: 'u-quality-1', name: '정품질', email: 'q@oem.example', roles: ['SAFETY_OFFICER', 'GATE_JUDGE'] };
const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function loadOidc() {
  vi.stubEnv('VITE_AUTH', 'oidc');
  vi.stubEnv('VITE_DATA_MODE', '');
  vi.resetModules();
  const sso = await import('../auth-oidc');
  return sso;
}

beforeEach(() => {
  assign = vi.fn();
  delete (window as { location?: Location }).location;
  (window as { location: unknown }).location = { ...realLocation, pathname: '/policies', search: '?tab=a', assign };
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  (window as { location: unknown }).location = realLocation;
});

describe('운영 빌드(SSO) — 부여 역할 안에서만', () => {
  it('정적 데모는 SSO 빌드 설정이어도 데모로 돈다', async () => {
    vi.stubEnv('VITE_AUTH', 'oidc');
    vi.stubEnv('VITE_DATA_MODE', 'static');
    vi.resetModules();
    expect((await import('../auth-mode')).OIDC_AUTH).toBe(false);
  });

  it('역할 전환기는 부여 역할과 겹치는 화면 역할만, 행위자는 로그인 사용자', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ authenticated: true, mode: 'oidc', user: USER })));
    const sso = await loadOidc();
    await sso.refreshSso();
    const actor = await import('../api/actor');
    expect(actor.personasFor(USER.roles as never)).toEqual(['quality', 'integrator']);
    expect(actor.actorFor('quality', ['GATE_JUDGE'])).toEqual({ id: 'u-quality-1', role: 'GATE_JUDGE' });
    // 화면 역할이 부여 범위 밖이면 부여 역할로만 — 운영자(OPERATOR) 권한은 생기지 않는다
    expect(actor.canAct('operator', ['OPERATOR'])).toBe(false);
    expect(actor.actorFor('integrator', ['SECURITY_OFFICER', 'SAFETY_OFFICER']).role).toBe('SAFETY_OFFICER');
  });

  it('쓰기 요청은 X-Actor-Id 없이, 역할은 부여된 것 하나 — 401이면 지금 화면으로 돌아오는 SSO 로그인', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/auth/me') return json({ authenticated: true, mode: 'oidc', user: USER });
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        return url.includes('read-all') ? json({ ok: true }) : json({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' } }, 401);
      }),
    );
    const sso = await loadOidc();
    await sso.refreshSso();
    const { call } = await import('../api/client');
    await call('readAllNotifications', { role: 'quality', body: {} });
    expect(calls[0].headers['X-Actor-Id']).toBeUndefined();
    expect(USER.roles).toContain(calls[0].headers['X-Actor-Role']);
    await expect(call('listFeatures', {})).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith(`/api/auth/login?returnTo=${encodeURIComponent('/policies?tab=a')}`);
  });

  it('로그인 화면은 회사 계정(SSO) 버튼 하나 — 아이디·비밀번호 칸이 없다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ authenticated: false, mode: 'oidc' })));
    await loadOidc();
    const { LoginScreen } = await import('../screens/auth/Login');
    const { login } = await import('../copy/login');
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/ops/kill' } }]}>
        <LoginScreen />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(document.querySelector('[data-demo-login]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: login.sso.button }));
    expect(assign).toHaveBeenCalledWith(`/api/auth/login?returnTo=${encodeURIComponent('/ops/kill')}`);
  });

  it('로그아웃은 서버 세션을 지우고 IdP 로그아웃 주소를 돌려준다', async () => {
    const f = vi.fn(async (url: string) => (url === '/api/auth/logout' ? json({ endSessionUrl: 'https://idp.example/logout' }) : json({ authenticated: true, mode: 'oidc', user: USER })));
    vi.stubGlobal('fetch', f);
    const sso = await loadOidc();
    await sso.refreshSso();
    expect(sso.ssoStatus()).toBe('authed');
    expect(await sso.ssoLogout()).toBe('https://idp.example/logout');
    expect(sso.ssoStatus()).toBe('anon');
    expect(f.mock.calls.some(([u, init]) => u === '/api/auth/logout' && (init as RequestInit | undefined)?.method === 'POST')).toBe(true);
  });
});

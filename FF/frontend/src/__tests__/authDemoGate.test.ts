// 공개 데모 게이트(백엔드 FF_DEMO_GATE=on, 20-99) — 데모 로그인이 서버 세션을 먼저 묻고, 서버가 판정하면 그 결과를 따른다.
// 게이트 없는 백엔드(404)·프록시 오류(5xx)·연결 실패는 지금처럼 브라우저 판정. 서버 세션이 끝나면(401) 게이트로 들어온 화면만 로그인으로.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateSessionEnded, isAuthed, loginWithServer, logout } from '../auth-demo';

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('데모 로그인 — 서버 게이트', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('게이트가 받으면(200) 서버 판정으로 들어간다 — 화면 고정 비밀번호와 달라도', async () => {
    const f = vi.fn(async () => reply(200, { authenticated: true, mode: 'demo', gate: true }));
    vi.stubGlobal('fetch', f);
    expect(await loginWithServer('ff', 'private-pass')).toBe(true);
    expect(isAuthed()).toBe(true);
    expect(f).toHaveBeenCalledWith('/api/auth/demo-login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'ff', password: 'private-pass' }) }));
  });

  it('게이트가 거절하면(401·403·429) 화면 고정값이 맞아도 들어가지 않는다', async () => {
    for (const status of [401, 403, 429]) {
      vi.stubGlobal('fetch', vi.fn(async () => reply(status)));
      expect(await loginWithServer('FF', 'FF')).toBe(false);
      expect(isAuthed()).toBe(false);
    }
  });

  it('게이트가 없는 백엔드(404)·프록시 오류(502)·연결 실패는 브라우저 판정', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(404)));
    expect(await loginWithServer('ff', 'ff')).toBe(true);
    logout();
    expect(await loginWithServer('ff', 'nope')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => reply(502)));
    expect(await loginWithServer('ff', 'ff')).toBe(true);
    logout();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect(await loginWithServer('ff', 'ff')).toBe(true);
  });

  it('게이트를 끈 로컬 데모 백엔드 — 데모 로그인 창구의 404 봉투면 브라우저 판정(ff/ff로 들어간다)', async () => {
    const f = vi.fn(async () => reply(404, { error: { code: 'NOT_FOUND', message: '데모 게이트가 켜져 있지 않습니다.' } }));
    vi.stubGlobal('fetch', f);
    expect(await loginWithServer('ff', 'ff')).toBe(true);
    expect(isAuthed()).toBe(true);
    // 게이트 세션이 아니므로 401이 와도 로그인 화면으로 돌려보내지 않는다
    expect(gateSessionEnded()).toBe(false);
    expect(isAuthed()).toBe(true);
  });

  it('서버 세션이 끝나면(401) 게이트로 들어온 화면만 로그인으로 돌아간다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(404)));
    await loginWithServer('ff', 'ff');
    expect(gateSessionEnded()).toBe(false);
    expect(isAuthed()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => reply(200)));
    await loginWithServer('ff', 'ff');
    expect(gateSessionEnded()).toBe(true);
    expect(isAuthed()).toBe(false);
  });

  it('로그아웃은 게이트 세션이면 서버 세션도 지운다', async () => {
    const f = vi.fn(async () => reply(200));
    vi.stubGlobal('fetch', f);
    await loginWithServer('ff', 'ff');
    logout();
    expect(isAuthed()).toBe(false);
    expect(f).toHaveBeenLastCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});

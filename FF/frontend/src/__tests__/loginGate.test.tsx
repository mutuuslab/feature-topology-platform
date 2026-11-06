// 공개 사이트 접속 게이트(정적 빌드) — 로그인 화면이 서버(/__auth/login)에 확인받고, 게이트가 붙인 ?next=로 돌아간다.
// 게이트가 없는 정적 호스팅(로컬 미리보기·정적 e2e)은 기존 브라우저 로그인 그대로. 서버 쪽은 tools/pages-gate.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { logout } from '../auth-demo';
import { GATE_MARK, gateLogin, safeNextPath } from '../auth-gate';
import { AppProvider } from '../store';
import { LoginScreen } from '../screens/auth/Login';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  fetchMock = vi.fn(async () => json(200, { ok: true, gate: GATE_MARK, next: '/' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mount(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<div>home-screen</div>} />
          <Route path="/fleet/map" element={<div>fleet-map</div>} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

function submit(id: string, pw: string) {
  fireEvent.change(screen.getByLabelText('ID'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
  fireEvent.click(screen.getByRole('button', { name: '플랫폼 들어가기' }));
}

describe('정적 사이트 로그인 — 서버 접속 게이트', () => {
  it('서버에 ID·비밀번호를 POST하고, 승인되면 ff.auth를 세우고 ?next=의 원래 주소를 문서로 다시 연다', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mount('/login?next=%2Ffleet%2Fmap');
    submit('ff', 'Ff');
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/fleet/map'));
    expect(localStorage.getItem('ff.auth')).toBe('1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(String(init.body))).toEqual({ id: 'ff', password: 'Ff' });
  });

  it('서버가 거부하면 오류를 보이고 세션을 남기지 않는다', async () => {
    fetchMock.mockResolvedValue(json(401, { ok: false, gate: GATE_MARK, error: 'invalid_credentials' }));
    mount('/login');
    submit('FF', 'wrong');
    expect((await screen.findByRole('alert')).textContent).toContain('ID 또는 비밀번호가 맞지 않습니다');
    expect(localStorage.getItem('ff.auth')).toBeNull();
  });

  it('게이트가 없는 정적 호스팅(404 HTML)이면 기존 브라우저 로그인으로 들어간다', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html>', { status: 404, headers: { 'Content-Type': 'text/html' } }));
    mount('/login');
    submit('FF', 'FF');
    expect(await screen.findByText('home-screen')).toBeTruthy();
    expect(localStorage.getItem('ff.auth')).toBe('1');
  });

  it('게이트가 없을 때도 틀린 비밀번호는 들어가지 못한다', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await gateLogin('FF', 'nope')).toBe(false);
    expect(localStorage.getItem('ff.auth')).toBeNull();
  });

  it('외부 주소 next는 따르지 않고 홈으로', async () => {
    mount('/login?next=%2F%2Fevil.example%2Fsteal');
    submit('FF', 'FF');
    expect(await screen.findByText('home-screen')).toBeTruthy();
  });

  it('별도 페이지(external — Pages는 .html을 뗀다) next도 문서로 연다(SPA 안에는 그 화면이 없다)', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mount('/login?next=%2Fexternal%3Ftab%3D1');
    submit('FF', 'FF');
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/external?tab=1'));
  });

  it('화면 안에서 넘어온 로그인(state.from)은 SPA 안 이동 그대로', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/fleet/map' } }]}>
        <AppProvider>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/fleet/map" element={<div>fleet-map</div>} />
          </Routes>
        </AppProvider>
      </MemoryRouter>,
    );
    submit('FF', 'FF');
    expect(await screen.findByText('fleet-map')).toBeTruthy();
  });

  it('로그아웃은 서버 쿠키도 지운다', () => {
    localStorage.setItem('ff.auth', '1');
    logout();
    expect(localStorage.getItem('ff.auth')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/__auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('next 규칙 — 같은 사이트 경로만', () => {
    expect(safeNextPath('/fleet/map?vin=1')).toBe('/fleet/map?vin=1');
    // 점 구간은 정규화 뒤 '//'(다른 사이트)가 된다
    for (const bad of ['//evil.example', '/.//evil.example', '/..//evil.example', '/%2e//evil.example', 'https://evil.example', '/\\evil', 'evil', '/login', '/__auth/login', '/a\nb', null]) {
      expect(safeNextPath(bad), String(bad)).toBeUndefined();
    }
  });
});

// readiness: RD-UX-01 — 오류 화면: 401 다시 로그인·409/412 다시 불러오기(입력 유지)·400/422 칸 오류·429 잠시 뒤·5xx 문의 번호·연결 끊김을
// 사용자 말로 안내한다. 포트·서버 프로그램 이름 같은 개발자 문구는 없다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errors as E } from '../copy/errors';

// 모듈을 매 시험 새로 읽는다(세션 상태·빌드 상수) — 첫 읽기가 느린 환경에서도 시간 초과로 흔들리지 않게
vi.setConfig({ testTimeout: 30_000 });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
const envelope = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details !== undefined && { details }) } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('API 오류 → 사용자 안내 (client.ts)', () => {
  const callWith = async (res: Response | (() => never), name = 'listFeatures') => {
    vi.stubGlobal('fetch', vi.fn(async () => (typeof res === 'function' ? res() : res)));
    const { call } = await import('../api/client');
    return call(name, name === 'listFeatures' ? {} : { body: {} }).then(
      () => null,
      (e) => e,
    );
  };

  it('client.ts에 개발자 문구(포트 9101·백엔드)가 없다', () => {
    const src = readFileSync(join(__dirname, '..', 'api', 'client.ts'), 'utf8');
    expect(src).not.toMatch(/9101/);
    expect(src).not.toMatch(/백엔드\(|실행 중인지/);
  });

  it('연결 끊김 — status 0, 사용자 말(오프라인이면 오프라인 안내)', async () => {
    const e = await callWith(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(e).toMatchObject({ status: 0, kind: 'network', message: E.network });
    vi.stubGlobal('navigator', { onLine: false });
    const off = await callWith(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(off).toMatchObject({ kind: 'network', message: E.offline });
  });

  it('401 — 세션 만료 안내, 세션 만료 상태가 켜진다', async () => {
    const e = await callWith(json(envelope('UNAUTHENTICATED', 'login required'), 401));
    expect(e).toMatchObject({ status: 401, kind: 'auth', message: E.auth });
    const { isSessionExpired } = await import('../api/session');
    expect(isSessionExpired()).toBe(true);
  });

  it('409·412 — 충돌, 서버의 업무 문장은 그대로', async () => {
    expect(await callWith(json(envelope('CONFLICT', '이미 다른 사람이 승인했습니다.'), 409), 'createFeature')).toMatchObject({ kind: 'conflict', message: '이미 다른 사람이 승인했습니다.' });
    expect(await callWith(new Response('', { status: 412 }), 'createFeature')).toMatchObject({ kind: 'conflict', message: E.conflictFallback });
  });

  it('400 VALIDATION·422 — 입력 오류, 칸별 오류를 읽을 수 있다', async () => {
    const e = await callWith(json(envelope('VALIDATION', '요청 본문이 올바르지 않습니다.', [{ path: 'name', message: '2자 이상' }, { path: 'tags.0', message: '빈 값' }]), 400), 'createFeature');
    expect(e).toMatchObject({ kind: 'validation' });
    const { fieldErrors } = await import('../api/field-errors');
    expect(fieldErrors(e)).toMatchObject({ name: '2자 이상', tags: '빈 값', 'tags.0': '빈 값' });
    const g = await callWith(json(envelope('GUARD_FAILED', '국가·차종·트림이 바뀌면 새 Feature ID로 등록해야 합니다.', { fields: ['country', 'trim'] }), 422), 'createFeature');
    expect(fieldErrors(g)).toEqual({ country: g.message, trim: g.message });
  });

  it('429 — Retry-After(초)를 읽어 안내', async () => {
    const e = await callWith(json(envelope('RATE_LIMITED', 'slow down'), 429, { 'Retry-After': '30' }));
    expect(e).toMatchObject({ kind: 'rateLimit', retryAfterSec: 30, message: E.rateLimit(30) });
  });

  it('5xx — 서버 내부 문장 대신 안내, 문의 번호는 X-Correlation-Id. JSON이 아닌 본문(프록시 HTML)에도 멈추지 않는다', async () => {
    const e = await callWith(json(envelope('INTERNAL', 'TypeError: cannot read x of undefined'), 500, { 'X-Correlation-Id': 'cid-123' }));
    expect(e).toMatchObject({ kind: 'server', correlationId: 'cid-123', message: E.server });
    const html = await callWith(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html', 'X-Correlation-Id': 'cid-502' } }));
    expect(html).toMatchObject({ status: 502, kind: 'server', correlationId: 'cid-502' });
  });

  it('조회 재시도는 연결 끊김·서버 오류만', async () => {
    const { shouldRetry } = await import('../api/errors');
    expect(shouldRetry({ kind: 'network' })).toBe(true);
    expect(shouldRetry({ kind: 'server' })).toBe(true);
    for (const kind of ['auth', 'forbidden', 'conflict', 'validation', 'rateLimit']) expect(shouldRetry({ kind })).toBe(false);
  });
});

describe('오류 안내 부품 (ErrorNote·AsyncView·Field)', () => {
  it('401 — 다시 로그인 버튼, 409 — 최신 내용 다시 불러오기(누르면 안내가 바뀐다), 5xx — 문의 번호', async () => {
    const { ErrorNote, configureErrorActions } = await import('../design');
    const relogin = vi.fn();
    const reload = vi.fn(async () => undefined);
    configureErrorActions({ relogin, reload });
    const { rerender } = render(<ErrorNote error={{ message: E.auth, kind: 'auth', status: 401, code: 'UNAUTHENTICATED' }} />);
    expect(screen.queryByText('UNAUTHENTICATED')).toBeNull(); // 세션 코드는 숨긴다
    fireEvent.click(screen.getByRole('button', { name: E.relogin }));
    expect(relogin).toHaveBeenCalled();

    rerender(<ErrorNote error={{ message: '이미 승인됨', kind: 'conflict', status: 409, code: 'CONFLICT' }} />);
    expect(screen.getByText(E.conflictHint)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: E.reload })));
    expect(reload).toHaveBeenCalled();
    expect(screen.getByText(E.reloaded)).toBeTruthy();

    rerender(<ErrorNote error={{ message: E.server, kind: 'server', status: 500, code: 'INTERNAL', correlationId: 'cid-777' }} />);
    expect(screen.getByText(E.correlation)).toBeTruthy();
    expect(document.querySelector('[data-id="cid-777"]')).toBeTruthy();
    expect(screen.queryByText('INTERNAL')).toBeNull();
  });

  it('AsyncView — 오류 종류별 제목, 401에는 다시 시도 대신 다시 로그인', async () => {
    const { AsyncView, configureErrorActions } = await import('../design');
    configureErrorActions({ relogin: vi.fn() });
    const { MemoryRouter } = await import('react-router-dom');
    const { ko } = await import('../copy/ko');
    const { rerender } = render(
      <MemoryRouter>
        <AsyncView state="error" error={{ message: E.auth, kind: 'auth', status: 401 }} onRetry={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText(E.authTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ko.state.retry })).toBeNull();
    expect(screen.getByRole('button', { name: E.relogin })).toBeTruthy();
    rerender(
      <MemoryRouter>
        <AsyncView state="error" error={{ message: E.rateLimit(5), kind: 'rateLimit', status: 429 }} onRetry={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText(E.rateLimitTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: ko.state.retry })).toBeTruthy();
    // 옛 호출(문자열)도 그대로
    rerender(
      <MemoryRouter>
        <AsyncView state="error" error="불러오지 못한 이유" />
      </MemoryRouter>,
    );
    expect(screen.getByText(ko.state.errorTitle)).toBeTruthy();
  });

  it('Field — 칸 오류는 입력 옆에, 입력은 aria-invalid·오류 문장 연결', async () => {
    const { Field } = await import('../design');
    render(
      <Field label="이름" error="2자 이상 적으세요">
        <input defaultValue="a" />
      </Field>,
    );
    const input = screen.getByLabelText(/이름/) as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('2자 이상 적으세요');
  });
});

describe('SSO 세션 만료 — 입력을 지킨다', () => {
  const realLocation = window.location;
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    assign = vi.fn();
    delete (window as { location?: Location }).location;
    (window as { location: unknown }).location = { ...realLocation, pathname: '/feature/propose', search: '', assign };
  });
  afterEach(() => {
    (window as { location: unknown }).location = realLocation;
  });

  it('저장하지 않은 입력이 있으면 바로 로그인으로 옮기지 않고 안내 띠가 다시 로그인을 묻는다', async () => {
    vi.stubEnv('VITE_AUTH', 'oidc');
    vi.stubEnv('VITE_DATA_MODE', '');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => json(envelope('UNAUTHENTICATED', 'x'), 401)));
    const { useUnsavedGuard } = await import('../design/unsaved');
    const { SessionBanner } = await import('../shell/SessionBanner');
    function Dirty() {
      useUnsavedGuard(true);
      return null;
    }
    render(
      <>
        <Dirty />
        <SessionBanner />
      </>,
    );
    const { call } = await import('../api/client');
    await act(async () => {
      await call('listFeatures', {}).catch(() => undefined);
    });
    expect(assign).not.toHaveBeenCalled();
    expect(document.querySelector('[data-session-expired]')?.textContent).toContain(E.sessionBanner);
    fireEvent.click(screen.getByRole('button', { name: E.relogin }));
    expect(assign).toHaveBeenCalledWith(`/api/auth/login?returnTo=${encodeURIComponent('/feature/propose')}`);
  });
});

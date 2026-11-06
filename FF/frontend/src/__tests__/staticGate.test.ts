// 공개 사이트 접속 게이트 쿠키 만료 — 회귀(2026-11-06 하네스 리뷰): 정적 클라이언트가 게이트 401을 '스냅샷에 없음' 404로 바꿔
// SPA 안에 오류 상자만 보였다. 게이트 401이면 화면 로그인 표식(ff.auth)을 지우고 지금 주소로 돌아오는 로그인으로 옮긴다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATE_MARK as SERVER_MARK } from '../../../functions/_middleware';

const gate401 = () => new Response(JSON.stringify({ ok: false, gate: SERVER_MARK, error: 'auth_required', login: '/login' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
const assign = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  assign.mockReset();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/ops/incidents', search: '?source=VOC', hash: '', assign } as unknown as Location);
  localStorage.clear();
  localStorage.setItem('ff.auth', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('정적 사이트 — 게이트 쿠키 만료', () => {
  it('표식이 서버(functions/_middleware.ts)와 같다', async () => {
    const { GATE_MARK } = await import('../api/client');
    expect(GATE_MARK).toBe(SERVER_MARK);
  });

  it('스냅샷 읽기가 게이트 401이면 로그인 표식을 지우고 지금 주소를 next로 로그인에 간다(오류는 401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gate401()));
    const { call } = await import('../api/client');
    await expect(call('incidents', { query: { source: 'VOC' } })).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('ff.auth')).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/ops/incidents?source=VOC')}`);
    // 같은 순간 다른 조회도 401 — 이동은 한 번만
    await expect(call('masterEcu')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('바뀐 시연 데이터가 있어 시연 엔진으로 읽을 때도 같다', async () => {
    localStorage.setItem('ff.sim', 'v');
    vi.stubGlobal('fetch', vi.fn(async () => gate401()));
    const { call } = await import('../api/client');
    await expect(call('masterEcu')).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('ff.auth')).toBeNull();
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/ops/incidents?source=VOC')}`);
  });

  it('ROUTES 밖 스냅샷 파일(OFREP 등)도 같다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gate401()));
    const { readSnapshotFile } = await import('../api/client');
    await expect(readSnapshotFile('api-snapshot/x.json')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('게이트 표식이 없는 401·없는 파일은 예전처럼 스냅샷 없음 — 로그인으로 옮기지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"x"}', { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const { call } = await import('../api/client');
    await expect(call('masterEcu')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem('ff.auth')).toBe('1');
  });
});

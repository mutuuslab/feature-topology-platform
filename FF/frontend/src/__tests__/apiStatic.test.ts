// 정적 데모 클라이언트 — 회귀(2026-10-16): 없는 스냅샷 파일에 정적 호스팅이 index.html(200)을 돌려주면 JSON 파싱 오류로 화면이 깨졌다.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function staticCall(res: Response) {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(async () => res));
  const { call } = await import('../api/client');
  return call('masterEcu');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('정적 데모 클라이언트', () => {
  it('스냅샷 JSON을 그대로 돌려준다', async () => {
    await expect(staticCall(new Response('{"items":[1]}', { headers: { 'Content-Type': 'application/json' } }))).resolves.toEqual({ items: [1] });
  });
  it('SPA 대체 응답(HTML 200)은 스냅샷 없음 404 — 파싱 오류가 아니다', async () => {
    await expect(staticCall(new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }))).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
  it('쓰기는 읽기 전용 안내', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_MODE', 'static');
    const { call } = await import('../api/client');
    await expect(call('bumpEpoch', { body: { reason: 'x' } })).rejects.toMatchObject({ status: 403, code: 'READ_ONLY_DEMO' });
  });
});

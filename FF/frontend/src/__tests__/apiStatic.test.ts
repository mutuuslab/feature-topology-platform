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
  // 2026-11-06 사용자 결정 — 공개 사이트도 쓰기가 실제처럼 된다(브라우저 안 시연 데이터, 20-60). 역할·본문 규칙은 서버와 같다
  it('쓰기는 서버와 같은 역할 규칙 — 맡지 않은 역할은 403, 맡은 역할은 처리', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_MODE', 'static');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })));
    localStorage.clear();
    const { call } = await import('../api/client');
    await expect(call('bumpEpoch', { body: { reason: '키 유출 대응' } })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    // 맡은 역할(사이버보안)은 시연 핸들러가 처리 — 차량 키 epoch 1 → 2(스냅샷 없으면 1에서 시작)
    await expect(call('bumpEpoch', { role: 'integrator', body: { reason: '키 유출 대응' } })).resolves.toMatchObject({ epoch: 2 });
    localStorage.clear();
  });
});

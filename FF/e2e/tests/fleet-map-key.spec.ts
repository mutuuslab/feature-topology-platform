// 전세계 차량 지도(/fleet/map) 3초 테스트 잔여(UX3-05, 2026-10-24) — 실제 브라우저(WebGL·SwiftShader):
//   ① 지도를 그리는 동안 aria-busy — 3초 하네스·캡처의 대기 조건([aria-busy="true"] 없음)이 그린 지도를 기다린다.
//      예전에는 준비 상태가 기계로 읽히지 않아 캡처 3장이 모두 "지도를 불러오는 중…"에서 찍혔다(지도 자체는 1~4초 안에 준비됨).
//   ② 핵심 메시지 "N 긴급 차단·미확인 차량"의 행동이 그 차량을 고르고 지도를 그 차량으로 옮긴다(상세가 열린다)
//   ③ 국가별 현황은 접힌 보조 정보 — 처음에는 표가 보이지 않고 펼치면 보인다
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 768 }, launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' })));
});

test('지도 준비 중에는 aria-busy — 하네스 대기 조건을 지나면 "불러오는 중" 안내가 없고 차량이 그려져 있다', async ({ page }) => {
  // 타일 서버 응답이 늦은 환경(첫 방문·느린 망) — 스타일 요청을 늦게 실패시켜 준비 시간을 늘린다
  await page.route((url) => url.hostname === 'tiles.openfreemap.org', async (r) => {
    await new Promise((ok) => setTimeout(ok, 2500));
    await r.abort();
  });
  await page.goto('/fleet/map');
  await expect(page.locator('#main h1').first()).toBeVisible();
  await expect(page.getByTestId('fleet-map-canvas')).toBeAttached();
  // three-second.spec·panel-title.spec과 같은 대기 조건
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 });
  const now = await page.evaluate(() => ({
    note: document.querySelector('.fm-map__note')?.textContent ?? null,
    phase: document.querySelector('.fm-map')?.getAttribute('data-phase') ?? null,
  }));
  expect(now.note, '대기 조건을 지났는데 아직 지도를 불러오는 중').not.toBe('지도를 불러오는 중…');
  expect(now.phase).toBe('ready');
});

test('핵심 메시지 행동 — 긴급 차단·미확인 차량을 고르고 지도를 그 차량으로 옮긴다', async ({ page }) => {
  await page.route((url) => url.hostname === 'tiles.openfreemap.org', (r) => r.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/fleet/map');
  const key = page.locator('#main [data-key-message]');
  const action = key.getByRole('button', { name: '지도에서 보기' });
  await expect(action).toBeVisible();
  const vin = (await action.getAttribute('data-vin'))!;
  expect(vin).toBeTruthy();
  const canvas = page.getByTestId('fleet-map-canvas');
  await expect(page.locator('.fm-map')).toHaveAttribute('data-phase', 'ready');
  await action.click();
  await expect(page).toHaveURL(new RegExp(`[?&]vin=${encodeURIComponent(vin)}`));
  await expect(page.getByTestId('fleet-map-detail')).toBeVisible();
  // 고른 차량 쪽으로 도시 단위(확대 11)까지 — 그린 자동차라면 지도 가운데 근처
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom')), { timeout: 15_000 }).toBeGreaterThanOrEqual(11);
  const box = (await canvas.boundingBox())!;
  const points = JSON.parse((await canvas.getAttribute('data-points')) ?? '[]') as { vin: string; x: number; y: number }[];
  const p = points.find((x) => x.vin === vin);
  if (p) {
    expect(Math.abs(p.x - box.width / 2), `${vin}가 지도 가로 가운데`).toBeLessThan(40);
    expect(Math.abs(p.y - box.height / 2), `${vin}가 지도 세로 가운데`).toBeLessThan(40);
  }
});

test('국가별 현황은 접어 둔다 — 처음에는 표가 보이지 않고 펼치면 보인다', async ({ page }) => {
  await page.route((url) => url.hostname === 'tiles.openfreemap.org', (r) => r.abort());
  await page.goto('/fleet/map');
  const fold = page.getByTestId('fleet-map-summary');
  await expect(fold.locator('summary')).toHaveText(/국가별 현황 · \d+개국/);
  const table = page.getByRole('table', { name: '국가별 현황' });
  await expect(table).toBeHidden();
  await fold.locator('summary').click();
  await expect(table).toBeVisible();
});

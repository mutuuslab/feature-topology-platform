// 빈 DB 첫 실행 — 모든 메뉴가 오류 없이 열리고, 데모 데이터가 보이지 않는다(출시 준비 RD-OPS-02).
// 서버 오류(5xx)·런타임 오류·오류 안내(.ds-error)·라우트 경계 오류가 하나도 없어야 한다. 빈 목록은 빈 상태 안내로 보여야 한다.
// readiness: RD-OPS-02
import { expect, test } from '@playwright/test';
import { MENU_ENTRIES } from '../tests/menu';

/** 데모 시드에만 있는 식별자 — 빈 DB 화면에 나오면 화면이 데모 데이터를 박아 두었다는 뜻 */
const DEMO_IDS = /FEAT-\d{5}|CAT-\d{5}|POL-\d{5}|PUB-\d{5}|VIN-DEMO-\d+|\bego-01\b|\blead-01\b/;
/** 예시 ID가 내용인 화면 — 디자인 키트 갤러리(견본), 표준 따라하기(시나리오 본문은 예시 데이터 기준이고 화면이 그 사실을 먼저 알린다) */
const SAMPLE_CONTENT: Record<string, string> = { '/_design': '디자인 키트 견본', '/learn': '[data-learn-sample-notice]' };

test('빈 DB — 백엔드가 데모 데이터 없이 떴다', async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  expect(h.seed).toBeNull();
  expect(h.counts.features).toBe(0);
});

for (const m of MENU_ENTRIES) {
  test(`빈 DB 메뉴: ${m.title} (${m.menu})`, async ({ page }) => {
    const errors: string[] = [];
    const server: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 500 && new URL(r.url()).pathname.startsWith('/api/')) server.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(m.menu);
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    // 빈 DB에서도 불러오기가 끝난다 — 영원한 로딩(없는 대상을 기다림)은 빈 상태 안내가 아니다
    await expect(page.locator('#main [data-state="loading"]')).toHaveCount(0);
    // 탭이 있으면 모두 연다 — 탭마다 따로 조회한다
    const tabs = page.locator('#main').getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await page.waitForLoadState('networkidle');
    }
    await expect(page.locator('[data-not-found]')).toHaveCount(0);
    await expect(page.locator('[data-route-error]')).toHaveCount(0);
    const alerts = await page.locator('.ds-error[role="alert"], [data-state="error"]').allInnerTexts();
    expect(alerts, '오류 안내').toEqual([]);
    expect(server, '서버 오류').toEqual([]);
    expect(errors, '런타임 오류').toEqual([]);
    await expect(page.locator('#main [data-state="loading"]')).toHaveCount(0);
    const sample = SAMPLE_CONTENT[m.menu];
    if (sample?.startsWith('[')) await expect(page.locator(sample), '예시 데이터 기준임을 알리는 안내').toBeVisible();
    if (sample) return;
    const text = await page.locator('#main').innerText();
    expect(text.match(DEMO_IDS)?.[0] ?? null, '빈 DB 화면에 데모 식별자').toBeNull();
  });
}

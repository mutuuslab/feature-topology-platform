// 데모 설치 기본 표시(80-50 D-ALM-17, 2026-11-05 사용자 결정) — 모의 연계를 실제 연결처럼: 모의·가상 표시와 경고색 없음.
// 이 시험 서버는 FF_DEMO_LABELS=on(표시 있음)으로 뜨므로, 연결 상태 응답의 presentation만 seamless로 바꿔 데모 기본을 본다.
// 운영 설치(mode=production)는 seamless 값이 와도 '연결 안 됨'을 붙인다(RD-UX-04).
import { expect, test, type Page } from '@playwright/test';
import { connections as CN } from '../../frontend/src/copy/connections';

async function seamless(page: Page, mode: 'demo' | 'production' = 'demo') {
  await page.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, mode, presentation: 'seamless' } });
  });
}

const MOCK_WORDS = /모의|가상 연계 시연|시연용 외부 도구|플랫폼 시연 계정/;

test('연결 상태·외부 연계 표 — 모의 표시·노란 판정 없이 연결된 것으로 보인다', async ({ page }) => {
  await seamless(page);
  await page.goto('/integration/connectors?tab=systems');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: CN.panel.title }) });
  await expect(panel.getByRole('row').filter({ hasText: CN.system.billing })).toContainText(CN.panel.live);
  await expect(page.locator('[data-connection]')).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText(MOCK_WORDS);
  await page.goto('/integration/connectors?tab=sync');
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.locator('#main')).not.toContainText(MOCK_WORDS);
  await expect(page.locator('#sync-simulate')).toHaveCount(0);
});

test('체험 구매 — 과금 미연결 고지가 없다', async ({ page }) => {
  await seamless(page);
  await page.goto('/entitlements');
  await expect(page.locator('[data-connection-note="billing"]')).toHaveCount(0);
  await expect(page.locator('[data-connection]')).toHaveCount(0);
});

test('JIRA·CodeBeamer 별도 창 — 시연 배지·안내 줄 없이 연다', async ({ page, context }) => {
  await seamless(page);
  await context.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), mode: 'demo', presentation: 'seamless' } });
  });
  await page.goto('/features/FEAT-00001/2.1.0?tab=ext');
  await expect(page.getByTestId('ext-links')).toBeVisible();
  await expect(page.getByTestId('ext-links')).not.toContainText(MOCK_WORDS);
  for (const name of [/^codeBeamer .*새 창 열기$/, /^JIRA .*새 창 열기$/]) {
    const [win] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name }).first().click()]);
    await expect(win.locator('.external-header')).toBeVisible();
    await expect(win.locator('.external-demo-badge')).toHaveCount(0);
    await expect(win.locator('.external-notice')).toHaveCount(0);
    // 항목 본문(시드 자료)은 이 서버가 표시 있는 데모(FF_DEMO_LABELS=on)로 떠서 시연 출처 문구가 있다 — 본문은 백엔드 demo-seed-content.spec이 본다
    for (const part of ['.external-header', '.external-context']) await expect(win.locator(part)).not.toContainText(MOCK_WORDS);
    await win.close();
  }
});

test('운영 설치 — seamless 값이 와도 연결 안 됨을 붙인다', async ({ page }) => {
  await seamless(page, 'production');
  await page.goto('/integration/connectors?tab=systems');
  await expect(page.locator('[data-connection="disconnected"]').first()).toBeVisible();
});

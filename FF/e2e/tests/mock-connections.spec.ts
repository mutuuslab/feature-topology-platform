// readiness: RD-UX-04 — 모의 연계(메일·과금·OTA·Data Lake)는 화면에 '모의(연결 전)'·'연결 안 됨'으로 보인다. 상태는 서버 설정(/api/system/connections).
import { expect, test } from '@playwright/test';
import { connections as CN } from '../../frontend/src/copy/connections';

test('외부 연계 현황 — 연결 상태 표에 메일·과금·OTA는 모의, Data Lake는 연결 안 됨(실제 서버 응답)', async ({ page }) => {
  await page.goto('/integration/connectors?tab=systems');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: CN.panel.title }) });
  await expect(panel).toBeVisible();
  for (const key of ['mail', 'billing', 'ota'] as const) await expect(panel.getByRole('row').filter({ hasText: CN.system[key] })).toContainText(CN.label.mock);
  await expect(panel.getByRole('row').filter({ hasText: CN.system.datalake })).toContainText(CN.label.disconnected);
});

test('알림 — 메일 발송 기록에 모의(연결 전) 표시', async ({ page }) => {
  await page.goto('/notifications');
  const emails = page.locator('section[aria-labelledby="ntf-emails-h"]');
  await expect(emails.locator('[data-connection="mock"]')).toContainText(CN.label.mock);
});

test('운영 설치(연결 상태 mode=production) — 같은 모의 연결이 연결 안 됨, 체험 구매 안내도 연결 안 됨', async ({ page }) => {
  await page.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, mode: 'production' } });
  });
  await page.goto('/notifications');
  await expect(page.locator('section[aria-labelledby="ntf-emails-h"] [data-connection="disconnected"]')).toContainText(CN.label.disconnected);
  await page.goto('/entitlements');
  await expect(page.locator('[data-connection-note="billing"]')).toContainText(CN.hint.disconnected(CN.system.billing));
});

test('실제 연결(live)이면 표시가 사라진다', async ({ page }) => {
  await page.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, items: body.items.map((i: { key: string }) => ({ ...i, mode: 'live', liveAdapter: true })) } });
  });
  await page.goto('/notifications');
  await expect(page.locator('section[aria-labelledby="ntf-emails-h"]')).toBeVisible();
  await expect(page.locator('[data-connection]')).toHaveCount(0);
});

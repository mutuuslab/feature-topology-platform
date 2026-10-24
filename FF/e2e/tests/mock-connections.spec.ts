// readiness: RD-UX-04 — 모의 연계(과금·OTA·Data Lake)는 화면에 '모의(연결 전)'·'연결 안 됨'으로 보인다. 상태는 서버 설정(/api/system/connections).
// 알림 메일은 채널 자체가 없다(사용자 결정 D-RD-7: 화면 알림만) — 연결 표에도 알림 화면에도 메일이 없다.
import { expect, test, type Page } from '@playwright/test';
import { connections as CN } from '../../frontend/src/copy/connections';

const connectionsPanel = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: CN.panel.title }) });

test('외부 연계 현황 — 연결 상태 표에 과금·OTA는 모의, Data Lake는 연결 안 됨, 메일 행은 없다(실제 서버 응답)', async ({ page }) => {
  await page.goto('/integration/connectors?tab=systems');
  const panel = connectionsPanel(page);
  await expect(panel).toBeVisible();
  for (const key of ['billing', 'ota'] as const) await expect(panel.getByRole('row').filter({ hasText: CN.system[key] })).toContainText(CN.label.mock);
  await expect(panel.getByRole('row').filter({ hasText: CN.system.datalake })).toContainText(CN.label.disconnected);
  await expect(panel.getByRole('row').filter({ hasText: '메일' })).toHaveCount(0);
});

test('알림 — 화면 알림만: 받는 방법 안내, 메일 설정·발송 기록·연결 표시 없음', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: '받는 방법' })).toBeVisible();
  await expect(page.locator('.ds-split').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('[data-connection]')).toHaveCount(0);
  await expect(page.getByText(/메일 발송 기록|모의 발송/)).toHaveCount(0);
});

test('운영 설치(연결 상태 mode=production) — 같은 모의 연결이 연결 안 됨, 체험 구매 안내도 연결 안 됨', async ({ page }) => {
  await page.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, mode: 'production' } });
  });
  await page.goto('/integration/connectors?tab=systems');
  await expect(connectionsPanel(page).getByRole('row').filter({ hasText: CN.system.billing }).locator('[data-connection="disconnected"]')).toContainText(CN.label.disconnected);
  await page.goto('/entitlements');
  await expect(page.locator('[data-connection-note="billing"]')).toContainText(CN.hint.disconnected(CN.system.billing));
});

test('실제 연결(live)이면 표시가 사라진다', async ({ page }) => {
  await page.route('**/api/system/connections', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, items: body.items.map((i: { key: string }) => ({ ...i, mode: 'live', liveAdapter: true })) } });
  });
  await page.goto('/integration/connectors?tab=systems');
  const panel = connectionsPanel(page);
  await expect(panel.getByRole('row').filter({ hasText: CN.system.billing })).toContainText(CN.panel.live);
  await expect(panel.locator('[data-connection]')).toHaveCount(0);
});

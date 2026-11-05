import { expect, test } from '@playwright/test';

test('지연 화면 파일을 받지 못한 뒤 다시 시도하면 같은 주소의 새 화면을 읽는다', async ({ page }) => {
  let blocked = false;
  await page.route(/\/assets\/Impact-[^/]+\.js$/, async route => {
    if (!blocked) { blocked = true; await route.abort('failed'); }
    else await route.continue();
  });
  await page.goto('/analysis/impact');
  await expect(page.locator('[data-route-error]')).toContainText('화면 파일을 불러오지 못했습니다');
  expect(blocked).toBe(true);
  await page.locator('[data-route-error]').getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page).toHaveURL(/\/analysis\/impact$/);
  await expect(page.locator('#main h1').first()).toContainText('변경 영향 분석');
  await expect(page.locator('[data-route-error]')).toHaveCount(0);
});

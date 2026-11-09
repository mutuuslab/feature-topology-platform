import { expect, test } from '@playwright/test';

test('정적 시연: 체험 실행 모듈 준비 실패를 알리고 다시 시도하면 실제 준비를 회복한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('ff.auth', '1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'commerce' }));
  });
  let dependencyRequests = 0;
  await page.route('**/assets/business-*.js', async (route) => {
    dependencyRequests += 1;
    if (dependencyRequests === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/entitlements?catalog=CAT-00019');
  const offer = page.getByRole('region', { name: '체험 제안', exact: true });
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('alert')).toBeVisible();
  expect(dependencyRequests).toBe(1);
  await expect(offer.getByRole('button', { name: '제안 보내기', exact: true })).toHaveCount(0);
  await test.info().attach('preparation-error', { body: await page.screenshot(), contentType: 'image/png' });
  await Promise.all([
    page.waitForEvent('load'),
    offer.getByRole('button', { name: '다시 시도', exact: true }).click(),
  ]);
  const vehicle = offer.getByRole('checkbox', { name: /KMH-NX4-0001/ });
  await expect(vehicle).toBeVisible();
  expect(dependencyRequests).toBeGreaterThanOrEqual(2);
  await expect(offer.getByRole('alert')).toHaveCount(0);
  await vehicle.check();
  await expect(offer.getByRole('button', { name: '제안 보내기', exact: true })).toBeEnabled();
  await expect(offer.getByRole('status')).toHaveCount(0);
  await test.info().attach('preparation-recovered', { body: await page.screenshot(), contentType: 'image/png' });
  expect(errors).toEqual([]);
});

// 빈 DB 첫 실행 — 첫 Feature를 화면으로 등록하고 상세·Registry에 보인다(출시 준비 RD-OPS-02).
// empty 프로젝트(빈 상태 확인)가 끝난 뒤에 돈다 — 같은 DB.
// readiness: RD-OPS-02
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

test('첫 Feature 등록 — 제안 화면 → 상세 → Feature Registry에 하나', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await asRole(page, 'author');
  await page.goto('/feature/propose');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.locator('input[name="name"]').fill('첫 기능 — 원격 시동');
  await page.locator('textarea[name="description"]').fill('고객 설치에서 처음 등록하는 기능');
  await page.locator('input[name="ownerId"]').fill('usr-author');
  await page.locator('[data-ui="createFeature"]').click();
  await expect(page).toHaveURL(/\/features\/FEAT-\d+\/0\.1\.0$/);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('#main')).toContainText('첫 기능 — 원격 시동');

  const h = await (await request.get('/api/health')).json();
  expect(h.counts.features).toBe(1);

  await page.goto('/features');
  await expect(page.locator('#main')).toContainText('첫 기능 — 원격 시동');
  await expect(page.locator('.ds-error[role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

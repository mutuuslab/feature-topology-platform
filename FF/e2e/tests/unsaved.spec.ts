// 저장하지 않은 변경 보호(실제 브라우저) — Feature 제안 화면에 입력한 뒤 메뉴로 떠나려 하면 묻고, 계속 편집이면 입력이 남는다.
// readiness: RD-UX-02
import { expect, test } from '@playwright/test';

test('Feature 제안: 입력 뒤 메뉴 링크 → 확인 창, 계속 편집이면 입력 유지, 버리고 이동이면 이동', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/feature/propose');
  const name = page.locator('#main input[name="name"]');
  await name.fill('저장 안 한 제안');
  const link = page.locator('a[href="/features"]').first();
  await link.click();
  const dialog = page.locator('[data-unsaved-prompt]');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/feature\/propose$/);
  await dialog.getByRole('button', { name: '계속 편집' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(name).toHaveValue('저장 안 한 제안');
  await link.click();
  await page.locator('[data-unsaved-prompt]').getByRole('button', { name: '버리고 이동' }).click();
  await expect(page).toHaveURL(/\/features$/);
});

test('입력이 없으면 묻지 않고 이동한다', async ({ page }) => {
  await page.goto('/feature/propose');
  await expect(page.locator('#main input[name="name"]')).toBeVisible();
  await page.locator('a[href="/features"]').first().click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator('[data-unsaved-prompt]')).toHaveCount(0);
});

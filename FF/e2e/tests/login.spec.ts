// 로그인 게이트 — 데모 계정만 통과, 틀리면 오류, 로그아웃하면 다시 게이트. 오른쪽 모션은 장식(axe 영향 없음).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('로그인 — 틀린 비밀번호는 막고, FF/platform이면 내 대시보드로 들어간다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('차를 판매한 뒤에도');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page.getByRole('alert')).toContainText('ID 또는 비밀번호가 맞지 않습니다');

  await page.getByLabel('Password').fill('platform');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '업무 절차 지도' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ff.auth'))).toBe('1');

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.reduce((n, v) => n + v.nodes.length, 0)).toBe(0);

  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '플랫폼 들어가기' })).toBeVisible();
});

test('로그인 — 좁은 화면에서 모션은 숨고 가로 넘침이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '플랫폼 들어가기' })).toBeVisible();
  await expect(page.locator('.lg__motion')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

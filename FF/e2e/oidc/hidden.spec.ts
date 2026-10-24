// 운영 빌드(VITE_AUTH=oidc)에서 숨기는 데모·개발 화면(결정 D-RD-8) — 디자인 시스템 갤러리(/_design)·표준 따라하기(/learn).
// 메뉴·⌘K에 없고, 직접 주소는 기존 '찾는 항목이 없습니다' 화면. 데모 빌드는 그대로(e2e learn·dashboard 시험, tools/prod-bundle.test).
import { expect, test, type Page } from '@playwright/test';

async function ssoLogin(page: Page, user: string, path = '/') {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: '회사 계정(SSO)으로 로그인' }).click();
  await page.locator(`a[data-user="${user}"]`).click();
}

test('운영 빌드 — 메뉴·⌘K에 디자인 시스템·표준 따라하기가 없다', async ({ page }) => {
  await ssoLogin(page, 'author');
  await expect(page.locator('[data-sso-name]')).toHaveText('김작성');
  // 홈 그룹이 펼쳐진 메뉴 — 다른 홈 화면은 있고 따라하기는 없다
  await expect(page.locator('a[href="/notifications"]').first()).toBeAttached();
  await expect(page.locator('a[href="/learn"], a[href="/_design"]')).toHaveCount(0);
  await page.keyboard.press('Control+K');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: /알림/ }).first()).toBeVisible();
  await expect(list.getByRole('option', { name: /표준 따라하기|디자인 시스템/ })).toHaveCount(0);
});

test('운영 빌드 — 직접 주소 /_design·/learn은 찾을 수 없음 화면', async ({ page }) => {
  await ssoLogin(page, 'author', '/_design');
  await expect(page).toHaveURL(/\/_design$/);
  await expect(page.locator('[data-not-found]')).toBeVisible();
  await expect(page.locator('[data-design-gallery]')).toHaveCount(0);
  for (const path of ['/learn', '/learn/CS-01']) {
    await page.goto(path);
    await expect(page.locator('[data-not-found]')).toBeVisible();
    await expect(page.locator('[data-learn]')).toHaveCount(0);
  }
});

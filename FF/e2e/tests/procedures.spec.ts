// 업무 절차 실행 UI — 서버 저장(빠른 완료), 화면 패널의 표준 따라하기(앵커 스포트라이트).
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      localStorage.removeItem('ff.learn.v1');
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

test('메인 화면 — 업무 절차 지도에 13개 절차·Gate·내 차례가 보이고 절차로 들어간다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'author');
  // 최초 진입은 역할 기본 화면으로 간다 — 홈 메뉴로 내 대시보드에 들어간다(실제 사용자 경로)
  await page.goto('/procedures');
  await page.getByRole('button', { name: '홈' }).click();
  await page.getByRole('link', { name: '내 대시보드' }).click();
  await expect(page.getByRole('heading', { name: '업무 절차 지도' })).toBeVisible();
  const nodes = page.locator('.pm-node');
  // 메인 지도는 HARA(FPW.2) 제외 — 12개
  await expect(nodes).toHaveCount(12);
  await expect(page.getByText(/HARA/)).toHaveCount(0);
  const first = page.locator('.pm-node').first();
  await expect(first).toContainText('FPW.1');
  await expect(first).toContainText('G1');
  await expect(first).toContainText('내 차례');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await first.click();
  await expect(page).toHaveURL(/\/procedures\/FPW\.1$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('FPW.1');
});

test('업무 절차 허브 — 빠른 완료가 진행률과 다음 할 일을 바꾼다(서버 저장)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'author');
  await page.goto('/procedures?view=list');
  await expect(page.getByRole('heading', { level: 1, name: '업무 절차' })).toBeVisible();
  const progress = page.locator('.pr-progress');
  await expect(progress).toContainText('할 일');
  const before = await progress.textContent();

  const first = page.locator('.pr-mine input[type="checkbox"]').first();
  await expect(first).not.toBeChecked();
  await first.click();
  await expect(first).toBeChecked();
  await expect(progress).not.toHaveText(before ?? '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('표준 따라하기 — 화면 패널에서 시작하면 서랍이 닫히고 대상이 강조된다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'author');
  await page.goto('/feature/propose');
  await expect(page.locator('[data-tour="feature-form"]')).toBeVisible();

  await page.getByRole('button', { name: '이 화면의 업무 절차' }).click();
  await page.getByRole('button', { name: /FPW\.1-A01 표준 따라하기/ }).click();

  const guide = page.locator('.pr-guide');
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { level: 2 })).toContainText('FPW.1-A01');
  await expect(page.locator('[data-tour="feature-form"][data-tour-active="true"]')).toBeVisible();
  await expect(page.locator('.sh-spot')).toBeVisible();
  await expect(guide.getByText('화면의 입력·버튼')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await guide.getByRole('button', { name: '닫기' }).click();
  await expect(guide).toHaveCount(0);
});

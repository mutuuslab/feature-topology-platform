// 내 대시보드 — Jira식 가젯 판을 실제 브라우저에서: 손잡이를 끌어 정확한 자리에 놓기, 새로 고침 뒤 배치 유지, 가젯 추가, 키보드 배치 메뉴.
import { expect, test, type Page } from '@playwright/test';

const columns = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.db-col')].map((c) => [...c.querySelectorAll(':scope > [data-gadget]')].map((g) => g.getAttribute('data-gadget'))));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.locator('#main .db-board')).toBeVisible();
});

test('끌어 놓기: 오른쪽 열의 가젯을 왼쪽 열 맨 위 가젯 위에 놓으면 그 자리에 들어가고, 새로 고침해도 남는다', async ({ page }) => {
  const before = await columns(page);
  const first = before[0][0]!;
  await page.locator('[data-gadget="lifecycle"] .db-grip').dragTo(page.locator(`[data-gadget="${first}"] .db-gadget__head`), { targetPosition: { x: 40, y: 4 } });
  const after = await columns(page);
  expect(after[0][0]).toBe('lifecycle');
  expect(after[1]).not.toContain('lifecycle');
  await expect(page.locator('.db-drop')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#main .db-board')).toBeVisible();
  expect((await columns(page))[0][0]).toBe('lifecycle');
});

test('가젯 추가: 창에서 고르면 첫 열 맨 위, 창에는 추가됨으로 바뀐다', async ({ page }) => {
  await page.getByRole('button', { name: '가젯 추가' }).click();
  const dir = page.getByRole('dialog');
  await dir.getByRole('button', { name: '최근 활동 추가' }).click();
  await expect(dir.locator('[data-gadget-entry="activity"]')).toContainText('추가됨');
  await page.keyboard.press('Escape');
  expect((await columns(page))[0][0]).toBe('activity');
});

test('키보드 배치 메뉴: 끌기 없이 옮기고 Escape로 닫는다', async ({ page }) => {
  const menu = page.getByRole('button', { name: '바로 가기 배치 메뉴' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '왼쪽 열로' }).click();
  expect((await columns(page))[0]).toContain('links');
  await page.getByRole('button', { name: '바로 가기 배치 메뉴' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('레이아웃: 3열로 바꾸면 세 열이 나란하고 가로 넘침이 없다', async ({ page }) => {
  await page.getByRole('radio', { name: '3열' }).click();
  const box = await page.evaluate(() => [...document.querySelectorAll('.db-col')].map((c) => c.getBoundingClientRect().left));
  expect(box).toHaveLength(3);
  expect(box[0]).toBeLessThan(box[1]);
  expect(box[1]).toBeLessThan(box[2]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

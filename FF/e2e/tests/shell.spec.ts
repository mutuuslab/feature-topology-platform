// 메뉴 크롤 — 모든 메뉴 항목이 열리고(404·런타임 오류 없음), 셸이 해상도별로 깨지지 않는다.
import { expect, test } from '@playwright/test';
import { MENU_ENTRIES } from './menu';

test('메뉴 항목이 40개 이상이고 8그룹을 모두 덮는다', () => {
  expect(MENU_ENTRIES.length).toBeGreaterThanOrEqual(40);
  expect(new Set(MENU_ENTRIES.map((m) => m.group)).size).toBe(8);
});

for (const m of MENU_ENTRIES) {
  test(`메뉴 열림: ${m.title} (${m.menu})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (m.menu === '/') {
      // 첫 진입은 역할 기본 화면으로 착지한다 — 사용자처럼 메뉴로 대시보드에 들어간다
      await page.goto('/_design');
      await page.getByRole('button', { name: '홈', exact: true }).click();
      await page.getByRole('complementary', { name: '홈' }).getByRole('link', { name: m.title }).click();
    } else await page.goto(m.menu);
    await expect(page.locator('#main')).toBeVisible();
    // NotFound 화면이 아니어야 한다
    await expect(page.locator('[data-not-found]')).toHaveCount(0);
    // 라우트 경계(RouteBoundary)가 오류를 잡지 않았어야 한다
    await expect(page.locator('[data-route-error]')).toHaveCount(0);
    // 셸 breadcrumb 마지막 칸 = 메뉴 이름
    await expect(page.locator('.sh-trail [aria-current="page"]')).toHaveText(m.title);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

for (const [w, h] of [
  [1366, 768],
  [1536, 864],
  [1920, 1080],
] as const) {
  test(`셸 레이아웃 ${w}×${h}: 가로 넘침 없음·레일·상단바 고정`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/_design');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // 세로도 문서 바깥은 스크롤되지 않는다 — 본문(.sh-main) 안에서만. 회귀: 표 캡션(.ds-sr, absolute)이 본문 밖 기준으로 배치돼 셸 아래 빈 띠가 생기던 문제
    const vOverflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(vOverflow).toBeLessThanOrEqual(0);
    const top = await page.locator('.sh-top').boundingBox();
    const rail = await page.locator('.sh-rail').boundingBox();
    expect(top!.width).toBeCloseTo(w, -1);
    expect(rail!.y).toBeGreaterThanOrEqual(top!.height - 1);
    // 레일 8그룹이 화면 안에 다 보인다
    const last = await page.locator('.sh-rail__btn').nth(7).boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(h);
  });
}

test('시연 모드: P 키로 켜면 글자가 커지고 그룹 패널이 숨는다', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/_design');
  const base = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  await page.keyboard.press('p');
  await expect(page.locator('html')).toHaveAttribute('data-present', 'on');
  const big = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(parseFloat(big)).toBeGreaterThan(parseFloat(base));
  await expect(page.locator('.sh-panel')).toBeHidden();
});

test('운영·안전 화면은 관제실 톤(어두운 본문)', async ({ page }) => {
  await page.goto('/fleet');
  const bg = await page.locator('#main').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect((r + g + b) / 3).toBeLessThan(40);
});

test('위험 액션은 대상 ID를 정확히 입력해야 실행된다 (type-to-confirm)', async ({ page }) => {
  await page.goto('/_design');
  await page.getByRole('button', { name: /긴급 차단 실행/ }).click();
  const dialog = page.getByRole('alertdialog');
  const run = dialog.getByRole('button', { name: 'Kill' });
  await expect(run).toBeDisabled();
  await dialog.getByRole('textbox').fill('FEAT-0002');
  await expect(run).toBeDisabled();
  await dialog.getByRole('textbox').fill('FEAT-00022');
  await expect(run).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

// 회귀: 1366 관제실 영역에서 GateRail 이름("Safety/Security Gate")이 말줄임으로 잘렸다 — 이름은 잘리지 않고 줄바꿈된다
for (const w of [1366, 1920]) {
  test(`Gate 레일 이름은 ${w}에서 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/_design');
    const names = page.locator('.ds-gate__name');
    await expect(names.first()).toBeVisible();
    const clipped = await names.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent));
    expect(clipped).toEqual([]);
  });
}

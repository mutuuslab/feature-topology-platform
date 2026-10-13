// 표준 따라하기(U1 보기 모드) — 허브 → CS-01 시작 → 가이드 패널이 화면을 옮겨 다니며 대상을 강조하고 역할을 전환한다.
// 레이아웃: 1366(떠 있는 패널)·1920(오른쪽 열)·시연 모드(아래 자막 띠)에서 가로 넘침이 없어야 한다.
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

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [w, h] of [[1366, 768], [1920, 1080]] as const) {
  test(`CS-01 보기 모드 ${w}: 시작 → 분류 화면 강조 → vECU 화면 → 역할 전환 → 끝내기`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await asRole(page, 'author');
    await page.goto('/learn');
    await page.getByRole('link', { name: /거리 추정 오류/ }).click();
    await page.getByRole('button', { name: '보기 모드로 시작' }).click();
    const dock = page.getByRole('complementary', { name: '따라하기 가이드' });
    await expect(dock.getByRole('heading', { level: 2 })).toHaveText('무엇을 확인하나');
    await expect(page.locator('[data-tour="learn-compare"][data-tour-active="true"]')).toBeVisible();
    await expect(page.locator('.sh-spot')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/\/features\/FEAT-00022\/1\.0\.0$/);
    await expect(page.locator('[data-tour="feature-header"][data-tour-active="true"]')).toBeVisible();
    await expect(dock.getByText('대상 강조 중')).toBeVisible();

    await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/\/validations\/virtual$/);
    await expect(page.locator('[data-tour="vecu-status"][data-tour-active="true"]')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    // 마지막 단계(G5)는 품질 검토 역할 — 배너 → 전환
    for (let i = 0; i < 4; i++) await dock.getByRole('button', { name: '다음' }).click();
    await expect(page).toHaveURL(/tab=gates/);
    await expect(dock.getByText(/역할로 진행합니다/)).toBeVisible();
    await dock.getByRole('button', { name: '역할 전환' }).click();
    await expect(dock.getByText(/현재 역할이 맞습니다/)).toBeVisible();
    await expect(page).toHaveURL(/tab=gates/); // 역할 전환은 화면을 옮기지 않는다
    await expect(page.locator('[data-tour="gate-g5"][data-tour-active="true"]')).toBeVisible();

    await dock.getByRole('button', { name: '끝내기', exact: true }).click();
    await expect(page).toHaveURL(/\/learn\/CS-01$/);
    await expect(dock).toHaveCount(0);
  });
}

test('시연 모드: 가이드는 본문 아래 자막 띠 — 가로 넘침 없음, 접으면 버튼만', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => localStorage.setItem('ff.present', '1'));
  await asRole(page, 'author');
  await page.goto('/learn/CS-01');
  await page.getByRole('button', { name: '보기 모드로 시작' }).click();
  const dock = page.getByRole('complementary', { name: '따라하기 가이드' });
  const box = await dock.boundingBox();
  expect(box!.y).toBeGreaterThan(1080 / 2); // 아래쪽 띠
  expect(await noHorizontalOverflow(page)).toBe(true);
  await dock.getByRole('button', { name: '가이드 접기' }).click();
  await expect(page.getByRole('button', { name: '가이드 펼치기' })).toBeVisible();
});

test('표준 설명 모드: 켜면 화면 요소 옆 근거 칩이 보이고 누르면 보고서 원문', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/_design');
  await expect(page.locator('.ds-explain').first()).toBeHidden(); // 꺼져 있으면 접근성 트리에서도 빠진다
  const toggle = page.getByRole('button', { name: '근거 규칙 보기' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const chip = page.locator('.ds-explain').getByRole('button', { name: 'FFG-CLS-009 원문 요약 보기' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('dialog')).toContainText('ISO 26262-3:2018 cl.7');
});

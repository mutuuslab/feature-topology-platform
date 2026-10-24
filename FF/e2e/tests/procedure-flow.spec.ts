// 업무 절차 흐름도 — 절차 흐름도가 보이고 상자를 누르면 활동이 열린다, 역할을 바꾸면 내 업무 흐름이 바뀐다, 텍스트 보기 전환, 메인 가젯 작은 판.
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

const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const w of [1366, 1920]) {
  test(`절차 흐름도 ${w} — 스윔레인·Gate·상태가 보이고, 상자를 누르면 활동 상세가 열린다`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await asRole(page, 'author');
    await page.goto('/procedures/FPW.1');
    const flow = page.getByRole('group', { name: 'FPW.1 흐름도' });
    await expect(flow).toBeVisible();
    await expect(flow.locator('.pf-node--activity')).toHaveCount(5);
    await expect(flow.getByRole('button', { name: /G1 판정/ })).toBeVisible();
    await expect(flow.getByRole('img', { name: /시작 — 진입 조건/ })).toBeVisible();
    // 상태는 글자로도 — Feature Owner의 첫 활동은 내 차례이거나 이미 완료
    await expect(flow.getByRole('button', { name: /FPW\.1-A01 .*(내 차례|완료)/ })).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);

    // 키보드로도 연다
    const a03 = flow.getByRole('button', { name: /^FPW\.1-A03 / });
    await a03.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/a=FPW\.1-A03/);
    await expect(page.getByRole('heading', { name: /FPW\.1-A03/ })).toBeVisible();
    await expect(page.getByText('완료 기준').first()).toBeVisible();

    await flow.getByRole('button', { name: /^FPW\.1-A04 / }).click();
    await expect(page).toHaveURL(/a=FPW\.1-A04/);
    await expect(page.getByRole('heading', { name: /FPW\.1-A04/ })).toBeVisible();
  });
}

test('절차서 표기 — 입력·산출물 레인의 문서, 제어 흐름과 객체 흐름, 고정 레인 머리, 활동·산출물 카드', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'operator');
  await page.goto('/procedures/FPW.8');
  const flow = page.getByRole('group', { name: 'FPW.8 흐름도' });
  await expect(flow).toBeVisible();
  const heads = flow.locator('.pf-lanehead__text');
  await expect(heads.first()).toHaveText('입력 (Inputs)');
  await expect(heads.last()).toHaveText('산출물 (Outputs)');
  // 산출물 = 문서 상자(밖에서 오는 입력은 점선 문서), 제어 흐름(실선)과 객체 흐름(점선)이 따로
  await expect(flow.locator('.pf-doc[data-external]').first()).toBeVisible();
  expect(await flow.locator('.pf-doc:not([data-external]):not([data-ref])').count()).toBe(11);
  expect(await flow.locator('polyline.pf-cf').count()).toBeGreaterThan(10);
  expect(await flow.locator('polyline.pf-of').count()).toBeGreaterThan(10);
  // 넓은 흐름도 — 가로로 스크롤해도 레인 머리는 왼쪽에 남는다
  const scroller = page.locator('.pf-scroll[data-wide]');
  await expect(scroller).toBeVisible();
  const sticky = scroller.locator('svg.pf-lanes');
  await expect(sticky).toBeVisible();
  const before = await sticky.boundingBox();
  await scroller.evaluate((el) => (el.scrollLeft = 600));
  await expect.poll(async () => (await sticky.boundingBox())?.x).toBe(before?.x);
  // 흐름도 아래 절차서 본문 — 요약 문장, 활동 카드(RACI·입력/출력·수행 절차·완료 기준), 산출물 카드
  await expect(page.locator('.pf-lead')).toContainText('활동 11개');
  const card = page.locator('[data-activity-card="FPW.8-A04"]');
  await expect(card.locator('.pf-raci-badge[data-k="R"]')).toBeVisible();
  await expect(card.getByText('수행 절차')).toBeVisible();
  await expect(page.locator('[data-wp-card]').first()).toBeVisible();
  await card.getByRole('button', { name: '흐름도에서 고르기' }).click();
  await expect(page).toHaveURL(/a=FPW\.8-A04/);
  await expect(card).toHaveAttribute('data-selected', '');
  expect(await noPageOverflow(page)).toBe(true);
});

test('텍스트 보기 — 흐름도와 같은 활동을 표로 보이고, 다시 흐름도로 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'operator');
  await page.goto('/procedures/FPW.8');
  await expect(page.getByRole('group', { name: 'FPW.8 흐름도' })).toBeVisible();
  await page.getByRole('radio', { name: '텍스트' }).click();
  const table = page.getByRole('table', { name: /FPW\.8 활동 순서/ });
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(11);
  await expect(page.getByRole('group', { name: 'FPW.8 흐름도' })).toHaveCount(0);
  await page.getByRole('radio', { name: '흐름도' }).click();
  await expect(page.getByRole('group', { name: 'FPW.8 흐름도' })).toBeVisible();
  expect(await noPageOverflow(page)).toBe(true);
});

test('내 업무 흐름 — 역할 전환기에서 역할을 바꾸면 흐름이 그 역할 것으로 바뀐다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'author');
  await page.goto('/procedures');
  const flow = page.getByRole('group', { name: '내 업무 흐름' });
  await expect(flow).toBeVisible();
  await page.getByRole('radio', { name: /전체/ }).click();
  const steps = flow.locator('[data-step]');
  await expect(steps.first()).toBeVisible();
  const before = await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
  expect(before).toContain('FPW.1-A01');
  await expect(flow.locator('.pf-chain').first()).toBeAttached();

  // 역할을 바꾸면 그 역할의 첫 화면으로 간다 — 업무 절차로 돌아와 흐름을 본다(저장된 역할 그대로)
  await page.getByRole('combobox', { name: '역할' }).selectOption('operator');
  await page.goto('/procedures');
  await expect(page.getByRole('combobox', { name: '역할' })).toHaveValue('operator');
  await page.getByRole('radio', { name: /전체/ }).click();
  const flow2 = page.getByRole('group', { name: '내 업무 흐름' });
  await expect(flow2.locator('[data-step]').first()).toBeVisible();
  const after = await flow2.locator('[data-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
  expect(after.join(',')).not.toBe(before.join(','));
  expect(after).not.toContain('FPW.1-A01');
  expect(after.some((id) => id?.startsWith('FPW.8-'))).toBe(true);

  // 내 활동을 누르면 그 절차의 활동 상세로
  await page.getByRole('group', { name: '내 업무 흐름' }).getByRole('button').first().click();
  await expect(page).toHaveURL(/\/procedures\/FPW\.\d+\?a=FPW\.\d+-A\d+/);
  await expect(page.getByRole('group', { name: /FPW\.\d+ 흐름도/ })).toBeVisible();
});

test('내 업무 흐름 텍스트 보기 · 전체 지도에서 절차 흐름도로', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'quality');
  await page.goto('/procedures?view=flow');
  await expect(page.getByRole('group', { name: '내 업무 흐름' })).toBeVisible();
  await page.getByRole('radio', { name: '텍스트' }).click();
  await expect(page.getByRole('table', { name: /내 업무 흐름/ })).toBeVisible();
  await page.getByRole('tab', { name: '전체 지도' }).click();
  const map = page.getByRole('group', { name: '전체 지도' });
  await expect(map).toBeVisible();
  await expect(map.locator('.pf-proc')).toHaveCount(13);
  await expect(map.locator('.pf-proc[data-mine]').first()).toBeVisible();
  expect(await noPageOverflow(page)).toBe(true);
  await map.getByRole('link', { name: /^FPW\.5 / }).click();
  await expect(page).toHaveURL(/\/procedures\/FPW\.5$/);
  await expect(page.getByRole('group', { name: 'FPW.5 흐름도' })).toBeVisible();
});

test('메인 화면 업무 절차 가젯 — 내 업무 흐름 작은 판이 지연 로딩되고 전체 보기로 이어진다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await asRole(page, 'author');
  await page.goto('/procedures');
  await page.getByRole('button', { name: '홈' }).click();
  await page.getByRole('link', { name: '내 대시보드' }).click();
  const compact = page.locator('[data-flow-compact]');
  await expect(compact).toBeVisible();
  await expect(compact.getByRole('group', { name: '내 업무 흐름' }).locator('[data-step]').first()).toBeVisible();
  expect(await noPageOverflow(page)).toBe(true);
  await compact.getByRole('link', { name: '내 업무 흐름 전체 보기' }).click();
  await expect(page).toHaveURL(/\/procedures\?view=flow$/);
  await expect(page.getByRole('group', { name: '내 업무 흐름' })).toBeVisible();
});

for (const w of [1366, 1920]) {
  test(`담당자별 업무 흐름 ${w} — 메뉴에서 열어 다른 담당자를 고르면 역할 전환 없이 그 흐름이 보이고, 새로 고쳐도 남는다`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await asRole(page, 'author');
    await page.goto('/procedures');
    await page.getByRole('button', { name: '홈' }).click();
    await page.getByRole('link', { name: '담당자별 업무 흐름' }).click();
    await expect(page).toHaveURL(/\/procedures\/roles$/);
    await expect(page.getByRole('heading', { level: 1, name: '담당자별 업무 흐름' })).toBeVisible();
    await expect(page.locator('.pf-role[data-me]')).toHaveAttribute('data-persona', 'author');

    await page.locator('.pf-role[data-persona="operator"]').click();
    await expect(page).toHaveURL(/role=operator/);
    const flow = page.getByRole('group', { name: /업무 흐름$/ }).filter({ has: page.locator('[data-step]') });
    await expect(flow.locator('[data-step^="FPW.8-"]').first()).toBeAttached();
    // 역할 전환기는 그대로
    await expect(page.getByRole('combobox', { name: '역할' })).toHaveValue('author');
    expect(await noPageOverflow(page)).toBe(true);

    await page.reload();
    await expect(page.locator('.pf-role[data-persona="operator"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-step^="FPW.8-"]').first()).toBeAttached();
    await expect(page.getByRole('combobox', { name: '역할' })).toHaveValue('author');

    // 담당자 × 절차 표의 칸 → 그 절차 흐름도에서 담당자 레인 강조
    await page.locator('[data-cell="operator:FPW.8"]').click();
    await expect(page).toHaveURL(/\/procedures\/FPW\.8\?role=operator/);
    await expect(page.getByRole('group', { name: 'FPW.8 흐름도' }).locator('[data-lane][data-focus]').first()).toBeAttached();
  });
}

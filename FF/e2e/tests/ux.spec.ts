// 화면별 UX 하네스 — 설계안 4e: 메뉴 화면마다 ① 1366 노트북에서 가로 넘침 없음 ② API 실패·권한 거부·지연을 강제로 만들어
// AsyncView 상태(data-state=error·forbidden·loading)와 한글 안내가 나오고 셸이 깨지지 않음을 본다.
// API를 부르지 않는 화면(디자인 갤러리 등)은 상태 검사 대상이 아니다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_ENTRIES } from './menu';

const BUDGET = JSON.parse(readFileSync(join(__dirname, '..', '..', 'harness', 'budgets.json'), 'utf8')) as { firstScreenMs: number };

const SCREENS = MENU_ENTRIES.filter((m) => m.menu !== '/');

async function forceApi(page: Page, status: number, delayMs = 0) {
  let hits = 0;
  await page.route(/\/api\/(?!health|events\/stream)/, async (route) => {
    // 상단바 종의 최근 알림(limit=6)은 셸 공통 조회 — 화면 상태 검사 대상이 아니다
    if (/\/api\/notifications\?limit=6$/.test(route.request().url())) return route.continue();
    hits++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL', message: status === 403 ? '권한이 없습니다' : '시험용 서버 오류' } }) });
  });
  return () => hits;
}

for (const m of SCREENS) {
  test.describe(`UX: ${m.title} (${m.menu})`, () => {
    test('1366×768 — 문서 가로 넘침 없음', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(m.menu);
      await expect(page.locator('#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, '가로 스크롤이 생긴다 — 넓은 표는 표 안에서 스크롤해야 한다').toBeLessThanOrEqual(0);
      // ID 칩은 제 내용보다 좁아지지 않는다 — 격자 칸에 눌리면 글자·버튼이 칩 배경 밖으로 나간다(UPG 지원 Feature 칸 회귀)
      const squeezed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ds-id')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.dataset.id));
      expect(squeezed, `칩 배경보다 내용이 넓다: ${squeezed.slice(0, 5).join(', ')}`).toEqual([]);
    });

    test('API 오류(500) — 오류 상태와 다시 시도, 셸 유지', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const hits = await forceApi(page, 500);
      await page.goto(m.menu);
      await expect(page.locator('#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      test.skip(hits() === 0, 'API를 부르지 않는 화면');
      await expect(page.locator('[data-route-error]')).toHaveCount(0);
      await expect(page.locator('[data-state="error"], .ds-error[role="alert"]').first()).toBeVisible();
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('권한 거부(403) — 권한 안내 상태', async ({ page }) => {
      const hits = await forceApi(page, 403);
      await page.goto(m.menu);
      await expect(page.locator('#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      test.skip(hits() === 0, 'API를 부르지 않는 화면');
      await expect(page.locator('[data-route-error]')).toHaveCount(0);
      await expect(page.locator('[data-state="forbidden"], .ds-error[role="alert"]').first()).toBeVisible();
    });

    test('응답 지연 — 로딩 골격(skeleton)이 먼저 보인다', async ({ page }) => {
      const hits = await forceApi(page, 500, 2500);
      await page.goto(m.menu);
      await expect(page.locator('#main')).toBeVisible();
      await page.waitForTimeout(300);
      test.skip(hits() === 0, 'API를 부르지 않는 화면');
      await expect(page.locator('[data-state="loading"]').first()).toBeVisible();
    });
  });
}

// 첫 화면 시간 예산 — 주소 이동부터 h1과 데이터(ready)가 보일 때까지 (빌드본 preview 기준, harness/budgets.json)
for (const url of ['/features', '/features/FEAT-00022/1.0.0', '/products', '/ops/kill', '/fleet/live']) {
  test(`첫 화면 ${url} ≤ ${BUDGET.firstScreenMs}ms`, async ({ page }) => {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[data-state="ready"]').first()).toBeVisible();
    expect(Date.now() - t0).toBeLessThanOrEqual(BUDGET.firstScreenMs);
  });
}

// Feature 요약 서랍(설계안 2.1) — 목록 행 안의 '요약 보기'는 행을 열지 않고 서랍만 연다. 서랍에서 상세로 이동하면 닫힌다.
test('Feature 요약 서랍: 목록에서 열고, 키보드로 상세 이동', async ({ page }) => {
  await page.goto('/features');
  const peek = page.getByRole('button', { name: /^요약 보기 FEAT-00022@/ }).first();
  await peek.click();
  await expect(page).toHaveURL(/\/features(\?.*)?$/);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByTestId('feature-peek')).toBeVisible();
  await expect(dlg).toContainText('Gate G1~G9');
  await expect(dlg).toContainText('CAT-');
  await dlg.getByRole('link', { name: '상세 열기' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/features\/FEAT-00022\/[\d.]+$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

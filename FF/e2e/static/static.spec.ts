// 정적 데모 — 모든 메뉴·하위 화면이 스냅샷만으로 열린다: 요청한 /api-snapshot/ 파일은 모두 200·JSON이어야 한다.
// 빠진 파일은 SPA 대체 응답(index.html)으로 와서 화면이 오류가 된다 — 그 URL을 모아 실패 메시지로 낸다(tools/snapshot-api.ts에 추가할 목록).
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from '../tests/menu';

const targets = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))];

/** 요청한 스냅샷 중 없는 파일 모으기 — 빠진 파일은 SPA 대체 응답(index.html)으로 온다 */
function watch(page: Page) {
  const missing = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.includes('/api-snapshot/')) return;
    if (r.status() !== 200 || !(r.headers()['content-type'] ?? '').includes('json')) missing.add(decodeURIComponent(u.pathname.replace(/^.*\/api-snapshot\//, '')));
  });
  return { missing, errors };
}

/** 화면이 뜬 뒤 탭을 모두 차례로 연다 — 탭마다 따로 조회한다 */
async function openAllTabs(page: Page) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const tabs = page.getByRole('tab');
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await page.waitForLoadState('networkidle');
  }
}

for (const t of targets) {
  test(`정적 데모: ${t.title} (${t.url})`, async ({ page }) => {
    const { missing, errors } = watch(page);
    await page.goto(t.url);
    await openAllTabs(page);
    expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// 변경 요청 상세는 시드에 고정 번호가 없다 — 정적 데모용 예시 요청(snapshot-api.ts)을 목록에서 연다
test('정적 데모: Feature DB 변경 요청 상세 (목록에서 열기)', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db/changes');
  await openAllTabs(page);
  // 탭을 모두 돈 뒤에는 마지막 탭(반려)에 있다 — '전체'로 돌아가 예시 요청을 연다
  await page.getByRole('tab').first().click();
  const link = page.locator('#main a[href^="/master/feature-db/changes/CR-"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/master\/feature-db\/changes\/CR-\d{4}-\d+$/);
  await openAllTabs(page);
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// Feature DB 목록 → 다른 쪽·상태·도메인 → 기준 행 상세, 등록 1단계 도메인·컴포넌트 패싯도 스냅샷만으로
test('정적 데모: Feature DB 쪽·필터·상세와 등록 1단계 패싯', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db?page=1');
  await openAllTabs(page);
  await page.goto('/master/feature-db?status=REVIEW');
  await openAllTabs(page);
  await page.goto('/master/feature-db?domain=Chassis%20%26%20Vehicle%20Dynamics');
  await openAllTabs(page);
  await page.locator('#main a[href^="/master/feature-db/CH-"]').first().click();
  await openAllTabs(page);
  await page.goto('/feature/propose');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.locator('select[name="refDomain"]').selectOption('Chassis & Vehicle Dynamics');
  await page.locator('select[name="refComponent"]').selectOption('Brake control (ESC/ABS)');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main [data-state="error"]')).toHaveCount(0);
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

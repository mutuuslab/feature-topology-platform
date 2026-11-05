// 정적 데모 — 모든 메뉴·하위 화면이 스냅샷만으로 열린다: 요청한 /api-snapshot/ 파일은 모두 200·JSON이어야 한다.
// 빠진 파일은 SPA 대체 응답(index.html)으로 와서 화면이 오류가 된다 — 그 URL을 모아 실패 메시지로 낸다(tools/snapshot-api.ts에 추가할 목록).
// 탭마다 본문 오류 상자([data-state=error])도 0이어야 한다(하네스 리뷰 H10 — 파일은 있어도 화면이 오류일 수 있다).
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

/** 본문 오류 상자 0 — 화면 이름과 탭 이름을 실패 메시지에 */
async function noErrorBox(page: Page, where: string) {
  await expect(page.locator('#main [data-state="error"]'), `${where}: 본문에 오류 상자가 보인다`).toHaveCount(0);
}

/** 화면이 뜬 뒤 탭을 모두 차례로 연다 — 탭마다 따로 조회하고, 탭마다 오류 상자가 없는지 본다 */
async function openAllTabs(page: Page) {
  // URL 전환 뒤 지연 모듈이 실제로 읽힐 때까지 기다린다. 이전 화면의 탭을 세면 사라진 탭을 누른다.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main h1').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await noErrorBox(page, page.url());
  const tabs = page.getByRole('tab');
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await page.waitForLoadState('networkidle');
    await noErrorBox(page, `${page.url()} 탭 ${i + 1}`);
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
  // 탭을 모두 돈 뒤에는 마지막 탭(출처)에 있다 — '기준 행'으로 돌아가 행을 연다
  await page.getByRole('tab').first().click();
  await page.locator('#main a[href^="/master/feature-db/CH-"]').first().click();
  // 상세로 옮겨 간 뒤에 탭을 센다 — 목록의 탭(기준 행·출처)을 세면 사라진 탭을 누른다
  await expect(page).toHaveURL(/\/master\/feature-db\/CH-/);
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

// 기준 행이 연결된 Feature(FEAT-00145 스마트 크루즈 컨트롤) — '기준 행' 탭의 상태·'바뀐 버전'이 스냅샷으로 채워진다.
// 연결은 Version 상세에만 있다 — 목록에서 모으면 '바뀐 버전' 칸이 늘 '—'였다(하네스 리뷰 F4)
test('정적 데모: 기준 행이 연결된 Feature의 기준 행 탭', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/features/FEAT-00145/5.5.0?tab=refs');
  const table = page.getByRole('table', { name: '연결된 기준 행' });
  await expect(table).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(table.locator('[data-ref-status]').first()).toBeVisible();
  // '바뀐 버전' 칸 — 읽지 못하면 '—'(로딩)로 남는다
  await expect(table.getByText(/변경 없음|에서 바뀜/).first()).toBeVisible();
  await noErrorBox(page, 'FEAT-00145 기준 행 탭');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

// 검색 — 정적 데모에는 검색어 스냅샷이 없다. 받아 둔 전체 목록에서 화면이 찾는다(오류 상자 없음, 하네스 리뷰 F5)
test('정적 데모: Feature DB 목록·등록 1단계 검색 AVH', async ({ page }) => {
  const { missing, errors } = watch(page);
  await page.goto('/master/feature-db');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.getByRole('searchbox', { name: '검색' }).fill('AVH');
  await expect(page.locator('#main a[href="/master/feature-db/CH-BRK-009"]').first()).toBeVisible();
  await noErrorBox(page, 'Feature DB 검색');
  await page.goto('/feature/propose');
  await page.locator('input[name="refSearch"]').fill('AVH');
  await expect(page.getByRole('button', { name: 'CH-BRK-009 대표로' })).toBeVisible();
  await noErrorBox(page, '등록 1단계 검색');
  expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
  expect(errors).toEqual([]);
});

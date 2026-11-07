// 공개 시연 사이트 — 업무 묶음 흐름을 브라우저 안 시연 데이터로 끝까지(설계 docs/20-architecture/20-60-browser-simulator.md, handlers/business.ts).
//  1. 상품: 상품 작성(commerce)이 새 Catalog Version → 구성 승인(approver) → 상품 검증 완료 → 같은 사람은 고객 출시 승인 불가(직무 분리) → 상품 Owner가 고객 출시 승인
//  2. 개발비: 산정 작성(viewer)이 과제 만들기 → Feature 담기 → 승인 요청 → 승인자(approver) 승인 → 목록·이력이 같은 상태
//  3. 협의 의견·체험 제안 — 받은 부서의 의견, 상품 작성의 체험 제안
// 단계별 화면은 SHOTS 폴더(1366 폭)에 남긴다.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.BUSINESS_SHOTS ?? 'C:/tmp/ff-static-audit/pw-out/business/shots';
let n = 0;
const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
};
/** 데모 역할 전환(상단 역할 선택) — 역할 홈으로 옮겨 간 뒤 원하는 화면으로 */
async function as(page: Page, role: string, url: string) {
  await page.getByRole('combobox', { name: '역할', exact: true }).selectOption(role);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(url);
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
}
/** 처리되지 않은 쓰기(핸들러 없음)가 없어야 한다 */
const unhandled = (page: Page) => page.evaluate(() => (window.__simUnhandled ?? []).map((x) => x.name));

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });

test('정적 시연: 상품 새 Version → 구성 승인 → 검증 → 고객 출시 승인(직무 분리)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // 1. 상품 작성 — 고객 출시된 CAT-00002 4.1.0에서 새 Version
  await as(page, 'commerce', '/products/CAT-00002/4.1.0');
  await page.getByRole('button', { name: '새 Version', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('변경 사유').fill('2027 연식 구성 갱신');
  await drawer.getByRole('button', { name: '새 Version 만들기' }).click();
  await expect(page).toHaveURL(/\/products\/CAT-00002\/4\.2\.0$/);
  await expect(page.locator('h1')).toContainText('Highway Driving Package');
  await shot(page, 'product-proposed');

  // 2. 구성 승인(approver)
  await as(page, 'approver', '/products/CAT-00002/4.2.0');
  const step = async (label: RegExp, reason: string) => {
    await page.getByRole('button', { name: label }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('사유').fill(reason);
    await d.getByRole('button', { name: '실행' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await step(/구성 승인 → APPROVED/, '구성 확인 — 3개 Feature 모두 고객 출시됨');
  await expect(page.getByRole('button', { name: /상품 검증 완료 → VERIFIED/ })).toBeVisible();
  await step(/상품 검증 완료 → VERIFIED/, '상품 검증 완료');
  // 같은 사람은 고객 출시를 승인할 수 없다 — 버튼이 막히고 이유가 보인다
  await expect(page.getByRole('button', { name: /고객 출시 승인 → RELEASED/ })).toBeDisabled();
  await shot(page, 'product-sod');

  // 3. 상품 Owner — 고객 출시 승인
  await as(page, 'productowner', '/products/CAT-00002/4.2.0');
  await step(/고객 출시 승인 → RELEASED/, '고객 출시 승인 — 판매 시작');
  await expect(page.getByRole('button', { name: /신규 판매 중단/ })).toBeVisible();
  await shot(page, 'product-released');
  // 목록·감사가 같은 상태
  await page.goto('/products');
  await expect(page.getByRole('article', { name: /CAT-00002/ }).filter({ hasText: 'CAT-00002@4.2.0' })).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByRole('row', { name: /상품 단계 전이 VERIFIED→RELEASED CAT-00002@4\.2\.0/ })).toBeVisible();
  expect(await unhandled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 시연: 개발비 과제 만들기 → Feature 담기 → 승인 요청 → 승인', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  await as(page, 'viewer', '/procurement/sw-cost');
  await page.getByRole('button', { name: '새 과제' }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('과제 이름').fill('BCM 파생 2차 견적');
  await create.getByLabel('대상 제어기·차종').fill('BCM / 파생 1종');
  await create.getByRole('button', { name: '만들기' }).click();
  await expect(page).toHaveURL(/\/procurement\/sw-cost\/EST-\d{4}$/, { timeout: 20_000 }); // 만들기는 산정 기준·Feature DB 발행본을 지연 로드해 계산한다(병렬 실행 부하에서 5초를 넘었다, 통합 12단계)
  const estId = page.url().split('/').pop()!;

  await page.getByRole('tab', { name: /기능 목록/ }).click();
  await page.getByRole('button', { name: 'Feature 담기' }).click();
  const add = page.getByRole('dialog');
  await add.getByLabel('Feature 이름·ID').fill('FEAT-00187');
  await add.getByRole('button', { name: '담기' }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /기능 목록/ })).toContainText('1');
  await shot(page, 'cost-lines');

  await page.getByRole('button', { name: '승인 요청' }).click();
  await page.getByRole('dialog').getByLabel('사유').fill('검토 요청');
  await page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('승인 대기').first()).toBeVisible();

  // 작성자와 다른 승인자가 승인
  await as(page, 'approver', `/procurement/sw-cost/${estId}`);
  await page.getByRole('button', { name: '승인', exact: true }).click();
  await page.getByRole('dialog').getByLabel('사유').fill('산정 근거 확인');
  await page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('승인됨').first()).toBeVisible();
  await page.getByRole('tab', { name: /이력/ }).click();
  await expect(page.getByRole('cell', { name: 'usr-approver' })).toBeVisible();
  await shot(page, 'cost-approved');

  await page.goto('/procurement/sw-cost');
  await expect(page.getByRole('row', { name: new RegExp(estId) })).toContainText('승인됨');
  expect(await unhandled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 시연: 협의 의견·체험 제안이 목록에 바로 반영된다', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // 체험 제안 — 상품 작성(commerce)
  await as(page, 'commerce', '/entitlements?catalog=CAT-00019');
  const offer = page.getByRole('region', { name: '체험 제안' });
  await expect(offer).toBeVisible();
  await offer.getByRole('checkbox', { name: /KMH-NX4-0001/ }).check();
  await offer.getByRole('button', { name: '제안 보내기' }).click();
  await expect(offer.getByRole('status')).toBeVisible();
  await shot(page, 'trial-offered');

  // 협의 의견 — 구매 부서(받은 부서)가 품질 부서의 협의 요청에 의견
  await page.locator('[data-dept-select]').first().selectOption('DEP-PUR');
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/consults/CON-2026-004');
  const form = page.getByRole('region', { name: '의견 남기기' });
  await form.getByRole('radio', { name: '보완' }).click();
  await form.getByLabel(/메모/).fill('계약서 시정 조항을 보완해 주세요');
  await form.locator('[data-ui="answerConsultation"]').click();
  await expect(form.getByRole('status')).toBeVisible();
  await expect(page.getByText('계약서 시정 조항을 보완해 주세요').first()).toBeVisible();
  await shot(page, 'consult-answered');
  expect(await unhandled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('정적 시연: 외부 JIRA·연계 화면에서 바꾸면 플랫폼 판정(거부·되돌림·자동 등록)이 바로 보인다', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // 모의 JIRA — 구성 승인자(lee.approver)가 Epic을 Approved로: Gate 미판정이라 플랫폼이 거부하고 Epic을 Proposed로 되돌린다
  await page.goto('/external.html?system=jira&key=FFE-15&role=approver');
  await expect(page.getByTestId('external-current-status')).toHaveText('Proposed');
  await page.getByRole('combobox', { name: '상태', exact: true }).selectOption('Approved');
  await page.getByRole('button', { name: '상태 변경 요청' }).click();
  await expect(page.getByRole('status').filter({ hasText: '거부·되돌림' })).toBeVisible();
  await expect(page.getByTestId('external-current-status')).toHaveText('Proposed');
  await page.getByLabel('검토 의견').fill('Gate 판정 뒤 다시 요청합니다');
  await page.getByRole('button', { name: '의견 등록' }).click();
  await expect(page.getByText('Gate 판정 뒤 다시 요청합니다')).toBeVisible();
  await expect(page.getByText(/플랫폼이 이 상태 변경을 받지 않았습니다/).first()).toBeVisible();
  await shot(page, 'external-jira-reverted');
  expect(await unhandled(page)).toEqual([]);

  // 연계 화면 — JIRA에서 Epic 만들기(범위·기준 기능) → PROPOSED Feature 자동 등록
  await page.goto('/integration/connectors?tab=sync');
  await page.locator('#sync-simulate > summary').click();
  const epic = page.locator('section[aria-labelledby="sync-epic-new"]');
  await epic.getByLabel('Epic 제목 (= Feature 이름)').fill('와이퍼 자동 세척 예약');
  await epic.getByLabel('ASIL').selectOption('D');
  await epic.getByLabel('담당 조직').fill('바디제어기획팀');
  await epic.getByLabel('차종').fill('CE1');
  await epic.getByLabel(/기준 기능 ID/).fill('CH-BRK-001');
  await epic.getByRole('button', { name: 'Epic 만들기' }).click();
  await expect(page.getByTestId('epic-create-result')).toContainText(/자동 등록\(PROPOSED\)/);
  await shot(page, 'epic-auto-feature');
  // GitLab 파이프라인 성공(병합된 MR, 본문 SW-…@버전) → 변경 기록 등록 — 감독 기록 화면에 남는다
  const sim = page.locator('#sync-simulate form').first();
  await sim.getByRole('combobox', { name: '시스템', exact: true }).selectOption('GITLAB');
  await sim.getByRole('combobox', { name: '항목 키', exact: true }).selectOption('vehicle/feature-sw!101');
  await sim.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByTestId('simulate-result')).toContainText('변경 기록 CHG-GL-101 r1');
  await page.goto('/audit/oversight?tab=changes');
  await expect(page.getByText('CHG-GL-101').first()).toBeVisible();
  expect(await unhandled(page)).toEqual([]);
  expect(errors).toEqual([]);
});

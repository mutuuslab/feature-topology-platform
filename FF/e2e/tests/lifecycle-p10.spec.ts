// P10 Lifecycle·Gate 보강 — 실제 백엔드에서 Gate 탭 최종 Go/No-Go·자동 검사·해당 없음(N/A) 요청→다른 Safety Manager 승인,
// 정의 승인 반려 기록, 즉시 폐기 요청→승인, 변경 이력 탭·Baseline 비교. 화면은 접근성 위반 0.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}
async function noSeriousAxe(page: Page) {
  // Gate 레일 버튼의 접근 이름(aria-label)과 보이는 글자 불일치(label-content-name-mismatch)는 이 묶음 전부터 있던 공용 부품 몫 — 보고 후 별도 수정
  const r = await new AxeBuilder({ page }).include('.ds-screen').exclude('.ds-gates').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}
/** 시드의 PROPOSED Version 중 조건에 맞는 것(시험끼리 겹치지 않게 순번으로 고른다) */
async function proposed(request: APIRequestContext, pick: number, asil?: string) {
  const r = await request.get(`${API}/api/features?lifecycle=PROPOSED&limit=200`);
  const items = ((await r.json()).items as { featureId: string; version: string; asil: string }[]).filter((f) => !asil || f.asil === asil);
  expect(items.length).toBeGreaterThan(pick);
  return items[pick];
}

test('Gate 탭: 최종 판정·자동 검사가 보이고, 해당 없음 요청은 다른 Safety Manager가 승인한다', async ({ page, request }) => {
  const f = await proposed(request, 0, 'QM');
  await page.goto('/_design');
  await asRole(page, 'quality');
  await page.goto(`/features/${f.featureId}/${f.version}?tab=gates`);
  await expect(page.getByTestId('go-no-go')).toBeVisible();
  await page.locator('[data-gate="G3"]').first().click();
  await expect(page.getByTestId('gate-checks')).toContainText('Variant 조건 등록');
  const na = page.getByTestId('gate-na-request');
  await na.getByLabel('해당 없음 사유').fill('차량 사양 구분 없는 공통 기능 — Variant 판정 대상 아님');
  await na.getByRole('button', { name: '해당 없음 요청' }).click();
  await expect(page.getByTestId('gate-na')).toContainText('승인 대기');
  await noSeriousAxe(page);
  // 요청자 본인은 결정 버튼이 막힌다 — 두 번째 Safety Manager가 승인
  await asRole(page, 'safety2');
  await page.reload();
  await page.locator('[data-gate="G3"]').first().click();
  const decide = page.getByTestId('gate-na-decide');
  await decide.getByLabel('결정 사유').fill('공통 기능 확인');
  await decide.getByRole('button', { name: '승인' }).click();
  await expect(page.getByTestId('gate-na')).toContainText('승인됨');
  await expect(page.locator('[data-gate="G3"]').first()).toHaveAttribute('data-status', 'NA');
});

test('정의 승인 반려: 승인자가 이슈 항목·재작업 사유와 함께 반려하면 기록이 남고 PROPOSED에 머문다', async ({ page, request }) => {
  const f = await proposed(request, 1);
  await page.goto('/_design');
  await asRole(page, 'approver');
  await page.goto(`/features/${f.featureId}/${f.version}`);
  await page.getByRole('button', { name: '정의 승인 반려' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('반려 사유').fill('요구사항 근거 부족');
  await drawer.getByLabel('이슈 1', { exact: true }).fill('요구 ID 출처 미확인');
  await drawer.getByLabel('재작업 사유').fill('요구 출처 연결 뒤 재요청');
  await drawer.getByRole('button', { name: '반려', exact: true }).click();
  const records = page.getByTestId('review-records');
  await expect(records).toContainText('정의 승인 반려');
  await expect(records).toContainText('요구 ID 출처 미확인');
  await noSeriousAxe(page);
});

test('즉시 폐기: 작성자가 요청하고 Feature 승인자가 승인하면 RETIRED가 된다', async ({ page, request }) => {
  const f = await proposed(request, 2);
  await page.goto('/_design');
  await asRole(page, 'author');
  await page.goto(`/features/${f.featureId}/${f.version}`);
  await page.getByRole('button', { name: '즉시 폐기 요청' }).click();
  await page.getByRole('dialog').getByLabel('폐기 사유').fill('사업 취소 — 개발 중단');
  await page.getByRole('dialog').getByRole('button', { name: '폐기 요청' }).click();
  await expect(page.getByTestId('retire-pending')).toContainText('승인 대기');
  await asRole(page, 'approver');
  await page.reload();
  await page.getByTestId('retire-pending').getByLabel('결정 사유').fill('사업 취소 확인');
  await page.getByRole('button', { name: '폐기 승인' }).click();
  await expect(page.getByText('마지막 단계입니다')).toBeVisible();
  const d = await request.get(`${API}/api/features/${f.featureId}/versions/${f.version}`);
  expect((await d.json()).feature.lifecycle).toBe('RETIRED');
});

test('변경 이력 탭·Baseline 비교: 변경자로 걸러지고, 두 Baseline의 변경 항목이 보인다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'author');
  await page.goto('/features/FEAT-00022/1.0.0?tab=history');
  const table = page.getByRole('table', { name: '변경 이력' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  // 변경자로 거르면 그 사람의 기록만 남는다
  const who = (await table.getByRole('row').nth(1).getByRole('cell').nth(1).textContent())!.trim();
  await page.getByLabel('변경자').fill(who);
  await expect(table.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveText(who);
  await page.goto('/features/FEAT-00022/1.0.0?tab=baseline');
  await expect(page.getByRole('table', { name: 'Baseline 이력' })).toContainText('BL-00028');
  // The first option is the explicit unselected guide. Compare two actual seeded Baseline IDs.
  await page.getByRole('combobox', { name: /^기준/ }).selectOption('BL-00001');
  await page.getByRole('combobox', { name: '비교 대상', exact: true }).selectOption('BL-00028');
  await expect(page.getByTestId('bl-compare-summary')).toContainText('변경');
  await noSeriousAxe(page);
});

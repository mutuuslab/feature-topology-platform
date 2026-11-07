// P3 Feature 관계·추적 연결 — 실제 백엔드에서 Feature 상세 '추적 연결' 탭(요구 연결·해제 이력·Test Evidence 등록),
// 추적 커버리지(요구 미연결·필수 Evidence 미등록), Topology 관계 유형 칩·새 관계 유형 등록, 변경 영향의 정책·차량·OTA. 화면은 접근성 위반 0.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}
async function noSeriousAxe(page: Page) {
  // 머리의 외부 도구 바로가기(codeBeamer·JIRA·GitHub 이름 불일치)는 이 묶음 밖의 기존 부품 — 추적 연결 영역만 본다
  const r = await new AxeBuilder({ page }).include('.ds-screen').exclude('.external-launcher, a[data-tool]').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('추적 연결 탭: 커버리지·ALM 요구 목록에서 요구 연결 → 해제는 이력으로 남는다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'author');
  await page.goto('/features/FEAT-00022/1.0.0?tab=links');
  const tab = page.locator('[data-ui="traceLinks"]');
  await expect(tab).toContainText('요구 커버리지');
  // 시드: FEAT-00022는 시스템 요구만 이었다 — SW 요구 2건이 미연결
  const reqList = page.getByRole('table', { name: 'ALM 요구 목록' });
  const sw1 = reqList.getByRole('row').filter({ hasText: 'REQ-CARE-2301-SW1' });
  await sw1.getByRole('button', { name: '연결' }).click();
  await page.getByRole('button', { name: '연결 등록' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'REQ-CARE-2301-SW1 연결됨' })).toBeVisible();
  await expect(reqList.getByRole('row').filter({ hasText: 'REQ-CARE-2301-SW1' })).toContainText('연결됨');
  await noSeriousAxe(page);

  // 해제 — 사유를 남기면 목록에서 빠지고, 해제 이력 포함으로 다시 본다
  const links = page.getByRole('table', { name: '요구사항' });
  const row = links.getByRole('row').filter({ hasText: 'REQ-CARE-2301-SW1' });
  await row.getByRole('button', { name: '해제' }).click();
  await row.getByLabel('해제 사유').fill('SW 요구 재정의');
  await row.getByRole('button', { name: '해제' }).last().click();
  await expect(links.getByRole('row').filter({ hasText: 'REQ-CARE-2301-SW1' })).toHaveCount(0);
  await page.getByLabel('해제 이력 포함').check();
  await expect(links.getByRole('row').filter({ hasText: 'REQ-CARE-2301-SW1' })).toContainText('SW 요구 재정의');
});

test('검증 연결: Gate 판정자가 필수 Test Case에 Evidence를 등록하면 최종 결과가 보인다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'quality');
  await page.goto('/features/FEAT-00022/1.0.0?tab=links');
  await page.getByRole('radio', { name: /검증\(Test Case\)/ }).click();
  const table = page.getByRole('table', { name: '검증(Test Case)' });
  const row = table.getByRole('row').filter({ hasText: 'TC-00022-05' });
  await row.getByRole('button', { name: 'Evidence 등록' }).click();
  await row.getByLabel('Evidence 식별자').fill('EV-E2E-VEH-1');
  await row.getByLabel('실행 환경').fill('시험차 NX4-T07');
  await row.getByLabel('실행 결과').selectOption('FAIL');
  await row.getByRole('button', { name: '등록', exact: true }).click();
  // 시드 Evidence 1건(실차 시험 PASS) + 방금 등록한 1건 — 최종 결과는 늦은 실행인 FAIL
  await expect(table.getByRole('row').filter({ hasText: 'TC-00022-05' })).toContainText('2건');
  await expect(table.getByRole('row').filter({ hasText: 'TC-00022-05' })).toContainText('FAIL');
  await noSeriousAxe(page);
});

test('추적 커버리지: 요구 미연결·필수 Evidence 미등록 Feature를 걸러 Feature 탭으로 간다', async ({ page }) => {
  await page.goto('/trace/coverage');
  const key = page.locator('#main [data-key-message]');
  await expect(key).toContainText('요구 미연결 Feature');
  await page.getByRole('radio', { name: /요구 미연결/ }).click();
  await expect(page).toHaveURL(/filter=noRequirement/);
  const table = page.getByRole('table', { name: '추적 커버리지' });
  await expect(table.getByRole('row').filter({ hasText: 'FEAT-00003' })).toBeVisible();
  await noSeriousAxe(page);
  await table.getByRole('row').filter({ hasText: 'FEAT-00003' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/FEAT-00003\/.*tab=links/);
  await expect(page.locator('[data-ui="traceNotes"]')).toContainText('요구사항이 한 건도 연결되지 않았습니다');
});

test('Topology: 관계 유형 칩으로 거르고, 새 관계 유형으로 등록한다 · 변경 영향에 정책·차량·OTA', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'author');
  const v = await page.request.post(`http://localhost:${process.env.E2E_API_PORT}/api/features/FEAT-00023/versions`, {
    headers: { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR', 'Idempotency-Key': `e2e-p3-${Date.now()}` },
    data: { baseVersion: '1.0.0', reason: '관계 유형 시연', changes: { description: '관계 유형 시연' } },
  });
  expect(v.ok()).toBeTruthy();
  const ver = (await v.json()).feature.version as string;
  await page.goto('/arch/topology');
  await page.getByRole('combobox', { name: '유형', exact: true }).last().selectOption('PARENT_OF');
  await page.getByRole('textbox', { name: '원천 Feature', exact: true }).fill('FEAT-00023');
  await page.getByRole('textbox', { name: '원천 Version', exact: true }).fill(ver);
  await page.getByRole('textbox', { name: '대상 Feature', exact: true }).fill('FEAT-00181');
  await page.getByRole('textbox', { name: /대상 Version/ }).fill('1.1.0');
  await page.getByRole('button', { name: '등록·판정' }).click();
  await expect(page.getByRole('status').filter({ hasText: /DEP-\d{5} — 판정/ })).toBeVisible();
  // 그래프 필터 — 관계 유형 칩
  // 넓은 화면은 필터가 이미 펼쳐져 있다 — 접혀 있을 때만 연다
  if ((await page.locator('.topo-wb__filters').getAttribute('open')) === null) await page.locator('.topo-wb__filters summary').click();
  const chip = page.getByRole('group', { name: '관계 유형' }).getByRole('button', { name: /상위\(PARENT_OF\)/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('svg.ds-topo .ds-topo-edge[data-type="PARENT_OF"]')).toHaveCount(1);
  await expect(page.locator('svg.ds-topo .ds-topo-edge[data-type="REQUIRES"]')).toHaveCount(0);

  await page.goto('/analysis/impact?feature=FEAT-00145&version=5.4.2&tab=scope');
  const scope = page.locator('[data-ui="impactScope"]');
  await expect(scope).toContainText('POL-00001');
  await expect(scope).toContainText('sw-care-sdist-app-1.2.1.pkg');
  await expect(scope).toContainText('범위 차량');
});

// TX 분류 계층·브랜드·지역 코드 — 실제 백엔드에서 수준별 분류·계층 트리·노드 등록/삭제(하위 있으면 거부), Feature 상세 '분류 경로' 탭,
// 브랜드별 정책·지역 코드 대응 표, 컴플라이언스 룰 등록 서랍의 지역 코드 후보. 화면은 접근성 위반 0.
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
  const r = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('분류 계층: 수준별 분류·트리, Feature DB 관리자가 노드를 등록하고 하위가 있으면 삭제가 막힌다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'steward');
  await page.goto('/master/taxonomy/levels');
  await expect(page.getByRole('heading', { name: '분류 계층' })).toBeVisible();
  await page.getByRole('radio', { name: /L4 정책·Flag·파라미터/ }).click();
  await expect(page.getByRole('table', { name: 'L4 정책·Flag·파라미터' }).getByRole('row').nth(1)).toContainText('FEAT-');
  await noSeriousAxe(page);

  await page.getByRole('tab', { name: /계층 트리/ }).click();
  await expect(page.getByRole('tree')).toContainText('ADAS');

  await page.getByRole('tab', { name: '노드 관리' }).click();
  const stamp = Date.now().toString(36).toUpperCase();
  const form = page.getByRole('region', { name: '노드 등록' });
  const fill = async (id: string, name: string, level: string, parent: string) => {
    await form.getByLabel(/^Node ID/).fill(id);
    await form.getByLabel(/^Node 명칭/).fill(name);
    await form.getByRole('combobox', { name: '수준' }).selectOption(level);
    if (parent) await form.getByLabel(/^상위 Node ID/).fill(parent);
    await form.getByRole('button', { name: '등록', exact: true }).click();
  };
  // 상위 L1(Feature DB 클러스터) 아래 L2를 건너뛰고 L3를 붙이면 거부
  await fill(`E2E-${stamp}-X`, '건너뛴 노드', 'L3', 'BC');
  await expect(form).toContainText(/L0이므로 L1만 등록할 수 있습니다/);
  await fill(`E2E-${stamp}`, '시험 차량 기능', 'L1', 'BC');
  await expect(page.getByRole('status').filter({ hasText: `E2E-${stamp}을(를) 등록했습니다` })).toBeVisible();
  await fill(`E2E-${stamp}-C`, '시험 하위 기능', 'L2', `E2E-${stamp}`);
  await expect(page.getByRole('status').filter({ hasText: `E2E-${stamp}-C을(를) 등록했습니다` })).toBeVisible();
  // 하위가 있는 L1 노드 삭제는 거부
  await form.getByRole('combobox', { name: '수준' }).selectOption('L1');
  const edit = page.getByRole('region', { name: /명칭·설명 수정/ });
  await edit.getByRole('combobox', { name: '고칠 노드' }).selectOption(`E2E-${stamp}`);
  await edit.getByLabel('사유', { exact: true }).fill('시험 정리');
  await edit.getByRole('button', { name: '삭제' }).click();
  await expect(edit).toContainText(/하위 Node 1개/);
  await noSeriousAxe(page);
});

test('Feature 상세 분류 경로: L0부터 배치 노드까지와 아래 구성', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'author');
  const lvl = await (await page.request.get('/api/taxonomy/levels/L4')).json();
  const f = lvl.items[0].features[0];
  await page.goto(`/features/${f.featureId}/${f.version}?tab=taxonomy`);
  const path = page.getByRole('list', { name: 'L0부터 배치 노드까지' });
  await expect(path.getByRole('listitem')).toHaveCount(6);
  await expect(path).toContainText('L5');
  await noSeriousAxe(page);
});

test('브랜드·권역별 정책: 브랜드별 목록·지역 코드 대응 표, 룰 등록 서랍의 지역 코드 후보', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'author');
  await page.goto('/policies/global-scope');
  await expect(page.getByRole('table', { name: /브랜드 현대/ }).getByRole('row').nth(1)).toContainText('POL-');
  await page.getByRole('tab', { name: /적용 지역 코드/ }).click();
  const codes = page.getByRole('table', { name: '적용 지역 코드' });
  await expect(codes.getByRole('row')).toHaveCount(15);
  await expect(codes.getByRole('row').filter({ hasText: '유럽' })).toContainText('EU');
  await noSeriousAxe(page);

  await asRole(page, 'steward');
  await page.goto('/verify/compliance?tab=registry');
  await page.getByRole('button', { name: /룰 등록/ }).first().click();
  await page.getByRole('checkbox', { name: '1 · 한국' }).check();
  await expect(page.locator('[data-ui="regionCandidates"][data-code="1"]')).toContainText('KR/');
});

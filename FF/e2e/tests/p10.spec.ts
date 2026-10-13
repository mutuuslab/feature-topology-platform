// P10 끝단 — 실제 백엔드에서 VOC 가져오기 → SOTIF 이상 건 연결, 데이터 동기화(CN 보류), 해외공장 주문 해석, Legacy-SDV 거부,
// 현장 지원 조회, 실험 등록(F2 A/B 거부 → Shadow), 외부 연계 현황. 화면은 v2 접근성 위반 0.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function noSeriousAxe(page: Page) {
  const r = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

test('장애·VOC: VOC 가져오기 → SOTIF는 이상 건으로, 현장 지원에서 같은 차량의 이상 건이 보인다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'operator');
  await page.goto('/ops/incidents');
  await page.getByRole('button', { name: 'VOC 가져오기' }).click();
  await expect(page.getByRole('status')).toContainText('가져옴');
  const table = page.getByRole('table', { name: '장애·VOC' });
  await expect(table.getByRole('row').filter({ hasText: 'KMH-NX4-0002' }).getByRole('link', { name: /ANM-\d{5}/ })).toBeVisible();
  await noSeriousAxe(page);
  await page.goto('/field?vin=KMH-NX4-0002');
  await expect(page.getByRole('region', { name: '관련 이상 건' })).toContainText('FIELD_SOTIF');
  await noSeriousAxe(page);
});

test('데이터 동기화: CN 국외 이전은 보류, ECU 대사는 차이를 기록 · Legacy: 주문 해석과 Legacy-SDV 거부', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'operator');
  await page.goto('/integration/sync');
  const cn = page.getByRole('row').filter({ hasText: 'SYNC-IF12-HMGC-OUT' });
  await expect(cn).toContainText('보류');
  await cn.getByRole('button', { name: '대사 실행' }).click();
  await expect(page.getByRole('dialog')).toContainText('FFG-TEL-005');
  await page.keyboard.press('Escape');
  await page.getByRole('row').filter({ hasText: 'SYNC-IF02-ECU' }).getByRole('button', { name: '대사 실행' }).click();
  await expect(page.getByRole('dialog').getByRole('table', { name: '차이 목록' })).toContainText('값 다름');
  await page.keyboard.press('Escape');
  await noSeriousAxe(page);

  await page.goto('/integration/legacy');
  await page.getByRole('button', { name: 'TMA 주문 가져오기' }).click();
  await expect(page.getByText('미해석 코드: OPT-XHUD')).toBeVisible();
  await expect(page.getByRole('table', { name: '해외공장 주문' })).toContainText('OPT-FSD3→FEAT-00022');
  const sdv = page.getByRole('region', { name: 'Legacy-SDV — 딜러 코딩 계획' });
  await sdv.getByLabel('Feature').fill('FEAT-00022');
  await sdv.getByRole('button', { name: '계획 만들기' }).click();
  await expect(page.getByText(/전달 불가 — F[234]/)).toBeVisible();
  await noSeriousAxe(page);
});

test('실험·효과: F2 이상 Feature의 A/B는 FFG-CLS-006으로 거부, Shadow는 등록된다 · 외부 연계 현황 13개', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'release');
  await page.goto('/experiments');
  const create = page.getByRole('region', { name: '실험 등록' });
  await create.getByLabel('대상 정책').selectOption('POL-00002');
  await create.getByLabel('유형').selectOption('AB');
  await create.getByLabel('가설').fill('간격 단계를 앞당기면 고장 보고가 준다');
  await create.getByRole('button', { name: '등록' }).click();
  await expect(create).toContainText('A/B 실험을 할 수 없습니다');
  await create.getByLabel('유형').selectOption('SHADOW');
  await create.getByRole('button', { name: '등록' }).click();
  await expect(page.getByRole('table', { name: '실험·효과' })).toContainText('Shadow');
  await noSeriousAxe(page);

  await page.goto('/integration/connectors');
  await expect(page.getByRole('table', { name: '연결 현황' }).getByRole('row')).toHaveCount(14);
  await noSeriousAxe(page);
});

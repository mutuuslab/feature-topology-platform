import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('fp.state.v2', JSON.stringify({ role: value, department: 'ALL' })), role);
  await page.goto('/data/workbench');
  await expect(page.getByRole('heading', { name: '데이터 분석실', exact: true })).toBeVisible();
}

test('분석실 실제 메뉴·GET 출처·다중 조건·선택 행 링크·브라우저 저장 조회', async ({ page }) => {
  await asRole(page, 'viewer');
  await expect(page.getByRole('link', { name: '데이터 분석실', exact: true })).toHaveAttribute('href', '/data/workbench');
  const table = page.getByRole('table', { name: '분석 결과', exact: true });
  await expect(table).toBeVisible();
  await page.getByRole('button', { name: '조건 추가', exact: true }).click();
  await page.getByLabel('필드 1', { exact: true }).selectOption('flagKey');
  await page.getByLabel('비교 1', { exact: true }).selectOption('contains');
  await page.getByLabel('값 1', { exact: true }).fill('care_00022');
  await page.getByRole('button', { name: '조건 추가', exact: true }).click();
  await page.getByLabel('필드 2', { exact: true }).selectOption('status');
  await page.getByLabel('비교 2', { exact: true }).selectOption('eq');
  await page.getByLabel('값 2', { exact: true }).fill('DEPLOYED');
  await page.getByRole('button', { name: '조건으로 조회', exact: true }).click();
  await expect(table).toContainText('care_00022');
  for (const row of await table.locator('tbody tr').all()) await expect(row).toContainText('DEPLOYED');
  await page.getByRole('button', { name: '1 행 선택', exact: true }).click();
  const detail = page.getByRole('region', { name: '선택 행 상세', exact: true });
  await expect(detail.getByRole('link', { name: '정책 열기', exact: true })).toHaveAttribute('href', /^\/policies\/POL-/);
  await expect(detail.getByRole('link', { name: 'Flag 적용 차량 지도', exact: true })).toHaveAttribute('href', /lens=activation&flagKey=care_00022/);
  const name = '분석 검토 ' + randomUUID().slice(0, 8);
  await page.getByLabel('저장 조회 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '조건 저장', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('값 1', { exact: true })).toHaveValue('care_00022');
  await expect(page.getByRole('region', { name: '조회 이력', exact: true })).toContainText('조회 완료');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('ff.workbench.queries.v1:')).map((key) => localStorage.getItem(key)).some((value) => value.includes('"rows"') || value.includes('"totals"')))).toBe(false);
});

test('비산정 역할의 비용은 공수로 한정되고 회신 없는 차량을 정상 회신으로 만들지 않는다', async ({ page }) => {
  await asRole(page, 'author');
  await page.getByRole('button', { name: '개발비 산정 과제', exact: true }).click();
  await expect(page.getByText('이 조회는 공수 범위로 표시합니다. 금액 열은 표시되지 않습니다.', { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: '분석 결과', exact: true });
  await expect(table.getByRole('button', { name: '총 개발비 (원) 정렬', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '차량 최근 회신', exact: true }).click();
  await expect(table).toBeVisible();
  await expect(table).toContainText('VIN');
  await page.getByRole('button', { name: '조건 추가', exact: true }).click();
  await page.getByLabel('필드 1', { exact: true }).selectOption('result');
  await page.getByLabel('비교 1', { exact: true }).selectOption('empty');
  await page.getByRole('button', { name: '조건으로 조회', exact: true }).click();
  await expect(page.getByRole('region', { name: '조회 이력', exact: true })).toContainText('조회 완료');
  await expect(table.locator('tbody tr')).not.toHaveCount(0);
  await page.getByRole('button', { name: '1 행 선택', exact: true }).click();
  await expect(page.getByRole('region', { name: '선택 행 상세', exact: true }).locator('dl > div').filter({ has: page.getByText('최근 회신 결과', { exact: true }) })).toContainText('—');
});

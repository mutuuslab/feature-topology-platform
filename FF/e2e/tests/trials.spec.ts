// 기간형 체험권 끝단 — 운영 콘솔에서 차량별 체험 제안 → 수락(30일 ON) → 구독 전환(과금 연계 모의) → 체험 전환 분석.
// KMH-NX4-0101만 쓴다(다른 시험 파일과 겹치지 않게). ego-01·lead-01은 PoC 시연용으로 건드리지 않는다.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const VIN = 'KMH-NX4-0101';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('체험 제안 → 수락하면 사용 권한 단계가 통과 → 구독 전환 → 전체 권한에 전환된 구독', async ({ page, request }) => {
  const mine = async () => (await (await request.get(`${API}/api/entitlements?vin=${VIN}`)).json()).items as { grantId: string; kind: string; state: string; fromTrial: string | null }[];
  test.skip((await mine()).some((g) => g.kind === '체험'), '재사용 서버 — 이미 체험 이력이 있음');

  await page.goto('/_design');
  await asRole(page, 'operator');
  await page.goto('/entitlements');
  const offer = page.getByRole('region', { name: '체험 제안' });
  await offer.getByRole('checkbox', { name: VIN }).check();
  await offer.getByRole('button', { name: '제안 보내기' }).click();
  await expect(offer.getByRole('status')).toContainText('1대에 제안');

  const table = page.getByRole('table', { name: '체험권 차량' });
  const row = table.getByRole('row').filter({ hasText: VIN });
  await expect(row).toContainText('제안 중');
  await expect(row).toContainText('14일');
  await row.getByRole('button', { name: '수락' }).click();
  await expect(row).toContainText('체험 중');
  await expect(row).toContainText('30일');

  await page.goto(`/activation/decide?vin=${VIN}&flagKey=care_00022_param`);
  await expect(page.locator('.ds-trace li[data-step="ENTITLEMENT"]')).toHaveAttribute('data-result', 'TRUE');

  await page.goto('/entitlements');
  await page.getByRole('table', { name: '체험권 차량' }).getByRole('row').filter({ hasText: VIN }).getByRole('button', { name: '구독 전환' }).click();
  await expect(page.getByRole('table', { name: '체험권 차량' }).getByRole('row').filter({ hasText: VIN })).toContainText('구매 전환');
  const after = await mine();
  const trial = after.find((g) => g.kind === '체험')!;
  expect(after.find((g) => g.kind === '구독')).toMatchObject({ fromTrial: trial.grantId, state: 'ACTIVE' });

  // 1536에서 본문·문서는 넘치지 않고, 체험권 표도 처리 버튼까지 한 화면(표 안 가로 스크롤 없음)
  await page.setViewportSize({ width: 1536, height: 864 });
  const wide = await page.evaluate(() => {
    const m = document.querySelector('.sh-main')!;
    const t = document.querySelector('.ds-table-wrap')!;
    return { main: m.scrollWidth - m.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, table: t.scrollWidth - t.clientWidth };
  });
  expect(wide).toEqual({ main: 0, doc: 0, table: 0 });

  await page.getByRole('tab', { name: '전체 권한' }).click();
  await expect(page.getByRole('table', { name: '전체 권한' }).getByRole('row').filter({ hasText: trial.grantId }).first()).toBeVisible();
});

test('체험 전환 분석: KPI·깔때기·성향별·주별 추이, 데모만 보면 작은 집단은 가림, 접근성 위반 없음', async ({ page }) => {
  await page.goto('/biz/trials');
  await expect(page.getByRole('heading', { name: '체험 전환 분석' })).toBeVisible();
  await expect(page.getByRole('group', { name: /^제안 → 수락 → 구매: 제안 [\d,]+, 수락 [\d,]+, 구매 [\d,]+$/ })).toBeVisible();
  await expect(page.locator('.ds-kpi')).toHaveCount(5);
  const seg = page.getByRole('table', { name: '주행 성향별 수락률·구매 전환율' });
  await expect(seg.getByRole('row')).toHaveCount(5); // 머리 + 4개 성향
  await page.getByLabel('나눠 보기').selectOption('ageBand');
  await expect(page.getByRole('table', { name: '연령대별 수락률·구매 전환율' })).toBeVisible();
  await page.getByRole('radio', { name: '데모 차량' }).click();
  await expect(page.getByRole('table', { name: '연령대별 수락률·구매 전환율' })).toContainText('가림 (5대 미만)');
  // 주별 추이 — 키보드로 주를 옮기면 세 계열 값을 한 툴팁에
  const trend = page.getByRole('img', { name: /주별 추이/ });
  await trend.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.ds-viz__tip')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

// Data Lake 연계·Closed loop 시나리오(80-70, BACKLOG TL-UI*) — 실제 백엔드의 모의 Data Lake(IF-15)와 데모 시드(data/fixtures/lake/ff-demo.json).
// 운영 점검 허브 → 점검 결과(효과 확인 → 닫기) → 정책 Canary 관측 → Data Lake 연계(모델 사용 승인 2인) → 수집 정책 → Feature 운영 지표 탭.
// 다른 시험이 쓰지 않는 기록만 바꾼다: 점검 결과 FND-00002(전방 안전거리 3단계 동작 축), 모델 LAKE-M3-DEPLOY-RISK 2.1.0.
import { expect, test, type Page } from '@playwright/test';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('운영 점검 허브 → 점검 결과 상세 — 조치 필요·기한 지남, 판단 불가는 따로, 효과 확인 뒤 닫기', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/ops/feature-health');
  const key = page.locator('#main [data-key-message]');
  await expect(key).toHaveAttribute('data-tone', 'danger');
  await expect(key).toContainText('조치 필요');
  const rows = page.getByRole('table', { name: '버전별 4축 판정' });
  await expect(rows.getByText('판단 불가').first()).toBeVisible();
  // 점검 결과 — 효과가 확인된 동작 축(전방 안전거리 3단계)
  await page.getByRole('table', { name: '점검 결과' }).getByRole('link', { name: 'FND-00002' }).click();
  await expect(page).toHaveURL(/\/ops\/feature-health\/FND-00002$/);
  await expect(page.locator('h1')).toContainText('점검 결과');
  await expect(page.locator('#main [data-key-message]')).toContainText('효과 확인 — 닫을 수 있습니다');
  await expect(page.locator('.lk-flow [aria-current="step"]')).toHaveText(/효과 확인 중/);
  await page.getByLabel('메모').fill('조치 뒤 7일 창 — 적용 성공률 회복 확인');
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('#main [data-key-message]')).toContainText('효과 확인 뒤 닫혔습니다');
  await expect(page.getByRole('table', { name: '상태 이력' })).toContainText('닫힘');
});

test('정책 Canary 관측 — 사전 등록 중단 기준을 넘은 정책은 확대 중단, 모델 점수는 권고', async ({ page }) => {
  await asRole(page, 'coordinator');
  await page.goto('/policies/POL-00002');
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Canary 관측' }) });
  await expect(panel.locator('[data-canary-verdict]')).toHaveAttribute('data-canary-verdict', 'ABORT');
  await expect(panel).toContainText('확대 중단');
  await expect(panel).toContainText('모델 점수는 권고입니다');
  await expect(panel.getByRole('img')).toHaveCount(3);
});

test('Data Lake 연계 — 지연 계약, 모델 사용 승인은 서로 다른 두 사람(운영 리더가 두 번째)', async ({ page }) => {
  await asRole(page, 'opslead');
  await page.goto('/integration/datalake');
  await expect(page.locator('#main [data-key-message]')).toContainText('데이터 계약 지연');
  await page.getByRole('tab', { name: '모델' }).click();
  const row = page.getByRole('table', { name: '모델' }).getByRole('row').filter({ hasText: 'LAKE-M3-DEPLOY-RISK' }).filter({ hasText: '2.1.0' });
  await expect(row).toContainText('승인 1/2');
  await row.getByRole('button', { name: '사용 승인 결정' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('확인한 근거(모델 카드·평가·공정성)').fill('모델 카드·평가 확인');
  await drawer.getByRole('button', { name: '사용 승인', exact: true }).click();
  await expect(row).toContainText('사용 승인 · 승인 2/2');
  await page.getByRole('tab', { name: '라벨 보내기' }).click();
  await expect(page.getByRole('table', { name: '라벨 보내기' })).toContainText('ff.change');
});

test('수집 정책·Feature 운영 지표 탭 — 보류 사유, 버전별 지표와 4축 이력', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/ops/collection');
  await expect(page.locator('#main [data-key-message]')).toContainText('보류');
  await page.getByRole('table', { name: '수집 정책' }).getByText('주행 안전 이벤트(CN 현지)').click();
  await expect(page.getByRole('dialog')).toContainText('국외 이전 심사 전');
  await page.keyboard.press('Escape');
  await page.goto('/features/FEAT-00004/4.1.0?tab=ops');
  await expect(page.getByRole('table', { name: '버전별 운영 지표' })).toContainText('만 대');
  await expect(page.getByRole('table', { name: '4.1.0 4축 판정 이력' })).toBeVisible();
});

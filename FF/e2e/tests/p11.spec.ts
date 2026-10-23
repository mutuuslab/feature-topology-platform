// P11 화면 — 실제 백엔드(메모리 DB·v0.81)와 API만 있던 기능의 화면: 응답 형태가 화면 가정과 맞는지 끝까지 밟는다.
// Flag Retirement는 ivi_00024_guide(F0, Feature 승인자 1명)로 2단계(남은 차량 확인)까지만 — 퇴역(5단계)은 다른 시험의 평가를 바꾸므로 하지 않는다.
import { expect, test, type Page } from '@playwright/test';

/** Panel의 id는 제목(h2)에 `${id}-h`로 붙는다 — 그 제목을 가진 패널 */
const panel = (page: Page, id: string) => page.locator('section.ds-panel', { has: page.locator(`#${id}-h`) });

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('Flag Retirement: 작성자 요청 → 승인자 승인 → 2단계 남은 차량 확인 (FFG-LCY-011)', async ({ page }) => {
  await page.goto('/flag-retirements');
  await asRole(page, 'author');
  await page.reload();
  // 요청 폼은 머리의 행동 버튼으로 여는 Drawer(UX3-12)
  await page.getByRole('button', { name: 'Retirement 요청', exact: true }).click();
  const req = page.getByRole('dialog', { name: 'Retirement 요청' });
  await req.getByRole('combobox', { name: '대상 Flag' }).selectOption('ivi_00024_guide');
  await req.getByLabel('Retirement 사유').fill('안내 문구 기능 종료 — e2e');
  await req.getByRole('button', { name: 'Retirement 요청 등록' }).click();
  await expect(req).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: 'ivi_00024_guide' });
  await expect(row).toContainText('승인 대기');

  // 작성자는 자기 요청을 승인할 수 없다 — 승인자로 바꿔 승인
  await asRole(page, 'approver');
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'ivi_00024_guide' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText(/필요한 승인: Feature 승인자/)).toBeVisible();
  await dlg.getByRole('button', { name: '승인' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'ivi_00024_guide' })).toContainText('진행 중');

  // 2단계 — 서버가 상태 보고로 남은 차량을 집계한다
  await asRole(page, 'author');
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'ivi_00024_guide' }).click();
  await page.getByTestId('retire-step').getByRole('button', { name: '단계 기록' }).click();
  await expect(page.getByRole('dialog').getByText(/이전 Version 차량 \d+대 · 미보고 \d+대/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'ivi_00024_guide' })).toContainText('2/6');
});

test('보안·인증서: 보안 이벤트 정의와 SBOM 본문(CycloneDX 구성 요소)이 실제 응답으로 열린다', async ({ page }) => {
  await page.goto('/admin/security');
  await expect(panel(page, 'sec-events')).toContainText('AUTH_FAILURE');
  await panel(page, 'sec-sbom').getByRole('row').nth(1).click();
  const body = page.getByTestId('sbom-detail');
  await expect(body).toContainText('urn:uuid:');
  await expect(body.getByRole('row')).not.toHaveCount(1); // 머리 행 + 구성 요소
});

test('감독 기록: 직무 분리 감사 — 데모 계정 겸직 0건(FFG-PLT-016), 데이터·규제 기록의 보존 표가 열린다', async ({ page }) => {
  await page.goto('/audit/oversight');
  await expect(panel(page, 'sod-conflicts')).toContainText('겸직 계정이 없습니다');
  await page.goto('/admin/data?tab=retention');
  await expect(panel(page, 'ret-policies').getByRole('row').nth(1)).toBeVisible();
});

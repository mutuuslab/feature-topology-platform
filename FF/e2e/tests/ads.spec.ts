// ADS·UNECE·Orca 화면 — 실제 백엔드(메모리 DB·v0.81 + data/fixtures/ads 시드)로 새 화면과 바뀐 화면을 끝까지 밟는다.
// 핵심 메시지는 ux.json 확정안 문장(숫자만 시드), '모름'은 판단 불가·미확인 두 낱말, 막힌 행동은 글자 사유(BlockedAction).
import { expect, test, type Page } from '@playwright/test';

const key = (page: Page) => page.locator('#main [data-key-message]');

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('구성: ODD 프로파일 — 상한 초과·판단 불가를 따로 세고, 의미 검증 오류가 남은 초안은 승인 대신 사유', async ({ page }) => {
  await page.goto('/config/odd');
  await expect(key(page)).toContainText('승인 상한을 넘는 배포 설정 3건 — 판단 불가 1건 별도');
  await asRole(page, 'quality'); // 기능안전 담당(SAFETY_OFFICER)
  await page.reload();
  await expect(page.locator('#main [data-blocked-action]').first()).toContainText('의미 검증 오류');
  // 부모 화면에서 이어진다
  await page.goto('/variant-conditions');
  await expect(page.getByRole('link', { name: /ODD 프로파일/ }).first()).toBeVisible();
});

test('구성: 승인 구성 조합 — 승인 조합 밖 차량 수에 형상 미확인은 넣지 않는다', async ({ page }) => {
  await page.goto('/config/compat');
  await expect(key(page)).toContainText('승인 조합 밖 차량 3대 — 부분 복구 1대 포함');
  await expect(page.locator('#main')).toContainText('형상 미확인 1대');
});

test('구성: VIN 지원 판정 — 설치 기록 연동 전에는 업데이트 후 가능을 내지 않고 차량 확인 필요', async ({ page }) => {
  await page.goto('/activation/decide');
  await expect(key(page)).toContainText('차량 확인 필요');
  await expect(page.locator('#main')).toContainText('결제 직전 다시 확인합니다');
});

test('증거: ADS 사건 보고 — 확정된 사건만 기한 경보에 세고, 상세는 차량 시각·서버 수신 시각을 나눈다', async ({ page }) => {
  await page.goto('/ops/incident-reports');
  await expect(key(page)).toContainText('단기 보고 기한이 7일 안인 ADS 사건 2건');
  await page.goto('/ops/incident-reports/ADSI-2026-0002');
  const timeline = page.locator('#main [data-case-timeline]').first();
  await expect(timeline.getByRole('columnheader', { name: '차량 시각' })).toBeVisible();
  await expect(timeline.getByRole('columnheader', { name: '서버 수신 시각' })).toBeVisible();
  await expect(page.locator('#main')).toContainText('DSSAD');
  // 부모 화면에서 이어진다
  await page.goto('/ops/incidents');
  await expect(page.getByRole('link', { name: /ADS 사건 보고/ }).first()).toBeVisible();
});

test('증거: Safety Case — 열린 중대 발견이 있으면 승격 불가, 주장·논거·Evidence 트리', async ({ page }) => {
  await page.goto('/verify/safety-case');
  await expect(key(page)).toContainText('다음 단계로 승격할 수 없음 — 열린 중대 발견 1건');
  await expect(page.getByRole('tree').first()).toBeVisible();
});

test('증거: ADS·UNECE 요구 추적 — 구현되지 않은 요구 수와 플랫폼 구현 현황 고지', async ({ page }) => {
  await page.goto('/trace/ads');
  await expect(key(page)).toContainText(/구현되지 않은 요구 \d+개 — 부분 구현 포함, 64개 중/);
  await expect(page.locator('#main')).toContainText('플랫폼 구현 현황 — 차량 인증 상태가 아닙니다');
});

test('상태: 차량 6축 — ADS 차량의 오래된 보고는 미확인, 활성 적격·실제 실행은 차량 보고값', async ({ page }) => {
  await page.goto('/fleet/vehicles/KMH-GN7-0001');
  await expect(key(page)).toContainText('현재 상태 미확인 기능');
  const axes = page.locator('#main [data-axis-table]').first();
  await expect(axes.getByRole('rowheader', { name: '활성 적격' })).toBeVisible();
  await expect(axes).toContainText('미확인');
  // 판정 탭 — 차량이 보고한 판정이지 플랫폼 허가가 아니다
  await page.goto('/fleet/vehicles/ego-01?tab=verdicts');
  await expect(page.locator('#main')).toContainText('차량이 보고한 판정 — 플랫폼 허가가 아닙니다');
});

test('상태: 배포 상세 — 적용 확인 안 된 차량 수와 배타 구간(합 = 대상)', async ({ page }) => {
  await page.goto('/deployments/PUB-00002');
  await expect(key(page)).toContainText(/적용 확인 안 된 차량 \d+대 — 대상 \d+대 중/);
  const stages = page.locator('#main [data-stage-counts]').first();
  await expect(stages.locator('li[data-count]').first()).toBeVisible();
  const counts = await stages.locator('li[data-count]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))));
  const total = Number((await key(page).innerText()).match(/대상 (\d+)대/)?.[1]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
});

test('상태: 주문 추적 — 기한 넘긴 사용 준비 미확인 주문을 세고 확인율은 보이지 않는다', async ({ page }) => {
  await page.goto('/entitlements?tab=orders');
  await expect(key(page)).toContainText(/기한 넘긴 사용 준비 미확인 주문 \d+건 — 결제 후 24시간\(가정값\) 기준/);
  await expect(page.locator('#main')).not.toContainText('사용 준비 완료');
});

test('변경: 변경 영향 — 끝나지 않은 승인 경로와 릴리스 비교의 운행 조건 확대', async ({ page }) => {
  await page.goto('/analysis/impact');
  await expect(key(page)).toContainText('끝나지 않은 승인 경로');
  await page.goto('/analysis/impact?tab=release');
  await expect(key(page)).toContainText('운행 조건 확대');
});

test('변경: 긴급 차단 요청 미리보기 — 서명 대상 digest는 서버 대상 검증 뒤 표시', async ({ page }) => {
  await page.goto('/ops/kill');
  await asRole(page, 'operator');
  await page.reload();
  await page.locator('#main').getByRole('button', { name: /요청/ }).first().click();
  const preview = page.locator('[data-bulk-preview]').first();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview).toContainText('서명 대상 digest');
});

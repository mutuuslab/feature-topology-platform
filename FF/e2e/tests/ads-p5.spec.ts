// ADS 구성 마감(P5) — 실제 백엔드(메모리 DB·v0.81 + data/fixtures/ads 시드)로 정책 컴파일 검사·발행 후보·복구 결정·출고 대조·OTA 설치 단계·캠페인·분류 패널을 밟는다.
// 핵심 메시지는 숫자만 시드, 판단 불가·미확인은 따로, 막힌 행동은 글자 사유(BlockedAction), 화면 글자에 계정 ID 없음.
import { expect, test, type Page } from '@playwright/test';

const key = (page: Page) => page.locator('#main [data-key-message]');
const main = (page: Page) => page.locator('#main');

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('ODD 프로파일: 정책 컴파일 검사 — 승인 상한을 넘는 Flag는 빌드 거부 사유, 프로파일별 판정 로그', async ({ page }) => {
  await page.goto('/config/odd?profile=ODD-FEAT-00004-v1&detail=compile');
  await expect(main(page).locator('[data-compile-blocked="hda2_00004_speed"]')).toContainText('DS-0001');
  await expect(main(page).locator('[data-odd-logs]')).toContainText('이 프로파일로 기록된 차량 판정');
});

test('ODD 프로파일: 적용 장소 추가 — 변경 영향 확정 전이면 승인 대기, 승인 상한은 그대로', async ({ page }) => {
  await page.goto('/config/odd?profile=ODD-FEAT-00004-v1&detail=sites');
  await asRole(page, 'author');
  await page.reload();
  await page.getByRole('button', { name: '적용 장소 추가 요청' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('장소 이름').fill('판교 시범 구역');
  await d.getByLabel('지도 버전').fill('2.2');
  await d.getByLabel('인프라 버전').fill('IF-1.5');
  await d.getByLabel('사유', { exact: true }).fill('시범 구역 추가');
  await d.getByRole('button', { name: '요청 저장' }).click();
  await expect(main(page)).toContainText('판교 시범 구역');
  await expect(main(page)).toContainText('IMPACT_REVIEW_OPEN');
});

test('승인 구성 조합: 발행 후보 — ADAS는 대상 유지·사유 기록, 복구 결정은 사유와 재활성화 후보', async ({ page }) => {
  // care_00022_param의 배포 중 판 — 전시 채우기가 POL-00002를 같은 값의 새 판으로 대체한다(통합 3차)
  const api = `http://localhost:${process.env.E2E_API_PORT}`;
  const pols = (await (await page.request.get(`${api}/api/policies?status=DEPLOYED`, { headers: { 'X-Actor-Id': 'usr-viewer', 'X-Actor-Role': 'AUDITOR' } })).json()).items as { policyId: string; flagKey: string }[];
  const live = pols.find((p) => p.flagKey === 'care_00022_param')!.policyId;
  await page.goto('/config/compat?tab=publish');
  await expect(main(page).locator(`[data-publish-preview="${live}"]`)).toContainText('부분 복구');
  await expect(main(page)).toContainText('조합 미검증 Feature');
  await page.goto('/config/compat?tab=recovery');
  await asRole(page, 'opslead');
  await page.reload();
  await page.getByRole('button', { name: '복구 결정 저장' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('차량').fill('KMH-NX4-0004');
  await d.getByLabel('근거').fill('복구 후보가 보안 최소 버전 미달 — 정지 유지');
  await d.getByRole('button', { name: '복구 결정 저장' }).click();
  await expect(main(page)).toContainText('복구 후보가 보안 최소 버전 미달 — 정지 유지');
  await expect(main(page)).toContainText('조건 부족');
});

test('출고 실물 구성 대조: 품질 보류 차량 수, 실물 미확인은 따로, 불일치가 남으면 해제 대신 사유', async ({ page }) => {
  await page.goto('/baselines/eol');
  await expect(key(page)).toContainText('품질 보류 차량 3대 — 주문 사양과 실물 구성 불일치');
  await expect(main(page)).toContainText('실물 미확인 1대');
  await expect(main(page)).toContainText('실물 구성 원장: 공장 품질 시스템');
  await asRole(page, 'steward');
  await page.goto('/baselines/eol?vin=KMH-NX4-0002');
  const d = page.getByRole('dialog');
  await expect(d.locator('[data-eol-acceptance]')).toContainText('인수 완료');
  await d.getByRole('combobox', { name: '결정' }).selectOption('RELEASE');
  await expect(d).toContainText('공장 품질 시스템에서 해소한 뒤 다시 대조하세요');
  // 부모 화면에서 이어진다
  await page.goto('/baselines');
  await expect(page.getByRole('link', { name: '출고 실물 구성 대조' })).toBeVisible();
});

test('OTA 설치 단계: 5단계 띠와 갈림 상태 줄, 실패 원인 세 칸, 운행 제한은 예상 글자', async ({ page }) => {
  await page.goto('/ops/ota-installs');
  await expect(key(page)).toContainText(/설치 확인 \d+대 — 실패·복구 필요 \d+대/);
  await expect(main(page).locator('[data-install-failures]')).toContainText('전원');
  await page.goto('/ops/ota-installs?vin=KMH-NX4-0001');
  const d = page.getByRole('dialog');
  await expect(d.locator('[data-install-branch="SAFE_STATE_HELD"]')).toContainText('정지 유지 · 정비 필요');
  await page.goto('/fleet/vehicles/ego-01');
  await expect(main(page).locator('[data-install-strip]')).toBeVisible();
  await expect(main(page)).toContainText('약 25분 운행 제한(예상)');
  await expect(main(page)).not.toContainText('운행 가능');
});

test('전송 캠페인: 캠페인으로 게시본·정책 릴리스를 찾는다', async ({ page }) => {
  await page.goto('/deployments/campaigns/CMP-00002');
  await expect(key(page)).toContainText(/게시본 \d+건 · 정책 릴리스 \d+건/);
  await expect(page.getByRole('link', { name: 'POL-00002' })).toBeVisible();
});

test('Feature 분류 패널: 거부 규칙 켜짐 문구와 지원 종료 연습 네 칸', async ({ page }) => {
  await page.goto('/features/FEAT-00022/1.0.0?tab=safety');
  await expect(main(page).locator('[data-support-drill]')).toBeVisible();
  await expect(main(page).locator('[data-drill-check]')).toHaveCount(4);
  await expect(main(page)).toContainText('출시 전이 거부 규칙이 켜져 있습니다');
  const text = await main(page).innerText();
  expect(text).not.toMatch(/\busr-[a-z0-9]/);
});

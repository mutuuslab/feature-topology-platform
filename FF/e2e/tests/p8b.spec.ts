// P8b 끝단 흐름 — 실제 백엔드(전용 9111): 차량 고장 보고(차량 발신 API) → 이상 건 → 조치 → 품질 피드백, Unleash 동기화·차량별 대조.
// 차량은 다른 시험이 쓰지 않는 KMH-NX4-0001·0004만 쓰고, FEAT-00022 긴급 차단은 하지 않는다(ops.spec과 병렬 충돌 방지).
import { expect, test, type Page } from '@playwright/test';
import { vehiclePost } from './vehicle';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

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

test('이상 징후: 고장 보고 2대(ASIL B) → 긴급 차단 권고 → 확인·조치 완료 → 품질 피드백(G5·G7·가상검증 회귀)', async ({ page, request }) => {
  const at = new Date().toISOString();
  for (const vin of ['KMH-NX4-0001', 'KMH-NX4-0004']) {
    const boot = `BOOT-${vin}-e2e`;
    // 차량 서명 요청(RD-SEC-08) — 공장 주입 차량 키로 CMAC
    const send = (sequence: number, body: Record<string, unknown>) => vehiclePost(request, vin, `/vehicle/v1/${vin}/reports`, { bootId: boot, sequence, observedAt: at, ...body });
    expect((await send(1, { type: 'HELLO', highest: {} })).status()).toBe(200);
    const r = await send(2, { type: 'FAULT', featureId: 'FEAT-00022', code: 'GAP_EST_DRIFT', severity: 'WARNING', detail: 'e2e' });
    expect(r.status(), await r.text()).toBe(200);
  }

  await asRole(page, 'operator');
  await page.goto('/ops/anomalies');
  const row = page.getByRole('row', { name: /기능 고장/ }).first();
  await expect(row).toContainText('긴급 차단 권고');
  await row.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: '긴급 차단으로' })).toHaveAttribute('href', /\/ops\/kill\?featureId=FEAT-00022&anomaly=ANM-\d{5}/);
  await drawer.getByLabel('사유').fill('현장 데이터 확인');
  await drawer.getByRole('button', { name: '확인' }).click();
  await expect(drawer).toContainText('확인됨');
  await drawer.getByLabel('사유').fill('보정 파라미터 원격 적용으로 조치');
  await drawer.getByRole('button', { name: '조치 완료' }).click();
  await expect(drawer).toContainText('조치됨');

  await page.goto('/quality/feedback');
  const fb = page.getByRole('row', { name: /FEAT-00022/ }).first();
  await expect(fb).toContainText('G5 · G7');
  await expect(fb).toContainText('SCN-FEAT00022-FAULT-ONBOARD');
});

test('Unleash 연계: 배포 정책 동기화(모의 Unleash) → drift 없음 → 차량별 대조 불일치 0', async ({ page }) => {
  await asRole(page, 'coordinator'); // 출시 담당
  await page.goto('/policies/POL-00002');
  const panel = page.getByRole('region', { name: 'Policy Tool 연계 (Unleash)' });
  await expect(panel).toContainText('country IN KR');
  await panel.getByRole('button', { name: 'Unleash 동기화' }).click();
  await expect(panel).toContainText('environment on');
  await expect(panel).toContainText('계획과 같습니다');
  await panel.getByRole('button', { name: '차량별 대조' }).click();
  await expect(panel).toContainText(/불일치 0/);
});

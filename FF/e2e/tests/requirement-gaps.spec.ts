// 기능명세서 공백 보강(B1·B4·B5·B6) 끝단 흐름 — 실제 백엔드(메모리 DB·v0.81)와 v2 화면.
// 운영 리더가 수신자 규칙에 사람을 더하고 → 파이프라인 실패가 오류 이력·알림으로 이어지고 → 감사 화면에서 기간·변경 전후 값·내보내기,
// Feature 상세 '평가 운영' 탭에서 앱별 평가 횟수를 본다.
import { expect, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

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

test('수신자 규칙 → 파이프라인 실패 알림·오류 이력 → 감사 전후 값·내보내기 → 평가 운영 탭', async ({ page, request }) => {
  // 1) 운영 리더 — 파이프라인 실패 규칙에 감사 조회자 계정을 더한다(사유 필수)
  await asRole(page, 'opslead');
  await page.goto('/notifications/rules');
  const table = page.getByRole('table', { name: '이벤트별 수신자' });
  const row = table.locator('tr', { has: page.locator('[data-event="pipeline.run.failed"]') });
  await row.getByRole('button', { name: '수신자 더하기' }).click();
  const drawer = page.getByRole('dialog');
  const picker = drawer.getByTestId('recipient-picker');
  await picker.getByRole('radio', { name: '사람' }).click();
  await picker.getByLabel('누구').selectOption('usr-viewer');
  await picker.getByRole('button', { name: '더하기' }).click();
  await drawer.getByLabel('바꾸는 이유').fill('파이프라인 실패를 감사 조회자도 함께 본다');
  await drawer.getByRole('button', { name: '저장' }).click();
  await expect(row.locator('[data-recipient="user:usr-viewer"]')).toBeVisible();

  // 2) CI가 실패를 보낸다(IF-13) → 오류 이력 + 알림
  const runId = `GL-E2E-${uniq()}`;
  const r = await request.post(`${API}/api/pipeline/runs`, { headers: H('usr-integrator', 'IMPLEMENTER'), data: { runId, pipeline: 'adas-distance/main', environment: 'staging', status: 'FAILED', featureId: 'FEAT-00022', stage: 'hil-test', reason: 'HIL 시험 3건 실패' } });
  expect(r.status(), await r.text()).toBe(201);
  await asRole(page, 'viewer');
  await page.goto('/integration/connectors?tab=errors');
  const errors = page.getByRole('table', { name: '오류 이력' });
  await expect(errors.getByText(runId)).toBeVisible();
  await expect(errors).toContainText('CI/CD 파이프라인');
  await page.goto('/notifications');
  await page.getByRole('radio', { name: /^전체/ }).click();
  await expect(page.getByTestId('notification-row').filter({ hasText: runId }).first()).toBeVisible();

  // 3) 감사 — 수신자 규칙을 바꾼 기록을 열어 변경 전후 값, 기간 조건, CSV 내보내기
  await page.goto('/audit');
  await page.getByLabel('행위').selectOption('NOTIFICATION_RULE_UPDATE');
  const audit = page.getByRole('table', { name: '감사 이력' });
  await audit.locator('tbody tr').first().click();
  const diff = page.getByTestId('audit-diff');
  await expect(diff).toContainText('recipients');
  await expect(diff).toContainText('user:usr-viewer');
  await page.keyboard.press('Escape');
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel('시작일').fill(today);
  await expect(audit.locator('tbody tr').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV로 내보내기' }).click();
  expect((await download).suggestedFilename()).toMatch(/^FF_audit_.*\.csv$/);
  await expect(page.getByText(/행 · SHA-256 [0-9a-f]{12}…/)).toBeVisible();
  await page.getByRole('tab', { name: '정책 운영 현황' }).click();
  await expect(page.getByTestId('policy-stats').getByRole('table')).toBeVisible();

  // 4) Feature 상세 '평가 운영' — 앱 평가(OFREP)를 보낸 앱 이름·환경으로 센다
  for (let i = 0; i < 3; i++) await request.post(`${API}/ofrep/v1/evaluate/flags/ivi_00024_guide`, { data: { context: { targetingKey: 'ego-01', appName: 'ivi-e2e', environment: 'staging' } } });
  await page.goto('/features/FEAT-00024/1.0.0?tab=evaluations');
  const ev = page.getByTestId('evaluations');
  await expect(ev.getByRole('table', { name: '애플리케이션·환경별' })).toContainText('ivi-e2e');
  await expect(ev.getByRole('list', { name: '일별 평가' }).locator('li').first()).toBeVisible();
});

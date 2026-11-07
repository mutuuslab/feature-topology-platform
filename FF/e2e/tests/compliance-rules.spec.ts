// 컴플라이언스 룰 레지스트리(D03-01, FR-CRC-001·002) — 실제 백엔드(데모 시드)에서 목록·만료·배포 검증 결과를 보고,
// 법규 담당이 룰을 등록·승인 요청하면 지정 승인 대상자(품질 검토)가 승인한다. 화면은 접근성 심각 위반 0.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

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

test('룰 레지스트리: 승인·승인 대기·반려·만료 룰과 배포 검증 결과가 채워져 있고, 만료 알림이 작성자에게 간다', async ({ page, request }) => {
  await page.goto('/_design');
  await asRole(page, 'viewer');
  await page.goto('/verify/compliance?tab=registry');
  const table = page.getByRole('table', { name: '컴플라이언스 룰' });
  await expect(table.getByRole('row').filter({ hasText: 'CR-SAF-001' })).toContainText('1.1');
  await expect(table.getByRole('row').filter({ hasText: 'CR-SEC-004' })).toContainText('승인 대기');
  await expect(table.getByRole('row').filter({ hasText: 'CR-LEG-005' })).toContainText('반려');
  await expect(table.getByRole('row').filter({ hasText: 'CR-PRV-006' })).toContainText('만료');
  await expect(page.getByRole('table', { name: '배포 검증 결과' }).getByRole('row').nth(1)).toBeVisible();
  await noSeriousAxe(page);
  // 상세 — 버전 1.0(승인)·1.1(승인)과 변경 이력
  await table.getByRole('row').filter({ hasText: 'CR-SAF-001' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('table', { name: '버전' })).toContainText('1.0');
  await expect(dlg.getByRole('table', { name: '변경 이력' })).toContainText('조항 번호');
  await page.keyboard.press('Escape');
  const inbox = await request.get(`${API}/api/notifications`, { headers: { 'X-Actor-Id': 'usr-steward', 'X-Actor-Role': 'REGULATORY_OWNER' } });
  const items = (await inbox.json()).items as { eventType: string; title: string }[];
  expect(items.some((n) => n.eventType === 'compliance.rule.expired' && n.title.includes('CR-PRV-006'))).toBe(true);
});

test('룰 등록 → 승인 요청 → 지정 승인 대상자 승인', async ({ page }) => {
  const id = `CR-E2E-${String(Date.now()).slice(-6)}`;
  await page.goto('/_design');
  await asRole(page, 'steward');
  await page.goto('/verify/compliance?tab=registry');
  await page.getByRole('button', { name: '룰 등록' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^룰 ID/).fill(id);
  await form.getByLabel('룰 명칭', { exact: true }).fill('시험 — 요구사항 연결');
  await form.getByLabel('룰 유형').selectOption('LEGAL');
  await form.getByRole('checkbox', { name: 'KR', exact: true }).check();
  await form.getByRole('checkbox', { name: '요구사항 연결' }).check();
  await form.getByRole('checkbox', { name: /박유진/ }).check();
  await form.getByLabel(/^근거 URL/).fill('ftp://law.example/a');
  await form.getByLabel(/^근거 문서명/).fill('자동차관리법');
  await form.getByLabel(/^유효 시작일/).fill('2026-01-01');
  await form.getByRole('button', { name: '저장' }).click();
  await expect(form.getByText(/http:\/\/ 또는 https:\/\//)).toBeVisible();
  await form.getByLabel(/^근거 URL/).fill('https://www.law.go.kr/');
  await form.getByRole('button', { name: '저장' }).click();
  const detail = page.getByRole('dialog', { name: `룰 ${id}` });
  await expect(detail).toContainText('승인 대기');
  await detail.getByRole('button', { name: '승인 요청' }).click();
  await expect(detail.getByRole('table', { name: '승인 요청' })).toContainText('진행 중');
  await noSeriousAxe(page);

  await asRole(page, 'quality');
  await page.goto(`/verify/compliance?tab=registry&rule=${id}`);
  const d2 = page.getByRole('dialog', { name: `룰 ${id}` });
  await d2.getByLabel('결정 사유').fill('요구사항 연결 기준 확인');
  await d2.getByRole('button', { name: '승인', exact: true }).click();
  await expect(d2.getByRole('table', { name: '승인 요청' })).toContainText('승인 — 요구사항 연결 기준 확인');
  await expect(page.getByRole('table', { name: '컴플라이언스 룰' }).getByRole('row').filter({ hasText: id })).toContainText('승인');
});

// 예외 승인(GX — FR-EXC-001·002·FR-REG-005-010) — 실제 백엔드(데모 시드)에서 적용 중·1차 승인·반려·만료 예외를 보고,
// 1차 승인한 사람과 다른 운영 리더가 두 번째 승인(만료 일시 지정)을 하면 적용 중이 된다. 출시 전 Version 정책 상세는 Shadow만을 알린다. 접근성 심각 위반 0.
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

test('예외 목록: 적용 중·1차 승인·반려·만료 예외와 우회 불가 4가지가 보인다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'viewer');
  await page.goto('/verify/exceptions');
  const table = page.getByRole('table', { name: '예외 목록' });
  for (const s of ['적용 중', '1차 승인', '반려', '만료·원복']) await expect(table.getByRole('row').filter({ hasText: s }).first()).toBeVisible();
  await expect(page.getByText('우회 불가')).toHaveCount(4);
  const r = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  // 만료된 예외 상세 — 원복 메시지와 상태 전이 기록
  await table.getByRole('row').filter({ hasText: '만료·원복' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText(/되돌릴 정책 상태가 없습니다/)).toBeVisible();
  await expect(dlg.getByRole('table', { name: '상태 전이 기록' })).toContainText('2차 승인·적용');
});

test('두 번째 승인 — 1차 승인자는 못 하고, 다른 운영 리더가 만료 일시와 함께 승인하면 적용 중', async ({ page, request }) => {
  const list = (await (await request.get(`${API}/api/exceptions?status=APPROVING`)).json()).items as { exceptionId: string; approvals: { by: string }[] }[];
  test.skip(!list.length, '1차 승인 예외 없음');
  const id = list[0].exceptionId;
  await page.goto('/_design');
  await asRole(page, 'quality');
  await page.goto(`/verify/exceptions?id=${id}`);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText(/이미 승인했습니다/)).toBeVisible();
  await asRole(page, 'opslead');
  await page.goto(`/verify/exceptions?id=${id}`);
  await dlg.getByLabel('의견·사유').fill('중단 기준·연락 체계 확인');
  await dlg.getByRole('button', { name: '승인' }).click();
  await expect(dlg.getByText('적용 중').first()).toBeVisible();
  const e = await (await request.get(`${API}/api/exceptions/${id}`)).json();
  expect(e).toMatchObject({ status: 'ACTIVE', active: true });
  expect(e.approvals.map((a: { by: string }) => a.by)).toEqual(['usr-quality', 'usr-opslead']);
});

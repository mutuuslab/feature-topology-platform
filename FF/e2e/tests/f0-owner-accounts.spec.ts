// F0 권한 기반(D-GAP-1·B13·C8) — 실제 백엔드(데모 시드). 시스템 관리자가 계정 상태 패널을 보고, 소유자가 없는 컴플라이언스 룰(CR-PRV-091)을
// 법규 담당에게 이관하면 이력이 남는다. 다른 역할은 이관할 수 없다. OFREP 평가는 SDK 키 없이 401, 데모 기본 키로 200.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEMO_SDK_KEY } from '../../contracts/src/rules/api-gateway';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('계정 상태: 시스템 관리자 홈은 플랫폼 인증·권한, 13계정이 채워져 있고 접근성 심각 위반 0', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'sysadmin');
  await page.goto('/admin/iam');
  const accounts = page.locator('section[aria-labelledby="accounts-h"]');
  await expect(accounts.getByRole('row').filter({ hasText: '시스템 관리자' }).first()).toBeVisible();
  await expect(accounts.getByRole('row')).toHaveCount(14); // 머리 행 + 데모 계정 13
  const r = await new AxeBuilder({ page }).include('.ds-screen').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('소유자 이관: 다른 역할은 막히고, 시스템 관리자가 소유자 없는 룰을 법규 담당에게 옮기면 이력이 남는다', async ({ page }) => {
  await page.goto('/_design');
  await asRole(page, 'steward');
  await page.goto('/verify/compliance?tab=registry');
  const table = page.getByRole('table', { name: '컴플라이언스 룰' });
  await table.getByRole('row').filter({ hasText: 'CR-PRV-091' }).click();
  let dlg = page.getByRole('dialog');
  await expect(dlg.locator('section[aria-labelledby="owner-transfer-h"]')).toContainText('없는 계정');
  await expect(dlg.getByRole('button', { name: '소유자 이관' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await asRole(page, 'sysadmin');
  await page.goto('/verify/compliance?tab=registry');
  await table.getByRole('row').filter({ hasText: 'CR-PRV-091' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('새 소유자').selectOption('usr-steward');
  await dlg.getByLabel('이관 사유').fill('법규 담당 퇴사 — 같은 팀 이관');
  await dlg.getByRole('button', { name: '소유자 이관' }).click();
  await expect(dlg.getByRole('table', { name: '소유자 이관 이력' })).toContainText('법규 담당 퇴사 — 같은 팀 이관');
  await expect(dlg.locator('section[aria-labelledby="owner-transfer-h"]')).toContainText('사용 중');
});

test('OFREP: SDK 키 없이 401, 데모 기본 키(Bearer)로 평가', async ({ request }) => {
  const body = { data: { context: { targetingKey: 'ego-01' } } };
  expect((await request.post(`${API}/ofrep/v1/evaluate/flags/ivi_00024_guide`, body)).status()).toBe(401);
  const ok = await request.post(`${API}/ofrep/v1/evaluate/flags/ivi_00024_guide`, { ...body, headers: { Authorization: `Bearer ${DEMO_SDK_KEY}` } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).key).toBe('ivi_00024_guide');
});

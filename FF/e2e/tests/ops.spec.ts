// PoC ④⑥ 배포·차단 전달 + vECU 가상검증 끝단 흐름 — 실제 백엔드(전용 9111, 실제 타이머)와 v2 화면.
// 긴급 차단은 lead-01만 대상으로 한다 — ego-01은 policy.spec의 체험권 흐름이 병렬로 쓴다.
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

test('긴급 차단: 영향 범위 → Safe Stop → 확인 입력 → 서명·긴급 전달 → 회신 CONFIRMED → Fleet 현황 → 해제·복구', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/ops/kill');
  await expect(page.getByText('care_00022_param, care_00022_signal')).toBeVisible();
  // lead-01만 남긴다
  for (const box of await page.getByRole('group', { name: '대상 차량' }).getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').textContent()) ?? '';
    if (!label.includes('lead-01')) await box.uncheck();
  }
  await page.getByRole('radio', { name: /Safe Stop/ }).click();
  await page.getByLabel('사유').first().fill('e2e — 전방 거리 오추정');
  await page.getByRole('button', { name: '차단 발령' }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.getByRole('textbox').fill('FEAT-00022');
  await dlg.getByRole('button', { name: '차단 발령' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/KILL-\d{5}/);
  await expect(drawer.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
  await expect(drawer).toContainText('CONFIRMED');
  const killId = ((await drawer.locator('h2').first().textContent()) ?? '').trim();

  // Fleet 실시간 적용 현황 — lead-01은 차량 측에서 Safe(차단) 상태
  await page.goto('/fleet/live');
  const row = page.getByRole('row', { name: /lead-01/ });
  await expect(row.locator('.ds-fcell').first()).toHaveAttribute('data-v', 'safe');
  await expect(page.getByRole('row', { name: /KMH-NX4-0001/ }).locator('.ds-fcell').first()).not.toHaveAttribute('data-v', 'safe');

  // 서명 배포 현황 — 차단 게시본은 서명 검증 통과
  await page.goto('/deployments');
  await page.getByRole('row', { name: /차단/ }).first().click();
  await expect(page.getByText('SIGNATURE_VALID')).toBeVisible();

  // 해제 → 복구 전달
  await page.goto(`/ops/kill?id=${killId}`);
  await page.getByRole('dialog').getByLabel('사유').fill('원인 수정 확인');
  await page.getByRole('dialog').getByRole('button', { name: '해제·이전 상태 복구' }).click();
  await expect(page.getByRole('dialog')).toContainText('해제됨');
  await expect(page.getByRole('dialog').getByRole('meter').last()).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
});

test('vECU 가상검증: 실행(시험 대역) → 결과·증적 → TMS 제출(품질)', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/validations/virtual');
  const run = page.getByRole('button', { name: '가상검증 실행' });
  await expect(run).toBeEnabled();
  await run.click();
  const first = page.getByRole('table', { name: '실행 이력' }).getByRole('row', { name: /SCN-FEAT00022-NOMINAL/ }).first();
  // 실행은 vECU 프로세스를 띄우므로 병렬 부하에서는 몇 초 걸릴 수 있다
  await expect(first).toContainText('vecu', { timeout: 30_000 });
  await asRole(page, 'quality');
  await page.reload();
  await page.getByRole('table', { name: '실행 이력' }).getByRole('row', { name: /SCN-FEAT00022-NOMINAL/ }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'verdict.json' })).toBeVisible();
  await drawer.getByRole('button', { name: 'TMS 제출 (IF-09)' }).click();
  await expect(drawer).toContainText(/TMS-\d{5}/);
});

// PoC ④⑥ 배포·차단 전달 + CARLA 가상검증 끝단 흐름 — 실제 백엔드(전용 9111, 실제 타이머)와 v2 화면.
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

test('긴급 차단 v2: 요청 → FSM·운영 리더 승인 → 게이트·서명·긴급 전달 → 회신 CONFIRMED → Fleet → 복원 요청 → 다른 2인 승인 → 복구', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/ops/kill');
  await expect(page.getByText('care_00022_param, care_00022_signal')).toBeVisible();
  // lead-01만 남긴다
  for (const box of await page.getByRole('group', { name: '대상 차량' }).getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').textContent()) ?? '';
    if (!label.includes('lead-01')) await box.uncheck();
  }
  // F3 안전 차단 — 봉쇄 결정 근거(FFG-PLT-009·DEAC-010), 비활성화 방식은 Registry 등급(DC2)
  await page.getByLabel(/봉쇄 결정 근거/).fill('e2e — 원인 분석 전 봉쇄');
  await page.getByLabel('사유', { exact: true }).fill('e2e — 전방 거리 오추정');
  await expect(page.locator('#new-kill-h').locator('xpath=ancestor::section').locator('.ds-rules__item[data-status="fail"]')).toHaveCount(0);
  await page.getByRole('button', { name: '차단 요청' }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.getByRole('textbox').fill('FEAT-00022');
  await dlg.getByRole('button', { name: '차단 요청' }).click();

  let drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/KILL-\d{5}/);
  await expect(drawer).toContainText('승인 대기');
  const killId = ((await drawer.locator('h2').first().textContent()) ?? '').trim();
  // 요청자는 승인할 수 없다
  await expect(drawer.getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();

  // 승인 1 — 품질 검토(FSM), 승인 2 — PLM 기준정보(법규 담당)
  for (const role of ['quality', 'steward']) {
    await asRole(page, role);
    await page.goto(`/ops/kill?id=${killId}`);
    drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: '승인 — 개인 서명' }).click();
    await expect(drawer.locator('.ds-approvals__slot[data-done]')).toHaveCount(role === 'quality' ? 1 : 2);
  }
  await expect(drawer).toContainText('차단 중');
  await expect(drawer).toContainText('서명된 명령');
  await expect(drawer.getByRole('table', { name: '차량별 봉투' })).toContainText('lead-01');
  await expect(drawer.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
  await expect(drawer).toContainText('CONFIRMED');

  // Fleet 실시간 적용 현황 — lead-01은 차량 측에서 Safe(차단) 상태
  await page.goto('/fleet/live');
  const row = page.getByRole('row', { name: /lead-01/ });
  await expect(row.locator('.ds-fcell').first()).toHaveAttribute('data-v', 'safe');
  await expect(
    page
      .getByRole('row', { name: /KMH-NX4-0001/ })
      .locator('.ds-fcell')
      .first(),
  ).not.toHaveAttribute('data-v', 'safe');

  // 서명 배포 현황 — 차단 게시본은 차단 용도 키로 서명 검증 통과
  await page.goto('/deployments');
  await page.getByRole('row', { name: /차단/ }).first().click();
  await expect(page.getByText('SIGNATURE_VALID')).toBeVisible();

  // 복원 요청(운영자) → 차단 승인자(품질 검토)는 막힘 → 시스템 연계(부 FSM)·구성 승인(상품 책임) 승인
  await asRole(page, 'operator');
  await page.goto(`/ops/kill?id=${killId}`);
  drawer = page.getByRole('dialog');
  await drawer.getByLabel('사유', { exact: true }).fill('원인 수정 확인');
  await drawer.getByRole('button', { name: '복원 요청' }).click();
  await asRole(page, 'quality');
  await page.goto(`/ops/kill?id=${killId}`);
  await expect(page.getByRole('dialog')).toContainText('직전 차단 승인자는 복원을 승인할 수 없습니다');
  for (const role of ['integrator', 'approver']) {
    await asRole(page, role);
    await page.goto(`/ops/kill?id=${killId}`);
    drawer = page.getByRole('dialog');
    await drawer.locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
    if (role === 'integrator') await expect(drawer.locator('[data-tour="kill-restore"] .ds-approvals__slot[data-done]')).toHaveCount(1);
  }
  await expect(drawer).toContainText('해제됨');
  await expect(drawer.getByRole('meter').last()).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
});

test('CARLA 가상검증: 서버 상태 → 실행(시험 대역) → 결과·Evidence → TMS 제출(품질)', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/validations/virtual');
  await expect(page.locator('[data-tour="sim-status"]')).toContainText('127.0.0.1:2100');
  const run = page.getByRole('button', { name: '가상검증 실행' });
  await expect(run).toBeEnabled();
  await run.click();
  const first = page
    .getByRole('table', { name: '실행 이력' })
    .getByRole('row', { name: /SCN-FEAT00022-NOMINAL/ })
    .first();
  // 실행은 실행기 프로세스를 띄우므로 병렬 부하에서는 몇 초 걸릴 수 있다
  await expect(first).toContainText('carla', { timeout: 30_000 });
  await asRole(page, 'quality');
  await page.reload();
  await page
    .getByRole('table', { name: '실행 이력' })
    .getByRole('row', { name: /SCN-FEAT00022-NOMINAL/ })
    .first()
    .click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'verdict.json' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'carla_recording.log' })).toBeVisible();
  await drawer.getByRole('button', { name: 'TMS 제출 (IF-09)' }).click();
  await expect(drawer).toContainText(/TMS-\d{5}/);
});

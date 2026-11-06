// PoC ④⑥ 배포·차단 전달 + CARLA 가상검증 끝단 흐름 — 실제 백엔드(전용 9111, 실제 타이머)와 v2 화면.
// 긴급 차단은 lead-01만 대상으로 한다 — ego-01은 policy.spec의 체험권 흐름이 병렬로 쓴다.
import { expect, test, type Page } from '@playwright/test';
import { lockKill, releaseKillLocks } from './kill-lock';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test.afterEach(releaseKillLocks);

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('긴급 차단 v2: 요청 → FSM·CSM 승인 → 게이트·서명·긴급 전달 → 회신 CONFIRMED → Fleet → 복원 요청 → 다른 2인 승인 → 복구', async ({ page }) => {
  test.setTimeout(300_000); // 아래 기다림(다른 시험의 차단이 끝날 때까지)을 포함
  await asRole(page, 'operator');
  // 따라하기 e2e(learn.spec)도 FEAT-00022를 차단한다 — 차단은 Feature당 하나라 작업자 사이 잠금을 잡고 요청한다
  await lockKill(page.request, 'FEAT-00022');
  await page.goto('/ops/kill');
  // 요청 폼은 머리의 행동 버튼으로 여는 Drawer(UX3-03)
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('care_00022_param, care_00022_signal')).toBeVisible();
  // lead-01만 남긴다
  for (const box of await form.getByRole('group', { name: '대상 차량' }).getByRole('checkbox').all()) {
    const label = (await box.locator('xpath=..').textContent()) ?? '';
    if (!label.includes('lead-01')) await box.uncheck();
  }
  // F3 안전 차단 — 봉쇄 결정 근거(FFG-PLT-009·DEAC-010), 비활성화 방식은 Registry 등급(DC2)
  await form.getByLabel(/봉쇄 결정 근거/).fill('e2e — 원인 분석 전 봉쇄');
  await form.getByLabel('사유', { exact: true }).fill('e2e — 전방 거리 오추정');
  await expect(form.locator('.ds-rules__item[data-status="fail"]')).toHaveCount(0);
  await form.getByRole('button', { name: '차단 요청', exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.getByRole('textbox').fill('FEAT-00022');
  await dlg.getByRole('button', { name: '차단 요청' }).click();

  let drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(/KILL-\d{5}/);
  await expect(drawer).toContainText('승인 대기');
  const killId = ((await drawer.locator('h2').first().textContent()) ?? '').trim();
  // 요청자는 승인할 수 없다
  await expect(drawer.getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();

  // 승인 1 — 품질 검토(FSM), 승인 2 — 시스템 연계(사이버보안 CSM). F3 안전 차단은 FSM + CSM(2026-11-04 결정)
  for (const role of ['quality', 'integrator']) {
    await asRole(page, role);
    await page.goto(`/ops/kill?id=${killId}`);
    drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: '승인 — 개인 서명' }).click();
    await expect(drawer.locator('.ds-approvals__slot[data-done]')).toHaveCount(role === 'quality' ? 1 : 2);
  }
  await expect(drawer).toContainText('차단 중');
  await expect(drawer).toContainText('서명된 차단 명령');
  await expect(drawer.getByRole('table', { name: '차량별 봉투' })).toContainText('lead-01');
  await expect(drawer.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '1', { timeout: 10_000 });
  await expect(drawer).toContainText('적용 확인');

  // Fleet 실시간 적용 현황 — lead-01은 차량 측에서 Safe(차단) 상태
  // 차단한 flag(care_00022_param) 열로 찾는다 — 다른 차종 전용 flag(GN7 adas_00004_assist 등)가 앞 열에 올 수 있다
  await page.goto('/fleet/live?tab=match'); // 차량×flag 행렬은 '정책 값 대조' 탭(ADS-UI01)
  const matrix = page.getByRole('table', { name: /차량 × flag/ });
  await expect(matrix.getByRole('columnheader', { name: 'care_00022_param' })).toBeVisible();
  const col = (await matrix.getByRole('columnheader').allTextContents()).indexOf('care_00022_param') - 1; // 차량 머리칸(rowheader) 다음부터 칸
  expect(col).toBeGreaterThan(0);
  const cellOf = (vin: RegExp) => matrix.getByRole('row', { name: vin }).getByRole('cell').nth(col).locator('.ds-fcell');
  await expect(cellOf(/lead-01/)).toHaveAttribute('data-v', 'safe');
  await expect(cellOf(/KMH-NX4-0001/)).not.toHaveAttribute('data-v', 'safe');
  // 다른 차종 전용 flag 칸은 미수신이 아니다(해당 없음)
  await expect(matrix.getByRole('row', { name: /lead-01/ })).not.toContainText('미수신');

  // 서명 배포 현황 — 차단 게시본은 차단 용도 키로 서명 검증 통과
  await page.goto('/deployments');
  await page.getByRole('row', { name: /차단/ }).first().click();
  await expect(page.getByText('SIGNATURE_VALID')).toBeVisible();

  // 복원 요청(운영자, 재검증 Evidence·Cohort) → 차단 승인자(품질 검토)는 막힘 → 두 번째 Safety Manager·운영 리더 승인
  await asRole(page, 'operator');
  await page.goto(`/ops/kill?id=${killId}`);
  drawer = page.getByRole('dialog');
  await drawer.getByLabel('사유', { exact: true }).fill('원인 수정 확인');
  await expect(drawer.getByTestId('restore-evidence')).toBeVisible();
  await drawer.getByRole('button', { name: '복원 요청' }).click();
  await asRole(page, 'quality');
  await page.goto(`/ops/kill?id=${killId}`);
  await expect(page.getByRole('dialog')).toContainText('직전 차단 승인자는 복원을 승인할 수 없습니다');
  for (const role of ['safety2', 'opslead']) {
    await asRole(page, role);
    await page.goto(`/ops/kill?id=${killId}`);
    drawer = page.getByRole('dialog');
    await drawer.locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
    if (role === 'safety2') await expect(drawer.locator('[data-tour="kill-restore"] .ds-approvals__slot[data-done]')).toHaveCount(1);
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

// P9 PoC 6단계 끝단 — 실제 백엔드(전용 9111, 실제 타이머, vECU 시험 대역·모의 Unleash)에서 화면의 "끝까지 실행"으로 ①~⑥.
// FEAT-00022를 실제로 긴급 차단하므로 다른 e2e가 모두 끝난 뒤 별도 프로젝트(poc)로 돈다(playwright.config.ts).
// 이어서 OF-3: 차단 중 OpenFeature 웹 SDK 값이 OFF(DISABLED), 해제하면 ETag 폴링으로 다시 ON.
import { expect, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('PoC: 새 실행 → 끝까지 실행 → ①~⑥ 완료(배포 PARTIAL·차단 CONFIRMED) → OpenFeature SDK OFF → 해제 후 ON', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto('/_design');
  await asRole(page, 'operator');
  await page.goto('/poc');
  await page.getByRole('button', { name: '새 실행 시작' }).click();
  const steps = page.getByRole('list', { name: 'PoC 6단계 진행' });
  await expect(steps.getByRole('button')).toHaveCount(6);
  await page.getByRole('button', { name: '끝까지 실행' }).click();
  // ④는 통신 단절 차량 때문에 회신 기한(8초)까지 기다린다
  await expect(steps.getByRole('button').nth(5)).toHaveAttribute('data-status', 'DONE', { timeout: 60_000 });
  for (let i = 0; i < 6; i++) await expect(steps.getByRole('button').nth(i)).toHaveAttribute('data-status', 'DONE');
  await steps.getByRole('button').nth(5).click();
  const evidence = page.getByRole('region', { name: '증적' });
  await expect(evidence).toContainText('KILL_SWITCH');
  await expect(evidence).toContainText('MITIGATED');
  await expect(evidence).toContainText(/FB-\d{5}/);

  // 42 컴포넌트 화면 — ⑥ 단계 필터에서 긴급 차단 컴포넌트는 또렷하다
  await page.goto('/arch/components?step=6');
  await expect(page.getByRole('button', { name: /D03-03 긴급 기능 차단 구현/ })).toHaveAttribute('data-dim', 'false');
  await expect(page.getByRole('button', { name: /D05-04 과금 시스템 연계 계획/ })).toHaveAttribute('data-dim', 'true');

  // OF-3 — PoC 차단을 정리하고, 구독 권한이 있는 KMH-NX4-0001을 따로 차단해 웹 SDK 값 변화를 본다
  // (ego-01 체험권은 앞선 e2e가 이미 썼을 수 있어 해제 후에도 OFF일 수 있다)
  const H = { 'X-Actor-Id': 'e2e.ops', 'X-Actor-Role': 'OPERATOR' };
  const release = async () => {
    for (const k of (await (await request.get(`${API}/api/kill-requests?status=ACTIVE`)).json()).items) {
      const r = await request.post(`${API}/api/kill-requests/${k.killId}/release`, { headers: H, data: { reason: 'e2e 복구' } });
      expect(r.status(), await r.text()).toBe(200);
    }
  };
  await release();
  const k = await request.post(`${API}/api/kill-requests`, { headers: H, data: { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['KMH-NX4-0001'], safeMode: 'SAFE_DEFAULT', reason: 'OF-3 확인', confirm: 'FEAT-00022' } });
  expect(k.status(), await k.text()).toBe(201);
  await page.goto('/activation/decide?vin=KMH-NX4-0001&flagKey=care_00022_param');
  const of = page.getByRole('region', { name: 'OpenFeature 클라이언트 (웹 SDK · OFREP)' });
  await expect(of.getByTestId('of-value')).toHaveText('OFF', { timeout: 15_000 });
  await expect(of).toContainText('DISABLED');
  await release();
  await expect(of.getByTestId('of-value')).toHaveText('ON', { timeout: 15_000 });
  await expect(of).toContainText('설정 변경 감지');
});

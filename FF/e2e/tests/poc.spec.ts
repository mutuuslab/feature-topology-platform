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

test('PoC: 새 실행 → 끝까지 실행 → ①~⑥ 완료(배포 PARTIAL·차단 CONFIRMED) → OpenFeature 경계(F3 DISABLED) → IVI flag ON → 차단하면 OFF', async ({ page, request }) => {
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
  await expect(page.getByRole('button', { name: /D06-11 보안 취약점 모니터링 계획/ })).toHaveAttribute('data-dim', 'true');

  // PoC 차단을 정리하고 OpenFeature 경계·OF-3을 본다 (KMH-NX4-0001)
  // 긴급 차단 v2 — 요청 1 + 서로 다른 2인 승인, 복원은 차단 승인자와 다른 2인(FFG-PLT-005·DEAC-008)
  const H = { 'X-Actor-Id': 'e2e.ops', 'X-Actor-Role': 'OPERATOR' };
  const as = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
  const post = async (path: string, headers: Record<string, string>, data: unknown) => {
    const r = await request.post(`${API}${path}`, { headers, data });
    expect(r.status(), await r.text()).toBe(201);
    return r.json();
  };
  const release = async () => {
    for (const k of (await (await request.get(`${API}/api/kill-requests?status=ACTIVE`)).json()).items) {
      if (k.restoreRequest?.status !== 'REQUESTED') await post(`/api/kill-requests/${k.killId}/restore`, H, { reason: 'e2e 복구' });
      await post(`/api/kill-requests/${k.killId}/restore/approvals`, as('e2e.safety2', 'SAFETY_OFFICER'), {});
      const done = await post(`/api/kill-requests/${k.killId}/restore/approvals`, as('e2e.csm', 'SECURITY_OFFICER'), {});
      expect(done.status).toBe('RELEASED');
    }
  };
  await release();
  // OpenFeature 경계(FFG-OFT-001) — 차량 제어 flag(F3)는 웹 SDK가 값을 받지 않는다: DISABLED + 경계 안내
  await page.goto('/activation/decide?vin=KMH-NX4-0001&flagKey=care_00022_param');
  const of = page.getByRole('region', { name: 'OpenFeature 클라이언트 (웹 SDK · OFREP)' });
  await expect(of.getByTestId('of-guarded')).toBeVisible({ timeout: 15_000 });
  await expect(of.getByTestId('of-value')).toHaveText('OFF');
  // OF-3 — IVI 앱 flag(F1)는 SDK가 ON을 받고, 차단하면 ETag 폴링으로 설정 변경을 감지해 OFF(DISABLED)
  await page.goto('/activation/decide?vin=KMH-NX4-0001&flagKey=ivi_00024_guide');
  await expect(of.getByTestId('of-value')).toHaveText('ON', { timeout: 15_000 });
  await expect(of).toContainText('TARGETING_MATCH');
  const k = await post('/api/kill-requests', H, {
    featureId: 'FEAT-00024',
    featureVersion: '1.0.0',
    vins: ['KMH-NX4-0001'],
    reasonCategory: 'OPERATIONAL',
    reasonCode: 'OF3_CHECK',
    reason: 'OF-3 확인',
    confirm: 'FEAT-00024',
  });
  await post(`/api/kill-requests/${k.killId}/approvals`, as('e2e.safety', 'SAFETY_OFFICER'), {});
  expect((await post(`/api/kill-requests/${k.killId}/approvals`, as('e2e.lead', 'OPS_LEAD'), {})).status).toBe('ACTIVE');
  await expect(of.getByTestId('of-value')).toHaveText('OFF', { timeout: 15_000 });
  await expect(of).toContainText('DISABLED');
  await expect(of).toContainText('설정 변경 감지');
  // 이 차단은 해제하지 않는다 — FEAT-00024 안전 분류에 SBOM 참조가 없어 복원은 정책 게이트(FFG-PLT-010)가 막는다(마지막 시험)
});

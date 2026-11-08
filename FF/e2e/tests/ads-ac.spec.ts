// AC — 승인 조합 제안→승인(작성자 ≠ 승인자)·보안 최소 버전 표·권한 범위. 실제 백엔드(메모리 DB·v0.81 + data/fixtures/ads 시드).
// 시드 조합 상태는 바꾸지 않는다(다른 시험이 같은 서버를 쓴다) — 승인 흐름은 새로 제안한 조합으로만.
import { expect, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const hdr = (who: string, role: string) => ({ 'X-Actor-Id': `usr-${who}`, 'X-Actor-Role': role, 'Idempotency-Key': crypto.randomUUID() });

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('구성: 승인 조합 — 승인 대기 조합은 따로 세고, 보안 최소 버전 표 탭은 지금 하한과 승인 대기를 보인다', async ({ page }) => {
  await page.goto('/config/compat');
  await asRole(page, 'quality');
  await page.reload();
  await expect(page.locator('#main')).toContainText('승인 대기 조합 1개 — 승인 전에는 차량 대조·발행에 쓰지 않습니다');
  await expect(page.getByRole('button', { name: '조합 승인' })).toBeVisible();
  await page.getByRole('tab', { name: /보안 최소 버전 표/ }).click();
  await expect(page.getByRole('table', { name: 'SW별 지금 하한' })).toContainText('SW-CAMERA-FW');
  await expect(page.locator('#main')).toContainText('승인 대기 1건');
  await expect(page.locator('#main')).not.toContainText('usr-');
});

test('구성: 조합 제안 → 제안자 본인 승인 거부, 다른 기능안전 담당 승인', async ({ request }) => {
  const body = { featureId: 'FEAT-00022', featureVersion: '1.0.0', hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }], ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.2.9' }], reason: 'e2e 제안' };
  const created = await request.post(`${API}/api/config-sets`, { headers: hdr('steward', 'VARIANT_OWNER'), data: body });
  expect(created.status()).toBe(201);
  const set = await created.json();
  expect(set.status).toBe('PROPOSED');
  const self = await request.post(`${API}/api/config-sets/${set.setId}/approve`, { headers: hdr('steward', 'SAFETY_OFFICER'), data: { reason: '자기 승인' } });
  expect(self.status()).toBe(403);
  const ok = await request.post(`${API}/api/config-sets/${set.setId}/approve`, { headers: hdr('quality', 'SAFETY_OFFICER'), data: { reason: '독립 승인' } });
  expect(ok.status()).toBe(201);
  expect((await ok.json()).status).toBe('APPROVED');
});

test('권한: 범위 밖 시장의 긴급 차단 요청은 거부, 권한 화면에 계정별 범위', async ({ page, request }) => {
  const r = await request.post(`${API}/api/kill-requests`, { headers: hdr('operator', 'OPERATOR'), data: { featureId: 'FEAT-00014', featureVersion: '1.0.0', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: 'e2e 범위', containmentJustification: '봉쇄', confirm: 'FEAT-00014' } });
  expect(r.status()).toBe(403);
  expect((await r.json()).error.details.code).toBe('SCOPE_DENIED');
  await page.goto('/admin/iam');
  await expect(page.getByRole('table', { name: '권한 범위' })).toContainText('KR, EU, US, CA, AU, ME');
  await expect(page.getByRole('table', { name: '권한 범위' })).not.toContainText('usr-');
});

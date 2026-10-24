// 운영 빌드 SSO — 회사 계정 버튼 → 시험 IdP → 대시보드(사용자 이름), 역할 선택기는 부여 역할만, 승인(개인 서명), 로그아웃, 헤더 위조 401.
// 출시 준비 RD-SEC-01·02·03(백엔드 oidc.spec·tools/prod-bundle.test가 표식을 가진다). playwright.oidc.config.ts가 서버 셋을 띄운다.
import { expect, request as pwRequest, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_OIDC_API_PORT ?? 9611}`;
const IDP = `http://127.0.0.1:${process.env.E2E_OIDC_IDP_PORT ?? 9613}`;

async function ssoLogin(page: Page, user: string, path = '/') {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('[data-demo-login]')).toHaveCount(0);
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await page.getByRole('button', { name: '회사 계정(SSO)으로 로그인' }).click();
  // 시험 IdP의 사용자 고르기(실제 IdP 로그인 화면 자리)
  await page.locator(`a[data-user="${user}"]`).click();
}

test('SSO 로그인 → 대시보드에 사용자 이름, 역할 선택기는 부여 역할과 겹치는 화면 역할만', async ({ page }) => {
  await ssoLogin(page, 'quality');
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.locator('[data-sso-name]')).toHaveText('정품질');
  const options = page.getByRole('combobox', { name: '역할' }).locator('option');
  // quality(GATE_JUDGE·SAFETY_OFFICER)와 integrator(SAFETY_OFFICER 포함)만 — 운영자·작성자 등 다른 화면 역할은 없다
  await expect(options).toHaveCount(2);
  expect(await options.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['quality', 'integrator']);
  // 신원은 세션 쿠키가 정한다(브라우저 저장소에 로그인 표식 없음)
  expect(await page.evaluate(() => localStorage.getItem('ff.auth'))).toBeNull();
  const me = await page.request.get('/api/auth/me');
  expect((await me.json()).user).toMatchObject({ id: 'e2e-quality', roles: ['SAFETY_OFFICER', 'GATE_JUDGE'] });
});

test('로그인하지 않은 채 연 화면은 로그인 뒤 그 화면으로 돌아온다', async ({ page }) => {
  await ssoLogin(page, 'author', '/features');
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator('[data-sso-name]')).toHaveText('김작성');
});

test('승인 — SSO 세션의 개인 서명으로 긴급 차단 승인 칸을 채운다', async ({ page }) => {
  // 요청은 API 클라이언트(운영자 Bearer 토큰)로 준비한다
  const token = (await (await fetch(`${IDP}/test/token?user=ops`)).json()).access_token as string;
  const api = await pwRequest.newContext();
  const created = await api.post(`${API}/api/kill-requests`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['lead-01'], reason: 'e2e SSO 승인', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' },
  });
  expect(created.status()).toBe(201);
  const killId = (await created.json()).killId as string;
  await api.dispose();

  await ssoLogin(page, 'quality', `/ops/kill?id=${killId}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText(killId);
  await drawer.getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(drawer.locator('.ds-approvals__slot[data-done]')).toHaveCount(1);
  const k = await (await page.request.get(`/api/kill-requests/${killId}`)).json();
  expect(k.approvals.map((a: { approverId: string }) => a.approverId)).toEqual(['e2e-quality']);
});

test('로그아웃 — 서버 세션이 지워지고 로그인 화면으로', async ({ page }) => {
  await ssoLogin(page, 'quality');
  await expect(page.locator('[data-sso-name]')).toHaveText('정품질');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '회사 계정(SSO)으로 로그인' })).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).authenticated).toBe(false);
  expect((await page.request.get('/api/features')).status()).toBe(401);
});

test('헤더로 신원·역할을 주장한 직접 API 호출은 401', async () => {
  const api = await pwRequest.newContext();
  const r = await api.get(`${API}/api/audit`, { headers: { 'X-Actor-Id': 'usr-csm', 'X-Actor-Role': 'SECURITY_OFFICER' } });
  expect(r.status()).toBe(401);
  const w = await api.post(`${API}/api/notifications/read-all`, { headers: { 'X-Actor-Id': 'usr-csm', 'X-Actor-Role': 'SECURITY_OFFICER', 'Content-Type': 'application/json' }, data: {} });
  expect(w.status()).toBe(401);
  expect((await api.get(`${API}/api/health/live`)).status()).toBe(200);
  await api.dispose();
});

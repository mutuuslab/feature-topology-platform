// GitLab · JIRA · codeBeamer 양방향 연계 — 실제 백엔드(모의 외부 시스템)와 화면으로 끝까지.
//   ① Feature 상세 "연계" 탭: codeBeamer 요구·JIRA Epic·GitLab MR이 새 탭 링크로 보인다
//   ② JIRA에서 권한 없는 사람이 Epic을 승인 상태로 바꾸면 플랫폼이 거부하고 되돌린다 → 외부 연계 "받은 변경"에 거부·되돌림
//   ③ 변경요청 화면: JIRA CR과 플랫폼 정책 상태가 나란히, 핵심 메시지는 하나
//   ④ JIRA에서 Epic을 만들면 PROPOSED Feature 자동 등록 → Registry 목록에 Lifecycle과 JIRA Epic이 나란히(사용자 결정 2026-10-23)
import { expect, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

async function asRole(page: Page, role: string) {
  await page.goto('/');
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

test('Feature 상세 연계 탭 — 요구·Epic·MR이 외부 도구 링크로', async ({ page }) => {
  await asRole(page, 'viewer');
  await page.goto('/features/FEAT-00001/2.1.0?tab=ext');
  const tab = page.getByTestId('ext-links');
  await expect(tab).toBeVisible();
  const req = tab.locator('.ds-ext[data-system="CODEBEAMER"] a').first();
  await expect(req).toHaveAttribute('href', /\/cb\/issue\/\d+$/);
  await expect(req).toHaveAttribute('target', '_blank');
  await expect(tab.locator('.ds-ext[data-system="JIRA"] a').first()).toHaveAttribute('href', /\/browse\/FFE-\d+$/);
  await expect(tab.locator('.ds-ext[data-system="GITLAB"] a').first()).toHaveAttribute('href', /\/-\/merge_requests\/\d+$/);
  // 머리 메타에도 Epic
  await expect(page.locator('.ds-page-header .ds-ext[data-system="JIRA"], header .ds-ext[data-system="JIRA"]').first()).toBeVisible();
});

test('JIRA에서 권한 없는 Epic 승인 → 플랫폼이 거부·되돌림, 외부 연계 화면 받은 변경에 기록', async ({ page, request }) => {
  const t = await (await request.get(`${API}/api/integrations/sync/features/FEAT-00013/0.3.0`)).json();
  const act = await request.post(`${API}/api/integrations/mock/jira/act`, { headers: { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' }, data: { key: t.epic.key, action: 'TRANSITION', status: 'Approved', externalUser: 'kim.author' } });
  expect(act.status(), await act.text()).toBe(200);
  expect((await act.json()).result.outcome).toBe('REJECTED');
  await asRole(page, 'integrator');
  await page.goto('/integration/connectors?tab=sync');
  const inbox = page.getByRole('table', { name: '받은 변경 (최근)' });
  const row = inbox.locator('tr', { hasText: t.epic.key }).first();
  await expect(row).toContainText('거부·되돌림');
  await expect(page.getByRole('table', { name: /누가 주인인가/ })).toContainText('Feature Lifecycle');
  const epic = (await (await request.get(`${API}/api/integrations/mock/jira/items`)).json()).items.find((x: { key: string }) => x.key === t.epic.key);
  expect(epic.status).toBe('Proposed');
});

test('변경요청 화면 — JIRA CR과 정책 상태, 핵심 메시지 하나', async ({ page }) => {
  await asRole(page, 'viewer');
  await page.goto('/change/cr');
  await expect(page.locator('[data-key-message]')).toHaveCount(1);
  const table = page.getByRole('table', { name: 'JIRA 변경요청' });
  await expect(table.locator('a[href^="/policies/POL-"]').first()).toBeVisible();
  await expect(table.locator('.ds-ext[data-system="JIRA"] a').first()).toHaveAttribute('href', /\/browse\/FFCR-\d+$/);
});

test('JIRA에서 Epic 만들기 → PROPOSED Feature 자동 등록, Registry에 Lifecycle과 Epic이 나란히', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/integration/connectors?tab=sync');
  await page.locator('#sync-simulate > summary').click();
  const form = page.locator('section[aria-labelledby="sync-epic-new"]');
  const title = `야간 차선 유지 확장 ${Date.now() % 100000}`;
  await form.getByLabel('Epic 제목 (= Feature 이름)').fill(title);
  await form.getByLabel('담당 조직').fill('주행보조개발팀');
  await form.getByRole('button', { name: 'Epic 만들기' }).click();
  await expect(page.getByTestId('epic-create-result')).toContainText(/FEAT-\d{5}@[\d.]+ 자동 등록/);
  await page.goto(`/features?q=${encodeURIComponent(title)}`);
  const row = page.locator('tbody tr', { hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.ds-badge[data-lifecycle="PROPOSED"]')).toBeVisible();
  await expect(row.locator('.ds-ext[data-system="JIRA"] a')).toHaveAttribute('href', /\/browse\/FFE-\d+$/);
  await expect(row.locator('.ds-ext__status')).toHaveText('Proposed');
});

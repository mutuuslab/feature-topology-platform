// 구매 산정 담당자 흐름 — 실제 등록 Feature 담기·검토·제출·다른 사람 승인·결과 고정·역할별 금액·엑셀 다운로드.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ actionTimeout: 10_000 });
const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const headers = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const EST = headers('usr-viewer', 'COST_ESTIMATOR');

async function asRole(page: Page, role: string, path: string) {
  await page.evaluate((next) => {
    const current = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    localStorage.setItem('fp.state.v2', JSON.stringify({ ...current, role: next, department: 'ALL' }));
  }, role);
  await page.goto(path);
}

test('산정 작성자 → 승인자 → 열람 — Feature 담기·검토·금액 마스킹·고정 결과·엑셀 내보내기', async ({ page, request }) => {
  const suffix = Math.random().toString(36).slice(2, 9);
  const registered = await request.post(`${API}/api/features`, {
    headers: headers('usr-author', 'FEATURE_AUTHOR'),
    data: { name: `E2E 산정 기능 ${suffix}`, description: '구매 담당자 흐름 검증', country: 'KR', vehicleModel: `E2E-COST-${suffix}`, trim: 'Premium', ownerId: 'usr-author', asil: 'QM', featureRefs: [{ refId: 'BC-BCM-001', role: 'PRIMARY' }] },
  });
  expect(registered.status()).toBe(201);
  const featureId: string = (await registered.json()).featureId;
  await page.goto('/_design');
  await asRole(page, 'viewer', '/procurement/sw-cost');
  await page.getByRole('button', { name: '새 과제', exact: true }).click();
  const create = page.getByRole('dialog');
  const name = `E2E 구매 산정 ${suffix}`;
  await create.getByLabel('과제 이름', { exact: true }).fill(name);
  await create.getByLabel(/^대상 제어기·차종/).fill('NX4 PE / BCM');
  await create.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/procurement\/sw-cost\/EST-\d+/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const path = `/procurement/sw-cost/${id}`;

  await page.getByRole('tab', { name: /^기능 목록/ }).click();
  await page.getByRole('button', { name: 'Feature 담기', exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.getByLabel(/^Feature 이름·ID/).fill(featureId);
  const candidate = picker.locator('li').filter({ hasText: featureId });
  await expect(candidate.getByRole('button', { name: '담기', exact: true })).toBeEnabled();
  await candidate.getByRole('button', { name: '담기', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const draft = await request.get(`${API}/api/cost/projects/${id}`, { headers: EST });
  expect(draft.status()).toBe(200);
  expect((await draft.json()).features).toEqual([expect.objectContaining({ featureId })]);

  await page.getByRole('tab', { name: /^검토/ }).click();
  await page.getByRole('combobox', { name: '상태 1', exact: true }).selectOption('확인');
  await expect.poll(async () => {
    const response = await request.get(`${API}/api/cost/projects/${id}`, { headers: EST });
    return (await response.json()).checks.items[0].status;
  }).toBe('확인');
  await page.getByRole('button', { name: '승인 요청', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^사유/).fill('근거와 검토 체크리스트 확인');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const samePerson = await request.post(`${API}/api/cost/projects/${id}/transitions`, { headers: headers('usr-viewer', 'COST_APPROVER'), data: { action: 'APPROVE', reason: '자기 승인 시도' } });
  expect(samePerson.status()).toBe(403);
  expect((await samePerson.json()).error.code).toBe('SEPARATION_OF_DUTY');

  await asRole(page, 'approver', path);
  await page.getByRole('button', { name: '승인', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^사유/).fill('구매 검토 완료 — 다른 담당자 승인');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('승인된 결과는 고정되어 있습니다. 바꾸려면 개정합니다.')).toBeVisible();
  const approvedResponse = await request.get(`${API}/api/cost/projects/${id}`, { headers: headers('cost.reader', 'COST_VIEWER') });
  const approved = await approvedResponse.json();
  expect(approvedResponse.status()).toBe(200);
  expect(approved.project.status).toBe('APPROVED');
  expect(approved.result.totals.totalCost).toBeGreaterThan(0);
  expect(approved.approvals).toHaveLength(1);
  expect((await request.patch(`${API}/api/cost/projects/${id}`, { headers: EST, data: { name: '승인 결과 수정 시도' } })).status()).toBe(409);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '엑셀 내보내기', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const downloaded = await download.path();
  expect(downloaded).toBeTruthy();
  expect(readFileSync(downloaded!).subarray(0, 2).toString()).toBe('PK');

  await asRole(page, 'viewer', path);
  await expect(page.getByText('승인된 결과는 고정되어 있습니다. 바꾸려면 개정합니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '엑셀 내보내기', exact: true })).toBeEnabled();
  await asRole(page, 'author', path);
  await expect(page.getByText('이 역할은 공수만 봅니다. 금액·단가는 구매 담당 역할에게만 보입니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '엑셀 내보내기', exact: true })).toBeDisabled();
  const maskedResponse = await request.get(`${API}/api/cost/projects/${id}`, { headers: headers('usr-author', 'FEATURE_AUTHOR') });
  const masked = await maskedResponse.json();
  expect(masked.view).toBe('MM_ONLY');
  expect(masked.result.totals.totalMm).toBe(approved.result.totals.totalMm);
  for (const field of ['totalCost', 'laborKrw', 'benchEur', 'blendedRate', 'unitPrice']) expect(JSON.stringify(masked)).not.toContain(`"${field}"`);
});

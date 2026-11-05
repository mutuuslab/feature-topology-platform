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

test('교정 담당자 — 승인 후 실적·전체 과제 오차·제안 초안과 발행·승인 결과 고정', async ({ page, request }) => {
  const suffix = Math.random().toString(36).slice(2, 9);
  const approve = async (index: number, actual: number) => {
    const created = await request.post(`${API}/api/features`, { headers: headers('usr-author', 'FEATURE_AUTHOR'), data: { name: `교정 기능 ${suffix}-${index}`, description: '실적 교정 시나리오', country: 'KR', vehicleModel: `C4-${suffix}-${index}`, trim: 'Premium', ownerId: 'usr-author', asil: 'QM', featureRefs: [{ refId: 'BC-BCM-001', role: 'PRIMARY' }] } });
    expect(created.status()).toBe(201);
    const feature = await created.json();
    const project = await request.post(`${API}/api/cost/projects`, { headers: EST, data: { name: `C4 과제 ${suffix}-${index}` } });
    expect(project.status()).toBe(201);
    const id: string = (await project.json()).estId;
    const added = await request.post(`${API}/api/cost/projects/${id}/features`, { headers: EST, data: { featureId: feature.featureId, version: feature.version } });
    expect(added.status()).toBe(201);
    const lineNo = (await added.json()).lines[0].lineNo;
    expect((await request.patch(`${API}/api/cost/projects/${id}/lines/${lineNo}`, { headers: EST, data: { actual } })).status()).toBe(200);
    expect((await request.post(`${API}/api/cost/projects/${id}/transitions`, { headers: EST, data: { action: 'SUBMIT', reason: '교정 검토 요청' } })).status()).toBe(201);
    expect((await request.post(`${API}/api/cost/projects/${id}/transitions`, { headers: headers('usr-approver', 'COST_APPROVER'), data: { action: 'APPROVE', reason: '교정 검토 승인' } })).status()).toBe(201);
    return { id, approved: await (await request.get(`${API}/api/cost/projects/${id}`, { headers: EST })).json() };
  };
  const first = await approve(1, 2);
  const second = await approve(2, 4);
  const path = `/procurement/sw-cost/${first.id}?tab=lines`;
  await page.goto('/_design');
  await asRole(page, 'viewer', path);
  const row = page.getByRole('row').filter({ hasText: 'BC-BCM-001' });
  await row.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByLabel(/^실적 공수/).fill('6');
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await (await request.get(`${API}/api/cost/projects/${first.id}`, { headers: EST })).json();
  expect(after.actuals).toEqual([{ refId: 'BC-BCM-001', actual: 6, override: true }]);
  expect(after.result).toEqual(first.approved.result);
  expect(after.approvals).toEqual(first.approved.approvals);

  await asRole(page, 'approver', '/procurement/sw-cost/basis');
  await expect(page.getByRole('heading', { name: '컴포넌트별 오차', exact: true })).toBeVisible();
  const actualTable = page.getByRole('table', { name: '기준 행별 실적', exact: true });
  await expect(actualTable.getByText(first.id, { exact: true })).toBeVisible();
  await expect(actualTable.getByText(second.id, { exact: true })).toBeVisible();
  const calibration = await (await request.get(`${API}/api/cost/calibration`, { headers: headers('usr-approver', 'COST_BASIS_ADMIN') })).json();
  await page.getByRole('button', { name: '제안값으로 초안', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const proposed = Math.round(calibration.suggestion * 10) / 10;
  await expect(dialog.getByLabel(/^포인트당 벤치마크/)).toHaveValue(String(proposed));
  const version = `e2e-c4-${suffix}`;
  await dialog.getByLabel('버전 이름', { exact: true }).fill(version);
  await dialog.getByLabel('바꾼 이유', { exact: true }).fill('교정 제안 검토');
  await dialog.getByRole('button', { name: '초안 만들기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const beforePublish = await (await request.get(`${API}/api/cost/calibration`, { headers: headers('usr-approver', 'COST_BASIS_ADMIN') })).json();
  expect(beforePublish.anchorEur).toBe(calibration.anchorEur);
  await page.getByRole('row').filter({ hasText: version }).getByRole('button', { name: '발행', exact: true }).click();
  await page.getByRole('dialog').getByLabel('발행 사유', { exact: true }).fill('교정 검토 완료');
  await page.getByRole('dialog').getByRole('button', { name: '발행', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const published = await (await request.get(`${API}/api/cost/calibration`, { headers: headers('usr-approver', 'COST_BASIS_ADMIN') })).json();
  expect(published.anchorEur).toBe(proposed);
  await page.getByRole('heading', { name: /^포인트당 € 교정 제안/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('calibration.png'), fullPage: true });

  await asRole(page, 'author', path);
  await expect(page.getByText('이 역할은 공수만 봅니다. 금액·단가는 구매 담당 역할에게만 보입니다.')).toBeVisible();
  const masked = await (await request.get(`${API}/api/cost/projects/${first.id}`, { headers: headers('usr-author', 'FEATURE_AUTHOR') })).json();
  expect(masked.mre.rows[0].actual).toBe(6);
  for (const field of ['anchorEur', 'totalCost', 'laborKrw', 'benchEur', 'unitPrice']) expect(JSON.stringify(masked)).not.toContain(`"${field}"`);
  expect((await request.get(`${API}/api/cost/calibration`, { headers: headers('usr-author', 'FEATURE_AUTHOR') })).status()).toBe(403);
  await asRole(page, 'viewer', path);
  await page.getByRole('button', { name: 'BC-BCM-001 실적 공수', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '승인 후 기록 지우기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const cleared = await (await request.get(`${API}/api/cost/projects/${first.id}`, { headers: EST })).json();
  expect(cleared.actuals).toEqual([{ refId: 'BC-BCM-001', actual: 2, override: false }]);
  expect(cleared.result).toEqual(first.approved.result);
});

// readiness: RD-FN-02 — 정책 상세에서 배포 이력을 보고 예전 버전으로 되돌린다: 요청(차량 운영) → 지정 승인대상자 승인(품질 검토) → 실행(재검증·재배포)
// → 지금 배포가 예전 버전으로 바뀐다. 테스트마다 자기 Feature를 새로 만들어 병렬 실행에서도 서로 간섭하지 않는다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function post(request: APIRequestContext, path: string, role: [string, string], data: unknown, code = 201) {
  const r = await request.post(`${API}${path}`, { headers: H(...role), data });
  expect(r.status(), await r.text()).toBe(code);
  return r.json();
}

/** 정책을 붙일 수 있는 Feature — 등록·구현 연결·G1~G7 PASS·정의 승인(→ DEVELOPING). policy.spec.ts와 같은 준비 */
async function developingFeature(request: APIRequestContext) {
  const author: [string, string] = ['usr-author', 'FEATURE_AUTHOR'];
  const judge: [string, string] = ['usr-quality', 'GATE_JUDGE'];
  const f = await post(request, '/api/features', author, { name: `E2E 되돌리기 ${Date.now() % 100000}`, description: 'RD-FN-02 e2e', requirementIds: ['REQ-E2E-RB'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] });
  const base = `/api/features/${f.featureId}/versions/0.1.0`;
  const p = await request.patch(`${API}${base}`, { headers: H(...author), data: { functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] } });
  expect(p.status(), await p.text()).toBe(200);
  await post(request, `${base}/safety/confirm`, ['usr-safety', 'SAFETY_OFFICER'], { reason: 'HARA 검토 완료' });
  for (const g of ['G1', 'G2', 'G3']) await post(request, `${base}/gates`, judge, { gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` });
  await post(request, `${base}/transitions`, ['usr-approver', 'FEATURE_APPROVER'], { to: 'APPROVED', reason: '승인' }, 200);
  for (const g of ['G4', 'G5', 'G6', 'G7']) await post(request, `${base}/gates`, judge, { gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` });
  return f.featureId as string;
}

/** 작성 → 검증 GO → 승인 → 배포, 배포 게시본이 차량 확인까지 닫힐 때까지 기다린다 */
async function deploy(request: APIRequestContext, featureId: string, flagKey: string, description: string) {
  const p = await post(request, '/api/policies', ['usr-author', 'FEATURE_AUTHOR'], { featureId, featureVersion: '0.1.0', controlPoint: 'Flag', flagKey, description, safeDefault: false });
  const v = await post(request, `/api/policies/${p.policyId}/validate`, ['usr-author', 'FEATURE_AUTHOR'], {}, 200);
  expect(v.run.decision).toBe('GO');
  await post(request, `/api/policies/${p.policyId}/decision`, ['usr-approver', 'FEATURE_APPROVER'], { decision: 'APPROVE', reason: 'GO 확인' }, 200);
  const d = await post(request, `/api/policies/${p.policyId}/deploy`, ['usr-coordinator', 'RELEASE_MANAGER'], { reason: `${description} 배포` }, 200);
  await expect
    .poll(async () => (await (await request.get(`${API}/api/publications/${d.publicationId}`)).json()).publication.status, { timeout: 40_000 })
    .toMatch(/CONFIRMED|PARTIAL/);
  return { policyId: p.policyId as string, publicationId: d.publicationId as string };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('정책 상세: 배포 이력 → 예전 버전으로 되돌리기 요청 → 지정 승인대상자 승인 → 실행 → 지금 배포가 예전 버전', async ({ page, request }) => {
  test.setTimeout(150_000);
  const fid = await developingFeature(request);
  const flagKey = `care_${fid.slice(5)}_rb`;
  const p1 = await deploy(request, fid, flagKey, '되돌리기 기준 버전');
  const p2 = await deploy(request, fid, flagKey, '문제가 생긴 새 버전');

  // 이력 — 지금 배포는 P2, 배포한 버전 두 개, P1은 되돌릴 수 있음
  await asRole(page, 'operator');
  await page.goto(`/policies/${p2.policyId}`);
  const panel = page.getByRole('region', { name: '배포 이력·되돌리기' });
  await expect(panel.getByTestId('policy-current-deployment')).toHaveText(new RegExp(`${p2.policyId} r1 · 배포 ID ${p2.publicationId}`));
  const deps = panel.getByRole('table', { name: '배포한 버전' });
  await expect(deps.getByText(`${p2.publicationId} · 지금`)).toBeVisible();
  await expect(deps.getByText(p1.publicationId, { exact: true })).toBeVisible();

  // 요청 — 차량 운영(OPERATOR). 승인대상자는 기본값(요청자 아님)
  const row = panel.getByRole('table', { name: '되돌릴 수 있는 버전' }).getByRole('row', { name: new RegExp(p1.policyId) });
  await row.getByRole('button', { name: '이 버전으로 되돌리기' }).click();
  const dlg = page.getByRole('dialog', { name: `${p1.policyId} r1로 되돌리기` });
  await dlg.getByRole('textbox').fill('새 버전에서 문제 확인 — 기준 버전으로 되돌림');
  const approver = await dlg.getByRole('combobox').inputValue();
  await dlg.getByRole('button', { name: '되돌리기 요청' }).click();
  await expect(dlg.getByText(/을\(를\) 만들었습니다/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('rollback-pending')).toBeVisible();
  // 진행 중 요청이 있으면 새 요청은 막힌다(서버도 409)
  await expect(row.getByRole('button', { name: '이 버전으로 되돌리기' })).toBeDisabled();

  // 승인 — 지정된 승인대상자(기본값 usr-quality = 품질 검토, Safety Manager)
  expect(approver).toBe('usr-quality');
  await asRole(page, 'quality');
  await page.reload();
  const item = page.getByRole('region', { name: '배포 이력·되돌리기' }).getByTestId('rollback-pending');
  await item.getByLabel('승인 의견').fill('기준 버전 복구 동의');
  await item.getByRole('button', { name: '승인' }).click();

  // 실행 — 요청 권한(차량 운영). 재검증 뒤 기준 버전을 새 서명 게시본으로 다시 배포
  await asRole(page, 'operator');
  await page.reload();
  await page.getByRole('region', { name: '배포 이력·되돌리기' }).getByTestId('rollback-pending').getByRole('button', { name: '실행' }).click();
  await expect(page.getByRole('region', { name: '배포 이력·되돌리기' }).getByTestId('policy-current-deployment')).toHaveText(new RegExp(`지금 배포: ${p1.policyId} r1`), { timeout: 20_000 });
  await expect(page.getByRole('region', { name: '배포 이력·되돌리기' }).getByText('진행 중인 되돌리기 요청이 없습니다.')).toBeVisible();

  // 감사 — 요청·승인·실행이 남는다
  const audit = await (await request.get(`${API}/api/audit?limit=1000`)).json();
  const actions = new Set(audit.items.map((a: { action: string }) => a.action));
  for (const a of ['ROLLBACK_REQUEST', 'ROLLBACK_REQUEST_DECIDE', 'ROLLBACK_EXECUTE']) expect(actions).toContain(a);
});

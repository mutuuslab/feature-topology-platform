// 거버넌스 끝단 흐름 — 실제 백엔드(메모리 DB·v0.81)와 v2 화면으로 상세설계서 업무 순서를 끝까지 밟는다.
// 테스트마다 자기 Feature·상품을 새로 만들어 병렬 실행에서도 서로 간섭하지 않는다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function newFeature(request: APIRequestContext, name: string, extra: Record<string, unknown> = {}) {
  const r = await request.post(`${API}/api/features`, {
    headers: H('usr-author', 'FEATURE_AUTHOR'),
    data: { name, description: `${name} e2e`, requirementIds: ['REQ-E2E-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'], ...extra },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { featureId: string; version: string };
}

async function judgeApi(request: APIRequestContext, id: string, ver: string, gates: string[]) {
  for (const gate of gates) {
    const r = await request.post(`${API}/api/features/${id}/versions/${ver}/gates`, { headers: H('usr-quality', 'GATE_JUDGE'), data: { gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}` } });
    expect(r.status(), await r.text()).toBe(201);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('Registry: Gate 판정(품질) → 정의 승인(승인자) → 자동 DEVELOPING, 감사 이력', async ({ page, request }) => {
  const f = await newFeature(request, `E2E 레지스트리 ${uniq()}`);
  await asRole(page, 'quality');
  await page.goto(`/features/${f.featureId}/0.1.0?tab=gates`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E 레지스트리');
  for (const g of ['G1', 'G2', 'G3']) {
    await page.locator(`.ds-gate[data-gate="${g}"]`).click();
    await page.getByLabel('Evidence Ref').fill(`EV-UI-${g}`);
    await page.locator('#judge-h').locator('xpath=ancestor::section').getByLabel('사유').fill(`${g} UI 판정`);
    await page.getByRole('button', { name: `${g} · Gate 판정 등록` }).click();
    await expect(page.locator(`.ds-gate[data-gate="${g}"]`)).toHaveAttribute('data-status', 'PASS');
  }

  await asRole(page, 'approver');
  await page.goto(`/features/${f.featureId}/0.1.0`);
  await page.getByRole('button', { name: 'APPROVED로 전이' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('사유').fill('정의·요구·사양 확인');
  await dialog.getByRole('button', { name: '실행' }).click();
  await expect(dialog).toHaveCount(0);
  // Control Point가 있으므로 시스템이 DEVELOPING까지 자동 전이
  await expect(page.locator('.ds-step[data-state="current"]')).toHaveAttribute('data-lifecycle', 'DEVELOPING');

  await page.goto(`/features/${f.featureId}/0.1.0?tab=audit`);
  await expect(page.getByText('FEATURE_TRANSITION PROPOSED→APPROVED')).toBeVisible();
  await expect(page.getByText('FEATURE_TRANSITION APPROVED→DEVELOPING')).toBeVisible();
});

test('BOM: 작성자 확정 요청 → BOM 승인자가 체크리스트 확인 후 확정 → BL 발급·해시', async ({ page, request }) => {
  const f = await newFeature(request, `E2E 기준선 ${uniq()}`);
  // 구현 연결(Function→SW→ECU)을 기준정보와 맞게 채운다 (FEAT-00022의 SW 형상 재사용)
  const p = await request.patch(`${API}/api/features/${f.featureId}/versions/0.1.0`, {
    headers: H('usr-author', 'FEATURE_AUTHOR'),
    data: { functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] },
  });
  expect(p.status(), await p.text()).toBe(200);
  await judgeApi(request, f.featureId, '0.1.0', ['G1', 'G2', 'G3']);
  const t = await request.post(`${API}/api/features/${f.featureId}/versions/0.1.0/transitions`, { headers: H('usr-approver', 'FEATURE_APPROVER'), data: { to: 'APPROVED', reason: '승인' } });
  expect(t.status(), await t.text()).toBe(200);

  await asRole(page, 'author');
  await page.goto(`/features/${f.featureId}/0.1.0?tab=baseline`);
  await page.locator('section', { has: page.locator('#bl-check-h') }).getByLabel('사유').fill('개발 착수 기준선');
  await page.getByRole('button', { name: 'Baseline 확정 요청' }).click();
  const pending = page.getByRole('link', { name: /확정 요청 BR-\d{5} 대기 중/ });
  await expect(pending).toBeVisible();

  const href = await pending.getAttribute('href');
  await asRole(page, 'steward');
  await page.goto(href!); // 역할 변경은 앱을 다시 불러와야 반영된다(테스트는 localStorage로 전환)
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.ds-check li[data-state="FAIL"]')).toHaveCount(0);
  await dialog.getByLabel('사유').fill('체크리스트 8항목 충족');
  await dialog.getByRole('button', { name: '확정 승인' }).click();
  await expect(dialog.getByText(/결정자/)).toBeVisible();

  await page.goto(`/features/${f.featureId}/0.1.0?tab=baseline`);
  await expect(page.locator('.ds-kv').getByText(/^sha256:[0-9a-f]{64}$/)).toBeVisible();
  await expect(page.locator('.ds-page').getByText(/^BL-\d{5}$/)).toBeVisible();
});

test('Catalog: 후보 선택 중 실시간 구성 검증(REQUIRES 누락 FAIL → 보완 PASS) → 등록 → 구성 승인', async ({ page }) => {
  await asRole(page, 'commerce');
  await page.goto('/products/new');
  await page.getByRole('checkbox', { name: 'BL-00028' }).check();
  const live = page.locator('section', { has: page.locator('#live-comp-h') });
  await expect(live.getByText('REQUIRES_MISSING')).toBeVisible();
  await page.getByRole('checkbox', { name: 'BL-00163' }).check();
  await expect(live.locator('[data-verdict="PASS"]').first()).toBeVisible();

  const name = `E2E 체험 ${uniq()}`;
  await page.getByLabel('상품명').fill(name);
  await page.getByLabel('설명').fill('전방 안전거리 체험');
  await page.getByLabel('From', { exact: true }).fill('2026-11-01');
  await page.getByLabel('To', { exact: true }).fill('2026-11-30');
  await page.getByLabel('Owner').fill('선행상품기획팀');
  await page.getByRole('button', { name: '새 상품 구성' }).last().click();
  await expect(page).toHaveURL(/\/products\/CAT-\d{5}\/1\.0\.0$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);

  await asRole(page, 'approver');
  await page.reload();
  await page.getByRole('button', { name: /구성 승인/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('사유').fill('구성 확인');
  await dialog.getByRole('button', { name: '실행' }).click();
  await expect(page.locator('.ds-step[data-state="current"]')).toHaveAttribute('data-lifecycle', 'APPROVED');
});

test('사전점검·변경 영향·감사·이벤트 화면이 실제 데이터로 열린다', async ({ page }) => {
  await page.goto('/precheck');
  await expect(page.locator('#rules-h')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(18); // 16 규칙 + DQ 2
  await page.goto('/analysis/impact?feature=FEAT-00145&version=5.4.2&changed=swVersions');
  await expect(page.getByRole('link', { name: /CAT-00019/ })).toBeVisible();
  await expect(page.locator('#rejudge-h')).toBeVisible();
  await page.goto('/audit');
  await expect(page.locator('[data-state="ready"], [data-state="empty"]').first()).toBeVisible();
  await page.goto('/events');
  await expect(page.locator('#live-h')).toBeVisible();
});

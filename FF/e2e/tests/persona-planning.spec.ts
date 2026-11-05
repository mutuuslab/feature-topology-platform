// 담당자 시나리오 W4(2026-11-05) — 상품기획·SW 통합이 막다른 길 없이 끝까지 간다.
//   ① Feature 설계가 등록하고 초안에서 구현 연결(기능·SW·제어기)을 기준정보에서 고른다 → 정의 승인 담당은 구현 미입력 경고를 보고,
//      구현을 넣은 뒤 승인 → DEVELOPING에서 검증 완료를 막는 입력 누락·막다른 길 안내가 없다
//   ② 상품 작성자가 구성(FAIL이면 빠진 Baseline 추가) → 구성 승인 → 구성 승인자는 고객 출시를 미리 막고 이유 →
//      상품 Owner(다른 상품 승인자)가 고객 출시 → 상품 상세에서 체험 제안으로, 범위 안 고객 차량만(시뮬레이터 없음)
// 상품 Owner 계정(productowner)은 화면 계정 표가 갖춰지기 전에도 돌도록 API 헤더로 승인한다.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bodyCodes } from './key-message-rules';
import { recordAnalysisApi } from './analysis';
import { apiRefs, REF } from './refdb';

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

async function post(request: APIRequestContext, path: string, who: [string, string], data: unknown, code = 201) {
  const r = await request.post(`${API}${path}`, { headers: H(...who), data });
  expect(r.status(), await r.text()).toBe(code);
  return r.json();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/_design');
});

test('① 등록 → 초안에서 구현 연결(기준정보에서 고름) → 정의 승인 — 승인 뒤 막다른 길 없음', async ({ page, request }) => {
  const f = await post(request, '/api/features', ['usr-author', 'FEATURE_AUTHOR'], { name: `W4 구현 연결 ${uniq()}`, description: 'W4 e2e', requirementIds: ['REQ-E2E-W4'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'], ...apiRefs(REF.sotif) });
  const url = `/features/${f.featureId}/0.1.0`;

  // 정의 승인 담당 — 구현이 비어 있으면 승인 서랍이 "승인 뒤에는 새 Version으로만"을 미리 알린다(막지는 않는다)
  await asRole(page, 'approver');
  await page.goto(url);
  await page.getByRole('button', { name: 'APPROVED로 전이' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('impl-missing')).toContainText('구현 미입력 — 승인 뒤에는 새 Version으로만 입력할 수 있습니다');
  await expect(drawer.getByTestId('impl-missing')).toContainText('기능(Function) · SW ID · SW Version · 제어기 P/N');
  // 막힌 사유는 한글 칸 이름 — 영문 필드 키 없음
  await expect(page.locator('.ds-stepper')).not.toContainText(/swIds|ecuPnos|requirementIds/);
  await page.keyboard.press('Escape');

  // Feature 설계 — 초안 수정에서 구현 행을 더하고 SW는 기준정보 목록에서 고른다(자유 입력 없음)
  await asRole(page, 'author');
  await page.goto(url);
  await page.getByRole('button', { name: '초안 수정' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByText('정의 승인 필수')).toBeVisible();
  await edit.getByRole('button', { name: '구현 행 추가' }).click();
  await expect(edit.getByRole('button', { name: '저장' })).toBeDisabled();
  await edit.getByLabel('기능 이름').fill('SOTIF 감시 기록');
  await edit.getByLabel('SW·Version (기준정보)').selectOption('SW-CARE-SDIST-APP@1.2.1');
  await expect(edit.getByText('제어기 P/N 99211-NX400')).toBeVisible();
  await edit.getByRole('button', { name: '저장' }).click();
  await expect(edit).toBeHidden();
  const saved = await (await request.get(`${API}/api/features/${f.featureId}/versions/0.1.0`)).json();
  expect(saved.feature).toMatchObject({ swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'], functions: [{ functionId: expect.stringMatching(/^FUNC-\d{6}$/), label: 'SOTIF 감시 기록' }] });

  // G1~G3 PASS(품질 검토·기능안전) → 정의 승인 — 경고 없이 승인, 자동 DEVELOPING
  await post(request, `/api/features/${f.featureId}/versions/0.1.0/safety/confirm`, ['usr-safety', 'SAFETY_OFFICER'], { reason: 'HARA 검토 완료' });
  await recordAnalysisApi(request, f.featureId, '0.1.0'); // G2 PASS 근거 — HARA·TARA
  for (const gate of ['G1', 'G2', 'G3']) await post(request, `/api/features/${f.featureId}/versions/0.1.0/gates`, ['usr-quality', 'GATE_JUDGE'], { gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}` });
  await asRole(page, 'approver');
  await page.goto(url);
  await page.getByRole('button', { name: 'APPROVED로 전이' }).click();
  const approve = page.getByRole('dialog');
  await expect(approve.getByTestId('impl-missing')).toHaveCount(0);
  await approve.getByLabel('사유').fill('정의·요구·구현 연결 확인 — e2e');
  await approve.getByRole('button', { name: '실행' }).click();
  await expect(approve).toBeHidden();
  await expect(page.locator('.ds-step[data-lifecycle="DEVELOPING"]')).toHaveAttribute('data-state', 'current');
  // 검증 완료로 가는 길에 입력 누락이 없다 — 막다른 길 안내도 없다
  await expect(page.locator('.ds-step[data-lifecycle="VERIFIED"]')).not.toContainText('필수 입력 누락');
  await expect(page.getByTestId('impl-dead-end')).toHaveCount(0);
  expect(await bodyCodes(page)).toEqual([]);
});

test('② 상품 구성(빠진 Baseline 추가) → 구성 승인 → 상품 Owner 고객 출시(구성 승인자는 미리 막힘) → 새 상품으로 체험 제안', async ({ page, request }) => {
  const name = `W4 안전거리 패키지 ${uniq()}`;
  await asRole(page, 'commerce');
  await page.goto('/products/new');
  await page.getByRole('checkbox', { name: 'BL-00028' }).check();
  // FEAT-00022는 FEAT-00145가 필요하다 — 실패 문구가 더할 Baseline을 말하고, 등록은 막힌다
  const add = page.getByRole('button', { name: 'BL-00163 추가' });
  await expect(add).toBeVisible();
  await expect(page.getByRole('button', { name: '새 상품 구성' })).toBeDisabled();
  await add.click();
  await expect(page.getByRole('checkbox', { name: 'BL-00163' })).toBeChecked();
  const form = page.locator('form').filter({ has: page.getByLabel('상품명') });
  await form.getByLabel('상품명').fill(name);
  await form.getByLabel('설명').fill('W4 e2e 상품');
  await form.getByLabel('From').fill('2026-01-01');
  await form.getByLabel('To').fill('2027-12-31');
  await form.getByLabel('Owner').fill('선행상품기획팀');
  await expect(page.getByRole('button', { name: '새 상품 구성' })).toBeEnabled();
  await page.getByRole('button', { name: '새 상품 구성' }).click();
  await expect(page).toHaveURL(/\/products\/CAT-\d{5}\/1\.0\.0$/);
  const cat = page.url().split('/').at(-2)!;

  // 구성 승인(상품 승인자) — 단계 이름은 '구성 승인'
  await asRole(page, 'approver');
  await page.reload();
  await expect(page.locator('.ds-step[data-lifecycle="APPROVED"] .ds-step__ko')).toHaveText('구성 승인');
  await page.getByRole('button', { name: '구성 승인 → APPROVED' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('사유').fill('구성 확인 — e2e');
  await dlg.getByRole('button', { name: '실행' }).click();
  await expect(dlg).toBeHidden();
  await post(request, `/api/products/${cat}/versions/1.0.0/transitions`, ['usr-approver', 'PRODUCT_APPROVER'], { to: 'VERIFIED', reason: '상품 검증 완료' }, 200);

  // 구성 승인자는 고객 출시를 할 수 없다 — 누르기 전에 막고 이유(오류 코드 없음)
  await page.reload();
  const release = page.getByRole('button', { name: '고객 출시 승인 → RELEASED' });
  await expect(release).toBeDisabled();
  await expect(page.locator('.ds-btn-why__text').filter({ hasText: '구성 승인을 한 사람은 고객 출시를 승인할 수 없습니다' })).toHaveCount(1);
  expect(await bodyCodes(page)).toEqual([]);

  // 상품 Owner(다른 상품 승인자)가 고객 출시
  const r = await post(request, `/api/products/${cat}/versions/1.0.0/transitions`, ['usr-productowner', 'PRODUCT_APPROVER'], { to: 'RELEASED', reason: '고객 출시 승인 — e2e' }, 200);
  expect(r.product.lifecycle).toBe('RELEASED');

  // 상품 상세 → 이 상품으로 체험 제안 — 상품이 골라져 있고, 범위 안 고객 차량만(영상 키트 시뮬레이터 차량 없음)
  await asRole(page, 'commerce');
  await page.reload();
  await page.getByRole('link', { name: '이 상품으로 체험 제안' }).click();
  await expect(page).toHaveURL(new RegExp(`/entitlements\\?catalog=${cat}`));
  await expect(page.getByLabel('체험 상품')).toHaveValue(cat);
  const offer = page.getByRole('region', { name: '체험 제안' });
  await expect(offer.getByTestId('offer-scope')).toContainText('KR/NX4 PE/Premium');
  await expect(offer.getByRole('checkbox', { name: /ego-01|lead-01/ })).toHaveCount(0);
  await offer.getByRole('checkbox', { name: 'KMH-NX4-0002 · 체험 미가입 차량' }).check();
  await offer.getByRole('button', { name: '제안 보내기' }).click();
  await expect(offer.getByRole('status')).toContainText('1대에 제안');
  const trials = await (await request.get(`${API}/api/trials?catalogId=${cat}&source=ALL`)).json();
  expect(trials.items.map((t: { vin: string; state: string }) => [t.vin, t.state])).toEqual([['KMH-NX4-0002', 'OFFERED']]);
});

// ISO/IEC 26580 정합(docs/20-architecture/20-60) — 실제 백엔드(메모리 DB·v0.81 시드 + Feature DB v1.3)와 화면.
//   (a) 등록 마법사: 이름·설명으로 기준 행 추천 → 대표 행 선택만으로 자동 채움(출처) → 제출 → 검토(G1~G3·안전 분류·요구 ID) → 정의 승인
//   (b) Bill-of-Features: 필요한 Feature가 빠진 구성 점검 → 위반 감지 · (c) 카탈로그·구성기·공유 자산·등록 현황 axe WCAG 2.2 AA
// 같은 기준 행(AD-PRK-014)을 한 번만 등록하므로 이 파일은 한 작업자에서 차례로 돈다.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { autofill as AF, bof as B, regSteps as RS } from '../../frontend/src/copy/ple';
import { recordAnalysisApi } from './analysis';
import { settle } from './settle';

test.describe.configure({ mode: 'default' });

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });
const AUTHOR = H('usr-author', 'FEATURE_AUTHOR');
/** 대표로 쓰는 Feature가 없는 활성 기준 행 — 연석 감지·휠 보호(Parking assistance, QM, 글로벌) */
const REF_ID = 'AD-PRK-014';

async function asRole(page: Page, role: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem('fp.state.v2') || '{}');
    s.role = r;
    localStorage.setItem('fp.state.v2', JSON.stringify(s));
  }, role);
}

async function call(request: APIRequestContext, method: 'post' | 'patch', path: string, headers: Record<string, string>, data: unknown, code: number) {
  const r = method === 'post' ? await request.post(`${API}${path}`, { headers, data }) : await request.patch(`${API}${path}`, { headers, data });
  expect(r.status(), `${method} ${path}: ${await r.text()}`).toBe(code);
  return r.json();
}

async function axeClean(page: Page, label: string) {
  await settle(page, { scope: 'body', errors: '#main' });
  // hygiene-ok: 취소된 애니메이션의 finished는 거부로 끝난다 — 시간 초과를 삼키는 대기가 아니라 '끝남'을 같은 값으로 받는 것
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const detail = bad.map((v) => `${v.id} ×${v.nodes.length}: ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join('\n    ')}`).join('\n');
  expect(bad.reduce((n, v) => n + v.nodes.length, 0), `${label}\n${detail}`).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/_design');
  await asRole(page, 'author');
});

test('(a) 기준 행 선택만으로 자동 채움 → 제출 → 검토 → 정의 승인', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 홈 대시보드 머리에 주요 행동이 있다
  await page.goto('/');
  await page.locator('[data-ui="dashboard-register"]').click();
  await expect(page).toHaveURL(/\/feature\/propose$/);
  await expect(page.locator('[data-reg-step="0"] [aria-current="step"]')).toContainText(RS.stages[0]);

  // ① 이름·설명으로 찾기 → 추천 후보를 대표로
  await page.locator('input[name="intent"]').fill('주차할 때 연석 감지하고 휠 보호');
  await page.getByRole('button', { name: AF.intentPick(REF_ID) }).click();
  await expect(page.locator(`[data-ref-chosen="${REF_ID}"]`)).toHaveAttribute('data-role', 'PRIMARY');
  await page.locator('[data-ui="refPickNext"]').click();

  // ② 자동 채움 — 사람이 고르던 칸이 출처와 함께 채워진다
  const af = page.getByTestId('autofill');
  await expect(af).toBeVisible();
  await expect(page.locator('[data-reg-step="1"] [aria-current="step"]')).toContainText(RS.stages[1]);
  await expect(af.locator('[data-af-field="asil"]')).toContainText('대표 ASIL(L)');
  await expect(af.locator('[data-af-field="component"]')).toContainText('Parking assistance');
  await expect(af.locator('[data-af-field="owner"]')).toContainText(AF.sourceKind.CATALOGUE);
  await expect(page.locator('input[name="name"]')).toHaveValue('연석 감지·휠 보호');
  await expect(page.locator('input[name="ownerId"]')).not.toHaveValue('');
  await expect(page.locator('input[name="country"]')).not.toHaveValue('');
  for (const k of ['name', 'asil', 'owner', 'scope', 'variability']) await expect(af.locator(`[data-af-field="${k}"] [data-ref-mark]`)).toHaveAttribute('data-ref-mark', 'base');
  await expect(page.getByTestId('af-profile')).toBeVisible();
  await axeClean(page, '등록 2단계(자동 채움)');

  // 아무것도 고치지 않고 제출
  await page.locator('[data-ui="createFeature"]').click();
  await expect(page).toHaveURL(/\/features\/FEAT-\d+\/0\.1\.0/);
  const [, id] = page.url().match(/\/features\/(FEAT-\d+)\/0\.1\.0/)!;

  // 기준 행 탭 — 26580 Feature 프로필과 자동 채움 이력(모두 기준값 그대로)
  await page.goto(`/features/${id}/0.1.0?tab=refs`);
  const profile = page.getByTestId('feature-profile');
  await expect(profile).toBeVisible();
  await expect(profile.locator('[data-ref-mark="edited"]')).toHaveCount(0);
  await expect(profile.locator('[data-ref-mark="base"]').first()).toBeVisible();

  // 등록 현황 — 제출 단계
  await page.goto('/master/define');
  const regs = page.getByRole('table', { name: '진행 중인 등록' });
  await expect(regs.getByRole('row').filter({ hasText: id })).toContainText(`3 · ${RS.stages[2]}`);

  // 검토 — 요구 ID(작성자)·구현 연결·안전 분류 확정(FSM)·분석 근거·G1~G3 PASS(품질 검토)
  const base = `/api/features/${id}/versions/0.1.0`;
  await call(request, 'patch', base, AUTHOR, { requirementIds: ['REQ-E2E-26580'], functions: [{ label: '연석 감지 판정' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }, 200);
  await call(request, 'post', `${base}/safety/confirm`, H('usr-safety', 'SAFETY_OFFICER'), { reason: 'HARA 검토 완료' }, 201);
  await recordAnalysisApi(request, id, '0.1.0');
  for (const gate of ['G1', 'G2', 'G3']) await call(request, 'post', `${base}/gates`, H('usr-quality', 'GATE_JUDGE'), { gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}` }, 201);
  await page.reload();
  await expect(regs.getByRole('row').filter({ hasText: id })).toContainText(`5 · ${RS.stages[4]}`);

  // 정의 승인 — 등록한 사람이 아닌 승인자(직무 분리 그대로)
  await asRole(page, 'approver');
  await page.goto(`/features/${id}/0.1.0`);
  await page.getByRole('button', { name: 'APPROVED로 전이' }).click();
  const approve = page.getByRole('dialog');
  await approve.getByLabel('사유').fill('자동 채움 확인·검토 완료 — e2e');
  await approve.getByRole('button', { name: '실행' }).click();
  await expect(approve).toBeHidden();
  await expect(page.locator('.ds-step[data-lifecycle="DEVELOPING"]')).toHaveAttribute('data-state', 'current');
  expect(errors).toEqual([]);
});

test('(b) Bill-of-Features — 필요한 Feature가 빠진 구성 점검은 위반', async ({ page }) => {
  await asRole(page, 'commerce');
  await page.goto('/products/bill-of-features');
  await expect(page.getByTestId('bof-grid')).toBeVisible();
  await expect(page.getByTestId('bof-issues').or(page.getByText(B.issuesNone))).toBeVisible();
  // FEAT-00022(BL-00028)는 FEAT-00145가 필요하다 — 단독 구성은 REQUIRES_MISSING
  await page.locator('input[name="bofBaselines"]').fill('BL-00028');
  await page.locator('select[name="bofType"]').selectOption('SINGLE');
  await page.locator('[data-ui="checkBillOfFeatures"]').click();
  const result = page.getByTestId('bof-check-result');
  await expect(result).toHaveAttribute('data-result', 'FAIL');
  await expect(result.locator('[data-code="REQUIRES_MISSING"]')).toBeVisible();
  // 빠진 Feature를 더하면 그 위반은 사라진다
  await page.locator('input[name="bofBaselines"]').fill('BL-00028, BL-00163');
  await page.locator('select[name="bofType"]').selectOption('PACKAGE');
  await page.locator('[data-ui="checkBillOfFeatures"]').click();
  await expect(result.locator('[data-code="REQUIRES_MISSING"]')).toHaveCount(0);
});

test('(c) 카탈로그·Bill-of-Features·제품 구성기·공유 자산·등록 현황 — 데이터가 차 있고 axe WCAG 2.2 AA', async ({ page }) => {
  test.slow();
  await page.goto('/features/catalogue');
  await expect(page.getByTestId('catalogue-tree').locator('[data-catalogue-ref]').first()).toBeVisible();
  await expect(page.locator('.cat-node[data-role="SUB"]').first()).toBeAttached();
  await axeClean(page, 'Feature 카탈로그');
  await page.goto('/products/bill-of-features');
  await expect(page.getByTestId('bof-grid').locator('td[data-on="true"]').first()).toBeVisible();
  await axeClean(page, 'Bill-of-Features');
  await page.goto('/products/configurator');
  await expect(page.getByTestId('configurator').locator('[data-flag-value="ON"]').first()).toBeVisible();
  await axeClean(page, '제품 구성기');
  await page.goto('/features/shared-assets');
  await expect(page.getByRole('table').first()).toBeVisible();
  await axeClean(page, '공유 자산 추적');
  await page.goto('/master/define');
  await expect(page.locator('[data-ui="registerFeature"]')).toBeVisible();
  await axeClean(page, '등록 현황');
});

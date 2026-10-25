// readiness: RD-P2-03 — 브라우저 엔진 스모크. chromium·firefox·webkit 프로젝트가 모두 이 파일을 돈다(playwright.config.ts).
// 핵심 흐름만 — 로그인 · 대시보드 · Feature 등록 · 긴급 차단 요청 · 업무 절차 흐름도 표시 · 오류 안내. 엔진마다 다른
// 레이아웃·폼·대화 상자·fetch 오류 처리가 여기서 걸린다. 지원 해상도(데스크톱 1280 이상, 태블릿 768 보기·조작, 휴대폰 390 보기)는
// narrow.spec.ts와 docs/20-architecture/20-93-browser-support.md.
import { expect, test, type Page } from '@playwright/test';
import { errorActions } from '../../frontend/src/copy/error-actions';
import { errors } from '../../frontend/src/copy/errors';

const E = { ...errors, ...errorActions };

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      localStorage.removeItem('ff.learn.v1');
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
});

test.describe('로그인', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('틀린 비밀번호는 막고, 맞으면 대시보드로 들어간다 — 로그아웃하면 다시 로그인 화면', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('ID').fill('FF');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
    await expect(page.getByRole('alert')).toContainText('ID 또는 비밀번호가 맞지 않습니다');
    await page.getByLabel('Password').fill('platform');
    await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#main .jd')).toBeVisible();
    await page.getByRole('button', { name: '로그아웃' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test('대시보드 — 가젯이 실제 데이터로 채워지고 오류·가로 넘침이 없다', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await asRole(page, 'operator');
  await page.goto('/');
  const board = page.locator('#main .jd');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-gadget]').first()).toBeVisible();
  await expect(page.locator('#main [aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#main .ds-error[role="alert"]')).toHaveCount(0);
  expect(await noPageOverflow(page)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('Feature 등록 — 제안 폼으로 등록하면 새 Feature 상세(0.1.0)가 열린다', async ({ page, browserName }) => {
  await asRole(page, 'author');
  await page.goto('/feature/propose');
  const name = `엔진 스모크 ${browserName} ${Date.now()}`;
  await page.locator('input[name="name"]').fill(name);
  await page.locator('textarea[name="description"]').fill('브라우저 엔진 스모크에서 등록');
  await page.locator('input[name="ownerId"]').fill('usr-author');
  await page.locator('[data-ui="createFeature"]').click();
  await expect(page).toHaveURL(/\/features\/FEAT-\d+\/0\.1\.0$/);
  await expect(page.locator('#main')).toContainText(name);
});

test('긴급 차단 요청 — 영향 범위·규칙 점검·확인 입력(type-to-confirm)까지, 확인 전에는 보내지 않는다', async ({ page }) => {
  await asRole(page, 'operator');
  await page.goto('/ops/kill');
  await page.getByRole('button', { name: '긴급 차단 요청' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('care_00022_param, care_00022_signal')).toBeVisible();
  await form.getByLabel(/봉쇄 결정 근거/).fill('엔진 스모크 — 원인 분석 전 봉쇄');
  await form.getByLabel('사유', { exact: true }).fill('엔진 스모크 — 요청 화면 점검');
  await expect(form.locator('.ds-rules__item[data-status="fail"]')).toHaveCount(0);
  // 실제 요청은 보내지 않는다 — 다른 시험(ops.spec)이 같은 Feature의 차단 흐름을 끝까지 돈다
  let posted = false;
  await page.route('**/api/kill-requests', (r) => (r.request().method() === 'POST' ? ((posted = true), r.abort()) : r.continue()));
  await form.getByRole('button', { name: '차단 요청', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  const go = confirm.getByRole('button', { name: '차단 요청' });
  await expect(go).toBeDisabled();
  await confirm.getByRole('textbox').fill('FEAT-00022');
  await expect(go).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect(posted).toBe(false);
});

test('업무 절차 흐름도 — 스윔레인과 활동 상자가 보이고, 누르면 활동 상세가 열린다', async ({ page }) => {
  await asRole(page, 'author');
  await page.goto('/procedures/FPW.1');
  const flow = page.getByRole('group', { name: 'Feature 등록·분류 흐름도' });
  await expect(flow).toBeVisible();
  await expect(flow.locator('.pf-node--activity')).toHaveCount(5);
  await flow.getByRole('button', { name: /^안전 분류\(네 축\) 확정 / }).click();
  await expect(page).toHaveURL(/a=FPW\.1-A03/);
  await expect(page.getByRole('heading', { level: 2, name: /안전 분류\(네 축\) 확정/ })).toBeVisible();
  expect(await noPageOverflow(page)).toBe(true);
});

test('오류 안내 — 서버 오류(5xx)는 사용자 말과 문의 번호로, 연결 끊김은 연결 안내로', async ({ page }) => {
  const LIST = /\/api\/features(\?.*)?$/;
  await page.route(LIST, (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', headers: { 'X-Correlation-Id': 'cid-engine-500' }, body: JSON.stringify({ error: { code: 'INTERNAL', message: 'TypeError: boom' } }) }),
  );
  await page.goto('/features');
  const box = page.locator('[data-state="error"]').first();
  await expect(box).toContainText(E.serverTitle);
  await expect(box.locator('[data-id="cid-engine-500"]')).toBeVisible();
  await expect(box).not.toContainText('TypeError');

  await page.unroute(LIST);
  await page.route(LIST, (r) => r.abort('internetdisconnected'));
  await page.goto('/features');
  await expect(page.locator('[data-state="error"]').first()).toContainText(E.network);
});

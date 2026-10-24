// readiness: RD-UX-01 — 오류 화면: 서버 응답을 page.route로 바꿔 넣고, 경우마다 화면이 사용자 말과 다음 행동으로 안내하는지 본다.
// 401 다시 로그인 · 409 최신 내용 다시 불러오기(입력 유지) · 400/422 칸 옆 오류 · 429 잠시 뒤 · 5xx 문의 번호 · 연결 끊김. 포트 번호 같은 개발자 문구는 없다.
import { expect, test, type Page, type Route } from '@playwright/test';
import { errors as E } from '../../frontend/src/copy/errors';

const LIST = /\/api\/features(\?.*)?$/;
const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
const envelope = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details !== undefined && { details }) } });

async function asRole(page: Page, role: string) {
  await page.addInitScript((r) => {
    if (!sessionStorage.getItem('e2e.role')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
      sessionStorage.setItem('e2e.role', '1');
    }
  }, role);
}

const noDevWording = async (page: Page) => {
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/9101|백엔드|localhost/);
};

test('조회 401 — 세션 만료 제목과 다시 로그인(다시 시도 대신)', async ({ page }) => {
  await page.route(LIST, (r) => json(r, 401, envelope('UNAUTHENTICATED', '로그인이 필요합니다.')));
  await page.goto('/features');
  const box = page.locator('[data-state="error"]').first();
  await expect(box).toContainText(E.authTitle);
  await expect(box.getByRole('button', { name: E.relogin })).toBeVisible();
  await expect(page.locator('[data-session-expired]')).toContainText(E.sessionBanner);
  await noDevWording(page);
});

test('조회 429 — Retry-After 초를 안내하고 다시 시도할 수 있다', async ({ page }) => {
  let n = 0;
  await page.route(LIST, (r) => (n++ === 0 ? json(r, 429, envelope('RATE_LIMITED', 'too many'), { 'Retry-After': '30' }) : r.continue()));
  await page.goto('/features');
  const box = page.locator('[data-state="error"]').first();
  await expect(box).toContainText(E.rateLimit(30));
  await box.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
});

test('조회 5xx — 서버 내부 문장 대신 안내, 문의 번호(X-Correlation-Id)를 보인다', async ({ page }) => {
  await page.route(LIST, (r) => json(r, 500, envelope('INTERNAL', 'TypeError: x is undefined at registry.service.ts:88'), { 'X-Correlation-Id': 'cid-e2e-500' }));
  await page.goto('/features');
  const box = page.locator('[data-state="error"]').first();
  await expect(box).toContainText(E.serverTitle);
  await expect(box).toContainText(E.correlation);
  await expect(box.locator('[data-id="cid-e2e-500"]')).toBeVisible();
  await expect(box).not.toContainText('TypeError');
  await noDevWording(page);
});

test('연결 끊김 — 요청이 닿지 않으면 연결 안내(포트·서버 이름 없이)', async ({ page }) => {
  await page.route(LIST, (r) => r.abort('internetdisconnected'));
  await page.goto('/features');
  await expect(page.locator('[data-state="error"]').first()).toContainText(E.network);
  await noDevWording(page);
});

test.describe('Feature 제안 폼 — 변경 실패', () => {
  test.beforeEach(async ({ page }) => {
    await asRole(page, 'author');
    await page.goto('/feature/propose');
    await page.locator('input[name="name"]').fill('오류 안내 시험 Feature');
    await page.locator('textarea[name="description"]').fill('서버 오류 안내 확인용');
    await page.locator('input[name="ownerId"]').fill('ADAS기획팀');
  });

  test('400 입력 검사 — 칸 옆에 오류, 입력은 aria-invalid, 입력값은 그대로', async ({ page }) => {
    await page.route('**/api/features', (r) =>
      r.request().method() === 'POST' ? json(r, 400, envelope('VALIDATION', '요청 본문이 올바르지 않습니다.', [{ path: 'name', message: '이름은 2자 이상 80자 이하입니다.' }, { path: 'ownerId', message: 'Owner를 적으세요.' }])) : r.continue(),
    );
    await page.locator('[data-ui="createFeature"]').click();
    const name = page.locator('input[name="name"]');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.ds-field[data-invalid]').filter({ has: name })).toContainText('이름은 2자 이상 80자 이하입니다.');
    await expect(page.locator('.ds-field[data-invalid]').filter({ has: page.locator('input[name="ownerId"]') })).toContainText('Owner를 적으세요.');
    await expect(page.getByRole('alert').filter({ hasText: E.validationHint })).toBeVisible();
    await expect(name).toHaveValue('오류 안내 시험 Feature');
  });

  test('422 업무 조건 — 서버 문장과 해당 칸 표시', async ({ page }) => {
    await page.route('**/api/features', (r) =>
      r.request().method() === 'POST' ? json(r, 422, envelope('GUARD_FAILED', '국가·차종·트림이 바뀌면 새 Feature ID로 등록해야 합니다.', { fields: ['country', 'trim'] })) : r.continue(),
    );
    await page.locator('[data-ui="createFeature"]').click();
    await expect(page.locator('input[name="country"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('input[name="trim"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').first()).toContainText('국가·차종·트림이 바뀌면');
  });

  test('409 충돌 — 다른 사람이 먼저 바꿨다는 안내, 다시 불러와도 입력은 그대로', async ({ page }) => {
    await page.route('**/api/features', (r) => (r.request().method() === 'POST' ? json(r, 409, envelope('CONFLICT', '다른 사용자가 같은 이름으로 먼저 등록했습니다.')) : r.continue()));
    await page.locator('[data-ui="createFeature"]').click();
    const alert = page.getByRole('alert').filter({ hasText: '다른 사용자가 같은 이름으로 먼저 등록했습니다.' });
    await expect(alert).toContainText(E.conflictHint);
    await alert.getByRole('button', { name: E.reload }).click();
    await expect(alert).toContainText(E.reloaded);
    await expect(page.locator('input[name="name"]')).toHaveValue('오류 안내 시험 Feature');
    await expect(page.locator('textarea[name="description"]')).toHaveValue('서버 오류 안내 확인용');
  });

  test('401 저장 중 세션 만료 — 입력이 있으면 로그인으로 바로 옮기지 않고 안내 띠가 묻는다', async ({ page }) => {
    await page.route('**/api/features', (r) => (r.request().method() === 'POST' ? json(r, 401, envelope('UNAUTHENTICATED', '로그인이 필요합니다.')) : r.continue()));
    await page.locator('[data-ui="createFeature"]').click();
    await expect(page.locator('[data-session-expired]')).toContainText(E.sessionBanner);
    await expect(page).toHaveURL(/\/feature\/propose$/);
    await expect(page.locator('input[name="name"]')).toHaveValue('오류 안내 시험 Feature');
  });

  test('저장 중 연결 끊김 — 사용자 말 안내, 입력은 그대로', async ({ page }) => {
    await page.route('**/api/features', (r) => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
    await page.locator('[data-ui="createFeature"]').click();
    await expect(page.getByRole('alert').first()).toContainText(E.network);
    await expect(page.locator('input[name="name"]')).toHaveValue('오류 안내 시험 Feature');
    await noDevWording(page);
  });
});

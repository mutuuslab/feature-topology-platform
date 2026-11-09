// 공개 시연 사이트 — 긴급 차단 흐름을 브라우저 안 시연 데이터로 끝까지(설계 docs/20-architecture/20-61-browser-simulator.md).
// 로그인 → (운영) 차단 요청 → (기능안전) 승인 → (사이버보안) 승인·발행 → 차량 회신이 몇 초에 걸쳐 → 알림 종·감사·홈 수신 현황·지도 활성화 렌즈가 같은 상태
// → 끊긴 차량 다시 보내기 → 전체 확인 → 복원 요청(Canary 1대)·직전 차단 승인자 제외 2인 승인 → 복원 회신 → '시연 데이터 초기화'로 처음 상태.
// 단계별 화면은 SHOTS 폴더(1366 폭)에 남긴다.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.KILL_SHOTS ?? join(__dirname, '..', 'test-results', 'kill-flow-shots');
const FEAT = 'FEAT-00022';
let n = 0;
const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
};
/** 데모 역할 전환(상단 역할 선택) — 역할 홈으로 옮겨 간 뒤 원하는 화면으로 */
async function as(page: Page, role: string, url: string) {
  await page.getByRole('combobox', { name: '역할', exact: true }).selectOption(role);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(url);
}
const meter = (page: Page) => page.getByRole('dialog').getByRole('meter').first();
const num = async (l: ReturnType<Page['locator']>) => Number((await l.innerText()).replace(/[^\d]/g, ''));
/** 시연 데이터에 남은 예약 작업 중 이 종류(차량 회신 묶음 등) 수 — 오버레이(IndexedDB ff-sim)를 읽는다. 고정 시간 대신 '회신이 다 들어왔다' 상태로 기다린다 */
const pendingTasks = (page: Page, kind: string) =>
  page.evaluate(
    (k) =>
      new Promise<number>((resolve, reject) => {
        // Read the existing app database without forcing an older schema or creating an empty fixture.
        const req = indexedDB.open('ff-sim');
        req.onupgradeneeded = () => { req.transaction?.abort(); reject(new Error('시연 오버레이 DB가 아직 없습니다.')); };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('overlay')) { db.close(); reject(new Error('시연 오버레이 store가 없습니다.')); return; }
          const get = db.transaction('overlay', 'readonly').objectStore('overlay').get('current');
          get.onsuccess = () => {
            db.close();
            if (!Array.isArray(get.result?.tasks)) { reject(new Error('저장된 시연 작업 큐가 없습니다.')); return; }
            resolve((get.result.tasks as { kind: string }[]).filter((t) => t.kind === k).length);
          };
          get.onerror = () => (db.close(), reject(get.error));
        };
      }),
    kind,
  );

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });

test('정적 시연: 긴급 차단 → 2인 승인 → 차량 회신 → 재전송 → 복원 → 처음 상태로', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 로그인
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-static-demo]')).toHaveCount(0); // 읽기 전용 띠 없음
  await expect(page.getByTestId('demo-reset-open')).toBeVisible();
  // 홈 수신 현황 — 처음 '차단 수신' 수
  await as(page, 'operator', '/');
  const overview = page.locator('.operation-overview');
  await expect(overview).toContainText('차단 수신');
  const safeBefore = Number((await overview.innerText()).match(/차단 수신\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '0');
  await shot(page, 'home-before');

  // 1. 운영 — 차단 요청(봉쇄 근거·사유, 게이트 사전 점검 통과 뒤 type-to-confirm)
  await page.goto(`/ops/kill?featureId=${FEAT}&version=1.0.0`);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(/차량 \(\d+\/\d+\)|\(\d+\/\d+\)/).first()).toBeVisible();
  await drawer.getByLabel('봉쇄 결정 근거').fill('전방 거리 오판정 현장 조사 — 영향 차량 봉쇄');
  await drawer.getByLabel('사유', { exact: true }).fill('전방 안전거리 단계 오판정 의심 — 조사 동안 차단');
  const issue = drawer.getByRole('button', { name: '차단 요청', exact: true });
  await expect(issue).toBeEnabled({ timeout: 15_000 });
  await shot(page, 'request-form');
  await issue.click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('textbox').fill(FEAT);
  await confirm.getByRole('button', { name: '차단 요청', exact: true }).click();
  const title = page.getByRole('dialog').locator('h2').first();
  await expect(title).toHaveText(/^KILL-\d{5}$/);
  const killId = (await title.innerText()).trim();
  await expect(page.getByRole('dialog')).toContainText('승인 대기');
  await shot(page, 'requested');

  // 요청자는 승인할 수 없다(직무 분리) — 승인 단추가 막혀 있다
  await expect(page.getByRole('dialog').getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();

  // 2. 기능안전(FSM) 승인 — 알림 종에 승인 요청이 와 있다
  await as(page, 'quality', '/ops/kill');
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText(`긴급 차단 승인 요청 — ${killId}`);
  await shot(page, 'bell-approval-request');
  await page.keyboard.press('Escape');
  await page.goto(`/ops/kill?id=${killId}`);
  await page.getByRole('dialog').getByRole('button', { name: '승인 — 개인 서명' }).click();
  // 첫 칸(기능안전 FSM)이 채워지고, 같은 사람은 다시 승인할 수 없다
  await expect(page.getByRole('row', { name: new RegExp(killId) })).toContainText('승인 대기 1/2');
  await expect(page.getByRole('dialog').getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();
  await shot(page, 'approved-1');

  // 3. 사이버보안(CSM) 승인 — 게이트 통과·서명·차량별 봉투·긴급 채널
  await as(page, 'integrator', `/ops/kill?id=${killId}`);
  await page.getByRole('dialog').getByRole('button', { name: '승인 — 개인 서명' }).click();
  await expect(meter(page)).toBeVisible();
  await shot(page, 'issued');

  // 4. 차량 회신 — 몇 초에 걸쳐 늘어난다(통신이 끊긴 차량은 남는다)
  await expect.poll(async () => Number(await meter(page).getAttribute('aria-valuenow')), { timeout: 20_000 }).toBeGreaterThan(0);
  const first = Number(await meter(page).getAttribute('aria-valuenow'));
  const total = Number(await meter(page).getAttribute('aria-valuemax'));
  await shot(page, 'replies-arriving');
  await expect.poll(async () => Number(await meter(page).getAttribute('aria-valuenow')), { timeout: 30_000 }).toBeGreaterThan(first);
  // 온라인 차량의 회신 묶음이 모두 들어올 때까지(끊긴 차량은 기한까지 답하지 않는다)
  await expect.poll(() => pendingTasks(page, 'kill.readback'), { timeout: 30_000 }).toBe(0);
  await expect.poll(async () => Number(await meter(page).getAttribute('aria-valuenow')), { timeout: 10_000 }).toBeGreaterThanOrEqual(first);
  const online = Number(await meter(page).getAttribute('aria-valuenow'));
  expect(online).toBeLessThan(total);
  await shot(page, 'replies-done-partial');

  // 5. 같은 상태를 다른 화면도 — 감사, 알림 종(운영), 홈 수신 현황, 지도 활성화 렌즈
  await as(page, 'operator', `/audit?prefix=${killId}`);
  await expect(page.locator('#main')).toContainText(killId);
  await expect(page.locator('#main')).toContainText(/KILL_ISSUE|차단 실행|긴급 차단 발행/);
  await shot(page, 'audit');
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText(`긴급 차단 실행 — ${FEAT} (${killId})`);
  await shot(page, 'bell-issued');
  await page.keyboard.press('Escape');
  await page.goto('/');
  await expect.poll(async () => Number((await overview.innerText()).match(/차단 수신\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '0'), { timeout: 20_000 }).toBeGreaterThan(safeBefore + online / 2); // 회신한 차량 중 신뢰 품질(TRUSTED)인 것만 '차단 수신'(receivedState)
  await shot(page, 'home-after-kill');
  await page.goto('/fleet/map?lens=activation&flagKey=care_00022_param');
  const disabled = page.locator('.fm-legend li', { hasText: '긴급 차단' }).locator('.fm-legend__n');
  await expect.poll(async () => num(disabled), { timeout: 20_000 }).toBeGreaterThanOrEqual(online);
  // 범례 숫자는 지도보다 먼저 온다 — 지도 바탕(maplibre)이 다 그려진 뒤 찍는다(전에는 '지도를 불러오는 중'이 찍혔다)
  await expect(page.locator('.fm-map')).toHaveAttribute('data-phase', 'ready', { timeout: 30_000 });
  await shot(page, 'map-activation');

  // 6. 끊긴 차량 다시 보내기(전달 작업) → 전부 확인
  await page.goto(`/ops/kill?id=${killId}`);
  const pub = (await page.getByRole('dialog').locator('a[href^="/deployments/PUB-"]').first().getAttribute('href'))!;
  await page.goto(pub);
  await page.getByRole('button', { name: '다시 제출' }).first().click();
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('통신 복구 확인 — 끊긴 차량에 다시 보내기');
  await page.getByRole('dialog').getByRole('button', { name: '다시 제출' }).click();
  await expect(page.getByRole('button', { name: '다시 제출' })).toHaveCount(0); // 재시도 대기 → 제출됨
  // 다시 보낸 차량의 회신 묶음이 다 들어온 뒤 찍는다
  await expect.poll(() => pendingTasks(page, 'kill.readback'), { timeout: 30_000 }).toBe(0);
  await shot(page, 'retry');
  await page.goto(`/ops/kill?id=${killId}`);
  await expect.poll(async () => Number(await meter(page).getAttribute('aria-valuenow')), { timeout: 30_000 }).toBe(total);
  await shot(page, 'all-confirmed');

  // 7. 복원 요청(차단 해제 — 기능 활성화가 아니다): 재검증 Evidence·Canary 1대
  const form = page.getByTestId('restore-form');
  await form.getByLabel('사유', { exact: true }).fill('원인 수정·재검증 PASS — 1대부터 복원');
  for (const c of ['차단 사유 해소', '원인 조치 완료']) await form.getByRole('checkbox', { name: c }).check(); // 해제 확인 항목(FR-KSW-004-002)
  await form.getByRole('button', { name: '복원 요청' }).click();
  await expect(page.getByTestId('restore-form')).toHaveCount(0); // 요청 뒤에는 복원 승인 칸
  await expect(page.getByRole('dialog').locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' })).toBeVisible();
  await shot(page, 'restore-requested');
  // 직전 차단 승인자는 복원을 승인할 수 없다
  await as(page, 'quality', `/ops/kill?id=${killId}`);
  await expect(page.getByRole('dialog').locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' })).toBeDisabled();
  await as(page, 'safety2', `/ops/kill?id=${killId}`);
  await page.getByRole('dialog').locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
  await as(page, 'opslead', `/ops/kill?id=${killId}`);
  await page.getByRole('dialog').locator('[data-tour="kill-restore"]').getByRole('button', { name: '승인 — 개인 서명' }).click();
  // Canary 1대 복원 — 차단은 나머지 차량에 그대로(단계적 복원), 다음 단계 요청 폼이 다시 열린다
  await expect(page.getByRole('dialog')).toContainText(`차단 중 · 복원 1/${total}대`);
  await expect(page.getByTestId('restore-form')).toBeVisible();
  await shot(page, 'restore-approved');

  // 8. 처음 상태로 — 상단 '시연 데이터 초기화'
  await page.keyboard.press('Escape'); // 서랍(모달)을 닫고 상단 메뉴로
  await page.getByTestId('demo-reset-open').click();
  await page.getByTestId('demo-reset').getByRole('button', { name: '처음 상태로 되돌리기' }).click();
  await page.goto('/ops/kill');
  await expect(page.locator('#main')).not.toContainText(killId);
  await page.goto('/');
  await expect.poll(async () => Number((await overview.innerText()).match(/차단 수신\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '0'), { timeout: 20_000 }).toBe(safeBefore);
  await shot(page, 'reset');
  expect(await page.evaluate(() => localStorage.getItem('ff.sim'))).toBeNull();
  expect(await page.evaluate(() => (window as any).__simUnhandled ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

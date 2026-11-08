// 공개 시연 사이트 — 정책 운영 흐름을 브라우저 안 시연 데이터로 끝까지(설계 docs/20-architecture/20-61-browser-simulator.md, api/sim/handlers/policy-ops).
// (작성) 정책 작성 → 가상검증 → 분야별 검증 8종 GO → (승인) 정책 승인 → (출시) 서버 배포: F3 Feature라 Canary 5% → (운영) 확대 시도는 관측 기간·
// 열린 이상 징후로 거부 → 이상 징후 확인 → (출시) 수동 롤백 요청(지정 승인대상자) → (운영 리더) 승인 → (출시) 실행: 복구 기준 버전 재게시 → 차량 회신 →
// 끊긴 차량 다시 제출 → 롤백 완료 → Unleash 대조 화면이 바뀐 배포를 본다 → '시연 데이터 초기화'로 처음 상태. 단계별 화면은 SHOTS 폴더(1366 폭)에.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.POLICY_OPS_SHOTS ?? join(__dirname, '..', 'test-results', 'policy-ops-shots');
const FEAT = 'FEAT-00022';
const FLAG = 'care_00022_param';
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

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('정적 시연: 정책 작성 → 8종 검증 → 승인 → Canary 배포 → 확대 판정 → 이상 확인 → 롤백 → 차량 회신 → 처음 상태로', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await login(page);
  // 지금 배포된 이 flag의 정책(롤백 복구 기준이 된다)
  const before = (await (await page.request.get('/api-snapshot/policies_status_DEPLOYED.json')).json()).items.find((p: { flagKey: string }) => p.flagKey === FLAG);
  expect(before, `${FLAG} 배포 정책이 스냅샷에 있어야 한다`).toBeTruthy();

  // 1. 작성 — 같은 flag의 새 판(감속 시작 거리 조정)
  await as(page, 'author', '/policies/new');
  await page.waitForLoadState('networkidle');
  const create = page.locator('#main form');
  await create.getByLabel('Feature ID', { exact: true }).fill(FEAT);
  await create.getByLabel('Version', { exact: true }).fill('1.0.0');
  await create.getByLabel('Control Point').selectOption('Parameter');
  await create.getByLabel('flagKey').fill(FLAG);
  await create.getByLabel('설명').fill('위험 단계 감속 요청 파라미터 — 감속 시작 거리 조정판');
  await create.getByLabel('필요 사용 권한 상품 (선택)').fill('CAT-00019');
  await expect(create.getByLabel('Feature ID', { exact: true })).toHaveValue(FEAT);
  await shot(page, 'create-form');
  await create.getByRole('button', { name: '새 정책' }).click();
  await page.waitForURL(/\/policies\/POL-\d{5}$/);
  const policyId = page.url().split('/').pop()!;
  await expect(page.locator('#main')).toContainText(policyId);

  // 2. 가상검증(기록된 CARLA 결과로 이 정책 내용 판정) → 3. 분야별 검증 8종 → GO
  const virtual = page.getByRole('region', { name: 'CARLA 가상검증' });
  await virtual.getByRole('button', { name: '가상검증 실행' }).click();
  await expect(virtual.locator('tbody tr')).toHaveCount(3, { timeout: 20_000 });
  await page.getByRole('button', { name: '분야별 검증 실행' }).first().click();
  await expect(page.locator('#main')).toContainText('GO — 승인 가능', { timeout: 20_000 });
  await expect(page.getByRole('region', { name: '분야별 검증 8종 (병렬)' }).locator('.ds-validator[data-result="PASS"]')).toHaveCount(8);
  await shot(page, 'validated-go');

  // 4. 승인 — 승인자 알림 종에 승인 요청, 작성자와 다른 사람이 승인
  await as(page, 'approver', `/policies/${policyId}`);
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText(`정책 승인 요청 — ${policyId}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '정책 승인 / 반려' }).click();
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('8종 검증 GO·가상검증 PASS 확인');
  await page.getByRole('dialog').getByRole('button', { name: '정책 승인' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#main')).toContainText('APPROVED');
  await shot(page, 'approved');

  // 5. 서버 배포(출시) — F3라 Canary 5%, 이전 배포본은 RETIRED, 서명 게시본(OTA)
  await as(page, 'coordinator', `/policies/${policyId}`);
  await page.getByRole('button', { name: '서버 배포' }).click();
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('감속 시작 거리 조정판 — Canary부터');
  await page.getByRole('dialog').getByRole('button', { name: '서버 배포' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#main')).toContainText('DEPLOYED');
  await expect(page.getByRole('region', { name: 'Feature Flag 정책·승인' })).toContainText('5% / 100%');
  await shot(page, 'deployed-canary');
  await page.goto('/policies');
  await expect(page.getByRole('row', { name: new RegExp(before.policyId) })).toContainText('RETIRED');

  // 6. 확대 시도(운영) — 관측 24시간 전이고 열린 이상 징후가 있어 거부(규칙 그대로, 거부도 감사)
  await as(page, 'operator', `/policies/${policyId}`);
  await page.getByRole('button', { name: '단계 조정' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('코호트 비율 (basis points, 10000 = 100%)').fill('2000');
  await drawer.getByLabel('사유', { exact: true }).fill('Canary 결과 양호 — 20%로 확대');
  await drawer.getByRole('button', { name: '단계 조정' }).click();
  await expect(drawer).toContainText('관측 기간');
  await expect(drawer).toContainText(/이상 징후 ANM-\d{5}/);
  await shot(page, 'expand-refused');
  await page.keyboard.press('Escape');

  // 7. 이상 징후 확인(운영) — 중단 기준이 된 열린 현장 이상
  const anomaly = (await (await page.request.get('/api-snapshot/anomalies.json')).json()).items.find((a: { featureId: string; status: string; kind: string }) => a.featureId === FEAT && a.status === 'OPEN' && a.kind !== 'DELIVERY');
  await page.goto(`/ops/anomalies?id=${anomaly.anomalyId}`);
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('Canary 차량 감속 이상 보고 — 롤백 검토');
  await page.getByRole('dialog').getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('확인됨');
  await shot(page, 'anomaly-acknowledged');
  await page.keyboard.press('Escape');

  // 8. 롤백 요청(출시) — 새 배포 → 직전 배포 버전, 지정 승인대상자(운영 리더), 미리보기로 적용 가능 확인
  await as(page, 'coordinator', '/ops/rollback');
  await page.getByRole('row', { name: new RegExp(FLAG) }).first().click();
  const form = page.getByRole('region', { name: '롤백 요청' });
  await expect(form.getByLabel('복구 기준 버전')).toContainText(before.policyId);
  await form.getByLabel('복구 기준 버전').selectOption((await form.getByLabel('복구 기준 버전').locator('option', { hasText: before.policyId }).getAttribute('value'))!);
  await form.getByLabel('복구 사유').fill('Canary 차량 감속 이상 — 직전 배포 버전으로 되돌림');
  await form.getByLabel('승인대상자').selectOption('usr-opslead');
  await form.getByRole('button', { name: '미리보기' }).click();
  await expect(form).toContainText('적용 가능 — 요청할 수 있습니다');
  await form.getByRole('button', { name: '수동 롤백 요청' }).click();
  const created = form.getByRole('status').filter({ hasText: '만들었습니다' });
  await expect(created).toBeVisible();
  const requestId = (await created.innerText()).match(/RBR-\d{5}/)![0];
  await shot(page, 'rollback-requested');

  // 9. 운영 리더 승인 — 알림 종의 승인 요청, 지정 승인대상자만
  await as(page, 'opslead', `/ops/rollback?request=${requestId}`);
  await page.locator('.sh-ntf > button').click();
  await expect(page.locator('.sh-ntf__pop')).toContainText('수동 롤백 승인 요청');
  await page.keyboard.press('Escape');
  const item = page.locator(`[data-testid="rollback-pending"][id="${requestId}"]`);
  await item.getByLabel('승인 의견').fill('이상 징후 확인 — 직전 버전 복구 승인');
  await item.getByRole('button', { name: '승인', exact: true }).click();
  await expect(item).toContainText('승인됨 — 실행 대기');
  await shot(page, 'rollback-approved');

  // 10. 실행(출시) — 재검증 뒤 복구 기준 버전을 같은 내용으로 다시 서명해 게시
  await as(page, 'coordinator', `/ops/rollback?request=${requestId}`);
  await page.locator(`[data-testid="rollback-pending"][id="${requestId}"]`).getByRole('button', { name: '실행', exact: true }).click();
  await expect(page.locator(`[data-testid="rollback-pending"][id="${requestId}"]`)).toContainText('실행됨');
  await shot(page, 'rollback-executed');

  // 11. 차량 회신 — 게시본 목록 맨 위(정책 롤백 게시본), 회신이 몇 초에 걸쳐 들어오고 끊긴 차량은 다시 제출
  await page.goto('/deployments');
  const top = page.locator('#main tbody tr').first();
  await expect(top).toContainText(FLAG);
  await top.click();
  await page.waitForURL(/\/deployments\/PUB-\d{5}$/);
  const rollbackPub = page.url().split('/').pop()!;
  await expect(page.locator('#main')).toContainText(/회신|확인/);
  // 현 게시본의 실제 상태와 수렴을 확인한다. 상세에는 옛 목록용 진행 막대가 없다.
  // (상태 대기 — 고정 대기 없음)
  const currentPublication = page.locator(`[data-publication-id="${rollbackPub}"]`);
  await expect(currentPublication).toHaveAttribute('data-publication-targets', /^\d+$/);
  const targetCount = Number(await currentPublication.getAttribute('data-publication-targets'));
  expect(targetCount, '복구 게시본의 실제 대상 차량이 있어야 한다').toBeGreaterThan(0);
  await expect(currentPublication.locator('[data-ads-convergence]')).toBeVisible();
  await expect(currentPublication.locator('[data-state="error"]')).toHaveCount(0);
  const retry = page.getByRole('button', { name: '다시 제출' }).first();
  await expect.poll(async () => (await currentPublication.getAttribute('data-publication-status')) === 'CONFIRMED' || (await retry.isVisible()), { timeout: 30_000 }).toBe(true);
  await shot(page, 'rollback-replies');
  if (await retry.isVisible()) {
    await retry.click();
    await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('통신 복구 확인 — 끊긴 차량에 다시 보내기');
    await page.getByRole('dialog').getByRole('button', { name: '다시 제출' }).click();
    // 다시 제출이 받아들여지면 창이 닫힌다(성공 뒤에만 닫힘)
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  // 남은 차량 회신 → 같은 게시본 CONFIRMED와 전 대상 차량의 APPLIED 집계를 함께 확인한다.
  await expect.poll(async () => {
    await page.reload();
    // The route wrapper exists before its publication request finishes. Read a loaded
    // state before reloading again, while preserving the outer confirmation deadline.
    await expect(currentPublication).toHaveAttribute('data-publication-status', /\S+/, { timeout: 5_000 });
    return currentPublication.getAttribute('data-publication-status');
  }, { timeout: 30_000, intervals: [1_000] }).toBe('CONFIRMED');
  await expect(currentPublication.locator('[data-key-message]')).toContainText(`대상 ${targetCount}대 모두 적용 확인`);
  await expect(currentPublication.locator('[data-ads-convergence]')).toBeVisible();
  await expect(currentPublication.locator('[data-state="error"]')).toHaveCount(0);
  await shot(page, 'rollback-confirmed');

  // 12. 롤백 완료(게시본이 모두 확인되면) — 이력, 복구 기준 버전 DEPLOYED, Unleash 대조(배포가 바뀌어 drift → 동기화 → 같음)
  await page.goto('/ops/rollback');
  await expect(page.locator('#main')).toContainText(rollbackPub);
  const latest = page.getByRole('row', { name: /RBX-\d{5}/ }).first();
  await expect.poll(async () => (await page.reload(), await latest.innerText()), { timeout: 40_000, intervals: [2_000] }).toContain('완료');
  await shot(page, 'rollback-completed');
  await page.goto(`/policies/${before.policyId}`);
  await expect(page.locator('#main')).toContainText('DEPLOYED');
  const unleash = page.getByRole('region', { name: 'Policy Tool 연계 (Unleash)' });
  await expect(unleash).toContainText(`fp-policy=${before.policyId}@r1`);
  await unleash.getByRole('button', { name: 'Unleash 동기화' }).click();
  await expect(unleash).toContainText('계획과 같습니다', { timeout: 20_000 });
  await shot(page, 'unleash-synced');
  await page.goto('/audit');
  await expect(page.locator('#main')).toContainText(/되돌리기 실행/);

  // 13. 처음 상태로 — 상단 '시연 데이터 초기화'
  await page.getByTestId('demo-reset-open').click();
  await page.getByTestId('demo-reset').getByRole('button', { name: '처음 상태로 되돌리기' }).click();
  await page.goto('/policies');
  await expect(page.locator('#main')).not.toContainText(policyId);
  expect(await page.evaluate(() => localStorage.getItem('ff.sim'))).toBeNull();
  expect(await page.evaluate(() => (window as any).__simUnhandled ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

// 같은 값의 새 판 — 스냅샷의 배포 Flag마다 차량 값이 같은 새 판이 배포돼 있고 운영자가 앞 판 되돌리기를 운영 리더 승인 대기로 올려 두었다.
// 운영 리더가 하나는 반려, 하나는 승인 → 출시 담당이 실행(앞 판 재서명 게시). 실행 이력의 상태 거르기는 어느 상태를 골라도 오류 상자가 없다.
test('정적 시연: 같은 값의 새 판 되돌리기 — 운영 리더 반려·승인 → 실행, 실행 이력 상태 거르기', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const pending = (await (await page.request.get('/api-snapshot/rollback-requests_status_REQUESTED.json')).json()).items as { requestId: string; deploymentId: string }[];
  expect(pending.length, '운영 리더 승인 대기 되돌리기 요청이 둘 이상').toBeGreaterThan(1);
  const [no, yes] = [pending[pending.length - 1], pending[pending.length - 2]];
  const item = (id: string) => page.locator(`[data-testid="rollback-pending"][id="${id}"]`);

  await as(page, 'opslead', `/ops/rollback?request=${no.requestId}`);
  // 실행 이력 상태 거르기(쓰기 전) — 질의 스냅샷이 없는 상태도 오류 상자 없이 서버 규칙대로 거른다
  const history = page.locator('section.ds-panel', { has: page.locator('#rb-history-h') });
  // 고른 뒤 결과(빈 결과 표식 또는 기대 행)가 나타나는지로 기다린다 — 오류 상자(질의 스냅샷 없음)면 그 표식이 나오지 않아 실패한다
  const empty = history.locator('[data-state="empty"]');
  const pick = async (label: string) => {
    await history.getByLabel('상태').selectOption({ label });
    await expect(history.locator('[data-state="loading"]')).toHaveCount(0);
  };
  const clean = async () => {
    await expect(history.locator('[data-state="error"]')).toHaveCount(0);
    await expect(history).not.toContainText('데모에 없는 데이터');
  };
  // 서버가 만들 수 없는 '요청'은 선택지에 없다(늘 빈 결과)
  await expect(history.getByLabel('상태').locator('option')).toHaveText(['전체', '실행 중', '완료', '실패']);
  await pick('실패');
  await expect(empty).toBeAttached();
  await clean();
  await pick('완료');
  await expect(history.getByRole('row', { name: /RBX-00001/ })).toBeVisible();
  await clean();
  await pick('전체');

  // 반려 — 지정 승인대상자(운영 리더), 의견 필수
  await item(no.requestId).getByLabel('승인 의견').fill('현장 확인 완료 — 되돌릴 필요 없음');
  await item(no.requestId).getByRole('button', { name: '반려', exact: true }).click();
  await expect(item(no.requestId)).toContainText('반려 · usr-opslead', { timeout: 20_000 }); // 결정 쓰기는 받아 둔 요청·계획 목록을 다시 읽어 계산 — 병렬 실행 부하에서 5초를 넘었다(통합 12단계)
  await expect(item(no.requestId).getByRole('button')).toHaveCount(0);
  await shot(page, 'same-value-rejected');

  // 승인 → 실행(출시) — 앞 판을 같은 값으로 다시 서명해 게시
  await page.goto(`/ops/rollback?request=${yes.requestId}`);
  await item(yes.requestId).getByLabel('승인 의견').fill('문구 정리 판 현장 확인 전 — 앞 판으로 되돌림 승인');
  await item(yes.requestId).getByRole('button', { name: '승인', exact: true }).click();
  await expect(item(yes.requestId)).toContainText('승인됨 — 실행 대기', { timeout: 20_000 }); // 결정 쓰기는 받아 둔 요청·계획 목록을 다시 읽어 계산 — 병렬 실행 부하에서 5초를 넘었다(통합 12단계)
  await as(page, 'coordinator', `/ops/rollback?request=${yes.requestId}`);
  await item(yes.requestId).getByRole('button', { name: '실행', exact: true }).click();
  await expect(item(yes.requestId)).toContainText('실행됨');
  await shot(page, 'same-value-executed');

  // 실행 이력 상태 거르기(쓰기 뒤) — 실행 중 = 방금 실행, 완료 = 스냅샷 이력
  await pick('실행 중');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toBeVisible();
  await expect(history.getByRole('row', { name: /RBX-00001/ })).toHaveCount(0);
  await pick('완료');
  await expect(history.getByRole('row', { name: /RBX-00001/ })).toBeVisible();
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toHaveCount(0);
  await pick('실패');
  await expect(empty).toBeAttached();
  await pick('전체');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toBeVisible();
  await clean();
  await shot(page, 'history-filter');
  expect(await page.evaluate(() => (window as any).__simUnhandled ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

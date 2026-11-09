// 공개 시연 사이트 — 정책 운영 흐름을 브라우저 안 시연 데이터로 끝까지(설계 docs/20-architecture/20-61-browser-simulator.md, api/sim/handlers/policy-ops).
// (작성) 정책 작성 → 가상검증 → 분야별 검증 8종 GO → (승인) 정책 승인 → (출시) 서버 배포: F3 Feature라 Canary 5% → (운영) 확대 시도는 관측 기간·
// 열린 이상 징후로 거부 → 이상 징후 확인 → (출시) 수동 롤백 요청(지정 승인대상자) → (운영 리더) 승인 → (출시) 실행: 복구 기준 버전 재게시 → 차량 회신 →
// 끊긴 차량 다시 제출 → 롤백 완료 → Unleash 대조 화면이 바뀐 배포를 본다 → '시연 데이터 초기화'로 처음 상태. 단계별 화면은 SHOTS 폴더(1366 폭)에.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { settle } from '../tests/settle';

const SHOTS = process.env.POLICY_OPS_SHOTS ?? join(__dirname, '..', 'test-results', 'policy-ops-shots');
const FEAT = 'FEAT-00022';
const FLAG = 'care_00022_param';
let n = 0;
const shot = async (page: Page, name: string) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
};
/** Normal internal navigation: wait for the actual module/data read, then reject errors. */
async function visit(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await settle(page);
}

/** 데모 역할 전환(상단 역할 선택) — 역할 홈으로 옮겨 간 뒤 원하는 화면으로 */
async function as(page: Page, role: string, url: string) {
  await page.getByRole('combobox', { name: '역할', exact: true }).selectOption(role);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await visit(page, url);
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Review the real signing cohort before submitting, rather than clicking while scope is absent. */
async function reviewDeployScope(page: Page) {
  const preview = page.getByRole('dialog').locator('[data-bulk="deploy"]');
  await settle(page, { scope: '[role="dialog"]' });
  await expect(preview).toBeVisible();
  const heading = await preview.locator('.adc-path__state').innerText();
  expect(heading).toMatch(/^서명 대상 [\d,]+대 — 제외 0대$/);
  const count = Number(heading.match(/서명 대상 ([\d,]+)대/)![1].replace(/,/g, ''));
  expect(count).toBeGreaterThan(0);
  await expect(preview.getByRole('region', { name: '일괄 명령 미리보기', exact: true })).toBeVisible();
  await expect(preview).toContainText('F3');
  await expect(preview).toContainText('DC2');
}

test('정적 시연: 정책 작성 → 8종 검증 → 승인 → Canary 배포 → 확대 판정 → 이상 확인 → 롤백 → 차량 회신 → 처음 상태로', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await login(page);
  // 지금 배포된 이 flag의 정책(롤백 복구 기준이 된다)
  const captured = (await (await page.request.get('/api-snapshot/policies_status_DEPLOYED.json')).json()).items.find((p: { flagKey: string }) => p.flagKey === FLAG);
  expect(captured, `${FLAG} 배포 정책이 스냅샷에 있어야 한다`).toBeTruthy();
  // The native capture honestly has no vehicle confirmation. Build a real local
  // approved/confirmed baseline instead of manufacturing a completed native artifact.
  const before = await createApprovedPolicy(page, captured, `${captured.description} · 확인된 복구 기준판`);
  await completePolicyDelivery(page, before.flagKey);

  // 1. 작성 — 같은 flag의 새 판(감속 시작 거리 조정)
  await as(page, 'author', '/policies/new');
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
  // Review all current policy evidence before opening the deployment command.
  await page.waitForLoadState('networkidle');
  await settle(page);
  await page.getByRole('button', { name: '서버 배포' }).click();
  await reviewDeployScope(page);
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('감속 시작 거리 조정판 — Canary부터');
  await page.getByRole('dialog').getByRole('button', { name: '서버 배포' }).click();
  // Await actual command completion, including signed publication and active refresh.
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#main')).toContainText('DEPLOYED');
  await expect(page.getByRole('region', { name: 'Feature Flag 정책·승인' })).toContainText('5% / 100%');
  await shot(page, 'deployed-canary');
  await visit(page, '/policies');
  await expect(page.getByRole('row', { name: new RegExp(before.policyId) })).toContainText('RETIRED');

  // 6. 확대 예방 거부(운영) — 실제 관측 0/24시간·열린 이상 징후가 있어 제출을 막는다(서버 거부 회귀는 별도 유지)
  await as(page, 'operator', `/policies/${policyId}`);
  await page.getByRole('button', { name: '단계 조정' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('코호트 비율 (basis points, 10000 = 100%)').fill('2000');
  await drawer.getByLabel('사유', { exact: true }).fill('Canary 결과 양호 — 20%로 확대');
  // The real expansion reader now exposes the existing preventive UI guard.
  // Verify that the unsafe command cannot be submitted, rather than force-clicking it.
  await expect(drawer.getByRole('button', { name: '단계 조정' })).toBeDisabled();
  await expect(drawer.getByRole('note')).toContainText('Canary 관측 0시간');
  await expect(drawer.getByRole('note')).toContainText('24시간');
  await expect(drawer.getByRole('note')).toContainText('열린 이상 징후 1건');
  await shot(page, 'expand-refused');
  await page.keyboard.press('Escape');
  // Panel.id labels its heading; the accessible region is the actual panel container.
  // Read the background finding after the modal closes, keeping the ANM guard mandatory.
  const expansion = page.getByRole('region', { name: '확대 판정', exact: true });
  await expansion.scrollIntoViewIfNeeded();
  await expect(expansion.locator('[data-finding="OPEN_ANOMALY"]')).toContainText(/ANM-\d{5}/);

  // 7. 이상 징후 확인(운영) — 중단 기준이 된 열린 현장 이상
  const anomaly = (await (await page.request.get('/api-snapshot/anomalies.json')).json()).items.find((a: { featureId: string; status: string; kind: string }) => a.featureId === FEAT && a.status === 'OPEN' && a.kind !== 'DELIVERY');
  await visit(page, `/ops/anomalies?id=${anomaly.anomalyId}`);
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
  await form.getByRole('combobox', { name: /^승인대상자/ }).selectOption('usr-opslead');
  await form.getByRole('button', { name: '미리보기' }).click();
  await expect(form).toContainText('적용 가능 — 요청할 수 있습니다', { timeout: 20_000 });
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
  await expect(page.locator(`[data-testid="rollback-pending"][id="${requestId}"]`)).toContainText('실행됨', { timeout: 20_000 });
  await shot(page, 'rollback-executed');

  // 11. 차량 회신 — 게시본 목록 맨 위(정책 롤백 게시본), 회신이 몇 초에 걸쳐 들어오고 끊긴 차량은 다시 제출
  await visit(page, '/deployments');
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
  await visit(page, '/ops/rollback');
  await expect(page.locator('#main')).toContainText(rollbackPub);
  const latest = page.getByRole('row', { name: /RBX-\d{5}/ }).first();
  await expect.poll(async () => (await page.reload(), await settle(page), await latest.innerText()), { timeout: 40_000, intervals: [2_000] }).toContain('완료');
  await shot(page, 'rollback-completed');
  await visit(page, `/policies/${before.policyId}`);
  await expect(page.locator('#main')).toContainText('DEPLOYED');
  const unleash = page.getByRole('region', { name: 'Policy Tool 연계 (Unleash)' });
  await expect(unleash).toContainText(`fp-policy=${before.policyId}@r1`);
  await unleash.getByRole('button', { name: 'Unleash 동기화' }).click();
  await expect(unleash).toContainText('계획과 같습니다', { timeout: 20_000 });
  await shot(page, 'unleash-synced');
  await visit(page, '/audit');
  await expect(page.locator('#main')).toContainText(/되돌리기 실행/);

  // 13. 처음 상태로 — 상단 '시연 데이터 초기화'
  await page.getByTestId('demo-reset-open').click();
  await page.getByTestId('demo-reset').getByRole('button', { name: '처음 상태로 되돌리기' }).click();
  await expect(page.getByTestId('demo-reset')).toBeHidden();
  await visit(page, '/policies');
  await expect(page.locator('#main')).not.toContainText(policyId);
  // Policy-list reads may rehydrate internal GX metadata after reset. Check the
  // actual business overlay rather than mistaking its routing marker for policy edits.
  const resetState = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('ff-sim');
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('시연 DB가 없습니다.')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('overlay')) { db.close(); reject(new Error('시연 store가 없습니다.')); return; }
      const get = db.transaction('overlay', 'readonly').objectStore('overlay').get('current');
      get.onerror = () => { db.close(); reject(get.error); };
      get.onsuccess = () => { const row = get.result; db.close(); resolve({ policyIds: Object.keys(row?.entities?.policy ?? {}), createdPolicyIds: row?.created?.policy ?? [], audit: row?.audit ?? [], events: row?.events ?? [] }); };
    };
  }));
  expect(resetState).toEqual({ policyIds: [], createdPolicyIds: [], audit: [], events: [] });
  expect(await page.evaluate(() => (window as any).__simUnhandled ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

// 같은 값의 새 판 — 실제 승인·회신 완료된 기준판과 문구만 다른 새 판을 만들고, 운영 리더 검토로 복구한다.
// 운영 리더가 하나는 반려, 하나는 승인 → 출시 담당이 실행(앞 판 재서명 게시). 실행 이력의 상태 거르기는 어느 상태를 골라도 오류 상자가 없다.
type CapturedPolicy = { policyId: string; featureId: string; featureVersion: string; controlPoint: string; flagKey: string; description: string; enabled: boolean; safeDefault: boolean; entitlementCatalogId: string | null; strategies: unknown[]; rollout: { mode: string; basisPoints: number; salt: string } };

/** No fabricated pending requests: prepare a same-value successor and its rollback through actual UI actions. */
async function createApprovedPolicy(page: Page, before: CapturedPolicy, description: string) {
  expect(before.strategies).toEqual([]);
  expect(before.rollout).toEqual({ mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' });
  await as(page, 'author', '/policies/new');
  const create = page.locator('#main form');
  await create.getByLabel('Feature ID', { exact: true }).fill(before.featureId);
  await create.getByLabel('Version', { exact: true }).fill(before.featureVersion);
  await create.getByLabel('Control Point').selectOption(before.controlPoint);
  await create.getByLabel('flagKey').fill(before.flagKey);
  await create.getByLabel('설명').fill(description);
  await create.getByRole('checkbox', { name: /^정책 값:/ }).setChecked(before.enabled);
  await create.getByRole('checkbox', { name: /^Safe Default/ }).setChecked(before.safeDefault);
  await create.getByLabel('필요 사용 권한 상품 (선택)').fill(before.entitlementCatalogId ?? '');
  await create.getByRole('combobox', { name: '배포 범위', exact: true }).selectOption(before.rollout.mode);
  await create.getByRole('button', { name: '새 정책', exact: true }).click();
  await page.waitForURL(/\/policies\/POL-\d{5}$/);
  const policyId = new URL(page.url()).pathname.split('/').pop()!;
  const virtual = page.getByRole('region', { name: 'CARLA 가상검증' });
  await virtual.getByRole('button', { name: '가상검증 실행' }).click();
  await expect(virtual.locator('tbody tr')).toHaveCount(3, { timeout: 20_000 });
  await page.getByRole('button', { name: '분야별 검증 실행' }).first().click();
  await expect(page.locator('#main')).toContainText('GO — 승인 가능', { timeout: 20_000 });
  await expect(page.getByRole('region', { name: '분야별 검증 8종 (병렬)' }).locator('.ds-validator[data-result="PASS"]')).toHaveCount(8);
  await as(page, 'approver', `/policies/${policyId}`);
  await page.getByRole('button', { name: '정책 승인 / 반려' }).click();
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('동일 차량 값·검증 근거 독립 확인');
  await page.getByRole('dialog').getByRole('button', { name: '정책 승인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await as(page, 'coordinator', `/policies/${policyId}`);
  await page.getByRole('button', { name: '서버 배포', exact: true }).click();
  await reviewDeployScope(page);
  await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('같은 차량 값의 새 판 — 복구 이력 검증');
  await page.getByRole('dialog').getByRole('button', { name: '서버 배포', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#main')).toContainText('DEPLOYED');
  return { ...before, policyId, description };
}

/** Establish confirmed local delivery; captured native receipts are never rewritten. */
async function completePolicyDelivery(page: Page, flagKey: string) {
  await visit(page, '/deployments');
  const row = page.locator('#main tbody tr').first();
  await expect(row).toContainText(flagKey);
  await row.click();
  await page.waitForURL(/\/deployments\/PUB-\d{5}$/);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const publication = page.locator(`[data-publication-id="${id}"]`);
  await expect(publication).toHaveAttribute('data-publication-targets', /^\d+$/);
  const targets = Number(await publication.getAttribute('data-publication-targets'));
  expect(targets).toBeGreaterThan(0);
  const retry = page.getByRole('button', { name: '다시 제출' }).first();
  await expect.poll(async () => (await publication.getAttribute('data-publication-status')) === 'CONFIRMED' || await retry.isVisible(), { timeout: 30_000 }).toBe(true);
  if (await retry.isVisible()) {
    await retry.click();
    await page.getByRole('dialog').getByLabel('사유', { exact: true }).fill('실제 미회신 코호트 통신 복구 확인 — 재전송');
    await page.getByRole('dialog').getByRole('button', { name: '다시 제출', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await expect(publication).toHaveAttribute('data-publication-status', 'CONFIRMED', { timeout: 30_000 });
  await expect(publication.locator('[data-key-message]')).toContainText(`대상 ${targets}대 모두 적용 확인`);
  await expect(publication.locator('[data-state="error"]')).toHaveCount(0);
  return id;
}

async function prepareSameValueRollback(page: Page, source: CapturedPolicy) {
  const before = await createApprovedPolicy(page, source, `${source.description} · 확인된 복구 기준판`);
  await completePolicyDelivery(page, before.flagKey);
  // Vehicle values remain identical; the reviewed description is part of the signed PolicySpec.
  const current = await createApprovedPolicy(page, source, `${source.description} · 문구 정리판`);
  return requestSameValueRollback(page, before, current);
}

async function requestSameValueRollback(page: Page, before: CapturedPolicy, current: CapturedPolicy) {
  await as(page, 'coordinator', '/ops/rollback');
  await page.getByRole('row', { name: new RegExp(before.flagKey) }).first().click();
  const form = page.getByRole('region', { name: '롤백 요청' });
  const recovery = form.getByLabel('복구 기준 버전');
  const option = recovery.locator('option', { hasText: before.policyId });
  await expect(option).toHaveCount(1);
  await recovery.selectOption((await option.getAttribute('value'))!);
  await form.getByLabel('복구 사유').fill('같은 값의 직전 판 — 지정 승인대상자 검토 요청');
  await form.getByRole('combobox', { name: /^승인대상자/ }).selectOption('usr-opslead');
  await form.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(form).toContainText('적용 가능 — 요청할 수 있습니다', { timeout: 20_000 });
  await form.getByRole('button', { name: '수동 롤백 요청', exact: true }).click();
  const result = form.getByRole('status').filter({ hasText: '만들었습니다' });
  await expect(result).toBeVisible();
  const requestId = (await result.innerText()).match(/RBR-\d{5}/)![0];
  return { requestId, policyId: current.policyId, flagKey: before.flagKey, before, current };
}

test('정적 시연: 같은 값의 새 판 되돌리기 — 운영 리더 반려·승인 → 실행, 실행 이력 상태 거르기', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const source = await page.request.get('/api-snapshot/policies_status_DEPLOYED.json');
  expect(source.ok()).toBe(true);
  const deployed = (await source.json()).items as CapturedPolicy[];
  const candidates = ['care_00022_param', 'care_00022_signal'].map((flag) => deployed.find((p) => p.flagKey === flag));
  expect(candidates.every(Boolean), '실제 배포된 두 Flag 원천이 있어야 한다').toBe(true);
  const priorResponse = await page.request.get('/api-snapshot/rollbacks.json');
  expect(priorResponse.ok()).toBe(true);
  const prior = (await priorResponse.json()).items as { executionId: string; status: string }[];
  const completedBefore = prior.filter((r) => r.status === 'COMPLETED');
  const no = await prepareSameValueRollback(page, candidates[0]!);
  const item = (id: string) => page.locator(`[data-testid="rollback-pending"][id="${id}"]`);

  await as(page, 'opslead', `/ops/rollback?request=${no.requestId}`);
  // 실행 이력 상태 거르기(쓰기 전) — 질의 스냅샷이 없는 상태도 오류 상자 없이 서버 규칙대로 거른다
  const history = page.locator('section.ds-panel', { has: page.locator('#rb-history-h') });
  // 고른 뒤 결과(빈 결과 표식 또는 기대 행)가 나타나는지로 기다린다 — 오류 상자(질의 스냅샷 없음)면 그 표식이 나오지 않아 실패한다
  const empty = history.locator('[data-state="empty"]');
  const pick = async (label: string) => {
    await history.getByLabel('상태').selectOption({ label });
    await settle(page, { scope: 'section.ds-panel:has(#rb-history-h)' });
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
  await expect(history.getByRole('row', { name: /RBX-\d{5}/ })).toHaveCount(completedBefore.length);
  for (const row of completedBefore) await expect(history.getByRole('row', { name: new RegExp(row.executionId) })).toBeVisible();
  await clean();
  await pick('전체');

  // 반려 — 지정 승인대상자(운영 리더), 의견 필수
  await item(no.requestId).getByLabel('승인 의견').fill('현장 확인 완료 — 되돌릴 필요 없음');
  await item(no.requestId).getByRole('button', { name: '반려', exact: true }).click();
  await expect(item(no.requestId)).toContainText('반려 · usr-opslead', { timeout: 20_000 }); // 결정 쓰기는 받아 둔 요청·계획 목록을 다시 읽어 계산 — 병렬 실행 부하에서 5초를 넘었다(통합 12단계)
  await expect(item(no.requestId).getByRole('button')).toHaveCount(0);
  await shot(page, 'same-value-rejected');

  // 반려는 배포·확인된 복구 기준판을 바꾸지 않는다. 같은 두 판을 다시
  // 미리보기해 새 요청을 만들고, 독립 승인 뒤 실행한다(새 정책판을 중복 작성하지 않음).
  const yes = await requestSameValueRollback(page, no.before, no.current);
  expect(yes.requestId).not.toBe(no.requestId);
  await as(page, 'opslead', `/ops/rollback?request=${yes.requestId}`);
  await item(yes.requestId).getByLabel('승인 의견').fill('문구 정리 판 현장 확인 전 — 앞 판으로 되돌림 승인');
  await item(yes.requestId).getByRole('button', { name: '승인', exact: true }).click();
  await expect(item(yes.requestId)).toContainText('승인됨 — 실행 대기', { timeout: 20_000 }); // 결정 쓰기는 받아 둔 요청·계획 목록을 다시 읽어 계산 — 병렬 실행 부하에서 5초를 넘었다(통합 12단계)
  await as(page, 'coordinator', `/ops/rollback?request=${yes.requestId}`);
  await item(yes.requestId).getByRole('button', { name: '실행', exact: true }).click();
  await expect(item(yes.requestId)).toContainText('실행됨', { timeout: 20_000 });
  await shot(page, 'same-value-executed');

  // 실행 이력 상태 거르기(쓰기 뒤) — 새 실제 실행과 캡처 원천 이력을 구분한다.
  await pick('실행 중');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toBeVisible();
  await expect(history.getByRole('row', { name: /RBX-\d{5}/ })).toHaveCount(prior.filter(row => row.status === 'RUNNING').length + 1);
  for (const row of completedBefore) await expect(history.getByRole('row', { name: new RegExp(row.executionId) })).toHaveCount(0);
  await pick('완료');
  await expect(history.getByRole('row', { name: /RBX-\d{5}/ })).toHaveCount(completedBefore.length);
  for (const row of completedBefore) await expect(history.getByRole('row', { name: new RegExp(row.executionId) })).toBeVisible();
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toHaveCount(0);
  await pick('실패');
  await expect(empty).toBeAttached();
  await pick('전체');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toBeVisible();
  await clean();
  await completePolicyDelivery(page, yes.flagKey);
  await visit(page, `/ops/rollback?request=${yes.requestId}`);
  await expect.poll(async () => {
    await page.reload();
    return history.getByRole('row', { name: new RegExp(yes.requestId) }).innerText();
  }, { timeout: 40_000, intervals: [2_000] }).toContain('완료');
  await pick('완료');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toBeVisible();
  await expect(history.getByRole('row', { name: /RBX-\d{5}/ })).toHaveCount(completedBefore.length + 1);
  await pick('실행 중');
  await expect(history.getByRole('row', { name: new RegExp(yes.requestId) })).toHaveCount(0);
  await clean();
  await shot(page, 'history-filter');
  expect(await page.evaluate(() => (window as any).__simUnhandled ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

// Actual browser registration and version creation must have usable detail reads,
// including queries whose errors are not rendered by the active tab.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { pickPrimaryRef, submitProposedFeature } from '../tests/refdb';
import { settle } from '../tests/settle';

const tabs = ['overview', 'flags', 'evaluations', 'refs', 'safety', 'gates', 'deps', 'trace', 'links', 'taxonomy', 'ops', 'ext', 'baseline', 'history', 'audit'];
interface QueryState { key: unknown[]; status: string; fetching: boolean; error: null | { code: string; status: number; message: string } }
async function queries(page: Page): Promise<QueryState[]> {
  return page.evaluate(() => {
    // Read the real provider; never replace data, invoke a command or mutate the cache.
    const host = document.querySelector('#root') as any;
    const key = Object.keys(host).find(k => k.startsWith('__reactContainer$'))!;
    const todo = [host[key], host[key]?.stateNode?.current, host[key]?.alternate], seen = new Set();
    while (todo.length) {
      const fiber = todo.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const client = fiber.memoizedProps?.client;
      if (client?.getQueryCache) return client.getQueryCache().getAll().map((q: any) => ({
        key: q.queryKey, status: q.state.status, fetching: q.state.fetchStatus === 'fetching',
        error: q.state.error ? { code: q.state.error.code, status: q.state.error.status, message: q.state.error.message } : null,
      }));
      todo.push(fiber.child, fiber.sibling, fiber.alternate);
    }
    throw new Error('The actual application QueryClient was not found.');
  });
}

async function visit(page: Page, url: string, allowEvidenceGuard = false) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main h1')).toBeVisible();
  await settle(page, allowEvidenceGuard ? { errors: null } : {});
  await expect.poll(async () => (await queries(page)).filter(q => q.fetching), { timeout: 15_000 }).toEqual([]);
}

async function audit(page: Page, path: string, info: TestInfo) {
  const records = [];
  for (const tab of tabs) {
    await visit(page, `${path}?tab=${tab}`, tab === 'flags');
    if (tab === 'baseline') {
      const comparison = page.getByRole('region', { name: '두 Baseline 비교', exact: true });
      const left = comparison.getByRole('combobox', { name: '기준', exact: true });
      const right = comparison.getByRole('combobox', { name: '비교 대상', exact: true });
      if (!(await left.inputValue()) || !(await right.inputValue())) {
        await expect(comparison.locator('[data-state="empty"]')).toContainText('기준과 비교 대상 Baseline을 선택');
        await left.selectOption('BL-00001');
        await right.selectOption('BL-00002');
        await settle(page);
        await expect(comparison.getByTestId('bl-compare-summary')).toContainText(/추가 \d+ · 삭제 \d+ · 변경 \d+/);
      }
    }
    const current = await queries(page);
    const errors = current.filter(q => q.error);
    // A new Version has no captured code evidence. This explicit negative guard
    // must remain a refusal; it is not permission to ignore any other query error.
    for (const q of errors) {
      expect(['flagCoverage', 'flagReleaseGate'], JSON.stringify(q)).toContain(q.key[0]);
      expect(q.error, JSON.stringify(q)).toMatchObject({ status: 422, code: 'GUARD_FAILED' });
      expect(q.error!.message).toContain('Version-specific captured code evidence');
    }
    if (tab === 'flags') {
      const visible = await page.locator('#main [data-state="error"]').allTextContents();
      for (const message of visible) expect(message).toContain('Version-specific captured code evidence');
    }
    records.push({ tab, queries: current });
    // Preserve completed reads locally even if a later tab fails.
    await info.attach(`actual-feature-tab-${tab}`, { body: JSON.stringify({ path, tab, queries: current }), contentType: 'application/json' });
  }
  const required = ['featureFlags', 'featureEvaluations', 'featureTrace', 'featureOpsMetrics', 'featureVariability', 'almWorkProducts', 'gateSnapshot', 'supportDrills'];
  const all = records.flatMap(r => r.queries);
  for (const route of required) expect(all.some(q => q.key[0] === route && q.status === 'success' && !q.error), route).toBe(true);
  await info.attach('actual-feature-tab-reads', { body: JSON.stringify({ path, records }, null, 2), contentType: 'application/json' });
  await page.reload();
  await visit(page, `${path}?tab=safety`);
  expect((await queries(page)).filter(q => q.error)).toEqual([]);
}

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('ID').fill('FF');
  await page.getByLabel('Password').fill('FF');
  await page.getByRole('button', { name: '플랫폼 들어가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('combobox', { name: '역할', exact: true }).selectOption('author');
});

test('새 Feature 실제 등록 → 15개 상세 탭 조회·새로고침 복구', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await visit(page, '/feature/propose');
  await pickPrimaryRef(page, 'AD-PRK-004', 'AD-PRK-004');
  const main = page.locator('#main');
  await main.getByLabel('이름').fill('신규 Feature 상세 조회 회귀');
  await main.getByLabel(/요구사항 ID/).fill('REQ-DEMO-LOCAL-READS');
  await main.locator('input[name=country]').fill('KR');
  await main.locator('input[name=vehicleModel]').fill('NX4 PE');
  await main.getByLabel('트림').fill('Signature');
  await main.getByLabel(/UPG-VC/).fill('F111A111001');
  await main.getByLabel('담당').fill('Parking기획팀');
  for (const cb of await main.getByRole('group', { name: 'Control Point', exact: true }).getByRole('checkbox').all()) if (await cb.isChecked()) await cb.uncheck();
  await submitProposedFeature(page);
  await expect(page).toHaveURL(/\/features\/FEAT-\d{5}\/0\.1\.0/, { timeout: 20_000 });
  await audit(page, new URL(page.url()).pathname, info);
  expect(errors).toEqual([]);
});

test('기존 Feature 실제 새 Version → 15개 상세 탭 조회·새로고침 복구', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await visit(page, '/features/FEAT-00022/1.0.0');
  await page.getByRole('button', { name: '새 Version', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('변경 사유').fill('새 Version 상세 조회 회귀');
  await dialog.getByRole('button', { name: '새 Version 만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/features\/FEAT-00022\/1\.1\.0/, { timeout: 20_000 });
  await audit(page, new URL(page.url()).pathname, info);
  expect(errors).toEqual([]);
});

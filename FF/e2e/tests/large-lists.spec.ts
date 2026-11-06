// readiness: RD-UX-03 — 큰 목록: 1만 행 Feature 목록은 한 쪽(100행)만 그리고 쪽 넘김으로 끝까지, 감사 이력은 커서로 더 불러온다.
import { expect, test } from '@playwright/test';
import { lists as L } from '../../frontend/src/copy/lists';

test('Feature 목록 1만 행 — DOM 행은 100, 쪽 넘김으로 다음 행, 화면이 멈추지 않는다', async ({ page }) => {
  await page.route(/\/api\/features(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const base = body.items[0];
    body.items = Array.from({ length: 10_000 }, (_, i) => ({ ...base, featureId: `FEAT-${String(90000 + i).padStart(5, '0')}`, version: '1.0.0', isLatest: true, name: `대량 시험 ${i + 1}` }));
    body.total = body.items.length;
    await route.fulfill({ response: res, json: body });
  });
  const t0 = Date.now();
  await page.goto('/features');
  const rows = page.locator('table.ds-table tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBe(100);
  await expect(page.locator('.ds-pager').first()).toContainText(L.range(1, 100, 10_000));
  await page.locator('.ds-pager').first().getByRole('button', { name: new RegExp(`${L.next}$`) }).click();
  await expect(page.locator('.ds-pager').first()).toContainText(L.range(101, 200, 10_000));
  expect(await rows.count()).toBe(100);
  expect(Date.now() - t0).toBeLessThan(30_000);
});

test('감사 이력 — 커서로 더 불러오면 덧붙고, 마지막이면 버튼이 사라진다', async ({ page }) => {
  const entry = (id: number) => ({ id, at: `2026-10-24T0${id % 10}:00:00.000Z`, actorId: `usr-${id}`, actorRole: 'AUDITOR', action: 'FEATURE_CREATE', target: `FEAT-0${id}@1.0.0`, result: 'ALLOWED', reason: null, before: null, after: null, correlationId: `c-${id}`, componentId: 'D01-01' });
  const seen: string[] = [];
  await page.route(/\/api\/audit(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    const cursor = url.searchParams.get('cursor');
    const body = cursor ? { items: [entry(7), entry(6)], nextCursor: null } : { items: [entry(10), entry(9), entry(8)], nextCursor: 'eyJpZCI6OH0' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/audit');
  const rows = page.locator('table.ds-table tbody tr');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: L.loadMore }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole('button', { name: L.loadMore })).toHaveCount(0);
  expect(seen.some((s) => s.includes('cursor=eyJpZCI6OH0'))).toBe(true);
});

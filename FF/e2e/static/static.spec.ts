// 정적 데모 — 모든 메뉴·하위 화면이 스냅샷만으로 열린다: 요청한 /api-snapshot/ 파일은 모두 200·JSON이어야 한다.
// 빠진 파일은 SPA 대체 응답(index.html)으로 와서 화면이 오류가 된다 — 그 URL을 모아 실패 메시지로 낸다(tools/snapshot-api.ts에 추가할 목록).
import { expect, test } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from '../tests/menu';

const targets = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))];

for (const t of targets) {
  test(`정적 데모: ${t.title} (${t.url})`, async ({ page }) => {
    const missing = new Set<string>();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (!u.pathname.includes('/api-snapshot/')) return;
      if (r.status() !== 200 || !(r.headers()['content-type'] ?? '').includes('json')) missing.add(decodeURIComponent(u.pathname.replace(/^.*\/api-snapshot\//, '')));
    });
    await page.goto(t.url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    // 탭마다 따로 조회한다 — 모든 탭을 차례로 연다
    const tabs = page.getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await page.waitForLoadState('networkidle');
    }
    expect([...missing], `스냅샷에 없는 파일 — tools/snapshot-api.ts에 추가`).toEqual([]);
    expect(errors).toEqual([]);
  });
}

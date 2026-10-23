// 같은 말을 한 번만(3초 테스트 잔여 UX3-10·11, 2026-10-23) — 모든 메뉴 화면과 하위 화면(drill-down)에서:
//   ① Panel 머리 제목이 H1이나 지금 열린 탭 이름과 같지 않다(같으면 Panel이 머리를 생략하고 aria-labelledby로 H1·탭을 가리킨다)
//   ② 셸 메뉴 제목(그룹 이름)이 H1과 같지 않다
// 화면의 첫 탭 줄은 탭마다 열어 본다.
// three-second.spec과 같은 대상·제외 규칙(BDC 데모 /twin/*, 디자인 갤러리 /_design 제외).
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

const SKIP = (u: string) => u.startsWith('/twin') || u.startsWith('/_design');

async function oncePerScreen(page: Page, url: string) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(url);
  await expect(page.locator('#main h1').first()).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);

  const check = async (where: string) => {
    const found = await page.evaluate(() => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const h1 = norm(document.querySelector('#main h1')?.textContent);
      const tabs = [...document.querySelectorAll('#main [role="tab"][aria-selected="true"]')].map((t) => {
        const c = t.cloneNode(true) as HTMLElement;
        c.querySelectorAll('.ds-tab__count').forEach((x) => x.remove());
        return norm(c.textContent);
      });
      const panels = [...document.querySelectorAll('#main .ds-panel__head h2')]
        .filter((h) => (h as HTMLElement).getClientRects().length > 0)
        .map((h) => norm(h.textContent))
        .filter((t) => t && (t === h1 || tabs.includes(t)));
      const menu = norm(document.querySelector('.sh-panel__head h2')?.textContent);
      return { h1, tabs, panels, menu };
    });
    expect(found.panels, `${where}: Panel 제목이 H1("${found.h1}")·지금 탭(${found.tabs.join(', ')})과 같다`).toEqual([]);
    expect(found.menu, `${where}: 셸 메뉴 제목이 H1을 되풀이한다`).not.toBe(found.h1);
  };
  await check(url);
  // 첫 탭만이 아니라 화면의 모든 탭(첫 단계 탭 줄)을 차례로 연다 — 탭 안 Panel이 탭 이름을 되풀이하던 곳이 기본 탭 밖에 있었다
  const tabs = page.locator('#main .ds-tabs').first().locator('[role="tab"]');
  const n = await tabs.count();
  for (let i = 1; i < n; i++) {
    const label = (await tabs.nth(i).innerText()).trim();
    await tabs.nth(i).click();
    await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);
    await check(`${url} 탭 "${label}"`);
  }
}

for (const m of MENU_ENTRIES.filter((x) => !SKIP(x.menu))) test(`한 번만: ${m.title} (${m.menu})`, ({ page }) => oncePerScreen(page, m.menu));
for (const d of DRILLDOWNS.filter((x) => !SKIP(x.url))) test(`한 번만(하위): ${d.title} (${d.url})`, ({ page }) => oncePerScreen(page, d.url));

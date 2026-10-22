// 접근성(axe, WCAG 2.2 AA) — 메뉴 화면과 메뉴 밖 하위 화면(drill-down) 모두 serious/critical 0이 하드 규칙.
// 2026-10-23: wcag22aa 추가 — 클릭 대상 크기(2.5.8 target-size 24px)도 막는다(UI 하네스 2판 6단계).
// P10-C5: 레거시 화면이 모두 v2로 바뀌어 화면별 허용 건수(a11y-baseline.json 래칫)를 없앴다.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

async function axe(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('#main')).toBeVisible();
  // networkidle은 SSE(/events)처럼 열린 연결이 있으면 끝나지 않는다 — 로딩 표식이 사라질 때까지만 기다린다
  await page.waitForFunction(() => !document.querySelector('[data-state="loading"], [aria-busy="true"]'), null, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const detail = bad.map((v) => `${v.id} ×${v.nodes.length}: ${v.help}\n    ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.any[0] ?? n.all[0] ?? n.none[0])?.message ?? ''}`).join('\n    ')}`).join('\n');
  expect(bad.reduce((n, v) => n + v.nodes.length, 0), detail).toBe(0);
}

for (const m of MENU_ENTRIES) test(`axe: ${m.title} (${m.menu})`, ({ page }) => axe(page, m.menu));
for (const d of DRILLDOWNS) test(`axe(하위): ${d.title} (${d.url})`, ({ page }) => axe(page, d.url));

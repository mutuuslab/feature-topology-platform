// 접근성(axe, WCAG 2.1 AA) — 재디자인 화면은 serious/critical 0이 하드 규칙,
// 레거시 화면은 harness/a11y-baseline.json의 건수를 넘을 수 없다(래칫, 줄어들면 UPDATE_A11Y=1로 잠금).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_ENTRIES, V2_PATHS } from './menu';

const BASELINE = join(__dirname, '..', '..', 'harness', 'a11y-baseline.json');
const baseline: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const observed: Record<string, number> = {};

test.describe.configure({ mode: 'serial' });

for (const m of MENU_ENTRIES) {
  test(`axe: ${m.title} (${m.menu})`, async ({ page }) => {
    await page.goto(m.menu);
    await expect(page.locator('#main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const count = bad.reduce((n, v) => n + v.nodes.length, 0);
    observed[m.menu] = count;
    const detail = bad.map((v) => `${v.id} ×${v.nodes.length}: ${v.help}`).join('\n');
    if (V2_PATHS.includes(m.path)) expect(count, detail).toBe(0);
    else expect(count, `기준 ${baseline[m.menu] ?? '없음'}\n${detail}`).toBeLessThanOrEqual(baseline[m.menu] ?? count);
  });
}

test.afterAll(() => {
  if (process.env.UPDATE_A11Y === '1' || !existsSync(BASELINE)) {
    const merged = { ...baseline };
    for (const [k, v] of Object.entries(observed)) merged[k] = baseline[k] === undefined ? v : Math.min(baseline[k], v);
    writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(merged).sort()), null, 2) + '\n');
  }
});

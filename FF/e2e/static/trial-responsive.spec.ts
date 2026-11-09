import { expect, test } from '@playwright/test';
import { measureNarrow } from './narrow-measure';

for (const width of [390, 1366]) {
  test(`체험 분석 ${width}: 실제 차트 좌표·글자와 키보드 상세값`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/biz/trials');
    const charts = page.locator('.ds-viz svg');
    await expect(charts).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    const bounds = await charts.evaluateAll((svgs) => svgs.map((svg) => {
      const box = svg.getBoundingClientRect();
      return {
        width: box.width,
        available: svg.parentElement!.clientWidth,
        outside: [...svg.querySelectorAll('text')].filter((text) => {
          const r = text.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1;
        }).map((text) => text.textContent),
      };
    }));
    for (const chart of bounds) {
      expect(chart.width).toBeLessThanOrEqual(chart.available + 1);
      expect(chart.outside).toEqual([]);
    }
    const trend = charts.nth(1);
    await trend.focus();
    await trend.press('ArrowRight');
    await expect(page.locator('.ds-viz__tip').first()).toBeVisible();
    const first = await page.locator('.ds-viz__tip-title').textContent();
    await trend.press('ArrowRight');
    await expect(page.locator('.ds-viz__tip-title')).not.toHaveText(first!);
    const measure = await measureNarrow(page);
    expect(measure.doc).toBeLessThanOrEqual(1);
    expect(measure.main).toBeLessThanOrEqual(1);
    expect(measure.culprits).toEqual([]);
    expect(measure.clippedTools).toEqual([]);
    await trend.press('Escape');
    await expect(page.locator('.ds-viz__tip')).toHaveCount(0);
  });
}

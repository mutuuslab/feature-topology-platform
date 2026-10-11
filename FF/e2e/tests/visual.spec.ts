// 시각 회귀 @visual — 디자인 갤러리를 4조건(1366·1536·1920·시연 모드)으로 찍어 기준과 비교한다.
// OS·폰트 렌더 차이 때문에 Windows 로컬(npm run verify:full)에서만 돌린다. 기준 갱신: npm run update:visual -w @ff/e2e
import { expect, test } from '@playwright/test';

const CONDITIONS = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1536', w: 1536, h: 864, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];

for (const c of CONDITIONS) {
  test(`@visual 디자인 갤러리 ${c.name}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.addInitScript((present) => localStorage.setItem('ff.present', present ? '1' : '0'), c.present);
    await page.goto('/_design');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.sh-main')).toHaveScreenshot(`design-${c.name}.png`);
  });
}

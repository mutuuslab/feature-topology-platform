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

// 갤러리 아래쪽 부품은 .sh-main 스크롤 밖이라 위 전체 샷에 잡히지 않는다 — 부품 패널마다 따로 찍는다.
// 기능안전 부품(보고서 v1.1)과 관제실(다크) 영역: 가장 좁은 화면·가장 넓은 화면·시연 모드.
// 패널은 작아서 전역 허용치(0.2%)로는 글리프 모양 변화(●→–) 같은 접근성 신호가 빠져나간다 — 픽셀 수로 엄격하게 비교한다.
const STRICT = { maxDiffPixels: 8, maxDiffPixelRatio: undefined } as const;
const PANELS = ['safety-classes', 'safety-rules', 'safety-approvals', 'safety-stages', 'safety-replies'];
for (const c of CONDITIONS.filter((x) => x.name !== '1536')) {
  test(`@visual 기능안전 부품·관제실 영역 ${c.name}`, async ({ page }) => {
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.addInitScript((present) => localStorage.setItem('ff.present', present ? '1' : '0'), c.present);
    await page.goto('/_design');
    await page.evaluate(() => document.fonts.ready);
    for (const id of PANELS) {
      const panel = page.locator('section.ds-panel', { has: page.locator(`#${id}-h`) });
      await panel.scrollIntoViewIfNeeded();
      await expect(panel).toHaveScreenshot(`panel-${id}-${c.name}.png`, STRICT);
    }
    const zone = page.locator('.sh-main section[data-zone="ops"]');
    await zone.scrollIntoViewIfNeeded();
    await expect(zone).toHaveScreenshot(`zone-ops-${c.name}.png`, STRICT);
  });
}

// 핵심 거버넌스 화면 — v0.81 시드(메모리 DB)만 읽는 화면이라 결정적이다. 시계를 고정하고, 가장 좁은 화면과 가장 넓은 화면에서 본문을 찍는다.
// (실시간·이벤트·차량 화면은 시뮬레이터·SSE 때문에 시각 기준 대신 기능·레이아웃·접근성 e2e로 본다)
const CORE = [
  { name: 'features', url: '/features', ready: 'FEAT-00022' },
  { name: 'feature-detail', url: '/features/FEAT-00022/1.0.0', ready: 'FEAT-00022' },
  { name: 'baselines', url: '/baselines?tab=baselines', ready: 'BL-00028' },
  { name: 'topology', url: '/arch/topology', ready: 'FEAT-00022' },
  { name: 'products', url: '/products', ready: 'CAT-00019' },
  { name: 'precheck', url: '/precheck', ready: 'PRECHECK' },
  { name: 'upg', url: '/master/upg', ready: 'UPG' },
  { name: 'compliance', url: '/verify/compliance', ready: 'FFG-' },
];
for (const c of CONDITIONS.filter((x) => x.name === '1366' || x.name === '1920')) {
  for (const s of CORE) {
    test(`@visual 핵심 화면 ${s.name} ${c.name}`, async ({ page }) => {
      await page.clock.install({ time: new Date('2026-10-14T09:00:00+09:00') });
      await page.setViewportSize({ width: c.w, height: c.h });
      await page.addInitScript(() => localStorage.setItem('ff.present', '0'));
      await page.goto(s.url);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('#main')).toContainText(s.ready);
      await page.waitForFunction(() => !document.querySelector('[data-state="loading"], [aria-busy="true"]'));
      await expect(page.locator('.sh-main')).toHaveScreenshot(`core-${s.name}-${c.name}.png`);
    });
  }
}

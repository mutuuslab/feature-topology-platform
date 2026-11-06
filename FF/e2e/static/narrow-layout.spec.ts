// 정적 데모 — 폭 390·1024·1366에서 가로 넘침 0(2026-11-06 결함 두 건의 회귀 시험).
//  · /fleet/map '위치 원천' 설명 줄(KeyValue): 칸 최소 320px이 휴대폰 본문(약 270px)보다 넓어 본문 밖으로 나갔다(design.css .ds-kv)
//  · 상단 셸 헤더: 390 폭에서 도구 줄이 제 상자 안에서 잘려 로그아웃·알림이 보이지 않았다(shell.css 휴대폰 두 줄)
// 본문(.sh-main)은 스스로 가로 스크롤하는 상자라 문서 넘침만 보면 놓친다 — 본문 상자의 넘침도 함께 잰다.
import { expect, test } from '@playwright/test';
import { measureNarrow } from './narrow-measure';

const WIDTHS = [390, 1024, 1366];
const PAGES = [
  { url: '/fleet/map', ready: '#fm-privacy-h' },
  { url: '/', ready: '#main h1' },
];

const measure = measureNarrow;

for (const width of WIDTHS) {
  for (const p of PAGES) {
    test(`정적 데모: ${width} 폭 가로 넘침 0 — ${p.url}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(p.url);
      await expect(page.locator(p.ready).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const m = await measure(page);
      expect(m.doc, '문서 가로 넘침(px)').toBeLessThanOrEqual(1);
      expect(m.main, `본문 상자 가로 넘침(px) — ${m.culprits.join(', ')}`).toBeLessThanOrEqual(1);
      expect(m.clippedTools, '상단바에서 잘리거나 화면 밖에 있는 조작 요소').toEqual([]);
    });
  }
}

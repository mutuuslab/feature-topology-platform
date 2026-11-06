// 정적 데모 — 390 폭 전 화면 가로 넘침 0(2026-11-06 하네스 리뷰: narrow-layout.spec은 대표 두 화면만 봐서
// /learn·/procedures 카드 격자(minmax 340px)가 휴대폰 본문(약 300px) 밖으로 26px 나간 것을 놓쳤다).
// 메뉴·하위 화면 전부(menu.ts — static.spec과 같은 목록)와 외부 시스템 창·로그인 화면을 390×844로 연다.
import { expect, test } from '@playwright/test';
import { DRILLDOWNS, MENU_ENTRIES } from '../tests/menu';
import { measureNarrow } from './narrow-measure';

const targets = [...MENU_ENTRIES.map((m) => ({ title: m.title, url: m.menu })), ...DRILLDOWNS.map((d) => ({ title: d.title, url: d.url }))];

/**
 * 결함 기록(래칫) — 지금 390 폭에서 넘치는 화면과 원인. test.fail이라 고쳐지면 '예상 밖 통과'로 실패한다 → 이 목록에서 지운다.
 * 새 화면이 넘치면 바로 실패한다. (2026-11-06 하네스 리뷰 — 공용 원인 3가지는 design.css에서 고쳤다: 고르기 칸·머리 행동 줄·격자 자식 min-width)
 */
const KNOWN: Record<string, string> = {
  '/validations/virtual': '실행 칸 줄(고르기·실행 버튼)이 줄바꿈하지 않는다 — Virtual.tsx',
  '/fleet/live': '차량 격자 표(table.ds-fleet)가 가로 스크롤 상자 없이 본문에 놓였다 — FleetLive.tsx',
  '/biz/trials': '추이 그림(svg width 320)이 본문(약 270px)보다 넓다 — TrialAnalytics.tsx·.ds-viz svg',
  '/_design': '디자인 갤러리 머리 — 개발용 화면',
  '/twin/impact': 'BDC 데모 화면 — twinViews.css 격자(minmax 320px)',
  '/features/FEAT-00022/1.0.0': '외부 연계 칩(ds-ext__status)이 줄바꿈하지 않는다',
  '/procurement/sw-cost/basis': '비활성 이유 말풍선(ds-btn-why__text)이 오른쪽 밖으로 — 머리 행동 밖 버튼',
  '/twin/simulation': 'BDC 데모 화면 — 판정 사유 줄(twin-reason) nowrap',
  '/twin/fleet': 'BDC 데모 화면 — 막대(span.bar) 폭',
  '/twin/vehicle/VIN-DEMO-017': 'BDC 데모 화면 — 품질 칩(vtel-q) 줄',
};

test.describe('390 폭 전 화면', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const t of targets) {
    test(`정적 데모 390: ${t.title} (${t.url})`, async ({ page }) => {
      test.fail(t.url in KNOWN, KNOWN[t.url]);
      await page.goto(t.url);
      await expect(page.locator('#main h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const m = await measureNarrow(page);
      expect(m.doc, '문서 가로 넘침(px)').toBeLessThanOrEqual(1);
      expect(m.main, `본문 상자 가로 넘침(px) — ${m.culprits.join(', ')}`).toBeLessThanOrEqual(1);
      expect(m.culprits, '본문 밖(오른쪽)·화면 왼쪽 밖으로 나간 요소').toEqual([]);
      expect(m.clippedTools, '상단바에서 잘리거나 화면 밖에 있는 조작 요소').toEqual([]);
    });
  }

  // 외부 시스템 창(codeBeamer·JIRA·GitLab)과 로그인 화면 — 셸 밖이라 문서 넘침만 본다
  for (const url of ['/external.html?system=codebeamer', '/external.html?system=jira', '/external.html?system=gitlab', '/login']) {
    test(`정적 데모 390: 셸 밖 ${url}`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1, h2').first()).toBeVisible();
      const over = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out: string[] = [];
        for (const el of document.body.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !(el as HTMLElement).checkVisibility?.()) continue;
          let scrolled = false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox !== 'visible') {
              scrolled = true;
              break;
            }
          }
          if (!scrolled && (r.right > vw + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).trim().split(/\s+/)[0]} ${Math.round(r.left)}~${Math.round(r.right)}`);
          if (out.length >= 6) break;
        }
        return { doc: document.documentElement.scrollWidth - vw, out };
      });
      expect(over.doc, `문서 가로 넘침(px) — ${over.out.join(', ')}`).toBeLessThanOrEqual(1);
      expect(over.out, '화면 밖으로 나간 요소').toEqual([]);
    });
  }
});

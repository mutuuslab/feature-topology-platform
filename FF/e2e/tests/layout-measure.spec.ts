// 측정기 회귀: 본문 스크롤에 가려진 글자를 셸 겹침으로 오인하지 않으며 실제 글자 겹침은 계속 잡는다.
import { expect, test } from '@playwright/test';
import { sweepChecks } from './layout-measure';

test('가려진 본문은 제외하고 실제 보이는 두 글자 상자의 겹침은 검출한다', async ({ page }) => {
  await page.setContent(`<style>
    body { margin: 0; font: 16px/20px sans-serif; }
    header { position: fixed; z-index: 2; inset: 0 0 auto; height: 52px; padding-top: 20px; box-sizing: border-box; background: white; }
    #main { position: absolute; top: 52px; left: 0; right: 0; height: 100px; overflow: auto; }
    .canvas { height: 300px; position: relative; }
    .covered, .visible-a, .visible-b { position: absolute; left: 0; }
    .covered { top: 0; } .visible-a, .visible-b { top: 100px; }
  </style><header>셸 제목</header><main id="main"><div class="canvas"><div class="covered">가려진 본문</div><div class="visible-a">실제 겹침 A</div><div class="visible-b">실제 겹침 B</div></div></main>`);
  await page.locator('#main').evaluate((el) => { el.scrollTop = 30; });
  const result = await sweepChecks(page);
  expect(result.overlaps.join('\n')).not.toContain('가려진 본문');
  expect(result.overlaps).toEqual([expect.stringMatching(/실제 겹침 A.*실제 겹침 B/)]);
});

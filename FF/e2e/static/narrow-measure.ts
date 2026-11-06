// 좁은 폭 가로 넘침 측정 — narrow-layout.spec(대표 화면·3폭)과 narrow-all.spec(전 화면·390)이 함께 쓴다.
// 본문(.sh-main)은 스스로 가로 스크롤하는 상자라 문서 넘침만 보면 놓친다 — 본문 상자의 넘침과, 화면 왼쪽 밖으로 나간 요소도 잰다.
import type { Page } from '@playwright/test';

export interface NarrowMeasure {
  /** 문서 가로 넘침(px) */
  doc: number;
  /** 본문 상자 가로 넘침(px) */
  main: number;
  /** 넘친 요소(오른쪽 끝이 본문 밖·왼쪽 끝이 화면 밖) — 최대 6개 */
  culprits: string[];
  /** 상단바에서 잘리거나 화면 밖에 있는 조작 요소 */
  clippedTools: string[];
}

export const measureNarrow = (page: Page): Promise<NarrowMeasure> =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const main = document.querySelector<HTMLElement>('.sh-main');
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).trim().split(/\s+/).join('.')}`;
    const culprits: string[] = [];
    if (main) {
      const box = main.getBoundingClientRect();
      const right = box.left + main.clientWidth;
      const over = main.scrollWidth > main.clientWidth + 1;
      for (const el of main.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !(el as HTMLElement).checkVisibility?.()) continue;
        // 스스로 가로 스크롤하는 상자(표 감싸개 등) 안은 그 상자가 맡는다
        let scrolled = false;
        for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
            scrolled = true;
            break;
          }
        }
        if (scrolled) continue;
        if (over && r.right > right + 1) culprits.push(`${name(el)} right=${Math.round(r.right)}`);
        else if (r.left < -1) culprits.push(`${name(el)} left=${Math.round(r.left)}`);
        if (culprits.length >= 6) break;
      }
    }
    const clippedTools = [...document.querySelectorAll<HTMLElement>('.sh-top button, .sh-top select, .sh-top a')]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) return true;
        for (let p = el.parentElement; p && !p.classList.contains('sh-top'); p = p.parentElement) {
          const st = getComputedStyle(p);
          if (st.display === 'contents' || st.overflowX === 'visible') continue; // 상자가 없거나 자르지 않는 부모
          const b = p.getBoundingClientRect();
          if (r.right > b.right + 1 || r.left < b.left - 1) return true;
        }
        return false;
      })
      .map((el) => el.getAttribute('aria-label') ?? name(el));
    return {
      doc: document.documentElement.scrollWidth - vw,
      main: main ? main.scrollWidth - main.clientWidth : 0,
      culprits,
      clippedTools,
    };
  });

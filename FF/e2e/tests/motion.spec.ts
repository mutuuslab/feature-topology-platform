// 모션 체계 v1(2026-10-24) — 장식 모션 대신 상태 변화에만 짧은 모션. tools/motion-rules.ts(정적)와 짝을 이루는 실행 검사.
//   ① 화면이 자리 잡은 뒤 본문(#main)에서 도는 무한 반복 애니메이션은 harness/motion.json loops에 있는 것만
//   ② 움직임 줄이기(prefers-reduced-motion)면 커널이 html[data-motion=calm]을 달고, 문서 전체에 도는 애니메이션이 없다
// BDC 데모(/twin/*)는 별도 레거시 화면 묶음(래칫 motionLoopsLegacy), 디자인 갤러리(/_design)는 부품 견본이라 ①에서 뺀다.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRILLDOWNS, MENU_ENTRIES } from './menu';

const ALLOW = Object.keys((JSON.parse(readFileSync(join(__dirname, '..', '..', 'harness', 'motion.json'), 'utf8')) as { loops: Record<string, string> }).loops);
const SKIP = (u: string) => u.startsWith('/twin') || u.startsWith('/_design');

async function settle(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('#main').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#main [data-state="loading"], #main [aria-busy="true"], #main .ds-skel'), null, { timeout: 10_000 }).catch(() => {});
}

/** 본문에서 도는 무한 반복 애니메이션 이름 */
const mainLoops = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('#main');
    return [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
          .filter((a) => {
            const t = (a.effect as KeyframeEffect | null)?.target;
            return !!t && !!main && main.contains(t);
          })
          .map((a) => (a as CSSAnimation).animationName ?? '(script)'),
      ),
    ];
  });

for (const s of [...MENU_ENTRIES.map((m) => m.menu), ...DRILLDOWNS.map((d) => d.url)].filter((u) => !SKIP(u))) {
  test(`모션 ①: ${s} — 본문 무한 반복은 허용 목록만`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await settle(page, s);
    const loops = await mainLoops(page);
    expect(loops.filter((n) => !ALLOW.includes(n)), `허용 목록(harness/motion.json) 밖 무한 반복: ${loops.join(', ')}`).toEqual([]);
  });
}

for (const url of ['/', '/fleet/live', '/ops/kill', '/features', '/login']) {
  test(`모션 ②: ${url} — 움직임 줄이기면 도는 애니메이션이 없다`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await settle(page, url);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'calm');
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? '(script)'),
    );
    expect(running, `움직임 줄이기인데 도는 애니메이션: ${running.join(', ')}`).toEqual([]);
  });
}

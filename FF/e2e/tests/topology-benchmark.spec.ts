// Keep frame sampling exclusive after functional browser projects. Assertion, events and budget are unchanged.
import { expect, test, type Page } from '@playwright/test';
import { settle } from './settle';

const graph = async (page: Page, url = '/arch/topology') => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(url);
  await settle(page);
  await expect(page.locator('.topo-stage')).toBeVisible();
};

test('그래프: 끌어 이동·확대가 프레임 예산(16.7ms) 안 — 60fps', async ({ page }) => {
  await graph(page);
  // 페이지 안에서 프레임마다 포인터 이동(끌기 150프레임) 뒤 Ctrl+휠 확대 60프레임을 보내고, 프레임 간격과 처리 시간을 잰다
  const r = await page.evaluate(async () => {
    const stage = document.querySelector('.topo-stage') as HTMLElement;
    const box = stage.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 1 });
    const frames: number[] = [], work: number[] = [];
    stage.dispatchEvent(ev('pointerdown', cx, cy));
    let last = performance.now();
    for (let i = 0; i < 210; i++) {
      await new Promise<void>((done) => requestAnimationFrame((t) => {
        frames.push(t - last);
        last = t;
        const t0 = performance.now();
        if (i < 150) stage.dispatchEvent(ev('pointermove', cx - i * 3, cy - i * 1.5));
        else {
          if (i === 150) stage.dispatchEvent(ev('pointerup', cx, cy));
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i % 2 ? 40 : -30, clientX: cx, clientY: cy }));
        }
        work.push(performance.now() - t0);
        done();
      }));
    }
    const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
    return { n: frames.length, p50: pct(frames.slice(3), 0.5), p95: pct(frames.slice(3), 0.95), work95: pct(work, 0.95), nodes: document.querySelectorAll('.ds-topo-node').length, edges: document.querySelectorAll('.topo-stage .topo-edge').length };
  });
  console.log(`topology frames ${JSON.stringify(r)}`);
  expect(r.work95, `처리 p95 ${r.work95.toFixed(2)}ms`).toBeLessThan(8);
  expect(r.p95, `프레임 p95 ${r.p95.toFixed(1)}ms`).toBeLessThan(20);
});

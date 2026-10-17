// UX 검토용 — 전세계 차량 지도(/fleet/map): 구독 보기(데모+합성)·한국 확대·기능 활성 보기·차량 상세. 결과: e2e/shots/fleet-map-*.png
// 단계마다 지도가 다 그려진 뒤(idle) 찍고, 그린 차량 점 수·지도 스타일(light/dark/fallback)·타일 요청 수·콘솔 오류를 출력한다.
// 실행: 프론트(BASE)·백엔드(API)가 떠 있어야 한다 — node e2e/scripts/shot-fleet-map.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.addInitScript(() => {
  localStorage.removeItem('ff.learn.v1');
  localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator' }));
});
const tiles = { ok: 0, failed: 0, aborted: 0 };
const errors = [];
p.on('requestfinished', async (r) => {
  if (!r.url().includes('openfreemap.org')) return;
  const s = (await r.response())?.status() ?? 0;
  if (s >= 200 && s < 400) tiles.ok++;
  else tiles.failed++;
});
p.on('requestfailed', (r) => r.url().includes('openfreemap.org') && (/ABORTED/.test(r.failure()?.errorText ?? '') ? tiles.aborted++ : tiles.failed++));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));

const canvas = p.getByTestId('fleet-map-canvas');
/** 지도가 멈춘 뒤의 그린 점 수 — 새 값이 들어오고 1.5초 동안 그대로면 다 그려진 것으로 본다 */
async function settled() {
  let last = null;
  for (let i = 0; i < 30; i++) {
    await p.waitForTimeout(500);
    const now = await canvas.getAttribute('data-rendered');
    if (now !== null && now === last && i > 2) break;
    last = now;
  }
  await p.waitForTimeout(1000);
  return { rendered: Number(await canvas.getAttribute('data-rendered')), cars: Number(await canvas.getAttribute('data-cars')), style: await canvas.getAttribute('data-style') };
}
const steps = {};
await p.goto(`${base}/fleet/map`);
await canvas.waitFor();
await p.getByRole('radio', { name: '데모 + 합성 모집단' }).click();
steps.world = await settled();
await p.screenshot({ path: `${out}fleet-map-world-subscription.png` });

await p.getByRole('radio', { name: '한국' }).click();
steps.kr = await settled();
await p.screenshot({ path: `${out}fleet-map-kr-subscription.png` });

await p.getByRole('radio', { name: '데모 Fleet' }).click();
await p.getByRole('radio', { name: '기능 활성' }).click();
steps.krActivation = await settled();
await p.screenshot({ path: `${out}fleet-map-kr-activation.png` });

// 차량을 고르면 지도가 그 차량으로 확대·이동한다 — 서울 도심, 구독 보기, 합성 차량까지 자동차
await p.getByRole('radio', { name: '구독 상태' }).click();
await p.getByRole('radio', { name: '데모 + 합성 모집단' }).click();
await p.getByRole('table', { name: '차량 목록' }).getByText('ego-01').click();
await p.getByTestId('fleet-map-detail').waitFor();
steps.city = await settled();
await canvas.screenshot({ path: `${out}fleet-map-city.png` });
await p.screenshot({ path: `${out}fleet-map-detail.png` });

console.log(JSON.stringify({ steps, tiles, errors: errors.slice(0, 10) }, null, 1));
await b.close();

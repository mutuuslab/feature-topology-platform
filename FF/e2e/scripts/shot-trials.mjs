// 개발 확인용 — 체험 전환 분석·체험권 화면을 1536·1920에서 찍는다 (dev 서버 9012 필요). 결과: e2e/test-results/shots/
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../test-results/shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
for (const [w, h] of [[1536, 864], [1920, 1080]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`${base}/biz/trials`);
  await p.getByRole('group', { name: /^제안 → 수락/ }).waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}biz-trials-${w}.png` });
  const trend = p.getByRole('img', { name: /주별 추이/ });
  await trend.hover({ position: { x: 300, y: 120 } });
  await p.waitForTimeout(200);
  await trend.screenshot({ path: `${out}biz-trend-hover-${w}.png` });
  await p.getByRole('region', { name: /수락률·구매 전환율/ }).screenshot({ path: `${out}biz-segments-${w}.png` });
  console.log(w, 'doc overflow', await p.evaluate(() => document.documentElement.scrollHeight - innerHeight));
  await p.goto(`${base}/entitlements`);
  await p.getByRole('table', { name: '체험권 차량' }).waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}entitlements-${w}.png` });
  console.log(w, 'entitlements', await p.evaluate(() => { const m = document.querySelector('.sh-main'); return { main: m.scrollWidth - m.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, screenRight: Math.round(document.querySelector('.ds-screen').getBoundingClientRect().right), vw: innerWidth }; }));
  await p.close();
}
await b.close();
console.log('ok', out);

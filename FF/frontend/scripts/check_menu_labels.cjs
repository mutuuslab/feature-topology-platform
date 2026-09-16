/**
 * 메뉴 라벨 회귀 확인 — 정본 업무 메뉴처럼 서브내비 줄에 화면 ID 코드가 붙지 않는지 실제 번들에서 본다.
 * 전제: `npm run build && npx vite preview --port 4178`
 * 실행: node scripts/check_menu_labels.cjs [baseUrl]
 */
const { createRequire } = require('module');
const req = createRequire('C:/project/2026-09-13_DigitalTwin/RFTwin/frontend/');
const { chromium } = req('playwright');

const BASE = process.argv[2] || 'http://localhost:4178';
const CODE = /(^|\s)UI\d\d(-S\d\d)?(\s|$)/;

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const bad = [];
  const seen = [];
  for (const path of ['/ops/campaign', '/catalog', '/fleet']) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForSelector('.subnav a.nav-screen', { timeout: 20000 });
    const rows = await page.$$eval('.subnav a.nav-screen', els => els.map(e => e.textContent.trim()));
    const groups = await page.$$eval('.subnav .group', els => els.map(e => e.textContent.trim()));
    rows.forEach(t => { if (CODE.test(t)) bad.push(`${path} → "${t}"`); });
    seen.push(`${path}: ${rows.length}줄 · 그룹 [${groups.join(' / ')}] · 앞 3줄 ${rows.slice(0, 3).join(' | ')}`);
  }
  await page.goto(BASE + '/ops/campaign', { waitUntil: 'load' });
  await page.waitForSelector('.subnav a.nav-screen');
  await page.locator('.rail').screenshot({ path: process.env.TEMP + '/fp_rail.png' }).catch(() => {});
  await page.screenshot({ path: process.env.TEMP + '/fp_menu.png' });
  await browser.close();
  seen.forEach(s => console.log(s));
  console.log(bad.length ? 'FAIL — 코드 배지 남음:\n' + bad.join('\n') : 'PASS — 서브내비 줄에 화면 ID 코드 없음');
  process.exit(bad.length ? 1 : 0);
})();

// UX 검토용 — 내 대시보드(Jira식 가젯 판): 기본 배치 1366·1920, 3열, 끄는 중(놓을 자리 표시), 가젯 추가 창, 배치 메뉴, 어두운 테마.
// 결과: e2e/shots/dashboard-*.png. 실행: 프론트(BASE)가 떠 있어야 한다 — node e2e/scripts/shot-dashboard.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
const page = async (w, h, theme = 'light') => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('ff.auth', '1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'operator', theme: t }));
  }, theme);
  const p = await ctx.newPage();
  await p.goto(base + '/');
  await p.locator('#main .db-board').waitFor();
  await p.waitForLoadState('networkidle').catch(() => {});
  return p;
};
// 셸은 본문을 안쪽 상자에서 스크롤한다 — 전체 촬영은 그 상자를 잠시 펼친다
const unroll = (p) =>
  p.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) Object.assign(el.style, { overflow: 'visible', height: 'auto', maxHeight: 'none' });
    }
    Object.assign(document.documentElement.style, { height: 'auto', overflow: 'visible' });
    Object.assign(document.body.style, { height: 'auto', overflow: 'visible' });
  });
const shot = async (p, name, full = false) => {
  if (full) await unroll(p);
  await p.screenshot({ path: `${out}dashboard-${name}.png`, fullPage: full });
};

let p = await page(1366, 768);
await shot(p, '1366');
await shot(p, '1366-full', true);
await p.close();
p = await page(1366, 768);
await p.getByRole('button', { name: '바로 가기 배치 메뉴' }).click();
await shot(p, '1366-menu');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: '가젯 추가' }).click();
await p.waitForTimeout(400);
await shot(p, '1366-directory');
await p.close();

p = await page(1920, 1080);
// 끄는 중 — 오른쪽 열 맨 위 가젯의 손잡이를 눌러 왼쪽 열 맨 위로 끌다 멈춘다(놓을 자리·열 표시·원래 자리)
const grip = p.locator('.db-col').nth(1).locator('[data-gadget] .db-grip').first();
const target = p.locator('.db-col').first().locator('[data-gadget]').first();
await grip.scrollIntoViewIfNeeded();
const g = await grip.boundingBox();
const t = await target.boundingBox();
await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
await p.mouse.down();
await p.mouse.move(t.x + 80, t.y + 12, { steps: 16 });
await p.waitForTimeout(250);
await shot(p, '1920-dragging');
await p.mouse.up();
await p.close();

p = await page(1920, 1080);
await p.getByRole('radio', { name: '3열' }).click();
await p.waitForTimeout(300);
await shot(p, '1920-3col');
await p.close();

p = await page(1920, 1080);
await shot(p, '1920-full', true);
await p.getByRole('radio', { name: '3열' }).click();
await shot(p, '1920-3col-full', true);
await p.close();

p = await page(1366, 768, 'dark');
await shot(p, '1366-dark');
await b.close();
console.log('saved', out);

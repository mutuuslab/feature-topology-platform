// UX 검토용 — 내 대시보드(Jira·Atlassian식): 보기 모드 1366·1920, 편집 모드(띠·레이아웃·점선 열·디렉터리), 가젯 구성 양식,
// 가젯 ⋯ 메뉴, 대시보드 바꾸기, 끄는 중(놓을 자리), 3열, 공유 창, 어두운 테마.
// 결과: e2e/shots/dashboard-*.png. 실행: 프론트(BASE)와 백엔드가 떠 있어야 한다 — BASE=http://localhost:9492 node e2e/scripts/shot-dashboard.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
const page = async (w, h, theme = 'light', role = 'operator') => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' });
  await ctx.addInitScript(
    ([t, r]) => {
      localStorage.setItem('ff.auth', '1');
      if (!localStorage.getItem('fp.state.v2')) localStorage.setItem('fp.state.v2', JSON.stringify({ role: r, theme: t }));
    },
    [theme, role],
  );
  const p = await ctx.newPage();
  await p.goto(base + '/');
  await p.locator('#main .jd-board').waitFor();
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(600);
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
const edit = async (p) => {
  await p.getByRole('button', { name: '편집', exact: true }).click();
  await p.getByRole('region', { name: '대시보드 편집 중' }).waitFor();
  await p.getByRole('complementary', { name: '가젯 추가' }).waitFor();
  await p.waitForTimeout(500);
};

// 보기 모드
let p = await page(1366, 768);
await shot(p, '1366');
await shot(p, '1366-full', true);
await p.close();

p = await page(1366, 768);
await p.getByRole('button', { name: '운영 요약 가젯 메뉴' }).click();
await shot(p, '1366-gadget-menu');
await p.keyboard.press('Escape');
await p.getByRole('button', { name: '대시보드 바꾸기' }).click();
await shot(p, '1366-switcher');
await p.keyboard.press('Escape');
// 편집 모드 — 시스템 대시보드는 사본을 만든다
await edit(p);
await shot(p, '1366-edit');
await p.getByRole('complementary', { name: '가젯 추가' }).getByRole('button', { name: '필터 결과 추가' }).click();
await p.getByRole('form', { name: '필터 결과 구성' }).waitFor();
await p.waitForTimeout(300);
await shot(p, '1366-config');
await p.getByRole('form', { name: '필터 결과 구성' }).getByRole('button', { name: '저장' }).click();
await p.getByRole('button', { name: '완료' }).click();
await p.waitForTimeout(600);
await shot(p, '1366-after-edit');
await p.getByRole('button', { name: '대시보드 더 보기' }).click();
await shot(p, '1366-more');
await p.getByRole('menuitem', { name: '공유' }).click();
await p.waitForTimeout(300);
await shot(p, '1366-share');
await p.close();

p = await page(1920, 1080);
await shot(p, '1920');
await shot(p, '1920-full', true);
await p.close();

// 끄는 중 — 오른쪽 열 맨 위 가젯의 제목 줄을 왼쪽 열 맨 위로 끌다 멈춘다(놓을 자리·열 표시·원래 자리)
p = await page(1920, 1080);
await edit(p);
await shot(p, '1920-edit');
const head = p.locator('.jd-col').nth(1).locator('[data-gadget] .jd-gadget__head').first();
const target = p.locator('.jd-col').first().locator('[data-gadget]').first();
const g = await head.boundingBox();
const t = await target.boundingBox();
await p.mouse.move(g.x + 40, g.y + g.height / 2);
await p.mouse.down();
await p.mouse.move(t.x + 80, t.y + 12, { steps: 16 });
await p.waitForTimeout(250);
await shot(p, '1920-dragging');
await p.mouse.up();
await p.getByRole('radio', { name: '3열' }).click();
await p.waitForTimeout(400);
await shot(p, '1920-3col');
await p.close();

p = await page(1366, 768, 'dark');
await shot(p, '1366-dark');
await p.close();
p = await page(1920, 1080, 'dark');
await shot(p, '1920-dark');
await b.close();
console.log('saved', out);

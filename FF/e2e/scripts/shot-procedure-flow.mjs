// UX 검토용 — 업무 절차 흐름도: 절차 흐름도(FPW.1·7·8·12, 텍스트 보기), 내 업무 흐름(역할 3개), 전체 지도, 메인 화면 가젯 작은 판.
// 폭 1366·1920. 결과: e2e/shots/procflow-*.png. 실행: 백엔드·프론트가 떠 있어야 한다 — BASE=http://localhost:9532 node e2e/scripts/shot-procedure-flow.mjs
// 서버 상태가 보이도록 처음에 Feature Owner로 FPW.1-A01을 완료한다(메모리 DB에서 실행).
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
const open = async (w, h, role, path) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR' });
  await ctx.addInitScript((r) => {
    localStorage.setItem('ff.auth', '1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
  }, role);
  const p = await ctx.newPage();
  // 기한 초과 상태도 보이게 — 완료 시각을 오래전으로 바꿔 보여 준다(서버 기록은 그대로)
  await p.route('**/api/procedures/state**', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const i of body.items ?? []) i.completedAt = '2026-01-05T09:00:00.000Z';
    await route.fulfill({ response: res, json: body });
  });
  await p.goto(base + path);
  await p.waitForLoadState('networkidle').catch(() => {});
  return p;
};
// 셸은 본문을 안쪽 상자에서 스크롤한다 — 전체 촬영은 그 상자를 잠시 펼친다(가로 스크롤 상자는 그대로 둔다)
const unroll = (p) =>
  p.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && !el.classList.contains('pf-scroll')) Object.assign(el.style, { overflow: 'visible', height: 'auto', maxHeight: 'none' });
    }
    Object.assign(document.documentElement.style, { height: 'auto', overflow: 'visible' });
    Object.assign(document.body.style, { height: 'auto', overflow: 'visible' });
  });
const shot = async (p, name, full = false) => {
  if (full) await unroll(p);
  await p.screenshot({ path: `${out}procflow-${name}.png`, fullPage: full });
};
/** 흐름도만(가로 스크롤 상자 전체 폭) */
const shotFlow = async (p, name) => {
  const svg = p.locator('.pf-scroll svg.pf-svg').first();
  await svg.waitFor();
  // 가로 스크롤 상자를 펼쳐 흐름도 전체를 찍는다
  await p.evaluate(() => {
    const s = document.querySelector('.pf-scroll svg.pf-svg');
    for (let e = s?.parentElement; e; e = e.parentElement) Object.assign(e.style, { overflow: 'visible', maxWidth: 'none', width: 'max-content' });
  });
  await svg.screenshot({ path: `${out}procflow-${name}.png` });
};

// 상태가 보이게 — Feature Owner가 첫 활동을 완료
{
  const p = await open(1366, 900, 'author', '/procedures?view=list');
  const box = p.locator('.pr-mine input[type="checkbox"]').first();
  await box.waitFor();
  if (!(await box.isChecked())) await box.click();
  await p.waitForTimeout(400);
  await p.close();
}

// ONLY=process — 절차 흐름도·절차서 본문만(빠른 반복용)
const only = process.env.ONLY;
for (const w of [1366, 1920]) {
  const h = w === 1366 ? 768 : 1080;
  let p = await open(w, h, 'author', '/procedures/FPW.1');
  await p.locator('[data-flow="FPW.1"]').waitFor();
  await shot(p, `fpw1-${w}`);
  await shot(p, `fpw1-${w}-full`, true);
  await p.close();

  p = await open(w, h, 'author', '/procedures/FPW.1');
  await p.locator('[data-flow="FPW.1"]').waitFor();
  await p.getByRole('radio', { name: '축소 보기' }).click().catch(() => {});
  await shot(p, `fpw1-${w}-fit`);
  await p.locator('[data-flow="FPW.1"] [data-activity="FPW.1-A03"].pf-node--activity').click();
  await p.waitForTimeout(500);
  await shot(p, `fpw1-${w}-selected`);
  await p.getByRole('radio', { name: '텍스트' }).first().click();
  await shot(p, `fpw1-${w}-text`, true);
  await p.close();

  if (only === 'process') continue;
  p = await open(w, h, 'author', '/procedures');
  await p.locator('.pf-my').waitFor();
  await shot(p, `mine-author-${w}`);
  await shot(p, `mine-author-${w}-full`, true);
  await p.close();

  p = await open(w, h, 'author', '/procedures?view=map');
  await p.locator('.pf-chainmap').waitFor();
  await shot(p, `map-${w}`);
  await p.close();

  p = await open(w, h, 'operator', '/');
  await p.locator('[data-flow-compact]').waitFor({ timeout: 20000 });
  await p.locator('[data-flow-compact]').scrollIntoViewIfNeeded();
  await shot(p, `home-operator-${w}`);
  await p.locator('[data-gadget="procedures"]').screenshot({ path: `${out}procflow-home-gadget-operator-${w}.png` }).catch(() => {});
  await p.close();
}

// 담당자별 업무 흐름 — 메뉴 화면(Feature Owner로 운영 조직 흐름 보기), 담당자 × 절차 표, 레인 강조
for (const w of only === 'process' ? [] : [1366, 1920]) {
  const h = w === 1366 ? 768 : 1080;
  let p = await open(w, h, 'author', '/procedures/roles');
  await p.locator('.pf-roles').waitFor();
  await shot(p, `roles-${w}`);
  await shot(p, `roles-${w}-full`, true);
  await p.close();
  p = await open(w, h, 'author', '/procedures/roles?role=operator');
  await p.locator('.pf-my').waitFor();
  await shot(p, `roles-operator-${w}`);
  await shot(p, `roles-operator-${w}-full`, true);
  await p.close();
  p = await open(w, h, 'author', '/procedures/FPW.8?role=operator');
  await p.locator('[data-flow="FPW.8"]').waitFor();
  await shot(p, `lane-focus-fpw8-${w}`);
  await p.close();
}

// 흐름도 전체 폭 — 레인 많은 것(FPW.7)·가장 넓은 것(FPW.8)·사건 시작(FPW.12)·짧은 것(FPW.13), 그리고 나머지
for (const id of ['FPW.1', 'FPW.2', 'FPW.3', 'FPW.4', 'FPW.5', 'FPW.6', 'FPW.7', 'FPW.8', 'FPW.9', 'FPW.10', 'FPW.11', 'FPW.12', 'FPW.13']) {
  const p = await open(1920, 1080, 'quality', `/procedures/${id}`);
  await shotFlow(p, `diagram-${id.replace('.', '')}`);
  await p.close();
}

// 역할마다 다른 내 업무 흐름
for (const role of only === 'process' ? [] : ['operator', 'integrator']) {
  const p = await open(1366, 768, role, '/procedures');
  await p.locator('.pf-my').waitFor();
  await shot(p, `mine-${role}-1366`);
  await p.close();
}
await b.close();
console.log('saved', out);

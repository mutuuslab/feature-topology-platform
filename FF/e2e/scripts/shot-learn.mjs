// UX 검토용 — 표준 따라하기(허브·시나리오·가이드 패널)를 1366·1920·시연 모드로 찍는다. 결과: e2e/shots/ (Playwright가 실행마다 비우는 test-results 밖)의 learn-*.png
// 실행: 프론트(빌드 preview 또는 dev)가 BASE에서 떠 있어야 한다. node e2e/scripts/shot-learn.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
const COND = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];
for (const c of COND) {
  const p = await b.newPage({ viewport: { width: c.w, height: c.h } });
  await p.addInitScript((present) => {
    localStorage.setItem('ff.present', present ? '1' : '0');
    if (!sessionStorage.getItem('shot')) {
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'author' }));
      localStorage.removeItem('ff.learn.v1');
      sessionStorage.setItem('shot', '1');
    }
  }, c.present);
  await p.goto(`${base}/learn`);
  await p.getByRole('link', { name: /거리 추정 오류/ }).waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}learn-hub-${c.name}.png` });
  await p.goto(`${base}/learn/CS-01`);
  await p.getByRole('button', { name: '보기 모드로 시작' }).click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}learn-step1-${c.name}.png` });
  const dock = p.getByRole('complementary', { name: '따라하기 가이드' });
  await dock.getByRole('button', { name: '다음' }).click();
  await p.locator('[data-tour="feature-header"][data-tour-active="true"]').waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}learn-step2-feature-${c.name}.png` });
  for (let i = 0; i < 5; i++) await dock.getByRole('button', { name: '다음' }).click();
  await p.locator('[data-tour="gate-g5"]').waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}learn-step7-role-${c.name}.png` });
  await dock.getByRole('button', { name: 'FFG-TST-009 원문 요약 보기' }).click();
  await p.getByRole('dialog').waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}learn-rule-drawer-${c.name}.png` });
  console.log(c.name, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await p.close();
}
await b.close();
console.log('ok', out);

// UX 검토용 — 컴플라이언스 화면 시장 Profile 탭(WP6, FFG-GEN-001·003): KPI·게이트 사전 판정(검증 필요 시장 CA·F2 활성화 FAIL)·Profile 표.
// 결과: e2e/shots/compliance-profiles-*.png. 실행: 프론트(BASE)가 떠 있어야 한다(화면은 contracts 표만 쓴다) — node e2e/scripts/shot-compliance.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const COND = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];
const b = await chromium.launch();
for (const c of COND) {
  const p = await b.newPage({ viewport: { width: c.w, height: c.h } });
  await p.addInitScript(([present]) => {
    localStorage.setItem('ff.present', present ? '1' : '0');
    localStorage.removeItem('ff.learn.v1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'steward' }));
  }, [c.present]);
  await p.goto(`${base}/verify/compliance?tab=profiles`);
  await p.getByText('NA-CA 1.0.0').waitFor();
  await p.getByRole('combobox', { name: '시장', exact: true }).selectOption('CA');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}compliance-profiles-${c.name}.png` });
  await p.close();
}
await b.close();
console.log('shots → e2e/shots/compliance-profiles-*.png');

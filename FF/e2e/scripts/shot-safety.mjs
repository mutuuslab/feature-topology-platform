// UX 검토용 — 안전 분류(WP1): Registry 분류 열·처리강도 필터, 상세 머리말 배지·안전 분류 탭(확정본·초안·조합 위반)을 1366·1920·시연 모드로 찍는다.
// 결과: e2e/shots/safety-*.png. 실행: 프론트(BASE)와 백엔드가 떠 있어야 한다. node e2e/scripts/shot-safety.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
const COND = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const report = [];
// 앱은 본문 컨테이너가 스크롤 — fullPage 대신 패널별로 찍는다
const panels = async (p, tag) => {
  for (const id of ['safety-profile', 'safety-findings', 'safety-preview', 'safety-confirmed']) {
    const sec = p.locator('section', { has: p.locator('#' + id + '-h') });
    if (await sec.count()) await sec.screenshot({ path: out + tag + '-' + id + '.png' });
  }
};
for (const c of COND) {
  const p = await b.newPage({ viewport: { width: c.w, height: c.h } });
  await p.addInitScript(
    ([present]) => {
      localStorage.setItem('ff.present', present ? '1' : '0');
      localStorage.removeItem('ff.learn.v1');
      localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'quality' }));
    },
    [c.present],
  );
  await p.goto(`${base}/features?f=F3`);
  await p.locator('.ds-cls-row').first().waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}safety-list-F3-${c.name}.png` });
  report.push(`${c.name} list overflow=${await overflow(p)}`);

  // 확정본(보고서 예시) — 잠김·개인 서명
  await p.goto(`${base}/features/FEAT-00022/1.0.0?tab=safety`);
  await p.locator('[data-tour="safety-tab"]').waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}safety-tab-confirmed-${c.name}.png` });
  await panels(p, `safety-confirmed-${c.name}`);
  report.push(`${c.name} confirmed overflow=${await overflow(p)}`);

  // 초안 — 판정 흐름 펼침, DC0으로 바꿔 조합 위반을 보인다(저장하지 않음)
  await p.goto(`${base}/features/FEAT-00001/2.1.0?tab=safety`);
  await p.locator('[data-tour="safety-tab"]').waitFor();
  await p.getByText('판정 흐름으로 제안 받기').click();
  await p.getByRole('combobox', { name: /^비활성화 등급 DC/ }).selectOption('DC0');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}safety-tab-draft-violation-${c.name}.png` });
  await panels(p, `safety-draft-${c.name}`);
  report.push(`${c.name} draft overflow=${await overflow(p)}`);
  await p.close();
}
await b.close();
console.log(report.join('\n'));

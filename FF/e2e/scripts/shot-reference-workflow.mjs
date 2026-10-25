// UX 검토용 — 업무 절차 흐름도 표기의 기준 문서(EngineeringWorkFlow_Automotive docs/index.html, 읽기 전용) 촬영.
// FF 흐름도(shot-procedure-flow.mjs)와 같은 폭(1366·1920)으로 찍어 나란히 비교한다. 결과: e2e/shots/ref-*.png
// 실행: REF=<기준 index.html 경로> node e2e/scripts/shot-reference-workflow.mjs
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
const ref = process.env.REF ?? 'C:/project/2026-10-13_EngineeringWorkFlow_Automotive/docs/index.html';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const b = await chromium.launch();
for (const w of [1366, 1920]) {
  const p = await b.newPage({ viewport: { width: w, height: w === 1366 ? 768 : 1080 } });
  await p.goto(pathToFileURL(ref).href);
  for (const id of ['overview', 'roles', 'trace', 'SYS.2', 'SUP.9']) {
    const s = p.locator(`section[id="${id}"]`);
    await s.scrollIntoViewIfNeeded();
    await s.screenshot({ path: `${out}ref-${id.replace('.', '')}-${w}.png` });
  }
  // 흐름도만(가로 스크롤 상자 전체)
  const wf = p.locator('section[id="SYS.2"] .wfwrap').first();
  await wf.evaluate((el) => Object.assign(el.style, { overflow: 'visible', width: 'max-content' }));
  await wf.screenshot({ path: `${out}ref-SYS2-diagram-${w}.png` });
  await p.close();
}
await b.close();
console.log('saved', out);

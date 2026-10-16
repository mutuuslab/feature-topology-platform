// UX 검토용 — CARLA 가상검증: 조합 시험 계획·원격 대 차량 내 비교 타임라인·실행 이력 → 기준선/차량 내 감지 실행 서랍(G5 인정 체크리스트)
// → 42 컴포넌트 상세의 도구 신뢰성(TCL). 결과: e2e/shots/virtual-*.png, arch-tcl-*.png.
// 실행: 프론트(BASE)·백엔드(API, CARLA 검증 서버 2100 연결 — npm run carla:up)가 떠 있어야 한다. 가상검증 실행을 만든다(데모 DB) — node e2e/scripts/shot-virtual.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const api = process.env.API ?? 'http://localhost:9101';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const as = (id, role) => ({ 'Content-Type': 'application/json', 'X-Actor-Id': id, 'X-Actor-Role': role });
const pols = (await (await fetch(`${api}/api/policies?featureId=FEAT-00022`)).json()).items;
const pol = pols.at(-1);
const r = await fetch(`${api}/api/virtual-validations`, { method: 'POST', headers: as('usr-author', 'FEATURE_AUTHOR'), body: JSON.stringify({ policyId: pol.policyId }) });
const runs = (await r.json()).items;
if (!r.ok) throw new Error(`virtual run ${r.status} ${JSON.stringify(runs)}`);
console.log(runs.map((x) => `${x.runId} ${x.scenarioId} ${x.source} ${x.overall}/${x.gateResult}`).join('\n'));
const COND = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];
const b = await chromium.launch();
const page = async (c, role, tall = false) => {
  const p = await b.newPage({ viewport: { width: c.w, height: tall ? 2600 : c.h } });
  await p.addInitScript(([present, r]) => {
    localStorage.setItem('ff.present', present ? '1' : '0');
    localStorage.removeItem('ff.learn.v1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
  }, [c.present, role]);
  return p;
};
for (const c of COND) {
  // 첫 화면(접힘 위) · 전체 길이
  const p = await page(c, 'quality');
  await p.goto(`${base}/validations/virtual`);
  await p.getByTestId('compare-timeline').waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}virtual-top-${c.name}.png` });
  await p.close();
  // 패널별 — 화면은 안쪽 컨테이너가 스크롤하므로 키 큰 화면에서 패널 요소를 찍는다
  const q = await page(c, 'quality', true);
  await q.goto(`${base}/validations/virtual`);
  await q.getByTestId('compare-timeline').waitFor();
  await q.getByTestId('combo-plan').waitFor();
  await q.waitForTimeout(600);
  for (const id of ['scenarios', 'combinations', 'compare']) await q.locator(`section[aria-labelledby="${id}-h"]`).screenshot({ path: `${out}virtual-panel-${id}-${c.name}.png` });
  await q.close();
  // 실행 서랍 — 기준선(G5 체크 FAIL·이유)과 차량 내 감지(PASS)
  for (const sc of ['FAULT-REMOTE-DC2', 'FAULT-ONBOARD']) {
    const id = runs.find((x) => x.scenarioId.endsWith(sc))?.runId;
    if (!id) continue;
    const t = await page(c, 'quality', true);
    await t.goto(`${base}/validations/virtual`);
    await t.getByText(id, { exact: true }).first().click();
    const d = t.getByRole('dialog');
    await d.waitFor();
    await t.waitForTimeout(600);
    await d.screenshot({ path: `${out}virtual-drawer-${sc}-${c.name}.png` });
    await t.close();
  }
  // 42 컴포넌트 — PKI 상세의 도구 신뢰성
  const a = await page(c, 'quality', true);
  await a.goto(`${base}/arch/components`);
  await a.getByRole('button', { name: /^D06-10/ }).first().click();
  const d = a.getByRole('dialog');
  await d.getByTestId('tool-qualification').waitFor();
  await a.waitForTimeout(500);
  await d.screenshot({ path: `${out}arch-tcl-${c.name}.png` });
  await a.close();
}
await b.close();
console.log('shots → e2e/shots/virtual-*.png, arch-tcl-*.png');

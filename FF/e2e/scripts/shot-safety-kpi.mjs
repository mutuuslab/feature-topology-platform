// UX 검토용 — 운행 중 감시 지표(WP10, FFG-TEL-009): 출시 Version 표(지표 6종·경보) → FEAT-00022 서랍(지표·경보 기준 기록·부속서 1).
// 결과: e2e/shots/kpi-*.png. 실행: 프론트(BASE)·백엔드(API, 메모리 DB)가 떠 있어야 한다. Kill 1건(2인 승인)을 발행해 지연 값을 만든다(데모 DB)
// — node e2e/scripts/shot-safety-kpi.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const api = process.env.API ?? 'http://localhost:9101';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const as = (id, role) => ({ 'Content-Type': 'application/json', 'X-Actor-Id': id, 'X-Actor-Role': role });
const post = async (path, h, body = {}) => {
  const r = await fetch(`${api}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
};
// 이미 차단 중이면(두 번째 실행) 그 기록을 쓴다
const active = (await (await fetch(`${api}/api/kill-requests`)).json()).items.some((x) => x.featureId === 'FEAT-00022' && x.command);
if (!active) {
  const k = await post('/api/kill-requests', as('usr-ops', 'OPERATOR'), { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '감시 지표 화면 검토', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' });
  await post(`/api/kill-requests/${k.killId}/approvals`, as('usr-safety', 'SAFETY_OFFICER'));
  await post(`/api/kill-requests/${k.killId}/approvals`, as('usr-opslead', 'OPS_LEAD'));
  await new Promise((r) => setTimeout(r, 12_000)); // 시뮬레이터 DC 단계(경고·인계·램프) 진행
}
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
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: 'quality' }));
  }, [c.present]);
  await p.goto(`${base}/ops/safety-kpi`);
  await p.getByText('FEAT-00022').first().waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}kpi-table-${c.name}.png` });
  await p.getByText('FEAT-00022').first().click();
  await p.getByRole('dialog').waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}kpi-drawer-${c.name}.png` });
  await p.close();
}
await b.close();
console.log('shots → e2e/shots/kpi-*.png');

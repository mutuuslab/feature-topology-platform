// UX 검토용 — 긴급 차단 v2(WP4): 요청 패널(게이트 사전 점검·누적 게이지·Registry 등급) → 승인 대기 상세(승인 칸) → 발행(명령·차량별 봉투) → 복원 승인(차단 승인자 차단)
// 결과: e2e/shots/kill-*.png. 실행: 프론트(BASE)·백엔드(API)가 떠 있어야 한다. 데이터를 만든다(데모 DB) — node e2e/scripts/shot-kill.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://localhost:9012';
const api = process.env.API ?? 'http://localhost:9101';
const out = new URL('../shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const as = (id, role) => ({ 'Content-Type': 'application/json', 'X-Actor-Id': id, 'X-Actor-Role': role });
const post = async (path, h, body) => {
  const r = await fetch(api + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
// 진행 중인 FEAT-00022 차단·요청 정리
for (const k of (await (await fetch(`${api}/api/kill-requests`)).json()).items.filter((x) => x.featureId === 'FEAT-00022')) {
  if (k.status === 'REQUESTED') await post(`/api/kill-requests/${k.killId}/reject`, as('usr-quality', 'SAFETY_OFFICER'), { reason: '촬영 정리' });
  if (k.status === 'ACTIVE' && k.version === 2) {
    if (k.restoreRequest?.status !== 'REQUESTED') await post(`/api/kill-requests/${k.killId}/restore`, as('usr-operator', 'OPERATOR'), { reason: '촬영 정리' });
    await post(`/api/kill-requests/${k.killId}/restore/approvals`, as('usr-steward', 'SAFETY_OFFICER'), {});
    await post(`/api/kill-requests/${k.killId}/restore/approvals`, as('usr-integrator', 'SECURITY_OFFICER'), {});
  }
}
const req = await post('/api/kill-requests', as('usr-operator', 'OPERATOR'), { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reasonCategory: 'SAFETY', reasonCode: 'DIST_EST_BIAS', reason: '전방 거리 오추정(촬영)', containmentJustification: '원인 분석 전 봉쇄', confirm: 'FEAT-00022' });
const COND = [
  { name: '1366', w: 1366, h: 768, present: false },
  { name: '1920', w: 1920, h: 1080, present: false },
  { name: 'present-1920', w: 1920, h: 1080, present: true },
];
const b = await chromium.launch();
const shoot = async (p, file) => {
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}${file}` });
};
const drawerShot = async (p, file) => {
  const d = p.getByRole('dialog');
  await d.waitFor();
  await p.waitForTimeout(500);
  await d.screenshot({ path: `${out}${file}` });
};
// tall — 서랍·패널 요소 사진은 키 큰 화면에서(서랍은 화면 높이로 잘린다)
const page = async (c, role, tall = false) => {
  const p = await b.newPage({ viewport: { width: c.w, height: tall ? 2200 : c.h } });
  await p.addInitScript(([present, r]) => {
    localStorage.setItem('ff.present', present ? '1' : '0');
    localStorage.removeItem('ff.learn.v1');
    localStorage.setItem('fp.state.v2', JSON.stringify({ role: r }));
  }, [c.present, role]);
  return p;
};
// 1) 요청 패널 — 운영자, 봉쇄 근거 입력 전(막힘)
for (const c of COND) {
  const p = await page(c, 'operator');
  await p.goto(`${base}/ops/kill?featureId=FEAT-00023&version=1.0.0`);
  await p.locator('#new-kill-h').waitFor();
  await p.getByText('정책 게이트 사전 점검').waitFor();
  await shoot(p, `kill-request-${c.name}.png`);
  await p.close();
  const t = await page(c, 'operator', true);
  await t.goto(`${base}/ops/kill?featureId=FEAT-00023&version=1.0.0`);
  await t.getByText('정책 게이트 사전 점검').waitFor();
  await t.waitForTimeout(500);
  await t.locator('section', { has: t.locator('#new-kill-h') }).screenshot({ path: `${out}kill-request-panel-${c.name}.png` });
  await t.close();
  const p2 = await page(c, 'operator', true);
  // 2) 승인 대기 — 요청자(운영자) 시점, 품질 검토(FSM) 시점
  await p2.goto(`${base}/ops/kill?id=${req.killId}`);
  await drawerShot(p2, `kill-pending-requester-${c.name}.png`);
  await p2.close();
  const q = await page(c, 'quality', true);
  await q.goto(`${base}/ops/kill?id=${req.killId}`);
  await drawerShot(q, `kill-pending-fsm-${c.name}.png`);
  await q.close();
}
// 3) 발행 — FSM·운영 리더 승인
await post(`/api/kill-requests/${req.killId}/approvals`, as('usr-quality', 'SAFETY_OFFICER'), {});
await post(`/api/kill-requests/${req.killId}/approvals`, as('usr-coordinator', 'OPS_LEAD'), {});
await post(`/api/kill-requests/${req.killId}/restore`, as('usr-operator', 'OPERATOR'), { reason: '원인 수정 확인(촬영)' });
for (const c of COND) {
  const q = await page(c, 'quality', true); // 차단 승인자 — 복원 승인 막힘
  await q.goto(`${base}/ops/kill?id=${req.killId}`);
  await q.getByRole('dialog').getByText('차량별 봉투').waitFor();
  await drawerShot(q, `kill-active-restore-blocked-${c.name}.png`);
  await q.locator('[data-tour="kill-restore"]').screenshot({ path: `${out}kill-restore-section-${c.name}.png` });
  await q.close();
}
await b.close();
console.log(`shots: e2e/shots/kill-*.png (요청 ${req.killId})`);

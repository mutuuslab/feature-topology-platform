// 실서버 확인 — 알림 센터·정책 버전 이력·롤백을 떠 있는 백엔드에 대고 끝까지 돌린다(쓰기 발생: 정책·롤백 기록이 남는다).
// 사용: node e2e/scripts/live-rollback.mjs [http://localhost:9101]  · FEAT-00024(QM, 가상검증 불필요) 사용, flag는 실행마다 새 이름.
// 데모 함대에는 통신 두절 차량(KMH-NX4-0003)이 있어 게시본이 PARTIAL로 닫힐 수 있다 — 롤백은 전부 확인(CONFIRMED)일 때만 성공이므로
// 이 스크립트는 "게시본 결과와 롤백 결과·알림이 서로 맞는가"를 본다.
const BASE = process.argv[2] ?? 'http://localhost:9101';
const who = { author: ['usr-author', 'FEATURE_AUTHOR'], approver: ['usr-approver', 'FEATURE_APPROVER'], release: ['usr-coordinator', 'RELEASE_MANAGER'], operator: ['usr-operator', 'OPERATOR'], lead: ['usr-coordinator', 'OPS_LEAD'] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function api(method, path, as, body) {
  const h = { Accept: 'application/json' };
  if (as) Object.assign(h, { 'X-Actor-Id': who[as][0], 'X-Actor-Role': who[as][1] });
  if (method !== 'GET') Object.assign(h, { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() });
  const res = await fetch(BASE + path, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data?.error ?? data)}`);
  return data;
}
const ok = (label, cond, extra = '') => {
  n++;
  console.log(`${cond ? '✓' : '✕'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};
const flag = `ivi_00024_live${Date.now() % 100000}`;

async function deploy(desc) {
  const p = await api('POST', '/api/policies', 'author', { featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: flag, description: desc, safeDefault: false });
  const v = await api('POST', `/api/policies/${p.policyId}/validate`, 'author', {});
  await api('POST', `/api/policies/${p.policyId}/decision`, 'approver', { decision: 'APPROVE', reason: '실서버 확인' });
  const d = await api('POST', `/api/policies/${p.policyId}/deploy`, 'release', { reason: `${desc} 배포` });
  return { id: p.policyId, decision: v.run.decision, pub: d.publicationId };
}
async function waitPub(id) {
  for (let i = 0; i < 30; i++) {
    const s = (await api('GET', `/api/publications/${id}`)).publication;
    if (s.closedAt) return s;
    await sleep(1000);
  }
  return (await api('GET', `/api/publications/${id}`)).publication;
}

console.log(`대상 ${BASE} · flag ${flag}`);
ok('health', (await api('GET', '/api/health')).status === 'ok');

// 1. 정책 버전 이력
const draft = await api('POST', '/api/policies', 'author', { featureId: 'FEAT-00024', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: `${flag}_v`, description: '처음 내용', safeDefault: false });
await api('PATCH', `/api/policies/${draft.policyId}`, 'author', { description: '고친 내용' });
const r1 = await api('GET', `/api/policies/${draft.policyId}/revisions/1`);
ok('수정 후에도 r1 내용 보존', r1.spec.description === '처음 내용', `차이 ${r1.changesFromCurrent.map((c) => c.path)}`);
const restored = await api('POST', `/api/policies/${draft.policyId}/revisions/1/restore`, 'author', { reason: '되돌림' });
ok('r1 복원 → 새 개정본 DRAFT', restored.revision === 3 && restored.status === 'DRAFT' && restored.description === '처음 내용', `r${restored.revision} ${restored.status}`);
const ch = await api('GET', `/api/policies/${draft.policyId}/changes`);
ok('변경 이력 3건(복원·수정·작성)', ch.items.map((e) => e.kind).join() === 'RESTORE,UPDATE,CREATE');

// 2. 같은 flag로 정책 2개 배포
const p1 = await deploy('라이브 P1');
const s1 = await waitPub(p1.pub);
ok('P1 검증 GO·배포 산출물 닫힘(CONFIRMED·PARTIAL)', p1.decision === 'GO' && ['CONFIRMED', 'PARTIAL'].includes(s1.status), `${p1.id} ${p1.pub} ${s1.status} ${s1.confirmed}/${s1.denominator}`);
const p2 = await deploy('라이브 P2');
const s2 = await waitPub(p2.pub);
ok('P2 배포 → P1 RETIRED', ['CONFIRMED', 'PARTIAL'].includes(s2.status) && (await api('GET', `/api/policies/${p1.id}`)).policy.status === 'RETIRED', `${p2.id} ${p2.pub} ${s2.status}`);

// 3. 수동 롤백
const det = await api('GET', `/api/rollbacks/deployments/${p2.pub}`);
const cand = det.candidates.find((c) => c.policyId === p1.id);
ok('복구 가능 버전에 P1', !!cand?.eligible, cand ? cand.blockers.map((b) => b.code).join() || 'eligible' : '없음');
const scope = { featureIds: ['FEAT-00024'] };
const pv = await api('POST', '/api/rollbacks/preview', 'operator', { deploymentId: p2.pub, recovery: { policyId: p1.id }, scope });
ok('미리보기 적용 가능', pv.applicable, `차량 ${pv.vins.length}대 · 그룹 ${pv.vehicleGroups.length} · 막힘 ${pv.blockers.map((b) => b.code)}`);
const req = await api('POST', '/api/rollback-requests', 'operator', { deploymentId: p2.pub, targetTypes: ['POLICY_VERSION'], recovery: { policyId: p1.id }, scope, reason: '실서버 롤백 확인', approvers: ['usr-coordinator'] });
let refused = false;
try {
  await api('POST', `/api/rollback-requests/${req.requestId}/execute`, 'operator', {});
} catch (e) {
  refused = /422/.test(e.message);
}
ok('승인 전 실행 거부(422)', refused);
await api('POST', `/api/rollback-requests/${req.requestId}/decision`, 'lead', { decision: 'APPROVE', comment: '확인' });
const x = await api('POST', `/api/rollback-requests/${req.requestId}/execute`, 'operator', {});
ok('실행 시작', x.status === 'RUNNING' || x.status === 'COMPLETED', `${x.executionId} ${x.status} 산출물 ${x.artifactId}`);
const art = await waitPub(x.artifactId);
const done = await api('GET', `/api/rollbacks/${x.executionId}`);
const success = art.status === 'CONFIRMED';
ok(`롤백 결과가 게시본과 맞다 (게시본 ${art.status} ${art.confirmed}/${art.denominator})`, success ? done.status === 'COMPLETED' && done.result === 'SUCCESS' : done.status === 'FAILED' && done.result === 'FAILURE' && done.failureReason.includes(`${art.confirmed}/${art.denominator}`), `${done.status}/${done.result} ${done.failureReason ?? ''}`);
ok('P1 다시 DEPLOYED·P2 RETIRED', (await api('GET', `/api/policies/${p1.id}`)).policy.status === 'DEPLOYED' && (await api('GET', `/api/policies/${p2.id}`)).policy.status === 'RETIRED');

// 4. 화면 알림(메일 채널 없음 — D-RD-7)
await sleep(300);
const leadInbox = await api('GET', '/api/notifications', 'lead');
ok('승인대상자(coordinator)에게 승인 요청 알림', leadInbox.items.some((i) => i.eventType === 'rollback.requested'), `안 읽음 ${leadInbox.unread}`);
const opInbox = await api('GET', '/api/notifications', 'operator');
ok(`요청자(operator)에게 롤백 ${success ? '완료' : '실패'} 알림`, opInbox.items.some((i) => i.eventType === (success ? 'rollback.completed' : 'rollback.failed')), `안 읽음 ${opInbox.unread}`);
console.log(`${n}개 확인${process.exitCode ? ' — 실패 있음' : ' — 모두 통과'}`);

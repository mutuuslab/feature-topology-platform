// 공개 시연 사이트의 브라우저 안 쓰기(api/sim, 설계 20-60) — 라우터·병합기·초기화·판 바뀜, 그리고 대표 흐름(긴급 차단 → 2인 승인 → 회신 → 재전송 → 복원).
// 서버와 같은 규칙(contracts approvalCheck·gateVerdict·aggregate·NOTIFICATION_RULES)으로 판정되는지 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';

const FEAT = 'FEAT-00022';
const VINS = ['KMH-NX4-0001', 'KMH-NX4-0002', 'KMH-NX4-0003', 'KMH-NX4-0004'];
const OFFLINE = 'KMH-NX4-0003';
const registry = {
  name: '전방 안전거리 3단계',
  version: '1.0.0',
  status: 'RELEASED',
  f_class: 'F3',
  deact_class: 'DC2',
  gsr_mandatory: false,
  max_vehicles: 50000,
  max_per_window: 5000,
  markets_approved: ['UNECE', 'EU', 'KR', 'CN', 'US', 'CA'],
  type_approval_relevant: true,
  ads_feature: false,
  profile: { takeover_ms: 4000, ramp_ms: 3000, fault_ramp_ms: 1500, max_pending_ms: 0, max_cycle_wait_ms: 28800000 },
};
const preview = {
  feature: { featureId: FEAT, version: '1.0.0', name: '전방 안전거리 3단계', lifecycle: 'RELEASED', asil: 'B' },
  featureIds: [FEAT],
  dependents: [],
  flagKeys: ['care_00022_param', 'care_00022_signal'],
  vehicles: VINS.map((vin) => ({ vin, label: vin, link: vin === OFFLINE ? 'OFFLINE' : 'ONLINE', gleo: false })),
  unknownVins: [],
  activeKill: null,
  registry,
  window: { hours: 24, deactivate: 2, restore: 2, cap: 5000 },
  nextSeq: 13,
  lastKillApprovers: ['usr-quality', 'usr-integrator'],
  // 서버가 찍은 사전 점검(봉쇄 근거 없음) — 시연 엔진의 같은 규칙 판정과 비교한다
  checks: [
    { rule: 'FFG-PLT-002', ok: true, message: '' },
    { rule: 'FFG-CLS-009', ok: true, message: '' },
    { rule: 'FFG-PLT-003', ok: true, message: '' },
    { rule: 'FFG-PLT-004', ok: true, message: '' },
    { rule: 'FFG-PLT-007', ok: true, message: '' },
    { rule: 'FFG-PLT-017', ok: true, message: '' },
    { rule: 'FFG-PLT-008', ok: true, message: '' },
    { rule: 'FFG-SEC-003', ok: true, message: '' },
    { rule: 'FFG-PLT-009', ok: false, message: '' },
  ],
};
const killBase = {
  killId: 'KILL-00007',
  featureId: 'FEAT-00004',
  featureVersion: '1.0.0',
  featureIds: ['FEAT-00004'],
  flagKeys: [],
  vins: ['X-1'],
  reason: '이전 차단',
  status: 'RELEASED',
  requestedBy: 'usr-operator',
  requestedAt: '2026-11-06T00:00:00.000Z',
  version: 2,
  approvals: [],
  delivery: null,
  restore: null,
};

const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const SNAP: Record<string, unknown> = {
  [url('auditChain')]: { ok: true, verified: 10, head: 'aa'.repeat(32), checkedAt: '2026-11-06T01:00:00.000Z' },
  [url('events', {}, { limit: 500, recent: '1' })]: { items: [{ seq: 41, id: 'e41', type: 'feature.created', at: '2026-11-06T00:00:00.000Z', aggregate: 'FEAT-00001@1.0.0', componentId: null, payload: {} }] },
  [url('audit', {}, { limit: 500 })]: { items: [{ id: 233, at: '2026-11-06T00:00:00.000Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'X', target: 'Y', result: 'ALLOWED', reason: null, before: null, after: null, correlationId: null, componentId: null }], nextCursor: null },
  [url('audit', {}, { limit: 100 })]: { items: [], nextCursor: null },
  [url('notifications', {}, { limit: 200 })]: { items: [{ notificationId: 'NTF-00041', category: 'GATE', createdAt: '2026-11-06T00:00:00.000Z', readAt: null }], unread: 1, byCategory: { GATE: 1 } },
  [url('notifications', {}, { limit: 6 })]: { items: [{ notificationId: 'NTF-00041', category: 'GATE', createdAt: '2026-11-06T00:00:00.000Z', readAt: null }], unread: 1, byCategory: { GATE: 1 } },
  [url('killRequests')]: { items: [killBase] },
  [url('killRequests', {}, { status: 'ACTIVE' })]: { items: [] },
  [url('killDetail', { id: 'KILL-00007' })]: killBase,
  [url('killPreview', {}, { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY' })]: preview,
  [url('killPreview', {}, { featureId: FEAT, featureVersion: '1.0.0' })]: { ...preview, checks: [] },
  [url('featureDetail', { id: FEAT, ver: '1.0.0' })]: {
    feature: { name: '전방 안전거리 3단계', ownerId: 'ADAS상품기획팀', country: 'KR', baselineId: 'BL-00028', ecuPnos: ['99211-NX400'], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'] },
  },
  [url('safetyProfile', { id: FEAT, ver: '1.0.0' })]: { profile: { sbomRef: 'urn:cdx:3e671687-395b-41f5-a30f-a58921a69b79/1', rxswin: [] } },
  [url('publications')]: { items: [{ publicationId: 'PUB-00029', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-06T00:00:00.000Z', payload: { targets: [], flagKey: 'care_00022_param', featureId: FEAT, policy: { policyId: 'POL-00002', revision: 1 } } }] },
  [url('evidenceLedger')]: {
    items: [
      { evidenceRef: 'EV-PASS-G5', gate: 'G5', featureId: FEAT, featureVersion: '1.0.0', inputResult: 'PASS' },
      { evidenceRef: 'EV-FAIL', gate: 'G5', featureId: FEAT, featureVersion: '1.0.0', inputResult: 'FAIL' },
    ],
  },
};
const flagsOf = (on: boolean) => [
  { flagKey: 'care_00022_param', publicationId: 'PUB-00002', sequence: 1, local: { value: on, reason: 'POLICY_MATCH' }, server: { value: on, reason: 'POLICY_MATCH' }, drift: false },
  { flagKey: 'ivi_00024_guide', publicationId: 'PUB-00028', sequence: 2, local: { value: true, reason: 'POLICY_MATCH' }, server: { value: true, reason: 'POLICY_MATCH' }, drift: false },
];
const rt = (vin: string) => ({ vin, label: vin, scope: 'KR/NX4 PE/Premium', link: vin === OFFLINE ? 'OFFLINE' : 'ONLINE', quality: 'TRUSTED', gleo: false, featureState: {}, kills: [], flags: flagsOf(true), last: null });
Object.assign(SNAP, {
  [url('fleetRuntime')]: { items: VINS.map(rt) },
  [url('listPolicies')]: { items: [{ policyId: 'POL-00002', revision: 1, featureId: FEAT, featureVersion: '1.0.0', flagKey: 'care_00022_param', status: 'DEPLOYED', safeDefault: false }] },
  [url('vehicles')]: { items: VINS.map((vin) => ({ vin, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' })) },
  [url('listFeatures')]: { items: [{ featureId: FEAT, version: '1.0.0', country: 'KR', vehicleModel: 'NX4 PE' }] },
  [url('readbacks')]: { items: [] },
  [url('integrationCalls', {}, { ifId: 'IF-04' })]: { items: [] },
  [url('operationSummary')]: { readbacks: true, total: 4, safe: 0 },
  [url('fleetMap', {}, { source: 'FLEET', flagKey: 'care_00022_param' })]: {
    items: VINS.map((vin) => ({ vin, country: 'KR', link: vin === OFFLINE ? 'OFFLINE' : 'ONLINE', activation: vin === OFFLINE ? 'UNKNOWN' : 'ON', kills: [] })),
    summary: [{ country: 'KR', total: 4, activation: { ON: 3, OFF: 0, DISABLED: 0, UNKNOWN: 1 } }],
  },
  // Feature Flag 탭 — 서버 스냅샷 행(차단 없음)
  [url('featureFlags', {}, { featureId: FEAT, version: '1.0.0' })]: [{ flagKey: 'care_00022_param', featureId: FEAT, version: '1.0.0', featureName: '전방 안전거리 3단계', policy: { policyId: 'POL-00002', status: 'DEPLOYED', revision: 1, controlPoint: 'Flag' }, sources: [], publication: null, kill: null }],
  [url('vehicleStatusView', { vin: VINS[0] })]: { vin: VINS[0], features: [{ featureId: FEAT, state: 'ACTIVE', reportSeq: 7, report: { state: 'ACTIVE' }, updatedAt: '2026-11-06T00:00:00.000Z' }], recent: [] },
});
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
const byFile = new Map(Object.entries(SNAP).map(([u, v]) => ['/' + snapshotFile(u), v]));

type Sim = typeof import('../api/sim');
let sim: Sim;
let engine: typeof import('../api/sim/engine');
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const run = (name: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; role?: string; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role: o.role, actorRole: o.actorRole });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (byFile.has(u) ? json(byFile.get(u)) : html())));
  localStorage.clear();
  sim = await import('../api/sim');
  engine = await import('../api/sim/engine');
});
afterEach(() => {
  engine.__resetSimForTest();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('시연 라우터', () => {
  it('등록 안 된 쓰기는 처리됨 + 감사·개발 목록, 화면을 깨지 않는다', async () => {
    window.__simUnhandled = [];
    // 화면 버튼이 없는 쓰기(승인자 공개키 등록)는 핸들러가 없다 — 처리됨으로 받는다
    const out = await run('registerApproverKey', { role: 'integrator', body: { userId: 'usr-quality', publicKeyPem: 'P'.repeat(44), reason: '키 유출 대응' } });
    expect(out).toMatchObject({ ok: true, reason: '키 유출 대응' });
    expect(window.__simUnhandled!.map((x) => x.name)).toEqual(['registerApproverKey']);
    const audit = await run('audit', { query: { limit: 100 } });
    expect(audit.items[0]).toMatchObject({ action: 'registerApproverKey', actorId: 'usr-integrator', result: 'ALLOWED', after: { reason: '키 유출 대응' } });
    expect(localStorage.getItem('ff.sim')).toBeTruthy();
  });
  it('역할·본문은 서버와 같은 규칙 — 403 거부도 감사(DENIED), 400은 입력 칸 오류', async () => {
    await expect(run('bumpEpoch', { role: 'viewer', body: { reason: '키 유출 대응' } })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    // 본문 — 핸들러가 등록한 contracts 스키마(서버 ZodPipe와 같은 strict 검증)
    await expect(run('approveKill', { params: { id: 'KILL-00007' }, role: 'quality', body: { comment: 'x', extra: 1 } })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
    const audit = await run('audit', { query: { limit: 100 } });
    expect(audit.items.map((a: any) => a.result)).toEqual(['DENIED']);
    const chain = await run('auditChain');
    expect(chain.verified).toBe(11);
    expect(chain.head).not.toBe('aa'.repeat(32));
  });
  it('스냅샷에도 시연 데이터에도 없으면 정적 클라이언트와 같은 404', async () => {
    await expect(run('masterEcu')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('병합기', () => {
  it('목록 — ID 기준 교체, 새 항목 앞에, 질의에서 빠진 것은 빼고 건수 갱신', () => {
    const o: any = { entities: { kill: { 'K-1': { id: 'K-1', status: 'RELEASED' }, 'K-3': { id: 'K-3', status: 'ACTIVE' } } }, created: { kill: ['K-3'] }, data: {} };
    const view = { collection: 'kill', idKey: 'id', filter: (e: any, q: any) => !q.status || e.status === q.status };
    const req: any = { params: {}, query: { status: 'ACTIVE' } };
    const base = { items: [{ id: 'K-1', status: 'ACTIVE' }, { id: 'K-2', status: 'ACTIVE' }], total: 2 };
    const out = engine.applyView(view, o, req, base, {} as any);
    expect(out.items.map((x: any) => x.id)).toEqual(['K-3', 'K-2']);
    expect(out.total).toBe(2);
    const detail = engine.applyView({ ...view, detailParam: 'id' }, o, { params: { id: 'K-1' }, query: {} } as any, { id: 'K-1', status: 'ACTIVE', extra: 1 }, {} as any);
    expect(detail).toEqual({ id: 'K-1', status: 'RELEASED', extra: 1 });
  });
});

describe('초기화·판', () => {
  it('처음 상태로 — 바뀐 것을 버리고 스냅샷으로', async () => {
    await run('bumpEpoch', { role: 'integrator', body: { reason: '키 유출 대응' } });
    expect((await run('audit', { query: { limit: 100 } })).items).toHaveLength(1);
    await sim.resetSim();
    expect(localStorage.getItem('ff.sim')).toBeNull();
    expect((await run('audit', { query: { limit: 100 } })).items).toHaveLength(0);
  });
  it('스냅샷 판이 바뀌면(재배포) 예전 시연 데이터는 자동으로 버린다', async () => {
    const store = await import('../api/sim/store');
    const o = store.emptyOverlay('old-version');
    o.audit = [{ id: 1 } as any];
    await store.saveOverlay(o);
    expect((await store.loadOverlay('old-version')).audit).toHaveLength(1);
    expect((await store.loadOverlay('new-version')).audit).toHaveLength(0);
    expect((await store.loadOverlay('old-version')).audit).toHaveLength(0);
  });
});

describe('캡처 OTA 작업의 재전송 경계', () => {
  const file = '/' + snapshotFile(url('otaJobs'));
  const capturedJob = { jobId: 'OTA-CAPTURED', state: 'RETRY_WAIT', attempts: 2, vehicles: [{ vin: OFFLINE, outcome: 'NO_RESPONSE' }] };
  afterEach(() => { byFile.delete(file); });

  it('캡처 작업은 구체적인 409 안내와 거부 감사만 남기고 원본·회신을 보존한다', async () => {
    const original = { items: [capturedJob] };
    const bytes = JSON.stringify(original);
    byFile.set(file, original);
    window.__simUnhandled = [];
    let error: any;
    try { await run('otaJobRetry', { params: { jobId: capturedJob.jobId }, role: 'operator', body: { reason: '통신 복구 확인' } }); }
    catch (e) { error = e; }
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', details: { boundary: 'CAPTURED_READ_ONLY' } });
    const { userMessage, errorKind } = await import('../api/errors');
    expect(userMessage(errorKind(error.status), error.status, error.message)).toContain('읽기 전용');
    expect(JSON.stringify(original)).toBe(bytes);
    expect(engine.__overlayForTest()!.events).toEqual([]);
    expect(engine.__overlayForTest()!.tasks).toEqual([]);
    expect(engine.__overlayForTest()!.data.killDelivery).toBeUndefined();
    expect((await run('audit', { query: { limit: 100 } })).items[0]).toMatchObject({ action: 'OTA_JOB_RETRY', target: capturedJob.jobId, result: 'DENIED' });
    expect(window.__simUnhandled).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  });

  it('완전한 native 목록에 없는 작업만 404로 거부한다', async () => {
    byFile.set(file, { items: [capturedJob] });
    await expect(run('otaJobRetry', { params: { jobId: 'OTA-UNKNOWN' }, role: 'operator', body: { reason: '작업 확인' } })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', details: { boundary: 'NOT_FOUND' } });
    expect(engine.__overlayForTest()!.audit[0]).toMatchObject({ action: 'OTA_JOB_RETRY', target: 'OTA-UNKNOWN', result: 'DENIED' });
  });

  it.each(['missing', 'bounded'] as const)('원천 %s 상태에서는 부재를 추정하거나 완료하지 않는다', async (kind) => {
    if (kind === 'bounded') byFile.set(file, { items: Array.from({ length: 200 }, (_, i) => ({ jobId: `OTA-${i}` })) });
    await expect(run('otaJobRetry', { params: { jobId: 'OTA-UNKNOWN' }, role: 'operator', body: { reason: '작업 확인' } })).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: { boundary: 'SOURCE_UNVERIFIED' } });
    expect(engine.__overlayForTest()!.events).toEqual([]);
    expect(engine.__overlayForTest()!.audit[0].result).toBe('DENIED');
  });
});

describe('대표 흐름 — 긴급 차단 → 2인 승인 → 회신 → 재전송 → 복원', () => {
  const issueBody = { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: '전방 거리 오판정 의심', confirm: FEAT };
  it('접수를 차단 요청으로 한 번만 옮기며 다른 Feature·닫힌 접수는 거부한다',async()=>{
    const intake={intakeId:'KIN-00001',featureId:FEAT,status:'RECEIVED',anomalyId:'ANM-00001',receivedAt:'2026-11-01T00:00:00Z',killId:null};
    const file='/'+snapshotFile(url('killIntakes',{}, {status:'RECEIVED'}));byFile.set(file,{items:[intake]});
    try {
      const body={...issueBody,intakeId:intake.intakeId,containmentJustification:'현장 조사 중 봉쇄'};
      await expect(run('issueKill',{role:'operator',body:{...body,featureId:'FEAT-00099',confirm:'FEAT-00099'}})).rejects.toMatchObject({code:'VALIDATION'});
      const k=await run('issueKill',{role:'operator',body});expect(k).toMatchObject({status:'REQUESTED',intakeId:intake.intakeId,incidentId:intake.anomalyId,anomalyId:intake.anomalyId});
      expect((await run('killIntakes',{query:{status:'RECEIVED'}})).items).toHaveLength(0);
      const done=(await run('killIntakes')).items.find((x:any)=>x.intakeId===intake.intakeId);expect(done).toMatchObject({status:'CONVERTED',killId:k.killId,receivedAt:intake.receivedAt});
      await expect(run('issueKill',{role:'operator',body})).rejects.toMatchObject({code:'CONFLICT'});
      expect(engine.__overlayForTest()!.audit.filter(a=>a.action==='KILL_INTAKE_CONVERT')).toHaveLength(1);
    } finally {byFile.delete(file);}
  });

  it('사전 점검은 서버와 같은 게이트 규칙 — 봉쇄 근거가 없으면 PLT-009만 실패, 있으면 통과', async () => {
    const without = await run('killPreview', { query: { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY' } });
    for (const c of preview.checks) expect(without.checks.find((x: any) => x.rule === c.rule)?.ok).toBe(c.ok);
    expect(without.checks.filter((c: any) => !c.ok).map((c: any) => c.rule)).toEqual(['FFG-PLT-009']);
    const withC = await run('killPreview', { query: { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY', containmentJustification: '현장 조사 중 봉쇄' } });
    expect(withC.checks.every((c: any) => c.ok)).toBe(true);
  });

  it('요청·승인 규칙 위반은 서버와 같은 오류와 실패 감사', async () => {
    await expect(run('issueKill', { role: 'operator', body: { ...issueBody, confirm: 'FEAT-00099' } })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
    await expect(run('issueKill', { role: 'operator', body: issueBody })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' }); // 봉쇄 근거 없음
    await expect(run('issueKill', { role: 'viewer', body: { ...issueBody, containmentJustification: 'x 봉쇄' } })).rejects.toMatchObject({ status: 403 });
    const audit = await run('audit', { query: { limit: 100 } });
    expect(audit.items.map((a: any) => a.result)).toEqual(['DENIED', 'FAILED', 'FAILED']);
  });

  it('끝까지 — 상태·감사·알림·이벤트·회신이 같은 규칙으로 바뀐다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const k = await run('issueKill', { role: 'operator', body: { ...issueBody, containmentJustification: '현장 조사 중 영향 차량 봉쇄' } });
    expect(k).toMatchObject({ killId: 'KILL-00008', status: 'REQUESTED', vins: VINS, fsmRequired: true });
    // 목록 앞에 붙고, 미리보기는 진행 중 차단을 본다(같은 대상 새 요청 막힘)
    expect((await run('killRequests')).items.map((x: any) => x.killId)).toEqual(['KILL-00008', 'KILL-00007']);
    expect((await run('killPreview', { query: { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY' } })).activeKill).toBe('KILL-00008');
    await expect(run('issueKill', { role: 'operator', body: { ...issueBody, containmentJustification: '다시' } })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    // 알림 — 승인할 수 있는 FSM·CSM 역할에게, 요청자 제외
    const q = (await run('notifications', { query: { limit: 6 }, role: 'quality' })).items;
    expect(q[0]).toMatchObject({ eventType: 'kill.requested', category: 'APPROVAL', link: '/ops/kill?id=KILL-00008' });
    expect((await run('notifications', { query: { limit: 6 }, role: 'operator' })).items[0].eventType).not.toBe('kill.requested');
    // 승인 — 요청자는 승인 역할이 없다(403), FSM 먼저, 같은 사람 두 번 안 됨, 남은 칸은 CSM만
    await expect(run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'operator' })).rejects.toMatchObject({ status: 403 });
    const one = await run('approveKill', { params: { id: 'KILL-00008' }, body: { comment: '기능안전 확인' }, role: 'quality' });
    expect(one.approvals.map((a: any) => a.role)).toEqual(['FSM']);
    await expect(run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'quality' })).rejects.toMatchObject({ status: 409, details: { code: 'DUPLICATE' } });
    await expect(run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'opslead' })).rejects.toMatchObject({ status: 409, details: { code: 'CSM_REQUIRED' } });
    const two = await run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'integrator', actorRole: 'SECURITY_OFFICER' });
    expect(two).toMatchObject({ status: 'ACTIVE', gate: { result: 'PASS' }, command: { commandSeq: 13, envelopes: 4 }, delivery: { status: 'DISPATCHED', confirmed: 0, denominator: 4 } });
    expect(two.approvals.map((a: any) => a.role)).toEqual(['FSM', 'CSM']);
    expect(two.approvals[0].sig).toMatch(/^[A-Za-z0-9_-]{85}[AQgw]$/);
    const env = await run('killEnvelopes', { params: { id: 'KILL-00008' } });
    expect(env.envelopes).toHaveLength(4);
    expect(env.envelopes[0].vehicle_auth).toMatchObject({ key_epoch: 1, vehicle_seq: 1 });
    // 회신 — 몇 초에 걸쳐(통신되는 3대), 끊긴 차량은 남는다
    await vi.advanceTimersByTimeAsync(1300);
    const mid = await run('killDetail', { params: { id: 'KILL-00008' } });
    expect(mid.delivery.confirmed).toBeGreaterThan(0);
    expect(mid.delivery.confirmed).toBeLessThan(3);
    await vi.advanceTimersByTimeAsync(8000);
    const after = await run('killDetail', { params: { id: 'KILL-00008' } });
    expect(after.delivery).toMatchObject({ status: 'DISPATCHED', confirmed: 3, denominator: 4 });
    expect(after.delivery.nodes.find((n: any) => n.nodeId === OFFLINE)).toMatchObject({ state: 'UNKNOWN', reason: 'NO_REPORT' });
    const pub = await run('publicationDetail', { params: { id: after.publicationId } });
    expect(pub.delivery).toMatchObject({ state: 'RETRY_WAIT', otaJobId: null, counts: { DELIVERED: 3, NO_RESPONSE: 1 } });
    // 차량 화면들이 같은 상태 — Fleet 현황(local KILL_SWITCH)·지도 활성화 렌즈(DISABLED)·홈 수신 현황(SAFE)·차량 상태 보고
    const runtime = (await run('fleetRuntime')).items;
    const r0 = runtime.find((r: any) => r.vin === VINS[0]);
    expect(r0).toMatchObject({ featureState: { [FEAT]: 'DISABLED' }, kills: [FEAT] });
    expect(r0.flags[0]).toMatchObject({ local: { value: false, reason: 'KILL_SWITCH' }, server: { reason: 'KILL_SWITCH' }, drift: false });
    expect(r0.flags[1].local.reason).toBe('POLICY_MATCH');
    expect(runtime.find((r: any) => r.vin === OFFLINE).flags[0]).toMatchObject({ local: { reason: 'POLICY_MATCH' }, server: { reason: 'KILL_SWITCH' }, drift: true });
    const map = await run('fleetMap', { query: { source: 'FLEET', flagKey: 'care_00022_param' } });
    expect(map.items.find((v: any) => v.vin === VINS[0])).toMatchObject({ activation: 'DISABLED', kills: [FEAT] });
    expect(map.summary[0].activation).toEqual({ ON: 0, OFF: 0, DISABLED: 3, UNKNOWN: 1 });
    const home = await run('operationSummary', { role: 'operator' });
    expect(home).toMatchObject({ total: 4, safe: 3, attention: { counts: { SAFE: 3 } } });
    expect((await run('vehicleStatusView', { params: { vin: VINS[0] } })).features[0]).toMatchObject({ state: 'DISABLED', reportSeq: 8 });
    const tl = await run('killTimeline', { params: { id: 'KILL-00008' } });
    expect(tl.items.find((t: any) => t.vin === VINS[0])).toMatchObject({ cause: 'REMOTE_KILL', deactivate: { accepted: { trust: 'TRUSTED' }, completed: { trust: 'TRUSTED' } } });
    // 재전송 — 끊긴 차량에 다시 보내면 회신이 들어와 닫힌다(CONFIRMED)
    await run('otaJobRetry', { params: { jobId: pub.delivery.jobId }, body: { reason: '통신 복구 후 다시 보내기' }, role: 'operator' });
    await vi.advanceTimersByTimeAsync(3000);
    const closed = await run('killDetail', { params: { id: 'KILL-00008' } });
    expect(closed.delivery).toMatchObject({ status: 'CONFIRMED', confirmed: 4 });
    // 이벤트 — 버스(SSE와 같은 모양)와 이력, 감사 체인
    const events = (await run('events', { query: { limit: 500, recent: '1' } })).items.map((e: any) => e.type);
    expect(events).toEqual(expect.arrayContaining(['kill.requested', 'kill.approved', 'publication.dispatched', 'kill.issued', 'vehicle.readback', 'publication.closed']));
    const audit = (await run('audit', { query: { limit: 100 } })).items.map((a: any) => a.action);
    expect(audit.slice(0, 1)).toEqual(['OTA_JOB_RETRY']);
    expect(audit).toEqual(expect.arrayContaining(['KILL_REQUEST', 'KILL_APPROVE', 'KILL_ISSUE']));
    expect((await run('notifications', { query: { limit: 6 }, role: 'operator' })).items[0]).toMatchObject({ eventType: 'kill.issued', category: 'SAFETY' });

    // 복원 — 차단 해제(desired INACTIVE, 활성화 아님). 재검증 Evidence는 이 Feature의 PASS만
    // 해제 확인 항목을 체크하지 않으면 요청을 만들지 않는다(서버와 같은 규칙, FR-KSW-004-002)
    await expect(run('requestRestore', { params: { id: 'KILL-00008' }, body: { reason: '원인 조치', evidenceRef: 'EV-PASS-G5', cohort: VINS, resolved: true }, role: 'operator' })).rejects.toMatchObject({ status: 400 });
    await expect(run('requestRestore', { params: { id: 'KILL-00008' }, body: { reason: '원인 조치', evidenceRef: 'EV-FAIL', cohort: VINS, resolved: true, causeFixed: true } , role: 'operator' })).rejects.toMatchObject({ status: 400 });
    const rr = await run('requestRestore', { params: { id: 'KILL-00008' }, body: { reason: '원인 조치·재검증 완료', evidenceRef: 'EV-PASS-G5', cohort: VINS, resolved: true, causeFixed: true }, role: 'operator' });
    expect(rr.restoreRequest).toMatchObject({ status: 'REQUESTED', cohort: VINS });
    expect(rr.restoreOutlook.complete).toBe(true);
    // 직전 차단 승인자는 복원을 승인할 수 없다(SOD)
    await expect(run('approveRestore', { params: { id: 'KILL-00008' }, body: {}, role: 'quality' })).rejects.toMatchObject({ status: 409, details: { code: 'KILL_APPROVER' } });
    await run('approveRestore', { params: { id: 'KILL-00008' }, body: {}, role: 'safety2' });
    const released = await run('approveRestore', { params: { id: 'KILL-00008' }, body: {}, role: 'opslead' });
    expect(released).toMatchObject({ status: 'RELEASED', restoredVins: VINS, restoreRequest: { status: 'APPROVED', command: { commandSeq: 14 } }, restore: { status: 'DISPATCHED' } });
    const rpub = await run('publicationDetail', { params: { id: released.restorePublicationId } });
    expect(rpub.publication.payload.desired).toBe('INACTIVE');
    expect((await run('killRequests', { query: { status: 'ACTIVE' } })).items).toHaveLength(0);
    // 복원 회신 — 차단 해제(INACTIVE), local은 차단 전 판단으로 돌아간다(복원 ≠ 활성화: 정책 판단을 새로 켜지 않는다)
    await vi.advanceTimersByTimeAsync(8000);
    const back = (await run('fleetRuntime')).items.find((r: any) => r.vin === VINS[0]);
    expect(back).toMatchObject({ featureState: { [FEAT]: 'INACTIVE' }, kills: [] });
    expect(back.flags[0]).toMatchObject({ local: { value: true, reason: 'POLICY_MATCH' }, server: { reason: 'POLICY_MATCH' } });
    expect((await run('operationSummary', { role: 'operator' })).safe).toBe(0);

    // 처음 상태로 — 새 차단·알림·감사가 모두 사라진다
    await sim.resetSim();
    expect((await run('killRequests')).items.map((x: any) => x.killId)).toEqual(['KILL-00007']);
    expect((await run('notifications', { query: { limit: 6 }, role: 'quality' })).items.map((n: any) => n.notificationId)).toEqual(['NTF-00041']);
  });

  it('알림 읽음은 계정별로 이 브라우저에 남는다', async () => {
    await run('readNotification', { params: { id: 'NTF-00041' }, body: {}, role: 'quality' });
    expect((await run('notifications', { query: { limit: 6 }, role: 'quality' })).unread).toBe(0);
    expect((await run('notifications', { query: { limit: 6 }, role: 'operator' })).unread).toBe(1);
    // 모두 읽음 — 쪽 밖의 스냅샷 알림도 읽은 것으로(안 읽음 0, 범주 집계 0)
    await run('readAllNotifications', { body: {}, role: 'operator' });
    expect(await run('notifications', { query: { limit: 6 }, role: 'operator' })).toMatchObject({ unread: 0, byCategory: { GATE: 0 } });
  });
});

// 사용자 결정(2026-11-06): Feature Flag 탭 5단계에도 진행 중 긴급 차단 — 서버(flag-source.service)와 같은 규칙(contracts flagKillOf)
describe('Feature Flag 탭 — 진행 중 긴급 차단', () => {
  it('승인으로 차단 중이면 반영 n/m, 해제하면 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const flags = async () => (await run('featureFlags', { query: { featureId: FEAT, version: '1.0.0' } }))[0];
    expect((await flags()).kill).toBeNull();
    await run('issueKill', { role: 'operator', body: { featureId: FEAT, featureVersion: '1.0.0', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: '전방 거리 오판정 의심', confirm: FEAT, containmentJustification: '현장 조사 중 봉쇄' } });
    expect((await flags()).kill).toBeNull(); // 승인 대기는 아직 차단이 아니다
    await run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'quality' });
    await run('approveKill', { params: { id: 'KILL-00008' }, body: {}, role: 'integrator', actorRole: 'SECURITY_OFFICER' });
    expect((await flags()).kill).toEqual({ killId: 'KILL-00008', confirmed: 0, denominator: 4 });
    await vi.advanceTimersByTimeAsync(9300);
    expect((await flags()).kill).toEqual({ killId: 'KILL-00008', confirmed: 3, denominator: 4 });
    await run('requestRestore', { params: { id: 'KILL-00008' }, body: { reason: '원인 조치·재검증 완료', evidenceRef: 'EV-PASS-G5', cohort: VINS, resolved: true, causeFixed: true }, role: 'operator' });
    await run('approveRestore', { params: { id: 'KILL-00008' }, body: {}, role: 'safety2' });
    await run('approveRestore', { params: { id: 'KILL-00008' }, body: {}, role: 'opslead' });
    expect((await flags()).kill).toBeNull();
  });
});

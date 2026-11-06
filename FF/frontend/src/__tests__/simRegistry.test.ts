// 공개 시연 사이트의 브라우저 안 쓰기 — registry 묶음(api/sim/handlers/registry, 설계 20-60).
// 제안(Feature 등록) → 안전 분류 확정 → 분석 근거(HARA) → Gate 판정 → 정의 승인(자동 개발 착수), Release Sign-off → 출시, Baseline 요청·결정,
// Feature DB 추가 요청·변경 요청 → 도메인 검토 → 승인(직무 분리 SOD-13·14·15) → 발행, 업무 절차 활동 완료·취소를 서버와 같은 규칙으로 보는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';

const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const GATE = (id: string, ver: string, g: string, n: number) => ({ gateRecordId: `SIM-${g}-${String(n).padStart(6, '0')}`, featureId: id, featureVersion: ver, country: 'KR', gate: g, gateName: g, inputResult: 'PASS', rationale: '이관', evidenceRef: `EV-${g}`, judgeRole: '판정', judgedAt: '2026-03-03T09:00:00+09:00', status: 'PASS', gateStageLifecycle: 'PROPOSED', currentLifecycle: 'VERIFIED', transitionNote: '', _missing: {} });
const ROW = (o: Record<string, unknown>) => ({
  description: '설명',
  requirementIds: ['REQ-1'],
  country: 'KR',
  vehicleModel: 'NX4 PE',
  trim: 'Premium',
  baselineId: null,
  ownerId: 'UX기획팀',
  tags: [],
  asil: 'QM',
  upgVc: ['F111A111001'],
  functions: [{ functionId: 'FUNC-000004', label: 'SVM' }],
  swIds: ['SW-SVM'],
  swVersions: ['1.0.0'],
  ecuPnos: ['99211-NX400'],
  controlPoints: ['Signal'],
  dependencyIds: [],
  catalogIds: [],
  gateRecordIds: [],
  _missing: {},
  featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY', refVersion: 'v1.3' }],
  ...o,
});
const F144 = ROW({ featureId: 'FEAT-00144', name: '서라운드 뷰 모니터', version: '3.3.0', lifecycle: 'VERIFIED', baselineId: 'BL-00162' });
const F13 = ROW({ featureId: 'FEAT-00013', name: '예측 공조', version: '0.3.0', lifecycle: 'PROPOSED', functions: [], swIds: [], swVersions: [], ecuPnos: [], featureRefs: [{ refId: 'AD-PRK-005', role: 'PRIMARY', refVersion: 'v1.3' }] });
const gates144 = Object.fromEntries(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].map((g, i) => [g, GATE('FEAT-00144', '3.3.0', g, 100 + i)]));
const summary = (f: any, gates: Record<string, any>) => ({ featureId: f.featureId, version: f.version, isLatest: true, name: f.name, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, lifecycle: f.lifecycle, baselineId: f.baselineId, ownerId: f.ownerId, asil: f.asil, tags: f.tags, controlPoints: f.controlPoints, featureRefCount: 1, gates: Object.fromEntries(Object.entries(gates).map(([g, r]) => [g, r.status])) });
const REF = (refId: string, o: Record<string, unknown> = {}) => ({ refId, status: 'ACTIVE', replacedBy: null, registeredIn: 'v0.5', evidenceCheckedAt: '2026-09-20', domain: 'ADAS & AD', cluster: 'Parking', component: 'Parking assistance', swStack: 'Application', lifecycle: 'Commodity', techStack: 'Automotive', vehicleType: '공통', region: '글로벌', nameEn: 'Surround view', nameKo: '서라운드 뷰', aliases: [], autoQuality: 'High', techQuality: 'High', asilRep: 'QM', method: 'Parametric', tshirt: 'L', bundleId: null, bundleRep: null, sizeEvidenceGrade: 'D', relevance: 'High', sourceIds: ['S20'], sourceDetail: 'ISO 16505', remark: '', basisType: '표준 기반 도출', duplicateOf: null, requires: [], excludes: [], procurement: '협력사 개발', swPackage: '', licenseItem: '', billing: '', definition: null, adminMemo: '', ...o });
const CHANGE = (changeId: string, refId: string, reviewer: string, opinion = 'AGREE') => ({ changeId, kind: 'MODIFY', refId, before: { tshirt: 'L' }, after: { tshirt: 'M' }, reason: '사내 실적 반영', requestedBy: 'usr-author', requestedAt: '2026-11-06T02:15:18.974Z', status: 'REVIEW', reviews: [{ reviewerId: reviewer, opinion, comment: '검토', at: '2026-11-06T02:15:19.000Z' }], decision: null, release: null, checks: [], awaitingPublish: false, domain: 'ADAS & AD' });
const usedBy144 = [{ featureId: 'FEAT-00144', version: '3.3.0', role: 'PRIMARY', refVersion: 'v1.3', lifecycle: 'VERIFIED', name: '서라운드 뷰 모니터', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }];

const PROFILE144 = {
  featureId: 'FEAT-00144', version: '3.3.0', status: 'CONFIRMED', source: 'MANUAL', fClass: 'F1', deactClass: 'DC1', regClass: 'R0', flagType: 'OPS', adsFeature: false, adsfType: null, gsrMandatory: false,
  itemIds: [], haraRef: null, asilRef: 'QM', safetyGoalIds: [], safeState: null, endState: null, takeoverMs: 0, rampMs: 0, faultRampMs: 0, faultTolerantTimeMs: 0, maxPendingMs: 600000, maxCycleWaitMs: 28800000,
  maxActivationScope: { vehicles: 50000, perWindow: 5000 }, markets: ['KR'], rxswin: [], approvalProfile: null, evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null,
  confirmedBy: 'usr-quality', confirmedAt: '2026-11-01T00:00:00.000Z', confirmSig: 'sig',
};
const SNAP: Record<string, unknown> = {
  [url('auditChain')]: { ok: true, verified: 10, head: 'bb'.repeat(32), checkedAt: '2026-11-06T01:00:00.000Z' },
  [url('events', {}, { limit: 500, recent: '1' })]: { items: [{ seq: 41, id: 'e41', type: 'x', at: '2026-11-06T00:00:00.000Z', aggregate: 'A', componentId: null, payload: {} }] },
  [url('audit', {}, { limit: 500 })]: { items: [{ id: 233, at: '2026-11-06T00:00:00.000Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'X', target: 'Y', result: 'ALLOWED', reason: null, before: null, after: null, correlationId: null, componentId: null }], nextCursor: null },
  [url('notifications', {}, { limit: 200 })]: { items: [], unread: 0, byCategory: {} },
  [url('listFeatures', {}, { latestOnly: false })]: { total: 2, items: [summary(F144, gates144), summary(F13, {})], nextCursor: null, facets: {} },
  [url('featureDetail', { id: 'FEAT-00144', ver: '3.3.0' })]: { feature: F144, meta: { createdBy: null, createdAt: null }, gates: gates144, dependencies: { outgoing: [], incoming: [] }, functions: [], trace: [], baseline: null, products: [], pendingBaselineRequest: null, transitions: [], versions: [{ version: '3.3.0', lifecycle: 'VERIFIED', baselineId: 'BL-00162' }] },
  [url('gates', { id: 'FEAT-00144', ver: '3.3.0' })]: { gates: Object.values(gates144).map((r: any) => ({ gate: r.gate, latest: r, decision: { state: 'IMPORTED', reason: null }, status: 'PASS', history: [r] })), lifecycle: 'VERIFIED', rehara: [] },
  [url('releaseSignoff', { id: 'FEAT-00144', ver: '3.3.0' })]: { signoff: null, valid: false, stale: false },
  [url('safetyProfile', { id: 'FEAT-00144', ver: '3.3.0' })]: { profile: PROFILE144, findings: [], asil: { conditions: [{ id: 'TOOL_CONFIDENCE', met: true }] } },
  [url('featureDetail', { id: 'FEAT-00013', ver: '0.3.0' })]: { feature: F13, meta: { createdBy: null, createdAt: null }, gates: {}, dependencies: { outgoing: [], incoming: [] }, functions: [], trace: [], baseline: null, products: [], pendingBaselineRequest: null, transitions: [], versions: [{ version: '0.3.0', lifecycle: 'PROPOSED', baselineId: null }] },
  [url('refDetail', { refId: 'AD-PRK-004' })]: { ref: REF('AD-PRK-004'), usedBy: usedBy144 },
  [url('refDetail', { refId: 'AD-PRK-005' })]: { ref: REF('AD-PRK-005', { nameKo: '주차 경고' }), usedBy: [] },
  [url('listRefs', {}, { limit: 200 })]: { items: [REF('AD-PRK-001'), REF('AD-PRK-002'), REF('AD-PRK-004'), REF('AD-PRK-005', { nameKo: '주차 경고' })], total: 4, offset: 0, limit: 200 },
  [url('refDetail', { refId: 'AD-PRK-001' })]: { ref: REF('AD-PRK-001'), usedBy: [] },
  [url('refDetail', { refId: 'AD-PRK-002' })]: { ref: REF('AD-PRK-002'), usedBy: [] },
  [url('masterSw')]: { items: [{ swId: 'SW-SVM', version: '1.0.0', ecuPno: '99211-NX400', safetyClass: 'F1', lifecycle: 'RELEASED' }] },
  [url('masterEcu')]: { items: [{ ecuPno: '99211-NX400', lifecycle: 'ACTIVE' }] },
  [url('refTaxonomy')]: { items: [{ nodeId: 'AD', level: 'DOMAIN', parentId: null, nameEn: 'ADAS & AD', abbr: 'AD' }, { nodeId: 'AD/Parking assistance', level: 'COMPONENT', parentId: 'AD', nameEn: 'Parking assistance', abbr: 'PRK', abbrs: ['PRK'], clusterIds: ['AD:Parking'] }, { nodeId: 'AD:Parking', level: 'CLUSTER', parentId: 'AD', nameEn: 'Parking', abbr: null }] },
  [url('refSources')]: { items: [{ sourceId: 'S20', title: 'ISO 16505', checkedAt: null, nextReviewAt: null, usedBy: 3 }], noNextReview: 1 },
  [url('refReleases')]: { items: [{ release: 'v1.4' }] },
  [url('listRefChanges')]: { items: [CHANGE('CR-2026-006', 'AD-PRK-004', 'usr-approver'), CHANGE('CR-2026-007', 'AD-PRK-005', 'usr-steward'), CHANGE('CR-2026-008', 'AD-PRK-005', 'usr-approver', 'REVISE')], total: 3 },
  [url('refChangeDetail', { id: 'CR-2026-006' })]: { change: CHANGE('CR-2026-006', 'AD-PRK-004', 'usr-approver') },
  [url('refChangeDetail', { id: 'CR-2026-007' })]: { change: CHANGE('CR-2026-007', 'AD-PRK-005', 'usr-steward') },
  [url('refChangeDetail', { id: 'CR-2026-008' })]: { change: CHANGE('CR-2026-008', 'AD-PRK-005', 'usr-approver', 'REVISE') },
  [url('baselineRequests')]: { items: [] },
  [url('baselines')]: { items: [{ baselineId: 'BL-00162', featureId: 'FEAT-00144', version: '3.3.0', snapshot: { lifecycle: 'VERIFIED' }, products: [] }] },
  [url('procedureState')]: { items: [], done: [], updatedAt: null },
  [url('dependencies')]: { items: [] },
  [url('listPolicies')]: { items: [{ policyId: 'POL-00007', flagKey: 'svm_view_flag', featureId: 'FEAT-00144', featureVersion: '3.3.0', status: 'DEPLOYED' }] },
  [url('flagRetirements')]: { items: [], steps: [] },
};
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
const byFile = new Map(Object.entries(SNAP).map(([u, v]) => ['/' + snapshotFile(u), v]));

let sim: typeof import('../api/sim');
let engine: typeof import('../api/sim/engine');
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const run = (name: string, role: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role, actorRole: o.actorRole });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { status: number; code: string; message: string; details?: any };
  }
  throw new Error('거부되어야 합니다');
};
const audits = () => engine.__overlayForTest()!.audit;

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const CREATE = { name: '후방 주차 안내', description: '후방 카메라 주차 안내', requirementIds: ['REQ-PARK-0201'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Exclusive', ownerId: 'Parking기획팀', asil: 'QM', tags: ['parking'], upgVc: ['F111A111001'], controlPoints: ['Flag'], featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY' }] };
const pass = (gate: string, extra: Record<string, unknown> = {}) => ({ gate, inputResult: 'PASS', rationale: `${gate} 통과`, evidenceRef: `EV-${gate}`, ...extra });

describe('Feature 제안 → 안전 분류 → Gate → 정의 승인', () => {
  it('등록은 다음 FEAT 번호 PROPOSED 0.1.0, 목록·상세·안전 분류·감사가 같은 상태', async () => {
    const f = await run('createFeature', 'author', { body: CREATE });
    expect(f).toMatchObject({ featureId: 'FEAT-00145', version: '0.1.0', lifecycle: 'PROPOSED', featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY', refVersion: 'v1.4' }], refRegulations: ['ISO 16505'] });
    const list = await run('listFeatures', 'author', { query: { q: '후방', latestOnly: 'true', limit: 30 } });
    expect(list.items.map((x: any) => x.featureId)).toEqual(['FEAT-00145']);
    expect((await run('listFeatures', 'author', { query: { latestOnly: 'true' } })).total).toBe(3);
    const d = await run('featureDetail', 'approver', { params: { id: 'FEAT-00145', ver: '0.1.0' } });
    expect(d.meta.createdBy).toBe('usr-author');
    expect(d.transitions[0].blockers.map((b: any) => b.code)).toEqual(['GATE_UNJUDGED', 'GATE_UNJUDGED', 'GATE_UNJUDGED']); // 승인자에게는 역할 막힘 없음
    const author = await run('featureDetail', 'author', { params: { id: 'FEAT-00145', ver: '0.1.0' } });
    expect(author.transitions[0].blockers.some((b: any) => b.code === 'ROLE')).toBe(true);
    expect((await run('safetyProfile', 'author', { params: { id: 'FEAT-00145', ver: '0.1.0' } })).profile).toMatchObject({ status: 'DRAFT', source: 'INFERRED', fClass: 'F1' });
    expect(audits()[0]).toMatchObject({ action: 'FEATURE_CREATE', target: 'FEAT-00145@0.1.0', actorId: 'usr-author', result: 'ALLOWED' });
  });

  it('대표 기준 행이 없으면 REFDB_LINK_REQUIRED, 같은 범위 같은 대표 행은 409(확인·사유면 등록)', async () => {
    expect(await fails(run('createFeature', 'author', { body: { ...CREATE, featureRefs: [] } }))).toMatchObject({ status: 400, code: 'REFDB_LINK_REQUIRED' });
    const dup = await fails(run('createFeature', 'author', { body: { ...CREATE, trim: 'Premium' } }));
    expect(dup).toMatchObject({ status: 409, code: 'REFDB_DUPLICATE_IN_SCOPE' });
    expect(audits()[0]).toMatchObject({ action: 'FEATURE_CREATE', result: 'FAILED' });
    const ok = await run('createFeature', 'author', { body: { ...CREATE, trim: 'Premium', confirmDuplicate: true, duplicateReason: '하드웨어 차이(카메라 4개)' } });
    expect(ok.warnings.map((w: any) => w.code)).toEqual(['REF_DUPLICATE_CONFIRMED']);
  });

  it('G1 → (확정 전 G2 거부) → 안전 분류 확정 → (HARA 없음 거부) → HARA → G2·G3 → 정의 승인, 개발 착수는 시스템 자동 전이', async () => {
    const { featureId: id, version: ver } = await run('createFeature', 'author', { body: CREATE });
    const p = { id, ver };
    expect(await fails(run('judgeGate', 'quality', { params: p, body: pass('G2') }))).toMatchObject({ status: 422, code: 'GUARD_FAILED' }); // 앞 단계 G1 미판정
    await run('judgeGate', 'quality', { params: p, body: pass('G1') });
    const notConfirmed = await fails(run('judgeGate', 'quality', { params: p, body: pass('G2') }));
    expect(notConfirmed.message).toMatch(/확정 전/);
    // 작성자는 확정할 수 없다(역할) — Safety Manager가 개인 서명으로
    expect(await fails(run('confirmSafetyProfile', 'author', { params: p, body: { reason: '확정' } }))).toMatchObject({ status: 403 });
    const c = await run('confirmSafetyProfile', 'quality', { params: p, body: { reason: '분류 확인' } });
    expect(c.profile).toMatchObject({ status: 'CONFIRMED', confirmedBy: 'usr-quality' });
    expect(await fails(run('updateSafetyProfile', 'author', { params: p, body: { fClass: 'F2' } }))).toMatchObject({ status: 409, code: 'IMMUTABLE' });
    const noHara = await fails(run('judgeGate', 'quality', { params: p, body: pass('G2') }));
    expect(noHara.details.blockers[0].code).toBe('ANALYSIS_EVIDENCE');
    const hara = await run('recordHara', 'quality', { params: p, body: { docId: 'HARA-PRK-01', asil: 'QM', safetyGoals: [{ id: 'SG-01', text: '오안내를 막는다', asil: 'QM' }], reason: '최초 분석' } });
    expect(hara.recordId).toMatch(/^ANL-\d{5}$/);
    const g2 = await run('judgeGate', 'quality', { params: p, body: pass('G2', { evidenceRef: hara.recordId }) });
    expect(g2.record).toMatchObject({ gate: 'G2', status: 'PASS', transitionNote: '최초 판정' });
    await run('judgeGate', 'quality', { params: p, body: pass('G3') });
    // Gate 탭 — 판정·서명 상태
    const gv = await run('gates', 'quality', { params: p });
    expect(gv.gates.slice(0, 3).map((g: any) => [g.status, g.decision.state])).toEqual([['PASS', 'SIGNED'], ['PASS', 'SIGNED'], ['PASS', 'SIGNED']]);
    // 알림 — Gate 판정은 승인자에게
    const inbox = await run('notifications', 'approver', { query: { limit: 200 } });
    expect(inbox.items.map((n: any) => n.title)).toContain(`G3 PASS — ${id} ${ver}`);
    // 작성자는 승인할 수 없다(역할 403), 승인자는 사유가 있어야
    expect(await fails(run('transition', 'author', { params: p, body: { to: 'APPROVED', reason: '승인' } }))).toMatchObject({ status: 403 });
    expect(await fails(run('transition', 'approver', { params: p, body: { to: 'APPROVED', reason: '' } }))).toMatchObject({ status: 422 });
    const t = await run('transition', 'approver', { params: p, body: { to: 'APPROVED', reason: '정의 확인' } });
    expect(t.lifecycle).toBe('DEVELOPING'); // Control Point 1개 이상 → 자동 개발 착수
    const rows = audits().filter((a) => a.action.startsWith('FEATURE_TRANSITION') && a.result === 'ALLOWED');
    expect(rows.map((a) => [a.action, a.actorId])).toEqual([
      ['FEATURE_TRANSITION APPROVED→DEVELOPING', 'system:registry'],
      ['FEATURE_TRANSITION PROPOSED→APPROVED', 'usr-approver'],
    ]);
    expect((await run('listFeatures', 'author', { query: { lifecycle: 'DEVELOPING', latestOnly: 'true' } })).items.map((x: any) => x.featureId)).toEqual([id]);
  });

  it('요청 중(PENDING) 기준 행에 연결하면 정의 승인이 막힌다 — 추가 요청 승인·발행 뒤 풀린다', async () => {
    const add = await run('requestRefAdd', 'author', { body: { domain: 'ADAS & AD', component: 'Parking assistance', nameEn: 'Rear guide', nameKo: '후방 안내선', tshirt: 'S', asilRep: 'QM', sourceIds: ['S20'], swStack: 'Application', lifecycle: 'Commodity', techStack: 'Automotive' } });
    expect(add.ref).toMatchObject({ refId: 'AD-PRK-006', status: 'PENDING' });
    expect(add.change).toMatchObject({ changeId: 'CR-2026-009', kind: 'ADD', status: 'REVIEW', fromRegistration: true });
    const f = await run('createFeature', 'author', { body: { ...CREATE, featureRefs: [{ refId: 'AD-PRK-006', role: 'PRIMARY' }] } });
    expect(f.warnings[0]).toMatchObject({ code: 'REF_STATUS', status: 'PENDING' });
    const d = await run('featureDetail', 'approver', { params: { id: f.featureId, ver: '0.1.0' } });
    expect(d.transitions[0].blockers.map((b: any) => b.code)).toContain('REFDB_LINK_BLOCKED');
    await run('reviewRefChange', 'approver', { params: { id: 'CR-2026-009' }, body: { opinion: 'AGREE', comment: '근거 확인' } });
    await run('decideRefChange', 'steward', { params: { id: 'CR-2026-009' }, body: { decision: 'APPROVE', reason: '추가 승인' } });
    const rd = await run('refDetail', 'author', { params: { refId: 'AD-PRK-006' } });
    expect(rd.awaitingPublish).toMatchObject({ changeId: 'CR-2026-009' });
    const pub = await run('publishRefRelease', 'steward', { body: { changeIds: ['CR-2026-009'], note: '후방 안내선 추가' } });
    expect(pub.release).toMatchObject({ release: 'v1.5', changeIds: ['CR-2026-009'] });
    expect(pub.applied[0]).toMatchObject({ refId: 'AD-PRK-006', status: 'ACTIVE' });
    const after = await run('featureDetail', 'approver', { params: { id: f.featureId, ver: '0.1.0' } });
    expect(after.transitions[0].blockers.map((b: any) => b.code)).not.toContain('REFDB_LINK_BLOCKED');
  });
});

describe('Release Sign-off → 출시', () => {
  const p = { id: 'FEAT-00144', ver: '3.3.0' };
  it('G8·G9 PASS 뒤 Feature Owner 서명 → 출시 담당 전이, 출시 담당·감사에게 알림', async () => {
    const before = await run('featureDetail', 'coordinator', { params: p });
    expect(before.transitions.find((t: any) => t.to === 'RELEASED').blockers.map((b: any) => b.code)).toEqual(['RELEASE_SIGNOFF_MISSING']);
    expect(await fails(run('transition', 'coordinator', { params: p, body: { to: 'RELEASED', reason: '출시' } }))).toMatchObject({ status: 422, code: 'GUARD_FAILED' });
    const s = await run('signRelease', 'author', { params: p, body: { reason: '출시 책임 확인' } });
    expect(s).toMatchObject({ valid: true, signoff: { signedBy: 'usr-author', gateRecords: { G8: 'SIM-G8-000107', G9: 'SIM-G9-000108' }, kid: 'APR-usr-author' } });
    expect(await fails(run('signRelease', 'author', { params: p, body: { reason: '다시' } }))).toMatchObject({ status: 409 });
    const ntf = await run('notifications', 'coordinator', { query: { limit: 200 } });
    expect(ntf.items[0].title).toBe('Release Sign-off 완료 — FEAT-00144 3.3.0 출시 차례');
    const t = await run('transition', 'coordinator', { params: p, body: { to: 'RELEASED', reason: '출시 승인' } });
    expect(t.lifecycle).toBe('RELEASED');
    expect((await run('featureDetail', 'author', { params: p })).feature.lifecycle).toBe('RELEASED');
    // Gate를 다시 판정하면 이전 서명은 효력이 없다 — RELEASED는 읽기 전용이라 판정 불가
    expect(await fails(run('judgeGate', 'quality', { params: p, body: pass('G9') }))).toMatchObject({ status: 409, code: 'IMMUTABLE' });
  });
});

describe('Baseline 확정 요청·결정', () => {
  it('PROPOSED는 확정 대상이 아니고(422), 이미 확정된 Version은 다시 발급하지 않는다(409)', async () => {
    const { featureId: id } = await run('createFeature', 'author', { body: CREATE });
    expect(await fails(run('requestBaseline', 'author', { body: { featureId: id, version: '0.1.0', reason: '확정 요청' } }))).toMatchObject({ status: 422 });
    expect(audits()[0]).toMatchObject({ action: 'BASELINE_REQUEST', result: 'FAILED' });
    expect(await fails(run('requestBaseline', 'author', { body: { featureId: 'FEAT-00144', version: '3.3.0', reason: '확정 요청' } }))).toMatchObject({ status: 409 });
  });

  it('승인 대기 요청 — 체크리스트 통과면 BL 발급, 요청 상세·Feature 상세에 반영', async () => {
    // FEAT-00144 3.3.0의 Baseline을 잃은 상황 대신, 새 Version(3.4.0)을 만들어 APPROVED까지 올린다
    const v = await run('createVersion', 'author', { params: { id: 'FEAT-00144' }, body: { baseVersion: '3.3.0', bump: 'minor', reason: '문구 변경', changes: { description: '서라운드 뷰 안내 문구 개선' } } });
    expect(v.feature).toMatchObject({ version: '3.4.0', lifecycle: 'PROPOSED', baselineId: null });
    const p = { id: 'FEAT-00144', ver: '3.4.0' };
    expect((await run('safetyProfile', 'author', { params: p })).profile).toMatchObject({ status: 'DRAFT', source: 'MANUAL' });
    await run('judgeGate', 'quality', { params: p, body: pass('G1') });
    await run('confirmSafetyProfile', 'quality', { params: p, body: { reason: '확인' } });
    const hara = await run('recordHara', 'quality', { params: p, body: { docId: 'HARA-SVM-02', asil: 'QM', safetyGoals: [{ id: 'SG-01', text: '오안내를 막는다', asil: 'QM' }], reason: '문구 변경 영향 없음' } });
    await run('judgeGate', 'quality', { params: p, body: pass('G2', { evidenceRef: hara.recordId }) });
    await run('judgeGate', 'quality', { params: p, body: pass('G3') });
    await run('transition', 'approver', { params: p, body: { to: 'APPROVED', reason: '정의 확인' } });
    const r = await run('requestBaseline', 'author', { body: { featureId: 'FEAT-00144', version: '3.4.0', reason: '확정 요청' } });
    expect(r).toMatchObject({ requestId: 'BR-00001', status: 'PENDING', requestedBy: 'usr-author' });
    expect((await run('baselineRequests', 'steward', { query: { status: 'PENDING' } })).items.map((x: any) => x.requestId)).toEqual(['BR-00001']);
    expect((await run('notifications', 'steward', { query: { limit: 200 } })).items[0].title).toBe('Baseline 확정 요청 — FEAT-00144 3.4.0');
    const detail = await run('baselineRequest', 'steward', { params: { rid: 'BR-00001' } });
    expect(detail.checklist.filter((c: any) => c.state === 'FAIL')).toEqual([]);
    // 요청자는 자기 요청을 결정할 수 없다 — 작성자 계정은 BOM 승인 역할이 없어 라우터가 먼저 403
    expect(await fails(run('decideBaseline', 'author', { params: { rid: 'BR-00001' }, body: { decision: 'APPROVE', reason: '확정' } }))).toMatchObject({ status: 403 });
    const d = await run('decideBaseline', 'steward', { params: { rid: 'BR-00001' }, body: { decision: 'APPROVE', reason: '확정' } });
    expect(d.request).toMatchObject({ status: 'APPROVED', baselineId: 'BL-00163' });
    expect(d.baseline.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const fd = await run('featureDetail', 'author', { params: p });
    expect(fd.feature.baselineId).toBe('BL-00163');
    expect(fd.baseline).toMatchObject({ baselineId: 'BL-00163', approvedBy: 'usr-steward' });
    expect(fd.pendingBaselineRequest).toBeNull();
    expect((await run('baselineRequests', 'steward', { query: { status: 'PENDING' } })).items).toEqual([]);
  });
});

describe('Feature DB 변경 요청 — 검토·결정·직무 분리', () => {
  it('작성 → 도메인 검토(요청자 제외) → 승인(검토자·요청자 제외) → 감사 이력·목록이 같은 상태', async () => {
    const c = await run('createRefChange', 'author', { body: { kind: 'MODIFY', refId: 'AD-PRK-004', after: { tshirt: 'XL' }, reason: '사내 실적 3건 반영' } }).catch((e) => e);
    // AD-PRK-004에는 진행 중인 요청 CR-2026-006이 있다
    expect(c).toMatchObject({ status: 409 });
    const ok = await run('createRefChange', 'approver', { body: { kind: 'DEPRECATE', refId: 'AD-PRK-004', after: { replacedBy: null }, reason: '대체 행으로' } }).catch((e) => e);
    expect(ok.status).toBe(409);
    // 승인 — 마지막 의견 동의인 CR-2026-006, Feature DB 관리자
    const d = await run('decideRefChange', 'steward', { params: { id: 'CR-2026-006' }, body: { decision: 'APPROVE', reason: '근거 확인' } });
    expect(d).toMatchObject({ status: 'APPROVED', awaitingPublish: true, decision: { decidedBy: 'usr-steward' } });
    expect((await run('listRefChanges', 'steward', { query: { status: 'APPROVED' } })).items.map((x: any) => x.changeId)).toEqual(['CR-2026-006']);
    expect((await run('refChangeAudit', 'steward', { params: { id: 'CR-2026-006' } })).items.at(-1)).toMatchObject({ action: 'REFDB_CHANGE_DECIDE', stage: 'DECIDE' });
  });

  it('SOD-15 — 그 요청을 검토한 사람은 승인·반려할 수 없다(403 + DENIED 감사)', async () => {
    const e = await fails(run('decideRefChange', 'steward', { params: { id: 'CR-2026-007' }, body: { decision: 'APPROVE', reason: '승인' } }));
    expect(e).toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY', details: { rule: 'SOD-15' } });
    expect(audits()[0]).toMatchObject({ action: 'REFDB_CHANGE_DECIDE', target: 'CR-2026-007', result: 'DENIED', actorId: 'usr-steward' });
    expect(audits()[0].reason).toMatch(/SOD-15/);
  });

  it('마지막 의견이 보완이면 승인 불가, 반려는 된다', async () => {
    expect(await fails(run('decideRefChange', 'steward', { params: { id: 'CR-2026-008' }, body: { decision: 'APPROVE', reason: '승인' } }))).toMatchObject({ status: 422, details: { code: 'REVIEW_NOT_AGREED' } });
    expect(await run('decideRefChange', 'steward', { params: { id: 'CR-2026-008' }, body: { decision: 'REJECT', reason: '보완 뒤 다시' } })).toMatchObject({ status: 'REJECTED' });
  });

  it('SOD-13 — 요청자는 자기 요청을 승인할 수 없다, SOD-14 — 요청자는 검토할 수 없다(검토자 역할이어도)', async () => {
    // 같은 행에 진행 중 요청은 하나만
    expect(await fails(run('createRefChange', 'author', { body: { kind: 'MODIFY', refId: 'AD-PRK-004', after: { tshirt: 'XL' }, reason: '사내 실적 3건 반영' } }))).toMatchObject({ status: 409 });
    const own = await run('createRefChange', 'steward', { body: { kind: 'MODIFY', refId: 'AD-PRK-001', after: { tshirt: 'XL' }, reason: '규모 재평가' } });
    expect(own).toMatchObject({ changeId: 'CR-2026-009', status: 'REVIEW', before: { tshirt: 'L' }, after: { tshirt: 'XL' } });
    await run('reviewRefChange', 'approver', { params: { id: own.changeId }, body: { opinion: 'AGREE', comment: '동의' } });
    expect(await fails(run('decideRefChange', 'steward', { params: { id: own.changeId }, body: { decision: 'APPROVE', reason: '승인' } }))).toMatchObject({ status: 403, details: { rule: 'SOD-13' } });
    const byReviewer = await run('createRefChange', 'approver', { body: { kind: 'MODIFY', refId: 'AD-PRK-002', after: { tshirt: 'S' }, reason: '규모 재평가' } });
    expect(await fails(run('reviewRefChange', 'approver', { params: { id: byReviewer.changeId }, body: { opinion: 'AGREE', comment: '동의' } }))).toMatchObject({ status: 403, details: { rule: 'SOD-14' } });
    // 작성 알림 — 도메인 검토자·관리자에게(요청자 제외)
    expect((await run('notifications', 'steward', { query: { limit: 200 } })).items.map((n: any) => n.title)).toContain(`Feature DB 변경 요청 — ${byReviewer.changeId} 수정 AD-PRK-002`);
  });
});

describe('업무 절차 활동 완료·취소', () => {
  it('내 활동만, 앞 활동 완료 뒤에만 — 완료하면 다음 담당 검토함에 차례, 취소하면 되돌린다', async () => {
    expect(await fails(run('completeProcedureActivity', 'author', { params: { id: 'FPW.1-A03' }, body: { evidence: [], sign: false } }))).toMatchObject({ status: 403 }); // Safety Manager 활동
    expect(audits()[0]).toMatchObject({ action: 'PROCEDURE_ACTIVITY_COMPLETE', result: 'DENIED' });
    const before = await run('procedureInbox', 'steward');
    expect(before.items.some((i: any) => i.activityId === 'FPW.1-A02')).toBe(false);
    const c = await run('completeProcedureActivity', 'author', { params: { id: 'FPW.1-A01' }, body: { note: '초안 작성', evidence: [{ kind: 'LINK', name: 'Feature', ref: '/features/FEAT-00145/0.1.0' }], sign: true } });
    expect(c.completion).toMatchObject({ activityId: 'FPW.1-A01', completedBy: 'usr-author', signatureValid: true, signature: { kid: 'APR-usr-author' } });
    expect(await fails(run('completeProcedureActivity', 'author', { params: { id: 'FPW.1-A01' }, body: { evidence: [], sign: false } }))).toMatchObject({ status: 409 });
    const after = await run('procedureInbox', 'steward');
    expect(after.items.find((i: any) => i.activityId === 'FPW.1-A02')).toMatchObject({ kind: 'TODO', roleId: 'R-PLM' });
    expect((await run('procedureState', 'author')).done).toEqual(['FPW.1-A01']);
    const ntf = await run('notifications', 'steward', { query: { limit: 200 } });
    expect(ntf.items[0].eventType).toBe('procedure.activity.completed');
    const u = await run('undoProcedureActivity', 'author', { params: { id: 'FPW.1-A01' }, body: {} });
    expect(u.done).toEqual([]);
    expect((await run('procedureInbox', 'steward')).items.some((i: any) => i.activityId === 'FPW.1-A02')).toBe(false);
  });
});

describe('의존관계·Flag Retirement·출처 정기 점검(보통)', () => {
  it('제안 Version에만 의존관계 등록 — 판정·상세·목록·감사가 같은 상태, 승인된 원천은 409', async () => {
    await run('createFeature', 'author', { body: { ...CREATE, trim: 'Premium', confirmDuplicate: true, duplicateReason: '후방 카메라 변형' } }); // 같은 범위끼리만 관계
    const body = { type: 'REQUIRES', sourceFeatureId: 'FEAT-00145', sourceVersion: '0.1.0', targetFeatureId: 'FEAT-00144', targetVersion: '3.3.0' };
    const dep = await run('createDependency', 'author', { body });
    expect(dep).toMatchObject({ dependencyId: 'DEP-00001', type: 'REQUIRES', country: 'KR', targetVersionCheck: '단일 후보' });
    expect(dep.verdict).toBeTruthy();
    const d = await run('featureDetail', 'author', { params: { id: 'FEAT-00145', ver: '0.1.0' } });
    expect(d.feature.dependencyIds).toEqual(['DEP-00001']);
    expect(d.dependencies.outgoing.map((x: any) => x.dependencyId)).toEqual(['DEP-00001']);
    expect((await run('dependencies', 'author', { query: { featureId: 'FEAT-00144' } })).items).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: 'DEPENDENCY_CREATE', result: 'ALLOWED' });
    expect(await fails(run('createDependency', 'author', { body: { ...body, sourceFeatureId: 'FEAT-00144', sourceVersion: '3.3.0' } }))).toMatchObject({ status: 409, code: 'IMMUTABLE' });
    expect(audits()[0]).toMatchObject({ action: 'DEPENDENCY_CREATE', result: 'FAILED' });
  });

  it('Retirement 요청 → 작성 역할 승인 거부(403) → Feature 승인자 승인 → 순서대로 단계 기록, 순서 어기면 422', async () => {
    const r = await run('requestFlagRetirement', 'author', { body: { flagKey: 'svm_view_flag', reason: '상위 Flag로 통합', nextReleaseAt: null } });
    expect(r).toMatchObject({ retirementId: 'RET-00001', featureId: 'FEAT-00144', fClass: 'F1', status: 'REQUESTED', requiredApprovals: ['FEATURE_APPROVER'] });
    expect(await fails(run('requestFlagRetirement', 'author', { body: { flagKey: 'svm_view_flag', reason: '중복 요청', nextReleaseAt: null } }))).toMatchObject({ status: 409 });
    expect(await fails(run('approveFlagRetirement', 'author', { params: { id: 'RET-00001' }, body: {} }))).toMatchObject({ status: 403 }); // 요청자(작성 역할)
    const a = await run('approveFlagRetirement', 'approver', { params: { id: 'RET-00001' }, body: {} });
    expect(await fails(run('approveFlagRetirement', 'approver', { params: { id: 'RET-00001' }, body: {} }))).toMatchObject({ status: 422 }); // 이미 승인됨
    expect(a).toMatchObject({ status: 'APPROVED', next: 'REMAINING_VEHICLES' });
    expect(a.codeRemovalDue).toBeTruthy();
    expect(await fails(run('recordFlagRetirementStep', 'author', { params: { id: 'RET-00001' }, body: { step: 'REGISTRY_RETIRED' } }))).toMatchObject({ status: 422 });
    const s = await run('recordFlagRetirementStep', 'author', { params: { id: 'RET-00001' }, body: { step: 'REMAINING_VEHICLES' } });
    expect(s.steps.REMAINING_VEHICLES.data).toMatchObject({ onOldVersion: [], unreported: [] });
    expect(s.next).toBe('FINAL_STATE');
    expect((await run('flagRetirements', 'author')).items[0]).toMatchObject({ retirementId: 'RET-00001', next: 'FINAL_STATE' });
  });

  it('출처 정기 점검 — 확인일·다음 점검일이 목록에 반영, 개정 있음이면 영향 기준 행, 기한 앞뒤가 틀리면 400', async () => {
    const res = await run('recordSourceReview', 'steward', { body: { sourceIds: ['S20'], nextReviewAt: '2027-05-01', note: '개정 확인', result: 'REVISED' } });
    expect(res.items[0]).toMatchObject({ sourceId: 'S20', nextReviewAt: '2027-05-01', lastResult: 'REVISED' });
    expect(res.affected[0].refIds).toContain('AD-PRK-004');
    const list = await run('refSources', 'author');
    expect(list.items[0]).toMatchObject({ nextReviewAt: '2027-05-01', usedBy: 3 });
    expect(list.noNextReview).toBe(0);
    expect(audits()[0]).toMatchObject({ action: 'REFDB_SOURCE_REVIEW', target: 'S20', result: 'ALLOWED' });
    expect(await fails(run('recordSourceReview', 'steward', { body: { sourceIds: ['S20'], checkedAt: '2026-11-01', nextReviewAt: '2026-10-01', note: '역순', result: 'NO_CHANGE' } }))).toMatchObject({ code: 'VALIDATION' });
    expect(await fails(run('recordSourceReview', 'steward', { body: { sourceIds: ['S99'], nextReviewAt: '2027-05-01', note: '없음', result: 'NO_CHANGE' } }))).toMatchObject({ status: 404 });
  });
});

// 공개 시연 사이트 브라우저 안 쓰기 — 업무 묶음(api/sim/handlers/business.ts). 서버와 같은 규칙(contracts)으로 판정하는지,
// 쓰기 뒤 목록·상세·감사·이벤트가 같은 상태인지 본다. 스냅샷은 공개 배포와 같은 frontend/public/api-snapshot을 그대로 읽는다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';

const SNAP_DIR = join(__dirname, '..', '..', 'public');
const json = (v: string) => new Response(v, { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });

type Sim = typeof import('../api/sim');
let sim: Sim;
let engine: typeof import('../api/sim/engine');
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const run = (name: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; role?: string; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role: o.role, actorRole: o.actorRole });
const audits = async () => (await run('audit', { query: { limit: 100 } })).items as { action: string; target: string; result: string; actorId: string }[];

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      const file = join(SNAP_DIR, decodeURIComponent(u));
      return existsSync(file) ? json(readFileSync(file, 'utf8')) : html();
    }),
  );
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

describe('스냅샷 준비', () => {
  it('시험이 읽는 공개 스냅샷이 있다', () => {
    for (const u of [url('listProducts'), url('trials', {}, { catalogId: 'CAT-00019', source: 'FLEET', pageSize: 50 }), url('costProjects'), url('listConsultations')]) expect(existsSync(join(SNAP_DIR, snapshotFile(u)))).toBe(true);
  });
});

describe('상품 — 새 Catalog Version → 구성 승인 → 검증 → 고객 출시 승인(직무 분리)', () => {
  it('구성 승인자와 고객 출시 승인자는 다르다, 작성자는 승인하지 못한다', async () => {
    // 상품 작성(commerce)이 고객 출시된 CAT-00002 4.1.0에서 새 Version을 만든다
    const made = await run('createProductVersion', { params: { id: 'CAT-00002' }, role: 'commerce', body: { baseVersion: '4.1.0', bump: 'minor', reason: '2027 연식 구성 갱신', changes: {} } });
    expect(made.product).toMatchObject({ catalogId: 'CAT-00002', version: '4.2.0', lifecycle: 'PROPOSED' });
    expect(made.composition.result).toBe('PASS');
    // 목록·상세가 같은 상태
    const list = await run('listProducts');
    expect(list.items.filter((p: any) => p.catalogId === 'CAT-00002').map((p: any) => `${p.version}:${p.lifecycle}`)).toEqual(['4.1.0:RELEASED', '4.2.0:PROPOSED']);
    const d0 = await run('productDetail', { params: { id: 'CAT-00002', ver: '4.2.0' } });
    expect(d0.versions.map((v: any) => v.version)).toEqual(['4.1.0', '4.2.0']);
    expect(d0.transitions.map((t: any) => `${t.to}:${t.approval}`)).toEqual(['APPROVED:CONFIG']);

    // 구성 승인(approver) — 모든 Feature가 RELEASED라 자동 출시 대기(DEVELOPING)로 가지 않는다
    const a1 = await run('productTransition', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'approver', body: { to: 'APPROVED', reason: '구성 확인' } });
    expect(a1.product.lifecycle).toBe('APPROVED');
    await run('productTransition', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'approver', body: { to: 'VERIFIED', reason: '상품 검증 완료' } });
    // 같은 사람이 고객 출시까지 승인할 수 없다 — 403 + 실패 감사
    await expect(run('productTransition', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'approver', body: { to: 'RELEASED', reason: '출시' } })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    expect((await audits())[0]).toMatchObject({ action: 'PRODUCT_TRANSITION VERIFIED→RELEASED', result: 'FAILED' });
    // 상품 Owner(다른 사람)는 승인할 수 있다
    const rel = await run('productTransition', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'productowner', body: { to: 'RELEASED', reason: '고객 출시 승인' } });
    expect(rel.product.lifecycle).toBe('RELEASED');
    const d = await run('productDetail', { params: { id: 'CAT-00002', ver: '4.2.0' } });
    expect(d.meta).toMatchObject({ createdBy: 'usr-commerce', configApprovedBy: 'usr-approver', releaseApprovedBy: 'usr-productowner' });
    expect(d.transitions.map((t: any) => t.to)).toEqual(['DEPRECATED']);
    const a = await audits();
    expect(a.filter((x) => x.target === 'CAT-00002@4.2.0' && x.result === 'ALLOWED').map((x) => x.action)).toEqual(['PRODUCT_TRANSITION VERIFIED→RELEASED', 'PRODUCT_TRANSITION APPROVED→VERIFIED', 'PRODUCT_TRANSITION PROPOSED→APPROVED', 'PRODUCT_VERSION_CREATE']);
    const ev = await run('events', { query: { limit: 500, recent: '1' } });
    expect(ev.items.filter((e: any) => e.type === 'product.lifecycle.changed' && e.payload.catalogId === 'CAT-00002' && e.payload.version === '4.2.0').map((e: any) => e.payload.to)).toEqual(['APPROVED', 'VERIFIED', 'RELEASED']);
  });

  it('구성 검증 FAIL이면 구성 승인 전이가 막힌다(서버와 같은 문장)', async () => {
    await run('createProductVersion', { params: { id: 'CAT-00002' }, role: 'commerce', body: { baseVersion: '4.1.0', bump: 'minor', reason: 'x 구성', changes: {} } });
    await run('updateProductDraft', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'commerce', body: { baselineIds: ['BL-00008'] } });
    await expect(run('productTransition', { params: { id: 'CAT-00002', ver: '4.2.0' }, role: 'approver', body: { to: 'APPROVED', reason: '구성 확인' } })).rejects.toMatchObject({ status: 422, code: 'GUARD_FAILED' });
    // 승인된 Version은 직접 고칠 수 없다(IMMUTABLE)
    await expect(run('updateProductDraft', { params: { id: 'CAT-00002', ver: '4.1.0' }, role: 'commerce', body: { name: '바꿈' } })).rejects.toMatchObject({ status: 409, code: 'IMMUTABLE' });
  });
});

describe('체험권 — 제안 → 수락 → 구매 전환', () => {
  it('목록 상태별 수·등록 차량 권한이 같은 상태가 된다', async () => {
    const q = { catalogId: 'CAT-00019', source: 'FLEET', pageSize: 50 };
    const before = await run('trials', { query: q });
    const offeredBefore = before.byState.OFFERED ?? 0;
    // 이미 열린 체험이 있는 차량은 건너뛴다
    const r = await run('offerTrials', { role: 'commerce', body: { catalogId: 'CAT-00019', vins: ['KMH-NX4-0001', 'KMH-NX4-0002', 'ego-01'] } });
    expect(r.offered.map((g: any) => g.vin)).toEqual(['KMH-NX4-0001']);
    // 지원하지 않는 차량(SW 버전 미달, FFG-VEH-006)·시뮬레이터 차량은 제안하지 않는다
    expect(r.skipped.map((s: any) => s.vin)).toEqual(['KMH-NX4-0002', 'ego-01']);
    expect(r.skipped[0].reason).toMatch(/^NOT_SUPPORTED: FEAT-00022 1\.0\.0/);
    const g = r.offered[0];
    expect(g).toMatchObject({ status: 'OFFERED', state: 'OFFERED', kind: '체험' });
    const after = await run('trials', { query: q });
    expect(after.byState.OFFERED).toBe(offeredBefore + 1);
    expect(after.items[0].grantId).toBe(g.grantId);
    // 수락(운영) → 30일
    const acc = await run('acceptTrial', { params: { grantId: g.grantId }, role: 'operator', body: {} });
    expect(acc).toMatchObject({ status: 'ACTIVE', state: 'ACTIVE', trialDays: 30 });
    await expect(run('acceptTrial', { params: { grantId: g.grantId }, role: 'operator', body: {} })).rejects.toMatchObject({ status: 422 });
    // 구매 전환 — 체험은 CONVERTED, 구독 권한이 새로 생긴다
    const buy = await run('purchaseTrial', { params: { grantId: g.grantId }, role: 'operator', body: { plan: '구독' } });
    expect(buy.trial.state).toBe('CONVERTED');
    expect(buy.grant).toMatchObject({ kind: '구독', fromTrial: g.grantId, state: 'ACTIVE' });
    expect(buy.order.orderId).toMatch(/^ORD-\d{5}$/);
    const ent = await run('entitlements');
    expect(ent.items.some((x: any) => x.grantId === buy.grant.grantId)).toBe(true);
    expect(ent.items.find((x: any) => x.grantId === g.grantId)?.state).toBe('CONVERTED');
    const a = await audits();
    expect(a.slice(0, 4).map((x) => x.action)).toEqual(['TRIAL_PURCHASE', 'TRIAL_ACCEPT', 'TRIAL_ACCEPT', 'TRIAL_OFFER']);
    expect(a[1].result).toBe('FAILED');
  });
});

describe('협의 의견', () => {
  it('받은 부서만, 요청자 본인은 못 낸다 — 의견 뒤 목록 수가 바뀐다', async () => {
    await expect(run('answerConsultation', { params: { id: 'CON-2026-004' }, role: 'viewer', actorRole: 'AUDITOR', body: { department: 'DEP-LEG', opinion: 'AGREE', memo: '확인했습니다' } })).rejects.toMatchObject({ status: 403 });
    await expect(run('answerConsultation', { params: { id: 'CON-2026-004' }, role: 'quality', body: { department: 'DEP-PUR', opinion: 'AGREE', memo: '확인했습니다' } })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    const before = await run('listConsultations', { query: { to: 'DEP-PUR' } });
    const out = await run('answerConsultation', { params: { id: 'CON-2026-004' }, role: 'viewer', actorRole: 'AUDITOR', body: { department: 'DEP-PUR', opinion: 'REVISE', memo: '계약서 조항을 보완해 주세요' } });
    expect(out).toMatchObject({ status: 'ANSWERED' });
    expect(out.opinions.at(-1)).toMatchObject({ opinion: 'REVISE', by: 'usr-viewer', department: 'DEP-PUR' });
    const after = await run('listConsultations', { query: { to: 'DEP-PUR' } });
    expect(after.open).toBe(before.open - 1);
    expect((await run('consultationDetail', { params: { id: 'CON-2026-004' } })).consultation.status).toBe('ANSWERED');
    expect((await audits()).map((x) => `${x.action}:${x.result}`).slice(0, 3)).toEqual(['CONSULT_OPINION:ALLOWED', 'CONSULT_OPINION:FAILED', 'CONSULT_OPINION:FAILED']);
  });
});

describe('개발비 산정 — 과제 → Feature 담기 → 제출 → 승인', () => {
  it('서버와 같은 엔진으로 계산하고, 승인 결과를 고정한다', async () => {
    // 스냅샷의 과제 수에 따라 다음 번호가 정해진다(시드가 바뀌어도 같은 규칙)
    const seeded = (await run('costProjects')).items.map((x: any) => x.estId as string);
    const NEW = `EST-${String(Math.max(...seeded.map((x: string) => Number(x.slice(4)))) + 1).padStart(4, '0')}`;
    const p = await run('costProjectCreate', { role: 'viewer', body: { name: 'BCM 파생 2차 견적', target: 'BCM' } });
    expect(p).toMatchObject({ estId: NEW, status: 'DRAFT', basisVersion: 'v1.3' });
    // 비어 있으면 제출할 수 없다
    await expect(run('costTransition', { params: { estId: NEW }, role: 'viewer', body: { action: 'SUBMIT', reason: '제출' } })).rejects.toMatchObject({ status: 422 });
    const d = await run('costFeatureAdd', { params: { estId: NEW }, role: 'viewer', body: { featureId: 'FEAT-00187', version: '0.1.0' } });
    // 줄은 담을 때의 Feature DB 연결(featureRefs) 그대로 — 대표 1줄 + 포함
    const feat = await run('featureDetail', { params: { id: 'FEAT-00187', ver: '0.1.0' } });
    const refs = (feat?.featureRefs ?? feat?.feature?.featureRefs) as { refId: string }[] | undefined;
    expect(refs?.length).toBeGreaterThan(0);
    expect(d.lines.map((l: any) => l.refId).sort()).toEqual(refs!.map((r) => r.refId).sort());
    expect(d.lines.length).toBeGreaterThanOrEqual(10);
    expect(d.lines[0]).toMatchObject({ role: 'PRIMARY', refKnown: true });
    expect(d.error).toBeNull();
    // 같은 기준 행·줄 입력·설정이면 스냅샷 과제(EST-0001, 서버 계산)와 줄 공수가 같다
    const base = await run('costProject', { params: { estId: 'EST-0001' } });
    const mine = (x: any) => x.lines.filter((l: any) => l.featureId === 'FEAT-00187');
    expect(d.result.totals.totalMm).toBeGreaterThan(0);
    await expect(run('costFeatureAdd', { params: { estId: NEW }, role: 'viewer', body: { featureId: 'FEAT-00187', version: '0.1.0' } })).rejects.toMatchObject({ status: 409 });
    for (const l of mine(base)) await run('costLineUpdate', { params: { estId: NEW, lineNo: String(d.lines.find((x: any) => x.refId === l.refId).lineNo) }, role: 'viewer', body: l.inputs });
    await run('costProjectUpdate', { params: { estId: NEW }, role: 'viewer', body: { settings: base.project.settings } });
    const same = await run('costProject', { params: { estId: NEW } });
    const eOf = (x: any) => Object.fromEntries(x.result.lines.filter((l: any) => mine(x).some((m: any) => m.refId === l.refId)).map((l: any) => [l.refId, l.e]));
    const want = eOf(base);
    expect(Object.keys(want)).toHaveLength(10);
    const got = eOf(same);
    for (const [refId, e] of Object.entries(want)) expect(got[refId]).toBeCloseTo(e as number, 9);
    await run('costTransition', { params: { estId: NEW }, role: 'viewer', body: { action: 'SUBMIT', reason: '검토 요청' } });
    await expect(run('costLineUpdate', { params: { estId: NEW, lineNo: '1' }, role: 'viewer', body: { qty: 2 } })).rejects.toMatchObject({ status: 409, code: 'IMMUTABLE' });
    const ok = await run('costTransition', { params: { estId: NEW }, role: 'approver', body: { action: 'APPROVE', reason: '승인' } });
    expect(ok).toEqual({ estId: NEW, status: 'APPROVED', rev: 1 });
    const fin = await run('costProject', { params: { estId: NEW } });
    expect(fin.approvals[0]).toMatchObject({ rev: 1, approvedBy: 'usr-approver', basisVersion: 'v1.3' });
    expect(fin.approvals[0].resultSha256).toMatch(/^[0-9a-f]{64}$/);
    const list = await run('costProjects');
    expect(list.items[0]).toMatchObject({ estId: NEW, status: 'APPROVED', featureCount: 1 });
    expect(list.items[0].totals.totalMm).toBeCloseTo(fin.result.totals.totalMm, 6);
    expect(list.items.map((x: any) => x.estId).sort()).toEqual([...seeded, NEW].sort());
  });
});

describe('개인정보 요청·외부 연계 충돌·실험·사고', () => {
  it('요청자와 같은 사람은 실행할 수 없다(4안 원칙) — 거부도 감사에', async () => {
    const r = await run('createPrivacyRequest', { role: 'integrator', body: { subjectKind: 'USER', subjectId: 'usr-author', basis: 'DATA_SUBJECT_REQUEST', reason: '퇴사자 요청' } });
    expect(r).toMatchObject({ status: 'REQUESTED', requestedBy: 'usr-integrator' });
    expect(r.preview.audit).toBeGreaterThan(0);
    await expect(run('createPrivacyRequest', { role: 'integrator', body: { subjectKind: 'USER', subjectId: 'usr-author', basis: 'DATA_SUBJECT_REQUEST', reason: '중복' } })).rejects.toMatchObject({ status: 409 });
    await expect(run('executePrivacyRequest', { params: { id: r.requestId }, role: 'integrator', body: {} })).rejects.toMatchObject({ status: 403, code: 'SEPARATION_OF_DUTY' });
    expect((await audits())[0]).toMatchObject({ action: 'PRIVACY_ERASE', result: 'FAILED' });
    const list = await run('privacyRequests', { role: 'integrator' });
    expect(list.items[0].requestId).toBe(r.requestId);
  });

  it('충돌을 플랫폼 값으로 처리하면 열린 충돌·연계 현황 수가 같이 준다', async () => {
    const open = await run('extConflicts', { query: { status: 'OPEN' } });
    const c = open.items[0];
    const out = await run('resolveExtConflict', { params: { id: String(c.conflictId) }, role: 'coordinator', body: { choose: 'PLATFORM', reason: '플랫폼 상태가 맞음' } });
    expect(out.result.outcome).toBe('APPLIED');
    expect((await run('extConflicts', { query: { status: 'OPEN' } })).items).toHaveLength(open.items.length - 1);
    const sync = await run('extSync');
    expect(sync.items.find((s: any) => s.system === c.system).conflicts).toBe(0);
    await expect(run('resolveExtConflict', { params: { id: String(c.conflictId) }, role: 'coordinator', body: { choose: 'EXTERNAL', reason: '다시' } })).rejects.toMatchObject({ status: 409 });
  });

  it('실험 — 시작·종료(효과 미확인이면 채택 불가)', async () => {
    const list = await run('experiments');
    const draft = list.items.find((e: any) => e.status === 'RUNNING');
    await expect(run('concludeExperiment', { params: { id: draft.experimentId }, role: 'coordinator', body: { decision: 'ADOPT', reason: '채택' } })).rejects.toMatchObject({ status: 422 });
    const done = await run('concludeExperiment', { params: { id: draft.experimentId }, role: 'coordinator', body: { decision: 'EXTEND', reason: '표본 더 모으기' } });
    expect(done).toMatchObject({ status: 'CONCLUDED', decision: 'EXTEND' });
    expect((await run('experiments')).items.find((e: any) => e.experimentId === draft.experimentId).status).toBe('CONCLUDED');
  });

  it('사고 접수 — SOTIF 트리거면 이상 징후로 넘기는 이벤트', async () => {
    const i = await run('createIncident', { role: 'operator', body: { source: 'FIELD', vin: 'KMH-NX4-0001', featureId: 'FEAT-00022', category: 'UNEXPECTED_ACTIVATION', severity: 'CRITICAL', summary: '의도치 않은 감속 신고' } });
    expect(i.incidentId).toMatch(/^INC-\d{5}$/);
    expect(i.sotif.trigger).toBe(true);
    expect((await run('incidents')).items[0].incidentId).toBe(i.incidentId);
    const ev = await run('events', { query: { limit: 500, recent: '1' } });
    expect(ev.items.slice(-2).map((e: any) => e.type)).toEqual(['incident.received', 'incident.sotif.triggered']);
  });
});

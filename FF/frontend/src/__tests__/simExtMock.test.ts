// 공개 시연 사이트 — 모의 외부 시스템(JIRA·codeBeamer·GitLab) 쓰기(api/sim/handlers/ext-mock.ts)와 체험 목록 성향·검색·다음 쪽(api/sim/trial-list.ts).
// 회귀(2026-11-06): 정적 시연에서 외부 화면(ExternalApp)의 상태 변경·댓글과 연계 화면의 '외부에서 바꿔 보기'·'Epic 만들기'가 처리되지 않았고(정적 쓰기 차단·미처리),
// 상품 권리 화면의 성향 필터·검색·다음 쪽도 막혀 있었다. 서버 ext-sync.service(mockAct·mockCreate·apply)와 같은 결과·되돌림·감사를 본다.
// 플랫폼 쪽 판정(Lifecycle 전이·Feature 등록·정책 승인)은 그 묶음의 핸들러를 매핑된 사람으로 같은 반영 안에서 부른다(simInvoke).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile, trialListQuery, trialTableQuery } from '@ff/contracts';

const SNAP_DIR = join(__dirname, '..', '..', 'public');
const json = (v: string) => new Response(v, { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
/** 공개 스냅샷에 더 얹는 파일(경로 → 본문) */
let EXTRA: Record<string, unknown> = {};

type Sim = typeof import('../api/sim');
let sim: Sim;
let engine: typeof import('../api/sim/engine');
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const run = (name: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; role?: string; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role: o.role, actorRole: o.actorRole });
const audits = async () => (await run('audit', { query: { limit: 100 } })).items as { action: string; target: string; result: string; actorId: string }[];
const act = (system: string, body: Record<string, unknown>, role = 'operator') => run('mockExtAct', { params: { system }, role, body });
const itemOf = async (system: string, key: string) => (await run('mockExtItems', { params: { system } })).items.find((x: any) => x.key === key);

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  EXTRA = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      const path = decodeURIComponent(u);
      if (path in EXTRA) return json(JSON.stringify(EXTRA[path]));
      const file = join(SNAP_DIR, path);
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

describe('모의 외부 시스템 — 바깥에서 바꾸면 플랫폼이 받아 판정한다', () => {
  it('codeBeamer 요구 개정 — 반영, 연결 Feature G2 재검토, 받은 함·감사·이벤트', async () => {
    const before = await itemOf('codebeamer', 'CB-10001');
    const r = await act('codebeamer', { key: 'CB-10001', action: 'EDIT', title: `${before.title} (개정)`, externalUser: 'jung.req' });
    expect(r.item).toMatchObject({ key: 'CB-10001', revision: before.revision + 1, updatedBy: 'jung.req', title: `${before.title} (개정)` });
    expect(r.result).toMatchObject({ outcome: 'APPLIED', summary: `요구 CB-10001 개정 r${before.revision + 1} — Feature 1건 G2 재검토 필요` });
    expect((await itemOf('codebeamer', 'CB-10001')).title).toBe(`${before.title} (개정)`);
    expect((await run('extInbox')).items[0]).toMatchObject({ system: 'CODEBEAMER', key: 'CB-10001', outcome: 'APPLIED' });
    expect((await audits())[0]).toMatchObject({ action: 'EXT_REQUIREMENT_REVISED', target: 'CB-10001', actorId: 'codebeamer-webhook' });
    const ev = await run('events', { query: { limit: 500, recent: '1' } });
    expect(ev.items.at(-1)).toMatchObject({ type: 'ext.requirement.changed', payload: { key: 'CB-10001', features: ['FEAT-00001@2.1.0'] } });
    // 댓글만 — 바뀐 내용 없음
    const c = await act('codebeamer', { key: 'CB-10001', action: 'COMMENT', comment: '검토 메모', externalUser: 'jung.req' });
    expect(c.result).toMatchObject({ outcome: 'IGNORED', summary: '바뀐 내용 없음' });
    expect(c.item.comments.at(-1)).toMatchObject({ by: 'jung.req', text: '검토 메모' });
  });

  it('Epic 상태 = Lifecycle 전이 요청 — Gate 미판정·없는 상태·매핑 없는 계정은 거부하고 Epic을 되돌린다', async () => {
    const linked = (await run('extFeatureEpics')).items.find((e: any) => e.key === 'FFE-15').feature as string;
    const [featureId, featureVersion] = linked.split('@');
    // Gate가 막으면 Feature 전이 핸들러의 문장 그대로, 전이 거부 감사도 남는다
    const g = await act('jira', { key: 'FFE-15', action: 'TRANSITION', status: 'Approved', externalUser: 'lee.approver' });
    expect(g.result.outcome).toBe('REJECTED');
    expect(g.result.summary).toMatch(/^FFE-15 'Approved' 거부 — .*G1/);
    expect(g.item).toMatchObject({ status: 'Proposed', updatedBy: 'feature-platform' });
    expect(g.item.comments.at(-1).text).toMatch(/^플랫폼이 이 상태 변경을 받지 않았습니다 — .*상태를 'Proposed'\(으\)로 되돌립니다\.$/);
    expect((await audits()).find((a) => a.target === linked)).toMatchObject({ action: 'FEATURE_TRANSITION PROPOSED→APPROVED', result: 'FAILED', actorId: 'usr-approver' });
    expect((await run('featureDetail', { params: { id: featureId, ver: featureVersion } })).feature.lifecycle).toBe('PROPOSED');
    const bad = await act('jira', { key: 'FFE-1', action: 'TRANSITION', status: 'Foo', externalUser: 'park.release' });
    expect(bad.result).toMatchObject({ outcome: 'REJECTED', summary: "FFE-1 'Foo' 거부 — 'Foo'은(는) 플랫폼 Lifecycle 상태가 아닙니다." });
    expect(bad.item.status).toBe('In Verification');
    const who = await act('jira', { key: 'FFE-1', action: 'TRANSITION', status: 'Released', externalUser: 'nobody' });
    expect(who.result.outcome).toBe('UNMAPPED');
    const ev = (await run('events', { query: { limit: 500, recent: '1' } })).items.filter((e: any) => e.type === 'ext.change.rejected').map((e: any) => `${e.payload.key}:${e.payload.outcome}`);
    expect(ev.slice(-3)).toEqual(['FFE-15:REJECTED', 'FFE-1:REJECTED', 'FFE-1:UNMAPPED']);
    // 플랫폼이 본 Epic 상태(목록)
    expect((await run('extFeatureEpics')).items.find((e: any) => e.key === 'FFE-15').status).toBe('Proposed');
  });

  it('CR 승인 — 정책이 검증 GO 상태가 아니면 거부, CR을 정책 상태로 되돌린다', async () => {
    const r = await act('jira', { key: 'FFCR-1', action: 'TRANSITION', status: 'Approved', externalUser: 'lee.approver' });
    expect(r.result.outcome).toBe('REJECTED');
    expect(r.result.summary).toMatch(/^FFCR-1 Approved 거부 — 정책 POL-00001은\(는\) [A-Z]+ 상태입니다\(검증 GO 뒤에만 승인·반려\)\.$/);
    expect(r.item.status).not.toBe('Approved');
  });

  it('Epic 만들기 — 범위·기준 기능이 맞으면 PROPOSED Feature 자동 등록, 빠지면 사유 댓글', async () => {
    const scope = { country: 'KR', vehicleModel: 'CE1', trim: 'Premium', asil: 'QM', ownerId: '바디제어기획팀' };
    const no = await run('mockExtCreate', { params: { system: 'jira' }, role: 'operator', body: { kind: 'EPIC', title: '와이퍼 자동 세척 예약', body: '', externalUser: 'kim.author', scope } });
    expect(no.item).toMatchObject({ kind: 'EPIC', status: 'Proposed', revision: 2 });
    expect(no.item.key).toMatch(/^FFE-\d+$/);
    expect(no.result.outcome).toBe('REJECTED');
    expect(no.item.comments.at(-1).text).toMatch(/^플랫폼 Feature를 등록하지 않았습니다 — 기준 기능 ID가 없습니다\./);
    const ok = await run('mockExtCreate', { params: { system: 'jira' }, role: 'operator', body: { kind: 'EPIC', title: '와이퍼 자동 세척 예약 2', body: '세척액 분사 예약', externalUser: 'kim.author', scope: { ...scope, asil: 'D', refIds: ['CH-BRK-001'] } } });
    expect(ok.result.outcome, ok.result.summary).toBe('APPLIED');
    const [, id] = /→ (FEAT-\d{5}@0\.1\.0) 자동 등록\(PROPOSED\)$/.exec(ok.result.summary)!;
    const [featureId, version] = id.split('@');
    const f = (await run('featureDetail', { params: { id: featureId, ver: version } })).feature;
    expect(f).toMatchObject({ lifecycle: 'PROPOSED', name: '와이퍼 자동 세척 예약 2', vehicleModel: 'CE1' });
    expect(f.tags).toContain(`jira:${ok.item.key}`);
    expect(ok.item.comments.at(-1).text).toMatch(new RegExp(`^플랫폼 Feature ${id} 등록\\(PROPOSED\\)`));
    expect((await run('extFeatureEpics')).items.find((e: any) => e.key === ok.item.key)).toMatchObject({ feature: id });
    expect((await run('extInbox', { query: { system: 'JIRA', outcome: 'APPLIED' } })).items[0]).toMatchObject({ key: ok.item.key });
    // 목록 끝에 만든 순서대로
    expect((await run('mockExtItems', { params: { system: 'jira' } })).items.slice(-2).map((x: any) => x.key)).toEqual([no.item.key, ok.item.key]);
  });

  it('충돌 해결(외부 값 선택) — 연결 Feature를 찾아 Lifecycle 전이로 다시 시도한다', async () => {
    const c = (await run('extConflicts', { query: { status: 'OPEN' } })).items.find((x: any) => x.system === 'JIRA' && x.field === 'status');
    const out = await run('resolveExtConflict', { params: { id: String(c.conflictId) }, role: 'coordinator', body: { choose: 'EXTERNAL', reason: '외부 값이 맞음' } });
    // 예전에는 목록 모양(feature = FEAT@ver)을 잘못 읽어 늘 '연결 Feature 없음'이었다
    expect(out.result.summary).not.toMatch(/연결 Feature 없음/);
    expect(['APPLIED', 'REJECTED']).toContain(out.result.outcome);
  });

  it('GitLab 파이프라인 성공(병합된 MR) → 변경 기록 등록(IF-13), 다시 돌리면 개정 r2, 실패면 기록 없음', async () => {
    const mr = await itemOf('gitlab', 'vehicle/feature-sw!101');
    expect(mr).toMatchObject({ kind: 'MERGE_REQUEST', status: 'merged' });
    const before = (await run('changeRecords')).items.length;
    const failed = await act('gitlab', { key: mr.key, action: 'PIPELINE', status: 'failed', externalUser: 'han.dev' });
    expect(failed.result).toMatchObject({ outcome: 'APPLIED', summary: `파이프라인 ${failed.item.key} failed` });
    expect((await run('changeRecords')).items).toHaveLength(before);
    const ok = await act('gitlab', { key: mr.key, action: 'PIPELINE', status: 'success', coverage: 72, externalUser: 'han.dev' });
    expect(ok.item).toMatchObject({ kind: 'PIPELINE', status: 'success', fields: { mrKey: mr.key, sha: mr.fields.sha } });
    expect(ok.result).toMatchObject({ outcome: 'APPLIED', summary: `파이프라인 ${ok.item.key} 성공 → 변경 기록 CHG-GL-101 r1` });
    const list = await run('changeRecords');
    expect(list.items[0]).toMatchObject({ changeId: 'CHG-GL-101', swId: 'SW-RSPA-APP', swVersion: '2.1.4', commit: mr.fields.sha, rev: 1, registeredBy: 'gitlab-webhook', aiGenerated: null, evidence: { coverage: { achieved: 72, required: 80 } } });
    expect(list.summary.total).toBe(before + 1);
    expect((await run('changeRecords', { query: { swId: 'SW-RSPA-APP' } })).items.map((x: any) => x.changeId)).toEqual(['CHG-GL-101']);
    expect((await audits())[0]).toMatchObject({ action: 'CHANGE_RECORD', target: 'CHG-GL-101', actorId: 'gitlab-webhook' });
    expect((await run('events', { query: { limit: 500, recent: '1' } })).items.at(-1)).toMatchObject({ type: 'change.recorded', aggregate: 'CHG-GL-101', payload: { swId: 'SW-RSPA-APP', swVersion: '2.1.4' } });
    const again = await act('gitlab', { key: mr.key, action: 'PIPELINE', status: 'success', externalUser: 'han.dev' });
    expect(again.result.summary).toMatch(/→ 변경 기록 CHG-GL-101 r2$/);
    // 개정은 근거 보완만 — 다른 SW Version으로 옮길 수 없다(서버와 같은 409)·CI/구현 역할만
    const body = { changeId: 'CHG-GL-101', swId: 'SW-RSPA-APP', swVersion: '9.9.9', commit: mr.fields.sha, summary: '옮기기', aiGenerated: null, evidence: { review: 'MR-1 검토', staticAnalysis: 'SA-1', tests: 'T-1', coverage: null } };
    await expect(run('registerChangeRecord', { role: 'integrator', body })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    await expect(run('registerChangeRecord', { role: 'viewer', body })).rejects.toMatchObject({ status: 403 });
  });

  it('없는 시스템·항목은 서버와 같은 404', async () => {
    await expect(act('trello', { key: 'X', action: 'COMMENT', comment: 'x', externalUser: 'a' })).rejects.toMatchObject({ status: 404 });
    await expect(act('jira', { key: 'FFE-99999', action: 'COMMENT', comment: 'x', externalUser: 'a' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('체험 목록 — 성향·검색·다음 쪽(전체 표 + 서버 규칙)', () => {
  const CAT = 'CAT-00019';
  const STATES = ['ACTIVE', 'OFFERED', 'EXPIRED'];
  const rows = Array.from({ length: 260 }, (_, i) => ({
    grantId: `ENT-${String(90000 + i)}`,
    vin: i < 10 ? `KMH-T-${String(i).padStart(4, '0')}` : `SYN-${String(i).padStart(5, '0')}`,
    catalogId: CAT,
    kind: '체험',
    source: i < 10 ? 'DEMO' : 'SYNTHETIC',
    state: STATES[i % 3],
    status: STATES[i % 3],
    offeredAt: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
    validFrom: '2026-10-01',
    validTo: '2026-12-31',
    profile: { country: i % 2 ? 'KR' : 'US', region: '수도권', ageBand: i % 4 ? '30대' : '40대', drivingStyle: '도심', adasUsage: '보통', vehicleModel: 'NX4 PE', trim: 'Premium' },
  }));
  beforeEach(async () => {
    const { trialListOf } = await import('../api/sim/trial-list');
    const today = '2026-11-06';
    // 서버가 주는 전체 표 쪽(출처 ALL, 200건씩) — 서버 정렬 그대로
    for (let p = 1; (p - 1) * 200 < rows.length; p++) EXTRA['/' + snapshotFile(url('trials', {}, trialTableQuery(CAT, p)))] = trialListOf(rows as any, today, { pageSize: '200', page: String(p) });
  });

  it('성향 필터·검색어·2쪽은 전체 표에서 거르고, 상태별 개수는 상태 필터 전', async () => {
    const kr = await run('trials', { query: trialListQuery({ catalogId: CAT, source: 'ALL', segment: { country: 'KR' } }) });
    expect(kr.total).toBe(130);
    expect(kr.items).toHaveLength(50);
    expect(kr.items.every((r: any) => r.profile.country === 'KR')).toBe(true);
    expect(Object.values(kr.byState as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(130);
    const p2 = await run('trials', { query: trialListQuery({ catalogId: CAT, source: 'ALL', page: 2 }) });
    expect(p2).toMatchObject({ page: 2, total: 260 });
    expect(p2.items).toHaveLength(50);
    const p1ids = new Set((await run('trials', { query: trialListQuery({ catalogId: CAT, source: 'ALL', segment: { trim: 'Premium' } }) })).items.map((r: any) => r.grantId));
    expect(p2.items.some((r: any) => p1ids.has(r.grantId))).toBe(false);
    // 검색어(VIN·권한 ID 소문자 부분 일치), 등록 차량만(FLEET)
    const q = await run('trials', { query: trialListQuery({ catalogId: CAT, source: 'FLEET', q: 'kmh-t' }) });
    expect(q.total).toBe(10);
    const s = await run('trials', { query: trialListQuery({ catalogId: CAT, source: 'ALL', segment: { ageBand: '40대' }, state: 'ACTIVE' }) });
    expect(s.items.every((r: any) => r.state === 'ACTIVE' && r.profile.ageBand === '40대')).toBe(true);
    expect(s.total).toBe(s.byState.ACTIVE);
  });

  it('스냅샷에 전체 표가 없는 상품은 예전처럼 스냅샷 없음', async () => {
    await expect(run('trials', { query: trialListQuery({ catalogId: 'CAT-00001', source: 'ALL', segment: { country: 'KR' } }) })).rejects.toMatchObject({ status: 404 });
  });
});

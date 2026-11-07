// 80-50 A5 — 산출물 게이트·전이 연결(§5.5)과 변경 영향(§5.6). 프로세스 내 모의 codeBeamer로 끝까지 본다.
//   막는 방식 FF_ALM_WP_GATE: enforce(막음)·warn(보이기만, 모의 기본)·off. 실제 연결(IF_MODE_01=live)의 기본은 enforce(ext-contract.spec).
//   정의 승인(G2)·검증(G5)·출시(G8) PASS와 해당 전이는 필수 산출물이 완결돼야, 요구 ID는 codeBeamer에 있어야(FR-DEP-005-002·FR-REG-005-019).
//   승인 뒤 바뀐 항목 → 아래 관계 의심(FF 계산)·그 항목을 근거로 쓴 게이트 재판정 요청(검토함)·codeBeamer 댓글, 재판정 전 다음 전이는 막힘.
import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ExtAdapters } from '../../src/domains/d05-ext/api-gateway/ext-sync/adapters';
import { actor, bootApp, confirmSafety, withRef } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const INTEGRATOR = actor('usr-integrator', 'IMPLEMENTER');

describe('산출물 게이트·변경 영향 (80-50 A5)', () => {
  let app: INestApplication;
  let http: () => any;
  let store: ExtAdapters['store'];
  let fid = '';
  const keys: Record<string, string> = {};
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-11-07T01:00:00.000Z' }));
    store = app.get(ExtAdapters).store;
  });
  afterAll(() => app.close());
  afterEach(() => delete process.env.FF_ALM_WP_GATE);

  const judge = (gate: string, ver = '0.1.0') => http().post(`/api/features/${fid}/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${gate}` });
  const wp = async (ver = '0.1.0') => (await http().get(`/api/alm/features/${fid}/${ver}/work-products`).expect(200)).body;
  const drain = () => http().post('/api/integrations/sync/drain').set(INTEGRATOR).send({}).expect(200);
  const cb = (kind: string, title: string, status: string, relations: { to: string; kind: string }[] = [], extra: Record<string, unknown> = {}) =>
    store.create('CODEBEAMER', 'REQUIREMENT', { title, status, by: 'lee.engineer', fields: { wpKind: kind, ffFeatureId: fid, relations, ...extra } }).key;

  it('준비 — 요구 ID 둘(하나는 codeBeamer에 없음), ASIL QM, 안전 분류·분석 근거(TARA가 있어 사이버보안 요구도 필요)', async () => {
    const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '산출물 게이트 시험', description: 'A5', requirementIds: ['REQ-A5-0001', 'REQ-A5-0404'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
    fid = f.body.featureId;
    await confirmSafety(http, fid, '0.1.0');
    expect(await judge('G1')).toMatchObject({ status: 201 });
    const v = await wp();
    expect(v.gateMode).toBe('warn');
    expect(v.requirementCheck).toEqual({ missing: ['REQ-A5-0001', 'REQ-A5-0404'], unlisted: [] });
    expect(v.result.kinds.find((k: any) => k.kind === 'CS_REQ').required).toBe(true);
  });

  it('enforce — 필수 산출물이 없으면 G2 PASS를 막고 막힌 이유(종류·규칙 문장)를 알려 준다 · warn이면 막지 않는다', async () => {
    process.env.FF_ALM_WP_GATE = 'enforce';
    const r = await judge('G2');
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('codeBeamer 산출물');
    expect(JSON.stringify(r.body.error.details)).toContain('시스템 요구 승인 항목 0건');
    expect(JSON.stringify(r.body.error.details)).toContain('사이버보안 요구 승인 항목 0건');
    // 화면 체크 목록 — G2 단계 막힘
    const v = await wp();
    expect(v.stages.find((s: any) => s.judgeGate === 'G2').blockers.length).toBeGreaterThan(0);
  });

  it('codeBeamer에서 채우면 G2 PASS — 판정 증거에 완결성 해시·항목 목록, 없는 요구 ID는 정의 승인을 막는다(FR-DEP-005-002)', async () => {
    keys.sys = cb('SYS_REQ', '감지 요구', 'Approved', [], { reqId: 'REQ-A5-0001' });
    keys.cs = cb('CS_REQ', '정책 위·변조 방지', 'Approved');
    keys.sw = cb('SW_REQ', '감지 SW 요구', 'Approved', [{ to: keys.sys, kind: 'derived' }, { to: keys.cs, kind: 'allocated' }]);
    keys.test = cb('TEST_SPEC', '감지 시험', 'Approved', [{ to: keys.sys, kind: 'verifies' }, { to: keys.sw, kind: 'verifies' }]);
    process.env.FF_ALM_WP_GATE = 'enforce';
    const g2 = await judge('G2');
    expect(g2.status).toBe(201);
    const ev = (await http().get(`/api/alm/features/${fid}/0.1.0/work-products`).expect(200)).body.evidence;
    expect(ev.find((e: any) => e.gate === 'G2')).toMatchObject({ gateRecordId: g2.body.record.gateRecordId, hash: expect.stringMatching(/^[a-f0-9]{64}$/), items: expect.arrayContaining([expect.objectContaining({ key: keys.sys, version: 1 })]) });
    expect(await judge('G3')).toMatchObject({ status: 201 });
    const t = await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' });
    expect(t.status).toBe(422);
    expect(t.body.error.details.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WORK_PRODUCT', message: expect.stringContaining('REQ-A5-0404') })]));
    // 요구 ID를 고치면 승인된다(초안 수정은 PROPOSED라서 가능)
    await http().patch(`/api/features/${fid}/versions/0.1.0`).set(AUTHOR).send({ requirementIds: ['REQ-A5-0001'] }).expect(200);
    expect(await judge('G2')).toMatchObject({ status: 201 });
    await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
  });

  it('승인 뒤 바뀐 요구 → 아래 관계 의심·G2 재판정 요청(검토함)·codeBeamer 댓글, 재판정 전에는 다음 전이를 막는다', async () => {
    const lc = async () => (await http().get(`/api/features/${fid}/versions/0.1.0`).expect(200)).body.feature.lifecycle;
    expect(['APPROVED', 'DEVELOPING']).toContain(await lc());
    store.update('CODEBEAMER', keys.sys, 'jung.req', { body: '감지 거리 30 m → 25 m' });
    const v = (await http().post(`/api/alm/features/${fid}/0.1.0/work-products/refresh`).set(INTEGRATOR).send({}).expect(200)).body;
    expect(v.changes).toEqual([expect.objectContaining({ itemKey: keys.sys, fromVersion: 1, toVersion: 2 })]);
    const suspect = v.items.filter((i: any) => i.suspect).map((i: any) => i.key).sort();
    expect(suspect).toEqual([keys.sw, keys.test].sort());
    expect(v.result.problems.filter((p: any) => p.rule === 'WP-7').length).toBeGreaterThanOrEqual(2);
    const open = (await http().get('/api/alm/rejudge?status=OPEN').expect(200)).body.items.filter((x: any) => x.featureId === fid);
    expect(open).toEqual([expect.objectContaining({ gate: 'G2', itemKey: keys.sys, fromVersion: 1, toVersion: 2, released: false, status: 'OPEN' })]);
    await drain();
    const item = store.get('CODEBEAMER', keys.sys)!;
    expect(item.comments.at(-1)).toMatchObject({ by: 'feature-platform', text: expect.stringContaining('G2 재판정') });
    // enforce — 열린 재판정 요청은 다음 전이를 막는다(Gate 판정 화면의 막힘 이유와 같은 문장)
    process.env.FF_ALM_WP_GATE = 'enforce';
    const opts = (await http().get(`/api/features/${fid}/versions/0.1.0`).expect(200)).body;
    expect(JSON.stringify(opts)).toContain('REJUDGE_OPEN');
  });

  it('G2를 다시 판정하면 재판정 요청이 닫히고, 아래 항목을 다시 승인하거나 영향 없음 사유를 남기면 의심이 풀린다', async () => {
    process.env.FF_ALM_WP_GATE = 'enforce';
    // 정의 단계 판정(G2)은 의심(WP-7)을 보지 않는다 — 출시(G8)가 본다. 재판정하면 요청이 닫힌다
    expect(await judge('G2')).toMatchObject({ status: 201 });
    const open = (await http().get(`/api/alm/rejudge?status=OPEN&featureId=${fid}`).expect(200)).body.items;
    expect(open).toEqual([]);
    const done = (await http().get(`/api/alm/rejudge?status=RESOLVED&featureId=${fid}`).expect(200)).body.items;
    expect(done[0]).toMatchObject({ gate: 'G2', status: 'RESOLVED', resolvedBy: 'choi.judge' });
    // 아래 항목(SW 요구)을 다시 승인(새 version) → SW 요구 → 시스템 요구 의심이 풀리고, 이번에는 SW 요구를 검증하는 시험 사양이 의심(위가 또 바뀜)
    store.update('CODEBEAMER', keys.sw, 'lee.engineer', { body: '거리 25 m 반영' });
    let v = (await http().post(`/api/alm/features/${fid}/0.1.0/work-products/refresh`).set(INTEGRATOR).send({}).expect(200)).body;
    expect(v.items.filter((i: any) => i.suspect).map((i: any) => i.key)).toEqual([keys.test]);
    // 시험 사양은 담당이 '영향 없음' 사유로 푼다(두 관계 모두)
    await http().post(`/api/alm/features/${fid}/0.1.0/suspects/clear`).set(AUTHOR).send({ from: keys.test, to: keys.sys, reason: '시험 범위 영향 없음' }).expect(403);
    for (const to of [keys.sys, keys.sw]) await http().post(`/api/alm/features/${fid}/0.1.0/suspects/clear`).set(INTEGRATOR).send({ from: keys.test, to, reason: '시험 범위 영향 없음' }).expect(200);
    v = await wp();
    expect(v.items.filter((i: any) => i.suspect)).toEqual([]);
    expect(v.result.suspects).toBe(0);
  });

  it('출시된 버전의 산출물이 바뀌면 출시 버전 표시가 붙은 재판정 요청 — 읽기 전용이라 판정 담당이 사유로 닫는다', async () => {
    // FEAT-00022 1.0.0(RELEASED) — 처음 읽을 때 이미 PASS인 G2·G5·G8 판정에 그때의 산출물을 근거로 이어 둔다(이전 판정 보충)
    const rel = (await http().get('/api/alm/features/FEAT-00022/1.0.0/work-products').expect(200)).body;
    expect(rel.evidence.map((e: any) => e.gate).sort()).toEqual(expect.arrayContaining(['G8']));
    expect(rel.evidence.find((e: any) => e.gate === 'G8').backfilled).toBe(true);
    const sys = rel.items.find((i: any) => i.kind === 'SYS_REQ').key;
    store.update('CODEBEAMER', sys, 'jung.req', { body: '출시 뒤 개정' });
    await http().post('/api/alm/features/FEAT-00022/1.0.0/work-products/refresh').set(INTEGRATOR).send({}).expect(200);
    const open = (await http().get('/api/alm/rejudge?status=OPEN&featureId=FEAT-00022').expect(200)).body.items;
    const g8 = open.find((x: any) => x.gate === 'G8');
    expect(g8).toMatchObject({ version: '1.0.0', released: true, itemKey: sys });
    await http().post(`/api/alm/rejudge/${g8.rejudgeId}/close`).set(AUTHOR).send({ reason: '영향 없음' }).expect(403);
    await http().post(`/api/alm/rejudge/${g8.rejudgeId}/close`).set(JUDGE).send({ reason: '표현 수정 — 동작·시험 영향 없음' }).expect(200);
    const after = (await http().get('/api/alm/rejudge?status=RESOLVED&featureId=FEAT-00022').expect(200)).body.items;
    expect(after.find((x: any) => x.rejudgeId === g8.rejudgeId)).toMatchObject({ status: 'RESOLVED', resolvedBy: 'choi.judge' });
  });
});

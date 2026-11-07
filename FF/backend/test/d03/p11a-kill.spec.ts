// 긴급 차단·해제 마감(P11a) — FR-KSW-002-006 차단 중 활성화 거부 · FR-KSW-004-001·002·004·007 해제 요청 정보·확인 항목·해제 범위 선택·부분 해제
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DB, type Db } from '../../src/kernel/db';
import { KillRepo } from '../../src/domains/d03-safety/kill-switch/kill.repo';
import { AnomalyService } from '../../src/domains/d06-qsec/anomaly-response/anomaly.service';
import { actor, bootApp, killV2, RESTORE_APPROVERS, restoreBody, KILL_REQUESTER } from '../helpers';

// 가상검증 실행기(가짜 CARLA) — 정책 검증 GO에 시나리오 Evidence가 필요하다
Object.assign(process.env, { CARLA_RUNNER: resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'ff-vv-')) });
afterAll(() => {
  delete process.env.CARLA_RUNNER;
  delete process.env.FF_EVIDENCE_DIR;
});
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
async function boot(at = '2026-10-12T01:00:00.000Z') {
  const b = await bootApp({ at });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB) };
}
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const BODY = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '전방 거리 오추정', reasonCode: 'DIST_EST_BIAS', confirm: 'FEAT-00022' };
const lastAudit = (db: Db, action: string) => db.get<{ result: string; reason: string }>('SELECT result, reason FROM audit WHERE action = ? ORDER BY id DESC LIMIT 1', action);

/** 승인된 FEAT-00022 정책 하나(배포 직전) */
async function approvedPolicy(http: () => any) {
  const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
  const pid = c.body.policyId as string;
  await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
  const v = await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
  expect(v.body.run.reasons).toEqual([]);
  await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
  return pid;
}

describe('FR-KSW-002-006 차단 상태 Feature 활성화 제한', () => {
  it('긴급 차단 중인 Feature의 정책 배포는 거부 — "긴급 차단 상태" 문구·차단 ID·감사 FAILED, 복원으로 차단을 다 풀면 배포된다', async () => {
    const { http, db } = await boot();
    const pid = await approvedPolicy(http);
    const k = await killV2(http, BODY);
    const r = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(422);
    expect(r.body.error.message).toContain('긴급 차단 상태');
    expect(r.body.error.details).toMatchObject({ code: 'KILL_ACTIVE', killIds: [k.killId] });
    expect(lastAudit(db, 'POLICY_DEPLOY')).toMatchObject({ result: 'FAILED', reason: expect.stringContaining('긴급 차단 상태') });
    const rb = await restoreBody(http, k.killId);
    await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, resolved: true, causeFixed: true }).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201);
    await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200);
  });
});

describe('FR-KSW-004-004·007 해제 범위 선택·부분 해제', () => {
  it('부분 복원한 차량만 차단에서 빠지고 나머지는 차단 유지 — 서버 평가기(KillRepo)도 같은 판단', async () => {
    const { http, get } = await boot();
    const k = await killV2(http, BODY);
    const repo = get(KillRepo);
    expect(repo.killed('FEAT-00022', 'ego-01')).toBe(true);
    const rb = await restoreBody(http, k.killId);
    await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, cohort: ['ego-01'], resolved: true, causeFixed: true }).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    const one = (await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
    expect(one).toMatchObject({ status: 'ACTIVE', restoredVins: ['ego-01'] });
    // 해제된 차량은 차단 아님, 남은 차량은 차단 유지(회귀: 부분 복원 뒤에도 서버 평가가 복원 차량을 KILL_SWITCH로 끄고 있었다)
    expect(repo.killed('FEAT-00022', 'ego-01')).toBe(false);
    expect(repo.killed('FEAT-00022', 'lead-01')).toBe(true);
    // 해제 기록 — Feature·해제 범위·요청자·승인자·일시·변경 전/후 상태
    expect(one.restoreStages[0]).toMatchObject({
      featureId: 'FEAT-00022',
      cohort: ['ego-01'],
      requestedBy: 'usr-ops',
      approvers: ['usr-safety2', 'usr-opslead'],
      approvedAt: expect.any(String),
      before: { status: 'ACTIVE', blockedVins: ['ego-01', 'lead-01'] },
      after: { status: 'ACTIVE', blockedVins: ['lead-01'] },
    });
  });

  it('현재 차단 상태인 범위 조회 — Feature의 ACTIVE 차단별 남은 차량, 부분 복원 차량은 빠진다', async () => {
    const { http } = await boot();
    const k = await killV2(http, BODY);
    const before = (await http().get('/api/kill-requests/blocked-scope?featureId=FEAT-00022').expect(200)).body;
    expect(before).toMatchObject({ featureId: 'FEAT-00022', vins: ['ego-01', 'lead-01'], kills: [{ killId: k.killId, blockedVins: ['ego-01', 'lead-01'], restoredVins: [] }] });
    const rb = await restoreBody(http, k.killId);
    await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, cohort: ['lead-01'], resolved: true, causeFixed: true }).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201);
    const after = (await http().get('/api/kill-requests/blocked-scope?featureId=FEAT-00022').expect(200)).body;
    expect(after).toMatchObject({ vins: ['ego-01'], kills: [{ killId: k.killId, blockedVins: ['ego-01'], restoredVins: ['lead-01'] }] });
    await http().get('/api/kill-requests/blocked-scope').expect(400);
  });
});

describe('FR-KSW-004-001·002 해제 요청 정보·확인 항목', () => {
  it('차단 사유 해소·원인 조치 완료를 모두 체크하지 않으면 요청을 만들지 않는다 — 400, 빠진 항목, 감사 FAILED', async () => {
    const { http, db } = await boot();
    const k = await killV2(http, BODY);
    const { resolved: _r, causeFixed: _c, ...rb } = await restoreBody(http, k.killId);
    const none = await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send(rb).expect(400);
    expect(none.body.error.details).toMatchObject({ field: 'checks', missing: ['resolved', 'causeFixed'] });
    const one = await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, resolved: true, causeFixed: false }).expect(400);
    expect(one.body.error.details.missing).toEqual(['causeFixed']);
    expect(lastAudit(db, 'RESTORE_REQUEST')).toMatchObject({ result: 'FAILED', reason: expect.stringContaining('원인 조치 완료') });
    const ok = (await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, resolved: true, causeFixed: true }).expect(201)).body;
    expect(ok.restoreRequest).toMatchObject({ status: 'REQUESTED', requestedBy: 'usr-ops', requestedAt: expect.any(String), checks: { resolved: true, causeFixed: true }, approverTargets: [] });
  });

  it('승인대상자 지정 — 복원 승인 후보(직전 차단 승인자 제외)만, 지정하면 그 사람만 승인할 수 있다', async () => {
    const { http } = await boot();
    const k = await killV2(http, BODY);
    const rb = { ...(await restoreBody(http, k.killId)), resolved: true, causeFixed: true };
    // 차단 승인자(usr-safety)는 복원 승인 후보가 아니다
    const bad = await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, approverTargets: ['usr-safety', 'usr-opslead'] }).expect(400);
    expect(bad.body.error.details).toMatchObject({ field: 'approverTargets', invalid: ['usr-safety'] });
    const r = (await http().post(`/api/kill-requests/${k.killId}/restore`).set(KILL_REQUESTER).send({ ...rb, approverTargets: ['usr-safety2', 'usr-opslead'] }).expect(201)).body;
    expect(r.restoreRequest.approverTargets).toEqual(['usr-safety2', 'usr-opslead']);
    // 지정하지 않은 사람(후보이긴 해도)은 승인 칸을 못 채운다
    const other = await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(actor('usr-quality', 'SAFETY_OFFICER')).send({}).expect(403);
    expect(other.body.error.details.code).toBe('NOT_DESIGNATED');
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    const done = (await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201)).body;
    expect(done.status).toBe('RELEASED');
  });
});

describe('FR-KSW-001-002·002-003·003-001 차단 대상 범위·Variant 조건·영향 차량 그룹', () => {
  it('미리보기 — 차량마다 범위 속성·Variant 판정, Feature의 Variant 조건, 범위 유형별 영향 그룹', async () => {
    const { http } = await boot();
    const pv = (await http().get('/api/kill-requests/preview?featureId=FEAT-00022&featureVersion=1.0.0').expect(200)).body;
    expect(pv.variantRule).toMatchObject({ featureId: 'FEAT-00022', country: expect.any(String), vehicleModel: expect.any(String), trim: expect.any(String), upgVc: expect.any(Array) });
    expect(pv.vehicles[0]).toMatchObject({ vin: expect.any(String), country: expect.any(String), vehicleModel: expect.any(String), swVersion: expect.any(String), upgVc: expect.any(String), verdict: expect.any(String) });
    const total = pv.groups.reduce((n: number, g: { vins: string[] }) => n + g.vins.length, 0);
    expect(total).toBe(pv.vehicles.length);
    // SW 버전 범위 — 그 버전 차량만
    const sw = pv.vehicles[0].swVersion as string;
    const want = pv.vehicles.filter((v: { swVersion: string }) => v.swVersion === sw).map((v: { vin: string }) => v.vin);
    const scoped = (await http().get(`/api/kill-requests/preview?featureId=FEAT-00022&featureVersion=1.0.0&swVersions=${encodeURIComponent(sw)}`).expect(200)).body;
    expect(scoped.scoped.map((v: { vin: string }) => v.vin)).toEqual(want);
    expect(scoped.scopeKinds).toEqual(['swVersions']);
  });
  it('요청에 범위를 주면 그 범위 차량만 차단 — 범위가 기록되고, 맞는 차량이 없으면 거부', async () => {
    const { http } = await boot();
    const pv = (await http().get('/api/kill-requests/preview?featureId=FEAT-00022&featureVersion=1.0.0').expect(200)).body;
    const sw = pv.vehicles[0].swVersion as string;
    const want = pv.vehicles.filter((v: { swVersion: string }) => v.swVersion === sw).map((v: { vin: string }) => v.vin);
    const base = { ...BODY, vins: undefined, reasonCategory: 'SAFETY', containmentJustification: '원인 분석 전 봉쇄' };
    await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...base, scope: { swVersions: ['0.0.0-none'] } }).expect(422);
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...base, scope: { swVersions: [sw] } }).expect(201)).body;
    expect(k.vins).toEqual(want);
    expect(k.scope).toEqual({ swVersions: [sw] });
  });
});

describe('FR-KSW-003-002 관련 담당자 산출', () => {
  it('Feature Owner·요청자·승인자·협력사(구현 SW 납품 정보)', async () => {
    const { http } = await boot();
    const k = await killV2(http, BODY);
    const p = (await http().get(`/api/kill-requests/${k.killId}/parties`).expect(200)).body;
    expect(p).toMatchObject({ owner: expect.any(String), requester: 'usr-ops', approvers: ['usr-safety', 'usr-csm'] });
    expect(p.suppliers.length).toBeGreaterThan(0);
    expect(p.suppliers[0]).toMatchObject({ supplier: expect.any(String), swId: expect.any(String), version: expect.any(String) });
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.parties).toEqual(p);
  });
});

describe('FR-AGW-001-002 외부 차단 요청 접수 (결정 D1 a — 실행 없음, 사람 승인 대기열로)', () => {
  it('API 키(SYSTEM)로 접수 → 차단 요청은 생기지 않는다, 운영자가 차단 요청으로 옮기면 상태 조회에 차단 ID·상태가 보인다', async () => {
    const { http, db } = await boot();
    const CSM = actor('usr-csm', 'SECURITY_OFFICER');
    const key = (await http().post('/api/api-keys').set(CSM).send({ name: '품질 관제 연계', system: '품질 관제 시스템', role: 'SYSTEM', reason: '차단 요청 접수' }).expect(201)).body.secret as string;
    const K = { 'X-Api-Key': key };
    const body = { featureId: 'FEAT-00022', featureVersion: '1.0.0', reasonCategory: 'SAFETY', reasonCode: 'DIST_EST_BIAS', reason: '현장 결함 다발', vins: ['ego-01', 'lead-01'], externalRef: 'QMS-7781' };
    // 사람 역할·키 없음은 이 창구를 못 쓴다
    await http().post('/api/ext/v1/kill-intake').set(KILL_REQUESTER).send(body).expect(403);
    const before = (await http().get('/api/kill-requests').expect(200)).body.items.length;
    const r = (await http().post('/api/ext/v1/kill-intake').set(K).send(body).expect(201)).body;
    expect(r).toMatchObject({ intakeId: 'KIN-00001', status: 'RECEIVED', source: 'EXTERNAL', receivedBy: 'apikey:AK-0001', externalRef: 'QMS-7781', killId: null });
    expect((await http().get('/api/kill-requests').expect(200)).body.items.length).toBe(before); // 실행·요청 생성 없음
    expect(db.get<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit WHERE action = 'KILL_INTAKE' ORDER BY id DESC LIMIT 1")).toMatchObject({ actor_id: 'apikey:AK-0001' });
    // 없는 Feature·범위 밖 차량은 접수하지 않는다
    await http().post('/api/ext/v1/kill-intake').set(K).send({ ...body, featureId: 'FEAT-09999' }).expect(404);
    await http().post('/api/ext/v1/kill-intake').set(K).send({ ...body, vins: ['NO-SUCH'] }).expect(400);
    // 운영자가 차단 요청으로 옮긴다(type-to-confirm·사유 그대로) — 이후는 2인 승인
    const k = (await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...BODY, reasonCategory: 'SAFETY', containmentJustification: '원인 분석 전 봉쇄', intakeId: r.intakeId }).expect(201)).body;
    expect(k.intakeId).toBe('KIN-00001');
    const st = (await http().get(`/api/ext/v1/kill-intake/${r.intakeId}`).set(K).expect(200)).body;
    expect(st).toMatchObject({ status: 'CONVERTED', killId: k.killId, killStatus: 'REQUESTED', externalRef: 'QMS-7781' });
    // 이미 옮긴 접수는 다시 쓸 수 없다
    await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...BODY, reasonCategory: 'SAFETY', containmentJustification: '봉쇄', intakeId: r.intakeId }).expect(409);
  });
  it('운영자가 사유와 함께 닫는다(DISMISSED) — 목록·상태에 남는다', async () => {
    const { http } = await boot();
    const key = (await http().post('/api/api-keys').set(actor('usr-csm', 'SECURITY_OFFICER')).send({ name: '연계', system: '외부', role: 'SYSTEM', reason: '접수' }).expect(201)).body.secret as string;
    const r = (await http().post('/api/ext/v1/kill-intake').set({ 'X-Api-Key': key }).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', reason: '오탐 가능' }).expect(201)).body;
    await http().post(`/api/kill-intake/${r.intakeId}/dismiss`).set(actor('lee.approver', 'FEATURE_APPROVER')).send({ reason: '오탐' }).expect(403);
    const d = (await http().post(`/api/kill-intake/${r.intakeId}/dismiss`).set(KILL_REQUESTER).send({ reason: '중복 보고 — 오탐 확인' }).expect(201)).body;
    expect(d).toMatchObject({ status: 'DISMISSED', closedBy: 'usr-ops', closeReason: '중복 보고 — 오탐 확인' });
    expect((await http().get('/api/kill-intake?status=DISMISSED').expect(200)).body.items.map((x: { intakeId: string }) => x.intakeId)).toEqual([r.intakeId]);
    await http().post(`/api/kill-intake/${r.intakeId}/dismiss`).set(KILL_REQUESTER).send({ reason: '다시' }).expect(409);
  });
});

describe('FR-SVS-002-001 비활성화 조건 충족 여부 확인 (자동 비활성화 없음)', () => {
  it('긴급 차단 권고 이상 → 조건 충족이면 확인 기록 + 중단 필요 접수·알림, 차단은 만들지 않는다', async () => {
    const { http, get, db } = await boot();
    get(AnomalyService).signal({ kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', vin: 'ego-01', code: 'DIST_EST_BIAS', severity: 'CRITICAL', at: '2026-10-12T01:00:00.000Z', ref: 't1' } as never);
    const checks = (await http().get('/api/deactivation-checks?featureId=FEAT-00022').expect(200)).body.items;
    expect(checks[0]).toMatchObject({ anomalyId: 'ANM-00001', featureId: 'FEAT-00022', met: true, unmet: [], intakeId: 'KIN-00001' });
    expect(checks[0].conditions.map((c: { id: string; ok: boolean }) => [c.id, c.ok])).toEqual([
      ['ADVICE_KILL', true],
      ['REMOTE_ALLOWED', true],
      ['VEHICLES', true],
      ['NO_OPEN_KILL', true],
    ]);
    const intake = (await http().get('/api/kill-intake').expect(200)).body.items[0];
    expect(intake).toMatchObject({ intakeId: 'KIN-00001', source: 'ANOMALY', anomalyId: 'ANM-00001', vins: ['ego-01'], status: 'RECEIVED' });
    expect((await http().get('/api/kill-requests').expect(200)).body.items).toHaveLength(0);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM events WHERE type = 'kill.intake-received'")!.n).toBe(1);
    // 같은 이상 건이 다시 격상돼도 접수는 하나 — 두 번째 확인은 '진행 중 접수'로 미충족 기록
    get(AnomalyService).signal({ kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', vin: 'lead-01', code: 'DIST_EST_BIAS', severity: 'CRITICAL', at: '2026-10-12T01:01:00.000Z', ref: 't2' } as never);
    expect((await http().get('/api/kill-intake').expect(200)).body.items).toHaveLength(1);
  });
  it('미충족이면 실행하지 않고 미충족 사유를 기록한다', async () => {
    const { http, get } = await boot();
    get(AnomalyService).signal({ kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', vin: 'ego-01', code: 'MINOR', severity: 'WARNING', at: '2026-10-12T01:00:00.000Z', ref: 't1' } as never);
    const c = (await http().get('/api/deactivation-checks?anomalyId=ANM-00001').expect(200)).body.items[0];
    expect(c).toMatchObject({ met: false, intakeId: null });
    expect(c.unmet[0]).toContain('긴급 차단 권고');
    expect((await http().get('/api/kill-intake').expect(200)).body.items).toHaveLength(0);
  });
});

describe('ADS-BE02 사건 범위 종료 차단·선택 해제 (TC12)', () => {
  const SAFETY_BODY = { ...BODY, reasonCategory: 'SAFETY', incidentId: 'INC-A-0001' };
  it('F2 이상 종료 명령은 사건 ID를 담고, 발행 때 차량·Feature·사건별 차단 집합이 생긴다', async () => {
    const { http } = await boot();
    const k = await killV2(http, SAFETY_BODY);
    expect(k.incidentId).toBe('INC-A-0001');
    const env = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body;
    expect(env.commands[0].reason.incident_id).toBe('INC-A-0001');
    const inh = (await http().get('/api/termination/inhibits?featureId=FEAT-00022').expect(200)).body;
    expect(inh.incidents).toEqual([expect.objectContaining({ incidentId: 'INC-A-0001', featureId: 'FEAT-00022', killId: k.killId, active: 2, released: 0 })]);
    expect(inh.vehicles.map((v: { vin: string; incidents: string[] }) => [v.vin, v.incidents])).toEqual([
      ['ego-01', ['INC-A-0001']],
      ['lead-01', ['INC-A-0001']],
    ]);
  });
  it('다른 사건은 해제할 수 없다(409) — 지정 사건만 해제하고, 다른 사건 차단이 남은 차량은 해제 뒤에도 차단 유지', async () => {
    const { http, db } = await boot();
    const k = await killV2(http, SAFETY_BODY);
    // 같은 차량에 다른 사건(INC-B)의 종료 차단이 걸려 있다
    db.run("INSERT INTO termination_inhibit (vin, feature_id, incident_id, kill_id, set_at, set_by) VALUES ('ego-01', 'FEAT-00022', 'INC-B-0002', 'KILL-09999', '2026-10-12T00:00:00.000Z', 'usr-safety')");
    const rb = { ...(await restoreBody(http, k.killId)), resolved: true, causeFixed: true };
    const other = await http().post(`/api/kill-requests/${k.killId}/rescind`).set(KILL_REQUESTER).send({ ...rb, incidentId: 'INC-B-0002' }).expect(409);
    expect(other.body.error.details.code).toBe('OTHER_INCIDENT');
    const r = (await http().post(`/api/kill-requests/${k.killId}/rescind`).set(KILL_REQUESTER).send({ ...rb, incidentId: 'INC-A-0001' }).expect(201)).body;
    expect(r.restoreRequest.status).toBe('REQUESTED');
    expect(r.heldByOther).toEqual([{ vin: 'ego-01', incidents: ['INC-B-0002'] }]);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[0]).send({}).expect(201);
    await http().post(`/api/kill-requests/${k.killId}/restore/approvals`).set(RESTORE_APPROVERS[1]).send({}).expect(201);
    const inh = (await http().get('/api/termination/inhibits?featureId=FEAT-00022').expect(200)).body;
    expect(inh.incidents.find((i: { incidentId: string }) => i.incidentId === 'INC-A-0001')).toMatchObject({ active: 0, released: 2 });
    // ego-01은 다른 사건 차단이 남아 차단 유지, lead-01은 풀림
    expect(inh.vehicles.map((v: { vin: string; incidents: string[] }) => [v.vin, v.incidents])).toEqual([['ego-01', ['INC-B-0002']]]);
  });
});

describe('ADS-BE21 영향 차량 산정 — 후보·구성 미확인·통신 미수신 3분류와 식별 정확도', () => {
  it('3분류·스냅샷 고정·재평가 이력·확정 집합(근거 필수, 후보 복사 거부)·정확도', async () => {
    const { http, db } = await boot();
    const k = await killV2(http, { ...BODY, vins: ['ego-01', 'lead-01', 'KMH-NX4-0003'], reasonCategory: 'SAFETY', incidentId: 'INC-R01-0001' });
    // 연결 이력이 없는 차량 — 시험에서 KMH-NX4-0003(통신 끊김 차량)의 회신을 지운다
    db.run("DELETE FROM readback WHERE vin = 'KMH-NX4-0003'");
    // ego-01·lead-01은 차단 뒤 회신
    for (const vin of ['ego-01', 'lead-01']) db.run("INSERT INTO readback (publication_id, vin, at, doc) VALUES ('PUB-T', ?, '2026-10-12T02:00:00.000Z', '{}')", vin);
    // 첫 산정은 차단 발행 때 고정 — 조회는 바꾸지 않는다
    const s0 = (await http().get('/api/incidents/INC-R01-0001/impact-set').expect(200)).body;
    expect(s0.current).toMatchObject({ kind: 'CANDIDATE', configAsOf: k.requestedAt });
    expect(s0.accuracy).toMatchObject({ status: 'UNKNOWN', value: null }); // 확정 영향군이 없으면 판단 불가
    expect((await http().get('/api/incidents/INC-R01-0001/impact-set').expect(200)).body.history).toHaveLength(1);
    const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
    const re = (configAsOf: string) => http().post('/api/incidents/INC-R01-0001/impact-set/reevaluate').set(SAFETY).send({ configAsOf, reason: '구성 보고 기준 갱신' }).expect(201);
    // 재평가 — 구성 기준 시각을 회신보다 뒤로: 회신이 오래돼 구성 미확인
    const s1 = (await re('2026-10-12T03:00:00.000Z')).body;
    expect(s1.current.counts).toEqual({ CANDIDATE: 0, CONFIG_UNKNOWN: 2, NO_CONTACT: 1 });
    expect(s1.current.vins.NO_CONTACT).toEqual(['KMH-NX4-0003']);
    const s2 = (await re(k.requestedAt)).body;
    expect(s2.current.counts).toEqual({ CANDIDATE: 2, CONFIG_UNKNOWN: 0, NO_CONTACT: 1 });
    expect(s2.history.map((h: { setId: string }) => h.setId)).toEqual([s0.current.setId, s1.current.setId, s2.current.setId]);
    expect(s2.history[0].counts).toEqual(s0.current.counts); // 이전 스냅샷 불변
    // 확정 집합 — 확정자·분석 근거 필수, 후보 산정을 그대로 복사하면 거부
    await http().post('/api/incidents/INC-R01-0001/impact-set/confirm').set(SAFETY).send({ vins: ['ego-01'] }).expect(400);
    const copy = await http().post('/api/incidents/INC-R01-0001/impact-set/confirm').set(SAFETY).send({ vins: ['ego-01'], analysisRef: 'RCA-0001', calcId: s2.current.calcId }).expect(409);
    expect(copy.body.error.details.code).toBe('COPIED_CANDIDATE');
    const c = (await http().post('/api/incidents/INC-R01-0001/impact-set/confirm').set(SAFETY).send({ vins: ['ego-01'], analysisRef: 'RCA-0001' }).expect(201)).body;
    expect(c.confirmed).toMatchObject({ kind: 'CONFIRMED', confirmedBy: 'usr-safety', analysisRef: 'RCA-0001', vins: ['ego-01'] });
    // 정확도 — 확정 때 본 후보 산정(2대) 중 확정 영향 1대
    expect(c.accuracy).toMatchObject({ status: 'KNOWN', value: 0.5, candidates: 2, confirmed: 1, matched: 1 });
    await http().get('/api/incidents/INC-NONE-0001/impact-set').expect(404);
  });
});

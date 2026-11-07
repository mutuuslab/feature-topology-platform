// 긴급 차단·해제 마감(P11a) — FR-KSW-002-006 차단 중 활성화 거부 · FR-KSW-004-001·002·004·007 해제 요청 정보·확인 항목·해제 범위 선택·부분 해제
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DB, type Db } from '../../src/kernel/db';
import { KillRepo } from '../../src/domains/d03-safety/kill-switch/kill.repo';
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

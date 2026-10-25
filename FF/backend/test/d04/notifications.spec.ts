// 수신자 지정 알림 (D04-04) — 기능명세서 공통 "관련 담당자에게 Web 알림 또는 이메일(하나 이상)" — 화면(Web) 알림만(D-RD-7).
// 실제 업무 흐름(정책 검증 NO-GO, 긴급 차단 요청·실행·복원 요청, 동기화 실패)에서 누가 무엇을 받는지,
// 요청 본인·직무 분리 제외(SOD-09), 계정별 읽음, 메일이 나가지 않음(설정·발송 기록·표 없음)을 확인한다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATION_ACCOUNTS, receives } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, KILL_APPROVERS, KILL_REQUESTER, RESTORE_APPROVERS } from '../helpers';

const OWNER = actor('usr-author', 'FEATURE_AUTHOR'); // 데모: Feature 설계 계정이 Owner 팀 알림을 받는다
const VIEWER = actor('usr-viewer', 'AUDITOR');
const SYSTEM_LINK = actor('usr-integrator', 'IMPLEMENTER');
const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('수신자 지정 알림 (D04-04)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const http = () => b.http();
  const inbox = async (who: Record<string, string>, q = '') => (await http().get(`/api/notifications${q}`).set(who).expect(200)).body;
  const find = (body: any, type: string) => body.items.filter((n: any) => n.eventType === type);
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-17T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_SCHEDULER;
    delete process.env.GLEO_MODE;
    delete process.env.IF_MODE_02;
  });

  let policyId: string;
  it('FR-CRC-002-009 FR-DSV-001-011 정책 검증 NO-GO → 배포 차단 알림(배포 대상·Feature·실패 항목·사유) — Owner 팀과 배포 요청자', async () => {
    const c = await http().post('/api/policies').set(OWNER).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '가상검증 없이 검증', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    policyId = c.body.policyId;
    const v = await http().post(`/api/policies/${policyId}/validate`).set(OWNER).send({}).expect(200);
    expect(v.body.run.decision).not.toBe('GO');
    const n = find(await inbox(OWNER), 'policy.validated')[0];
    expect(n).toMatchObject({ category: 'DEPLOY', severity: 'WARNING', link: `/policies/${policyId}`, readAt: null, requirementIds: ['FR-CRC-002-009', 'FR-DSV-001-011'] });
    expect(n.fields.map((f: any) => f.label)).toEqual(['배포 대상 정책', 'Feature', '실패 항목', '차단 사유']);
    expect(n.fields[1].value).toBe('FEAT-00022 전방 안전거리 3단계 1.0.0');
    expect(n.fields[2].value).toContain('D06-03');
    // 받는 사람이 아니면 보이지 않는다
    expect(find(await inbox(VIEWER), 'policy.validated')).toHaveLength(0);
  });

  it('읽음은 계정별 — 안 읽음 수가 줄고, 받는 사람이 아닌 알림은 읽을 수 없다(404)', async () => {
    const before = await inbox(OWNER);
    const n = find(before, 'policy.validated')[0];
    await http().post(`/api/notifications/${n.notificationId}/read`).set(VIEWER).send({}).expect(404);
    const r = await http().post(`/api/notifications/${n.notificationId}/read`).set(OWNER).send({}).expect(201);
    expect(r.body.readAt).toBe('2026-10-17T01:00:00.000Z');
    const after = await inbox(OWNER);
    expect(after.unread).toBe(before.unread - 1);
    expect(find(await inbox(OWNER, '?unread=1'), 'policy.validated')).toHaveLength(0);
  });

  let killId: string;
  it('긴급 차단 요청 → 승인 역할에게 승인 요청(CRITICAL), 요청자 본인은 받지 않는다 · 승인 요청은 승인 역할 모두의 화면 알림에 항상 남는다', async () => {
    const k = await http().post('/api/kill-requests').set(KILL_REQUESTER).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '현장 결함 확인', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' }).expect(201);
    killId = k.body.killId;
    const n = find(await inbox(KILL_APPROVERS[0]), 'kill.requested')[0];
    expect(n).toMatchObject({ category: 'APPROVAL', severity: 'CRITICAL', link: `/ops/kill?id=${killId}` });
    expect(n.fields.map((f: any) => [f.label, f.value])).toEqual([
      ['Feature', 'FEAT-00022 전방 안전거리 3단계'],
      ['차단 대상 범위', expect.stringContaining('차량 1대')],
      ['차단 사유', 'SAFETY/FIELD_FAULT — 현장 결함 확인'],
      ['요청자', 'usr-ops'],
      ['요청 일시', '2026-10-17T01:00:00.000Z'],
    ]);
    expect(find(await inbox(KILL_REQUESTER), 'kill.requested')).toHaveLength(0);
    for (const a of KILL_APPROVERS) expect(find(await inbox(a), 'kill.requested'), a['X-Actor-Id']).toHaveLength(1);
    // 승인 역할을 가진 데모 계정은 모두 화면 알림으로 받는다 — 협의 이관(출시 담당)은 승인 역할 없음(FFG-PLT-016)
    const receivers = NOTIFICATION_ACCOUNTS.filter((x) => receives(n, x));
    expect(receivers.map((x) => x.id).sort()).toEqual(['usr-approver', 'usr-integrator', 'usr-quality', 'usr-steward']);
    for (const x of receivers) expect(find(await inbox(actor(x.id, x.roles[0])), 'kill.requested'), x.id).toHaveLength(1);
  });

  it('FR-KSW-003-003 긴급 차단 실행 → Feature Owner 팀·운영 담당자에게 범위·사유', async () => {
    for (const a of KILL_APPROVERS) await http().post(`/api/kill-requests/${killId}/approvals`).set(a).send({}).expect(201);
    const n = find(await inbox(OWNER), 'kill.issued')[0];
    expect(n).toMatchObject({ category: 'SAFETY', severity: 'CRITICAL', requirementIds: ['FR-KSW-003-003'] });
    expect(n.fields.slice(0, 3).map((f: any) => f.label)).toEqual(['Feature', '차단 대상 범위', '차단 사유']);
    expect(find(await inbox(OPERATOR), 'kill.issued')).toHaveLength(1);
  });

  it('FR-KSW-004-005 복원 요청 → 승인 대상자에게 범위·사유·요청자·일시, 직전 차단 승인자는 받지 않는다(SOD-09)', async () => {
    await http().post(`/api/kill-requests/${killId}/restore`).set(KILL_REQUESTER).send({ reason: '원인 조치 완료' }).expect(201);
    const n = find(await inbox(RESTORE_APPROVERS[1]), 'kill.restore-requested')[0];
    expect(n.fields.map((f: any) => f.label)).toEqual(['Feature', '해제 대상 범위', '해제 사유', '요청자', '요청 일시']);
    expect(n.fields[2].value).toBe('원인 조치 완료');
    for (const prior of KILL_APPROVERS) expect(find(await inbox(prior), 'kill.restore-requested')).toHaveLength(0);
    expect(find(await inbox(RESTORE_APPROVERS[0]), 'kill.restore-requested')).toHaveLength(1);
  });

  it('FR-DSYN-001-004 동기화 실패 → 연계 담당자에게 실패 유형·발생 시점·대상 시스템, 성공은 알리지 않는다', async () => {
    const before = find(await inbox(SYSTEM_LINK), 'sync.completed').length;
    await http().post('/api/sync/runs').set(OPERATOR).send({ targetId: 'SYNC-IF02-VEH' }).expect(201);
    expect(find(await inbox(SYSTEM_LINK), 'sync.completed')).toHaveLength(before);
    process.env.IF_MODE_02 = 'off';
    const r = await http().post('/api/sync/runs').set(OPERATOR).send({ targetId: 'SYNC-IF02-VEH' }).expect(201);
    delete process.env.IF_MODE_02;
    expect(r.body.status).toBe('FAILED');
    const n = find(await inbox(SYSTEM_LINK), 'sync.completed')[0];
    expect(n.fields.map((f: any) => f.label)).toEqual(['실패 유형', '발생 시점', '대상 외부 시스템']);
    expect(n.fields[0].value).toContain('IF_MODE_02=off');
  });

  it('메일은 보내지 않는다(D-RD-7) — 알림을 만들어도 메일 기록·호출이 없고, 메일 설정·발송 기록 API와 표가 없다', async () => {
    const db = b.get<Db>(DB);
    const tables = () => db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notification%' ORDER BY name").map((r) => r.name);
    expect(tables()).toEqual(['notification', 'notification_exclude', 'notification_read', 'notification_recipient']);
    const before = (await inbox(OWNER)).items.length;
    // 새 알림 하나(배포 차단) — 화면 알림은 생기고, 메일 쪽 흔적(표·기록·주소)은 없다
    await http().post(`/api/policies/${policyId}/validate`).set(OWNER).send({}).expect(200);
    const after = await inbox(OWNER);
    expect(after.items.length).toBeGreaterThan(before);
    expect(JSON.stringify(after.items)).not.toMatch(/e-?mail|@ff-demo/i);
    expect(tables()).toEqual(['notification', 'notification_exclude', 'notification_read', 'notification_recipient']);
    await http().get('/api/notifications/emails').set(VIEWER).expect(404);
    await http().get('/api/notifications/preferences').set(OWNER).expect(404);
    await http().post('/api/notifications/preferences').set(OWNER).send({ email: { DEPLOY: true } }).expect(404);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE action = 'NOTIFICATION_PREFS'")!.n).toBe(0);
  });

  it('모두 읽음 — 범주를 고르면 그 범주만', async () => {
    const before = await inbox(OWNER);
    expect(before.byCategory.DEPLOY).toBeGreaterThan(0);
    const r = await http().post('/api/notifications/read-all').set(OWNER).send({ category: 'DEPLOY' }).expect(201);
    expect(r.body.read).toBe(before.byCategory.DEPLOY);
    const after = await inbox(OWNER);
    expect(after.byCategory.DEPLOY ?? 0).toBe(0);
    expect(after.unread).toBe(before.unread - before.byCategory.DEPLOY);
  });
});

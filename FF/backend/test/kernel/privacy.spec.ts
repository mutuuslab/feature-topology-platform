// 개인정보 삭제·내보내기·보존 기한 — 출시 준비 RD-P2-05.
//  · 내보내기는 개인정보 목록(contracts PERSONAL_DATA_INVENTORY)의 모든 저장소를 담는다(완전성) — 비밀(세션 해시·소금·칸 해시)은 빠진다
//  · 삭제 실행은 요청자와 다른 보안 담당자 — 삭제·가명 처리 뒤에도 감사 체인 검증이 통과하고, 처리 자체가 감사에 남는다(식별자 대신 가명)
//  · 가명 처리 기록 없이 감사 행을 바꾸거나 소금만 지우면 검증이 잡는다
//  · 보존 기한 — 끝난 세션 삭제, 오래된 감사 행의 사람 행위자 가명 처리(기본 0 = 하지 않음)
//  · 차량 삭제는 Data Lake에 가명 단위 삭제를 요청한다(설정이 없으면 NOT_CONNECTED로 기록)
// readiness: RD-P2-05
process.env.FF_SCHEDULER = 'manual';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { PERSONAL_DATA_INVENTORY, PERSONAL_RETENTION, personalStores, redactIdentifiers, mentionsIdentifier } from '@ff/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/kernel/audit.service';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { HousekeepingService } from '../../src/kernel/housekeeping.service';
import { PrivacyService } from '../../src/kernel/privacy.service';
import { actor, bootApp } from '../helpers';

const LEAVER = 'usr-leaver';
const AUTHOR = actor(LEAVER, 'FEATURE_AUTHOR');
const CSM = actor('usr-csm', 'SECURITY_OFFICER');
const CSM2 = actor('usr-csm2', 'SECURITY_OFFICER');
const AT = '2026-10-20T00:00:00.000Z';
/** 알림 한 건 — 개인 수신자(user:…)와 읽음, 본문에 요청자 */
function seedNotification(db: Db, id: string, user: string, at: string, seq: number) {
  db.run("INSERT INTO notification (notification_id, event_seq, category, severity, created_at, doc) VALUES (?, ?, 'APPROVAL', 'INFO', ?, ?)", id, seq, at, JSON.stringify({ notificationId: id, title: `${user}의 승인 요청`, requestedBy: user }));
  db.run('INSERT INTO notification_recipient (notification_id, rkey) VALUES (?, ?)', id, `user:${user}`);
  db.run('INSERT INTO notification_read (notification_id, user_id, at) VALUES (?, ?, ?)', id, user, at);
}
const board = { v: 2, layout: '2L', columns: [['g1'], []], gadgets: { g1: { id: 'g1', type: 'filter', config: { source: 'features', rows: 10 }, configured: true, refresh: 0, minimized: false } } };

describe('식별자 경계(contracts)', () => {
  it('같은 식별자만 바꾼다 — usr-leaver가 usr-leaver2·이메일 일부에 걸리지 않는다, JSON은 그대로 유효', () => {
    const doc = JSON.stringify({ by: 'usr-leaver', other: 'usr-leaver2', key: 'user:usr-leaver', mail: 'x.usr-leaver@a.b' });
    const out = redactIdentifiers(doc, ['usr-leaver'], 'psn-0123456789abcdef');
    expect(JSON.parse(out)).toEqual({ by: 'psn-0123456789abcdef', other: 'usr-leaver2', key: 'user:psn-0123456789abcdef', mail: 'x.usr-leaver@a.b' });
    expect(mentionsIdentifier('approved by usr-leaver.', ['usr-leaver'])).toBe(true);
    expect(mentionsIdentifier('usr-leaver2', ['usr-leaver'])).toBe(false);
  });
});

describe('개인정보 — 내보내기·삭제 요청·감사 체인', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let audit: AuditService;
  let privacy: PrivacyService;

  beforeAll(async () => {
    let get: <T>(t: any) => T;
    ({ app, http, get } = await bootApp({ at: AT }));
    db = get<Db>(DB);
    audit = get(AuditService);
    privacy = get(PrivacyService);
    // 떠나는 사용자의 흔적 — 대시보드·즐겨찾기·Feature 작성(감사·이벤트)·알림 읽음·로그인 세션
    const mine = (await http().post('/api/dashboards').set(AUTHOR).send({ name: '내 판', board }).expect(201)).body;
    const shared = (await http().post('/api/dashboards').set(actor('usr-other', 'FEATURE_AUTHOR')).send({ name: '공유 판', board, sharedRoles: ['FEATURE_AUTHOR'] }).expect(201)).body;
    await http().put(`/api/dashboards/${shared.id}/favourite`).set(AUTHOR).send({ favourite: true }).expect(200);
    await http().put(`/api/dashboards/${mine.id}`).set(AUTHOR).set('If-Match', '"1"').send({ name: `내 판 (${LEAVER})` }).expect(200);
    await http()
      .post('/api/features')
      .set(AUTHOR)
      .send({ name: '떠나는 사람의 Feature', description: '개인정보 시험', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: LEAVER, asil: 'QM' })
      .expect(201);
    await http().post('/api/notifications/read-all').set(AUTHOR).send({}).expect(201);
    seedNotification(db, 'NTF-T0001', LEAVER, AT, 900001);
    db.run(
      "INSERT INTO auth_session (id_hash, sub, name, email, roles, created_at, expires_at, last_seen_at) VALUES ('h1', ?, '떠나는 사람', 'leaver@oem.example', '[\"FEATURE_AUTHOR\"]', ?, ?, ?)",
      LEAVER,
      AT,
      '2026-10-21T00:00:00.000Z',
      AT,
    );
  });
  afterAll(() => app.close());

  it('개인정보 목록 — 모든 저장소가 DB에 있고, 보존 기한은 설정을 반영한다(이벤트 이력은 결정 D-RD-9 대기, 기본 지우지 않음)', async () => {
    const tables = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name));
    expect(PERSONAL_DATA_INVENTORY.filter((s) => !tables.has(s.store)).map((s) => s.store)).toEqual([]);
    const inv = (await http().get('/api/privacy/inventory').expect(200)).body;
    expect(inv.stores).toHaveLength(PERSONAL_DATA_INVENTORY.length);
    expect(inv.retention.find((r: any) => r.key === 'events')).toMatchObject({ env: 'FF_RETENTION_EVENT_DAYS', days: 0, decision: 'D-RD-9' });
    expect(privacy.inventory({ FF_RETENTION_SESSION_DAYS: '5' }).retention.find((r) => r.key === 'session')!.days).toBe(5);
    expect(PERSONAL_RETENTION.map((r) => r.env)).toEqual(['FF_RETENTION_SESSION_DAYS', 'FF_RETENTION_NOTIFICATION_DAYS', 'FF_RETENTION_AUDIT_IDENTITY_DAYS', 'FF_RETENTION_EVENT_DAYS']);
  });

  it('내보내기 — 보안 담당자만, 목록의 사용자 저장소를 모두 담고(완전성) 비밀 칸은 빠진다, 내보낸 사실은 가명으로 감사', async () => {
    await http().post('/api/privacy/export').set(AUTHOR).send({ subjectKind: 'USER', subjectId: LEAVER, reason: '본인 열람 요청' }).expect(403);
    const r = (await http().post('/api/privacy/export').set(CSM).set('Idempotency-Key', 'export-1').send({ subjectKind: 'USER', subjectId: LEAVER, reason: '본인 열람 요청' }).expect(200)).body;
    // 내보낸 개인정보 사본을 재전송 보관함(idempotency)에 남기지 않는다
    expect(db.get("SELECT 1 FROM idempotency WHERE key = 'export-1'")).toBeUndefined();
    expect(r.schema).toBe('ff.privacy.export/v1');
    expect(r.sections.map((s: any) => s.store)).toEqual(personalStores('USER').map((s) => s.store));
    const n = r.counts;
    expect(n.dashboard).toBe(1);
    expect(n.dashboard_star).toBe(1);
    expect(n.auth_session).toBe(1);
    expect(n.notification_read).toBeGreaterThan(0);
    expect(n.audit).toBeGreaterThanOrEqual(3);

    expect(n.feature_version).toBe(1);
    const session = r.sections.find((s: any) => s.store === 'auth_session').rows[0];
    expect(session).toMatchObject({ sub: LEAVER, email: 'leaver@oem.example' });
    expect(session.id_hash).toBeUndefined();
    const auditRow = r.sections.find((s: any) => s.store === 'audit').rows[0];
    expect(auditRow.actor_d).toBeUndefined();
    expect(auditRow.hash).toBeUndefined();
    expect(r.subject.pseudonym).toMatch(/^psn-[0-9a-f]{16}$/);
    const logged = audit.list({ target: r.subject.pseudonym });
    expect(logged.map((a) => a.action)).toEqual(['PRIVACY_EXPORT']);
    expect(JSON.stringify(logged)).not.toContain(LEAVER);
  });

  it('삭제 요청 → 요청자는 실행할 수 없다(4안 원칙) → 다른 보안 담당자가 실행: 지우고·가명 처리하고, 감사 체인 검증은 통과', async () => {
    const req = (await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'USER', subjectId: LEAVER, basis: 'EMPLOYMENT_END', reason: '퇴직' }).expect(201)).body;
    expect(req).toMatchObject({ requestId: 'PRV-00001', status: 'REQUESTED', subjectId: LEAVER });
    expect(req.preview.dashboard).toBe(1);
    await http().post('/api/privacy/requests').set(CSM2).send({ subjectKind: 'USER', subjectId: LEAVER, basis: 'EMPLOYMENT_END', reason: '중복' }).expect(409);
    const sod = await http().post(`/api/privacy/requests/${req.requestId}/execute`).set(CSM).send({}).expect(403);
    expect(sod.body.error.code).toBe('SEPARATION_OF_DUTY');
    const done = (await http().post(`/api/privacy/requests/${req.requestId}/execute`).set(CSM2).send({}).expect(200)).body;
    expect(done).toMatchObject({ status: 'DONE', subjectId: null, decidedBy: 'usr-csm2' });
    expect(done.result.deleted).toMatchObject({ dashboard: 1, dashboard_star: 1, auth_session: 1, privacy_subject: 1 });
    expect(done.result.auditRows).toBeGreaterThanOrEqual(3);
    expect(done.result.retained.feature_version).toBe(1);
    expect(done.result.lake.status).toBe('NOT_APPLICABLE');

    // 지운 것 — 세션·대시보드·즐겨찾기·읽음, 대응표
    expect(db.get('SELECT 1 FROM auth_session WHERE sub = ?', LEAVER)).toBeUndefined();
    expect(db.get('SELECT 1 FROM dashboard WHERE owner_id = ?', LEAVER)).toBeUndefined();
    expect(db.get('SELECT 1 FROM dashboard_star WHERE actor_id = ?', LEAVER)).toBeUndefined();
    expect(db.get('SELECT 1 FROM notification_read WHERE user_id = ?', LEAVER)).toBeUndefined();
    expect(db.get<{ rkey: string }>("SELECT rkey FROM notification_recipient WHERE notification_id = 'NTF-T0001'")!.rkey).toBe(`user:${done.pseudonym}`);
    expect(db.get<{ doc: string }>("SELECT doc FROM notification WHERE notification_id = 'NTF-T0001'")!.doc).not.toContain(LEAVER);
    expect(db.get('SELECT 1 FROM privacy_subject WHERE subject_id = ?', LEAVER)).toBeUndefined();
    // 가명 처리한 것 — 감사(행위자·대상·사유·전후 문서)·이벤트·요청 기록에 원래 식별자가 없다
    const leaks = db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE actor_id = ? OR target LIKE ? OR coalesce(reason, '') LIKE ? OR coalesce(before_doc, '') LIKE ? OR coalesce(after_doc, '') LIKE ?", LEAVER, `%${LEAVER}%`, `%${LEAVER}%`, `%${LEAVER}%`, `%${LEAVER}%`)!;
    expect(leaks.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM events WHERE payload LIKE ?', `%${LEAVER}%`)!.n).toBe(0);
    expect(db.get<{ doc: string }>('SELECT doc FROM privacy_request WHERE request_id = ?', req.requestId)!.doc).not.toContain(LEAVER);
    expect(audit.list({ actorId: done.pseudonym }).length).toBeGreaterThanOrEqual(3);
    // 법정 보존(서명·승인 책임 기록) — Feature 작성자는 그대로(D-RD-10)
    expect(db.get<{ created_by: string }>('SELECT created_by FROM feature_version WHERE created_by = ?', LEAVER)).toBeTruthy();

    // 감사 체인 — 행 해시가 그대로라 검증 통과, 처리 자체가 감사에 남는다(가명만)
    expect(audit.verifyChain()).toMatchObject({ ok: true, broken: null });
    expect((await http().get('/api/audit/chain').expect(200)).body).toMatchObject({ ok: true });
    const trail = audit.list({ target: req.requestId }).map((a) => a.action);
    expect(trail).toEqual(expect.arrayContaining(['PRIVACY_REQUEST', 'PRIVACY_REDACT', 'PRIVACY_ERASE']));
    expect(JSON.stringify(audit.list({ target: req.requestId }))).not.toContain(LEAVER);
    await http().post(`/api/privacy/requests/${req.requestId}/execute`).set(CSM2).send({}).expect(409);
    const list = (await http().get('/api/privacy/requests').set(CSM).expect(200)).body.items;
    expect(list[0]).toMatchObject({ requestId: req.requestId, status: 'DONE', subjectId: null });
  });

  it('가명 처리 기록 없이 감사 행을 바꾸거나 소금만 지우면 검증이 잡는다(redaction)', async () => {
    const redacted = db.get<{ audit_id: number }>('SELECT audit_id FROM audit_redaction ORDER BY audit_id LIMIT 1')!.audit_id;
    // 처리 관문 밖에서는 트리거가 막는다
    expect(() => db.run("UPDATE audit SET actor_id = 'someone-else' WHERE id = ?", redacted)).toThrow(/append-only/);
    expect(() => db.run('DELETE FROM audit_salt WHERE audit_id = (SELECT max(audit_id) FROM audit_salt)')).toThrow(/개인정보 처리 중/);
    db.run('DROP TRIGGER audit_no_update');
    const was = db.get<{ actor_id: string }>('SELECT actor_id FROM audit WHERE id = ?', redacted)!.actor_id;
    db.run("UPDATE audit SET actor_id = 'someone-else' WHERE id = ?", redacted);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: redacted, kind: 'redaction' } });
    db.run('UPDATE audit SET actor_id = ? WHERE id = ?', was, redacted);
    expect(audit.verifyChain().ok).toBe(true);
    db.run('DROP TRIGGER audit_salt_no_delete');
    const fresh = db.get<{ audit_id: number }>('SELECT max(audit_id) AS audit_id FROM audit_salt')!.audit_id;
    db.run('DELETE FROM audit_salt WHERE audit_id = ?', fresh);
    expect(audit.verifyChain()).toMatchObject({ ok: false, broken: { id: fresh, kind: 'redaction' } });
  });
});

describe('개인정보 — 거절·차량 삭제·Data Lake 접점', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let audit: AuditService;
  let lake: Server;
  const received: { auth: string | undefined; body: any }[] = [];

  beforeAll(async () => {
    lake = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ request_id: 'lake-er-1', status: 'MASKED' }));
      });
    });
    await new Promise<void>((r) => lake.listen(0, '127.0.0.1', () => r()));
    let get: <T>(t: any) => T;
    ({ app, http, get } = await bootApp({ at: AT }));
    db = get<Db>(DB);
    audit = get(AuditService);
  });
  afterEach(() => {
    delete process.env.FF_LAKE_URL;
    delete process.env.FF_LAKE_TOKEN;
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => lake.close(r));
  });

  it('거절 — 사유 필수, 대상 식별자를 지운다, 요청자는 거절할 수 없다', async () => {
    const req = (await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'USER', subjectId: 'usr-stay', basis: 'DATA_SUBJECT_REQUEST', reason: '본인 요청' }).expect(201)).body;
    await http().post(`/api/privacy/requests/${req.requestId}/reject`).set(CSM2).send({}).expect(400);
    await http().post(`/api/privacy/requests/${req.requestId}/reject`).set(CSM).send({ reason: '법적 보존 대상' }).expect(403);
    const r = (await http().post(`/api/privacy/requests/${req.requestId}/reject`).set(CSM2).send({ reason: '법적 보존 대상' }).expect(200)).body;
    expect(r).toMatchObject({ status: 'REJECTED', subjectId: null, decisionReason: '법적 보존 대상' });
    // 차량은 퇴직 근거를 쓸 수 없다, 자기 자신은 다른 담당자가
    await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'VEHICLE', subjectId: 'KMH-NX4-0002', basis: 'EMPLOYMENT_END', reason: 'x 사유' }).expect(400);
    await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'USER', subjectId: 'usr-csm', basis: 'EMPLOYMENT_END', reason: '본인 퇴직' }).expect(403);
  });

  it('차량 삭제 — 차량 발신 보고·성향을 지우고 법정 보존 기록(Fleet·권한·상태 보고)은 남기며, Data Lake에 가명 단위 삭제를 요청한다', async () => {
    Object.assign(process.env, { FF_LAKE_URL: `http://127.0.0.1:${(lake.address() as AddressInfo).port}/`, FF_LAKE_TOKEN: 'lake-ingest-token' });
    const vin = 'KMH-NX4-0002';
    db.run("INSERT INTO vehicle_request (request_id, vin, at, doc) VALUES ('VRQ-T1', ?, ?, '{}')", vin, AT);
    const exp = (await http().post('/api/privacy/export').set(CSM).send({ subjectKind: 'VEHICLE', subjectId: vin, reason: '차주 열람 요청' }).expect(200)).body;
    expect(exp.sections.map((s: any) => s.store)).toEqual(personalStores('VEHICLE').map((s) => s.store));
    expect(exp.counts.vehicle).toBe(1);
    expect(exp.counts.vehicle_request).toBeGreaterThanOrEqual(1);
    expect(exp.subject.vehiclePseudonym).toBe(vehiclePseudonym(vin));
    const req = (await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'VEHICLE', subjectId: vin, basis: 'DATA_SUBJECT_REQUEST', reason: '차주 삭제 요청' }).expect(201)).body;
    const done = (await http().post(`/api/privacy/requests/${req.requestId}/execute`).set(CSM2).send({}).expect(200)).body;
    expect(done.result.deleted.vehicle_request).toBeGreaterThanOrEqual(1);
    expect(done.result.retained.vehicle).toBe(1);
    expect(db.get('SELECT 1 FROM vehicle_request WHERE vin = ?', vin)).toBeUndefined();
    expect(db.get('SELECT 1 FROM vehicle WHERE vin = ?', vin)).toBeTruthy();
    expect(done.result.lake).toEqual({ status: 'SENT', lakeRequestId: 'lake-er-1', detail: null });
    expect(received).toEqual([{ auth: 'Bearer lake-ingest-token', body: { request_ref: req.requestId, pseudonyms: [vehiclePseudonym(vin)], basis: 'DATA_SUBJECT_REQUEST' } }]);
    expect(JSON.stringify(received)).not.toContain(vin);
    expect(audit.list({ target: req.requestId }).map((a) => a.action)).toContain('PRIVACY_LAKE_ERASURE');
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('Data Lake 설정이 없으면 보내지 않고 NOT_CONNECTED로 남긴다(Lake 연결 전)', async () => {
    const vin = 'KMH-NX4-0003';
    const req = (await http().post('/api/privacy/requests').set(CSM).send({ subjectKind: 'VEHICLE', subjectId: vin, basis: 'CONTRACT_END', reason: '계약 종료' }).expect(201)).body;
    const done = (await http().post(`/api/privacy/requests/${req.requestId}/execute`).set(CSM2).send({}).expect(200)).body;
    expect(done.result.lake.status).toBe('NOT_CONNECTED');
    expect(received).toHaveLength(1);
  });
});

describe('개인정보 보존 기한 — 운영 보조 정리와 함께', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  let audit: AuditService;
  let clock: Clock;
  let privacy: PrivacyService;

  beforeAll(async () => {
    let get: <T>(t: any) => T;
    ({ app, http, get } = await bootApp({ at: '2026-01-10T00:00:00.000Z' }));
    db = get<Db>(DB);
    audit = get(AuditService);
    clock = get(Clock);
    privacy = get(PrivacyService);
    clock.set('2026-01-10T00:00:00.000Z');
  });
  afterAll(() => app.close());

  it('기본은 아무것도 지우거나 가명 처리하지 않는다(세션은 만료 뒤 30일)', async () => {
    db.run("INSERT INTO auth_session (id_hash, sub, name, email, roles, created_at, expires_at, last_seen_at) VALUES ('old', 'usr-a', null, null, '[]', '2025-11-01T00:00:00Z', '2025-11-02T00:00:00Z', '2025-11-02T00:00:00Z')");
    db.run("INSERT INTO auth_session (id_hash, sub, name, email, roles, created_at, expires_at, last_seen_at) VALUES ('new', 'usr-b', null, null, '[]', '2026-01-09T00:00:00Z', '2026-01-09T08:00:00Z', '2026-01-09T08:00:00Z')");
    await http().post('/api/dashboards').set(actor('usr-old', 'FEATURE_AUTHOR')).send({ name: '오래된 판', board }).expect(201);
    expect(privacy.retentionSweep({})).toEqual({ session: 1, notification: 0, audit_identity: 0 });
    expect(db.all<{ id_hash: string }>('SELECT id_hash FROM auth_session').map((r) => r.id_hash)).toEqual(['new']);
    expect(audit.list({ actorId: 'usr-old' })).toHaveLength(1);
  });

  it('감사 행위자 식별 보존 기한 — 기한이 지난 사람 행위자만 가명(같은 사람은 같은 가명), 체인 검증 통과', async () => {
    clock.set('2026-03-01T00:00:00.000Z');
    await http().post('/api/dashboards').set(actor('usr-new', 'FEATURE_AUTHOR')).send({ name: '새 판', board }).expect(201);
    const r = privacy.retentionSweep({ FF_RETENTION_AUDIT_IDENTITY_DAYS: '30' });
    expect(r.audit_identity).toBe(1);
    expect(audit.list({ actorId: 'usr-old' })).toHaveLength(0);
    expect(audit.list({ actorId: 'usr-new' })).toHaveLength(1);
    const psn = db.get<{ pseudonym: string }>("SELECT pseudonym FROM privacy_subject WHERE subject_id = 'usr-old'")!.pseudonym;
    expect(audit.list({ actorId: psn })).toHaveLength(1);
    expect(audit.verifyChain()).toMatchObject({ ok: true });
    // 다시 돌려도 늘지 않는다(이미 가명 처리한 행은 소금이 없다)
    expect(privacy.retentionSweep({ FF_RETENTION_AUDIT_IDENTITY_DAYS: '30' }).audit_identity).toBe(0);
  });

  it('알림 보존 기한 — 기한이 지난 알림과 받는 사람·읽음을 지운다(추가 전용 트리거는 처리 중에만 풀린다)', async () => {
    seedNotification(db, 'NTF-T0002', 'usr-old', '2026-01-10T00:00:00.000Z', 900002);
    const before = db.get<{ n: number }>('SELECT count(*) AS n FROM notification')!.n;
    expect(before).toBeGreaterThan(0);
    expect(() => db.run('DELETE FROM notification')).toThrow(/추가만 가능/);
    const r = privacy.retentionSweep({ FF_RETENTION_NOTIFICATION_DAYS: '1' });
    expect(r.notification).toBe(before);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM notification')!.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM notification_recipient')!.n).toBe(0);
    expect(db.get<{ active: number }>('SELECT active FROM privacy_gate')!.active).toBe(0);
  });

  it('운영 보조 정리(HousekeepingService)가 개인정보 보존 기한을 함께 돈다', () => {
    const hk = app.get(HousekeepingService) as unknown as { privacy: PrivacyService };
    expect(hk.privacy).toBe(privacy);
  });
});

describe('Data Lake 삭제 접점 설정 검사', () => {
  it('주소·토큰은 함께, 운영 모드는 https만', async () => {
    const { lakeErasureConfigProblems } = await import('../../src/kernel/lake-erasure');
    expect(lakeErasureConfigProblems({}, true)).toEqual([]);
    expect(lakeErasureConfigProblems({ FF_LAKE_URL: 'https://lake.oem.example' }, true)).toHaveLength(1);
    expect(lakeErasureConfigProblems({ FF_LAKE_URL: 'http://lake.oem.example', FF_LAKE_TOKEN: 't' }, true)).toHaveLength(1);
    expect(lakeErasureConfigProblems({ FF_LAKE_URL: 'http://127.0.0.1:1', FF_LAKE_TOKEN: 't' }, false)).toEqual([]);
  });
});

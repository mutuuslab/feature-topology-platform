// 보존과 삭제 (D04-03, 보고서 v1.1 13.7 · FFG-TEL-008) — 수용 기준: 기간 초과 데이터 0건, 열린 Incident 데이터의 삭제 0건, 삭제 기록이 남는다.
// 시험 차량 tst-9000x는 시험용(시드에 없는 VIN) — 오래된 행은 시험 준비로 직접 넣는다.
Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { actor, bootApp } from '../helpers';

const OLD = '2024-01-01T00:00:00.000Z';
const SEC_OLD = '2023-01-01T00:00:00.000Z'; // 보안 로그는 3년
const HELD = 'tst-90001'; // 열린 Incident가 있는 차량
const FREE = 'tst-90002';

describe('보존과 삭제 (FFG-TEL-008)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T00:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_SCHEDULER;
  });

  it('FFG-TEL-008 기간이 지난 상태 보고·보안 로그·차량 보고는 지우고, 열린 Incident 차량의 행은 남기며 삭제 기록을 남긴다', async () => {
    const http = b.http;
    const db = b.get<Db>(DB);
    const status = (vin: string, at: string) =>
      db.run("INSERT INTO status_report (vin, feature_id, report_seq, state, accepted, violation, via, doc, received_at) VALUES (?, 'FEAT-09999', 1, 'ACTIVE', 1, NULL, 'TEST', '{}', ?)", vin, at);
    status(HELD, OLD);
    status(FREE, OLD);
    status(FREE, '2026-10-01T00:00:00.000Z'); // 기간 안
    db.run("INSERT INTO security_event (at, event_id, code, vehicle, doc) VALUES (?, 'AUTH_FAILURE', 'AUTH_FAILED', ?, '{}')", SEC_OLD, vehiclePseudonym(HELD));
    db.run("INSERT INTO security_event (at, event_id, code, vehicle, doc) VALUES (?, 'AUTH_FAILURE', 'AUTH_FAILED', ?, '{}')", SEC_OLD, vehiclePseudonym(FREE));
    db.run("INSERT INTO vehicle_request (request_id, vin, at, boot_id, sequence, doc) VALUES ('TST-REQ-1', ?, '2026-09-01T00:00:00.000Z', NULL, NULL, '{}')", FREE); // 30일 초과(개인정보 가능)
    db.run("INSERT INTO vehicle_request (request_id, vin, at, boot_id, sequence, doc) VALUES ('TST-REQ-2', ?, '2026-10-10T00:00:00.000Z', NULL, NULL, '{}')", FREE);
    const inc = (await http().post('/api/incidents').set(actor('seo.ops', 'OPERATOR')).send({ source: 'FIELD', vin: HELD, category: 'OTHER', severity: 'WARNING', summary: '보존 시험 장애' }).expect(201)).body;

    const before = (await http().get('/api/retention').expect(200)).body.policies;
    expect(before.find((p: any) => p.store === 'status_report')).toMatchObject({ expired: 2, held: 1, deletable: 1 });

    const r = (await http().post('/api/retention/sweep').set(actor('usr-reg', 'REGULATORY_OWNER')).send({}).expect(200)).body;
    expect(r.stores).toEqual(
      expect.arrayContaining([
        { store: 'status_report', cutoff: '2025-10-15T00:00:00.000Z', deleted: 1, held: 1 },
        expect.objectContaining({ store: 'security_event', deleted: 1, held: 1 }),
        expect.objectContaining({ store: 'vehicle_request', deleted: 1, held: 0 }),
      ]),
    );
    // 열린 Incident 차량의 행은 남고, 기간 안 행도 남는다
    expect(db.all<{ vin: string }>("SELECT vin FROM status_report WHERE feature_id = 'FEAT-09999' ORDER BY id").map((x) => x.vin)).toEqual([HELD, FREE]);
    expect(db.all<{ vehicle: string }>('SELECT vehicle FROM security_event WHERE at = ?', SEC_OLD).map((x) => x.vehicle)).toEqual([vehiclePseudonym(HELD)]);
    expect(db.all<{ request_id: string }>("SELECT request_id FROM vehicle_request WHERE request_id LIKE 'TST-REQ-%'").map((x) => x.request_id)).toEqual(['TST-REQ-2']);

    // 합격: 기간 초과 데이터 0건(남은 것은 열린 건 근거가 있는 HOLD뿐), 삭제 기록에 근거 건
    const after = (await http().get('/api/retention').expect(200)).body;
    for (const p of after.policies) expect(p.deletable).toBe(0);
    expect(after.deletions.find((d: any) => d.store === 'status_report')).toMatchObject({ deleted: 1, held: 1, heldBy: expect.arrayContaining([inc.incidentId]) });
    // 다시 돌려도 더 지우지 않는다
    expect((await http().post('/api/retention/sweep').set(actor('usr-reg', 'REGULATORY_OWNER')).send({}).expect(200)).body.stores.every((s: any) => s.deleted === 0)).toBe(true);
  });

  it('FFG-TEL-008 sweep 밖에서는 추가만 저장소를 지울 수 없고, 삭제 기록도 고칠 수 없다 · 보존 sweep은 법규·운영 리더만', async () => {
    const db = b.get<Db>(DB);
    expect(() => db.run('DELETE FROM status_report')).toThrow(/추가만/);
    expect(() => db.run('DELETE FROM security_event')).toThrow(/추가만/);
    expect(() => db.run('DELETE FROM retention_deletion')).toThrow(/추가만/);
    await b.http().post('/api/retention/sweep').set(actor('seo.ops', 'OPERATOR')).send({}).expect(403);
  });
});

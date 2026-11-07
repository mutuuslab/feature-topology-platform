// Feature 사용량 정산 전송(D05-04, FR-BIL-001-002) — 전송 항목·주기, 사용량 집계(이용 권한 원장), 정산 IF 모의 어댑터(if_call SETTLEMENT),
// 전송 실패 사유·시각 기록(추가만)과 연계 오류 이력, 달마다 성공 한 번, 주기 전송(매월 1일 직전 달)·실패 재시도.
Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettlementService } from '../../src/domains/d05-ext/billing/settlement.service';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const OPS = actor('seo.ops', 'OPERATOR');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');

afterAll(() => {
  delete process.env.FF_SCHEDULER;
  delete process.env.IF_MODE_SETTLEMENT;
});

describe('사용량 정산 전송 (FR-BIL-001-002)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  const clock = () => get<Clock>(Clock);
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-10-12T01:00:00.000Z' })));
  afterAll(() => app.close());

  it('10월 체험 전환 — 제안·수락·구독 구매(모의 과금)', async () => {
    const o = await http().post('/api/trials/offers').set(PRODUCT).send({ catalogId: 'CAT-00019', vins: ['KMH-NX4-0003'] }).expect(201);
    const id = o.body.offered[0].grantId;
    await http().post(`/api/trials/${id}/accept`).set(OPS).send({}).expect(200);
    await http().post(`/api/trials/${id}/purchase`).set(OPS).send({ plan: '구독' }).expect(200);
  });

  it('사용량 — 기본은 직전 달, 항목·주기 정의와 상품별 집계. 진행 중인 달은 끝나지 않음', async () => {
    clock().set(new Date('2026-11-07T01:00:00.000Z'));
    const r = await http().get('/api/settlement/usage').expect(200);
    expect(r.body).toMatchObject({ period: '2026-10', from: '2026-10-01', to: '2026-11-01', closed: true, sent: null, cycle: { period: 'MONTHLY', sendDay: 1, retryHours: 24 } });
    expect(r.body.items.map((i: any) => i.key)).toEqual(['subscriptionVehicles', 'subscriptionDays', 'purchases', 'conversions', 'trialVehicles']);
    const line = r.body.lines.find((l: any) => l.catalogId === 'CAT-00019');
    expect(line.conversions).toBeGreaterThanOrEqual(1);
    expect(line.subscriptionVehicles).toBeGreaterThanOrEqual(1);
    expect(r.body.totals.lines).toBe(r.body.lines.length);
    expect((await http().get('/api/settlement/usage?period=2026-11').expect(200)).body.closed).toBe(false);
    await http().get('/api/settlement/usage?period=2026-13').expect(400);
  });

  it('전송 — 운영자·출시 담당만, 끝난 달만(422). 모의 정산 시스템 영수 번호, 같은 달 다시 보내기 409', async () => {
    await http().post('/api/settlement/transmissions').set(AUTHOR).send({ period: '2026-10', reason: '월 정산' }).expect(403);
    await http().post('/api/settlement/transmissions').set(OPS).send({ period: '2026-11', reason: '월 정산' }).expect(422);
    const r = await http().post('/api/settlement/transmissions').set(OPS).send({ period: '2026-10', reason: '월 정산' }).expect(201);
    expect(r.body).toMatchObject({ transmissionId: 'STL-00001', period: '2026-10', status: 'SENT', trigger: 'MANUAL', actorId: 'seo.ops', attempt: 1, receiptId: 'SETL-2026-10-0001', reason: null, at: '2026-11-07T01:00:00.000Z' });
    const calls = get<Db>(DB).all<{ doc: string }>("SELECT doc FROM if_call WHERE if_id = 'SETTLEMENT'");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].doc).request).toMatchObject({ period: '2026-10', lines: expect.any(Array) });
    const dup = await http().post('/api/settlement/transmissions').set(RELEASE).send({ period: '2026-10', reason: '다시' }).expect(409);
    expect(dup.body.error.message).toMatch(/STL-00001/);
    expect((await http().get('/api/settlement/usage?period=2026-10').expect(200)).body.sent).toMatchObject({ transmissionId: 'STL-00001', receiptId: 'SETL-2026-10-0001' });
  });

  it('전송 실패 — 정산 연계가 꺼지면 사유·시각을 기록(422)하고 연계 오류 이력·알림, 다시 켜면 다음 시도가 성공', async () => {
    process.env.IF_MODE_SETTLEMENT = 'off';
    const f = await http().post('/api/settlement/transmissions').set(OPS).send({ period: '2026-09', reason: '9월 늦은 정산' }).expect(422);
    expect(f.body.error.message).toMatch(/정산 시스템 연계가 꺼져 있습니다/);
    const t = (await http().get('/api/settlement/transmissions?period=2026-09').expect(200)).body.items;
    expect(t).toEqual([expect.objectContaining({ transmissionId: 'STL-00002', status: 'FAILED', attempt: 1, at: '2026-11-07T01:00:00.000Z', reason: expect.stringMatching(/꺼져 있습니다/), errorId: expect.stringMatching(/^ERR-/), receiptId: null })]);
    const errs = (await http().get('/api/integrations/errors?system=BILLING').expect(200)).body.items;
    expect(errs[0]).toMatchObject({ errorId: t[0].errorId, errorType: 'CONNECTION_OFF', target: 'SETTLEMENT:2026-09' });
    delete process.env.IF_MODE_SETTLEMENT;
    const ok = await http().post('/api/settlement/transmissions').set(OPS).send({ period: '2026-09', reason: '재전송' }).expect(201);
    expect(ok.body).toMatchObject({ status: 'SENT', attempt: 2 });
    const all = (await http().get('/api/settlement/transmissions').expect(200)).body.items;
    expect(all.map((x: any) => [x.transmissionId, x.period, x.status])).toEqual([
      ['STL-00003', '2026-09', 'SENT'],
      ['STL-00002', '2026-09', 'FAILED'],
      ['STL-00001', '2026-10', 'SENT'],
    ]);
  });

  it('주기 전송 — 매월 1일 직전 달(SCHEDULE), 이미 보냈으면 건너뛰고 실패는 24시간 뒤 다시', async () => {
    const svc = get<SettlementService>(SettlementService);
    clock().set(new Date('2026-11-20T00:00:00.000Z'));
    expect(svc.runDue()).toBeNull(); // 10월은 보냈다
    process.env.IF_MODE_SETTLEMENT = 'off';
    clock().set(new Date('2026-12-01T00:10:00.000Z'));
    expect(svc.runDue()).toMatchObject({ period: '2026-11', status: 'FAILED', trigger: 'SCHEDULE', actorId: 'system:settlement' });
    clock().set(new Date('2026-12-01T12:00:00.000Z'));
    expect(svc.runDue()).toBeNull(); // 재시도 간격 전
    delete process.env.IF_MODE_SETTLEMENT;
    clock().set(new Date('2026-12-02T00:10:00.000Z'));
    expect(svc.runDue()).toMatchObject({ period: '2026-11', status: 'SENT', attempt: 2, trigger: 'SCHEDULE' });
    expect(svc.runDue()).toBeNull();
  });
});

// 보안 이벤트 모니터링 (D06-12, 보고서 v1.1 14.4 · FFG-SEC-007) — 수용 기준: 14.4절 이벤트가 IdsM 기록과 VSOC 경보로 이어진다.
// 상태 증명 실패(위조 state_auth)는 1건에 경보, 진위 실패는 같은 차량 10분 3건에 경보와 채널 처리 제한(상태 보고 429). 포렌식 기록은 가명·추가만.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { SecurityEventService } from '../../src/domains/d06-qsec/anomaly-response/security-events.service';
import { bootApp, killV2 } from '../helpers';

const VEHICLE = (vin: string) => ({ 'X-Vehicle-Id': vin });

describe('보안 이벤트 (FFG-SEC-007)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const alerts = async () => (await b.http().get('/api/events?type=vsoc.alert').expect(200)).body.items.map((e: any) => e.payload);

  it('위조 상태 보고(state_auth 불일치) → 상태 증명 실패 1건에 VSOC 경보, 포렌식 기록은 차량 가명', async () => {
    const http = b.http;
    await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '보안 이벤트 시험', confirm: 'FEAT-00022' });
    const clock = b.get(Clock);
    b.get(Scheduler).flush(8_000);
    clock.set(new Date(clock.now().getTime() + 8_000));
    const last = (await http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].report;
    await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send({ ...last, state: 'ACTIVE', report_seq: last.report_seq + 1 }).expect(200);
    expect(await alerts()).toEqual([expect.objectContaining({ eventId: 'STATE_PROOF_FAILURE', category: 'SECURITY_MONITORING', vehicle: vehiclePseudonym('ego-01'), limitChannel: false })]);
    const ev = (await http().get('/api/security-events?eventId=STATE_PROOF_FAILURE').expect(200)).body.items[0];
    expect(ev).toMatchObject({ code: 'STATE_AUTH_FAILED', vehicle: vehiclePseudonym('ego-01') });
    expect(JSON.stringify(ev)).not.toContain('ego-01'); // 개인정보(VIN) 없음
  });

  it('진위 실패 같은 차량 10분 3건 → VSOC 경보 + 채널 처리 제한(상태 보고 429 CHANNEL_LIMITED), 기록은 고칠 수 없다', async () => {
    const http = b.http;
    const svc = b.get(SecurityEventService);
    expect(svc.observe('AUTH_FAILED', 'lead-01', { source: 'test' })).toBeNull();
    expect(svc.observe('SIGNATURE_INVALID', 'lead-01', { source: 'test' })).toBeNull();
    expect(svc.observe('TARGET_MISMATCH', 'lead-01', { source: 'test' })).toMatchObject({ eventId: 'AUTH_FAILURE', count: 3, limitChannel: true });
    expect((await alerts()).map((a: any) => a.eventId)).toContain('AUTH_FAILURE');
    const r = await http().post('/vehicle/v1/lead-01/status').set(VEHICLE('lead-01')).send({}).expect(429);
    expect(r.body.error.details).toMatchObject({ code: 'CHANNEL_LIMITED' });
    await http().post('/vehicle/v1/ego-01/status').set(VEHICLE('ego-01')).send({}).expect(200); // 다른 차량은 그대로
    expect(() => b.get<Db>(DB).run('DELETE FROM security_event')).toThrow(/추가만/);
  });
});

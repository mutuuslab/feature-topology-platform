// 차량 발신 요청 — 차량이 먼저 부르는 조회(IF-10)·보고(IF-06). 자기 VIN만, Flag 직접 변경·신뢰 원천 변경 거부,
// (vin, bootId, sequence) 멱등, 낮은 sequence·과거 부팅 보고 거부, 재연결 대사, VIN별 빈도 한도.
import { INestApplication } from '@nestjs/common';
import { VEHICLE_RATE_LIMIT } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { bootApp } from '../helpers';

const VIN = 'ego-01';
const FLAG = 'care_00022_param';
const as = (vin: string) => ({ 'X-Vehicle-Id': vin });
const at = '2026-10-12T01:00:00.000Z';

describe('차량 발신 요청 (D02-03 · D05-01)', () => {
  let app: INestApplication;
  let http: () => any;
  let seq = 0;
  const BOOT = 'BOOT-ego-01-7';
  /** ego-01이 같은 부팅에서 다음 번호로 보고한다 */
  const report = (body: Record<string, unknown>, vin = VIN, headers = as(VIN)) =>
    http()
      .post(`/vehicle/v1/${vin}/reports`)
      .set(headers)
      .send({ bootId: BOOT, sequence: ++seq, observedAt: at, ...body });
  const value = (r: { body: { flags: { key: string; value: unknown }[] } }) => r.body.flags.find((f) => f.key === FLAG)?.value;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: at })); // 시드 기준일도 같은 날(체험권 날짜는 기준일 상대값)
  });
  afterAll(() => app.close());

  describe('신원·범위', () => {
    it('차량 신원이 없으면 401, 감사에 남는다', async () => {
      const r = await http().post(`/vehicle/v1/${VIN}/flags`).send({}).expect(401);
      expect(r.body.error.code).toBe('VEHICLE_UNAUTHENTICATED');
      const audit = await http().get('/api/audit?actorId=vehicle:unknown').expect(200);
      expect(audit.body.items.length).toBeGreaterThan(0);
    });

    it('다른 차량의 VIN으로는 조회·보고할 수 없다 (403 VEHICLE_SCOPE)', async () => {
      const q = await http().post(`/vehicle/v1/KMH-NX4-0101/flags/${FLAG}`).set(as(VIN)).send({}).expect(403);
      expect(q.body.error.code).toBe('VEHICLE_SCOPE');
      const body = await http().post(`/vehicle/v1/${VIN}/flags`).set(as(VIN)).send({ context: { targetingKey: 'KMH-NX4-0101' } }).expect(403);
      expect(body.body.error.code).toBe('VEHICLE_SCOPE');
      const rep = await http().post('/vehicle/v1/lead-01/reports').set(as(VIN)).send({ type: 'CONTEXT', bootId: 'B', sequence: 1, observedAt: at, set: { quality: 'STALE' } }).expect(403);
      expect(rep.body.error.code).toBe('VEHICLE_SCOPE');
    });

    it('등록되지 않은 차량은 받지 않는다', async () => {
      const r = await http().post('/vehicle/v1/NO-SUCH-VIN/flags').set(as('NO-SUCH-VIN')).send({}).expect(401);
      expect(r.body.error.code).toBe('VEHICLE_UNAUTHENTICATED');
    });
  });

  describe('조회 (IF-10)', () => {
    it('전체 조회는 OFREP 형식이고, 응답이 같으면 304', async () => {
      const r = await http().post(`/vehicle/v1/${VIN}/flags`).set(as(VIN)).send({}).expect(200);
      expect(r.body.flags.find((f: { key: string }) => f.key === FLAG)).toMatchObject({ key: FLAG, value: true, reason: 'TARGETING_MATCH' });
      await http().post(`/vehicle/v1/${VIN}/flags`).set(as(VIN)).set('If-None-Match', r.headers.etag).send({}).expect(304);
    });

    it('단일 조회 — 배포되지 않은 flag는 404 (차량은 Safe Default)', async () => {
      const r = await http().post(`/vehicle/v1/${VIN}/flags/${FLAG}`).set(as(VIN)).send({ context: { targetingKey: VIN } }).expect(200);
      expect(r.body).toMatchObject({ key: FLAG, value: true });
      const nf = await http().post(`/vehicle/v1/${VIN}/flags/no_such_flag`).set(as(VIN)).send({}).expect(404);
      expect(nf.body.error.details.errorCode).toBe('FLAG_NOT_FOUND');
    });
  });

  describe('보고 (IF-06)', () => {
    it('재연결 대사(HELLO)가 부팅을 열고, 차량 대상 게시본 중 빠진 것을 서명째 돌려준다', async () => {
      const r = await report({ type: 'HELLO', highest: {} }).expect(200);
      expect(r.body).toMatchObject({ type: 'HELLO', outcome: 'ACCEPTED' });
      for (const p of r.body.redeliver) {
        expect(p.payload.targets).toContain(VIN);
        expect(p.signature).toBeDefined();
      }
      expect(value(r)).toBe(true);
    });

    it('관측값 변경 → 재평가 응답: 통신 품질 저하면 Safe Default, 회복하면 다시 ON', async () => {
      const stale = await report({ type: 'CONTEXT', set: { quality: 'STALE' } }).expect(200);
      expect(stale.body.changed.quality).toEqual({ before: 'TRUSTED', after: 'STALE' });
      expect(stale.body.flags.find((f: { key: string }) => f.key === FLAG)).toMatchObject({ value: false, metadata: { decision: 'HOLD' } });
      const ok = await report({ type: 'CONTEXT', set: { quality: 'TRUSTED', swVersion: '1.1.9' } }).expect(200);
      expect(value(ok)).toBe(true);
      const v = (await http().get('/api/vehicles').expect(200)).body.items.find((x: { vin: string }) => x.vin === VIN);
      expect(v).toMatchObject({ quality: 'TRUSTED', swVersion: '1.1.9' });
    });

    it('신뢰 원천 속성(트림)은 바꾸지 못한다 — 400 TRUST_SOURCE_FIELD, 차량 정보 그대로', async () => {
      const before = (await http().get('/api/vehicles').expect(200)).body.items.find((x: { vin: string }) => x.vin === VIN);
      const r = await report({ type: 'CONTEXT', set: { trim: 'Modern' } }).expect(400);
      expect(r.body.error).toMatchObject({ code: 'TRUST_SOURCE_FIELD', details: { rejected: ['trim'] } });
      const after = (await http().get('/api/vehicles').expect(200)).body.items.find((x: { vin: string }) => x.vin === VIN);
      expect(after.trim).toBe(before.trim);
    });

    it('Flag 값 직접 변경은 항상 거부한다 — 403 VEHICLE_OVERRIDE_FORBIDDEN, 감사 DENIED', async () => {
      const r = await report({ type: 'OVERRIDE', flagKey: FLAG, value: false }).expect(403);
      expect(r.body.error.code).toBe('VEHICLE_OVERRIDE_FORBIDDEN');
      const audit = await http().get(`/api/audit?actorId=vehicle:${VIN}&result=DENIED`).expect(200);
      expect(audit.body.items.some((a: { action: string }) => a.action === 'VEHICLE_OVERRIDE')).toBe(true);
      const q = await http().post(`/vehicle/v1/${VIN}/flags/${FLAG}`).set(as(VIN)).send({}).expect(200);
      expect(q.body.value).toBe(true);
    });

    it('오류 이벤트는 이벤트 이력에 남는다', async () => {
      const r = await report({ type: 'FAULT', featureId: 'FEAT-00022', code: 'RADAR_BIAS', severity: 'CRITICAL', detail: '거리 추정 편향' }).expect(200);
      expect(r.body.fault).toMatchObject({ code: 'RADAR_BIAS', severity: 'CRITICAL' });
      const ev = await http().get(`/api/events?type=vehicle.fault.reported&aggregate=${VIN}`).expect(200);
      expect(ev.body.items[0].payload).toMatchObject({ featureId: 'FEAT-00022', code: 'RADAR_BIAS' });
    });

    it('회신(READBACK)은 대상 게시본이 아니면 거부한다', async () => {
      const r = await report({ type: 'READBACK', readback: { publicationId: 'PUB-99999', metricType: 'READBACK', policyHash: 'x', featureVersion: '1.0.0', sequence: 1, observed: 'ACTIVE' } }).expect(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    });

    it('이미 체험 중인 차량의 IVI 체험 수락은 거부한다 (기간형 — 수락은 제안 중일 때 한 번)', async () => {
      const ents = (await http().get(`/api/entitlements?vin=${VIN}`).expect(200)).body.items;
      expect(ents.find((e: { catalogId: string }) => e.catalogId === 'CAT-00019')).toMatchObject({ state: 'ACTIVE', effective: true });
      const r = await report({ type: 'TRIAL_ACCEPT', catalogId: 'CAT-00019' }).expect(422);
      expect(r.body.error).toMatchObject({ code: 'GUARD_FAILED', message: expect.stringContaining('이미') });
    });

    it('제안 중인 차량(lead-01)이 IVI에서 수락 → 30일 체험 ON, 재평가 응답에 바로 반영', async () => {
      const LEAD = 'lead-01';
      const lead = (body: Record<string, unknown>, sequence: number) => http().post(`/vehicle/v1/${LEAD}/reports`).set(as(LEAD)).send({ bootId: 'BOOT-lead-01-1', sequence, observedAt: at, ...body });
      const before = await http().post(`/vehicle/v1/${LEAD}/flags/${FLAG}`).set(as(LEAD)).send({}).expect(200);
      expect(before.body).toMatchObject({ value: false, metadata: { platformReason: 'NO_ENTITLEMENT' } });
      const r = await lead({ type: 'TRIAL_ACCEPT', catalogId: 'CAT-00019' }, 1).expect(200);
      expect(r.body.grant).toMatchObject({ grantId: 'ENT-00003', status: 'ACTIVE', validFrom: '2026-10-12', validTo: '2026-11-10', daysLeft: 30 });
      expect(r.body.flags.find((f: { key: string }) => f.key === FLAG)).toMatchObject({ value: true });
      const again = await lead({ type: 'TRIAL_ACCEPT', catalogId: 'CAT-00019' }, 2).expect(422);
      expect(again.body.error.code).toBe('GUARD_FAILED');
    });
  });

  describe('멱등·순서 (bootId·sequence)', () => {
    it('같은 (bootId, sequence) 재시도는 저장된 응답을 그대로 돌려주고 두 번 처리하지 않는다', async () => {
      const body = { type: 'FAULT', bootId: BOOT, sequence: ++seq, observedAt: at, featureId: 'FEAT-00022', code: 'DUP_TEST', severity: 'INFO' };
      const a = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send(body).expect(200);
      const b = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send(body).expect(200);
      expect(b.body).toMatchObject({ requestId: a.body.requestId, outcome: 'DUPLICATE' });
      const ev = await http().get(`/api/events?type=vehicle.fault.reported&aggregate=${VIN}`).expect(200);
      expect(ev.body.items.filter((e: { payload: { code: string } }) => e.payload.code === 'DUP_TEST')).toHaveLength(1);
      const reused = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ ...body, code: 'OTHER' }).expect(422);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('같은 부팅의 오래된 sequence는 409 OLD_SEQUENCE — 최신 관측값을 덮어쓰지 않는다', async () => {
      const r = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ type: 'CONTEXT', bootId: BOOT, sequence: 1_000_000, observedAt: at, set: { quality: 'TRUSTED' } }).expect(200);
      expect(r.body.outcome).toBe('ACCEPTED');
      seq = 1_000_000;
      const old = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ type: 'CONTEXT', bootId: BOOT, sequence: 999_999, observedAt: at, set: { quality: 'UNTRUSTED' } }).expect(409);
      expect(old.body.error.code).toBe('OLD_SEQUENCE');
      const v = (await http().get('/api/vehicles').expect(200)).body.items.find((x: { vin: string }) => x.vin === VIN);
      expect(v.quality).toBe('TRUSTED');
    });

    it('재부팅 후에는 HELLO만 새 부팅을 연다 — 다른 보고는 409 BOOT_MISMATCH', async () => {
      const mismatch = await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ type: 'FAULT', bootId: 'BOOT-ego-01-8', sequence: 1, observedAt: at, featureId: 'FEAT-00022', code: 'X', severity: 'INFO' }).expect(409);
      expect(mismatch.body.error.code).toBe('BOOT_MISMATCH');
      await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ type: 'HELLO', bootId: 'BOOT-ego-01-8', sequence: 0, observedAt: at, highest: {} }).expect(200);
      await http().post(`/vehicle/v1/${VIN}/reports`).set(as(VIN)).send({ type: 'FAULT', bootId: 'BOOT-ego-01-8', sequence: 1, observedAt: at, featureId: 'FEAT-00022', code: 'X', severity: 'INFO' }).expect(200);
    });
  });

  it('요청 기록 — 조회·보고·거부 사유와 보고 위치를 화면에 준다', async () => {
    const r = await http().get(`/api/vehicles/${VIN}/requests`).expect(200);
    expect(r.body.cursor).toEqual({ bootId: 'BOOT-ego-01-8', sequence: 1 });
    const reasons = r.body.items.map((x: { reason: string | null }) => x.reason);
    expect(reasons).toEqual(expect.arrayContaining(['VEHICLE_OVERRIDE_FORBIDDEN', 'TRUST_SOURCE_FIELD', 'OLD_SEQUENCE', 'BOOT_MISMATCH']));
    expect(r.body.items.some((x: { channel: string; outcome: string }) => x.channel === 'QUERY' && x.outcome === 'ACCEPTED')).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('bodyHash');
  });

  it('VIN별 빈도 한도를 넘으면 429 + Retry-After, 다른 차량은 영향 없음', async () => {
    const send = () => http().post('/vehicle/v1/KMH-NX4-0002/flags').set(as('KMH-NX4-0002')).send({}); // 앞 시험에서 요청하지 않은 차량
    for (let i = 0; i < VEHICLE_RATE_LIMIT.requests; i++) await send().expect(200);
    const r = await send().expect(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    await http().post(`/vehicle/v1/${VIN}/flags`).set(as(VIN)).send({}).expect(200);
    app.get(Clock).set(new Date(Date.parse(at) + VEHICLE_RATE_LIMIT.windowMs));
    await send().expect(200);
  });
});

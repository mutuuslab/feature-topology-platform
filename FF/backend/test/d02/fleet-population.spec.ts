// 5년 운영 모집단 (D02-03) — 대상 차량 깔때기(가정값 모델), 신차 커넥티드 등록(IF-06 모의, SYSTEM만·감사),
// 대규모 표본 지도: 범위 안 표본이 상한을 넘으면 점 대신 격자 집계(대표 대수)만, 국가 요약은 가중 전체 기준. 판매 전·말소 차량은 빠진다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { MAP_POINT_LIMIT, ONBOARD_MAX_PROFILES, platformStart, sampleVehicles, type VehicleProfile } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/kernel/audit.service';
import { actor, bootApp } from '../helpers';

const SYSTEM = actor('fleet-if06', 'SYSTEM');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const TODAY = '2026-10-12';

describe('5년 운영 모집단·신차 등록·대규모 지도 (D02-03)', () => {
  let app: INestApplication;
  let http: () => any;
  let sample: VehicleProfile[];
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: `${TODAY}T01:00:00.000Z` }));
    sample = sampleVehicles(6000, platformStart(TODAY), TODAY);
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('모집단 — 판매의 일부만 대상, 단계마다 줄어든다. 표본이 없으면 표본 규모 0', async () => {
    const r = (await http().get('/api/fleet/population').set(OPERATOR).expect(200)).body;
    expect(r.dataset).toEqual({ kind: 'demo', start: null });
    const f = r.funnel;
    expect(f.soldWorldwide).toBeGreaterThan(f.soldServed);
    expect(f.platform).toBeGreaterThan(f.connected);
    expect(f.active).toBeLessThan(f.soldWorldwide / 2);
    expect(r.sample).toMatchObject({ rows: 0, represented: 0, receivers: 0 });
  });

  it('신차 등록은 SYSTEM만 — 다른 역할 403', async () => {
    await http().post('/api/fleet/onboard').set(OPERATOR).send({ profiles: sample.slice(0, 1) }).expect(403);
  });

  it('회귀: 본문이 너무 크면 413(요청 문제) — 서버 오류 500이 아니다', async () => {
    const r = await http().post('/api/fleet/onboard').set(SYSTEM).send({ profiles: sample.slice(0, 3000) }).expect(413);
    expect(r.body.error.code).toBe('VALIDATION');
  });

  it('신차 등록 — 나눠 들이고, 한 번에 한 건 감사. 상한 초과·같은 VIN은 받지 않는다', async () => {
    const before = app.get(AuditService).list({ actorId: 'fleet-if06' }).length;
    const receivers = sample.slice(0, 3).map((p) => ({ vin: p.vin, label: p.vin, country: p.country, vehicleModel: p.vehicleModel, trim: p.trim, modelYear: '2025', upgVc: 'X', swVersion: '1.0' }));
    await http().post('/api/fleet/onboard').set(SYSTEM).send({ profiles: sample.slice(0, ONBOARD_MAX_PROFILES + 1) }).expect(400);
    let batches = 0;
    for (let i = 0; i < sample.length; i += ONBOARD_MAX_PROFILES, batches++) await http().post('/api/fleet/onboard').set(SYSTEM).send({ profiles: sample.slice(i, i + ONBOARD_MAX_PROFILES), receivers: i === 0 ? receivers : [] }).expect(201);
    expect(app.get(AuditService).list({ actorId: 'fleet-if06' }).filter((a) => a.action === 'FLEET_ONBOARD').length - before).toBe(batches);
    const dup = await http().post('/api/fleet/onboard').set(SYSTEM).send({ profiles: sample.slice(0, 1) }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const pop = (await http().get('/api/fleet/population').set(OPERATOR).expect(200)).body;
    expect(pop.sample.receivers).toBe(3);
    expect(pop.sample.rows).toBeGreaterThan(5000);
    expect(pop.sample.represented).toBeGreaterThan(1_000_000); // 표본 한 대가 수천 대를 대표
  });

  it('수신 표본은 시연 차량 런타임 목록에 섞이지 않는다', async () => {
    const rt = (await http().get('/api/fleet/runtime').set(OPERATOR).expect(200)).body;
    expect(rt.items.every((v: { vin: string }) => !/-P\d{6}$/.test(v.vin))).toBe(true);
  });

  it('전 세계 범위 — 표본이 상한을 넘으면 점 대신 격자 집계만, 국가 요약은 가중 전체', async () => {
    const r = (await http().get('/api/fleet/map?source=SYNTHETIC&zoom=1').set(OPERATOR).expect(200)).body;
    expect(r.items.length).toBe(0);
    expect(r.pointsOmitted).toBeGreaterThan(MAP_POINT_LIMIT);
    const clustered = r.clusters.reduce((s: number, c: { count: number }) => s + c.count, 0);
    const summarized = r.summary.reduce((s: number, x: { total: number }) => s + x.total, 0);
    expect(Math.abs(clustered - r.represented) / r.represented).toBeLessThan(0.05); // 위치 없는 차량만큼 차이
    expect(Math.abs(summarized - r.represented)).toBeLessThanOrEqual(r.summary.length);
    expect(r.represented).toBeGreaterThan(1_000_000);
    // 5초마다 오는 응답이 표본 수에 비례해 커지지 않는다
    expect(JSON.stringify(r).length).toBeLessThan(500_000);
  });

  it('서울 범위로 좁히면 그 안의 표본만 점으로 — 대표 대수가 실린다', async () => {
    const r = (await http().get('/api/fleet/map?source=SYNTHETIC&zoom=11&bbox=126.8,37.4,127.2,37.7').set(OPERATOR).expect(200)).body;
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.length).toBeLessThanOrEqual(MAP_POINT_LIMIT);
    for (const v of r.items) {
      expect(v.position.lat).toBeGreaterThanOrEqual(37.4);
      expect(v.position.lng).toBeLessThanOrEqual(127.2);
    }
    expect(r.items.some((v: { weight: number }) => v.weight > 1)).toBe(true);
    expect(r.pointsOmitted).toBe(0);
  });

  it('판매 전·말소 차량은 지도에서 빠진다', async () => {
    const future = sample.filter((p) => p.soldMonth! > TODAY.slice(0, 7)).length;
    const retired = sample.filter((p) => p.retiredAt && p.retiredAt <= TODAY).length;
    expect(retired).toBeGreaterThan(0);
    const pop = (await http().get('/api/fleet/population').set(OPERATOR).expect(200)).body;
    expect(pop.sample.rows).toBe(sample.length - future - retired);
    expect(pop.sample.inactive).toBe(retired + future);
  });

  it('표본 차량에도 실제 경로로 체험을 제안한다 — 권한은 SYNTHETIC(가중 집계), 말소 차량은 건너뛴다', async () => {
    const live = sample.find((p) => !p.retiredAt && p.country === 'KR' && p.vehicleModel === 'NX4 PE')!;
    const gone = sample.find((p) => p.retiredAt)!;
    const r = (await http().post('/api/trials/offers').set(OPERATOR).send({ catalogId: 'CAT-00019', vins: [live.vin, gone.vin] }).expect(201)).body;
    expect(r.offered.map((g: { vin: string }) => g.vin)).toEqual([live.vin]);
    expect(r.skipped).toEqual([{ vin: gone.vin, reason: '판매 전이거나 말소된 차량' }]);
    const g = (await http().get(`/api/entitlements?vin=${live.vin}`).set(OPERATOR).expect(200)).body;
    expect(JSON.stringify(g)).toContain('SYNTHETIC');
  });
});

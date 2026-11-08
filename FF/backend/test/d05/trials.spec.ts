// 기간형 체험권 (D01-05) → 구매 전환 (D05-04 과금 연계 모의) → 체험 전환 분석 (D05-06 사업 지표) — 2026-10-13 결정.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');
const AUDITOR = actor('jung.audit', 'AUDITOR');
const AT = '2026-10-12T01:00:00.000Z'; // KST 2026-10-12

describe('체험권 — 제안·수락·거절·구매 전환', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('데모 권한 날짜는 시드 기준일 상대값 — 체험 중·제안 중·거절·전환·만료가 모두 보인다', async () => {
    const r = await http().get('/api/trials?source=DEMO&catalogId=CAT-00019').expect(200);
    const by = Object.fromEntries(r.body.items.map((t: any) => [t.vin, [t.state, t.daysLeft]]));
    expect(by).toMatchObject({ 'ego-01': ['ACTIVE', 19], 'lead-01': ['OFFERED', 12], 'KMH-GN7-0001': ['DECLINED', null], 'HMA-NX4-0001': ['CONVERTED', null], 'TMA-NX4-0001': ['EXPIRED', null] });
    expect(r.body.items.find((t: any) => t.vin === 'ego-01').profile).toMatchObject({ country: 'KR', region: '수도권', ageBand: '40대', drivingStyle: '고속도로', adasUsage: '높음', source: 'DEMO' });
    // 사용 권한 목록 기본은 데모만(합성 모집단 제외)
    const ents = (await http().get('/api/entitlements').expect(200)).body.items;
    expect(ents.every((e: any) => e.source === 'DEMO')).toBe(true);
    expect(ents.find((e: any) => e.grantId === 'ENT-00006')).toMatchObject({ kind: '구독', fromTrial: 'ENT-00005', effective: true });
  });

  it('차량별 체험 제안 — 열린 체험·전환 이력·유효한 구독·지원하지 않는 차량(FFG-VEH-006)은 건너뛴다, 작성자·운영자만', async () => {
    await http().post('/api/trials/offers').set(AUDITOR).send({ catalogId: 'CAT-00019', vins: ['KMH-NX4-0002'] }).expect(403);
    const r = await http()
      .post('/api/trials/offers')
      .set(PRODUCT)
      .send({ catalogId: 'CAT-00019', vins: ['KMH-NX4-0002', 'KMH-NX4-0003', 'ego-01', 'HMA-NX4-0001', 'TMA-NX4-0001', 'NOPE-1'], note: '가을 프로모션' })
      .expect(201);
    expect(r.body.offered.map((g: any) => [g.vin, g.grantId, g.state, g.validTo])).toEqual([
      ['KMH-NX4-0003', 'ENT-00008', 'OFFERED', '2026-10-25'],
      ['TMA-NX4-0001', 'ENT-00009', 'OFFERED', '2026-10-25'], // 지난 체험이 만료되었으면 다시 제안할 수 있다
    ]);
    expect(r.body.skipped.map((s: any) => s.vin)).toEqual(['KMH-NX4-0002', 'ego-01', 'HMA-NX4-0001', 'NOPE-1']);
    // 켤 수 없는 기능은 제안하지 않는다 — SW 1.2.0 < 요구 1.2.1
    expect(r.body.skipped[0].reason).toMatch(/^NOT_SUPPORTED: FEAT-00022 1\.0\.0 — SW 1\.2\.0 < 요구 1\.2\.1/);
    const ev = await http().get('/api/events?type=entitlement.offered').expect(200);
    expect(ev.body.items).toHaveLength(2);
  });

  it('거절하면 DECLINED, 다시 수락할 수 없다', async () => {
    const r = await http().post('/api/trials/ENT-00009/decline').set(OPERATOR).send({ reason: '관심 없음' }).expect(200);
    expect(r.body).toMatchObject({ status: 'DECLINED', state: 'DECLINED', note: '관심 없음' });
    await http().post('/api/trials/ENT-00009/accept').set(OPERATOR).send({}).expect(422);
  });

  it('구매 전환 — 결제(모의 과금, 멱등 키 = 체험권:요금제) 확인 뒤 체험은 CONVERTED, 구독 권한이 새로 생긴다', async () => {
    await http().post('/api/trials/ENT-00008/purchase').set(OPERATOR).send({ plan: '구독' }).expect(422); // 수락 전
    await http().post('/api/trials/ENT-00008/accept').set(OPERATOR).send({}).expect(200);
    const p = await http().post('/api/trials/ENT-00008/purchase').set(OPERATOR).send({ plan: '구독' }).expect(200);
    expect(p.body.order).toMatchObject({ orderId: 'ORD-00001', plan: '구독', status: 'PAID' });
    expect(p.body.trial).toMatchObject({ grantId: 'ENT-00008', state: 'CONVERTED', convertedAt: '2026-10-12', convertedPlan: '구독', effective: false });
    expect(p.body.grant).toMatchObject({ grantId: 'ENT-00010', kind: '구독', fromTrial: 'ENT-00008', validTo: '2027-10-11', effective: true });
    // 같은 체험을 다시 구매하면 거부, 과금 호출은 한 번만
    await http().post('/api/trials/ENT-00008/purchase').set(OPERATOR).send({ plan: '구독' }).expect(422);
    const calls = await http().get('/api/integrations/calls?ifId=BILLING').expect(200);
    expect(calls.body.items).toHaveLength(1);
    // 구독 권한은 체험과 별개로 ON — 체험 판단은 구독이 이어받는다
    const d = await http().get('/api/activation/decide?vin=KMH-NX4-0003&flagKey=care_00022_param').expect(200);
    expect(d.body.entitlement).toMatchObject({ active: true });
    expect(d.body.entitlement.grants.map((g: any) => g.grantId)).toContain('ENT-00010');
    // 지원 조건으로는 막히지 않는다(이 차량 문맥 품질은 별개 판정)
    expect(d.body.result.trace.find((t: any) => t.step === 'SUPPORT').result).not.toBe('FALSE');
    const ev = await http().get('/api/events?type=entitlement.converted').expect(200);
    expect(ev.body.items.at(-1)).toMatchObject({ aggregate: 'KMH-NX4-0003', payload: { plan: '구독', newGrantId: 'ENT-00010', orderId: 'ORD-00001' } });
  });

  it('FFG-VEH-006 제안 뒤 SW가 요구 Version 아래로 내려가면 수락·구매 전환도 거부(감사 FAILED), 과금은 부르지 않는다', async () => {
    const fleet = app.get(FleetRepo);
    const set = (vin: string, swVersion: string) => fleet.updateVehicle({ ...fleet.vehicle(vin)!, swVersion });
    set('lead-01', '1.2.0'); // 제안 중(ENT-00003)
    set('ego-01', '1.2.0'); // 체험 중(ENT-00001)
    try {
      expect((await http().post('/api/trials/ENT-00003/accept').set(OPERATOR).send({}).expect(422)).body.error.message).toMatch(/NOT_SUPPORTED: FEAT-00022/);
      expect((await http().post('/api/trials/ENT-00001/purchase').set(OPERATOR).send({ plan: '구매' }).expect(422)).body.error.message).toMatch(/NOT_SUPPORTED: FEAT-00022/);
      expect((await http().get('/api/integrations/calls?ifId=BILLING').expect(200)).body.items).toHaveLength(1);
      const failed = (await http().get('/api/audit?target=ENT-00003').expect(200)).body.items;
      expect(failed.at(-1)).toMatchObject({ action: 'TRIAL_ACCEPT', result: 'FAILED' });
    } finally {
      set('lead-01', '1.2.1');
      set('ego-01', '1.2.1');
    }
    expect((await http().get('/api/trials?source=DEMO&catalogId=CAT-00019').expect(200)).body.items.find((t: any) => t.vin === 'lead-01')).toMatchObject({ state: 'OFFERED' });
  });

  it('체험권 목록 — 상태·성향 필터와 쪽 나눔 (합성 모집단 포함)', async () => {
    const all = (await http().get('/api/trials?catalogId=CAT-00019&pageSize=20').expect(200)).body;
    expect(all.total).toBeGreaterThan(3000);
    expect(all.items).toHaveLength(20);
    expect(all.items[0].source).toBe('DEMO'); // 데모 차량이 먼저
    const f = (await http().get('/api/trials?catalogId=CAT-00019&source=SYNTHETIC&state=CONVERTED&country=US&adasUsage=높음&pageSize=200').expect(200)).body;
    expect(f.total).toBeGreaterThan(0);
    expect(f.items.every((t: any) => t.state === 'CONVERTED' && t.profile.country === 'US' && t.profile.adasUsage === '높음' && t.vin.startsWith('SYN-US-'))).toBe(true);
    expect(f.byState.CONVERTED).toBe(f.total); // 상태별 개수는 상태 필터 전
    expect(f.byState.ACTIVE + f.byState.EXPIRED).toBeGreaterThan(0);
  });
});

describe('체험 전환 분석 (D05-06)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('전체 깔때기 — 제안 ≥ 수락 ≥ 구매, 데모·합성 개수와 기준일', async () => {
    const r = (await http().get('/api/biz/trials?catalogId=CAT-00019').expect(200)).body;
    expect(r).toMatchObject({ today: '2026-10-12', catalogId: 'CAT-00019', source: 'ALL', k: 5, counts: { demo: 5, synthetic: 3000 } });
    expect(r.total.offered).toBe(3005);
    expect(r.total.offered).toBeGreaterThan(r.total.accepted);
    expect(r.total.accepted).toBeGreaterThan(r.total.converted);
    expect(r.total.acceptRate).toBeCloseTo(r.total.accepted / r.total.offered, 2);
    expect(r.trend).toHaveLength(26);
    expect(r.trend.reduce((s: number, w: any) => s + w.offered, 0)).toBeGreaterThan(2500);
  });

  it('성향별 — 데모만 보면 5대 미만 집단은 가린다(재식별 방지)', async () => {
    const demo = (await http().get('/api/biz/trials?catalogId=CAT-00019&source=DEMO&groupBy=region').expect(200)).body;
    expect(demo.total.offered).toBe(5);
    expect(demo.groups.every((g: any) => g.suppressed && g.acceptRate === null)).toBe(true);
    const syn = (await http().get('/api/biz/trials?catalogId=CAT-00019&source=SYNTHETIC&groupBy=drivingStyle').expect(200)).body;
    expect(syn.groups.map((g: any) => g.key).sort()).toEqual(['고속도로', '도심', '장거리', '혼합']);
    const rate = Object.fromEntries(syn.groups.map((g: any) => [g.key, g.acceptRate]));
    expect(rate['고속도로']).toBeGreaterThan(rate['도심']);
  });

  it('알 수 없는 차원은 400', async () => {
    const r = await http().get('/api/biz/trials?groupBy=name').expect(400);
    expect(r.body.error.code).toBe('VALIDATION');
  });
});

describe('시드 기준일 회귀 — 고정 날짜 체험권이 시간이 지나면 데모가 깨지던 문제', () => {
  it('8개월 뒤에 부팅해도 ego-01은 체험 중, lead-01은 제안 중이다', async () => {
    const { app, http } = await bootApp({ at: '2027-06-15T03:00:00.000Z' });
    try {
      const by = Object.fromEntries((await http().get('/api/entitlements').expect(200)).body.items.map((e: any) => [e.grantId, e.state]));
      expect(by).toMatchObject({ 'ENT-00001': 'ACTIVE', 'ENT-00002': 'ACTIVE', 'ENT-00003': 'OFFERED' });
      const d = await http().get('/api/activation/decide?vin=ego-01&flagKey=care_00022_param').expect(200);
      expect(d.body.result).toMatchObject({ value: true, reason: 'POLICY_MATCH' });
    } finally {
      await app.close();
    }
  });

  it('FF_SYNTHETIC=0이면 합성 모집단을 넣지 않는다', async () => {
    process.env.FF_SYNTHETIC = '0';
    const { app, http } = await bootApp({ at: AT });
    delete process.env.FF_SYNTHETIC;
    try {
      const r = (await http().get('/api/biz/trials').expect(200)).body;
      expect(r.counts).toEqual({ production: 0, demo: 5, synthetic: 0 });
    } finally {
      await app.close();
    }
  });
});

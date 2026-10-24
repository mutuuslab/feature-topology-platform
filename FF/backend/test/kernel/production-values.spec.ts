// 운영 값·고객 기준 값 — 출시 준비 RD-OPS-03. 예전에는 권한 출처(DEMO|SYNTHETIC)·Fleet 구분(DEMO|SAMPLE)이 데모 전용 열거값이라
// 고객 차량에 낸 권한을 적을 자리가 없었고(DEMO로 기록), 체험 만료 sweep이 DEMO만 보아 고객 체험권이 만료되지 않았다(회귀 시험 — 고치기 전에는 실패).
// 판매국·차종·트림은 데모 목록이 아니라 설치에 등록된 기준 값이어야 한다 — 데모 값은 시드(origin SEED)일 뿐이다.
// readiness: RD-OPS-03
process.env.FF_SCHEDULER = 'manual';
import { INestApplication } from '@nestjs/common';
import { asSourceFilter, FLEET_KINDS, GRANT_SOURCES, grantSourceOf, sourcesOf, trialSweepIncludes, VehicleSchema, EntitlementSchema } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TrialExpiryService } from '../../src/domains/d01-policy/entitlement/trial-expiry.service';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const VARIANT = actor('usr-variant', 'VARIANT_OWNER');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const FLEET_IF = actor('system:fleet-if06', 'SYSTEM');
const AT = '2026-10-12T01:00:00.000Z';
const kst = (ymd: string) => `${ymd}T01:00:00.000Z`;
/** 데모 KMH-NX4-0003과 같은 사양의 고객 차량 — CAT-00019의 지원 차량 */
const CUSTOMER = { vin: 'KMH-PRD-000001', label: '고객 차량 1', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', modelYear: '2026', upgVc: 'F111A114001', swVersion: '1.2.1' };

describe('운영 값 — 열거값(contracts)', () => {
  it('출처·Fleet에 운영 값(PRODUCTION)이 있고, 표준 값이 아닌 고객 차량 기본값으로 바뀌지 않는다', () => {
    expect(FLEET_KINDS).toContain('PRODUCTION');
    expect(GRANT_SOURCES).toContain('PRODUCTION');
    expect(VehicleSchema.parse({ ...CUSTOMER, fleet: 'PRODUCTION' }).fleet).toBe('PRODUCTION');
    expect(EntitlementSchema.shape.source.parse('PRODUCTION')).toBe('PRODUCTION');
    expect(grantSourceOf({ fleet: 'PRODUCTION' })).toBe('PRODUCTION');
    expect(grantSourceOf({ fleet: 'SAMPLE' })).toBe('SYNTHETIC');
    expect(grantSourceOf({ fleet: 'DEMO' })).toBe('DEMO');
    // 기본 목록(FLEET) = 등록 차량 — 운영과 시연, 합성 제외
    expect(sourcesOf(asSourceFilter(undefined))).toEqual(['PRODUCTION', 'DEMO']);
    expect(trialSweepIncludes('PRODUCTION', false)).toBe(true);
    expect(trialSweepIncludes('SYNTHETIC', false)).toBe(false);
  });
});

describe('고객 기준 값과 운영 차량 — API', () => {
  let app: INestApplication;
  let http: () => any;
  let sweep: TrialExpiryService;
  let clock: Clock;

  beforeAll(async () => {
    let get: <T>(t: any) => T;
    ({ app, http, get } = await bootApp({ at: AT }));
    sweep = get(TrialExpiryService);
    clock = get(Clock);
    clock.set(AT);
  });
  afterAll(() => app.close());

  it('데모 설치는 데모 기준 값이 시드(SEED)로 들어 있다 — 데모 차량이 쓰는 판매국·차종·트림 포함', async () => {
    const r = (await http().get('/api/reference-values').expect(200)).body;
    expect(r.kinds).toEqual(['COUNTRY', 'REGION', 'VEHICLE_MODEL', 'TRIM']);
    const codes = (kind: string) => r.items.filter((v: any) => v.kind === kind).map((v: any) => v.code);
    expect(codes('COUNTRY')).toEqual(expect.arrayContaining(['KR', 'US', 'EU']));
    expect(codes('VEHICLE_MODEL')).toContain('NX4 PE');
    expect(r.items.every((v: any) => v.origin === 'SEED' && v.status === 'ACTIVE')).toBe(true);
    expect((await http().get('/api/reference-values?kind=TRIM').expect(200)).body.items.every((v: any) => v.kind === 'TRIM' && v.parent)).toBe(true);
    await http().get('/api/reference-values?kind=MARKET').expect(400);
  });

  it('기준 값 등록 — 차량 사양 담당자만, 지역·트림은 부모가 먼저, 같은 값은 409', async () => {
    await http().post('/api/reference-values').set(OPERATOR).send({ kind: 'COUNTRY', code: 'JP', label: '일본' }).expect(403);
    await http().post('/api/reference-values').set(VARIANT).send({ kind: 'REGION', code: 'Kanto', label: '간토' }).expect(400);
    await http().post('/api/reference-values').set(VARIANT).send({ kind: 'TRIM', code: 'GT', label: 'GT', parent: 'IONIQ 9' }).expect(400);
    const jp = (await http().post('/api/reference-values').set(VARIANT).send({ kind: 'COUNTRY', code: 'JP', label: '일본' }).expect(201)).body;
    expect(jp).toMatchObject({ kind: 'COUNTRY', code: 'JP', origin: 'CUSTOMER', status: 'ACTIVE', createdBy: 'usr-variant', parent: null });
    await http().post('/api/reference-values').set(VARIANT).send({ kind: 'REGION', code: 'Kanto', label: '간토', parent: 'JP' }).expect(201);
    await http().post('/api/reference-values').set(VARIANT).send({ kind: 'COUNTRY', code: 'JP', label: '일본' }).expect(409);
    const audit = (await http().get('/api/audit?target=COUNTRY:JP').expect(200)).body.items;
    expect(audit.map((a: any) => a.action)).toContain('REFERENCE_VALUE_CREATE');
  });

  it('운영 차량 등록 — 등록되지 않은 판매국·차종·트림은 거부(데모 목록을 그대로 받지 않는다), 등록하면 Fleet PRODUCTION', async () => {
    const bad = await http().post('/api/fleet/vehicles').set(FLEET_IF).send({ ...CUSTOMER, vin: 'X-PRD-1', country: 'BR', vehicleModel: 'IONIQ 9', trim: 'GT' }).expect(400);
    expect(bad.body.error.details.problems).toHaveLength(3);
    await http().post('/api/fleet/vehicles').set(PRODUCT).send(CUSTOMER).expect(403);
    const v = (await http().post('/api/fleet/vehicles').set(FLEET_IF).send(CUSTOMER).expect(201)).body;
    expect(v).toMatchObject({ vin: CUSTOMER.vin, fleet: 'PRODUCTION', country: 'KR' });
    await http().post('/api/fleet/vehicles').set(FLEET_IF).send(CUSTOMER).expect(409);
    const list = (await http().get('/api/vehicles').expect(200)).body.items;
    expect(list.find((x: any) => x.vin === CUSTOMER.vin)).toMatchObject({ fleet: 'PRODUCTION' });
  });

  it('고객 차량에 낸 체험권은 PRODUCTION 출처로 기록되고, 기본 목록(등록 차량)에 나오며 DEMO만 고르면 빠진다', async () => {
    const r = (await http().post('/api/trials/offers').set(PRODUCT).send({ catalogId: 'CAT-00019', vins: [CUSTOMER.vin] }).expect(201)).body;
    expect(r.skipped).toEqual([]);
    expect(r.offered[0]).toMatchObject({ vin: CUSTOMER.vin, source: 'PRODUCTION', status: 'OFFERED' });
    const id = r.offered[0].grantId;
    const ids = async (q: string) => (await http().get(`/api/entitlements${q}`).expect(200)).body.items.map((g: any) => g.grantId);
    expect(await ids('')).toContain(id);
    expect(await ids('?source=PRODUCTION')).toEqual([id]);
    expect(await ids('?source=DEMO')).not.toContain(id);
    expect(await ids('?source=FLEET')).toEqual(expect.arrayContaining([id, 'ENT-00001']));
    const trials = (await http().get('/api/trials?catalogId=CAT-00019&source=FLEET').expect(200)).body.items.map((g: any) => g.grantId);
    expect(trials).toContain(id);
  });

  it('체험 만료 sweep이 고객 권한(PRODUCTION)도 고지·만료한다 — 회귀: DEMO만 보아 고객 체험권이 끝나지 않았다', async () => {
    const id = (await http().get('/api/entitlements?source=PRODUCTION').expect(200)).body.items[0].grantId;
    clock.set(kst('2026-10-13'));
    await http().post(`/api/trials/${id}/accept`).set(OPERATOR).send({}).expect(200);
    // 수락일(10-13)부터 30일 → 11-11까지. 3일 전 고지, 다음 날 만료
    clock.set(kst('2026-11-08'));
    expect(sweep.sweep().notices.map((n) => n.grantId)).toContain(id);
    clock.set(kst('2026-11-12'));
    expect(sweep.sweep().expired.map((e) => e.grantId)).toContain(id);
    const g = (await http().get(`/api/entitlements?vin=${CUSTOMER.vin}`).expect(200)).body.items.find((x: any) => x.grantId === id);
    expect(g).toMatchObject({ status: 'EXPIRED', source: 'PRODUCTION' });
  });

  it('기준 값 사용 중지 — 이미 등록된 차량은 그대로, 새 차량 등록은 거부', async () => {
    await http().post('/api/reference-values/COUNTRY/JP/retire').set(VARIANT).send({ reason: '일본 시장 철수' }).expect(200);
    await http().post('/api/reference-values/COUNTRY/JP/retire').set(VARIANT).send({ reason: '다시' }).expect(409);
    await http().post('/api/fleet/vehicles').set(FLEET_IF).send({ ...CUSTOMER, vin: 'JPN-PRD-1', country: 'JP' }).expect(400);
    const jp = (await http().get('/api/reference-values?kind=COUNTRY').expect(200)).body.items.find((v: any) => v.code === 'JP');
    expect(jp.status).toBe('RETIRED');
  });
});

import { describe, expect, it } from 'vitest';
import { EntitlementSchema, VehicleSchema, type VehicleProfile } from '@ff/contracts';
import { expandShowcaseFleet, showcaseVehicleCount } from '../../src/kernel/showcase';

const vehicle = VehicleSchema.parse({ vin: 'base-demo', label: '기준 시연', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', modelYear: '2026', upgVc: 'F111A114001', swVersion: '1.2.1', gleo: true, link: 'OFFLINE', quality: 'STALE' });
const profile = { vin: vehicle.vin, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', region: '영남', ageBand: '40대', drivingStyle: '혼합', adasUsage: '높음', source: 'DEMO' } as VehicleProfile;
const trial = EntitlementSchema.parse({ grantId: 'ENT-00001', vin: vehicle.vin, catalogId: 'CAT-00019', kind: '체험', validFrom: '2026-11-01', validTo: '2026-12-01', status: 'CONVERTED' });
const purchase = EntitlementSchema.parse({ ...trial, grantId: 'ENT-00002', kind: '구매', status: 'ACTIVE', fromTrial: trial.grantId });

describe('풍부한 전시용 가상 Fleet', () => {
  it('명시한 데모에서만 켜고 운영/빈 DB는 원본 수를 유지한다', () => {
    expect(showcaseVehicleCount({}, 12)).toBe(12);
    expect(showcaseVehicleCount({ FF_SHOWCASE: '1' }, 12)).toBe(480);
    expect(showcaseVehicleCount({ FF_SHOWCASE: '1', FF_SHOWCASE_VEHICLES: '240' }, 12)).toBe(240);
    expect(showcaseVehicleCount({ FF_SHOWCASE: '1', FF_ENV: 'production' }, 12)).toBe(12);
    expect(showcaseVehicleCount({ FF_SHOWCASE: '1', FF_SEED: 'none' }, 12)).toBe(12);
    for (const n of ['0', '1.5', '1201', 'bad']) expect(() => showcaseVehicleCount({ FF_SHOWCASE: '1', FF_SHOWCASE_VEHICLES: n }, 12)).toThrow();
  });
  it('원본·오프라인/문맥 품질을 유지하고 VIN·권한·체험 전환 참조를 격리한다', () => {
    const original = { fleet: [vehicle], profiles: [profile], grants: [trial, purchase] };
    const before = JSON.stringify(original);
    const result = expandShowcaseFleet(original, 480);
    expect(JSON.stringify(original)).toBe(before);
    expect(result.fleet).toHaveLength(480);
    expect(new Set(result.fleet.map((v) => v.vin)).size).toBe(480);
    expect(result.fleet[0]).toEqual(vehicle);
    const extra = result.fleet[1];
    expect(extra).toMatchObject({ fleet: 'DEMO', gleo: false, quality: 'STALE', link: 'OFFLINE' });
    const grants = result.grants.filter((g) => g.vin === extra.vin);
    expect(grants).toHaveLength(2);
    expect(grants.find((g) => g.kind === '구매')?.fromTrial).toBe(grants.find((g) => g.kind === '체험')?.grantId);
    for (const v of result.fleet) expect(VehicleSchema.safeParse(v).success).toBe(true);
    for (const g of result.grants) expect(EntitlementSchema.safeParse(g).success).toBe(true);
    expect(new Set(result.grants.map((g) => g.grantId)).size).toBe(result.grants.length);
    expect(expandShowcaseFleet(original, 480)).toEqual(result);
  });
});

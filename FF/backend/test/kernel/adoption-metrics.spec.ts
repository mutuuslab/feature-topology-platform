import { afterAll, expect, it } from 'vitest';
import { effectiveBasisPoints, flagAdoptionCounts, type Policy } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { Metrics } from '../../src/kernel/observability';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { bootApp } from '../helpers';

it('국가 대표점 집계는 원천 상태·Canary·미수신을 보존하고 VIN이나 실제 좌표를 노출하지 않는다', () => {
  const row = (vin: string, value: boolean, reason = 'TARGETING_MATCH') => ({ vin, link: 'ONLINE' as const, kills: [], flags: [{ flagKey: 'a', local: { value, reason }, drift: false }] });
  const runtime = [row('on', true), row('off', false), row('killed', false, 'KILL_SWITCH'), { ...row('pending', false), pending: ['a'] }, { ...row('offline', true), link: 'OFFLINE' as const }];
  const vehicles = runtime.map((r) => ({ vin: r.vin, country: 'KR', lat: 37.123456789, lon: 127.987654321 }));
  const counts = flagAdoptionCounts(runtime, vehicles, [{ flagKey: 'a', stageRatio: 0.25 }]);
  expect(Object.fromEntries(counts.map((r) => [r.state, r.vehicles]))).toEqual({ CANARY: 1, OFF: 1, DISABLED: 1, UNKNOWN: 2 });
  expect(counts.reduce((sum, r) => sum + r.vehicles, 0)).toBe(5);
  expect(counts.every((r) => r.lat === '36' && r.lon === '128')).toBe(true);
  expect(JSON.stringify(counts)).not.toMatch(/37\.123|127\.987|"vin"|offline|pending/);
  const unmapped=flagAdoptionCounts(runtime, vehicles.map((v) => ({ ...v, country: 'UNMAPPED' })), [{ flagKey: 'a', stageRatio: 1 }]);
  expect(unmapped.reduce((sum,r)=>sum+r.vehicles,0)).toBe(5);
  expect(unmapped.every((r)=>r.lat==='' && r.lon==='')).toBe(true);
});

let close: (() => Promise<void>) | undefined;
afterAll(() => close?.());
it('실제 metrics HTTP는 FF 지도와 같은 런타임 원천을 집계하고 반복 scrape에서 중복하지 않는다', async () => {
  const previousScheduler=process.env.FF_SCHEDULER;
  process.env.FF_SCHEDULER='manual';
  try {
    // Both HTTP scrapes observe the same controlled runtime, not a moving background simulator.
    const b = await bootApp({at:'2026-11-09T00:00:00Z'}); close = () => b.app.close();
    const db = b.get<Db>(DB);
    const runtime = await b.get(VehicleRuntimeService).fleetStatus();
    const vehicles = db.all<{ vin: string; doc: string }>('SELECT vin, doc FROM vehicle').map((v) => ({ vin: v.vin, country: JSON.parse(v.doc).country }));
    const policies = db.all<{ doc: string }>("SELECT doc FROM policy WHERE status='DEPLOYED'").map((r) => JSON.parse(r.doc) as Policy);
    const flags = [...new Map(policies.map((p) => [p.flagKey, { flagKey: p.flagKey, stageRatio: effectiveBasisPoints(p) / 10000 }])).values()];
    const expected = flagAdoptionCounts(runtime.items, vehicles, flags);
    expect(expected.length).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) {
      const response = await b.http().get('/api/health/metrics').expect(200);
      expect(response.text).toContain('ff_flag_adoption_vehicles{');
      const reg = b.get(Metrics).registry;
      for (const { vehicles: n, ...labels } of expected) expect(reg.value('ff_flag_adoption_vehicles', labels)).toBe(n);
      expect(reg.value('ff_flag_adoption_vehicles')).toBe(expected.reduce((n, r) => n + r.vehicles, 0));
    }
  } finally {if(previousScheduler===undefined)delete process.env.FF_SCHEDULER;else process.env.FF_SCHEDULER=previousScheduler;}
});

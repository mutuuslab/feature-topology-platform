import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';
let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine'), serial = 0;
const JOB = 'OTA-PUB-TEST', PUB = 'PUB-TEST', NOW = '2026-11-09T00:00:00.000Z';
const run = (name = 'otaJobReconcile', role = 'operator') => sim.simCall<any>(ROUTES.find(r => r.name === name)!, routeUrl(name, name === 'audit' ? {} : { jobId: JOB }), { role, params: { jobId: JOB }, body: name === 'audit' ? undefined : { reason: 'Recover missed OTA delivery notification' } });
const store = () => engine.__overlayForTest()!.data.killDelivery[PUB];
const observe = (vehicles: unknown[] = [{ vin: 'VIN-A', outcome: 'DELIVERED', at: NOW }], extra = {}) => {
  store().otaServerObservation = { source: 'LOCAL_SIMULATION', jobId: JOB, attempt: 1, observedAt: NOW, state: 'COMPLETED', vehicles, ...extra };
};
beforeEach(async () => {
  localStorage.clear(); vi.stubEnv('VITE_DATA_MODE', 'static');
  const sources = new Map<string, unknown>([
    [snapshotFile(routeUrl('auditChain')), { head: `ota-observation-${++serial}`, verified: 0 }],
    [snapshotFile(routeUrl('audit')), { items: [] }], [snapshotFile(routeUrl('events')), { items: [] }],
  ]);
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const match = [...sources].find(([k]) => String(u).endsWith(k));
    return new Response(JSON.stringify(match?.[1] ?? {}), { status: match ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  }));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine');
  await run('audit');
  engine.__overlayForTest()!.data.killDelivery = { [PUB]: { offline: [], readbacks: [], job: { jobId: JOB, attempts: 1, state: 'SUBMITTED', serverState: 'IN_PROGRESS', vehicles: [{ vin: 'VIN-A', outcome: 'DELIVERING', at: NOW }], counts: { DELIVERING: 1 } } } };
});
afterEach(() => { engine.__resetSimForTest(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });
it('rejects a missing server observation without fabricating delivery or application', async () => {
  await expect(run()).rejects.toMatchObject({ status: 422, code: 'GUARD_FAILED' });
  expect(store().job.vehicles[0].outcome).toBe('DELIVERING'); expect(store().readbacks).toEqual([]);
});
it.each([{ attempt: 2 }, { jobId: 'OTHER' }, { source: 'CLAIMED_SERVER' }, { observedAt: 'invalid' }])('rejects mismatched or malformed source %j', async extra => {
  observe(undefined, extra); await expect(run()).rejects.toMatchObject({ code: 'GUARD_FAILED' });
  expect(store().job.state).toBe('SUBMITTED'); expect(store().job.vehicles[0].outcome).toBe('DELIVERING');
});
it('uses only observed target facts, records provenance and is idempotent without producing vehicle results', async () => {
  store().job.vehicles.push({ vin: 'VIN-B', outcome: 'DELIVERING', at: NOW });
  observe([{ vin: 'VIN-A', outcome: 'DELIVERED', at: NOW }, { vin: 'OUTSIDE', outcome: 'DELIVERED', at: NOW }]);
  expect(await run()).toMatchObject({ filled: 1, source: 'LOCAL_SIMULATION', observedAt: NOW });
  expect(store().job.vehicles.map((v: any) => v.outcome)).toEqual(['DELIVERED', 'DELIVERING']);
  expect(store().readbacks).toEqual([]); expect(await run()).toMatchObject({ filled: 0 });
  expect((await run('audit')).items.some((a: any) => a.action === 'OTA_JOB_RECONCILE' && a.after.source === 'LOCAL_SIMULATION')).toBe(true);
});
it('preserves delivered vehicles and a closed cancelled job against late intermediate observations', async () => {
  store().job.state = 'CANCELLED'; store().job.vehicles[0].outcome = 'DELIVERED';
  observe([{ vin: 'VIN-A', outcome: 'DELIVERING', at: NOW }]);
  expect(await run()).toMatchObject({ state: 'CANCELLED', filled: 0 }); expect(store().job.vehicles[0].outcome).toBe('DELIVERED');
});
it('denies a viewer even if there is a valid observed receipt', async () => {
  observe(); await expect(run('otaJobReconcile', 'viewer')).rejects.toMatchObject({ status: 403 });
  expect(store().job.vehicles[0].outcome).toBe('DELIVERING');
});
it('executes a separate OTA observation task and retains an offline vehicle as NO_RESPONSE', async () => {
  store().job.vehicles.push({ vin: 'VIN-B', outcome: 'DELIVERING', at: NOW });
  store().offline = ['VIN-B'];
  const { scheduleOtaObservation } = await import('../api/sim/p9');
  // A harness command invokes the production scheduler with the real transactional engine context.
  engine.registerSimHandler('otaJobCancel', ctx => { scheduleOtaObservation(ctx, PUB); return {}; });
  const route = ROUTES.find(r => r.name === 'otaJobCancel')!;
  await sim.simCall(route, '/harness/ota-observation', { role: 'coordinator', body: { reason: 'Observe simulated transport' } });
  await waitFor(() => expect(store().otaServerObservation).toBeTruthy());
  expect(store().job.vehicles.map((v: any) => v.outcome)).toEqual(['DELIVERING', 'DELIVERING']);
  expect(await run()).toMatchObject({ filled: 2, source: 'LOCAL_SIMULATION' });
  expect(store().job.vehicles.map((v: any) => v.outcome)).toEqual(['DELIVERED', 'NO_RESPONSE']); expect(store().readbacks).toEqual([]);
});

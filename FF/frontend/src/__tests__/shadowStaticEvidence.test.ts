import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';

const bundled = JSON.parse(gunzipSync(readFileSync(join(__dirname, 'fixtures/sim-policy-ops.json.gz'))).toString('utf8'));
const fixture = (path: string) => structuredClone(bundled[path.replace(/^\//, '')]);
let extra: Record<string, unknown>;
let sim: typeof import('../api/sim');
let engine: typeof import('../api/sim/engine');
const run = (name: string, params: Record<string, string> = {}, body?: unknown, role = 'coordinator') => {
  const route = ROUTES.find(r => r.name === name)!;
  return sim.simCall<any>(route, routeUrl(name, params), {params, body, role});
};
function override(name: string, params: Record<string, string>, data: unknown) {
  extra['/' + snapshotFile(routeUrl(name, params))] = data;
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.useFakeTimers({toFake:['Date']});
  vi.setSystemTime(new Date('2026-10-12T01:00:00Z'));
  localStorage.clear();
  extra = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = decodeURIComponent(url);
    if (extra[path] instanceof Error) throw extra[path];
    if (path in extra) return new Response(JSON.stringify(extra[path]), {headers:{'Content-Type':'application/json'}});
    const data = fixture(path);
    return data !== undefined ? new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json'}}) : new Response('<!doctype html>', {headers:{'Content-Type':'text/html'}});
  }));
  sim = await import('../api/sim');
  engine = await import('../api/sim/engine');
});
afterEach(() => {
  engine.__resetSimForTest(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear();
});

it.each(['complete', 'no baseline', 'no vehicles', 'partial fleet', 'missing source'] as const)('static Shadow uses actual records: %s', async kind => {
  const p = {...fixture(snapshotFile(routeUrl('policyDetail', {id:'POL-00002'}))).policy, entitlementCatalogId:null, status:'DEPLOYED'};
  override('policyDetail', {id:p.policyId}, {policy:p});
  override('experiments', {}, {items:[]});
  // Keep only the explicit comparison policy so a stale snapshot cannot supply another baseline.
  override('listPolicies', {}, {items: kind === 'no baseline' ? [{...p,status:'DRAFT'}] : [p]});
  if (kind === 'no baseline') override('policyDetail', {id:p.policyId}, {policy:{...p,status:'DRAFT'}});
  if (kind === 'no vehicles') override('vehicles', {}, {items:[]});
  if (kind === 'partial fleet') override('vehicles', {}, {items:[{vin:'INVALID-VEHICLE'}]});
  if (kind === 'missing source') override('featureDetail', {id:p.featureId, ver:p.featureVersion}, new Error('source offline'));
  const e = await run('createExperiment', {}, {policyId:p.policyId,type:'SHADOW',hypothesis:'비교 근거가 없으면 채택할 수 없다',metric:'DECISION_AGREEMENT',treatmentBp:5000,minSamples:100}, 'author');
  await run('startExperiment', {id:e.experimentId}, {});
  vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));
  const r = (await run('experiment', {id:e.experimentId})).results;
  expect(r.source).toBe('SIMULATED');
  expect(r.enough).toBe(true);
  if (kind === 'complete') {
    expect(r.fleet).toMatchObject({deployedPolicyId:p.policyId, comparisonStatus:'AVAILABLE', agreement:1});
    expect(r.fleet.comparableVehicles).toBe(r.fleet.vehicles);
    expect(r.fleet.vehicles).toBeGreaterThan(0);
  } else {
    expect(r.verdict).toBe('INSUFFICIENT');
    expect(r.fleet.agreement).toBe(0);
    expect(r.fleet.comparisonStatus).toBe({'no baseline':'NO_BASELINE','no vehicles':'NO_VEHICLES','partial fleet':'PARTIAL','missing source':'SOURCE_UNAVAILABLE'}[kind]);
    await expect(run('concludeExperiment', {id:e.experimentId}, {decision:'ADOPT',reason:'검토 완료'})).rejects.toMatchObject({status:422, code:'GUARD_FAILED'});
    expect((await run('experiment', {id:e.experimentId})).status).toBe('RUNNING');
  }
});

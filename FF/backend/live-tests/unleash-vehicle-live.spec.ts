// Required full-verify integration test against the pinned, unmodified local PostgreSQL/Unleash/Edge runtime.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes, verify } from 'node:crypto';
import { canonicalJson, SignedUnleashCache, unleashDrift } from '@ff/contracts';
import { bootApp, killV2, restoreV2 } from '../test/helpers';
import { UnleashSyncService } from '../src/domains/d01-policy/policy-store/unleash-sync.service';
import { PolicyRepo } from '../src/domains/d01-policy/policy-repos';
import { UnleashGateway } from '../src/adapters/unleash/unleash.client';
import { UnleashEdgeClient } from '../src/adapters/unleash/edge.client';
import { HsmService } from '../src/domains/d06-qsec/pki-kms/hsm.service';
import { PkiService } from '../src/domains/d06-qsec/pki-kms/pki.service';
import { Clock } from '../src/kernel/clock';
import { signVehicleRequest, vehicleKeyFromRoot } from '../src/kernel/vehicle-auth-client';

describe('actual Unleash 8.3.1 + OSS Edge 20.6.0 vehicle integration', () => {
  const saved = { ...process.env }, root = randomBytes(32), vin = 'ego-01';
  let b: Awaited<ReturnType<typeof bootApp>>, sync: UnleashSyncService, policies: PolicyRepo, edge: UnleashEdgeClient;
  const path = `/vehicle/v1/${vin}/signed-flags`;
  beforeAll(async () => {
    const env = JSON.parse(readFileSync(process.env.FF_UNLEASH_CONNECTION ?? '../.unleash-runtime/connection.json', 'utf8'));
    Object.assign(process.env, env, { FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: root.toString('base64'), UNLEASH_AUTO_SYNC: '0', GLEO_MODE: 'internal' });
    delete process.env.FF_DB_URL;
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    sync = b.app.get(UnleashSyncService); policies = b.app.get(PolicyRepo); edge = b.app.get(UnleashEdgeClient);
  }, 60000);
  afterAll(async () => { await b?.app.close(); process.env = saved; });
  const deployed = () => policies.all().filter((p) => p.status === 'DEPLOYED');
  const waitForEdge = async () => {
    for (let i = 0; i < 60; i++) {
      const cache = await edge.features(); let ready = true;
      for (const p of deployed()) {
        const plan = await sync.plan(p), f = cache.features.find((x) => x.name === p.flagKey);
        if (!f || unleashDrift({ ...plan, tags: [] }, { ...f, tags: [] }).length) ready = false;
      }
      if (ready) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Real Edge cache did not converge to the FF source');
  };
  const request = () => b.http().post(path).set(signVehicleRequest({ vehicleKey: vehicleKeyFromRoot(root, 1, vin), vin, epoch: 1, method: 'POST', path, body: '{}', now: b.app.get(Clock).now().getTime() })).set('Content-Type', 'application/json').send('{}');
  const syncAll = async () => {
    for (const p of deployed()) { const r = await sync.sync({ id: 'live-check', role: 'OPERATOR', correlationId: 'live-check' }, p.policyId); expect(r.outcome, JSON.stringify(r.steps.at(-1))).toBe('SYNCED'); }
    await waitForEdge();
  };
  it('has the exact official server version and exports only signed FF deployed policies', async () => {
    const status = await sync.status(); expect(status).toMatchObject({ mode: 'live', state: 'OK', version: '8.3.1' });
    await syncAll();
    for (const p of deployed()) expect((await sync.view(p.policyId)).drift).toEqual([]);
  }, 60000);
  it('CMAC vehicle → real Edge evaluation → activate-purpose FF signature → independent public-key TTL cache', async () => {
    const r = await request().expect(200);
    const publicKey = b.app.get(PkiService).publicKey(r.body.signature.kid)!;
    expect(publicKey.purpose).toBe('activate');
    const cache = new SignedUnleashCache(vin, (canonical, s) => s.kid === r.body.signature.kid && verify(null, Buffer.from(canonical), publicKey.pem, Buffer.from(s.value, 'base64url')));
    expect(cache.accept(r.body, b.app.get(Clock).now().getTime()).accepted).toBe(true);
    expect(r.body.payload.flags.find((f: any) => f.flagKey === 'care_00022_param').value).toBe(true);
    expect(cache.resolve('care_00022_param', Date.parse(r.body.payload.expiresAt)).value).toBe(false);
  });
  it('manual real-server rollout drift blocks issuance before any HSM signature; explicit FF sync restores it', async () => {
    const u = b.app.get(UnleashGateway).client;
    const base = 'projects/default/features/care_00022_param/environments/development/strategies';
    const got = await u.admin<any>('GET', base), strategy = (Array.isArray(got.data) ? got.data : got.data?.strategies)[0];
    expect((await u.admin('PUT', `${base}/${strategy.id}`, { ...strategy, parameters: { ...strategy.parameters, rollout: '0' } })).state).toBe('OK');
    const signer = vi.spyOn(b.app.get(HsmService), 'signDetached');
    try { const r = await request().expect(422); expect(r.body.error.details.code).toBe('UNLEASH_DRIFT'); expect(signer).not.toHaveBeenCalled(); } finally { signer.mockRestore(); await syncAll(); }
  }, 60000);
  it('actual refused Edge connection does not issue a signature', async () => {
    const url = edge.url, signer = vi.spyOn(b.app.get(HsmService), 'signDetached');
    (edge as any).url = 'http://127.0.0.1:9';
    try { const r = await request().expect(422); expect(r.body.error.details.code).toBe('EDGE_UNAVAILABLE'); expect(signer).not.toHaveBeenCalled(); } finally { (edge as any).url = url; signer.mockRestore(); }
  });
  it('FF kill remains authoritative when actual Edge still evaluates enabled', async () => {
    const k = await killV2(b.http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: [vin], reason: 'Unleash live kill boundary', confirm: 'FEAT-00022' });
    try { const r = await request().expect(200); expect(r.body.payload.flags.find((f: any) => f.flagKey === 'care_00022_param')).toMatchObject({ value: false, reason: 'KILL_SWITCH' }); } finally { await restoreV2(b.http, k.killId, 'live verification complete'); }
  }, 60000);
});

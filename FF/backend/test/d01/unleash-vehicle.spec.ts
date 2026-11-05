import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { canonicalJson, SignedUnleashCache } from '@ff/contracts';
import { actor, bootApp } from '../helpers';
import { UnleashEdgeClient } from '../../src/adapters/unleash/edge.client';
import { UnleashSyncService } from '../../src/domains/d01-policy/policy-store/unleash-sync.service';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { KillRepo } from '../../src/domains/d03-safety/kill-switch/kill.repo';
import { signVehicleRequest, vehicleKeyFromRoot } from '../../src/kernel/vehicle-auth-client';
import { Clock } from '../../src/kernel/clock';
import { DomainError } from '../../src/kernel/errors';
import { PublicationRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { UnleashGateway } from '../../src/adapters/unleash/unleash.client';
import { ActivationService } from '../../src/domains/d01-policy/activation/activation.service';
import { DB, type Db } from '../../src/kernel/db';

// Boundary tests deliberately stub external transport. Actual pinned-server/Edge test is unleash-vehicle-live.spec.ts.
describe('vehicle Unleash gateway boundaries (unit transport)', () => {
  const root = randomBytes(32), vin = 'ego-01', path = `/vehicle/v1/${vin}/signed-flags`, body = '{}';
  let app: INestApplication, http: any, edge: UnleashEdgeClient, sync: UnleashSyncService, clock: Clock;
  const saved = { ...process.env };
  let configs: any[];
  let featureSpy: any, evalSpy: any, viewSpy: any;
  beforeAll(async () => {
    Object.assign(process.env, { UNLEASH_MODE: 'mock', UNLEASH_AUTO_SYNC: '0', GLEO_MODE: 'internal', FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: root.toString('base64') });
    delete process.env.FF_DB_URL;
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    edge = app.get(UnleashEdgeClient); sync = app.get(UnleashSyncService); clock = app.get(Clock);
    const policies = app.get(PolicyRepo).all().filter((p) => p.status === 'DEPLOYED');
    for (const p of policies) await sync.sync({ id: 'unit', role: 'OPERATOR', correlationId: 'unit' }, p.policyId);
    configs = await Promise.all(policies.map(async (p) => { const plan = await sync.plan(p); return { name: p.flagKey, enabled: plan.enabled, strategies: plan.strategies, dependencies: plan.dependencies.map((feature) => ({ feature })) }; }));
    const original = sync.view.bind(sync);
    viewSpy = vi.spyOn(sync, 'view').mockImplementation(async (id) => { const v = await original(id); return { ...v, status: { ...v.status, mode: 'live', version: '8.3.1' } }; });
    featureSpy = vi.spyOn(edge, 'features').mockImplementation(async () => ({ features: structuredClone(configs) }));
    evalSpy = vi.spyOn(edge, 'evaluate').mockResolvedValue({ toggles: configs.map((f) => ({ name: f.name, enabled: true })) });
  });
  afterAll(async () => { vi.restoreAllMocks(); await app?.close(); process.env = saved; });
  const request = (targetPath = path, claimed = vin, value: unknown = {}) => {
    const text = JSON.stringify(value);
    return http().post(targetPath).set(signVehicleRequest({ vehicleKey: vehicleKeyFromRoot(root, 1, claimed), vin: claimed, epoch: 1, method: 'POST', path: targetPath, body: text, now: clock.now().getTime() })).set('Content-Type', 'application/json').send(text);
  };
  it('requires real vehicle authentication and self-VIN before calling Edge', async () => {
    await http().post(path).set('X-Vehicle-Id', vin).send({}).expect(401);
    const before = evalSpy.mock.calls.length;
    await request('/vehicle/v1/KMH-NX4-0002/signed-flags').expect(403);
    await request(path, vin, { context: { targetingKey: 'KMH-NX4-0002' } }).expect(403);
    expect(evalSpy.mock.calls.length).toBe(before);
  });
  it('signs VIN/TTL/policy revisions with activate-purpose HSM and uses only trusted Fleet context', async () => {
    const r = await request(path, vin, { context: { targetingKey: vin, country: 'ATTACKER', trialSessionValid: 'true' } }).expect(200);
    const hsm = app.get(HsmService);
    expect(hsm.verifyDetached('activate', canonicalJson(r.body.payload), r.body.signature).valid).toBe(true);
    expect(hsm.verifyDetached('policy', canonicalJson(r.body.payload), r.body.signature).valid).toBe(false);
    expect(r.body.payload).toMatchObject({ vin, source: 'UNLEASH_EDGE', issuedAt: clock.iso() });
    expect(Date.parse(r.body.payload.expiresAt) - Date.parse(r.body.payload.issuedAt)).toBe(60000);
    expect(evalSpy.mock.calls.at(-1)[0].properties.country).toBe('KR');
    expect(r.headers['cache-control']).toBe('no-store');
    const cache = new SignedUnleashCache(vin, (c, s) => hsm.verifyDetached('activate', c, s).valid);
    expect(cache.accept(r.body, clock.now().getTime()).accepted).toBe(true);
    expect(cache.resolve(r.body.payload.flags[0].flagKey, Date.parse(r.body.payload.expiresAt)).value).toBe(false);
  });
  it('dead Edge never invokes the HSM signing operation or returns a snapshot', async () => {
    const signer = vi.spyOn(app.get(HsmService), 'signDetached');
    evalSpy.mockRejectedValueOnce(new DomainError('GUARD_FAILED', 'Edge unavailable', { code: 'EDGE_UNAVAILABLE' }));
    const r = await request().expect(422);
    expect(r.body.signature).toBeUndefined(); expect(signer).not.toHaveBeenCalled(); signer.mockRestore();
  });
  it('a manually changed server strategy fails closed before signing', async () => {
    viewSpy.mockResolvedValueOnce({ status: { mode: 'live' }, plan: { ready: true }, drift: ['manual change'] });
    const signer = vi.spyOn(app.get(HsmService), 'signDetached');
    expect((await request().expect(422)).body.error.details.code).toBe('UNLEASH_DRIFT');
    expect(signer).not.toHaveBeenCalled(); signer.mockRestore();
  });
  it('stale or changed Edge cache fails closed even when Admin matches FF', async () => {
    const bad = structuredClone(configs); bad[0].strategies[0].disabled = true;
    featureSpy.mockResolvedValueOnce({ features: bad });
    expect((await request().expect(422)).body.error.details.code).toBe('EDGE_DRIFT');
  });
  it('a live local kill always overrides an Edge enabled result', async () => {
    const kill = vi.spyOn(app.get(KillRepo), 'killed').mockReturnValue(true);
    const r = await request().expect(200);
    expect(r.body.payload.flags.every((f: any) => !f.value && f.reason === 'KILL_SWITCH')).toBe(true); kill.mockRestore();
  });
  it.each(['retired', 'replaced'] as const)('never signs an earlier policy %s while awaiting the final flag', async (change) => {
    const repo = app.get(PolicyRepo), db = app.get<Db>(DB);
    const captured = repo.all().filter((p) => p.status === 'DEPLOYED').sort((a, b) => a.flagKey < b.flagKey ? -1 : a.flagKey > b.flagKey ? 1 : 0);
    expect(captured.length).toBeGreaterThan(1);
    const first = captured[0], last = captured.at(-1)!;
    const activation = app.get(ActivationService), decide = activation.decide.bind(activation);
    const fetchFeatures = featureSpy.getMockImplementation();
    let edgeReads = 0, finalEvaluation = false, changed = false;
    let replacement: typeof first | null = null;
    const before = db.get<{ value: number }>('SELECT value FROM vehicle_unleash_sequence WHERE vin = ?', vin)?.value ?? 0;
    featureSpy.mockImplementation(async () => { const value = await fetchFeatures(); if (++edgeReads === 2) finalEvaluation = true; return value; });
    const evaluating = vi.spyOn(activation, 'decide').mockImplementation(async (targetVin, flagKey) => {
      const value = await decide(targetVin, flagKey);
      if (finalEvaluation && flagKey === last.flagKey && !changed) {
        changed = true;
        // The first flag has passed its per-policy check. A concurrent commit changes it before the last await returns.
        db.tx(() => {
          repo.update({ ...first, status: 'RETIRED' });
          if (change === 'replaced') {
            replacement = { ...first, policyId: repo.nextId(), revision: first.revision + 1, enabled: false };
            repo.insert(replacement);
          }
        });
      }
      return value;
    });
    const signer = vi.spyOn(app.get(HsmService), 'signDetached');
    try {
      const response = await request();
      expect(changed).toBe(true);
      expect(response.status).toBe(412);
      expect(response.body.error.details.code).toBe('POLICY_CHANGED');
      expect(signer).not.toHaveBeenCalled();
      expect(db.get<{ value: number }>('SELECT value FROM vehicle_unleash_sequence WHERE vin = ?', vin)?.value ?? 0).toBe(before);
    } finally {
      signer.mockRestore(); evaluating.mockRestore(); featureSpy.mockImplementation(fetchFeatures);
      db.tx(() => { if (replacement) repo.update({ ...replacement, status: 'RETIRED' }); repo.update(first); });
    }
  });
  it('a DEPLOYED row without a valid matching FF publication cannot sync or issue a vehicle signature', async () => {
    const repo = app.get(PublicationRepo), policy = app.get(PolicyRepo).deployed('care_00022_param')!;
    const originals = repo.list({ kind: 'POLICY' }).filter((p) => p.payload.policy?.policyId === policy.policyId);
    expect(originals.length).toBeGreaterThan(0);
    for (const p of originals) { const bad = structuredClone(p); bad.signature.signature = (bad.signature.signature[0] === 'A' ? 'B' : 'A') + bad.signature.signature.slice(1); repo.update(bad); }
    const signer = vi.spyOn(app.get(HsmService), 'signDetached'), admin = vi.spyOn(app.get(UnleashGateway).client, 'admin');
    try {
      const result = await sync.sync({ id: 'unsigned-check', role: 'OPERATOR', correlationId: 'unsigned-check' }, policy.policyId);
      expect(result.outcome).toBe('BLOCKED'); expect(result.steps).toEqual([]); expect(admin).not.toHaveBeenCalled();
      expect((await request().expect(422)).body.error.details.code).toBe('UNLEASH_DRIFT'); expect(signer).not.toHaveBeenCalled();
    } finally { signer.mockRestore(); admin.mockRestore(); for (const p of originals) repo.update(p); }
  });
});

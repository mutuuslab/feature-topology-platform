import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { Logger } from '@nestjs/common';
import type { Policy } from '@ff/contracts';
import { UnleashAutoSyncService } from '../../src/domains/d01-policy/policy-store/unleash-auto-sync.service';
import type { PlatformEvent } from '../../src/kernel/event.service';
import { UnleashSyncService } from '../../src/domains/d01-policy/policy-store/unleash-sync.service';
import { MockUnleash, UnleashGateway } from '../../src/adapters/unleash/unleash.client';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};
const policy = (policyId: string, flagKey: string, status = 'DEPLOYED') => ({ policyId, flagKey, status, revision: 1 } as Policy);
// Public queue barrier, including work appended during an awaited sync.
const settled = (service: UnleashAutoSyncService) => service.whenIdle();
function fixture(initial: Policy[]) {
  const bus = new Subject<PlatformEvent>();
  const rows = new Map(initial.map((p) => [p.policyId, p]));
  const dependencies: { type: string; sourceFeatureId: string; sourceVersion: string; targetFeatureId: string }[] = [];
  const publications = new Map<string, { kind: string; payload: { policy: Policy } }>();
  let seq = 0;
  const emit = (type: string, aggregate: string, payload: unknown = {}) => bus.next({ seq: ++seq, id: String(seq), type, aggregate, payload, at: '2026-11-05T00:00:00Z', componentId: null, correlationId: 'test' });
  const sync = vi.fn(async (_actor, _id: string) => ({ outcome: 'SYNCED' }));
  const publishPolicy = vi.fn((p: Policy) => {
    const id = `PUB-${publications.size + 1}`;
    publications.set(id, { kind: 'POLICY', payload: { policy: p } });
    emit('publication.signed', id, { kind: 'POLICY' });
  });
  const service = new UnleashAutoSyncService(
    { stream: () => bus.asObservable() } as any,
    { all: () => [...rows.values()], get: (id: string) => rows.get(id), deployed: (key: string) => [...rows.values()].find((p) => p.flagKey === key && p.status === 'DEPLOYED'), forFeature: (id: string, version: string) => [...rows.values()].filter((p) => p.featureId === id && p.featureVersion === version) } as any,
    { sync } as any, { publishPolicy } as any, { tx: (f: () => unknown) => f() } as any,
    { get: (id: string) => publications.get(id) } as any,
    { incoming: (id: string) => dependencies.filter((e) => e.targetFeatureId === id) } as any,
  );
  return { service, rows, publications, dependencies, emit, sync, publishPolicy };
}

describe('live Unleash replication queue', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const enable = () => { vi.stubEnv('UNLEASH_MODE', 'live'); vi.stubEnv('UNLEASH_AUTO_SYNC', '1'); };

  it('serializes bootstrap and events instead of starting two Admin writers', async () => {
    enable();
    const f = fixture([policy('P1', 'first')]);
    const gate = deferred();
    let active = 0, maximum = 0;
    f.sync.mockImplementation(async () => { maximum = Math.max(maximum, ++active); await gate.promise; active--; return { outcome: 'SYNCED' }; });
    const boot = f.service.onApplicationBootstrap();
    await vi.waitFor(() => expect(f.sync).toHaveBeenCalledTimes(1));
    f.rows.set('P2', policy('P2', 'second'));
    f.emit('policy.deployed', 'P2', { flagKey: 'second' });
    await Promise.resolve(); await Promise.resolve();
    const during = maximum;
    gate.resolve(); await boot; await settled(f.service);
    expect(during).toBe(1);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P1', 'P2']);
    await f.service.onModuleDestroy();
  });

  it('coalesces a burst by flag and reads the deployed policy at dequeue time', async () => {
    enable();
    const f = fixture([policy('P1', 'first'), policy('OLD', 'replace')]);
    const gate = deferred();
    f.sync.mockImplementationOnce(async () => { await gate.promise; return { outcome: 'SYNCED' }; });
    const boot = f.service.onApplicationBootstrap();
    await vi.waitFor(() => expect(f.sync).toHaveBeenCalledTimes(1));
    f.rows.set('OLD', policy('OLD', 'replace', 'RETIRED'));
    f.rows.set('NEW', policy('NEW', 'replace'));
    for (let i = 0; i < 40; i++) f.emit('policy.deployed', 'NEW', { flagKey: 'replace' });
    f.rows.set('P3', policy('P3', 'third'));
    f.emit('policy.deployed', 'P3', { flagKey: 'third' });
    gate.resolve(); await boot; await settled(f.service);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P1', 'NEW', 'P3']);
    await f.service.onModuleDestroy();
  });

  it('isolates an unexpected failure and permits a later FF event to retry that flag', async () => {
    enable();
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const f = fixture([policy('P1', 'first'), policy('P2', 'second')]);
    f.sync.mockRejectedValueOnce(new Error('unexpected adapter failure'));
    await expect(f.service.onApplicationBootstrap()).resolves.toBeUndefined();
    f.emit('policy.deployed', 'P1', { flagKey: 'first' });
    await settled(f.service);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P1', 'P2', 'P1']);
    expect(logged).toHaveBeenCalled();
    await f.service.onModuleDestroy();
  });

  it('signs only the current rollout policy, then replicates once without a publication feedback loop', async () => {
    enable();
    const f = fixture([policy('P1', 'first')]);
    await f.service.onApplicationBootstrap(); f.sync.mockClear();
    f.emit('rollout.staged', 'P1', { flagKey: 'first' });
    await settled(f.service);
    expect(f.publishPolicy).toHaveBeenCalledTimes(1);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P1']);
    f.publications.set('KILL-PUB', { kind: 'KILL', payload: { policy: policy('P1', 'first') } });
    f.emit('publication.signed', 'KILL-PUB', { kind: 'KILL' });
    await settled(f.service);
    expect(f.sync).toHaveBeenCalledTimes(1);
    await f.service.onModuleDestroy();
  });

  it('resolves a signed publication to its flag and ignores events after shutdown', async () => {
    enable();
    const f = fixture([policy('P1', 'first'), policy('P2', 'second')]);
    await f.service.onApplicationBootstrap(); f.sync.mockClear();
    f.publications.set('PUB-2', { kind: 'POLICY', payload: { policy: policy('P2', 'second') } });
    f.emit('publication.signed', 'PUB-2', { kind: 'POLICY' });
    await settled(f.service);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P2']);
    await f.service.onModuleDestroy();
    f.emit('policy.deployed', 'P1', { flagKey: 'first' }); await settled(f.service);
    expect(f.sync).toHaveBeenCalledTimes(1);
  });

  it('refreshes deployed REQUIRES dependents when a new target flag is deployed', async () => {
    enable();
    const dependent = { ...policy('P1', 'dependent'), featureId: 'F1', featureVersion: '1.0.0' };
    const f = fixture([dependent, policy('P2', 'unrelated')]);
    f.dependencies.push({ type: 'REQUIRES', sourceFeatureId: 'F1', sourceVersion: '1.0.0', targetFeatureId: 'F3' });
    await f.service.onApplicationBootstrap(); f.sync.mockClear();
    f.rows.set('P3', { ...policy('P3', 'new-target'), featureId: 'F3' });
    f.emit('policy.deployed', 'P3', { flagKey: 'new-target' });
    await settled(f.service);
    expect(f.sync.mock.calls.map((c) => c[1])).toEqual(['P3', 'P1']);
    await f.service.onModuleDestroy();
  });

  it('does not retry a FAILED sidecar forever or manufacture a success while idle', async () => {
    enable();
    const f = fixture([policy('P1', 'first')]);
    f.sync.mockResolvedValue({ outcome: 'FAILED' });
    await f.service.onApplicationBootstrap();
    await f.service.whenIdle();
    expect(f.sync).toHaveBeenCalledTimes(1);
    expect(await f.sync.mock.results[0].value).toEqual({ outcome: 'FAILED' });
    await f.service.onModuleDestroy();
  });

  it('drains real bootstrap and later DemoActivity deployments into the stateful Admin replica', async () => {
    for (const [key, value] of Object.entries({ FF_DB: ':memory:', FF_SEED: 'v0.81', FF_ENV: 'demo', FF_DEMO_ACTIVITY: '1', FF_COST_DEMO: 'off', FF_SHOWCASE: '0', FF_SYNTHETIC: '0', FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', FF_CLOCK_AT: '2026-10-20T01:00:00.000Z', FF_BOOT_PUBLISH: '1' })) vi.stubEnv(key, value);
    enable();
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../src/app.module');
    const { DemoActivitySeeder } = await import('../../src/demo-activity/demo-activity.seeder');
    const { Scheduler } = await import('../../src/kernel/scheduler');
    const { Clock } = await import('../../src/kernel/clock');
    const replica = new MockUnleash();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(UnleashGateway).useValue({ client: replica }).compile();
    const app = mod.createNestApplication({ logger: false });
    const attempted: string[] = [];
    const sync = app.get(UnleashSyncService), policies = app.get(PolicyRepo);
    const original = sync.sync.bind(sync);
    let active = 0, maximum = 0;
    vi.spyOn(sync, 'sync').mockImplementation(async (actor, id) => {
      attempted.push(`${id}:${policies.get(id)?.status}`);
      maximum = Math.max(maximum, ++active);
      try { return await original(actor, id); } finally { active--; }
    });
    try {
      await app.init();
      const seeder = app.get(DemoActivitySeeder), clock = app.get(Clock), scheduler = app.get(Scheduler);
      expect(Object.entries(seeder.lastRun!).filter(([, result]) => !result.ok)).toEqual([]);
      let continued = false;
      void seeder.continuation!.then(() => { continued = true; });
      for (let i = 0; i < 12 && !continued; i++) {
        scheduler.advanceTo(clock.now().getTime() + 12_000);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(await seeder.continuation).toMatch(/REQUESTED/);
      const auto = app.get(UnleashAutoSyncService);
      await auto.whenIdle();
      const deployed = policies.all().filter((p) => p.status === 'DEPLOYED');
      // 커널 시드 3 + 데모 활동 2 + 시연 주인공 1(adas_00004_assist, 전시 빈 화면 채우기 — 수동 시계에서도 시드, 2026-11-06)
      expect(deployed).toHaveLength(6);
      expect(deployed.map((p) => p.flagKey)).toContain('adas_00004_assist');
      expect(deployed.map((p) => p.flagKey)).toContain('ivi_00027_banner');
      expect(deployed.map((p) => p.flagKey)).toContain('ivi_00027_detail');
      for (const p of deployed) {
        const view = await sync.view(p.policyId);
        expect(view.plan.ready, `${p.policyId} signed policy`).toBe(true);
        expect(view.drift, `${p.policyId} replica`).toEqual([]);
        expect(view.lastSync?.response).toMatchObject({ outcome: 'SYNCED' });
      }
      expect(maximum).toBe(1);
      expect(attempted.filter((p) => !p.endsWith(':DEPLOYED'))).toEqual([]);
      // No all-policy scan per publication/deployment: unrelated seeded flags sync only at boot.
      for (const id of ['POL-00001', 'POL-00002', 'POL-00003']) expect(attempted.filter((p) => p.startsWith(`${id}:`))).toHaveLength(1);
    } finally { await app.close(); }
  }, 30_000);
});

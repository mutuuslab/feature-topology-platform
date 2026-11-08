import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';
let engine: typeof import('../api/sim/engine'), store: typeof import('../api/sim/store'), run: (name: string, role?: string) => Promise<any>, version = 0;
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); vi.stubEnv('VITE_DATA_MODE', 'static');
  const head = 'preflight-' + ++version;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url), data = path.endsWith(snapshotFile(routeUrl('auditChain'))) ? { head, verified: 0 } : { items: [] };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }));
  engine = await import('../api/sim/engine'); store = await import('../api/sim/store'); engine.setSimHandlerLoader(async () => {});
  run = (name, role = 'author') => engine.simCall(ROUTES.find((r) => r.name === name)!, routeUrl(name), { role, body: {} });
});
afterEach(() => { engine.__resetSimForTest(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('only explicit expiry GET hooks mutate; nested reads do not recurse; reload never repeats audit/event', async () => {
  let calls = 0;
  const saves = vi.spyOn(store, 'saveOverlay');
  engine.registerSimExpiryPreflight(['listPolicies'], async (ctx) => {
    calls++; await ctx.read('listPolicies');
    if (ctx.get('gx', 'closed')) return;
    ctx.put('gx', 'closed', { at: ctx.iso() }); ctx.audit({ action: 'EXCEPTION_EXPIRE', target: 'test', reason: 'expired' }); ctx.emit('exception.reverted', 'test', {});
  });
  await run('listFeatures'); expect(calls).toBe(0); expect(engine.__overlayForTest()!.audit).toHaveLength(0);
  await run('listPolicies'); expect(calls).toBe(1); expect(engine.__overlayForTest()!.audit).toHaveLength(1); expect(engine.__overlayForTest()!.events).toHaveLength(1);
  const writes = saves.mock.calls.length;
  engine.__resetSimForTest(); await run('listPolicies'); expect(calls).toBe(2); expect(engine.__overlayForTest()!.audit).toHaveLength(1); expect(engine.__overlayForTest()!.events).toHaveLength(1); expect(saves.mock.calls).toHaveLength(writes);
});
it('serial expiry reads wait for preceding writes and see their committed value', async () => {
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>((r) => enter = r), held = new Promise<void>((r) => finish = r);
  engine.registerSimHandler('createPolicy', async (ctx) => { enter(); await held; ctx.put('policy', 'one', { completed: true }); return {}; });
  engine.registerSimExpiryPreflight(['listPolicies'], async (ctx) => { expect(ctx.get('policy', 'one')).toEqual({ completed: true }); });
  const write = run('createPolicy'); await entered; let done = false;
  const read = run('listPolicies').then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
  finish(); await write; await read; expect(done).toBe(true);
});

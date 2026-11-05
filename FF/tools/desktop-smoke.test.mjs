// 패키지에 들어가는 Node·자산으로 실제 HTTP와 재시작 후 DB를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { verify } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = process.env.FF_DESKTOP_RESOURCES || join(root, 'src-tauri', 'resources');
const runtime = join(resources, 'runtime');

async function start(dir) {
  const child = spawn(join(runtime, 'node.exe'), ['--disable-warning=ExperimentalWarning', join(runtime, 'tools', 'unleash', 'runtime.mjs')], {
    cwd: runtime,
    env: { ...process.env, FF_DESKTOP: '1', FF_WEB_DIR: join(resources, 'ui'), FF_RUNTIME_DATA: join(dir, 'runtime'), FF_RUNTIME_ASSETS: join(runtime, 'sidecars'), FF_EVIDENCE_DIR: join(dir, 'evidence'), PORT: '0', FF_SEED: 'v0.81', FF_DATASET: '', FF_DEMO_ACTIVITY: '1', GLEO_MODE: 'off', UNLEASH_MODE: 'live', IF_MODE_01: 'mock', IF_MODE_13: 'mock', IF_MODE_14: 'mock' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  const port = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend timed out: ${errors}`)), 180_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`backend exited ${code}: ${errors}`)); });
    lines.on('line', (line) => {
      const match = /^FF_DESKTOP_READY:(\d+)$/.exec(line);
      if (match) { clearTimeout(timer); accept(Number(match[1])); }
    });
  }).catch(async (error) => { await stop(child); throw error; });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.stdin.write('stop\n');
  const stopped = await Promise.race([done.then(() => true), new Promise((r) => { const t = setTimeout(() => r(false), 35000); t.unref(); })]);
  if (!stopped) { child.kill(); throw new Error('Desktop supervisor did not cleanly stop its sidecars'); }
  assert.equal(child.exitCode, 0, 'Desktop supervisor reported a cleanup failure');
}

async function waitForReplica(get) {
  const deadline = Date.now() + 30_000;
  let remaining = [];
  do {
    const policiesResponse = await get('/api/policies?status=DEPLOYED');
    assert.equal(policiesResponse.status, 200);
    const policies = (await policiesResponse.json()).items;
    assert.ok(policies.length > 0, 'Integrated demo has no deployed policies');
    remaining = [];
    const views = [];
    for (const policy of policies) {
      const response = await get(`/api/policies/${policy.policyId}/unleash`);
      assert.equal(response.status, 200);
      views.push({ policyId: policy.policyId, view: await response.json() });
    }
    const latestResponse = await get('/api/policies?status=DEPLOYED');
    assert.equal(latestResponse.status, 200);
    const latest = (await latestResponse.json()).items;
    if (JSON.stringify(policies) !== JSON.stringify(latest)) {
      remaining = [{ reason: 'The deployment set changed during replica verification' }];
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    for (const { policyId, view } of views) {
      assert.equal(view.status.mode, 'live');
      assert.equal(view.plan.ready, true, `${policyId}: ${JSON.stringify(view.plan.blockers)}`);
      assert.equal(view.serverError, null, `${policyId}: upstream verification failed`);
      assert.ok(Array.isArray(view.drift));
      if (view.drift.length) remaining.push({ policyId, drift: view.drift });
    }
    if (!remaining.length) return;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < deadline);
  assert.deepEqual(remaining, [], 'Automatic replication did not converge to the actual latest FF deployment set');
}

async function waitForDemoContinuation(local, require) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: local.FF_DB_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const deadline = Date.now() + 30_000;
    do {
      const row = (await client.query("SELECT value FROM meta WHERE key = 'seed-activity'")).rows[0];
      const state = row ? JSON.parse(row.value) : null;
      const note = state?.steps?.rollback ?? state?.steps?.policies;
      if (state?.state !== 'RUNNING' && typeof note === 'string' && note.includes('REQUESTED')) {
        assert.ok(!note.includes('실패'), 'Integrated demo continuation failed');
        return;
      }
      if (typeof state?.steps?.rollback === 'string' && state.steps.rollback.startsWith('실패')) assert.fail('Integrated demo continuation failed');
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
    assert.fail('Integrated demo did not finish its actual rollback-request continuation');
  } finally { await client.end(); }
}

test('패키지 서버: Native PG·Unleash·Edge·차량 서명·UI·출처 제한·재시작 후 데이터', { timeout: 420_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ff-desktop-test-'));
  let server;
  let completed = false;
  try {
    server = await start(dir);
    const get = (path, options) => fetch(server.base + path, options);
    assert.equal((await get('/api/health')).status, 200);
    const unleash = await (await get('/api/unleash/status')).json();
    assert.equal(unleash.mode, 'live'); assert.equal(unleash.version, '8.3.1'); assert.equal(unleash.state, 'OK');
    // FF health and replica readiness differ while the integrated demo publishes its IVI policies.
    // Require actual signed FF plans and matching Admin definitions; never accept a signing error as success.
    await access(join(runtime, 'data/source/feature_db_v1.3.xlsx'));
    const local = JSON.parse(await readFile(join(dir, 'runtime/connection.json'), 'utf8'));
    const require = createRequire(join(runtime, 'package.json'));
    await waitForDemoContinuation(local, require);
    await waitForReplica(get);
    if (process.env.FF_SHOWCASE === '1') {
      const features = await (await get('/api/features')).json();
      const vehicles = await (await get('/api/vehicles')).json();
      assert.equal(features.total, 184);
      assert.equal(vehicles.items.length, Number(process.env.FF_SHOWCASE_VEHICLES ?? 480));
      for (const [path, count, role] of [
        ['/api/dependencies', 59], ['/api/change-records', 2], ['/api/rollback-plans', 2],
        ['/api/sync/runs', 7], ['/api/privacy/requests', 2, 'SECURITY_OFFICER'], ['/api/cost/projects', 24, 'COST_ESTIMATOR'],
      ]) {
        const response = await get(path, role ? { headers: { 'x-actor-id': 'usr-desktop-showcase', 'x-actor-role': role } } : undefined);
        assert.equal(response.status, 200, path);
        assert.equal((await response.json()).items.length, count, path);
      }
    }
    const { signVehicleRequest, vehicleKeyFromRoot } = require(join(runtime, 'backend/dist/kernel/vehicle-auth-client.js'));
    const { SignedUnleashCache } = require(join(runtime, 'contracts/dist/index.js'));
    const vin = 'ego-01', path = `/vehicle/v1/${vin}/signed-flags`;
    // Edge polls the new FF definitions; a short initial drift is a retryable closed gate.
    let signed;
    for (let i = 0; i < 30; i++) {
      const headers = signVehicleRequest({ vin, epoch: 1, vehicleKey: vehicleKeyFromRoot(Buffer.from(local.FF_HSM_VEHICLE_ROOT, 'base64'), 1, vin), method: 'POST', path, body: '{}' });
      const response = await get(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
      if (response.ok) { signed = await response.json(); break; }
      const error = await response.json(); assert.equal(error.error?.details?.code, 'EDGE_DRIFT'); await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(signed);
    const key = (await (await get('/api/pki/keys')).json()).items.find((k) => k.keyId === signed.signature.kid);
    assert.equal(key.purpose, 'activate');
    const cache = new SignedUnleashCache(vin, (canonical, signature) => signature.kid === key.keyId && verify(null, Buffer.from(canonical), key.publicKeyPem, Buffer.from(signature.value, 'base64url')));
    assert.ok(cache.accept(signed, Date.now()).accepted);
    assert.equal(cache.resolve(signed.payload.flags[0].flagKey, Date.parse(signed.payload.expiresAt)).value, false);
    assert.match(await (await get('/features/FEAT-00022/1.0.0', { headers: { Accept: 'text/html' } })).text(), /<div id="root">/);
    assert.equal((await get('/api/not-real', { headers: { Accept: 'text/html' } })).status, 404);
    assert.equal((await get('/assets/not-real.js')).status, 404);
    assert.equal((await get('/api/health', { headers: { Origin: 'https://other.example' } })).status, 403);
    const wrongHost = await new Promise((resolveStatus, reject) => {
      const req = request(`${server.base}/api/health`, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolveStatus(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(wrongHost, 403);
    // 등록은 Feature DB 대표 연결이 필수 — 패키지 런타임에 이전본(data/reference)이 없으면 기준 행을 못 찾아 여기서 실패한다(2026-11-04 회귀)
    const created = await get('/api/features', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': 'kim.author', 'x-actor-role': 'FEATURE_AUTHOR', 'idempotency-key': 'desktop-smoke-create' }, body: JSON.stringify({ name: 'Desktop smoke test', description: 'test', country: 'KR', vehicleModel: 'test', trim: 'test', ownerId: 'test', asil: 'QM', featureRefs: [{ refId: 'AD-ADS-004', role: 'PRIMARY' }] }) });
    assert.equal(created.status, 201, await created.clone().text());
    const { featureId } = await created.json();
    await stop(server.child);
    server = await start(dir);
    assert.equal((await fetch(`${server.base}/api/features/${featureId}/versions/0.1.0`)).status, 200);
    completed = true;
  } finally {
    if (server) await stop(server.child);
    if (completed) await rm(dir, { recursive: true, force: true });
    else console.error(`Desktop smoke retained private failure artifacts: ${dir}`);
  }
});

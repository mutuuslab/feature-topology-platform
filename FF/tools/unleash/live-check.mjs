// Full verify: isolated, unmodified native PG/Unleash/Edge; no customer/demo flags are changed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = resolve(process.env.FF_RUNTIME_ASSETS ?? join(root, '.unleash-runtime/assets'));
if (!existsSync(assets) && !existsSync(`${assets}.tar.gz`)) throw new Error('Prepare official native assets with npm run unleash:native:prepare, or set FF_RUNTIME_ASSETS.');
const data = mkdtempSync(join(tmpdir(), 'ff-unleash-live-'));
const env = { ...process.env };
for (const key of ['FF_DB_URL', 'FF_TEST_PG_URL', 'FF_PG_TEST_NATIVE_URL', 'FF_DB_SCHEMA', 'FF_FIXTURES', 'FF_CLOCK_AT', 'FF_SEED_ANCHOR', 'FF_HSM_VEHICLE_ROOT', 'FF_DESKTOP']) delete env[key];
Object.assign(env, { FF_RUNTIME_ASSETS: assets, FF_RUNTIME_DATA: data, FF_ENV: 'development', FF_AUTH: 'demo', FF_SHOWCASE: '0', FF_DEMO_ACTIVITY: '0', FF_COST_DEMO: 'off', FF_SYNTHETIC: '0', GLEO_MODE: 'internal' });
// Reserve all four choices together before starting the supervisor, avoiding duplicate selections.
const reservations = [];
for (const key of ['FF_PG_PORT', 'UNLEASH_PORT', 'UNLEASH_EDGE_PORT', 'PORT']) {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  env[key] = String(server.address().port); reservations.push(server);
}
await Promise.all(reservations.map(server => new Promise(ok => server.close(ok))));
const fd = openSync(join(data, 'supervisor-output.log'), 'a');
const runtime = spawn(process.execPath, [join(root, 'tools/unleash/runtime.mjs'), 'sidecars'], { cwd: root, env, windowsHide: true, stdio: ['ignore', fd, fd] });
closeSync(fd);
let runtimeError;
runtime.on('error', error => { runtimeError = error; });
console.log(`Isolated official runtime evidence: ${data}`);
try {
  let ready = false;
  for (let attempt = 0; attempt < 1200; attempt++) {
    if (runtimeError || runtime.exitCode !== null) throw new Error(`Official runtime failed before readiness. Inspect ${data}`);
    const status = join(data, 'status.json');
    if (existsSync(status) && JSON.parse(readFileSync(status, 'utf8')).state === 'READY') { ready = true; break; }
    await delay(200);
  }
  if (!ready) throw new Error(`Official runtime readiness timed out. Inspect ${data}`);
  const vitest = join(root, 'node_modules/vitest/vitest.mjs');
  const code = await new Promise((ok, fail) => {
    const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.unleash.config.ts'], { cwd: join(root, 'backend'), env: { ...env, FF_UNLEASH_CONNECTION: join(data, 'connection.json') }, windowsHide: true, stdio: 'inherit' });
    child.once('error', fail); child.once('exit', code => ok(code ?? 1));
  });
  if (code !== 0) throw new Error(`Official Unleash vehicle integration failed (${code}). Evidence: ${data}`);
} finally {
  if (runtime.exitCode === null && !runtimeError) {
    writeFileSync(join(data, 'stop.request'), 'stop', { mode: 0o600 });
    for (let attempt = 0; attempt < 200 && runtime.exitCode === null; attempt++) await delay(200);
    if (runtime.exitCode === null) throw new Error(`Owned runtime did not stop cleanly. Inspect ${data}`);
  }
}

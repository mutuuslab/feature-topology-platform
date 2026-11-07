// Native PostgreSQL + unmodified official Unleash + OSS Edge + FF supervisor. Shared by customer CLI and Tauri.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, appendFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { migrateLegacySqlite } from './legacy-migration.mjs';
import { extractSidecarArchive } from './archive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const require = createRequire(import.meta.url);
const { Client } = require('pg');
export const DEFAULT_PORTS = { postgres: 5543, unleash: 4242, edge: 3063, ff: 9171 };
export function portsOf(env = process.env) {
  const ports = { postgres: Number(env.FF_PG_PORT ?? 5543), unleash: Number(env.UNLEASH_PORT ?? 4242), edge: Number(env.UNLEASH_EDGE_PORT ?? 3063), ff: Number(env.PORT ?? (env.FF_DESKTOP === '1' ? 0 : 9171)) };
  if (Object.entries(ports).some(([k, p]) => !Number.isInteger(p) || p > 65535 || p < (k === 'ff' && env.FF_DESKTOP === '1' ? 0 : 1))) throw new Error('Invalid runtime port');
  const nonzero = Object.values(ports).filter(Boolean);
  if (new Set(nonzero).size !== nonzero.length) throw new Error('Runtime ports must be distinct');
  return ports;
}
export async function assertFree(port) {
  if (!port) return;
  await new Promise((ok, fail) => { const s = createServer(); s.once('error', () => fail(new Error(`Port ${port} is already in use. Existing services were not stopped.`))); s.listen(port, '127.0.0.1', () => s.close(ok)); });
}
const secret = () => randomBytes(32).toString('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
export function redactor(values) { return (text) => values.filter(Boolean).sort((a, b) => b.length - a.length).reduce((s, value) => s.split(value).join('[REDACTED]'), String(text)); }
// Lock and secrets are created exclusively (wx) and written through the same descriptor; updates replace the file atomically (CodeQL js/file-system-race).
export function writeSupervisorLock(lockPath, info) {
  const fd = openSync(lockPath, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(info)); } finally { closeSync(fd); }
}
const newSecrets = () => ({ owner: secret(), ff: secret(), unleash: secret(), admin: `*:*.` + secret(), backend: `default:development.` + secret(), frontend: `default:development.` + secret(), adminPassword: secret(), vehicleRoot: randomBytes(32).toString('base64'), kek: randomBytes(32).toString('base64') });
export function ensureSecrets(secretPath) {
  const created = newSecrets();
  try { writeFileSync(secretPath, JSON.stringify(created), { flag: 'wx', mode: 0o600 }); return created; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const s = readJson(secretPath);
  if (s.vehicleRoot && s.kek) return s;
  const next = { ...s, vehicleRoot: s.vehicleRoot ?? created.vehicleRoot, kek: s.kek ?? created.kek };
  const tmp = `${secretPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
  try { renameSync(tmp, secretPath); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  return next;
}
// Restrict the entire private data tree to the current Windows account before any secret exists. No credentials go in arguments/logs.
export function restrictDataDir(data, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'win32') return;
  const who = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = String(who.stdout ?? '').match(/S-1-[0-9-]+/)?.[0];
  if (!sid || run('icacls.exe', [data, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'ignore' }).status !== 0) throw new Error('Unable to restrict runtime secrets to the current account');
}
export function prepareSecrets(data, options = {}) {
  restrictDataDir(data, options);
  return ensureSecrets(join(data, 'secrets.json'));
}

export async function runRuntime(options = {}) {
  const started = Date.now();
  const data = resolve(options.data ?? process.env.FF_RUNTIME_DATA ?? join(root, '.unleash-runtime'));
  if (options.fresh && existsSync(data)) throw new Error('Fresh runtime directory already exists; choose a new directory. Existing data was preserved.');
  let assets = resolve(options.assets ?? process.env.FF_RUNTIME_ASSETS ?? join(data, 'assets'));
  // Desktop ships one archive; installed customer data is extracted byte-for-byte into the private data directory.
  const archive = `${assets}.tar.gz`;
  if (!existsSync(assets) && existsSync(archive)) {
    const digest = readFileSync(`${archive}.sha256`, 'utf8').trim();
    if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== digest) throw new Error('Packaged sidecar archive SHA256 mismatch');
    assets = join(data, `assets-${digest.slice(0, 16)}`);
    if (!existsSync(join(assets, '.complete'))) {
      await extractSidecarArchive(archive, assets);
      writeFileSync(join(assets, '.complete'), digest);
    }
  }
  const ports = portsOf();
  mkdirSync(data, { recursive: true });
  const lockPath = join(data, 'supervisor.lock');
  if (existsSync(lockPath)) { const old = readJson(lockPath); if (processAlive(old.pid)) throw new Error('This runtime data directory is already supervised.'); rmSync(lockPath); }
  writeSupervisorLock(lockPath, { pid: process.pid, startedAt: new Date().toISOString(), ports });
  const stopPath = join(data, 'stop.request');
  rmSync(stopPath, { force: true });
  const children = [];
  let pgStarted = false, stopping = false, finished = false, cleanupFailed = false, stopRequested = false;
  let desktopReadyLine = null;
  const pgData = join(data, 'postgres-data');
  const pgBin = join(assets, 'postgres/bin');
  const exe = (name) => join(pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  let stopPoll;
  let stopCompletion;
  const stop = () => {
    if (stopCompletion) return stopCompletion;
    stopCompletion = (async () => {
    stopping = true;
    clearInterval(stopPoll);
    if (process.env.FF_DESKTOP === '1') { process.stdin.pause(); process.stdin.destroy(); }
    for (const child of [...children].reverse()) if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    await Promise.all(children.map((c) => c.exitCode !== null ? undefined : Promise.race([new Promise((r) => c.once('exit', r)), delay(5000)])));
    // Only the cluster started by this supervisor is stopped; no PID/port based broad process kills.
    if (pgStarted) {
      const result = spawnSync(exe('pg_ctl'), ['-D', pgData, '-m', 'fast', '-w', '-t', '20', 'stop'], { windowsHide: true, stdio: 'ignore', timeout: 25000 });
      if (result.status !== 0) { cleanupFailed = true; process.exitCode = 1; }
    }
    rmSync(lockPath, { force: true }); rmSync(stopPath, { force: true });
    finished = true;
    })();
    return stopCompletion;
  };
  const requestStop = () => { stopRequested = true; void stop(); };
  const assertRunning = () => { if (stopping) throw new Error('Runtime startup was stopped'); };
  // Accept cancellation while sidecars/FF are still starting, before a ready line exists.
  stopPoll = setInterval(() => { if (existsSync(stopPath)) requestStop(); }, 250);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, requestStop);
  if (process.env.FF_DESKTOP === '1') { process.stdin.resume(); process.stdin.on('data', (b) => { if (String(b).trim() === 'stop') requestStop(); }); process.stdin.once('end', requestStop); }
  try {
    for (const port of Object.values(ports)) { await assertFree(port); assertRunning(); }
    if (!existsSync(join(assets, 'server/node_modules/unleash-server/dist/server.js')) || !existsSync(join(assets, 'edge/unleash-edge.exe')) || !existsSync(exe('initdb'))) throw new Error('Native sidecar assets are missing. Run npm run unleash:native:prepare first.');
    const pins = readJson(join(assets, 'pins.json'));
    if (pins.server.version !== '8.3.1' || pins.edge.version !== '20.6.0' || pins.postgres.version !== '18.3') throw new Error('Native sidecar version mismatch');
    const s = prepareSecrets(data);
    const redact = redactor(Object.values(s));
    const log = (text) => appendFileSync(join(data, 'runtime.log'), redact(text));
    const phase = (name) => log(`[runtime] phase=${name} elapsedMs=${Date.now() - started}\n`);
    phase('assets-ready');
    const launch = (name, command, args, env) => {
      assertRunning();
      const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      child.on('error', () => log(`${name}: process launch failed\n`));
      for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => {
        log(`[${name}] ${line}\n`);
        if (name === 'ff' && /^FF_DESKTOP_READY:\d+$/.test(line)) { ports.ff = Number(line.split(':')[1]); desktopReadyLine = line; }
      });
      child.once('exit', (code) => { if (!stopping) { log(`${name} exited (${code}); shutting down owned runtime\n`); void stop().then(() => { process.exitCode = 1; }); } });
      return child;
    };
    const ready = async (url, token) => {
      for (let i = 0; i < 600; i++) {
        if (stopping || children.some((c) => c.exitCode !== null)) throw new Error('A sidecar exited before readiness; inspect the private runtime log.');
        try { const r = await fetch(url, { headers: token ? { Authorization: token } : {}, signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch {}
        await delay(200);
      }
      throw new Error('Sidecar readiness timed out; inspect the private runtime log.');
    };
    if (!existsSync(join(pgData, 'PG_VERSION'))) {
      const pw = join(data, 'initdb-password'); writeFileSync(pw, s.owner, { mode: 0o600 });
      try {
        const r = spawnSync(exe('initdb'), ['-D', pgData, '-U', 'ff_owner', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${pw}`], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
        log(r.stdout + r.stderr);
        if (r.status !== 0) throw new Error('Private PostgreSQL initialization failed');
      } finally { rmSync(pw, { force: true }); }
    }
    // Windows postgres inherits pipe handles even after pg_ctl exits; detached server startup must not capture pipes.
    const pg = spawnSync(exe('pg_ctl'), ['-D', pgData, '-l', join(data, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${ports.postgres}`, '-w', '-t', '30', 'start'], { windowsHide: true, stdio: 'ignore', timeout: 40000 });
    log(`Private PostgreSQL startup status: ${pg.status}\n`); if (pg.status !== 0) throw new Error('Private PostgreSQL startup failed'); pgStarted = true; phase('postgres-ready');
    const admin = new Client({ host: '127.0.0.1', port: ports.postgres, user: 'ff_owner', password: s.owner, database: 'postgres' });
    await admin.connect();
    try {
      for (const [role, database, password] of [['ff_app', 'feature_platform', s.ff], ['unleash_app', 'unleash', s.unleash]]) {
        if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password.replaceAll("'", "''")}'`);
        if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
        await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
        await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      }
    } finally { await admin.end(); }
    const serverUrl = `http://127.0.0.1:${ports.unleash}`;
    const edgeUrl = `http://127.0.0.1:${ports.edge}`;
    launch('unleash', process.execPath, [join(assets, 'server/node_modules/unleash-server/dist/server.js')], { HTTP_HOST: '127.0.0.1', PORT: String(ports.unleash), DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(ports.postgres), DATABASE_NAME: 'unleash', DATABASE_USERNAME: 'unleash_app', DATABASE_PASSWORD: s.unleash, DATABASE_SSL: 'false', INIT_ADMIN_API_TOKENS: s.admin, INIT_BACKEND_API_TOKENS: s.backend, INIT_FRONTEND_API_TOKENS: s.frontend, UNLEASH_DEFAULT_ADMIN_PASSWORD: s.adminPassword, CHECK_VERSION: 'false', LOG_LEVEL: 'warn' });
    await ready(`${serverUrl}/health`);
    phase('unleash-ready');
    launch('edge', join(assets, 'edge/unleash-edge.exe'), ['edge'], { PORT: String(ports.edge), INTERFACE: '127.0.0.1', UPSTREAM_URL: serverUrl, TOKENS: s.backend, FEATURES_REFRESH_INTERVAL_SECONDS: '1', TOKEN_REVALIDATION_INTERVAL_SECONDS: '1', LOG_LEVEL: 'warn' });
    await ready(`${edgeUrl}/api/client/features`, s.backend);
    phase('edge-backend-ready');
    // Frontend token must be validated by upstream; no pretrusted/offline-token shortcut.
    await ready(`${edgeUrl}/api/frontend`, s.frontend);
    phase('edge-frontend-ready');
    const env = { FF_DB_URL: `postgresql://ff_app:${s.ff}@127.0.0.1:${ports.postgres}/feature_platform`, ...(process.env.FF_KEK_FILE ? {} : { FF_KEK: process.env.FF_KEK ?? s.kek }), FF_HSM_VEHICLE_ROOT: s.vehicleRoot, FF_VEHICLE_AUTH: process.env.FF_VEHICLE_AUTH ?? 'required', FF_EVIDENCE_DIR: process.env.FF_EVIDENCE_DIR ?? join(data, 'evidence'), UNLEASH_MODE: 'live', UNLEASH_URL: serverUrl, UNLEASH_ADMIN_TOKEN: s.admin, UNLEASH_EDGE_URL: edgeUrl, UNLEASH_EDGE_BACKEND_TOKEN: s.backend, UNLEASH_EDGE_FRONTEND_TOKEN: s.frontend, PORT: String(ports.ff) };
    env.FF_HTTP_HOST = '127.0.0.1';
    // Factory-root injection is a demo/test knob. Production uses the existing HSM key store.
    // An explicitly inherited test knob still reaches FF's production config guard and is rejected there.
    if (process.env.FF_ENV === 'production') delete env.FF_HSM_VEHICLE_ROOT;
    await migrateLegacySqlite(process.env.FF_LEGACY_SQLITE, env.FF_DB_URL, data);
    if (options.startFf !== false) {
      const ff = launch('ff', process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'backend/dist/main.js')], env);
      phase('ff-starting');
      for (let i = 0; !ports.ff && i < 600; i++) { if (stopping) throw new Error('FF startup interrupted'); await delay(200); }
      if (!ports.ff) throw new Error('Desktop FF port was not announced');
      await ready(`http://127.0.0.1:${ports.ff}/api/health`);
      phase('ff-ready');
      if (!ff.pid) throw new Error('FF launch failed');
    }
    writeFileSync(join(data, 'status.json'), JSON.stringify({ state: 'READY', pid: process.pid, ports, versions: { server: '8.3.1', edge: '20.6.0', postgres: '18.3' }, startedAt: new Date().toISOString() }, null, 2));
    // Private connection file is for local test/customer tooling, never for Git or stdout.
    writeFileSync(join(data, 'connection.json'), JSON.stringify(env), { mode: 0o600 });
    if (desktopReadyLine) process.stdout.write(`${desktopReadyLine}\n`);
    console.log('FF_UNLEASH_READY');
    await new Promise((r) => { const poll = setInterval(() => { if (finished) { clearInterval(poll); r(); } }, 100); });
    writeFileSync(join(data, 'status.json'), JSON.stringify({ state: cleanupFailed ? 'STOP_FAILED' : 'STOPPED', ports }));
  } catch (error) { await stop(); if (stopRequested && !cleanupFailed) { writeFileSync(join(data, 'status.json'), JSON.stringify({ state: 'STOPPED', ports })); return; } throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = resolve(process.env.FF_RUNTIME_DATA ?? join(root, '.unleash-runtime'));
  try {
    if (process.argv[2] === 'stop') {
      const lock = readJson(join(data, 'supervisor.lock'));
      if (!processAlive(lock.pid)) throw new Error('Supervisor is not running; no process was stopped.');
      writeFileSync(join(data, 'stop.request'), 'stop', { mode: 0o600 }); console.log('Requested owned runtime shutdown.');
    } else if (process.argv[2] === 'status') {
      const status = readJson(join(data, 'status.json')); console.log(JSON.stringify({ ...status, alive: status.pid ? processAlive(status.pid) : false }));
    } else await runRuntime({ startFf: process.argv[2] !== 'sidecars', fresh: process.argv.includes('--fresh') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portsOf, assertFree, redactor, runRuntime, writeSupervisorLock, ensureSecrets, prepareSecrets } from './runtime.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { extractionGroups, extractSidecarArchive, windowsTar } from './archive.mjs';

test('runtime rejects collisions and invalid configuration without stopping the existing listener', async () => {
  assert.throws(() => portsOf({ FF_PG_PORT: '4242' }), /distinct/);
  for (const value of ['0', '-1', '65536', 'abc', '1.2']) assert.throws(() => portsOf({ UNLEASH_EDGE_PORT: value }), /Invalid/);
  assert.equal(portsOf({ FF_DESKTOP: '1', PORT: '0' }).ff, 0);
  const listener = createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  try { await assert.rejects(() => assertFree(port), /already in use/); assert.ok(listener.listening); } finally { await new Promise((r) => listener.close(r)); }
  await assertFree(port);
});
test('credentials are removed before logging', () => {
  const clean = redactor(['secret', 'default:development.secret']);
  assert.equal(clean('token default:development.secret and secret'), 'token [REDACTED] and [REDACTED]');
});
test('server lock matches the immutable source and official npm package integrity', () => {
  const pins = JSON.parse(readFileSync(new URL('./pins.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('./server-package-lock.json', import.meta.url)));
  assert.equal(lock.packages['node_modules/unleash-server'].version, pins.server.version);
  assert.equal(lock.packages['node_modules/unleash-server'].integrity, pins.server.integrity);
  assert.equal(pins.server.commit.length, 40);
  assert.match(pins.edge.sha256, /^[0-9a-f]{64}$/);
});
test('fresh runtime cannot reuse or remove existing customer state', async () => {
  const data = mkdtempSync(join(tmpdir(), 'ff-ul-fresh-')), file = join(data, 'old-state'); writeFileSync(file, 'preserve');
  try { await assert.rejects(() => runRuntime({ data, fresh: true }), /Existing data was preserved/); assert.equal(readFileSync(file, 'utf8'), 'preserve'); }
  finally { rmSync(data, { recursive: true, force: true }); }
});

test('archive extraction assigns scoped packages and metadata to disjoint writers', () => {
  const entries = ['./', './server/', './server/node_modules/', './server/node_modules/@scope/', './server/node_modules/@scope/one/LICENSE', './server/node_modules/@scope/two/index.js', './server/node_modules/unleash-server/', './server/node_modules/unleash-server/dist/server.js', './server/package.json', './edge/', './edge/unleash-edge.exe', './notices/LICENSE'];
  const groups = extractionGroups(entries);
  const roots = groups.flat();
  assert.equal(new Set(roots).size, roots.length);
  assert.ok(roots.includes('./server/node_modules/@scope'));
  for (const root of roots) for (const other of roots) if (other !== root) assert.ok(!other.startsWith(`${root}/`), `${root} overlaps ${other}`);
  for (const entry of entries.filter((entry) => !entry.endsWith('/'))) assert.equal(roots.filter((root) => entry === root || entry.startsWith(`${root}/`)).length, 1);
  for (const entry of ['../outside', './server/../../outside', '/absolute', 'C:/outside', './server\\outside']) assert.throws(() => extractionGroups([entry]), /Unsafe/);
});

test('parallel extraction preserves every original byte and removes its temporary tar', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-sidecar-extract-'));
  const source = join(dir, 'source'), destination = join(dir, 'installed'), archive = join(dir, 'assets.tar.gz');
  const files = new Map([
    ['server/node_modules/@scope/one/LICENSE', Buffer.from('Copyright\r\nAGPL-3.0')],
    ['server/node_modules/@scope/two/index.js', Buffer.from('export const value = 42;')],
    ['server/node_modules/unleash-server/dist/server.js', Buffer.from('official server')],
    ['server/node_modules/unleash-server/dist/server.js.map', Buffer.from('{"sources":[]}')],
    ['server/package.json', Buffer.from('{"private":true}')],
    ['edge/unleash-edge.exe', Buffer.from([0, 255, 13, 10, 128])],
    ['postgres/bin/initdb.exe', Buffer.from([77, 90, 0, 255])],
    ['notices/SOURCES.json', Buffer.from('{"official":true}')],
  ]);
  try {
    for (const [name, bytes] of files) { const file = join(source, name); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, bytes); }
    assert.equal(spawnSync(windowsTar(), ['-czf', archive, '-C', source, '.'], { windowsHide: true }).status, 0);
    const archiveBytes = readFileSync(archive);
    await extractSidecarArchive(archive, destination);
    for (const [name, bytes] of files) assert.deepEqual(readFileSync(join(destination, name)), bytes, name);
    assert.deepEqual(readFileSync(archive), archiveBytes, 'Original packaged archive changed');
    assert.equal(readdirSync(dir).some((name) => name.startsWith('.sidecars-')), false);
    writeFileSync(join(destination, 'customer-state'), 'preserve');
    const invalid = join(dir, 'invalid.tar.gz'); writeFileSync(invalid, 'invalid gzip');
    await assert.rejects(() => extractSidecarArchive(invalid, destination));
    assert.equal(readFileSync(join(destination, 'customer-state'), 'utf8'), 'preserve');
    assert.equal(readdirSync(dir).some((name) => name.startsWith('.sidecars-')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native startup can be cancelled before FF readiness and stops its private sidecars', { skip: !process.env.FF_NATIVE_TEST_ASSETS, timeout: 120000 }, async () => {
  const listeners = [];
  for (let i = 0; i < 3; i++) { const server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r)); listeners.push(server); }
  const ports = listeners.map((s) => s.address().port);
  await Promise.all(listeners.map((s) => new Promise((r) => s.close(r))));
  const data = mkdtempSync(join(tmpdir(), 'ff-runtime-cancel-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./runtime.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FF_RUNTIME_ASSETS: process.env.FF_NATIVE_TEST_ASSETS, FF_RUNTIME_DATA: data, FF_DESKTOP: '1', PORT: '0', FF_PG_PORT: String(ports[0]), UNLEASH_PORT: String(ports[1]), UNLEASH_EDGE_PORT: String(ports[2]), FF_ENV: 'development', FF_SEED: 'none', GLEO_MODE: 'off' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  try {
    const deadline = Date.now() + 80000;
    let started = false;
    while (Date.now() < deadline && child.exitCode === null) {
      const log = join(data, 'runtime.log');
      if (existsSync(log) && readFileSync(log, 'utf8').includes('phase=ff-starting')) { started = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(started, `FF launch was not reached; private diagnostics retained at ${data}`);
    assert.ok(!stdout.includes('FF_DESKTOP_READY:'), 'Test must stop during bootstrap');
    child.stdin.write('stop\n');
    assert.equal(await Promise.race([exited, new Promise((r) => { const timer = setTimeout(() => r('timeout'), 30000); timer.unref(); })]), 0, stderr);
    assert.equal(existsSync(join(data, 'supervisor.lock')), false);
    assert.equal(JSON.parse(readFileSync(join(data, 'status.json'), 'utf8')).state, 'STOPPED');
    for (const port of ports) await assertFree(port);
  } finally {
    if (child.exitCode === null) { child.stdin.write('stop\n'); await Promise.race([exited, new Promise((r) => { const timer = setTimeout(r, 30000); timer.unref(); })]); if (child.exitCode === null) child.kill(); }
  }
});

// CodeQL #55~#59(js/file-system-race) 회귀 — 잠금·비밀 파일은 한 번에 만들고(wx), 갱신은 임시 파일 + rename 한 번, 권한 제한은 비밀 생성 앞
test('supervisor lock is created and written through one exclusive descriptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-ul-lock-')), lock = join(dir, 'supervisor.lock');
  try {
    writeSupervisorLock(lock, { pid: 1, startedAt: 'x', ports: { ff: 1 } });
    assert.deepEqual(JSON.parse(readFileSync(lock, 'utf8')), { pid: 1, startedAt: 'x', ports: { ff: 1 } });
    assert.throws(() => writeSupervisorLock(lock, { pid: 2 }), /EEXIST/);
    assert.equal(JSON.parse(readFileSync(lock, 'utf8')).pid, 1, '다른 감독자가 만든 잠금을 덮어쓰지 않는다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('secrets are created exclusively once with every key and legacy files are completed in one atomic write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-ul-secret-')), path = join(dir, 'secrets.json');
  try {
    const s = ensureSecrets(path);
    for (const k of ['owner', 'ff', 'unleash', 'admin', 'backend', 'frontend', 'adminPassword', 'vehicleRoot', 'kek']) assert.ok(s[k], `${k} 생성`);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), s);
    assert.deepEqual(ensureSecrets(path), s, '이미 있는 비밀은 그대로 읽는다(다시 만들지 않음)');
    const legacy = { ...s }; delete legacy.vehicleRoot; delete legacy.kek;
    writeFileSync(path, JSON.stringify(legacy));
    const done = ensureSecrets(path);
    assert.equal(done.owner, s.owner, '기존 키 보존');
    assert.ok(done.vehicleRoot && done.kek, '빠진 키만 채운다');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), done);
    assert.deepEqual(readdirSync(dir), ['secrets.json'], '임시 파일이 남지 않는다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('windows data directory is restricted before the secret file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-ul-acl-')), path = join(dir, 'secrets.json');
  const calls = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args, secretExists: existsSync(path) });
    return cmd === 'whoami.exe' ? { status: 0, stdout: '"HOST-PC/user","S-1-5-21-1-2-3-1001"' } : { status: 0 };
  };
  try {
    prepareSecrets(dir, { platform: 'win32', run });
    assert.deepEqual(calls.map((c) => c.cmd), ['whoami.exe', 'icacls.exe']);
    assert.equal(calls[1].secretExists, false, 'icacls가 비밀 생성보다 먼저');
    assert.ok(calls[1].args.includes('*S-1-5-21-1-2-3-1001:(OI)(CI)F'));
    assert.ok(existsSync(path));
    rmSync(path);
    assert.throws(() => prepareSecrets(dir, { platform: 'win32', run: (cmd) => (cmd === 'whoami.exe' ? { status: 0, stdout: '' } : { status: 0 }) }), /restrict/);
    assert.equal(existsSync(path), false, '권한 제한에 실패하면 비밀을 만들지 않는다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Windows tar is the System32 bsdtar, not whatever tar.exe comes first on PATH (Git Bash GNU tar breaks drive-letter paths)', { skip: process.platform !== 'win32' }, () => {
  assert.equal(windowsTar({ SystemRoot: 'C:\\Windows' }, 'win32'), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(windowsTar({}, 'linux'), 'tar');
});

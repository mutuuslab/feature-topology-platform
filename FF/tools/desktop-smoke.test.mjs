// 패키지에 들어가는 Node·자산으로 실제 HTTP와 재시작 후 DB를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { request } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = process.env.FF_DESKTOP_RESOURCES || join(root, 'src-tauri', 'resources');
const runtime = join(resources, 'runtime');

async function start(dir) {
  const child = spawn(join(runtime, 'node.exe'), ['--disable-warning=ExperimentalWarning', join(runtime, 'backend', 'dist', 'main.js')], {
    cwd: runtime,
    env: { ...process.env, FF_DESKTOP: '1', FF_WEB_DIR: join(resources, 'ui'), FF_DB: join(dir, 'db.sqlite'), FF_EVIDENCE_DIR: join(dir, 'evidence'), PORT: '0', FF_SEED: 'v0.81', GLEO_MODE: 'off', UNLEASH_MODE: 'mock', IF_MODE_01: 'mock', IF_MODE_13: 'mock', IF_MODE_14: 'mock' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  const port = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend timed out: ${errors}`)), 60_000);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`backend exited ${code}: ${errors}`)));
    lines.on('line', (line) => {
      const match = /^FF_DESKTOP_READY:(\d+)$/.exec(line);
      if (match) { clearTimeout(timer); accept(Number(match[1])); }
    });
  }).catch((error) => { child.kill(); throw error; });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill();
  await done;
}

test('패키지 서버: UI·API·출처 제한·재시작 후 데이터', { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ff-desktop-test-'));
  let server;
  try {
    server = await start(dir);
    const get = (path, options) => fetch(server.base + path, options);
    assert.equal((await get('/api/health')).status, 200);
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
  } finally {
    if (server) await stop(server.child);
    await rm(dir, { recursive: true, force: true });
  }
});

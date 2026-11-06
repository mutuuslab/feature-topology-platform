// 정적 하네스 빌드(tools/static-build.ts) — 공개 배포와 같은 시드를 읽고, 같은 폴더의 다른 작업과 빌드 단계를 잠금으로 나눈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { assertBudget, assertNoLocalLeaks, deploySeedEnv, staticDirs, withLock } from './static-build.ts';

test('배포 시드 — cloudflare.yml의 snapshot:api 앞 환경 변수를 그대로 읽는다(공개본 전시 시드)', () => {
  const env = deploySeedEnv(readFileSync(join(FF, '..', '.github', 'workflows', 'cloudflare.yml'), 'utf8'));
  assert.equal(env.FF_SHOWCASE, '1');
  assert.ok(Object.keys(env).every((k) => /^[A-Z_][A-Z0-9_]*$/.test(k)));
  assert.deepEqual(deploySeedEnv('  run: |\n    A_B=1 C=x npm run snapshot:api\n'), { A_B: '1', C: 'x' });
  assert.throws(() => deploySeedEnv('run: npm run build'), /snapshot:api/);
});

test('잠금 — 이미 잡혀 있으면 풀릴 때까지 기다렸다가 돌고, 끝나면 푼다(실패해도 푼다)', async () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'ff-static-lock-')), 'static-build.lock');
  mkdirSync(lock);
  const waits: string[] = [];
  const order: string[] = [];
  setTimeout(() => (order.push('released'), rmSync(lock, { recursive: true })), 60);
  await withLock(lock, () => void order.push('ran'), 20, (s) => waits.push(s));
  assert.deepEqual(order, ['released', 'ran']);
  assert.ok(waits.length >= 1 && waits[0].includes(lock));
  assert.equal(existsSync(lock), false);
  await assert.rejects(withLock(lock, () => { throw new Error('빌드 실패'); }, 20, () => {}), /빌드 실패/);
  assert.equal(existsSync(lock), false);
});

test('포트별 빌드 폴더 — 무시되는 dist-static 아래, 포트마다 따로', () => {
  const a = staticDirs('9164'), b = staticDirs('9162');
  assert.notEqual(a.base, b.base);
  assert.ok(a.pub.replace(/\\/g, '/').endsWith('frontend/dist-static/9164/public'));
  assert.ok(a.dist.replace(/\\/g, '/').endsWith('frontend/dist-static/9164/dist'));
});

// 회귀(2026-11-06 로컬 의존 점검): 공개 스냅샷에 검증 서버 127.0.0.1:2100·빌드 PC 임시 폴더(사용자 이름 포함)가 실렸다
test('로컬 PC 흔적이 있으면 빌드를 실패시키고, 없으면 지나간다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-static-leak-'));
  try {
    writeFileSync(join(dir, 'ok.json'), '{"dir":"evidence/TEST-1"}');
    assertNoLocalLeaks([dir]);
    writeFileSync(join(dir, 'sim_status.json'), '{"host":"127.0.0.1","port":2100}');
    assert.throws(() => assertNoLocalLeaks([dir]), /빌드 PC 흔적[\s\S]*sim_status\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 2026-11-06 하네스 리뷰: 정적 공개본은 예산 검사를 거치지 않아 첫 화면 298·시연 엔진 묶음 86 KiB가 그대로 배포됐다
test('정적 빌드도 성능 예산을 넘으면 실패시키고, 안이면 지나간다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-static-budget-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'main-abcdefgh.js'), 'x');
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/assets/main-abcdefgh.js"></script>');
    const lines: string[] = [];
    assertBudget(dir, (s) => lines.push(s));
    assert.match(lines[0], /첫 화면 0\.\d\/\d+ KiB/);
    // 지연 묶음 하나가 화면 묶음 예산(40 KiB)을 넘는다 — 압축이 안 되는 내용으로
    let big = '';
    for (let i = 0; big.length < 200_000; i++) big += Math.sin(i).toString(36);
    writeFileSync(join(dir, 'assets', 'index-ABCDEFGH.js'), big);
    assert.throws(() => assertBudget(dir, () => {}), /성능 예산[\s\S]*index-ABCDEFGH\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 정적 하네스 빌드(tools/static-build.ts) — 공개 배포와 같은 시드를 읽고, 같은 폴더의 다른 작업과 빌드 단계를 잠금으로 나눈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { assertBudget, assertNoLocalLeaks, deploySeedEnv, staticDirs, withLock } from './static-build.ts';

// 이전 main의 앱이 push로 공개본을 덮었던 회귀를 막는다. 검증한 브랜치에서 수동으로만 게시한다.
test('웹 게시 workflow는 수동 실행만 허용한다', () => {
  for (const name of ['cloudflare.yml', 'pages.yml']) {
    const yaml = readFileSync(join(FF, '..', '.github', 'workflows', name), 'utf8');
    const triggers = yaml.match(/^on:\s*\r?\n([\s\S]*?)(?=^\S)/m)?.[1];
    assert.ok(triggers, `${name}: 게시 트리거가 명시되어야 한다`);
    assert.match(triggers, /^\s+workflow_dispatch:/m, `${name}: 수동 실행 필요`);
    assert.doesNotMatch(triggers, /^\s+(?:push|pull_request|schedule|workflow_run):/m, `${name}: 자동 게시 금지`);
  }
});

// 게시 직전의 실제 dist를 검사해야 한다. 별도 하네스 통과가 다른 산출물의 게시를 허용하지 않는다.
function assertPagesPublishArtifact(yaml: string): void {
  yaml = yaml.replace(/\r\n/g, '\n');
  const steps = yaml.split(/(?=^      - (?:name|uses):)/m).slice(1);
  const index = steps.findIndex((step) => /^      - name: Validate Pages publish artifact$/m.test(step));
  assert.ok(index >= 0, 'Pages 게시 직전 산출물 게이트가 필요하다');
  const gate = steps[index];
  assert.match(gate, /^        working-directory: FF$/m);
  assert.match(gate, /^        shell: bash$/m);
  assert.doesNotMatch(gate, /^        (?:continue-on-error|if):/m, '산출물 게이트를 건너뛰거나 실패를 무시할 수 없다');
  const run = gate.match(/^        run: \|\n((?:          [^\n]*(?:\n|$))*)/m)?.[1];
  assert.ok(run, '게이트 실행 명령이 필요하다');
  assert.deepEqual(run.trim().split('\n').map((line) => line.trim()), [
    'set -euo pipefail',
    'node --test tools/snapshot-pack.test.ts',
    'node tools/snapshot-pack.ts frontend/dist',
    'node tools/snapshot-coverage.ts frontend/dist/api-snapshot',
    'node tools/local-leaks.ts frontend/dist',
    'node tools/bundle-budget.ts frontend/dist',
    'node tools/snapshot-pack.ts --check-file-count frontend/dist',
  ], '세 검사는 실제 게시 dist를 대상으로 실패 즉시 중단해야 한다');
  const wrangler = steps.map((step, at) => ({ step, at })).filter(({ step }) => /\bnpx\b[^\n]*\bwrangler@/.test(step));
  assert.ok(wrangler.length >= 1, '게시 실행 단계를 확인해야 한다');
  for (const { step, at } of wrangler) {
    assert.ok(at > index, '어떤 wrangler 호출도 산출물 게이트보다 먼저 실행할 수 없다');
    const condition = step.match(/^        if:\s*(.+)$/m)?.[1].trim();
    assert.ok(!condition || condition === 'success()' || condition === '${{ success() }}', '게이트 실패 뒤 wrangler를 강제 실행할 수 없다');
  }
}

test('Pages 게시 직전 산출물 게이트가 모든 wrangler보다 먼저 실패를 차단한다', () => {
  assertPagesPublishArtifact(readFileSync(join(FF, '..', '.github', 'workflows', 'cloudflare.yml'), 'utf8'));
});

test('Pages 게시 산출물 계약은 누락·다른 폴더·실패 무시·후행 검사 회귀를 잡는다', () => {
  const yaml = readFileSync(join(FF, '..', '.github', 'workflows', 'cloudflare.yml'), 'utf8').replace(/\r\n/g, '\n');
  assertPagesPublishArtifact(yaml); // 기준 자체가 틀린 상태에서 음성 대조군이 공허하게 통과하지 않게 한다.
  const coverage = '          node tools/snapshot-coverage.ts frontend/dist/api-snapshot\n';
  assert.throws(() => assertPagesPublishArtifact(yaml.replace(coverage, '')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace('          node tools/snapshot-pack.ts frontend/dist' + '\n', '')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace('          node tools/snapshot-pack.ts --check-file-count frontend/dist' + '\n', '')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace('node tools/local-leaks.ts frontend/dist', 'node tools/local-leaks.ts frontend/public/api-snapshot')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace(coverage, coverage.trimEnd() + ' || true\n')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace('      - name: Validate Pages publish artifact\n', '      - name: Validate Pages publish artifact\n        continue-on-error: true\n')));
  assert.throws(() => assertPagesPublishArtifact(yaml.replace('      - name: Deploy\n', '      - name: Deploy\n        if: always()\n')));
  const start = yaml.indexOf('      - name: Validate Pages publish artifact\n');
  const next = yaml.indexOf('      - name: Ensure Pages project\n', start);
  assert.ok(next > start);
  const moved = yaml.slice(0, start) + yaml.slice(next) + yaml.slice(start, next);
  assert.throws(() => assertPagesPublishArtifact(moved));
});

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

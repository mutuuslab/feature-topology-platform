// npm run verify — 단일 품질 게이트. 순서대로 실행하고 첫 실패에서 멈춘다(--keep-going 이면 끝까지).
// --full: 시각 회귀 등 로컬 전용 단계 포함. --only <id,...>: 일부 단계만.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

interface Step {
  id: string;
  title: string;
  cmd: string;
  cwd?: string;
  full?: boolean; // --full 에서만
  when?: () => boolean; // 해당 단계가 아직 준비되지 않았으면 건너뜀
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const STEPS: Step[] = [
  { id: 'contracts:build', title: 'contracts 빌드 (tsc)', cmd: `${npm} run build -w @ff/contracts` },
  { id: 'typecheck:backend', title: '백엔드 타입 검사', cmd: `${npx} tsc -p tsconfig.json --noEmit`, cwd: 'backend' },
  { id: 'typecheck:frontend', title: '프론트 타입 검사', cmd: `${npx} tsc -b`, cwd: 'frontend' },
  { id: 'lint:tokens', title: '디자인 토큰 lint', cmd: `node tools/lint-tokens.ts` },
  { id: 'lint:copy', title: '문구 lint', cmd: `node tools/lint-copy.ts` },
  { id: 'data:check', title: '데이터셋 픽스처 정합', cmd: `node tools/dataset/check.ts`, when: () => existsSync(join(FF, 'tools', 'dataset', 'check.ts')) },
  { id: 'openapi', title: 'OpenAPI 최신 여부', cmd: `node tools/openapi.ts --check` },
  { id: 'test:contracts', title: 'contracts 테스트', cmd: `${npm} test -w @ff/contracts` },
  { id: 'test:backend', title: '백엔드 테스트', cmd: `${npm} test -w feature-topology-backend` },
  { id: 'test:frontend', title: '프론트 테스트', cmd: `${npm} test -w feature-topology-frontend` },
  { id: 'conformance', title: '42 컴포넌트 준수', cmd: `node tools/conformance.ts` },
  { id: 'build:frontend', title: '프론트 빌드', cmd: `${npx} vite build`, cwd: 'frontend' },
  { id: 'e2e', title: 'e2e (기능·접근성·레이아웃)', cmd: `${npx} playwright test --grep-invert @visual`, cwd: 'e2e', when: () => existsSync(join(FF, 'e2e', 'playwright.config.ts')) },
  { id: 'e2e:visual', title: '시각 회귀', cmd: `${npx} playwright test --grep @visual`, cwd: 'e2e', full: true, when: () => existsSync(join(FF, 'e2e', 'playwright.config.ts')) },
];

const args = process.argv.slice(2);
const full = args.includes('--full');
const keepGoing = args.includes('--keep-going');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

const results: { id: string; title: string; status: 'PASS' | 'FAIL' | 'SKIP'; ms: number; why?: string }[] = [];
let failed = false;
for (const s of STEPS) {
  if (only && !only.includes(s.id)) continue;
  if (s.full && !full) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '--full 전용' }); continue; }
  if (s.when && !s.when()) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '아직 없음' }); continue; }
  if (failed && !keepGoing) { results.push({ id: s.id, title: s.title, status: 'SKIP', ms: 0, why: '앞 단계 실패' }); continue; }
  console.log(`\n▶ ${s.title}  (${s.id})`);
  const t0 = Date.now();
  const r = spawnSync(s.cmd, { cwd: join(FF, s.cwd ?? '.'), stdio: 'inherit', shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
  const ok = r.status === 0;
  results.push({ id: s.id, title: s.title, status: ok ? 'PASS' : 'FAIL', ms: Date.now() - t0 });
  if (!ok) failed = true;
}

const icon = { PASS: '✓', FAIL: '✕', SKIP: '·' } as const;
console.log('\n──────── verify 요약 ────────');
for (const r of results) {
  const time = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '';
  console.log(`${icon[r.status]} ${r.status.padEnd(4)} ${r.id.padEnd(20)} ${time.padStart(7)}  ${r.why ?? ''}`);
}
console.log(failed ? '\n✕ verify 실패' : '\n✓ verify 통과');
process.exit(failed ? 1 : 0);

// 정적 데모 빌드(verify e2e:static 의 webServer) — 공개 배포(.github/workflows/cloudflare.yml)와 같은 시드로 스냅샷을 만들고
// 포트마다 다른 폴더(frontend/dist-static/<포트>/{public,dist})에 빌드한다. 사용: node tools/static-build.ts <포트>
//  · 시드: 기본은 배포와 같다(cloudflare.yml의 snapshot:api 앞 환경 변수, 예 FF_SHOWCASE=1). E2E_STATIC_SEED=base면 기본 시드
//    — 공개본에만 생기는 빈 곳(전시 시드)을 하네스가 놓치지 않게(2026-11-05 코디네이터)
//  · 잠금: 계약·백엔드 빌드(dist)와 스냅샷 생성은 같은 폴더의 다른 작업과 겹치면 안 된다 — 그 동안만 잠금 폴더(STATIC_BUILD_LOCK)를 잡는다
//  · 로컬 PC 흔적: 스냅샷·빌드 결과에 localhost·사설 IP·절대 경로·사용자 이름이 있으면 빌드를 실패시킨다(tools/local-leaks.ts, 2026-11-06)
//  · 성능 예산: 공개본(정적 빌드)도 일반 빌드와 같은 예산(harness/budgets.json — 첫 화면·화면 묶음)을 넘으면 실패시킨다(tools/bundle-budget.ts, 2026-11-06)
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetReport } from './bundle-budget.ts';
import { FF } from './lib.ts';
import { report, scanDirs } from './local-leaks.ts';
import { checkCoverage } from './snapshot-coverage.ts';

/** 공개본 성능 예산 — 넘으면 멈춘다(예산은 올리지 않는다: 지연 로딩·묶음 경계를 고친다) */
export function assertBudget(dist: string, log: (s: string) => void = console.log): void {
  const { line, bad } = budgetReport(dist);
  log(`static-build — ${line}`);
  if (bad.length) throw new Error(`공개 정적 데모가 성능 예산을 넘었습니다(harness/budgets.json)\n${bad.map((x) => `  ✕ ${x}`).join('\n')}`);
}

/** 공개본 로컬 PC 흔적 검사 — 스냅샷과 빌드 결과 둘 다 */
export function assertNoLocalLeaks(dirs: string[]): void {
  const leaks = scanDirs(dirs);
  if (leaks.length) throw new Error(`공개 정적 데모에 빌드 PC 흔적이 있습니다 — 고친 뒤 다시 빌드하세요\n${report(leaks)}`);
}

/** cloudflare.yml에서 snapshot:api 앞의 환경 변수 — 배포 단계가 바뀌면 그대로 따라간다 */
export function deploySeedEnv(yaml: string): Record<string, string> {
  const line = yaml.split(/\r?\n/).find((l) => /\bnpm run snapshot:api\b/.test(l));
  if (!line) throw new Error('cloudflare.yml에 snapshot:api 단계가 없습니다 — 정적 하네스의 시드를 정할 수 없습니다');
  const env: Record<string, string> = {};
  for (const m of line.slice(0, line.indexOf('npm run snapshot:api')).matchAll(/([A-Z_][A-Z0-9_]*)=(\S+)/g)) env[m[1]] = m[2];
  return env;
}

/** 잠금 폴더를 만들 수 있을 때까지 기다렸다가 fn을 돌리고 푼다 — 이미 있으면 다른 작업이 빌드 중 */
export async function withLock<T>(dir: string, fn: () => T | Promise<T>, waitMs = 30_000, log: (s: string) => void = console.log): Promise<T> {
  mkdirSync(dirname(dir), { recursive: true });
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      log(`정적 빌드 잠금 대기 — ${dir} (다른 작업이 빌드 중, ${Math.round(waitMs / 1000)}초 뒤 다시)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 포트별 빌드 폴더 — frontend/dist-static 아래(무시되는 산출물) */
export const staticDirs = (port: string) => {
  const base = join(FF, 'frontend', 'dist-static', port);
  return { base, pub: join(base, 'public'), dist: join(base, 'dist') };
};

async function main(port: string) {
  if (!/^\d+$/.test(port) || port === '8000') throw new Error('사용: node tools/static-build.ts <포트> (8000 금지)');
  const seed = process.env.E2E_STATIC_SEED === 'base' ? {} : deploySeedEnv(readFileSync(join(FF, '..', '.github', 'workflows', 'cloudflare.yml'), 'utf8'));
  const { base, pub, dist } = staticDirs(port);
  const run = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { cwd: FF, stdio: 'inherit', env: { ...process.env, ...env } });
  const lock = resolve(process.env.STATIC_BUILD_LOCK ?? join(FF, 'frontend', 'dist-static', '.build.lock'));
  console.log(`static-build — 포트 ${port}, 시드 ${Object.keys(seed).length ? JSON.stringify(seed) : '기본'}, 잠금 ${lock}`);
  await withLock(lock, () => {
    run('npm run build:contracts');
    run('npm run build -w feature-topology-backend');
    // 공개 폴더 사본(_headers 등) — 다른 작업이 frontend/public/api-snapshot을 지우는 중에 복사하지 않게 스냅샷은 빼고, 이 폴더에 새로 만든다
    rmSync(base, { recursive: true, force: true });
    cpSync(join(FF, 'frontend', 'public'), pub, { recursive: true, filter: (src) => !/[\\/]api-snapshot([\\/]|$)/.test(src) });
    run('node tools/snapshot-api.ts', { ...seed, SNAPSHOT_OUT: pub });
    // 화면 조회 ↔ 스냅샷 대조 — 화면에서 고를 수 있는 필터 키·질의 키 순서가 스냅샷에 없으면(새 틈) 멈춘다(tools/snapshot-coverage.ts, 2026-11-06)
    const gaps = checkCoverage(join(pub, 'api-snapshot'));
    if (gaps.length) throw new Error(`화면 조회에 맞는 스냅샷이 없습니다(새 틈 ${gaps.length}건) — 위 목록 참고`);
  });
  run(`npm exec -w feature-topology-frontend -- vite build --outDir "${dist}" --emptyOutDir`, { VITE_DATA_MODE: 'static', FF_PUBLIC_DIR: pub });
  // 빌드 결과(dist)는 스냅샷을 담아 공개되는 그대로다 — 스냅샷 폴더와 함께 훑는다
  assertNoLocalLeaks([join(pub, 'api-snapshot'), dist]);
  console.log('static-build — 로컬 PC 흔적 0건');
  assertBudget(dist);
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  await main(process.argv[2] ?? '').catch((e) => {
    console.error('static-build 실패:', (e as Error).message);
    process.exit(1);
  });
}

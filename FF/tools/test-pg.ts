// npm run test:pg — 백엔드 시험 묶음을 PostgreSQL에서 돌려 호환률을 잰다(D-RD-3 이전 1단계 하네스, docs/20-architecture/20-92 §6).
//   · Docker postgres:16 컨테이너(ff-pg-test, 127.0.0.1:9690, C 정렬 — SQLite와 같은 문자열 순서)를 띄우거나 이어 쓴다
//   · FF_TEST_PG_URL을 주고 같은 vitest 묶음을 돌린다 — 메모리 DB 요청이 PG 새 데이터베이스(틀 복제)로 바뀐다(db-open.ts)
//   · 통과 수는 래칫 pgBackendPass(줄어들면 실패), 실패 목록·원인 분류는 harness/pg-compat.json
// 기본 verify에는 없고 verify --full 단계(test:pg)다. Docker가 없으면 실패한다(건너뛰지 않는다 — 잴 수 없으면 잰 척하지 않는다).
// 선택: --keep(컨테이너를 남김, 기본), --fresh(컨테이너를 새로 만듦), --files a,b(일부 시험 파일만 — 래칫·기록 생략)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FF, ratchet } from './lib.ts';

const PORT = Number(process.env.FF_PG_TEST_PORT) || 9690;
const NAME = 'ff-pg-test';
const URL = `postgres://ff:ff@127.0.0.1:${PORT}/ff`;
const args = process.argv.slice(2);
const filesArg = args.includes('--files') ? args[args.indexOf('--files') + 1].split(',') : null;

const sh = (cmd: string, a: string[], opts: { quiet?: boolean } = {}) => {
  const r = spawnSync(cmd, a, { encoding: 'utf8', shell: false });
  if (!opts.quiet && r.status !== 0) console.error(r.stderr || r.stdout);
  return r;
};

console.log('test:pg — 백엔드 시험을 PostgreSQL 16에서');
if (sh('docker', ['version', '--format', '{{.Server.Version}}'], { quiet: true }).status !== 0) {
  console.error('  ✕ Docker 서버에 닿지 않습니다 — Docker Desktop을 켜고 다시 실행하세요');
  process.exit(1);
}
const state = sh('docker', ['inspect', '-f', '{{.State.Running}}', NAME], { quiet: true });
if (args.includes('--fresh') && state.status === 0) sh('docker', ['rm', '-f', NAME]);
if (args.includes('--fresh') || state.status !== 0) {
  console.log(`  · 컨테이너 ${NAME} 만들기 (postgres:16, 127.0.0.1:${PORT})`);
  const r = sh('docker', ['run', '-d', '--name', NAME, '-e', 'POSTGRES_USER=ff', '-e', 'POSTGRES_PASSWORD=ff', '-e', 'POSTGRES_DB=ff', '-e', 'POSTGRES_INITDB_ARGS=--locale=C --encoding=UTF8', '-p', `127.0.0.1:${PORT}:5432`, 'postgres:16', '-c', 'max_connections=400', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off']);
  if (r.status !== 0) process.exit(1);
} else if (state.stdout.trim() !== 'true') {
  console.log(`  · 컨테이너 ${NAME} 다시 시작`);
  if (sh('docker', ['start', NAME]).status !== 0) process.exit(1);
}
// 준비 대기 — pg_isready
for (let i = 0; ; i++) {
  if (sh('docker', ['exec', NAME, 'pg_isready', '-U', 'ff', '-d', 'ff'], { quiet: true }).status === 0) break;
  if (i > 60) {
    console.error('  ✕ PostgreSQL이 60초 안에 준비되지 않았습니다');
    process.exit(1);
  }
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
}
// 지난 실행이 남긴 시험·틀 데이터베이스 정리 — 틀은 실행마다 새로(시드 기준일이 바뀔 수 있다)
const psql = (sql: string) => sh('docker', ['exec', NAME, 'psql', '-U', 'ff', '-d', 'ff', '-At', '-c', sql], { quiet: true });
const stale = psql("SELECT datname FROM pg_database WHERE datname LIKE 'ff\\_t\\_%' OR datname LIKE 'ff\\_tpl\\_%'").stdout.split('\n').filter(Boolean);
for (const d of stale) {
  psql(`ALTER DATABASE "${d}" IS_TEMPLATE false`);
  psql(`DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`);
}
if (stale.length) console.log(`  · 지난 시험 데이터베이스 ${stale.length}개 정리`);

const out = join(mkdtempSync(join(tmpdir(), 'ff-test-pg-')), 'vitest.json');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const started = Date.now();
// 시간 한도 — 왕복마다 Docker Desktop 포트 전달(~1.5-3 ms)이 붙어 SQLite보다 수십 배 느리다. 한도 초과는 실패로 센다
const run = spawnSync(npx, ['vitest', 'run', '--reporter=json', `--outputFile=${out}`, '--testTimeout=180000', '--hookTimeout=300000', '--maxWorkers=4', ...(filesArg ?? [])], {
  cwd: join(FF, 'backend'),
  env: { ...process.env, FF_TEST_PG_URL: URL },
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 256 * 1024 * 1024,
});
if (!existsSync(out)) {
  console.error('  ✕ vitest 결과 파일이 없습니다');
  console.error((run.stderr || '').slice(-4000));
  process.exit(1);
}
interface Assertion { fullName: string; status: string; failureMessages: string[] }
const report = JSON.parse(readFileSync(out, 'utf8')) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; testResults: { name: string; status: string; message?: string; assertionResults: Assertion[] }[] };

/** 실패 원인 분류 — 같은 원인을 묶어 다음 단계 작업 목록으로 */
const classify = (msg: string) => {
  if (/timed out|시간 초과|Timeout/i.test(msg)) return 'timeout';
  const m = /error: (.+?)(?: — PG:|\n)/.exec(msg) ?? /^(?:\w*Error): (.+)$/m.exec(msg);
  const head = (m?.[1] ?? msg.split('\n')[0]).replace(/"[^"]*"/g, '"…"').replace(/\$\d+/g, '$n').slice(0, 120);
  return /expected|toBe|toEqual|AssertionError/i.test(msg) ? `assert: ${head.slice(0, 80)}` : head;
};
const failing: { file: string; test: string; cause: string }[] = [];
const skipped: string[] = [];
for (const f of report.testResults) {
  const file = f.name.replace(/\\/g, '/').replace(/^.*\/backend\//, '');
  // 파일 단위 오류(적재 실패·beforeAll 실패) — 뒤따르는 시험은 '건너뜀'으로 잡히므로 원인을 따로 남긴다
  const failedHere = f.assertionResults.some((a) => a.status === 'failed');
  if (f.status === 'failed' && (f.message || !failedHere)) failing.push({ file, test: '(파일·준비 단계 실패)', cause: f.message ? classify(f.message) : '준비 단계(beforeAll) 실패 — 메시지 없음(시간 한도를 시험이 직접 정한 경우가 많다)' });
  for (const a of f.assertionResults) if (a.status === 'failed') failing.push({ file, test: a.fullName, cause: classify(a.failureMessages.join('\n')) });
  for (const a of f.assertionResults) if (a.status === 'skipped' || a.status === 'pending') skipped.push(`${file} › ${a.fullName}`);
}
const causes = Object.entries(failing.reduce<Record<string, number>>((m, f) => ((m[f.cause] = (m[f.cause] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const total = report.numTotalTests;
const passed = report.numPassedTests;
const min = Math.round((Date.now() - started) / 60_000);
console.log(`  · 통과 ${passed}/${total} (실패 ${report.numFailedTests} · 건너뜀 ${report.numPendingTests}) · ${min}분`);
for (const [c, n] of causes.slice(0, 12)) console.log(`    ${String(n).padStart(4)} × ${c}`);

if (filesArg) process.exit(run.status === 0 ? 0 : 1);
writeFileSync(
  join(FF, 'harness', 'pg-compat.json'),
  JSON.stringify(
    {
      note: '백엔드 시험 묶음의 PostgreSQL 16 호환 — npm run test:pg가 쓴다(손으로 고치지 않는다). 정본 docs/20-architecture/20-92 §6.',
      measuredAt: new Date().toISOString().slice(0, 10),
      total,
      passed,
      failed: report.numFailedTests,
      skipped: report.numPendingTests,
      minutes: min,
      causes: Object.fromEntries(causes),
      failing,
      skippedTests: skipped,
    },
    null,
    2,
  ) + '\n',
);
const ok = ratchet('pgBackendPass', passed, 'min', '백엔드 시험의 PostgreSQL 통과 수(npm run test:pg) — 늘어나기만 한다');
process.exit(ok ? 0 : 1);

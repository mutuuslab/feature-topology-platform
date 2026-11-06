// 부하 시험(출시 준비 RD-P2-01) — 시드한 큰 DB로 빌드된 백엔드를 별도 프로세스로 띄우고(측정 탐침 probe.ts),
// 주요 API를 시나리오별로 동시 요청해 p50/p95/p99·처리량·이벤트 루프 막힘을 잰다. harness/perf-budgets.json 예산(p95)을 넘으면 실패.
//   node tools/load/run.ts --profile light|full [--only id,...] [--md] [--keep]
//   포트: E2E_LOAD_PORT(기본 9659, 8000 금지). 결과: .sim/load/report-<profile>.json
import { fork, type ChildProcess } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FF } from '../lib.ts';
import { PROFILES, type ProfileName } from './profiles.ts';
import { LOAD_DIR, SEED_ENV, seedFor } from './seed.ts';
import { judge, summarize, type BudgetFile, type Summary } from './stats.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const NAME = (arg('profile') ?? 'light') as ProfileName;
const P = PROFILES[NAME];
if (!P) throw new Error(`알 수 없는 profile: ${NAME}`);
const ONLY = arg('only')?.split(',');
const PORT = Number(process.env.E2E_LOAD_PORT ?? 9659);
if (PORT === 8000) throw new Error('포트 8000은 쓰지 않는다');
const BASE = `http://127.0.0.1:${PORT}`;
const SCENARIO_CAP_MS = 15_000;
export const BUDGETS_FILE = join(FF, 'harness', 'perf-budgets.json');

const H = (id: string, role: string): Record<string, string> => ({ 'x-actor-id': id, 'x-actor-role': role, 'content-type': 'application/json' });
const OPS = H('usr-ops', 'OPERATOR');
const AUDITOR = H('usr-auditor', 'AUDITOR');

interface Ctx {
  features: { featureId: string; version: string }[];
  loadVins: string[];
  killTargets: { featureId: string; version: string; vin: string }[];
  /** 차단 요청 대상 다음 순번 — 같은 대상을 두 번 쓰면 진행 중 차단과 겹쳐 거부된다(예열·재측정 포함 한 번씩) */
  killNext: number;
  deliveryVins: string[];
  maxSeq: number;
  auditCursor: string | null;
  vehicleCursor: string | null;
  example: unknown;
}
interface Scenario {
  id: string;
  title: string;
  /** 쓰기 시나리오는 동시성 1·요청 수 축소(직렬화된 SQLite 쓰기의 지연 자체를 잰다) */
  write?: boolean;
  req: (i: number, c: Ctx) => { method: 'GET' | 'POST'; path: string; headers?: Record<string, string>; body?: unknown };
}

const pick = <T>(xs: T[], i: number) => xs[(i * 7919) % xs.length];
// SDK는 VIN 대신 가명을 보낸다 — 서버와 같은 함수(빌드된 백엔드)
const require = createRequire(import.meta.url);
const pseudonymOf = (vin: string): string => require(join(FF, 'backend', 'dist', 'kernel', 'crypto.js')).vehiclePseudonym(vin);

export const SCENARIOS: Scenario[] = [
  { id: 'features.page', title: 'Feature 목록 한 페이지(limit 50)', req: () => ({ method: 'GET', path: '/api/features?limit=50' }) },
  { id: 'features.latest', title: 'Feature 최신 버전 전체(대시보드·홈)', req: () => ({ method: 'GET', path: '/api/features?latestOnly=true' }) },
  { id: 'features.search', title: 'Feature 검색 한 페이지(q·limit)', req: (i) => ({ method: 'GET', path: `/api/features?q=${encodeURIComponent(['care', 'FEAT-1', 'ADAS', '경고'][i % 4])}&limit=50` }) },
  { id: 'features.detail', title: 'Feature 버전 상세', req: (i, c) => { const f = pick(c.features, i); return { method: 'GET', path: `/api/features/${f.featureId}/versions/${f.version}` }; } },
  { id: 'dashboard.components', title: '대시보드 — 컴포넌트 현황', req: () => ({ method: 'GET', path: '/api/components' }) },
  { id: 'dashboard.activity', title: '대시보드 — 최근 활동(60분)', req: () => ({ method: 'GET', path: '/api/components/activity?minutes=60' }) },
  { id: 'dashboard.kills', title: '대시보드 — 진행 중 차단', req: () => ({ method: 'GET', path: '/api/kill-requests?status=ACTIVE' }) },
  { id: 'dashboard.audit500', title: '대시보드 — 최근 감사 500건', req: () => ({ method: 'GET', path: '/api/audit?limit=500' }) },
  { id: 'dashboard.vehicles', title: '대시보드 — 차량 가젯(수만, limit=1)', req: () => ({ method: 'GET', path: '/api/vehicles?limit=1' }) },
  { id: 'vehicles.page', title: '차량 목록 한 페이지(limit 100)', req: (i, c) => ({ method: 'GET', path: `/api/vehicles?limit=100${i % 2 && c.vehicleCursor ? `&cursor=${c.vehicleCursor}` : ''}` }) },
  { id: 'dashboard.safety', title: '대시보드 — 안전 분류 목록', req: () => ({ method: 'GET', path: '/api/safety-profiles' }) },
  { id: 'procedures.summary', title: '업무 절차 요약(메뉴 배지)', req: (i) => ({ method: 'GET', path: '/api/procedures/summary', headers: [OPS, H('usr-author', 'FEATURE_AUTHOR'), H('usr-judge', 'GATE_JUDGE')][i % 3] }) },
  { id: 'procedures.inbox', title: '업무 절차 검토함', req: (i) => ({ method: 'GET', path: '/api/procedures/inbox', headers: [OPS, H('usr-author', 'FEATURE_AUTHOR'), H('usr-judge', 'GATE_JUDGE')][i % 3] }) },
  { id: 'audit.page', title: '감사 — 커서 다음 페이지', req: (_, c) => ({ method: 'GET', path: `/api/audit?limit=100${c.auditCursor ? `&cursor=${c.auditCursor}` : ''}` }) },
  { id: 'audit.target', title: '감사 — 대상 필터', req: (i, c) => ({ method: 'GET', path: `/api/audit?limit=100&target=${encodeURIComponent(`${pick(c.features, i).featureId}@1.0.0`)}` }) },
  { id: 'audit.denied', title: '감사 — 거부만(결과 필터)', req: () => ({ method: 'GET', path: '/api/audit?limit=100&result=DENIED' }) },
  { id: 'events.cursor', title: '이벤트 — after 커서 페이지', req: (i, c) => ({ method: 'GET', path: `/api/events?after=${Math.floor((c.maxSeq * ((i * 37) % 100)) / 100)}&limit=200` }) },
  { id: 'events.aggregate', title: '이벤트 — 대상(aggregate) 필터', req: (i, c) => ({ method: 'GET', path: `/api/events?aggregate=${pick(c.features, i).featureId}&limit=200` }) },
  { id: 'notifications', title: '내 알림(운영자)', req: () => ({ method: 'GET', path: '/api/notifications?limit=100', headers: OPS }) },
  { id: 'vehicle.inbox', title: '차량 전달함(IF-07 당겨받기)', req: (i, c) => { const vin = pick(c.deliveryVins, i); return { method: 'GET', path: `/vehicle/v1/${vin}/inbox`, headers: { 'x-vehicle-id': vin } }; } },
  { id: 'vehicle.hello', title: '차량 보고(IF-06 HELLO 재연결)', req: (i, c) => { const vin = c.loadVins[(i * 104729) % c.loadVins.length]; return { method: 'POST', path: `/vehicle/v1/${vin}/reports`, headers: { 'x-vehicle-id': vin, 'content-type': 'application/json' }, body: { type: 'HELLO', bootId: `BOOT-${vin}-${i}`, sequence: 1, observedAt: '2026-10-12T01:00:00.000Z', highest: {} } }; } },
  { id: 'vehicle.status', title: '차량 상태 보고 v2 조회', req: (i, c) => ({ method: 'GET', path: `/api/vehicles/${pick(c.loadVins, i)}/status`, headers: OPS }) },
  { id: 'ofrep.bulk', title: 'OFREP 전체 flag 평가', req: (i, c) => ({ method: 'POST', path: '/ofrep/v1/evaluate/flags', headers: { 'content-type': 'application/json' }, body: { context: { targetingKey: pick(c.loadVins, i) } } }) },
  { id: 'ofrep.pseudonym', title: 'OFREP 전체 flag 평가(차량 가명 targetingKey)', req: (i, c) => ({ method: 'POST', path: '/ofrep/v1/evaluate/flags', headers: { 'content-type': 'application/json' }, body: { context: { targetingKey: pseudonymOf(pick(c.loadVins, i)) } } }) },
  { id: 'gate.preview', title: '게이트 미리보기(kill_command v2)', req: (_, c) => ({ method: 'POST', path: '/api/gate/preview', headers: OPS, body: c.example }) },
  { id: 'kill.issue', title: '긴급 차단 요청 발행(쓰기)', write: true, req: (_, c) => { const t = c.killTargets[c.killNext++ % c.killTargets.length]; return { method: 'POST', path: '/api/kill-requests', headers: OPS, body: { featureId: t.featureId, featureVersion: t.version, vins: [t.vin], reason: '부하 시험 차단 요청', confirm: t.featureId, reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', containmentJustification: '원인 분석 전 봉쇄' } }; } },
];

// ── 서버 프로세스 ───────────────────────────────────────────────
let server: ChildProcess | null = null;
let serverLog = '';
const ipcWaiters = new Map<string, (m: any) => void>();
function ipc(msg: string): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`탐침 응답 없음: ${msg}`)), 10_000);
    ipcWaiters.set(msg, (m) => (clearTimeout(t), res(m)));
    server!.send(msg);
  });
}

async function startServer(dbFile: string): Promise<number> {
  server = fork(join(FF, 'backend', 'dist', 'main.js'), [], {
    cwd: join(FF, 'backend'),
    env: { ...process.env, ...SEED_ENV, FF_DB: dbFile, PORT: String(PORT), FF_EVIDENCE_DIR: join(LOAD_DIR, 'evidence'), FF_REQUEST_LOG: '0' },
    execArgv: ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(join(FF, 'tools', 'load', 'probe.ts')).href],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout!.on('data', (d) => (serverLog = (serverLog + d).slice(-20_000)));
  server.stderr!.on('data', (d) => (serverLog = (serverLog + d).slice(-20_000)));
  const listening = new Promise<{ uptimeMs: number }>((res) => ipcWaiters.set('listening', res));
  server.on('message', (m: any) => ipcWaiters.get(m?.kind)?.(m));
  const exited = new Promise<never>((_, rej) => server!.once('exit', (c) => rej(new Error(`서버가 종료됨(코드 ${c})\n${serverLog.slice(-3000)}`))));
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`서버가 3분 안에 뜨지 않음\n${serverLog.slice(-3000)}`)), 180_000).unref());
  // 부팅 시간 = 프로세스 시작부터 포트를 연 순간(서버 프로세스 자체 시계) — 마이그레이션·시드 확인·감사 체인 채우기·부팅 sweep 포함
  const { uptimeMs } = await Promise.race([listening, exited, timeout]);
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error(`상태 점검 실패 ${health.status}`);
  return uptimeMs;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise((r) => server!.once('exit', r));
  server.kill('SIGTERM');
  await Promise.race([done, new Promise((r) => setTimeout(r, 10_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

/** 끊긴 keep-alive 연결 재시도 횟수 — 이벤트 루프가 keepAliveTimeout(5 s)보다 오래 막히면 서버가 쉬던 연결을 닫아 다음 요청이 ECONNRESET을 받는다 */
let resets = 0;
async function send(r: ReturnType<Scenario['req']>) {
  const t = performance.now();
  let res: Response | null = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(BASE + r.path, { method: r.method, headers: r.headers ?? AUDITOR, body: r.body === undefined ? undefined : JSON.stringify(r.body) });
    } catch (e) {
      // 요청이 서버에 닿기 전에 끊긴 연결(ECONNRESET)만 다시 보낸다(최대 3번) — 지연은 처음 시각부터 잰다(재시도 비용 포함)
      if ((e as { cause?: { code?: string } }).cause?.code !== 'ECONNRESET' || attempt >= 3) throw e;
      resets++;
    }
  }
  const text = await res.text();
  const ms = performance.now() - t;
  if (res.status >= 300) throw new Error(`${r.method} ${r.path} → ${res.status} ${text.slice(0, 300)}`);
  return { ms, bytes: text.length, text };
}

async function context(): Promise<Ctx> {
  type Scoped = { country: string; vehicleModel: string; trim: string };
  const list = JSON.parse((await send({ method: 'GET', path: '/api/features' })).text).items as ({ featureId: string; version: string } & Scoped)[];
  const fleet = (JSON.parse((await send({ method: 'GET', path: '/api/vehicles' })).text) as { items: ({ vin: string } & Scoped)[] }).items.filter((v) => v.vin.startsWith('LOAD-'));
  const loadVins = fleet.map((v) => v.vin);
  // 차단 요청 대상 — 적용 범위(국가·차종·트림)가 맞는 차량을 한 대씩, 겹치지 않게(진행 중 차단과 겹치면 거부되므로)
  const scope = (x: Scoped) => `${x.country}|${x.vehicleModel}|${x.trim}`;
  const byScope = new Map<string, string[]>();
  for (const v of fleet.slice(P.deliveries)) {
    const k = scope(v);
    if (!byScope.has(k)) byScope.set(k, []);
    byScope.get(k)!.push(v.vin);
  }
  const killTargets: Ctx['killTargets'] = [];
  for (const f of list.filter((x) => x.version === '1.0.0' && x.featureId.startsWith('FEAT-1'))) {
    const vin = byScope.get(scope(f))?.pop();
    if (vin) killTargets.push({ featureId: f.featureId, version: f.version, vin });
  }
  if (!killTargets.length) throw new Error('차단 요청 대상(적용 범위가 맞는 Feature·차량)을 찾지 못했습니다');
  const ev = JSON.parse((await send({ method: 'GET', path: '/api/events?limit=1&after=0' })).text);
  const first = JSON.parse((await send({ method: 'GET', path: '/api/audit?limit=100' })).text);
  return {
    features: list.map((f) => ({ featureId: f.featureId, version: f.version })),
    loadVins,
    killTargets,
    killNext: 0,
    deliveryVins: loadVins.slice(0, P.deliveries),
    maxSeq: Number(ev.total ?? 0) || P.events,
    auditCursor: first.nextCursor ?? null,
    vehicleCursor: JSON.parse((await send({ method: 'GET', path: '/api/vehicles?limit=100' })).text).nextCursor ?? null,
    example: JSON.parse(readFileSync(join(FF, 'harness', 'guide', 'schema', 'examples', 'kill_safety_dc2_eu.ok.json'), 'utf8')),
  };
}

async function runScenario(s: Scenario, c: Ctx, offset = 0): Promise<{ summary: Summary; loop: { p99: number; max: number }; bytes: number; resets: number }> {
  const n = s.write ? Math.max(10, Math.floor(P.requests / 4)) : P.requests;
  const conc = s.write ? 1 : P.concurrency;
  for (let i = 0; i < 3; i++) await send(s.req(10_000 + i, c)); // 예열(질의 계획·JIT)
  await ipc('loop:reset');
  const resets0 = resets;
  const lat: number[] = [];
  let bytes = 0;
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: conc }, async () => {
      // 시나리오마다 벽시계 상한(느린 시나리오가 시험 전체를 붙잡지 않게) — 최소 20회는 잰다
      for (let i = next++; i < n && (lat.length < 20 || performance.now() - t0 < SCENARIO_CAP_MS); i = next++) {
        const r = await send(s.req(i + offset, c));
        lat.push(r.ms);
        bytes = Math.max(bytes, r.bytes);
      }
    }),
  );
  const wall = performance.now() - t0;
  const loop = await ipc('loop:read');
  return { summary: summarize(lat, wall), loop: { p99: loop.p99, max: loop.max }, bytes, resets: resets - resets0 };
}

export function readBudgets(): BudgetFile {
  return JSON.parse(readFileSync(BUDGETS_FILE, 'utf8')) as BudgetFile;
}

async function main() {
  const seeded = await seedFor(NAME);
  const runDb = join(LOAD_DIR, `run-${NAME}.db`);
  for (const s of ['', '-wal', '-shm']) rmSync(runDb + s, { force: true });
  copyFileSync(seeded, runDb);
  const budgets = readBudgets();
  const results: { id: string; title: string; summary: Summary; loop: { p99: number; max: number }; bytes: number; resets: number; retried: boolean }[] = [];
  let bootMs = 0;
  try {
    bootMs = await startServer(runDb);
    console.log(`부하 시험(${NAME}) — 서버 부팅 ${bootMs} ms, 요청 ${P.requests}회 × 동시 ${P.concurrency} (${BASE})`);
    const c = await context();
    for (const s of SCENARIOS) {
      if (ONLY && !ONLY.includes(s.id)) continue;
      let r = await runScenario(s, c);
      // 예산을 넘으면 한 번 다시 잰다 — 같은 기계의 다른 작업(빌드·시험) 잡음을 걸러 낸다. 두 번 다 넘어야 실패(재측정 값으로 판정·기록)
      const limit = budgets.p95Ms[s.id] === undefined ? Infinity : budgets.p95Ms[s.id] * P.budgetScale;
      let retried = false;
      if (r.summary.p95 > limit) {
        console.log(`  ${s.id.padEnd(22)} p95 ${r.summary.p95} ms > 예산 ${limit} ms — 다시 잰다`);
        // 다른 요청 번호로(같은 차량·같은 부팅 보고를 되풀이하면 멱등 응답이라 측정이 가벼워진다)
        r = await runScenario(s, c, 100_000);
        retried = true;
      }
      results.push({ id: s.id, title: s.title, ...r, retried });
      console.log(`  ${s.id.padEnd(22)} p50 ${String(r.summary.p50).padStart(7)} · p95 ${String(r.summary.p95).padStart(7)} · p99 ${String(r.summary.p99).padStart(7)} ms · ${String(r.summary.rps).padStart(7)} req/s · 루프 막힘 최대 ${r.loop.max} ms · 응답 ${(r.bytes / 1024).toFixed(1)} KiB${r.resets ? ` · 연결 끊김 ${r.resets}` : ''}${retried ? ' · 재측정' : ''}`);
    }
  } finally {
    await stopServer();
    if (!process.argv.includes('--keep')) for (const s of ['', '-wal', '-shm']) rmSync(runDb + s, { force: true });
  }
  const verdicts = judge(results, budgets, P.budgetScale);
  const bootLimit = budgets.bootMs !== undefined ? Math.round(budgets.bootMs * P.budgetScale) : null;
  const bootOk = bootLimit === null || bootMs <= bootLimit;
  const report = { generatedAt: new Date().toISOString(), profile: NAME, size: P, bootMs, bootLimit, results, verdicts };
  writeFileSync(join(LOAD_DIR, `report-${NAME}.json`), JSON.stringify(report, null, 1));
  if (process.argv.includes('--md')) {
    console.log('\n| 시나리오 | p50 | p95 | p99 | req/s | 루프 막힘 최대 | 예산 p95 |\n|---|---:|---:|---:|---:|---:|---:|');
    for (const r of results) {
      const v = verdicts.find((x) => x.id === r.id)!;
      console.log(`| ${r.id} | ${r.summary.p50} | ${r.summary.p95} | ${r.summary.p99} | ${r.summary.rps} | ${r.loop.max} | ${v.budget ?? '—'} |`);
    }
  }
  const bad = verdicts.filter((v) => !v.ok);
  if (!bootOk) console.error(`✕ 부팅 ${bootMs} ms > 예산 ${bootLimit} ms`);
  for (const v of bad) console.error(v.budget === null ? `✕ ${v.id}: 예산 없음 — harness/perf-budgets.json에 p95 예산을 넣는다` : `✕ ${v.id}: p95 ${v.p95} ms > 예산 ${v.budget} ms (×${P.budgetScale})`);
  if (bad.length || !bootOk) process.exit(1);
  console.log(`✓ 성능 예산 통과(${NAME}, ${verdicts.length}개 시나리오, 예산 ×${P.budgetScale})`);
}

if (import.meta.main) {
  main().catch(async (e) => {
    console.error(e);
    if (serverLog) console.error(`── 서버 로그(끝) ──
${serverLog.slice(-4000)}`);
    await stopServer();
    process.exit(1);
  });
}

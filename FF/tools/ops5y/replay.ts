// npm run ops5y:build — 5년 운영 재생. 빌드된 백엔드를 이 프로세스 안에 띄우고(파일 DB, 수동 시계·스케줄러),
// 개시일(오늘−5년)부터 오늘까지 하루씩 실제 API로 운영한다. 끝나면 불변식을 확인하고 DB·보고서를 남긴다.
//   결과: .sim/ops5y.db(재생 DB) · .sim/ops5y-report.json(전체) · docs/80-integration/ops5y-report.md(요약, 커밋)
//   옵션: --sample 50000 --receivers 200 --days <일수> --end <YYYY-MM-DD> --out .sim/ops5y.db
// 불변식이 하나라도 어긋나면 DB를 교체하지 않고 종료 코드 1. 재생 DB로 띄우기: npm run dev:backend:ops5y
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { FF } from '../lib.ts';

const require = createRequire(import.meta.url);
const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const END = arg('end', kstToday());
const SAMPLE = Number(arg('sample', '50000'));
const RECEIVERS = Number(arg('receivers', '200'));
const DAYS = process.argv.includes('--days') ? Number(arg('days', '0')) : undefined;
const OUT = resolve(FF, arg('out', '.sim/ops5y.db'));
const BUILDING = `${OUT}.building`;
const EVIDENCE = join(FF, '.sim', 'ops5y-evidence');

const contracts = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');
const START = contracts.platformStart(END);

for (const f of [BUILDING, `${BUILDING}-wal`, `${BUILDING}-shm`]) rmSync(f, { force: true });
mkdirSync(dirname(OUT), { recursive: true });
rmSync(EVIDENCE, { recursive: true, force: true });
mkdirSync(EVIDENCE, { recursive: true });
Object.assign(process.env, {
  FF_DB: BUILDING,
  FF_SEED: 'v0.81',
  FF_DATASET: 'ops5y',
  FF_SYNTHETIC: '0',
  FF_SCHEDULER: 'manual',
  FF_CLOCK_AT: `${START}T00:00:00.000Z`,
  FF_SEED_ANCHOR: END,
  FF_BOOT_PUBLISH: '0',
  GLEO_MODE: 'internal',
  UNLEASH_MODE: 'mock',
  SIM_MODE: 'auto',
  CARLA_RUNNER: join(FF, 'backend', 'test', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: EVIDENCE,
});

const dist = (p: string) => require(join(FF, 'backend', 'dist', p));
const { createApp } = dist('app.factory.js');
const { replay } = dist('ops5y/engine.js');
const { checkInvariants } = dist('ops5y/invariants.js');
const { Clock } = dist('kernel/clock.js');
const { Scheduler } = dist('kernel/scheduler.js');
const { DB } = dist('kernel/db.js');
const { AuditService } = dist('kernel/audit.service.js');
const { RetentionService } = dist('domains/d04-ops/telemetry-ingest/retention.service.js');
const { TrialExpiryService } = dist('domains/d01-policy/entitlement/trial-expiry.service.js');

const app = await createApp({ logger: false });
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
console.log(`5년 운영 재생 — ${START} → ${END}, 표본 ${SAMPLE.toLocaleString('ko-KR')}대 · 수신 ${RECEIVERS}대 (${base})`);

const api = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed };
};

const launches = JSON.parse(readFileSync(join(FF, 'data', 'fixtures', 'ops5y', 'launches.json'), 'utf8'));
const report = await replay(
  api,
  {
    clock: app.get(Clock),
    scheduler: app.get(Scheduler),
    db: app.get(DB),
    trialSweep: (today: string) => app.get(TrialExpiryService).sweep(today),
    retentionSweep: () => app.get(RetentionService).sweep({ id: 'system', role: 'SYSTEM', correlationId: 'ops5y-retention' }),
  },
  { end: END, days: DAYS, sample: SAMPLE, receivers: RECEIVERS, launches, log: (l: string) => console.log(l) },
);
const invariants = checkInvariants(app.get(DB), app.get(AuditService), report, { populationTolerance: DAYS ? 0.15 : 0.03 });
const counts = Object.fromEntries(
  ['audit', 'policy', 'publication', 'readback', 'entitlement', 'vehicle_profile', 'vehicle', 'kill_request', 'anomaly', 'notification', 'events', 'rollback_execution', 'validation_run', 'virtual_run'].map((t) => {
    try {
      return [t, app.get(DB).get(`SELECT count(*) AS n FROM ${t}`).n];
    } catch {
      return [t, null];
    }
  }),
);
await app.close();

const ok = invariants.every((x: { ok: boolean }) => x.ok);
const full = { generatedAt: new Date().toISOString(), options: { end: END, start: START, sample: SAMPLE, receivers: RECEIVERS, days: report.days }, counts, invariants, report };
writeFileSync(join(FF, '.sim', 'ops5y-report.json'), JSON.stringify(full, null, 1));

const ops = Object.entries(report.years as Record<string, Record<string, { ok: number; refused: number }>>);
const kinds = [...new Set(ops.flatMap(([, y]) => Object.keys(y)))];
const md = [
  '# 5년 운영 재생 보고서',
  '',
  `> 생성: \`npm run ops5y:build\` — ${START} → ${report.end} (${report.days}일), 표본 ${report.sample.toLocaleString('ko-KR')}대 · 수신 표본 ${report.receivers}대, 소요 ${Math.round(report.elapsedMs / 60000)}분.`,
  '> 이력은 실제 API로 만들었다(가드·직무 분리·감사·이벤트가 실제로 걸림). 비율·일정은 가정값 — `contracts/src/rules/population.ts`, `data/fixtures/ops5y/launches.json`.',
  '',
  '## 불변식',
  '',
  '| ID | 확인 | 결과 | 내용 |',
  '|---|---|---|---|',
  ...invariants.map((x: { id: string; title: string; ok: boolean; detail: string }) => `| ${x.id} | ${x.title} | ${x.ok ? 'PASS' : '**FAIL**'} | ${x.detail} |`),
  '',
  '## 연도별 작업 (성공 / 거부)',
  '',
  `| 작업 | ${ops.map(([y]) => y).join(' | ')} |`,
  `|---|${ops.map(() => '---').join('|')}|`,
  ...kinds.map((k) => `| ${k} | ${ops.map(([, y]) => (y[k] ? `${y[k].ok} / ${y[k].refused}` : '—')).join(' | ')} |`),
  '',
  '## 거부 사유 상위 (가드가 실제로 막은 것 — 결함 아님)',
  '',
  ...Object.entries(
    (report.refusals as { op: string; code: string | null; message: string }[]).reduce<Record<string, number>>((a, x) => {
      const k = `${x.op} · ${x.code ?? '-'} · ${x.message.slice(0, 80)}`;
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, n]) => `- ${n}건 — ${k}`),
  '',
  '## 운영 중 드러난 문제 (요청은 받아들여졌지만 결과가 막힘)',
  '',
  ...((report.findings as { at: string; kind: string; detail: string }[]).filter((f) => f.kind !== '키 교체').map((f) => `- ${f.at} ${f.kind} — ${f.detail}`) || []),
  `- 서명 키 정기 교체 ${(report.findings as { kind: string }[]).filter((f) => f.kind === '키 교체').length}건(만료 30일 전, 용도별)`,
  '',
  '## 저장 건수',
  '',
  ...Object.entries(counts).map(([t, n]) => `- ${t}: ${n === null ? '—' : Number(n).toLocaleString('ko-KR')}`),
  '',
  `긴급 차단 ${report.kills.length}건: ${report.kills.map((k: { killId: string; featureId: string; at: string; restoredAt: string | null }) => `${k.killId} ${k.featureId} ${k.at} → 복구 ${k.restoredAt ?? '미복구'}`).join(' · ')}`,
  '',
].join('\n');
const docs = join(FF, '..', 'docs', '80-integration');
if (!DAYS && existsSync(docs)) writeFileSync(join(docs, 'ops5y-report.md'), md);
console.log(md.split('## 연도별')[0]);

if (!ok) {
  console.error('불변식 실패 — 재생 DB를 교체하지 않는다:', BUILDING);
  process.exit(1);
}
for (const f of [OUT, `${OUT}-wal`, `${OUT}-shm`]) rmSync(f, { force: true });
renameSync(BUILDING, OUT);
for (const s of ['-wal', '-shm']) if (existsSync(`${BUILDING}${s}`)) renameSync(`${BUILDING}${s}`, `${OUT}${s}`);
console.log(`재생 DB: ${OUT}`);

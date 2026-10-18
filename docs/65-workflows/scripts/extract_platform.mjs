// 플랫폼 인증·권한(/admin/iam) → _source/platform_iam.json 사실 스냅샷.
//
// 기준은 실행 중인 FF의 IAM 화면이 쓰는 API(/api/iam/roles, /api/iam/sod-audit)다.
// 화면에 보이는 역할·권한표와 업무 절차의 정합성은 이 스냅샷으로 검사한다.
// Gate·수명주기 전이·보고서 승인 역할처럼 IAM API가 주지 않는 표는 contracts/dist에서 읽고,
// dist의 permissions()와 실행 중 서버의 차이를 dist_diff로 남긴다.
//
// 사용: node scripts/extract_platform.mjs [--url http://localhost:9012] [--ff C:/project/2026-06-04_Feature_Platform/FF]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_source', 'platform_iam.json');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const url = arg('--url', 'http://localhost:9012');
const ff = resolve(arg('--ff', 'C:/project/2026-06-04_Feature_Platform/FF'));

async function get(path) {
  const res = await fetch(url + path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function gitHead(dir) {
  try {
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--short', 'contracts', 'backend/src'], { encoding: 'utf8' }).trim();
    return { head, dirty_files: dirty ? dirty.split('\n').length : 0 };
  } catch {
    return null;
  }
}

const iam = await get('/api/iam/roles');
const sodAudit = await get('/api/iam/sod-audit');
const health = await get('/api/health');

const distIndex = join(ff, 'contracts', 'dist', 'index.js');
const c = createRequire(import.meta.url)(distIndex);
const live = new Map(iam.permissions.map((p) => [p.name, [...p.roles].sort().join()]));
const dist = new Map(c.permissions().map((p) => [p.name, [...p.roles].sort().join()]));
const distDiff = [
  ...[...dist.keys()].filter((k) => !live.has(k)).map((name) => ({ name, kind: 'dist-only' })),
  ...[...live.keys()].filter((k) => !dist.has(k)).map((name) => ({ name, kind: 'live-only' })),
  ...[...live.keys()].filter((k) => dist.has(k) && dist.get(k) !== live.get(k)).map((name) => ({ name, kind: 'roles-differ' })),
];

// 화면 경로: 프론트 라우트 표(routes.tsx)의 { path, title, group }. 이전 주소(legacyTo)와 BDC 데모(/twin, 금지어)는 뺀다.
const routesTsx = readFileSync(join(ff, 'frontend', 'src', 'routes.tsx'), 'utf8');
const screens = [...routesTsx.matchAll(/\{ path: '([^']+)', element: (?!legacyTo)[^\n]*?title: '([^']+)', group: '([^']+)'/g)]
  .map(([, path, title, group]) => ({ path, title, group }))
  .filter((s) => !s.path.startsWith('/twin') && !s.path.startsWith('/_'));

const data = {
  source: {
    iam_url: `${url}/admin/iam`,
    api: ['/api/iam/roles', '/api/iam/sod-audit'],
    fetched_at: new Date().toISOString(),
    server_seed: health.seed ?? null,
    contracts_dist: distIndex,
    contracts_dist_mtime: statSync(distIndex).mtime.toISOString(),
    ff_git: gitHead(ff),
    iam_sha256: createHash('sha256').update(JSON.stringify(iam)).digest('hex'),
  },
  roles: iam.roles.map(({ role, label, human }) => ({ role, label, human })),
  permissions: iam.permissions.map(({ name, method, path, summary, component, roles }) => ({ name, method, path, summary, component, roles })),
  sod: iam.sod,
  duties: sodAudit.duties,
  accounts: sodAudit.accounts,
  report_approver_roles: c.REPORT_APPROVER_ROLES,
  gates: Object.entries(c.GATE_META).map(([id, g]) => ({ id, ...g })),
  lifecycle: c.LIFECYCLE,
  transitions: c.FEATURE_TRANSITIONS.map(({ from, to, gates, roles, auto, ko }) => ({ from, to, gates, roles, auto, ko })),
  screens,
  dist_diff: distDiff,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n', 'utf8');
console.log(`roles=${data.roles.length} permissions=${data.permissions.length} sod=${data.sod.length} screens=${screens.length} accounts=${Object.keys(data.accounts).length} dist_diff=${distDiff.length} → ${OUT}`);
for (const d of distDiff) console.log(`  dist↔live 차이: ${d.kind} ${d.name}`);

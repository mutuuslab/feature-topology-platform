// 배포본 구성 회귀 (verify `packaging`) — 데스크톱 설치 파일·단독 설치 이미지에 들어갈 것과 빠질 것.
//   · 데스크톱 ui에 정적 데모 스냅샷(api-snapshot)이 없다 — 3,815개 사본이 실리고 긴 이름이 NSIS 경로 길이 실패를 냈다(2026-11-04)
//   · resources 상대 경로 ≤ 150자, 정적 데모 스냅샷 파일 이름 ≤ 125자
//   · 백엔드가 실행 중 읽는 data/<폴더>가 Dockerfile COPY와 desktop-prepare 복사 목록에 모두 있다(이전본 data/reference가 빠졌던 회귀)
//   · 이미지 CI가 준비 점검에서 Feature DB(checks.refdb)를 단언하고, 데스크톱 빌드는 준비 뒤 패키지 스모크를 돈다
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyUi, longPaths, MAX_RESOURCE_PATH, RESOURCES, RUNTIME_DATA, UI_EXCLUDE } from './desktop-prepare.mjs';

const FF = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_FILE_MAX = 125; // contracts SNAPSHOT_NAME_MAX(120) + '.json'

function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'ff-packaging-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const put = (p, text = 'x') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

test('데스크톱 ui 복사는 최상위 api-snapshot(정적 데모 전용)을 뺀다', () => {
  const t = temp();
  try {
    const dist = join(t.dir, 'dist');
    put(join(dist, 'index.html'));
    put(join(dist, 'assets', 'app.js'));
    put(join(dist, 'assets', 'api-snapshot', 'keep.txt')); // 최상위가 아니면 그대로
    put(join(dist, 'api-snapshot', 'features.json'));
    const ui = join(t.dir, 'ui');
    copyUi(dist, ui);
    assert.deepEqual(readdirSync(ui).sort(), ['assets', 'index.html']);
    assert.ok(existsSync(join(ui, 'assets', 'api-snapshot', 'keep.txt')));
    assert.deepEqual(UI_EXCLUDE, ['api-snapshot']);
  } finally { t.cleanup(); }
});

test('경로 길이 검사는 150자를 넘는 resources 상대 경로를 잡는다', () => {
  const t = temp();
  try {
    put(join(t.dir, 'ui', 'short.json'));
    const long = `ui/api-snapshot/${'a'.repeat(MAX_RESOURCE_PATH)}.json`;
    put(join(t.dir, ...long.split('/')));
    assert.deepEqual(longPaths(t.dir), [long]);
    assert.deepEqual(longPaths(join(t.dir, 'no-such')), []);
  } finally { t.cleanup(); }
});

test('준비된 데스크톱 resources(있으면) — ui에 api-snapshot 없음, 모든 상대 경로 ≤ 150자', (t) => {
  if (!existsSync(join(RESOURCES, 'ui'))) return t.skip('src-tauri/resources 없음 — npm run desktop:prepare(Windows) 뒤에 검사');
  assert.equal(existsSync(join(RESOURCES, 'ui', 'api-snapshot')), false, 'ui/api-snapshot이 실렸다 — npm run desktop:prepare로 다시 준비');
  assert.deepEqual(longPaths(RESOURCES), []);
});

test('정적 데모 스냅샷 파일 이름 ≤ 125자 (public·dist-static)', () => {
  let seen = 0;
  for (const d of ['frontend/public/api-snapshot', 'frontend/dist-static/api-snapshot']) {
    const dir = join(FF, ...d.split('/'));
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
    seen += names.length;
    assert.deepEqual(names.filter((n) => n.length > SNAPSHOT_FILE_MAX), [], `${d} 이름이 ${SNAPSHOT_FILE_MAX}자를 넘는다`);
  }
  assert.ok(seen > 0, '스냅샷 폴더가 없다 — npm run snapshot:api');
});

// ── 백엔드가 읽는 data/ 폴더 ⊆ Dockerfile COPY ∩ desktop-prepare 복사 목록
const DATA_JOIN = /join\(\s*__dirname\s*,(?:\s*'\.\.'\s*,)*\s*'data'\s*,\s*'([^']+)'/g;
/** 소스 본문들에서 join(__dirname, …, 'data', '<x>') 의 <x> */
export function dataDirs(sources) {
  const out = new Set();
  for (const s of sources) for (const m of s.matchAll(DATA_JOIN)) out.add(m[1]);
  return [...out].sort();
}
/** dirs 중 Dockerfile COPY data/<x> 또는 desktop 목록에 빠진 것 */
export function missingCopies(dirs, dockerfile, runtimeData) {
  const out = [];
  for (const d of dirs) {
    if (!new RegExp(`^COPY\\s+data/${d}\\s`, 'm').test(dockerfile)) out.push(`Dockerfile COPY data/${d}`);
    if (!runtimeData.includes(d)) out.push(`desktop-prepare RUNTIME_DATA ${d}`);
  }
  return out;
}
function backendSources(dir = join(FF, 'backend', 'src')) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...backendSources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

test('백엔드가 실행 중 읽는 data/<폴더>는 이미지(Dockerfile)와 데스크톱(desktop-prepare) 모두에 실린다', () => {
  const dirs = dataDirs(backendSources());
  assert.ok(dirs.includes('fixtures') && dirs.includes('reference'), `찾은 폴더: ${dirs.join(', ')}`);
  const dockerfile = readFileSync(join(FF, 'docker', 'app', 'Dockerfile'), 'utf8');
  assert.deepEqual(missingCopies(dirs, dockerfile, RUNTIME_DATA), []);
});

test('data 폴더 검사는 한쪽에 빠진 폴더를 잡는다', () => {
  const src = [`const A = join(__dirname, '..', '..', 'data', 'fixtures', 'x.json');`, `const B = join(__dirname, '..', 'data', 'reference', 'feature-db');`, `const C = join(__dirname, '..', 'data', 'models');`];
  assert.deepEqual(dataDirs(src), ['fixtures', 'models', 'reference']);
  const dockerfile = 'COPY data/fixtures ./data/fixtures\nCOPY data/reference ./data/reference\n';
  assert.deepEqual(missingCopies(dataDirs(src), dockerfile, ['fixtures', 'reference']), ['Dockerfile COPY data/models', 'desktop-prepare RUNTIME_DATA models']);
  assert.deepEqual(missingCopies(['reference'], 'COPY data/fixtures ./data/fixtures\n', ['fixtures']), ['Dockerfile COPY data/reference', 'desktop-prepare RUNTIME_DATA reference']);
});

test('이미지 CI는 준비 점검에서 Feature DB 시드(checks.refdb.ok)를 단언한다', (t) => {
  const wf = join(FF, '..', '.github', 'workflows', 'app-image.yml');
  if (!existsSync(wf)) return t.skip('저장소 루트 .github 없음(FF만 복사한 작업 폴더)');
  const text = readFileSync(wf, 'utf8');
  assert.match(text, /checks\.refdb\.ok == true and \.checks\.refdb\.rows > 0/);
  assert.match(text, /\/api\/health\/ready/);
});

test('데스크톱 빌드는 자산 준비 뒤 패키지 스모크(desktop:smoke)를 돈다', () => {
  const conf = JSON.parse(readFileSync(join(FF, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.match(conf.build.beforeBuildCommand, /desktop:prepare\s*&&\s*npm run desktop:smoke/);
});

test('Docker Vite 설정의 로컬 빌드 도구는 문맥·build COPY에 있고 runtime에는 없다', () => {
  const dockerfile = readFileSync(join(FF, 'docker', 'app', 'Dockerfile'), 'utf8');
  const ignore = readFileSync(join(FF, '.dockerignore'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const inContext = file => {
    const parts = file.split('/'), ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    let included = true;
    for (const rule of ignore) {
      const keep = rule.startsWith('!'), pattern = (keep ? rule.slice(1) : rule).replace(/^\/|\/$/g, '');
      if (ancestors.some(path => matchesGlob(path, pattern))) included = keep;
    }
    return included;
  };
  const required = new Set(), seen = new Set();
  const scan = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\(\s*)['"](\.[^'"]+)['"]/g)) {
      const base = resolve(dirname(file), m[1]);
      const dependency = [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts')].find(p => existsSync(p) && statSync(p).isFile());
      assert.ok(dependency, `Vite 로컬 의존 파일 없음: ${m[1]}`);
      const path = relative(FF, dependency).replace(/\\/g, '/');
      if (!path.startsWith('tools/')) continue;
      required.add(path); scan(dependency);
    }
  };
  scan(join(FF, 'frontend', 'vite.config.ts'));
  assert.ok(required.has('tools/browser-routes.ts'));
  const build = /^FROM deps AS build\s*$([\s\S]*?)(?=^FROM\s)/m.exec(dockerfile)?.[1] ?? '';
  for (const file of required) {
    assert.ok(inContext(file), `.dockerignore excludes Vite build input: ${file}`);
    const copies = [...build.matchAll(/^COPY\s+(\S+)\s+(\S+)\s*$/gm)];
    assert.ok(copies.some(([, source, target]) => source === file && [file, './' + file, dirname(file).replace(/\\/g, '/') + '/', './' + dirname(file).replace(/\\/g, '/') + '/'].includes(target)), `build COPY missing Vite input: ${file}`);
  }
  for (const file of ['tools/verify.ts', 'tools/browser-routes.test.ts', 'tools/unleash/server-package.json']) assert.equal(inContext(file), false, `${file} must stay outside the build context`);
  const runtime = /^FROM .* AS runtime\s*$([\s\S]*)/m.exec(dockerfile)?.[1] ?? '';
  assert.doesNotMatch(runtime, /^COPY\b[^\r\n]*\btools(?:\/|\s|$)/m, 'runtime must not copy build tools');
});

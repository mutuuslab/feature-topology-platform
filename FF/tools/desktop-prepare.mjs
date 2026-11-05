// Windows 데스크톱 배포 자산을 재생성한다. 기존 데이터베이스는 이 폴더에 두지 않는다.
// 가져다 쓰는 규칙(ui 제외 목록·data 폴더·경로 길이)은 내보내 tools/packaging.test.mjs가 Windows 밖에서도 검사한다.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareAssets, archiveAssets } from './unleash/prepare.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RESOURCES = join(root, 'src-tauri', 'resources');

/** ui에 넣지 않는 frontend/dist 최상위 폴더 — api-snapshot은 정적 데모(공개 사이트) 전용 응답 사본(약 3,800개, 긴 이름이 NSIS 경로 길이 실패의 원인) */
export const UI_EXCLUDE = ['api-snapshot'];
/** 백엔드가 실행 중 읽는 data/ 폴더 — Dockerfile COPY와 같아야 한다(packaging.test.mjs) */
// source — SW 개발비 산정 엑셀 내보내기 양식(원본 엑셀 v1.3, 20-94 D-COST-14)
export const RUNTIME_DATA = ['fixtures', 'reference', 'source'];
/** resources 기준 상대 경로 상한 — 설치 폴더(%LOCALAPPDATA%\Programs\Feature Platform\)를 더해도 Windows MAX_PATH 260 안 */
export const MAX_RESOURCE_PATH = 150;

/** frontend/dist → ui (UI_EXCLUDE 최상위 폴더 제외) */
export function copyUi(dist, ui) {
  cpSync(dist, ui, { recursive: true, filter: (src) => !UI_EXCLUDE.includes(relative(dist, src).split(sep)[0]) });
}

/** dir 아래 파일의 상대 경로(/ 구분) 중 max자보다 긴 것 */
export function longPaths(dir, max = MAX_RESOURCE_PATH) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const r = relative(dir, p).split(sep).join('/');
        if (r.length > max) out.push(r);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

async function prepare() {
  const runtime = join(RESOURCES, 'runtime');
  const ui = join(RESOURCES, 'ui');
  if (process.platform !== 'win32') throw new Error('현재 데스크톱 패키징은 Windows만 지원합니다.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 이상이 필요합니다.');

  function run(command, args, cwd = root, env = process.env) {
    const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const result = spawnSync(command === 'npm.cmd' ? process.execPath : command, command === 'npm.cmd' ? [npmCli, ...args] : args, { cwd, env, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  }
  const npm = 'npm.cmd';
  const prebuilt = process.env.FF_DESKTOP_PREBUILT === '1';
  const uiSource = prebuilt && process.env.FF_DESKTOP_UI_SOURCE?.trim() ? resolve(process.env.FF_DESKTOP_UI_SOURCE) : join(root, 'frontend', 'dist');
  if (!prebuilt) {
    run(npm, ['run', 'build:contracts']);
    run(npm, ['run', 'build', '-w', 'feature-topology-backend']);
    // 데스크톱 배포본 표시 — 42 컴포넌트 아키텍처 화면 등 배포본 제외 화면을 뺀다(frontend/src/routes.tsx).
    run(npm, ['run', 'build', '-w', 'feature-topology-frontend'], root, { ...process.env, VITE_FF_DESKTOP: '1' });
  } else {
    // Coordinated integration packaging consumes the canonical build without overwriting another verifier's dist.
    for (const file of ['contracts/dist/index.js', 'backend/dist/main.js']) if (!existsSync(join(root, file))) throw new Error(`Prebuilt desktop input missing: ${file}`);
  }
  if (!existsSync(join(uiSource, 'index.html'))) throw new Error('Desktop UI input is missing index.html');

  // 이 경로는 배포용 생성물 전용이며 사용자 데이터는 OS 앱 데이터 폴더에 저장한다.
  if (process.env.FF_DESKTOP_PRESERVE_RESOURCES === '1' && existsSync(RESOURCES)) {
    if (lstatSync(RESOURCES).isSymbolicLink()) throw new Error('Desktop resources must not be a symbolic link');
    const backup = resolve(root, '.unleash-runtime/resource-backups', `${Date.now()}`);
    if (!backup.startsWith(`${root}${sep}`) || RESOURCES !== resolve(root, 'src-tauri/resources')) throw new Error('Desktop backup escaped the workspace');
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(RESOURCES, backup);
    console.log(`Preserved previous desktop resources: ${backup}`);
  } else rmSync(RESOURCES, { recursive: true, force: true });
  mkdirSync(runtime, { recursive: true });
  copyUi(uiSource, ui);
  cpSync(process.execPath, join(runtime, 'node.exe'));
  for (const file of ['package.json', 'package-lock.json']) cpSync(join(root, file), join(runtime, file));
  for (const workspace of ['backend', 'frontend', 'contracts', 'e2e']) {
    mkdirSync(join(runtime, workspace), { recursive: true });
    cpSync(join(root, workspace, 'package.json'), join(runtime, workspace, 'package.json'));
  }
  cpSync(join(root, 'backend', 'dist'), join(runtime, 'backend', 'dist'), { recursive: true });
  cpSync(join(root, 'contracts', 'dist'), join(runtime, 'contracts', 'dist'), { recursive: true });
  cpSync(join(root, 'tools', 'unleash'), join(runtime, 'tools', 'unleash'), { recursive: true });
  const reusedAssets = process.env.FF_SIDECAR_ASSETS_SOURCE?.trim();
  const sidecarStage = reusedAssets ? resolve(reusedAssets) : join(root, '.unleash-runtime', 'desktop-assets');
  // Staging is outside installer resources; upstream distribution filenames can exceed NSIS path limits.
  if (reusedAssets) {
    const expected = JSON.parse(readFileSync(join(root, 'tools/unleash/pins.json'), 'utf8'));
    const actual = JSON.parse(readFileSync(join(sidecarStage, 'pins.json'), 'utf8'));
    for (const asset of ['server', 'edge', 'postgres']) if (actual[asset].version !== expected[asset].version) throw new Error(`Reused sidecar ${asset} version mismatch`);
    for (const file of ['server/node_modules/unleash-server/dist/server.js', 'edge/unleash-edge.exe', 'postgres/bin/initdb.exe', 'postgres/bin/pg_ctl.exe', 'postgres/lib/dict_snowball.dll', 'notices/SOURCES.json']) if (!existsSync(join(sidecarStage, file))) throw new Error(`Reused sidecar input missing: ${file}`);
    const server = JSON.parse(readFileSync(join(sidecarStage, 'server/node_modules/unleash-server/package.json'), 'utf8'));
    if (server.version !== expected.server.version) throw new Error('Reused official Unleash package version mismatch');
    console.log('Reusing prepared official sidecar assets; no download or source rebuild.');
  } else await prepareAssets(sidecarStage);
  archiveAssets(sidecarStage, join(runtime, 'sidecars.tar.gz'));
  cpSync(join(sidecarStage, 'notices'), join(runtime, 'sidecar-notices'), { recursive: true });
  for (const d of RUNTIME_DATA) cpSync(join(root, 'data', d), join(runtime, 'data', d), { recursive: true });
  run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);

  // 워크스페이스 junction은 설치 위치를 가리킬 수 있으므로 계약 패키지만 실제 파일로 포함한다.
  for (const name of ['@ff/contracts', '@ff/e2e', 'feature-topology-backend', 'feature-topology-frontend']) {
    const path = join(runtime, 'node_modules', ...name.split('/'));
    if (existsSync(path) || (() => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } })()) rmSync(path, { recursive: true, force: true });
  }
  const contract = join(runtime, 'node_modules', '@ff', 'contracts');
  mkdirSync(contract, { recursive: true });
  cpSync(join(runtime, 'contracts', 'package.json'), join(contract, 'package.json'));
  cpSync(join(runtime, 'contracts', 'dist'), join(contract, 'dist'), { recursive: true });
  writeFileSync(join(RESOURCES, 'build-info.json'), JSON.stringify({ node: process.versions.node, platform: process.platform, arch: process.arch, prebuilt, sidecarsReused: !!reusedAssets, sourceCommit: process.env.FF_BUILD_SHA ?? null }, null, 2));
  // 설치 파일(NSIS)이 긴 경로에서 실패하기 전에 여기서 멈춘다(2026-11-04 회귀: 스냅샷 이름 181자)
  const long = longPaths(RESOURCES);
  if (long.length) throw new Error(`resources 상대 경로가 ${MAX_RESOURCE_PATH}자를 넘는다 ${long.length}개 — ${long.slice(0, 3).join(', ')}`);
  console.log(`데스크톱 배포 자산 준비: ${RESOURCES}`);
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('tools/desktop-prepare.mjs')) await prepare();

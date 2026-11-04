// Windows 데스크톱 배포 자산을 재생성한다. 기존 데이터베이스는 이 폴더에 두지 않는다.
// 가져다 쓰는 규칙(ui 제외 목록·data 폴더·경로 길이)은 내보내 tools/packaging.test.mjs가 Windows 밖에서도 검사한다.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

function prepare() {
  const runtime = join(RESOURCES, 'runtime');
  const ui = join(RESOURCES, 'ui');
  if (process.platform !== 'win32') throw new Error('현재 데스크톱 패키징은 Windows만 지원합니다.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 이상이 필요합니다.');

  function run(command, args, cwd = root, env = process.env) {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  }
  const npm = 'npm.cmd';
  run(npm, ['run', 'build:contracts']);
  run(npm, ['run', 'build', '-w', 'feature-topology-backend']);
  // 데스크톱 배포본 표시 — 42 컴포넌트 아키텍처 화면 등 배포본 제외 화면을 뺀다(frontend/src/routes.tsx).
  run(npm, ['run', 'build', '-w', 'feature-topology-frontend'], root, { ...process.env, VITE_FF_DESKTOP: '1' });

  // 이 경로는 배포용 생성물 전용이며 사용자 데이터는 OS 앱 데이터 폴더에 저장한다.
  rmSync(RESOURCES, { recursive: true, force: true });
  mkdirSync(runtime, { recursive: true });
  copyUi(join(root, 'frontend', 'dist'), ui);
  cpSync(process.execPath, join(runtime, 'node.exe'));
  for (const file of ['package.json', 'package-lock.json']) cpSync(join(root, file), join(runtime, file));
  for (const workspace of ['backend', 'frontend', 'contracts', 'e2e']) {
    mkdirSync(join(runtime, workspace), { recursive: true });
    cpSync(join(root, workspace, 'package.json'), join(runtime, workspace, 'package.json'));
  }
  cpSync(join(root, 'backend', 'dist'), join(runtime, 'backend', 'dist'), { recursive: true });
  cpSync(join(root, 'contracts', 'dist'), join(runtime, 'contracts', 'dist'), { recursive: true });
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
  writeFileSync(join(RESOURCES, 'build-info.json'), JSON.stringify({ node: process.versions.node, platform: process.platform, arch: process.arch }, null, 2));
  // 설치 파일(NSIS)이 긴 경로에서 실패하기 전에 여기서 멈춘다(2026-11-04 회귀: 스냅샷 이름 181자)
  const long = longPaths(RESOURCES);
  if (long.length) throw new Error(`resources 상대 경로가 ${MAX_RESOURCE_PATH}자를 넘는다 ${long.length}개 — ${long.slice(0, 3).join(', ')}`);
  console.log(`데스크톱 배포 자산 준비: ${RESOURCES}`);
}

if (import.meta.main ?? process.argv[1]?.replace(/\\/g, '/').endsWith('tools/desktop-prepare.mjs')) prepare();

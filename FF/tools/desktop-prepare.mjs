// Windows 데스크톱 배포 자산을 재생성한다. 기존 데이터베이스는 이 폴더에 두지 않는다.
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = join(root, 'src-tauri', 'resources');
const runtime = join(resources, 'runtime');
const ui = join(resources, 'ui');
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
rmSync(resources, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
cpSync(join(root, 'frontend', 'dist'), ui, { recursive: true });
cpSync(process.execPath, join(runtime, 'node.exe'));
for (const file of ['package.json', 'package-lock.json']) cpSync(join(root, file), join(runtime, file));
for (const workspace of ['backend', 'frontend', 'contracts', 'e2e']) {
  mkdirSync(join(runtime, workspace), { recursive: true });
  cpSync(join(root, workspace, 'package.json'), join(runtime, workspace, 'package.json'));
}
cpSync(join(root, 'backend', 'dist'), join(runtime, 'backend', 'dist'), { recursive: true });
cpSync(join(root, 'contracts', 'dist'), join(runtime, 'contracts', 'dist'), { recursive: true });
cpSync(join(root, 'data', 'fixtures'), join(runtime, 'data', 'fixtures'), { recursive: true });
cpSync(join(root, 'data', 'reference'), join(runtime, 'data', 'reference'), { recursive: true });
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
writeFileSync(join(resources, 'build-info.json'), JSON.stringify({ node: process.versions.node, platform: process.platform, arch: process.arch }, null, 2));
console.log(`데스크톱 배포 자산 준비: ${resources}`);

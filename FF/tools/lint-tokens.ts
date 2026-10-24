// 디자인 토큰 lint — 색상은 토큰 파일에서만 정의한다.
// 신규 UI 디렉터리(NEW_UI_DIRS)는 원시 색상 0건이 하드 규칙, 레거시 전체는 줄어들기만 하는 래칫.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, rel, walk } from './lib.ts';

const SRC = join(FF, 'frontend', 'src');
/** 토큰 정의가 허용되는 유일한 파일들 */
/** 색 정의가 허용되는 곳 — 의미 토큰(tokens.css)·판 토큰(tokens-board.css, 대시보드·Lozenge — 첫 화면 밖)과 레거시 화면 팔레트(값 그대로 모은 것, P10-C2) */
const TOKEN_FILES = ['frontend/src/design/tokens.css', 'frontend/src/design/tokens-board.css', 'frontend/src/design/legacy-palette.css', 'frontend/src/design/legacy-palette.ts'];
/** 재디자인 이후의 신규 UI — 원시 색상 금지 */
export const NEW_UI_DIRS = ['frontend/src/design', 'frontend/src/screens', 'frontend/src/shell'];

const RAW = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;

let legacy = 0;
const hard: string[] = [];
for (const f of walk(SRC, ['.ts', '.tsx', '.css'])) {
  const r = rel(f);
  if (TOKEN_FILES.includes(r)) continue;
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  let n = 0;
  lines.forEach((line, i) => {
    // 주석 속 색 표기(문서화)는 제외
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    const m = code.match(RAW);
    if (!m) return;
    n += m.length;
    if (NEW_UI_DIRS.some((d) => r.startsWith(d + '/'))) hard.push(`${r}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
  legacy += n;
}

console.log('lint:tokens');
let ok = true;
if (hard.length) {
  ok = false;
  console.error(`  ✕ 신규 UI 디렉터리에 원시 색상 ${hard.length}건 — design/tokens.css의 var(--…)를 쓰세요`);
  for (const h of hard.slice(0, 30)) console.error('    ' + h);
} else console.log('  ✓ 신규 UI 원시 색상 0건');
ok = ratchet('rawColors', legacy, 'max', '레거시 원시 색상(hex/rgb) 사용 수 — 재디자인으로 0까지 줄인다') && ok;
process.exit(ok ? 0 : 1);

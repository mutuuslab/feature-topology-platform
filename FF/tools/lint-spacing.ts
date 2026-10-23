// 간격·반경 lint (UI 하네스 3판, 결함 7) — 규칙은 spacing-scale.ts.
// 신규 UI 디렉터리(NEW_UI_DIRS)는 위반 0건이 하드 규칙, 레거시 전체는 줄어들기만 하는 래칫.
// `--fix`: 스케일 밖 간격은 가까운 스케일 값으로, px 반경은 반경 토큰으로 바꾼다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, rel, walk } from './lib.ts';
import { checkCss, checkTsx, fixCss, fixTsx, type Finding } from './spacing-scale.ts';

/** 재디자인 이후의 신규 UI — lint-tokens.ts·lint-copy.ts와 같은 범위 */
const NEW_UI_DIRS = ['frontend/src/design', 'frontend/src/screens', 'frontend/src/shell'];

const SRC = join(FF, 'frontend', 'src');
/** 스케일을 정의하는 파일 — 검사하지 않는다 */
const SKIP = ['frontend/src/design/tokens.css'];
const FIX = process.argv.includes('--fix');

const hard: string[] = [];
let space = 0;
let radius = 0;
let fixedFiles = 0;
for (const f of walk(SRC, ['.css', '.tsx'])) {
  const r = rel(f);
  if (SKIP.includes(r) || /\.test\.tsx$/.test(r)) continue;
  const css = f.endsWith('.css');
  let text = readFileSync(f, 'utf8');
  if (FIX) {
    const next = css ? fixCss(text) : fixTsx(text);
    if (next !== text) {
      writeFileSync(f, next);
      text = next;
      fixedFiles++;
    }
  }
  const found: Finding[] = css ? checkCss(text) : checkTsx(text);
  for (const x of found) {
    if (x.kind === 'space') space++;
    else radius++;
    if (NEW_UI_DIRS.some((d) => r.startsWith(d + '/'))) hard.push(`${r}:${x.line}  ${x.text.slice(0, 90)}`);
  }
}

console.log('lint:spacing');
if (FIX) console.log(`  · --fix: ${fixedFiles}개 파일 수정`);
let ok = true;
if (hard.length) {
  ok = false;
  console.error(`  ✕ 신규 UI 디렉터리에 스케일 밖 간격·px 반경 ${hard.length}건 — 간격은 2·4·6·8·12·16·20·24·32·40px(또는 var(--sp-*)), 반경은 var(--r-sm|--r|--r-lg|--r-pill)·50%`);
  for (const h of hard.slice(0, 30)) console.error('    ' + h);
  console.error('    고치기: node tools/lint-spacing.ts --fix');
} else console.log('  ✓ 신규 UI 스케일 밖 간격·px 반경 0건');
ok = ratchet('offScaleSpacing', space, 'max', '스케일 밖 간격(padding·margin·gap px) 선언 수 — 0을 유지한다') && ok;
ok = ratchet('rawRadius', radius, 'max', 'px 리터럴 반경 선언 수 — 반경 토큰(--r-sm·--r·--r-lg·--r-pill)만 쓴다') && ok;
process.exit(ok ? 0 : 1);

// 모션 lint (모션 체계 v1) — 규칙은 motion-rules.ts, 허용 목록은 harness/motion.json.
// 신규 UI 디렉터리는 위반 0건이 하드 규칙, 레거시(components·scene·pages·styles.css)는 줄어들기만 하는 래칫.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, readJson, rel, walk } from './lib.ts';
import { checkMotionCss, checkMotionTsx, fixMotionCss, type MotionAllow } from './motion-rules.ts';

/** 재디자인 이후의 신규 UI — lint-tokens.ts·lint-copy.ts·lint-spacing.ts와 같은 범위 */
const NEW_UI_DIRS = ['frontend/src/design', 'frontend/src/screens', 'frontend/src/shell'];
const SRC = join(FF, 'frontend', 'src');
const allow = readJson<MotionAllow>(join(FF, 'harness', 'motion.json'));
/** --fix: CSS의 전이·한 번 재생 시간 리터럴을 토큰으로(무한 반복·허용 목록은 그대로) */
const FIX = process.argv.includes('--fix');
let fixed = 0;

const hard: string[] = [];
let legacyLiteral = 0;
let legacyLoops = 0;
for (const f of walk(SRC, ['.css', '.tsx'])) {
  const r = rel(f);
  if (/\.test\.tsx$/.test(r)) continue;
  let text = readFileSync(f, 'utf8');
  if (FIX && f.endsWith('.css')) {
    const next = fixMotionCss(text, allow);
    if (next !== text) (writeFileSync(f, next), (text = next), fixed++);
  }
  const found = f.endsWith('.css') ? checkMotionCss(text, allow) : checkMotionTsx(text, allow);
  const isNew = NEW_UI_DIRS.some((d) => r.startsWith(d + '/'));
  for (const x of found) {
    if (isNew) hard.push(`${r}:${x.line}  ${x.kind === 'loop' ? '허용 목록 밖 무한 반복' : '시간 리터럴'} — ${x.text.slice(0, 80)}`);
    else if (x.kind === 'loop') legacyLoops++;
    else legacyLiteral++;
  }
}

console.log('lint:motion');
if (FIX) console.log(`  · --fix: ${fixed}개 파일 수정`);
let ok = true;
if (hard.length) {
  ok = false;
  console.error(`  ✕ 신규 UI 모션 위반 ${hard.length}건 — 시간은 var(--t-fast|--t-base|--t-slow), 무한 반복은 harness/motion.json loops에 사유와 함께`);
  for (const h of hard.slice(0, 30)) console.error('    ' + h);
} else console.log('  ✓ 신규 UI 모션 위반 0건');
ok = ratchet('motionLiteralLegacy', legacyLiteral, 'max', '레거시 화면의 토큰이 아닌 전이·애니메이션 시간 수 — 0까지') && ok;
ok = ratchet('motionLoopsLegacy', legacyLoops, 'max', '레거시 화면의 허용 목록 밖 무한 반복 애니메이션 수 — 0까지') && ok;
process.exit(ok ? 0 : 1);

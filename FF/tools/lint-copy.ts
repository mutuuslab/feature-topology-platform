// 문구 lint — 신규 UI는 화면 문구를 src/copy/ko.ts 카탈로그에서만 가져온다.
// 검사: (1) JSX 텍스트·속성에 한글 직접 기입 금지, (2) 카탈로그 금지어, (3) 레거시 FEAT-BDC 하드코딩 래칫.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, rel, walk } from './lib.ts';

const SRC = join(FF, 'frontend', 'src');
const NEW_UI_DIRS = ['frontend/src/design', 'frontend/src/screens', 'frontend/src/shell'];
const COPY_FILE = join(SRC, 'copy', 'ko.ts');

/** 금지어 — 용어집(docs/_glossary) 기준 표기로 통일 */
const BANNED: [RegExp, string][] = [
  [/킬\s?스위치/, "'긴급 차단' 또는 'Kill'"],
  [/세이프\s?디폴트/, "'Safe Default'"],
  [/베이스라인/, "'Baseline' 또는 '기준선'"],
  [/피쳐/, "'Feature'"],
  [/에러가 발생했습니다/, '원인과 다음 행동을 함께 쓰기'],
];

const HANGUL_JSX_TEXT = />[^<>{}]*[가-힣][^<>{}]*</;
const HANGUL_ATTR = /\b(?:title|placeholder|aria-label|alt|label)=["'][^"']*[가-힣]/;

const errors: string[] = [];
for (const f of walk(SRC, ['.tsx'])) {
  const r = rel(f);
  if (!NEW_UI_DIRS.some((d) => r.startsWith(d + '/'))) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (HANGUL_JSX_TEXT.test(line) || HANGUL_ATTR.test(line)) errors.push(`${r}:${i + 1}  ${line.trim().slice(0, 100)}`);
  });
}

if (existsSync(COPY_FILE)) {
  readFileSync(COPY_FILE, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, fix] of BANNED) if (re.test(line)) errors.push(`frontend/src/copy/ko.ts:${i + 1}  금지어 ${re} → ${fix}`);
  });
}

let bdcFiles = 0;
for (const f of walk(SRC, ['.ts', '.tsx'])) if (readFileSync(f, 'utf8').includes('FEAT-BDC')) bdcFiles++;

console.log('lint:copy');
let ok = true;
if (errors.length) {
  ok = false;
  console.error(`  ✕ 문구 위반 ${errors.length}건 — 신규 UI 문구는 copy/ko.ts에서 가져오세요`);
  for (const e of errors.slice(0, 30)) console.error('    ' + e);
} else console.log('  ✓ 신규 UI 하드코딩 문구·금지어 0건');
ok = ratchet('featBdcFiles', bdcFiles, 'max', 'FEAT-BDC 데모 ID를 하드코딩한 파일 수 — v0.81 데이터(FEAT-xxxxx)로 이행하며 0까지') && ok;
process.exit(ok ? 0 : 1);

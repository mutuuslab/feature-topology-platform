// 문구 lint — 신규 UI는 화면 문구를 src/copy/ko.ts 카탈로그에서만 가져온다.
// 검사: (1) JSX 텍스트·속성에 한글 직접 기입 금지, (2) 카탈로그·라우트 제목·신규 UI 금지어, (3) 레거시 FEAT-BDC 하드코딩 래칫,
// (4) 레거시 화면에 남은 'Twin/트윈' 표기 래칫(사용자 결정 2026-10-12: Digital Twin 용어 금지 → 0까지),
// (5) 국제표준 대응방안 보고서 v1.1 용어 규칙(harness/guide/harness/terms.json) — 플랫폼 화면에 해당하는 금지어만, 허용 문맥은 보고서 원본 정규식. 줄 수 래칫 → 0.
// (6) 플랫폼 용어 규칙(tools/platform-terms.ts, 예: 은퇴 → Retirement) — 화면·API 요약·오류 메시지(frontend·contracts·backend). 줄 수 래칫 → 0.
// (7) 설명문(lead) 규칙(tools/lead-copy.ts) — 문구 카탈로그 lead 키의 70자 초과·코드 포함. 줄 수 래칫 → 0.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { guideTermHits, loadGuideTerms } from './guide-terms.ts';
import { leadHits } from './lead-copy.ts';
import { platformTermHits } from './platform-terms.ts';
import { TWIN, twinVisible } from './twin-terms.ts';
import { FF, ratchet, rel, walk } from './lib.ts';

const SRC = join(FF, 'frontend', 'src');
const NEW_UI_DIRS = ['frontend/src/design', 'frontend/src/screens', 'frontend/src/shell'];
const COPY_FILE = join(SRC, 'copy', 'ko.ts');

/** 이전 가상검증 실행기 이름 — 대소문자 구분(이력 기록의 source 값 'vecu'는 식별자라 허용) */
const OLD_RUNNER = /vECU|VECU|ffval/;
const OLD_RUNNER_VISIBLE = /['"`>][^'"`<]*?(vECU|VECU|ffval)/;
/** 금지어 — 용어집(docs/_glossary) 기준 표기로 통일 */
const BANNED: [RegExp, string][] = [
  [OLD_RUNNER, "'가상검증(CARLA)' — 실행기 교체(2026-10-17), 이전 실행기 이름은 화면에 쓰지 않는다"],
  [/킬\s?스위치/, "'긴급 차단' 또는 'Kill'"],
  [/세이프\s?디폴트/, "'Safe Default'"],
  [/베이스라인/, "'Baseline' 또는 '기준선'"],
  [/피쳐/, "'Feature'"],
  [/에러가 발생했습니다/, '원인과 다음 행동을 함께 쓰기'],
  [/디지털\s?트윈|digital\s?twin|트윈|\btwin\b/i, "'Fleet 실시간 적용 현황'·'차량별 적용 상태' 등 업무 용어 (Digital Twin 용어 금지)"],
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

// 라우트 제목(메뉴·breadcrumb·h1)과 신규 UI 문자열에도 금지어를 적용한다
readFileSync(join(SRC, 'routes.tsx'), 'utf8').split('\n').forEach((line, i) => {
  const t = line.match(/title: '([^']*)'/);
  if (t && TWIN.test(t[1])) errors.push(`frontend/src/routes.tsx:${i + 1}  금지어 Twin/트윈 → 업무 용어 (${t[1]})`);
  if (t && OLD_RUNNER.test(t[1])) errors.push(`frontend/src/routes.tsx:${i + 1}  금지어 ${OLD_RUNNER} → 가상검증(CARLA) (${t[1]})`);
});
for (const f of walk(SRC, ['.tsx'])) {
  const r = rel(f);
  if (!NEW_UI_DIRS.some((d) => r.startsWith(d + '/'))) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (twinVisible(line)) errors.push(`${r}:${i + 1}  금지어 Twin/트윈 → 업무 용어`);
    if (!line.trim().startsWith('//') && OLD_RUNNER_VISIBLE.test(line)) errors.push(`${r}:${i + 1}  금지어 ${OLD_RUNNER} → 가상검증(CARLA)`);
  });
}

if (existsSync(COPY_FILE)) {
  readFileSync(COPY_FILE, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, fix] of BANNED) if (re.test(line)) errors.push(`frontend/src/copy/ko.ts:${i + 1}  금지어 ${re} → ${fix}`);
  });
}

const guideTerms = loadGuideTerms();
const termHits: string[] = [];
let bdcFiles = 0;
let twinLines = 0;
for (const f of walk(SRC, ['.ts', '.tsx'])) {
  const text = readFileSync(f, 'utf8');
  if (text.includes('FEAT-BDC')) bdcFiles++;
  if (f.endsWith('.tsx')) for (const line of text.split('\n')) if (twinVisible(line)) twinLines++;
  if (!/__tests__|\.test\./.test(f))
    text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      for (const h of guideTermHits(line, guideTerms)) termHits.push(`${rel(f)}:${i + 1}  '${h.term}' — ${h.why}`);
    });
}

// 플랫폼 용어 — 보고서 원문 생성물(contracts/src/generated)과 마이그레이션 SQL은 제외
const PLATFORM_DIRS = [SRC, join(FF, 'contracts', 'src'), join(FF, 'backend', 'src')];
const platformHits: string[] = [];
for (const dir of PLATFORM_DIRS)
  for (const f of walk(dir, ['.ts', '.tsx'], ['node_modules', 'dist', '__tests__', 'test', 'generated'])) {
    if (/\.test\./.test(f) || /kernel[\\/]migrations\.ts$/.test(f)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const h of platformTermHits(line)) platformHits.push(`${rel(f)}:${i + 1}  ${h.term} → ${h.fix} — ${h.why}`);
    });
  }

console.log('lint:copy');
let ok = true;
if (errors.length) {
  ok = false;
  console.error(`  ✕ 문구 위반 ${errors.length}건 — 신규 UI 문구는 copy/ko.ts에서 가져오세요`);
  for (const e of errors.slice(0, 30)) console.error('    ' + e);
} else console.log('  ✓ 신규 UI 하드코딩 문구·금지어 0건');
ok = ratchet('featBdcFiles', bdcFiles, 'max', 'FEAT-BDC 데모 ID를 하드코딩한 파일 수 — v0.81 데이터(FEAT-xxxxx)로 이행하며 0까지') && ok;
ok = ratchet('twinTermLines', twinLines, 'max', "레거시 화면에 보이는 'Twin/트윈' 표기 줄 수 — Digital Twin 용어 금지(2026-10-12), 0까지") && ok;
const termOk = ratchet('guideTermLines', termHits.length, 'max', "보고서 v1.1 용어 규칙 위반 줄 수(증적→Evidence, SAFE_STOP·KILLED·즉시 비활성화·상태기계) — 0까지");
if (!termOk || process.argv.includes('--terms')) for (const h of process.argv.includes('--terms') ? termHits : termHits.slice(0, 15)) console.error('    ' + h);
ok = termOk && ok;
const platformOk = ratchet('platformTermLines', platformHits.length, 'max', "플랫폼 용어 규칙 위반 줄 수(은퇴→Retirement) — 0까지");
if (!platformOk || process.argv.includes('--terms')) for (const h of platformHits.slice(0, 15)) console.error('    ' + h);
ok = platformOk && ok;

const leads: string[] = [];
for (const f of walk(join(SRC, 'copy'), ['.ts']))
  for (const h of leadHits(readFileSync(f, 'utf8'))) leads.push(`${rel(f)}:${h.line}  ${h.why === 'code' ? '코드' : `${[...h.text].length}자`} — ${h.text.slice(0, 50)}`);
const leadOk = ratchet('leadCopyHits', leads.length, 'max', '문구 카탈로그 lead 중 70자 초과·코드(FFG·IF·D0x·보고서 절) 포함 수 — 0까지(UX3-14)');
if (!leadOk || process.argv.includes('--terms')) for (const h of leads) console.error('    ' + h);
ok = leadOk && ok;
process.exit(ok ? 0 : 1);

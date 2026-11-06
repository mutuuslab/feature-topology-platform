// npm run test:hygiene — 시험 결정성 정적 검사(래칫). 시험이 실제 시간·기계 속도·고정 포트에 기대면 부하가 큰 기계(CI·여러 작업 폴더의 verify)에서 흔들린다.
// 2026-10-24~25에 본 흔들림: vitest 5초 기본 제한·작업자 시작 대기 초과·GLEO 고정 포트 8798 충돌·OTA 회신 기한(실시간 4초) TIMEOUT·
// 대시보드 메뉴 초점 경합·정적 데모 /activation/decide 스냅샷 누락(응답 순서)·CI layout-quality /notifications 1366/1280.
// 잡는 것(backend·contracts·frontend·e2e 시험 코드):
//   fixed-port      — 고정 포트로 listen·--port 인자(0 = OS가 고른 포트는 허용)
//   sleep           — setTimeout으로 잠자기(조건 대기 반복문 안의 짧은 간격은 허용)
//   deadline-wait   — 제품 기한·제한 시간을 짧은 실시간 값으로 두고 지나가기를 기다리는 시험(*_TIMEOUT_MS·*_DEADLINE_MS 같은 설정에 1분 미만 값)
//   date-now        — Date.now()·performance.now() 비교·경과 시간 단언(조건 대기 반복문의 안전 상한은 허용)
//   wait-for-timeout — Playwright page.waitForTimeout(고정 시간 기다리기)
//   config          — vitest 설정의 testTimeout(≥ 20초)·maxWorkers(1~6) 누락
// 예외는 같은 줄이나 바로 윗줄에 `hygiene-ok: <이유>`를 단다(이유 없는 표식은 위반). 규칙별 건수는 harness/baselines.json에 잠그고 줄어드는 쪽으로만 간다.
//   node tools/test-hygiene.ts            검사(래칫)
//   node tools/test-hygiene.ts --list     위반 줄 목록
//   node tools/test-hygiene.ts --update   줄어든 건수를 잠근다(npm run ratchet -- --update와 같다)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FF, ratchet, rel, walk } from './lib.ts';

export type Rule = 'fixed-port' | 'sleep' | 'deadline-wait' | 'date-now' | 'wait-for-timeout' | 'config';
export const RULES: Record<Rule, string> = {
  'fixed-port': '고정 포트 — listen(0)·OS가 고른 포트를 쓰고 주소를 되읽는다',
  sleep: 'setTimeout 잠자기 — 조건 대기(until·expect.poll·waitFor)로 바꾼다',
  'deadline-wait': '짧은 실시간 기한 — 가짜 시계·FF_SCHEDULER=manual·기한을 시험이 직접 닫는다',
  'date-now': 'Date.now() 비교·경과 시간 단언 — 가짜 시계나 결과 상태로 단언한다',
  'wait-for-timeout': 'page.waitForTimeout — 화면 상태를 기다리는 단언(toBeVisible·toHaveURL·expect.poll)으로',
  config: 'vitest testTimeout ≥ 20초·maxWorkers 1~6 — 부하 기계에서 5초 기본값·코어 수 작업자로 흔들렸다',
};

export interface Finding {
  rule: Rule;
  file: string;
  line: number;
  text: string;
}

const MARKER = /hygiene-ok:\s*(\S.{3,})/;
const LOOP_OPENER = /(?:\bwhile\s*\(.*\)|\bfor\s*\(.*\)|\bdo)\s*$/;
const FN_OPENER = /(=>|\bfunction\b[^{]*\)|\)\s*:\s*[^{]*)\s*$/;

/** 줄 번호(1부터) → 줄 시작 위치 */
function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') out.push(i + 1);
  return out;
}
const lineOf = (starts: number[], idx: number) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

/**
 * idx를 감싼 블록을 안쪽부터 바깥으로 — 함수 경계를 만나기 전에 반복문(while·for·do) 블록이 있으면 조건 대기(폴링)로 본다.
 * 문자열·주석 속 중괄호는 세지 않는다(시험 코드에서 충분한 근사).
 */
export function inPollLoop(src: string, idx: number): boolean {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const c = src[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const before = src.slice(Math.max(0, i - 200), i).split('\n').pop() ?? '';
      if (LOOP_OPENER.test(before.trimEnd())) return true;
      if (FN_OPENER.test(before.trimEnd())) return false;
    }
  }
  return false;
}

/** 표식이 같은 줄이나 바로 윗줄에 있으면 예외(이유 4자 이상) */
function excused(lines: string[], line: number): boolean {
  return MARKER.test(lines[line - 1] ?? '') || MARKER.test(lines[line - 2] ?? '');
}

interface Pattern {
  rule: Rule;
  re: RegExp;
  /** 조건 대기 반복문 안이면 허용 */
  pollOk?: boolean;
  /** 일치 뒤 추가 판정 */
  keep?: (m: RegExpExecArray) => boolean;
}

const PATTERNS: Pattern[] = [
  // listen(9123) · listen({ port: 9123 }) · ['--port', '9590'] — 0은 OS가 고른다
  { rule: 'fixed-port', re: /\.listen\(\s*([1-9]\d{1,4})\b/g },
  { rule: 'fixed-port', re: /\.listen\(\s*\{[^}]*\bport:\s*([1-9]\d{1,4})\b/g },
  { rule: 'fixed-port', re: /['"]--port['"]\s*,\s*['"]([1-9]\d{1,4})['"]/g },
  // new Promise((r) => setTimeout(r, 100)) · setTimeout(() => r(), 50) · await sleep(…)/delay(…) (timers/promises 포함)
  { rule: 'sleep', re: /new Promise(?:<[^>]*>)?\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*setTimeout\(\s*(?:\1\b|\(\)\s*=>\s*\1\(\))/g, pollOk: true },
  { rule: 'sleep', re: /\bawait\s+(?:sleep|delay|wait|setTimeoutP?)\(\s*\d/g, pollOk: true },
  // 1분 미만 실시간 기한·제한 시간을 설정에 넣는다(제품 기한이 시험 속도와 경주한다)
  { rule: 'deadline-wait', re: /\b([A-Z][A-Z0-9_]*(?:TIMEOUT|DEADLINE)[A-Z0-9_]*_MS)\b['"]?\s*[:=]\s*['"]?(\d+)/g, keep: (m) => Number(m[2]) < 60_000 },
  // Date.now()/performance.now() 비교·경과 시간 단언
  { rule: 'date-now', re: /(?:Date|performance)\.now\(\)[^;\n]*?(?:[<>]=?(?!>)|\.toBeLessThan|\.toBeGreaterThan)/g, pollOk: true },
  { rule: 'date-now', re: /(?:[<>]=?)\s*(?:Date|performance)\.now\(\)/g, pollOk: true },
  { rule: 'date-now', re: /expect\([^;\n]*(?:Date|performance)\.now\(\)[^;\n]*\)\s*\.(?:toBeLessThan|toBeGreaterThan|toBeLessThanOrEqual|toBeGreaterThanOrEqual)/g },
  { rule: 'wait-for-timeout', re: /\.waitForTimeout\(/g },
];

export function scanSource(file: string, src: string): Finding[] {
  const starts = lineStarts(src);
  const lines = src.split('\n');
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(src); m; m = p.re.exec(src)) {
      if (p.keep && !p.keep(m)) continue;
      const line = lineOf(starts, m.index);
      const key = `${p.rule}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (excused(lines, line)) continue;
      // 조건 대기 — 반복문 머리(while (Date.now() < end))이거나 반복문 몸 안
      if (p.pollOk && (/^\s*(?:while|for)\s*\(/.test(lines[line - 1]) || inPollLoop(src, m.index))) continue;
      out.push({ rule: p.rule, file, line, text: lines[line - 1].trim().slice(0, 160) });
    }
  }
  // 표식은 있는데 이유가 없다
  lines.forEach((l, i) => {
    if (/hygiene-ok\b/.test(l) && !MARKER.test(l)) out.push({ rule: 'sleep', file, line: i + 1, text: `이유 없는 hygiene-ok 표식: ${l.trim().slice(0, 120)}` });
  });
  return out;
}

/** vitest 설정 — testTimeout ≥ 20초, maxWorkers 1~6 */
export function scanVitestConfig(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  const t = /testTimeout:\s*([\d_]+)/.exec(src);
  if (!t || Number(t[1].replace(/_/g, '')) < 20_000) out.push({ rule: 'config', file, line: 1, text: `testTimeout ${t ? t[1] : '없음'} — 20_000 이상` });
  const w = /maxWorkers:\s*(\d+)/.exec(src);
  if (!w || Number(w[1]) < 1 || Number(w[1]) > 6) out.push({ rule: 'config', file, line: 1, text: `maxWorkers ${w ? w[1] : '없음'} — 1~6` });
  return out;
}

const TEST_FILE = /\.(spec|test)\.(ts|tsx|mts|mjs)$/;
/** 검사 대상 — 시험 파일과 시험 전용 폴더(픽스처·도우미 포함) */
export function testFiles(): string[] {
  const keep = (skip: string[]) => skip;
  const files = new Set<string>();
  const add = (dir: string, all = false) => {
    for (const f of walk(join(FF, dir), ['.ts', '.tsx', '.mjs', '.mts'], keep(['node_modules', 'dist', 'dist-static', 'dist-prod', 'dist-oidc', 'report', 'test-results', '__screenshots__']))) if (all || TEST_FILE.test(f)) files.add(f);
  };
  add('backend/test', true);
  add('backend/src');
  add('contracts/src');
  add('frontend/src');
  add('frontend/src/test', true);
  for (const f of walk(join(FF, 'frontend', 'src'), ['.ts', '.tsx'], ['node_modules'])) if (/[\\/]__tests__[\\/]/.test(f)) files.add(f);
  for (const d of ['e2e/tests', 'e2e/static', 'e2e/oidc', 'e2e/firstrun']) add(d, true);
  return [...files].sort();
}

const VITEST_CONFIGS = ['backend/vitest.config.ts', 'contracts/vitest.config.mjs', 'frontend/vite.config.ts'];

export function scanAll(): Finding[] {
  const out: Finding[] = [];
  for (const f of testFiles()) out.push(...scanSource(rel(f), readFileSync(f, 'utf8')));
  for (const c of VITEST_CONFIGS) out.push(...scanVitestConfig(c, readFileSync(join(FF, c), 'utf8')));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const found = scanAll();
  const by = (r: Rule) => found.filter((x) => x.rule === r);
  console.log(`test:hygiene — 시험 ${testFiles().length}개 파일`);
  if (process.argv.includes('--list')) for (const f of found) console.log(`  ${f.rule.padEnd(16)} ${f.file}:${f.line}  ${f.text}`);
  let ok = true;
  // config는 래칫이 아니라 0 고정(설정 하나가 빠지면 바로 실패)
  for (const f of by('config')) {
    console.error(`  ✕ config ${f.file}: ${f.text}`);
    ok = false;
  }
  for (const r of Object.keys(RULES) as Rule[]) {
    if (r === 'config') continue;
    ok = ratchet(`testHygiene.${r}`, by(r).length, 'max', `시험 결정성 — ${RULES[r]} (예외는 hygiene-ok: 이유)`) && ok;
  }
  if (!ok) console.error('  → node tools/test-hygiene.ts --list 로 위반 줄을 보고, 늘어난 곳을 고치세요(예외는 같은 줄·윗줄에 hygiene-ok: 이유)');
  process.exit(ok ? 0 : 1);
}

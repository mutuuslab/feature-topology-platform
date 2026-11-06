// 모션 규칙 (모션 체계 v1, 2026-10-24) — lint-motion.ts와 회귀 시험이 이 파일 하나를 기준으로 삼는다.
// 원칙: 장식 모션 대신 상태 변화에만 짧은 모션. 화면을 읽는 3초를 빼앗지 않는다.
//   ① 전이·한 번 재생 애니메이션의 시간은 토큰(var(--t-fast|--t-base|--t-slow))만 — 움직임 줄이기에서 0이 된다
//   ② 무한 반복 애니메이션은 허용 목록(harness/motion.json loops)에 이름과 사유가 있어야 한다
//   ③ 한 번 재생인데 토큰을 못 쓰는 것(로그인 첫 등장 등)도 허용 목록(oneShots)에 사유와 함께

export interface MotionAllow {
  loops: Record<string, string>;
  oneShots: Record<string, string>;
}

export interface MotionFinding {
  line: number;
  kind: 'literal' | 'loop';
  name: string | null;
  text: string;
}

const KEYWORDS = new Set([
  'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'both', 'forwards', 'backwards', 'none',
  'normal', 'reverse', 'alternate', 'alternate-reverse', 'running', 'paused', 'all', 'initial', 'inherit', 'unset',
]);

/** 함수 호출(var·calc·cubic-bezier·steps) 밖에 있는 0이 아닌 시간 리터럴 */
export function literalTimes(value: string): string[] {
  let depth = 0;
  let outside = '';
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) outside += c;
  }
  return [...outside.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)].filter((m) => Number(m[1]) > 0).map((m) => m[0]);
}

/** animation 값에서 키프레임 이름(시간·키워드·숫자·함수가 아닌 첫 식별자) */
export function keyframeName(value: string): string | null {
  const noFn = value.replace(/[\w-]+\([^)]*\)/g, ' ');
  for (const tok of noFn.split(/[\s,]+/)) {
    if (!tok || KEYWORDS.has(tok) || /^[\d.]/.test(tok) || /^var$/.test(tok)) continue;
    if (/^[a-zA-Z_-][\w-]*$/.test(tok)) return tok;
  }
  return null;
}

const DECL = /(^|[\s;{])((?:transition|animation)(?:-duration)?)\s*:\s*([^;}]+)/g;

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** CSS 본문 검사 — 허용 목록 밖의 무한 반복, 토큰이 아닌 시간 리터럴 */
export function checkMotionCss(text: string, allow: MotionAllow): MotionFinding[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: MotionFinding[] = [];
  for (const m of code.matchAll(DECL)) {
    const prop = m[2];
    const value = m[3].trim();
    const line = lineAt(code, m.index! + m[1].length);
    // 여러 애니메이션을 쉼표로 이어 쓴 값은 하나씩 본다(함수 안의 쉼표는 건너뛴다)
    const parts = prop.startsWith('animation') && prop !== 'animation-duration' ? splitTop(value) : [value];
    for (const part of parts) {
      const name = prop === 'animation' ? keyframeName(part) : null;
      if (prop === 'animation' && /\binfinite\b/.test(part)) {
        if (!name || !(name in allow.loops)) out.push({ line, kind: 'loop', name, text: `${prop}: ${part}` });
        continue;
      }
      if (name && name in allow.oneShots) continue;
      if (literalTimes(part).length) out.push({ line, kind: 'literal', name, text: `${prop}: ${part}` });
    }
  }
  return out;
}

function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) (parts.push(cur.trim()), (cur = ''));
    else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 시간 리터럴 → 가장 가까운 토큰(≤160ms fast, ≤260ms base, 그 위 slow) */
export function timeToken(lit: string): string {
  const ms = lit.endsWith('ms') ? Number(lit.slice(0, -2)) : Number(lit.slice(0, -1)) * 1000;
  return ms <= 160 ? 'var(--t-fast)' : ms <= 260 ? 'var(--t-base)' : 'var(--t-slow)';
}

function fixValue(value: string): string {
  let depth = 0;
  let out = '';
  let buf = '';
  const flush = () => ((out += buf.replace(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g, (m, n) => (Number(n) > 0 ? timeToken(m) : m))), (buf = ''));
  for (const c of value) {
    if (c === '(') {
      if (depth === 0) flush();
      depth++;
      out += c;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      out += c;
    } else if (depth > 0) out += c;
    else buf += c;
  }
  flush();
  return out;
}

/** --fix: 무한 반복·허용 목록이 아닌 전이·한 번 재생의 시간 리터럴을 토큰으로 */
export function fixMotionCss(text: string, allow: MotionAllow): string {
  return text.replace(DECL, (all, pre, prop, value) => {
    if (/\binfinite\b/.test(value)) return all;
    const name = prop === 'animation' ? keyframeName(value) : null;
    if (name && name in allow.oneShots) return all;
    return `${pre}${prop}: ${fixValue(value.trim())}`;
  });
}

const TSX_DECL = /\b(transition|animation)(?:Duration)?\s*:\s*(['"`])([^'"`\n]*)\2/g;

/** TSX 인라인 style — transition: 'width .3s' 같은 리터럴, 허용 목록 밖 무한 반복 */
export function checkMotionTsx(text: string, allow: MotionAllow): MotionFinding[] {
  const out: MotionFinding[] = [];
  for (const m of text.matchAll(TSX_DECL)) {
    const value = m[3];
    const line = lineAt(text, m.index!);
    const name = m[1] === 'animation' ? keyframeName(value) : null;
    if (m[1] === 'animation' && /\binfinite\b/.test(value)) {
      if (!name || !(name in allow.loops)) out.push({ line, kind: 'loop', name, text: m[0] });
      continue;
    }
    if (name && name in allow.oneShots) continue;
    if (literalTimes(value).length) out.push({ line, kind: 'literal', name, text: m[0] });
  }
  return out;
}

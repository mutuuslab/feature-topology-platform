// 간격·모서리 반경 규칙 (UI 하네스 3판, 결함 7).
// 간격은 스케일 값만 쓴다 — 4px 격자 + 밀도 높은 표·칩용 반 단계(2px·6px). 40px를 넘으면 8의 배수.
// 반경은 3단(--r-sm 3px · --r 5px · --r-lg 8px) + pill(--r-pill) + 원(50%)만 쓴다.
// lint-spacing.ts(검사·--fix)와 회귀 시험이 이 파일 하나를 기준으로 삼는다.

export const SPACE_SCALE = [1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40] as const;

export function onSpaceScale(px: number): boolean {
  const a = Math.abs(px);
  if (a === 0) return true;
  if (a > 40) return a % 8 === 0;
  return (SPACE_SCALE as readonly number[]).includes(a);
}

/** 가장 가까운 스케일 값. 같은 거리면 작은 쪽(밀도 유지). 부호는 보존. */
export function snapSpace(px: number): number {
  const s = Math.sign(px) || 1;
  const a = Math.abs(px);
  if (onSpaceScale(a)) return px;
  if (a > 40) {
    const lo = Math.floor(a / 8) * 8;
    return s * (a - lo <= lo + 8 - a ? lo : lo + 8);
  }
  let best: number = SPACE_SCALE[0];
  for (const v of SPACE_SCALE) if (Math.abs(v - a) < Math.abs(best - a)) best = v;
  return s * best;
}

export const RADIUS_TOKENS = { sm: 'var(--r-sm)', md: 'var(--r)', lg: 'var(--r-lg)', pill: 'var(--r-pill)' } as const;

/** px 반경을 3단 + pill 토큰으로. 16px 이상은 칩·배지의 알약 모양을 뜻했다(20·99·999px). */
export function snapRadius(px: number): string {
  if (px <= 4) return RADIUS_TOKENS.sm;
  if (px <= 6) return RADIUS_TOKENS.md;
  if (px <= 14) return RADIUS_TOKENS.lg;
  return RADIUS_TOKENS.pill;
}

/** 값 문자열에서 함수 호출(var·calc·clamp·min·max …) 밖의 px 리터럴만 바꾼다. */
function mapOutsideFunctions(value: string, fn: (px: number, raw: string) => string): string {
  let out = '';
  let depth = 0;
  let buf = '';
  const flush = () => {
    out += buf.replace(/(-?\d+(?:\.\d+)?)px\b/g, (raw, n) => fn(Number(n), raw));
    buf = '';
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') {
      if (depth === 0) {
        // 함수 이름은 버퍼 끝에 붙어 있다 — 이름까지 그대로 둔다
        const m = buf.match(/[a-zA-Z-]+$/);
        const name = m ? m[0] : '';
        buf = buf.slice(0, buf.length - name.length);
        flush();
        out += name;
      }
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

/** 함수 밖 px 리터럴 목록 */
export function literalPx(value: string): number[] {
  const found: number[] = [];
  mapOutsideFunctions(value, (px, raw) => {
    found.push(px);
    return raw;
  });
  return found;
}

export function fixSpaceValue(value: string): string {
  return mapOutsideFunctions(value, (px, raw) => (onSpaceScale(px) ? raw : `${snapSpace(px)}px`));
}

export function fixRadiusValue(value: string): string {
  return mapOutsideFunctions(value, (px) => (px === 0 ? '0' : snapRadius(px)));
}

const CSS_SPACE = /(^|[\s;{])((?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?)(\s*:\s*)([^;}]+)/g;
const CSS_RADIUS = /(^|[\s;{])(border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius)(\s*:\s*)([^;}]+)/g;

export interface Finding {
  line: number;
  kind: 'space' | 'radius';
  text: string;
}

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** CSS 본문 검사 — 스케일 밖 간격과 px 반경 */
export function checkCss(text: string): Finding[] {
  const out: Finding[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of code.matchAll(CSS_SPACE)) {
    const bad = literalPx(m[4]).filter((px) => !onSpaceScale(px));
    if (bad.length) out.push({ line: lineAt(code, m.index!), kind: 'space', text: `${m[2]}: ${m[4].trim()}` });
  }
  for (const m of code.matchAll(CSS_RADIUS)) {
    if (literalPx(m[4]).some((px) => px !== 0)) out.push({ line: lineAt(code, m.index!), kind: 'radius', text: `${m[2]}: ${m[4].trim()}` });
  }
  return out;
}

export function fixCss(text: string): string {
  return text
    .replace(CSS_SPACE, (_m, pre, prop, sep, val) => pre + prop + sep + fixSpaceValue(val))
    .replace(CSS_RADIUS, (_m, pre, prop, sep, val) => pre + prop + sep + fixRadiusValue(val));
}

// TSX 인라인 style — `gap: 6`, `padding: '5px 6px'`, `borderRadius: 4`
const TSX_SPACE = /\b((?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block)?|gap|rowGap|columnGap)(\s*:\s*)(-?\d+(?:\.\d+)?(?![\w.])|'[^'\n]*'|"[^"\n]*")/g;
const TSX_RADIUS = /\b(borderRadius|border(?:Top|Bottom)(?:Left|Right)Radius)(\s*:\s*)(\d+(?:\.\d+)?(?![\w.%])|'[^'\n]*'|"[^"\n]*")/g;

function unquote(v: string): [string, string] {
  return /^['"]/.test(v) ? [v[0], v.slice(1, -1)] : ['', v];
}

export function checkTsx(text: string): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(TSX_SPACE)) {
    const [q, v] = unquote(m[3]);
    const nums = q ? literalPx(v) : [Number(v)];
    if (nums.some((px) => !onSpaceScale(px))) out.push({ line: lineAt(text, m.index!), kind: 'space', text: m[0] });
  }
  for (const m of text.matchAll(TSX_RADIUS)) {
    const [q, v] = unquote(m[3]);
    const nums = q ? literalPx(v) : [Number(v)];
    if (nums.some((px) => px !== 0)) out.push({ line: lineAt(text, m.index!), kind: 'radius', text: m[0] });
  }
  return out;
}

export function fixTsx(text: string): string {
  return text
    .replace(TSX_SPACE, (all, prop, sep, val) => {
      const [q, v] = unquote(val);
      if (!q) return onSpaceScale(Number(v)) ? all : `${prop}${sep}${snapSpace(Number(v))}`;
      return `${prop}${sep}${q}${fixSpaceValue(v)}${q}`;
    })
    .replace(TSX_RADIUS, (all, prop, sep, val) => {
      const [q, v] = unquote(val);
      if (!q) return Number(v) === 0 ? all : `${prop}${sep}'${snapRadius(Number(v))}'`;
      return `${prop}${sep}${q}${fixRadiusValue(v)}${q}`;
    });
}

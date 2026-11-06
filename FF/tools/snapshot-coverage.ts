// 정적 데모 스냅샷 ↔ 화면 조회 대조 — 화면 소스의 GET 조회(useApi·apiQuery·call)를 모두 찾아, 요청 모양(경로·질의 키 순서·고정값)이
// 저장된 스냅샷 파일(tools/snapshot-api.ts가 만든 api-snapshot/)과 맞는지 본다. 사용: node tools/snapshot-coverage.ts <api-snapshot 폴더>
// 배경(2026-11-06 하네스 리뷰): 파일 이름은 routeUrl이 질의를 '넣은 순서대로' 이어 붙여 만든다 — 화면이 {a,b}, 스냅샷이 {b,a}면 다른 파일이다.
// 정적 e2e(static.spec)는 기본 상태로 연 화면만 보므로 필터·쪽·상세 조합의 누락은 놓친다. 이 검사는 소스 전수로 그 틈을 막는다.
//  · 고정값(문자열·숫자·true/false)은 그 값 그대로, 변수는 '무엇이든 또는 빠짐'(undefined·''면 routeUrl이 키를 뺀다)으로 본다.
//  · 질의가 변수·펼침(...)이라 모양을 모르면 경로만 본다(unknown). 시연 엔진(api/sim)이 계산하는 경로는 '계산'으로 따로 센다.
//  · 기존 틈은 harness/snapshot-coverage-baseline.json 래칫 — 새 틈만 실패, 고쳐진 틈은 목록에서 지우라고 알린다.
//  · 필터 키를 시연 엔진이 기본 목록에서 서버 규칙으로 거르면(api/sim/list-filter.ts QUERY_SPECS) 그 경로·키는 틈이 아니다(2026-11-06).
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { FF, walk } from './lib.ts';

export interface RouteLite {
  name: string;
  method: string;
  path: string;
}

/** 질의 값 — 고정값이면 그 글자, 아니면 null(무엇이든 또는 빠짐) */
export type QueryShape = { kind: 'none' } | { kind: 'keys'; keys: [string, string | null][] } | { kind: 'unknown' };

export interface CallSite {
  file: string;
  line: number;
  route: string;
  params: Record<string, string | null> | null;
  query: QueryShape;
}

const CALLEES = new Set(['useApi', 'apiQuery', 'call']);

const strOf = (e: ts.Expression): string | null | undefined => {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return String(Number(e.text));
  if (e.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (e.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return undefined;
  if (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) return strOf(e.expression);
  return null;
};

const propName = (n: ts.PropertyName | undefined): string | undefined => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) ? n.text : undefined);

/** 같은 파일에서 이름 하나로 선언된 객체 리터럴(const q = {...}) — 하나뿐일 때만 */
function constObject(sf: ts.SourceFile, name: string): ts.ObjectLiteralExpression | undefined {
  const found: ts.ObjectLiteralExpression[] = [];
  let other = false;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      let init = n.initializer;
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))) init = init.expression;
      if (init && ts.isObjectLiteralExpression(init)) found.push(init);
      else other = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return !other && found.length === 1 ? found[0] : undefined;
}

/** 질의 객체 → 키 순서·값. 모양을 모르면(변수·펼침·계산 키) unknown */
function queryShape(sf: ts.SourceFile, e: ts.Expression, depth = 0): QueryShape {
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) {
    const o = depth < 3 ? constObject(sf, e.text) : undefined;
    return o ? queryShape(sf, o, depth + 1) : { kind: 'unknown' };
  }
  if (!ts.isObjectLiteralExpression(e)) return { kind: 'unknown' };
  const keys: [string, string | null][] = [];
  const put = (k: string, v: string | null) => {
    // 같은 키를 다시 쓰면 자리는 처음 그대로, 값만 바뀐다(객체 리터럴 규칙)
    const i = keys.findIndex(([x]) => x === k);
    if (i >= 0) keys[i] = [k, v];
    else keys.push([k, v]);
  };
  for (const p of e.properties) {
    if (ts.isShorthandPropertyAssignment(p)) put(p.name.text, null);
    else if (ts.isPropertyAssignment(p)) {
      const k = propName(p.name);
      if (k === undefined) return { kind: 'unknown' };
      const v = strOf(p.initializer);
      if (v === undefined) continue; // undefined·null — routeUrl이 뺀다
      put(k, v);
    } else if (ts.isSpreadAssignment(p)) {
      const inner = queryShape(sf, p.expression, depth + 1);
      if (inner.kind !== 'keys') return { kind: 'unknown' };
      for (const [k, v] of inner.keys) put(k, v);
    } else return { kind: 'unknown' };
  }
  return keys.length ? { kind: 'keys', keys } : { kind: 'none' };
}

/** 소스 하나의 GET 조회 자리 — routes에 있는 GET 경로만 */
export function scanSource(file: string, text: string, routes: Map<string, RouteLite>): CallSite[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: CallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && CALLEES.has(n.expression.text) && n.arguments.length) {
      const name = strOf(n.arguments[0]);
      const r = typeof name === 'string' ? routes.get(name) : undefined;
      if (r && r.method === 'GET') {
        let params: Record<string, string | null> | null = {};
        let query: QueryShape = { kind: 'none' };
        const opts = n.arguments[1];
        if (opts) {
          if (!ts.isObjectLiteralExpression(opts)) query = { kind: 'unknown' };
          else
            for (const p of opts.properties) {
              const k = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? propName(p.name) : undefined;
              if (ts.isSpreadAssignment(p)) continue; // { ...(personal ? { role } : {}) } — 역할·신호만 펼친다(질의는 이름으로 넘긴다)
              if (k === 'query') query = ts.isPropertyAssignment(p) ? queryShape(sf, p.initializer) : queryShape(sf, p.name as ts.Identifier);
              if (k === 'params') {
                const init = ts.isPropertyAssignment(p) ? p.initializer : undefined;
                if (init && ts.isObjectLiteralExpression(init)) {
                  params = {};
                  for (const q of init.properties) {
                    const pk = ts.isPropertyAssignment(q) || ts.isShorthandPropertyAssignment(q) ? propName(q.name) : undefined;
                    if (pk) params[pk] = ts.isPropertyAssignment(q) ? (strOf(q.initializer) ?? null) : null;
                  }
                } else params = null;
              }
            }
        }
        out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, route: r.name, params, query });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 경로 부분 정규식(질의 앞까지) — 매개변수는 고정값이면 그 값, 아니면 아무 글자 */
function pathPattern(r: RouteLite, params: Record<string, string | null> | null): string {
  const p = r.path.replace(/^\/api\//, '');
  return p
    .split(/(:\w+)/)
    .map((part) => {
      if (!part.startsWith(':')) return esc(sanitize(part));
      const v = params?.[part.slice(1)];
      return typeof v === 'string' ? esc(sanitize(encodeURIComponent(v))) : '[^~]+?';
    })
    .join('');
}

/** 이 조회가 요청할 수 있는 파일 이름(확장자 앞) 정규식. 키는 화면이 넣은 순서 그대로 */
export function sitePattern(r: RouteLite, site: Pick<CallSite, 'params' | 'query'>): RegExp {
  let q = '';
  if (site.query.kind === 'keys') {
    const keys = site.query.keys.map(([k]) => esc(sanitize(encodeURIComponent(k))));
    // 변수 값은 다른 키 자리('_키_')를 삼키지 않는다 — 삼키면 순서가 달라도 맞아 보인다
    const val = `(?:(?!_(?:${keys.join('|')})_)[^~])+?`;
    site.query.keys.forEach(([, v], i) => {
      // 고정값이라도 ''면 routeUrl이 뺀다
      q += typeof v === 'string' && v !== '' ? `_${keys[i]}_${esc(sanitize(encodeURIComponent(v)))}` : `(?:_${keys[i]}_${val})?`;
    });
  } else if (site.query.kind === 'unknown') q = '(?:_[^~]+)?';
  return new RegExp(`^${pathPattern(r, site.params)}${q}$`);
}

export type GapKind = 'order' | 'shape' | 'route' | 'key';
export interface Gap {
  kind: GapKind;
  route: string;
  /** FF 기준 상대 경로:줄 */
  at: string;
  detail: string;
}

/**
 * 순서 불일치 — 이 경로의 스냅샷에 화면 키 둘 이상이 함께 든 조합이 있는데, 그 조합이 화면 순서로는 한 번도 저장되지 않았다.
 * (화면은 {a,b} 순서로 묻는데 스냅샷은 {b,a}로만 저장 — 값을 고르면 늘 '스냅샷에 없음'이 된다)
 */
export function orderTwin(r: RouteLite, site: Pick<CallSite, 'params' | 'query'>, stems: string[]): string | undefined {
  if (site.query.kind !== 'keys' || site.query.keys.length < 2) return undefined;
  const base = new RegExp(`^${pathPattern(r, site.params)}_`);
  const keys = site.query.keys.map(([k]) => sanitize(encodeURIComponent(k)));
  const want = new Map<string, string>(); // 키 조합 → 화면 순서
  const seen = new Map<string, { inOrder: boolean; example: string }>();
  for (const s of stems) {
    if (!base.test(s)) continue;
    const hits = keys.map((k) => ({ k, i: s.indexOf(`_${k}_`) })).filter((h) => h.i >= 0);
    if (hits.length < 2) continue;
    const set = hits.map((h) => h.k).sort().join('|');
    if (!want.has(set)) want.set(set, keys.filter((k) => hits.some((h) => h.k === k)).join('|'));
    const order = [...hits].sort((a, b) => a.i - b.i).map((h) => h.k).join('|');
    const cur = seen.get(set) ?? { inOrder: false, example: s };
    seen.set(set, { inOrder: cur.inOrder || order === want.get(set), example: cur.example });
  }
  for (const v of seen.values()) if (!v.inOrder) return v.example;
  return undefined;
}

/** 대조 — 화면 조회 자리마다 맞는 스냅샷 파일이 하나라도 있는지 */
export function compare(sites: CallSite[], routes: Map<string, RouteLite>, stems: string[], computed: Set<string>, filtered: Map<string, Set<string>> = new Map()): { gaps: Gap[]; matched: number; computed: number } {
  const gaps: Gap[] = [];
  let matched = 0;
  let comp = 0;
  const plain = stems.filter((s) => !s.includes('~'));
  const hashed = stems.filter((s) => s.includes('~'));
  for (const site of sites) {
    const r = routes.get(site.route)!;
    const at = `${site.file}:${site.line}`;
    const re = sitePattern(r, site);
    const twin = orderTwin(r, site, plain);
    if (twin) {
      gaps.push({ kind: 'order', route: site.route, at, detail: `질의 키 순서가 스냅샷(${twin})과 다르다` });
      continue;
    }
    // 필터 키 — 변수 키가 이 경로의 어느 스냅샷에도 없으면 그 필터를 고르는 순간 '스냅샷에 없음'이다(기본 상태만 여는 e2e가 놓친다)
    const head0 = new RegExp(`^${pathPattern(r, site.params)}`);
    const lost = site.query.kind === 'keys' ? site.query.keys.filter(([k, v]) => v === null && !plain.some((s) => head0.test(s) && s.includes(`_${sanitize(encodeURIComponent(k))}_`))).map(([k]) => k) : [];
    // 시연 엔진이 기본 목록에서 거르는 키(QUERY_SPECS)는 스냅샷이 없어도 화면이 받는다
    const byEngine = filtered.get(site.route);
    if (lost.length && byEngine && lost.every((k) => byEngine.has(k)) && plain.some((s) => head0.test(s))) {
      comp++;
      continue;
    }
    if (lost.length && !computed.has(site.route) && plain.some((s) => head0.test(s))) {
      gaps.push({ kind: 'key', route: site.route, at, detail: `질의 키 ${lost.join(', ')}가 든 스냅샷이 없다 — 화면에서 그 값을 고르면 '스냅샷에 없음'` });
      continue;
    }
    if (plain.some((s) => re.test(s))) {
      matched++;
      continue;
    }
    // 긴 이름(해시 붙음)은 앞부분만 남는다 — 경로가 같은 해시 파일이 있으면 맞는 것으로 친다(내용 대조 불가)
    const head = new RegExp(`^${pathPattern(r, site.params)}`);
    if (hashed.some((s) => head.test(s))) {
      matched++;
      continue;
    }
    if (computed.has(site.route)) {
      comp++;
      continue;
    }
    if (!plain.some((s) => head.test(s))) gaps.push({ kind: 'route', route: site.route, at, detail: '이 경로의 스냅샷이 하나도 없다' });
    else gaps.push({ kind: 'shape', route: site.route, at, detail: `요청 모양 ${re.source}에 맞는 파일이 없다` });
  }
  return { gaps, matched, computed: comp };
}

/** 시연 엔진이 계산하는 읽기 경로(registerSimReader) — 스냅샷이 없어도 화면이 받는다 */
export function simReaders(srcDir: string): Set<string> {
  const out = new Set<string>();
  for (const f of walk(join(srcDir, 'api', 'sim'), ['.ts'])) for (const m of readFileSync(f, 'utf8').matchAll(/registerSimReader\(\s*'([A-Za-z0-9]+)'/g)) out.add(m[1]);
  return out;
}

/** 시연 엔진이 기본 목록에서 거르는 경로 → 질의 키(api/sim/list-filter.ts QUERY_SPECS의 keys — 객체면 속성 이름, 배열이면 글자) */
export function simQueryKeys(srcDir: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const file = join(srcDir, 'api', 'sim', 'list-filter.ts');
  if (!existsSync(file)) return out;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'QUERY_SPECS' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) {
        const route = ts.isPropertyAssignment(p) ? propName(p.name) : undefined;
        if (!route || !ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) continue;
        const keys = p.initializer.properties.find((q): q is ts.PropertyAssignment => ts.isPropertyAssignment(q) && propName(q.name) === 'keys');
        const set = new Set<string>();
        if (keys && ts.isObjectLiteralExpression(keys.initializer)) for (const k of keys.initializer.properties) { const name = propName(k.name); if (name) set.add(name); }
        if (keys && ts.isArrayLiteralExpression(keys.initializer)) for (const e of keys.initializer.elements) if (ts.isStringLiteral(e)) set.add(e.text);
        out.set(route, set);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** 래칫 비교 열쇠 — 줄 번호는 빼고(다른 수정으로 밀린다) 파일·경로·종류로 */
export const gapKey = (g: Gap) => `${g.kind} ${g.route} ${g.at.replace(/:\d+$/, '')}`;

export function baselineDiff(gaps: Gap[], baseline: string[]): { fresh: Gap[]; fixed: string[] } {
  const now = new Set(gaps.map(gapKey));
  const base = new Set(baseline);
  return { fresh: gaps.filter((g) => !base.has(gapKey(g))), fixed: [...base].filter((k) => !now.has(k)) };
}

export const BASELINE = join(FF, 'harness', 'snapshot-coverage-baseline.json');

interface Baseline {
  note: string;
  /** 고칠 일이 아닌 틈 — 열쇠 → 이유 */
  allow: Record<string, string>;
  /** 기존 틈(래칫) — 고치면 지운다 */
  gaps: string[];
}

const readBaseline = (): Baseline => (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { note: '', allow: {}, gaps: [] });

/** 대조 실행 — 새 틈 목록을 돌려준다(update면 기존 틈을 기준으로 다시 적는다). static-build·verify가 부른다 */
export function checkCoverage(dir: string, opts: { update?: boolean; log?: (s: string) => void } = {}): Gap[] {
  const log = opts.log ?? console.log;
  const require = createRequire(import.meta.url);
  const { ROUTES } = require(join(FF, 'contracts', 'dist', 'index.js')) as { ROUTES: RouteLite[] };
  const routes = new Map(ROUTES.map((r) => [r.name, r]));
  const src = join(FF, 'frontend', 'src');
  const files = walk(src, ['.ts', '.tsx']).filter((f) => !f.includes(`${sep}api${sep}sim${sep}`));
  const sites = files.flatMap((f) => scanSource(relative(FF, f).split(sep).join('/'), readFileSync(f, 'utf8'), routes));
  const stems = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5));
  const base = readBaseline();
  const all = compare(sites, routes, stems, simReaders(src), simQueryKeys(src));
  const gaps = all.gaps.filter((g) => !(gapKey(g) in (base.allow ?? {})));
  const unknown = sites.filter((s) => s.query.kind === 'unknown').length;
  log(`snapshot-coverage — 화면 GET 조회 ${sites.length}곳(모양 모름 ${unknown}) · 스냅샷 ${stems.length}개 · 맞음 ${all.matched} · 시연 엔진 계산 ${all.computed} · 허용 ${all.gaps.length - gaps.length} · 틈 ${gaps.length}`);
  if (opts.update) {
    writeFileSync(BASELINE, JSON.stringify({ ...base, gaps: [...new Set(gaps.map(gapKey))].sort() }, null, 2) + '\n');
    log(`기준 갱신 — ${BASELINE}`);
    return [];
  }
  const { fresh, fixed } = baselineDiff(gaps, base.gaps ?? []);
  for (const k of fixed) log(`  고쳐짐(기준에서 지울 것): ${k}`);
  for (const g of gaps) log(`  ${fresh.includes(g) ? '새 틈' : '기존'} [${g.kind}] ${g.route} — ${g.at} — ${g.detail}`);
  return fresh;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error('사용: node tools/snapshot-coverage.ts <api-snapshot 폴더> [--update]');
    process.exit(2);
  }
  const fresh = checkCoverage(dir, { update: process.argv.includes('--update') });
  if (fresh.length) {
    console.error(`새 틈 ${fresh.length}건 — tools/snapshot-api.ts에 그 조합을 저장하거나(필터 키), 화면의 질의 키 순서를 스냅샷과 맞춘다`);
    process.exit(1);
  }
}

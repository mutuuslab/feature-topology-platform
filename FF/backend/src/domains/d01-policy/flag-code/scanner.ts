// Flag 스캐너 v2 핵심(20-97 §1.3) — 파일 묶음에서 정적 SDK 호출을 찾고, 모듈 최상위 문자열 상수(같은 파일·상대 경로 named import)를 키로 푼다.
// 서버 스캔(GitHub App·시연 병합)과 CLI(tools/flag-sources.ts)가 같은 코드를 쓴다. 다른 모듈을 가져오지 않는다(도구가 타입 스트리핑으로 바로 읽는다).
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const FLAG_SCANNER_VERSION = '2.0.0';
export const FLAG_SDK_METHODS = new Set(['getBooleanValue', 'getBooleanDetails', 'getStringValue', 'getNumberValue', 'getObjectValue', 'isEnabled', 'getVariant']);
/** 스캔 대상 확장자 — TypeScript·JavaScript 소스 */
export const FLAG_SOURCE_FILE = /\.[cm]?[jt]sx?$/;

export interface FlagSourceFile {
  path: string;
  source: string;
}
export interface FlagUsageV2 {
  flagKey: string;
  path: string;
  line: number;
  symbol: string;
  method: string;
  safeDefault: 'EXPLICIT_FALSE' | 'SDK_DEFAULT' | 'UNCONFIRMED';
  contentHash: string;
  via: 'LITERAL' | 'CONST';
}
export interface FlagUnresolvedV2 {
  path: string;
  line: number;
  symbol: string;
  method: string;
}

const sha = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

interface Parsed {
  file: ts.SourceFile;
  /** 모듈 최상위 `const X = '키'`(as const 포함) — 이름 → 키 */
  consts: Map<string, string>;
  /** 밖으로 내보낸 이름(export const·export { a as b }) → 파일 안 이름 */
  exported: Map<string, string>;
  /** 상대 경로 named import — 지역 이름 → [모듈 경로, 원래 이름] */
  imports: Map<string, [string, string]>;
}

const stringOf = (e: ts.Expression | undefined): string | null => {
  let x = e;
  while (x && (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isSatisfiesExpression(x))) x = x.expression;
  return x && (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) ? x.text : null;
};

function parse(path: string, source: string): Parsed {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /x$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const consts = new Map<string, string>();
  const exported = new Map<string, string>();
  const imports = new Map<string, [string, string]>();
  for (const st of file.statements) {
    if (ts.isVariableStatement(st) && st.declarationList.flags & ts.NodeFlags.Const) {
      const isExport = !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const v = stringOf(d.initializer);
        if (v === null) continue;
        consts.set(d.name.text, v);
        if (isExport) exported.set(d.name.text, d.name.text);
      }
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) exported.set(el.name.text, (el.propertyName ?? el.name).text);
    } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith('.')) {
      const named = st.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const el of named.elements) imports.set(el.name.text, [st.moduleSpecifier.text, (el.propertyName ?? el.name).text]);
    }
  }
  return { file, consts, exported, imports };
}

/** POSIX 상대 경로 해석 — 저장소 밖으로 나가면 null */
function join(fromPath: string, spec: string): string | null {
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** import 경로 → 묶음 안의 파일(확장자 생략·.js로 쓴 .ts·index) */
function resolveModule(paths: Set<string>, fromPath: string, spec: string): string | null {
  const base = join(fromPath, spec);
  if (base === null) return null;
  const stem = base.replace(/\.[cm]?jsx?$/, '');
  for (const c of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`]) if (paths.has(c)) return c;
  return null;
}

/**
 * 파일 묶음을 스캔한다. 첫 인수가 문자열이면 LITERAL, 모듈 최상위 문자열 상수(같은 파일 또는 상대 경로 named import, 한 단계)면 CONST.
 * let·함수 반환·템플릿 치환·속성 접근 등 그 밖의 키는 동적 키(unresolved)다. 줄·내용 해시·기본값 분류는 v1과 같다.
 */
export function scanFlagFiles(files: readonly FlagSourceFile[]): { usages: FlagUsageV2[]; unresolved: FlagUnresolvedV2[] } {
  const parsed = new Map<string, Parsed>();
  const byPath = new Map(files.map((f) => [f.path, f.source]));
  const paths = new Set(byPath.keys());
  const get = (p: string) => {
    let x = parsed.get(p);
    if (!x) parsed.set(p, (x = parse(p, byPath.get(p)!)));
    return x;
  };
  const usages: FlagUsageV2[] = [];
  const unresolved: FlagUnresolvedV2[] = [];
  for (const { path, source } of files) {
    const me = get(path);
    const hash = sha(source);
    const resolveIdent = (name: string): string | null => {
      if (me.consts.has(name)) return me.consts.get(name)!;
      const imp = me.imports.get(name);
      if (!imp) return null;
      const target = resolveModule(paths, path, imp[0]);
      if (!target) return null;
      const t = get(target);
      const local = t.exported.get(imp[1]);
      return local !== undefined && t.consts.has(local) ? t.consts.get(local)! : null;
    };
    // 함수·블록 안에서 같은 이름을 다시 선언하면(가림) 최상위 상수로 풀지 않는다
    const shadowed = (node: ts.Node, name: string): boolean => {
      for (let p = node.parent; p && p !== me.file; p = p.parent) if ((ts.isFunctionLike(p) || ts.isBlock(p)) && hasLocalDecl(p, name)) return true;
      return false;
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const ex = node.expression;
        const method = ts.isPropertyAccessExpression(ex) ? ex.name.text : ts.isIdentifier(ex) ? ex.text : '';
        if (FLAG_SDK_METHODS.has(method)) {
          const line = me.file.getLineAndCharacterOfPosition(node.getStart(me.file)).line + 1;
          const symbol = ex.getText(me.file);
          const arg = node.arguments[0];
          let key: string | null = null;
          let via: 'LITERAL' | 'CONST' = 'LITERAL';
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) key = arg.text;
          else if (arg && ts.isIdentifier(arg) && !shadowed(node, arg.text)) {
            key = resolveIdent(arg.text);
            via = 'CONST';
          }
          if (key !== null) {
            usages.push({
              flagKey: key, path, line, symbol, method,
              safeDefault: method === 'isEnabled' || method === 'getVariant' ? 'SDK_DEFAULT' : node.arguments[1]?.kind === ts.SyntaxKind.FalseKeyword ? 'EXPLICIT_FALSE' : 'UNCONFIRMED',
              contentHash: hash, via,
            });
          } else unresolved.push({ path, line, symbol, method });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(me.file);
  }
  return { usages, unresolved };
}

/** 함수 매개변수·블록 안의 변수 선언에 같은 이름이 있는가 */
function hasLocalDecl(scope: ts.Node, name: string): boolean {
  if (ts.isFunctionLike(scope)) return scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name);
  if (ts.isBlock(scope)) return scope.statements.some((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name));
  return false;
}

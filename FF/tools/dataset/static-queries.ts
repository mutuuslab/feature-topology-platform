// data:check 일부 — 필수 질의(contracts RouteDef.requiredQuery)가 있는 조회를 화면이 값이 준비되기 전에 보내지 않는지 정적으로 본다.
// 배경(2026-10-25): 활성화 판단 화면의 Fleet 조회(useQueries)가 enabled 없이 차량 목록만 오면 flagKey 없이 나갔다 — 정적 데모(e2e:static)에서
// 응답 순서에 따라 /activation/decide 스냅샷 누락으로 흔들렸고, 실서버에서는 400이었다. useApi(...)·queryKey: ['이름', …] 조회는 enabled를 가져야 한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, rel, walk } from '../lib.ts';

export interface Unguarded {
  file: string;
  line: number;
  route: string;
}

/** contracts/src/routes.ts에서 requiredQuery가 있는 경로 이름 */
export function requiredQueryRoutes(routesSrc: string): string[] {
  return [...routesSrc.matchAll(/\{ name: '(\w+)'[^\n]*\brequiredQuery: \[/g)].map((m) => m[1]);
}

/** open 위치의 괄호·중괄호와 짝인 닫힘까지(문자열 안 괄호는 근사로 무시하지 않는다 — 화면 코드에서 충분) */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** idx를 감싼 가장 가까운 객체 리터럴의 여는 중괄호 */
function enclosingBrace(src: string, idx: number): number {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

export function scanQueries(file: string, src: string, routes: string[]): Unguarded[] {
  const out: Unguarded[] = [];
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  for (const route of routes) {
    for (const m of src.matchAll(new RegExp(`'${route}'`, 'g'))) {
      const at = m.index!;
      const before = src.slice(Math.max(0, at - 300), at);
      // useApi<T>('이름', …) — 호출 전체에 enabled가 있어야 한다
      const call = /useApi(?:Infinite)?\s*(?:<[^()]*?>)?\(\s*$/.exec(before);
      if (call) {
        const open = at - (before.length - call.index) + call[0].lastIndexOf('(');
        if (!/\benabled\s*:/.test(balanced(src, open))) out.push({ file, line: lineAt(at), route });
        continue;
      }
      // useQueries({ queries: … ({ queryKey: ['이름', …], queryFn, enabled }) })
      if (/queryKey\s*:\s*\[\s*$/.test(before)) {
        const open = enclosingBrace(src, at);
        if (open < 0 || !/\benabled\s*:/.test(balanced(src, open))) out.push({ file, line: lineAt(at), route });
      }
    }
  }
  return out;
}

export function unguardedRequiredQueries(): Unguarded[] {
  const routes = requiredQueryRoutes(readFileSync(join(FF, 'contracts', 'src', 'routes.ts'), 'utf8'));
  const files = walk(join(FF, 'frontend', 'src'), ['.ts', '.tsx']).filter((f) => !/\.(test|spec)\.tsx?$/.test(f));
  return files.flatMap((f) => scanQueries(rel(f), readFileSync(f, 'utf8'), routes));
}

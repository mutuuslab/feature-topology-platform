// 경량 경로 표가 URL·권한·개인별 조회·필수 질의 계약을 바꾸지 않는지 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { FF } from './lib.ts';
import { browserRouteSource } from './browser-routes.ts';

test('본문 검증기 import만 제거하고, 표 밖의 값과 부수효과 import는 보존한다', () => {
  const output = browserRouteSource(`
    import { Body } from './schemas';
    import { Roles, Shared } from './values';
    import './install';
    export const ROUTES = [{ name: 'write', method: 'POST', path: '/x', roles: Roles, body: Body, personal: true, requiredQuery: ['q'] }];
    export const other = { body: Shared };
  `);
  assert.doesNotMatch(output, /from ['"]\.\/schemas/);
  assert.match(output, /import ['"]\.\/install/);
  assert.match(output, /body: Shared/);
  assert.match(output, /roles: Roles/);
  assert.match(output, /personal: true/);
  assert.match(output, /requiredQuery: \[['"]q['"]\]/);
});

// 첫 화면 예산(2026-11-06 하네스 리뷰) — 배포 빌드는 브라우저가 읽지 않는 API 요약문(summary)도 뺀다. 경로·권한·질의는 그대로
test('배포 빌드 표는 요약문을 빼고, 경로·권한·개인별·필수 질의는 남긴다', () => {
  const output = browserRouteSource(`
    import { Body } from './schemas';
    export const ROUTES = [{ name: 'write', method: 'POST', path: '/x', summary: '긴 설명 문장', component: 'D01-01', roles: ['A'], body: Body, personal: true, requiredQuery: ['q'] }];
    export const other = { summary: '표 밖 값은 그대로' };
  `, { build: true });
  assert.doesNotMatch(output, /긴 설명 문장/);
  assert.match(output, /표 밖 값은 그대로/);
  assert.match(output, /path: ['"]\/x['"]/);
  assert.match(output, /roles: \[['"]A['"]\]/);
  assert.match(output, /component: ['"]D01-01['"]/);
  assert.match(output, /requiredQuery: \[['"]q['"]\]/);
  // 개발·시험(vitest)은 요약문을 남긴다(화면 시험이 요약문을 읽는다)
  assert.match(browserRouteSource(`export const ROUTES = [{ name: 'r', method: 'GET', path: '/r', summary: '남는 문장' }];`), /남는 문장/);
});

test('지원하지 않는 표 모양을 조용히 건너뛰지 않는다', () => {
  assert.throws(() => browserRouteSource('export const ROUTES = makeRoutes();'), /배열/);
  assert.throws(() => browserRouteSource('export const ROUTES = [...OTHER];'), /객체/);
  assert.throws(() => browserRouteSource('export const R = [];'), /선언/);
});

test('실제 모든 경로의 메타데이터와 URL·스냅샷 이름은 서버 계약과 같다', () => {
  const require = createRequire(join(FF, 'contracts', 'dist', 'index.js'));
  const server = require('./routes.js');
  const source = browserRouteSource(readFileSync(join(FF, 'contracts', 'src', 'routes.ts'), 'utf8'));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: Record<string, any> = {};
  runInNewContext(outputText, { exports, require });
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(exports.ROUTES), plain(server.ROUTES.map(({ body, ...meta }: any) => meta)));
  assert.deepEqual(plain(exports.REFDB_CHANGE_REQUESTERS), plain(server.REFDB_CHANGE_REQUESTERS));
  for (const route of server.ROUTES) {
    const params = Object.fromEntries([...route.path.matchAll(/:(\w+)/g)].map((m: RegExpMatchArray) => [m[1], '값 /?']));
    const query = { ...Object.fromEntries((route.requiredQuery ?? []).map((k: string) => [k, '값 &?'])), extra: 'a/b c' };
    const url = server.routeUrl(route.name, params, query);
    assert.equal(exports.routeUrl(route.name, params, query), url, route.name);
    assert.equal(exports.snapshotFile(url), server.snapshotFile(url), route.name);
    if (route.requiredQuery?.length) assert.throws(() => exports.routeUrl(route.name, params), /필수 질의/);
  }
});

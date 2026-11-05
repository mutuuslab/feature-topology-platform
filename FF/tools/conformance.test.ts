// 42 컴포넌트 준수 — 역방향 검사(routes.tsx 화면 표시·시험 파일 묶음 ⊆ manifest). 회귀: Feature DB 화면 4개·시험이 D01-01 manifest에 없었다(2026-11-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { repoTestFiles, REVERSE, reverseProblems, routeComponents, routeSource } from './conformance.ts';

const SRC = [
  `  { path: '/master/feature-db', element: named(refdbList, 'FeatureDbScreen'), title: 'Feature DB', group: 'master', components: ['D01-01'], v2: true },`,
  `  {`,
  `    path: '/master/feature-db/:refId',`,
  `    element: named(refdbDetail, 'RefDetailScreen'),`,
  `    components: ['D01-01', 'D01-02'],`,
  `  },`,
  `  { path: '/about', element: def(() => import('./About')), title: '소개' },`,
].join('\n');

test('routes.tsx 항목의 path·components를 여러 줄 항목까지 읽는다', () => {
  assert.deepEqual(routeComponents(SRC), [
    { path: '/master/feature-db', components: ['D01-01'] },
    { path: '/master/feature-db/:refId', components: ['D01-01', 'D01-02'] },
    { path: '/about', components: [] },
  ]);
});

test('역방향 검사는 manifest에 빠진 표시 화면·접두어 시험 파일을 잡는다', () => {
  const comp = { id: 'D01-01', status: 'implemented', screens: ['/master/feature-db'], tests: ['backend/test/d01/refdb-read.spec.ts'] };
  const files = ['backend/test/d01/refdb-read.spec.ts', 'backend/test/d01/refdb-change.spec.ts', 'backend/test/d01/registry.spec.ts'];
  assert.deepEqual(reverseProblems(routeComponents(SRC), [comp], files, { 'D01-01': { testPrefixes: ['backend/test/d01/refdb'] } }), [
    'D01-01: routes.tsx 화면 /master/feature-db/:refId가 manifest screens에 없음',
    'D01-01: 시험 backend/test/d01/refdb-change.spec.ts가 manifest tests에 없음',
  ]);
  const full = { ...comp, screens: ['/master/feature-db', '/master/feature-db/:refId'], tests: files.slice(0, 2) };
  assert.deepEqual(reverseProblems(routeComponents(SRC), [full], files, { 'D01-01': { testPrefixes: ['backend/test/d01/refdb'] } }), []);
});

test('저장소 — D01-01 표시 화면·Feature DB 시험이 모두 manifest에 있다', (t) => {
  const dist = join(FF, 'contracts', 'dist', 'index.js');
  if (!existsSync(dist)) return t.skip('contracts dist 없음 — verify contracts:build 뒤에 돈다');
  const { COMPONENTS } = createRequire(import.meta.url)(dist);
  assert.deepEqual(reverseProblems(routeComponents(routeSource()), COMPONENTS, repoTestFiles()), []);
  const d0101 = COMPONENTS.find((c: { id: string }) => c.id === 'D01-01');
  for (const s of ['/master/feature-db', '/master/feature-db/:refId', '/master/feature-db/changes', '/master/feature-db/changes/:id']) assert.ok(d0101.screens.includes(s), s);
  for (const f of ['backend/test/d01/refdb-read.spec.ts', 'frontend/src/__tests__/screensRefdb.test.tsx', 'frontend/src/__tests__/screensPropose.test.tsx', 'e2e/tests/refdb.spec.ts', 'contracts/src/rules/refdb/size.test.ts']) assert.ok(d0101.tests.includes(f), f);
  assert.ok('D01-01' in REVERSE);
});

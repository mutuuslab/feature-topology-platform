// data:check 필수 질의 조회 검사 — enabled 없는 useApi·useQueries 조회를 잡고, 막힌 조회·무효화 목록은 지나간다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredQueryRoutes, scanQueries } from './static-queries.ts';

const R = ['activationDecide'];

test('routes.ts에서 requiredQuery가 있는 경로만 고른다', () => {
  const src = [`  { name: 'a', method: 'GET', path: '/a', query: ['x'], requiredQuery: ['x'] },`, `  { name: 'b', method: 'GET', path: '/b', query: ['x'] },`].join('\n');
  assert.deepEqual(requiredQueryRoutes(src), ['a']);
});

test('enabled 없는 useQueries 객체·useApi 호출은 위반 — 2026-10-25 활성화 판단 Fleet 조회', () => {
  const bad = `const fleet = useQueries({\n  queries: vs.map((v) => ({\n    queryKey: ['activationDecide', {}, { vin: v.vin, flagKey }],\n    queryFn: () => call('activationDecide', { query: { vin: v.vin, flagKey } }),\n  })),\n});\nconst q = useApi<D>('activationDecide', { query: { vin, flagKey } });`;
  assert.deepEqual(
    scanQueries('x.tsx', bad, R).map((u) => u.line),
    [3, 7],
  );
});

test('enabled로 막힌 조회와 무효화 목록·직접 호출은 지나간다', () => {
  const ok = `const INVALIDATE = ['audit', 'activationDecide'];\nconst q = useApi<D>('activationDecide', { query: { vin, flagKey } }, { enabled: !!vin && !!flagKey });\nconst f = useQueries({ queries: vs.map((v) => ({ queryKey: ['activationDecide', {}, { vin: v.vin, flagKey }], queryFn: () => call('activationDecide', {}), enabled: !!flagKey })) });`;
  assert.deepEqual(scanQueries('x.tsx', ok, R), []);
});

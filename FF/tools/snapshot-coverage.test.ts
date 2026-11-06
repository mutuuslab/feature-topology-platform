// 정적 스냅샷 ↔ 화면 조회 대조(tools/snapshot-coverage.ts) — 순서 불일치·필터 키 누락·경로 누락을 잡고, 맞는 조합은 지나간다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { compare, gapKey, orderTwin, baselineDiff, scanSource, simQueryKeys, simReaders, sitePattern, type RouteLite } from './snapshot-coverage.ts';
import { FF, walk } from './lib.ts';

const ROUTES = new Map<string, RouteLite>(
  [
    { name: 'listRefs', method: 'GET', path: '/api/refs' },
    { name: 'refDetail', method: 'GET', path: '/api/refs/:refId' },
    { name: 'incidents', method: 'GET', path: '/api/incidents' },
    { name: 'createThing', method: 'POST', path: '/api/things' },
  ].map((r) => [r.name, r]),
);

const sites = (src: string) => scanSource('x.tsx', src, ROUTES);

test('조회 자리 — useApi·apiQuery·call의 GET만, 질의 키는 넣은 순서·고정값 그대로', () => {
  const s = sites(
    [
      `const a = useApi('listRefs', { query: { domain, limit: 20, status: undefined } });`,
      `const b = call('refDetail', { params: { refId: 'R-1' }, signal });`,
      `const c = call('createThing', { body: {} });`,
      `const q = { component: c, domain: d };`,
      `const d = useApi<X>('listRefs', { query: q }, { enabled: true });`,
      `const e = useApi('listRefs', { query: { ...base, limit: 5 } });`,
    ].join('\n'),
  );
  assert.deepEqual(
    s.map((x) => [x.route, x.line, x.query]),
    [
      ['listRefs', 1, { kind: 'keys', keys: [['domain', null], ['limit', '20']] }],
      ['refDetail', 2, { kind: 'none' }],
      ['listRefs', 5, { kind: 'keys', keys: [['component', null], ['domain', null]] }],
      ['listRefs', 6, { kind: 'unknown' }],
    ],
  );
  assert.deepEqual(s[1].params, { refId: 'R-1' });
});

test('요청 모양 — 변수 값이 다른 키 자리를 삼키지 않는다(삼키면 순서가 달라도 맞아 보인다)', () => {
  const [site] = sites(`useApi('listRefs', { query: { domain, component } });`);
  const re = sitePattern(ROUTES.get('listRefs')!, site);
  assert.equal(re.test('refs'), true);
  assert.equal(re.test('refs_domain_Body_component_Door'), true);
  assert.equal(re.test('refs_component_Door_domain_Body'), false);
});

test('순서 불일치 — 같은 키 조합이 화면과 다른 순서로만 저장돼 있으면 잡는다(화면 순서 파일이 하나라도 있으면 통과)', () => {
  const [site] = sites(`useApi('listRefs', { query: { domain, component, limit: 50 } });`);
  const r = ROUTES.get('listRefs')!;
  assert.equal(orderTwin(r, site, ['refs_component_Door_domain_Body_limit_50']), 'refs_component_Door_domain_Body_limit_50');
  assert.equal(orderTwin(r, site, ['refs_component_Door_domain_Body_limit_50', 'refs_domain_Body_component_Door_limit_50']), undefined);
  assert.equal(orderTwin(r, site, ['refs_domain_Body_limit_50']), undefined);
  const { gaps } = compare([site], ROUTES, ['refs_limit_50', 'refs_component_Door_domain_Body_limit_50'], new Set());
  assert.deepEqual(gaps.map((g) => g.kind), ['order']);
});

test('필터 키 누락 — 변수 키가 이 경로의 어느 스냅샷에도 없으면 틈, 시연 엔진 계산 경로는 제외', () => {
  const s = sites(`useApi('incidents', { query: { source: source || undefined } });`);
  const { gaps } = compare(s, ROUTES, ['incidents'], new Set());
  assert.deepEqual(gaps.map((g) => [g.kind, g.at]), [['key', 'x.tsx:1']]);
  assert.match(gaps[0].detail, /source/);
  assert.deepEqual(compare(s, ROUTES, ['incidents', 'incidents_source_VOC'], new Set()).gaps, []);
  assert.deepEqual(compare(s, ROUTES, ['incidents'], new Set(['incidents'])).gaps, []);
});

test('고정값·경로 누락 — 고정값 조합 파일이 없으면 shape, 경로 파일이 하나도 없으면 route', () => {
  const s = sites(`useApi('listRefs', { query: { limit: 30 } });\ncall('incidents');`);
  const { gaps, matched } = compare(s, ROUTES, ['refs_limit_50'], new Set());
  assert.equal(matched, 0);
  assert.deepEqual(gaps.map((g) => g.kind), ['shape', 'route']);
  assert.equal(compare(s, ROUTES, ['refs_limit_30', 'incidents'], new Set()).gaps.length, 0);
});

test('래칫 — 줄 번호는 비교하지 않고, 새 틈과 고쳐진 틈을 나눈다', () => {
  const g = { kind: 'key' as const, route: 'incidents', at: 'a.tsx:10', detail: '' };
  assert.equal(gapKey(g), 'key incidents a.tsx');
  assert.deepEqual(baselineDiff([{ ...g, at: 'a.tsx:99' }], ['key incidents a.tsx', 'route x b.tsx']), { fresh: [], fixed: ['route x b.tsx'] });
  assert.equal(baselineDiff([g], []).fresh.length, 1);
});

test('실제 화면 소스 — 조회 자리를 충분히 찾는다(분석기가 조용히 0을 내지 않게) · 시연 엔진 계산 경로를 읽는다', () => {
  const src = join(FF, 'frontend', 'src');
  const routes = new Map<string, RouteLite>();
  // contracts 빌드 없이 — routes.ts에서 GET 경로 이름만 뽑는다
  for (const m of readFileSync(join(FF, 'contracts', 'src', 'routes.ts'), 'utf8').matchAll(/name: '([A-Za-z0-9]+)', method: 'GET', path: '([^']+)'/g)) routes.set(m[1], { name: m[1], method: 'GET', path: m[2] });
  assert.ok(routes.size > 100, `GET 경로 ${routes.size}`);
  const found = walk(src, ['.ts', '.tsx'])
    .filter((f) => !f.includes(`${sep}api${sep}sim${sep}`))
    .flatMap((f) => scanSource(relative(FF, f), readFileSync(f, 'utf8'), routes));
  assert.ok(found.length > 200, `조회 자리 ${found.length}`);
  assert.ok(found.filter((s) => s.query.kind === 'unknown').length < found.length / 10, '모양 모름이 너무 많다');
  assert.ok(simReaders(src).has('fleetMap'));
});

// 2026-11-06 하네스 리뷰: 필터 키 4곳(장애 출처·의존관계 유형/판정·영향 변경 속성·SW 검색어)은 시연 엔진이 기본 목록을 서버 규칙으로 거른다
test('시연 엔진 목록 거르기(QUERY_SPECS) — 그 경로의 선언된 키만 틈에서 뺀다', () => {
  const keys = simQueryKeys(join(FF, 'frontend', 'src'));
  assert.deepEqual([...(keys.get('incidents') ?? [])].sort(), ['featureId', 'source', 'status']);
  assert.deepEqual([...(keys.get('impact') ?? [])], ['changed']);
  assert.ok(keys.get('dependencies')?.has('verdict') && keys.get('masterSw')?.has('q'));
  const s = sites(`useApi('incidents', { query: { source: source || undefined } });`);
  assert.deepEqual(compare(s, ROUTES, ['incidents'], new Set(), new Map([['incidents', new Set(['source'])]])).gaps, []);
  // 선언되지 않은 키는 여전히 틈, 기본 목록 스냅샷이 없으면 경로 틈
  assert.deepEqual(compare(s, ROUTES, ['incidents'], new Set(), new Map([['incidents', new Set(['status'])]])).gaps.map((g) => g.kind), ['key']);
  assert.deepEqual(compare(s, ROUTES, [], new Set(), new Map([['incidents', new Set(['source'])]])).gaps.map((g) => g.kind), ['route']);
});

// 출시 준비 규칙 회귀 시험. 표식 ID는 실행 중에 만든다(이 파일이 표식 검사에 잡히지 않게).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, scanMarkers, validateCatalog, type Catalog, type Item } from './readiness-rules.ts';

const id = (n: number) => ['RD', 'TST', String(n).padStart(2, '0')].join('-');
const tag = (...ids: string[]) => ['readiness', ': ', ids.join(', ')].join('');

const item = (over: Partial<Item>): Item => ({
  id: id(1), priority: 'P0', area: 'x', phase: 'R1', title: 't', evidence: ['a.ts:1'], criteria: 'c', status: 'open', checks: [{ kind: 'marker' }], ...over,
});

test('표식은 쉼표로 여러 개, 형식이 맞는 ID만', () => {
  assert.deepEqual(scanMarkers(`// ${tag(id(1), id(2))}\n// readiness: nope`), [id(1), id(2)]);
});

test('목록 검사: ID 형식·중복·검사 없음·잘못된 정규식', () => {
  const c: Catalog = {
    note: '',
    items: [item({}), item({}), item({ id: 'X-1', checks: [] }), item({ id: id(3), checks: [{ kind: 'match', path: 'a', pattern: '(' }] })],
  };
  const p = validateCatalog(c).join('\n');
  assert.match(p, /ID 중복/);
  assert.match(p, /ID 형식/);
  assert.match(p, /검사가 없다/);
  assert.match(p, /잘못된 정규식/);
});

test('판정: done 실패는 되돌아감, open 통과는 목록 뒤처짐, 열린 수는 우선순위별', () => {
  const files: Record<string, string> = { 'h/_headers': 'Content-Security-Policy: x', 'ci.yml': 'npm audit' };
  const read = (p: string) => files[p] ?? null;
  const c: Catalog = {
    note: '',
    items: [
      item({ id: id(1), status: 'done', checks: [{ kind: 'marker' }] }),
      item({ id: id(2), status: 'open', checks: [{ kind: 'match', path: 'h/_headers', pattern: 'Content-Security-Policy' }] }),
      item({ id: id(3), status: 'open', priority: 'P1', checks: [{ kind: 'absent', path: 'ci.yml', pattern: 'npm audit' }] }),
      item({ id: id(4), status: 'done', checks: [{ kind: 'absent', path: 'gone.ts', pattern: 'x' }, { kind: 'exists', path: 'ci.yml' }] }),
    ],
  };
  const v = judge(c, { read, markers: new Map() });
  assert.deepEqual(v.regressed.map((r) => r.id), [id(1)]);
  assert.deepEqual(v.stale.map((r) => r.id), [id(2)]);
  assert.deepEqual(v.open, { P0: 1, P1: 1, P2: 0 });
  const v2 = judge(c, { read, markers: new Map([[id(1), ['x.test.ts']]]) });
  assert.equal(v2.regressed.length, 0);
});

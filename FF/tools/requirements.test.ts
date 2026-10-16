// 기능명세서 요구사항 추적 — 카탈로그 만들기·검토 표 읽기·코드 추적·결함 기록 검사.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, check, expand, parseGapRow, scanText, untracedImplemented, type Catalog, type Review } from './requirements.ts';

const META = ['메타데이터', '', '', '', '', '', '', '원본 헤더/메타데이터'];
const HEAD = [...META, '개발 항목', '컴포넌트', '카테고리', '입력', '요구사항 ID', '요구사항 명', '상세 설명', '출력', '적용 영역', '비고'];
const row = (id: string, name: string, desc: string, comp = '', cat = '') => ['요구사항', id, '', '', '', '', '', '', '', comp, cat, '', id, name, desc, '', 'Backend', ''];
const SHEETS = [
  { name: '개요', rows: [['문서']] },
  {
    name: '01_정책',
    rows: [
      HEAD,
      row('FR-AAA-001', '묶음', '묶음 설명', 'Registry', '등록'),
      row('FR-AAA-001-001', '등록', '등록해야 한다.'),
      row('FR-AAA-001-002', '조회', '조회해야 한다.'),
      row('FR-AAA-001-002', '조회(중복)', '다시 조회해야 한다.'),
      row('FR-AAA-001-003', '조회 2', '조회해야 한다.'),
    ],
  },
];
const SRC = { path: 'x.xlsx', file: 'x.xlsx', sha256: 'a'.repeat(64), bytes: 1 };
const cat = (): Catalog => buildCatalog(SHEETS, SRC);

test('카탈로그 — 원본 열 이름으로 읽고 컴포넌트·카테고리를 이어 채운다, 중복 ID는 #2 키, 명세서 정정 사항을 찾는다', () => {
  const c = cat();
  assert.deepEqual(c.sheets, [{ name: '01_정책', requirements: 5, leaves: 4 }]);
  assert.deepEqual(c.requirements.map((r) => [r.key, r.level, r.component, r.category, r.row]), [
    ['FR-AAA-001', 'group', 'Registry', '등록', 2],
    ['FR-AAA-001-001', 'leaf', 'Registry', '등록', 3],
    ['FR-AAA-001-002', 'leaf', 'Registry', '등록', 4],
    ['FR-AAA-001-002#2', 'leaf', 'Registry', '등록', 5],
    ['FR-AAA-001-003', 'leaf', 'Registry', '등록', 6],
  ]);
  assert.deepEqual(c.specIssues.map((i) => [i.kind, i.ids]), [
    ['DUPLICATE_ID', ['FR-AAA-001-002']],
    ['DUPLICATE_TEXT', ['FR-AAA-001-002', 'FR-AAA-001-003']],
  ]);
});

test('검토 표 한 줄 — FR- 없는 ID 보정, 셀 안의 \\| 는 나누지 않는다', () => {
  assert.deepEqual(parseGapRow('| OPD-001-004 | 평가 조건 | 부분 | `a\\|b` 근거 | 반영 |'), { id: 'FR-OPD-001-004', verdict: '부분', evidence: '`a\\|b` 근거', gap: '반영' });
  assert.equal(parseGapRow('| ID | 요구사항 명 | 판정 | 근거 | 반영 |'), null);
});

// 회귀: 다른 명세의 ID 체계(FR-ULOSS-…)를 '카탈로그에 없는 ID'로 잡았다
test('코드 추적 — 이 명세서 영역 접두어만 검사, @req 표식·결함 기록(it.fails)을 모은다', () => {
  const known = new Set(['FR-AAA-001-001', 'FR-AAA-001-002']);
  const s = scanText('a.spec.ts', "// FR-ULOSS-005 다른 명세\n// FR-AAA-009-001 오타\n * @req FR-AAA-001-001, FR-AAA-001-002\nit.fails('FR-AAA-001-002 결함', () => {})", known);
  assert.deepEqual(s.unknown, ['a.spec.ts:2  FR-AAA-009-001 — 기능명세서 카탈로그에 없는 요구사항 ID']);
  assert.deepEqual(s.tags, ['FR-AAA-001-001', 'FR-AAA-001-002']);
  assert.deepEqual(s.probes, ['FR-AAA-001-002']);
});

test('접두어 패턴은 1건 이상 맞아야 한다', () => {
  assert.deepEqual(expand(['FR-AAA-', 'FR-BBB-001-001'], ['FR-AAA-001-001', 'FR-AAA-001-002']), { ids: ['FR-AAA-001-001', 'FR-AAA-001-002'], empty: ['FR-BBB-001-001'] });
});

const review = (patch: Partial<Review> = {}): Review => ({
  note: '',
  source: { sha256: SRC.sha256, reviewedAt: '2026-10-17', reviewedCommit: 'x' },
  sheets: [],
  verdicts: {
    'FR-AAA-001-001': { verdict: '구현', evidence: '', gap: '' },
    'FR-AAA-001-002': { verdict: '미구현', evidence: '', gap: '' },
    'FR-AAA-001-002#2': { verdict: '구현', evidence: '', gap: '' },
    'FR-AAA-001-003': { verdict: '부분', evidence: '', gap: '' },
  },
  defects: [],
  decisions: [],
  themes: [],
  specNotes: [],
  ...patch,
});
const names = (r: ReturnType<typeof check>) => r.problems.map((p) => p.name);

test('판정 — 말단마다 하나, 다른 원본을 검토했으면 실패', () => {
  assert.deepEqual(names(check(cat(), review(), [])), []);
  const v = { ...review().verdicts };
  delete v['FR-AAA-001-003'];
  assert.deepEqual(names(check(cat(), review({ verdicts: v }), [])), ['판정 누락']);
  assert.deepEqual(names(check(cat(), review({ source: { sha256: 'b'.repeat(64), reviewedAt: '', reviewedCommit: '' } }), [])), ['검토 원본']);
});

test('@req — 미구현 판정이면 판정부터 갱신, 묶음 ID에는 달지 않는다', () => {
  const r = check(cat(), review(), [{ rel: 'backend/src/a.ts', text: '/** @req FR-AAA-001-002 */\n/** @req FR-AAA-001-001 */' }]);
  assert.deepEqual(r.problems, [{ name: '@req 표식', errs: ["backend/src/a.ts  @req FR-AAA-001-002 — 판정이 '미구현'이다. 구현했다면 review.json 판정을 먼저 갱신"] }]);
  assert.deepEqual(r.traces.get('FR-AAA-001-001'), { implemented: ['backend/src/a.ts'], tested: [] });
});

test('결함 — 목록의 결함은 it.fails 기록이 있어야 하고, 기록만 있고 목록에 없으면 실패', () => {
  const defects = [{ id: 'FR-AAA-001-002', summary: '결함', probe: 'backend/test/d.spec.ts' }];
  const probe = { rel: 'backend/test/d.spec.ts', text: "it.fails('FR-AAA-001-002 고치면 실패한다', () => {})" };
  assert.deepEqual(names(check(cat(), review({ defects }), [probe])), []);
  assert.deepEqual(check(cat(), review({ defects }), []).problems[0].errs, ['FR-AAA-001-002 — backend/test/d.spec.ts에 실행되는 결함 기록(it.fails)이 없다. 고쳤다면 결함 목록에서 빼고 판정을 갱신']);
  assert.deepEqual(names(check(cat(), review(), [probe])), ['결함 기록']);
});

test('결정 — 결정됨이면 결정 내용이 있어야 한다, 패턴이 비면 실패', () => {
  const d = { id: 'D1', title: 't', spec: 's', design: 'd', status: '결정됨' as const, requirements: ['FR-AAA-', 'FR-ZZZ-'] };
  assert.deepEqual(check(cat(), review({ decisions: [d] }), []).problems[0].errs, ["D1 — 'FR-ZZZ-'에 맞는 말단 요구사항이 없다", 'D1 — 결정됨이면 resolution(결정 내용)을 적는다']);
});

// 회귀: 추적 없는 구현 판정을 ID로 세서 명세서 중복 ID 행(#2)이 빠졌다
test('추적 없는 구현 판정은 명세서 행(키)마다 센다', () => {
  const r = check(cat(), review(), []);
  assert.equal(untracedImplemented(cat(), review(), r.traces), 2);
});

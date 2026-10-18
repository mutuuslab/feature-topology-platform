// Orca 인계 R3 카탈로그 — 원본 zip은 저장소 밖이라, 시험은 범위 표기 펼치기·커밋된 catalog.json·오류 주입으로 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './lib.ts';
import { existsSync } from 'node:fs';
import { CATALOG, REVIEW, catalogProblems, expandFfp, expandTc, orcaReviewProblems, reviewKeys, type OrcaCatalog, type OrcaReview } from './orca-sync.ts';

test('판정 review.json — 45항목(사례 25·HT 8·축 6·지표 6) 모두 판정, 근거 실재, 결함은 it.fails 기록', { skip: !existsSync(REVIEW) }, () => {
  const c = readJson<OrcaCatalog>(CATALOG);
  const r = readJson<OrcaReview>(REVIEW);
  assert.equal(reviewKeys(c).length, 45);
  assert.deepEqual(orcaReviewProblems(c, r), []);
});

test('오류 주입 — 판정 누락·모르는 키·계획 없음·근거 빈 줄·결함 기록 없음을 잡는다', { skip: !existsSync(REVIEW) }, () => {
  const c = readJson<OrcaCatalog>(CATALOG);
  const r = readJson<OrcaReview>(REVIEW);
  const files: Record<string, string> = { 'a.ts': 'x\n\n', 'p.spec.ts': "it.fails('ORCA-HT06 재현', () => {});\n" };
  const read = (rel: string) => files[rel] ?? null;
  const ok = { verdict: '부분' as const, current: '', evidence: ['a.ts:1'], tests: [], gap: '', plan: ['X'] };
  const all = Object.fromEntries(reviewKeys(c).map((k) => [k, ok]));
  const run = (items: OrcaReview['items']) => orcaReviewProblems(c, { source: { ...r.source, sha256: c.source.sha256 }, items }, read).join('\n');
  assert.equal(run(all), '');
  const { C1: _gone, ...missing } = all;
  assert.match(run(missing), /C1 판정 없음/);
  assert.match(run({ ...all, Z99: ok }), /카탈로그에 없는 판정 키 Z99/);
  assert.match(run({ ...all, C1: { ...ok, plan: [] } }), /C1 반영 계획 없음/);
  assert.match(run({ ...all, C1: { ...ok, evidence: ['a.ts:2'] } }), /내용이 없음/);
  assert.equal(run({ ...all, HT06: { ...ok, defect: { probe: 'p.spec.ts', probeId: 'ORCA-HT06' } } }), '');
  assert.match(run({ ...all, HT06: { ...ok, defect: { probe: 'p.spec.ts', probeId: 'ORCA-HT07' } } }), /it\.fails 기록이 없음/);
});

test('범위 표기를 펼친다 — FFP-F011–012·033–036, TC12·15·19, TC04–06', () => {
  assert.deepEqual(expandFfp('FFP-F011–012·033–036, FFP-F049'), ['FFP-F011', 'FFP-F012', 'FFP-F033', 'FFP-F034', 'FFP-F035', 'FFP-F036', 'FFP-F049']);
  assert.deepEqual(expandTc('TC12·15·19 그리고 TC04–06'), ['TC04', 'TC05', 'TC06', 'TC12', 'TC15', 'TC19']);
});

test('커밋된 카탈로그 — 사례 25(소비자 8·경영 12·규제 5)·장면 125·축 6·지표 6·HT 8·실증 5·여정 7·출처 23, ADS와 교차 일치', () => {
  const c = readJson<OrcaCatalog>(CATALOG);
  assert.deepEqual(catalogProblems(c), []);
  assert.equal(c.scenarios.reduce((n, s) => n + s.video.scenes.length, 0), 125);
  assert.deepEqual(c.axes.map((a) => a.axis), ['상품 권리', '구성과 설치', '정책 의도·전달', '활성 적격', '실제 기능 실행', '관측 신선도']);
  assert.ok(c.scenarios.find((s) => s.id === 'R01')!.related.tc.includes('TC19'));
});

test('오류 주입 — 사례·장면·금지 표현 누락, HT 순서, ADS 교차 불일치를 모두 잡는다', () => {
  const c = readJson<OrcaCatalog>(CATALOG);
  const [first, ...rest] = c.scenarios;
  const cases: [string, OrcaCatalog, RegExp][] = [
    ['사례 하나 빠짐', { ...c, scenarios: rest }, /사례 24개/],
    ['장면 4개', { ...c, scenarios: [{ ...first, video: { ...first.video, scenes: first.video.scenes.slice(1) } }, ...rest] }, /장면 4개/],
    ['금지 표현 없음', { ...c, scenarios: [{ ...first, video: { ...first.video, limit: '' } }, ...rest] }, /표현 경계/],
    ['HT 순서', { ...c, tests: [...c.tests].reverse() }, /HT 순서/],
    ['ADS 요건 불일치', { ...c, crossCheck: { ...c.crossCheck, requirementsEqual: 63, differences: ['FFP-F001 요건 텍스트 다름'] } }, /ADS 교차 검사/],
  ];
  for (const [name, broken, re] of cases) assert.match(catalogProblems(broken).join('\n'), re, name);
});

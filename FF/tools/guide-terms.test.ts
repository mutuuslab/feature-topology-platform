// 보고서 용어 규칙 — 허용 문맥(금지·레거시·DC0 등)이 있는 줄만 통과한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideTermHits, loadGuideTerms } from './guide-terms.ts';

const terms = loadGuideTerms();
const hits = (line: string) => guideTermHits(line, terms).map((t) => t.term);

test('플랫폼 금지어 8개를 모두 보고서 용어 규칙에서 읽는다', () => {
  assert.equal(terms.length, 8);
});

test("'증적'은 어떤 문맥에서도 금지 — Evidence로 쓴다", () => {
  assert.deepEqual(hits("title: 'G5 증적 제출'"), ['증적']);
  assert.deepEqual(hits("title: 'G5 Evidence 제출'"), []);
});

test('SAFE_STOP·즉시 비활성화는 금지·레거시 문맥에서만 허용', () => {
  assert.deepEqual(hits("SAFE_STOP: '레거시 방식(SAFE_STOP) — 폐기됨'"), []);
  assert.deepEqual(hits("label: 'Safe Stop — SAFE_STOP'"), ['SAFE_STOP']);
  assert.deepEqual(hits("'안전 Feature 즉시 비활성화 금지'"), []);
  assert.deepEqual(hits("'즉시 비활성화합니다'"), ['즉시 비활성화']);
  assert.deepEqual(hits("'DC0 즉시 비활성화'"), []);
});

test('KILLED는 DISABLED로', () => {
  assert.deepEqual(hits("status: 'KILLED'"), ['KILLED']);
});

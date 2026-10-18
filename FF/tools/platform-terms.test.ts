// 플랫폼 용어 규칙 — '은퇴'는 화면·API·메시지에 쓰지 않고 'Retirement'로 쓴다(사용자 결정 2026-10-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformTermHits } from './platform-terms.ts';

const hits = (line: string) => platformTermHits(line).map((t) => t.fix);

test("'은퇴'는 화면 문구·API 요약·오류 메시지에서 금지", () => {
  assert.deepEqual(hits("title: 'Flag 은퇴'"), ['Retirement']);
  assert.deepEqual(hits("summary: '은퇴 승인 — Feature 승인자'"), ['Retirement']);
  assert.deepEqual(hits("throw new DomainError('NOT_FOUND', `${id} 은퇴 건을 찾을 수 없습니다.`);"), ['Retirement']);
});

test("'Retirement'와 상태명 '퇴역'은 허용", () => {
  assert.deepEqual(hits("title: 'Flag Retirement'"), []);
  assert.deepEqual(hits("RETIRED: 'Registry 퇴역'"), []);
});

test('주석 줄은 검사하지 않는다', () => {
  assert.deepEqual(hits('// 이전 표기: Flag 은퇴'), []);
  assert.deepEqual(hits(' * 은퇴 6단계 설명'), []);
});

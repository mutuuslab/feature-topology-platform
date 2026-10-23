// 설명문(lead) 규칙 회귀 시험 — UX3-14
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadHits } from './lead-copy.ts';

test('70자 넘는 설명문과 코드가 든 설명문을 잡는다', () => {
  const src = [
    "    lead: '배포된 정책을 이전 버전으로 되돌립니다 — 실행은 승인 뒤에만.',",
    `    lead: '${'가'.repeat(71)}',`,
    "    lead: '차량이 먼저 보낸 조회(IF-10)와 보고(IF-06)',",
    "    lead: 'FFG-PLT-003 규칙을 따릅니다',",
    '    lead: "보고서 6.5 절차",',
  ].join('\n');
  assert.deepEqual(leadHits(src).map((h) => `${h.line}:${h.why}`), ['2:long', '3:code', '4:code', '5:code']);
});

test('lead 키가 아닌 문구·따옴표가 든 문구는 오탐하지 않는다', () => {
  const src = [
    "    title: 'IF-10 차량 조회',",
    "    leadTime: '보고서 6',",
    "    lead: '차량의 \\'마지막 보고\\' 기준입니다',",
    `    lead: '${'가'.repeat(70)}',`,
  ].join('\n');
  assert.deepEqual(leadHits(src), []);
});

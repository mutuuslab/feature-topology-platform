// 조사 규칙 회귀 시험 — P1-12 '팀로'(부서 이름 뒤 고정 '로')
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { particleHits } from './particle-copy.ts';

test('이름 자리 변수 뒤 고정 조사와 팀 뒤 틀린 조사를 잡는다', () => {
  const src = [
    '    to: (dept: string) => `${dept}로`,',
    '    by: (name: string) => `${name}이 승인`,',
    "    note: '품질팀로 보냅니다',",
    '    owner: (o: { name: string }) => `${o.name}을 지정`,',
  ].join('\n');
  assert.deepEqual(particleHits(src).map((h) => h.line), [1, 2, 3, 4]);
});

test('받침으로 고른 조사·번호·ID·영문 값과 주석은 오탐하지 않는다', () => {
  const src = [
    '    to: (dept: string) => `${dept}${roParticle(dept)}`,',
    '    submitted: (id: string) => `${id}로 접수됨`,',
    '    restored: (r: number) => `r${r}로 새 개정본`,',
    "    note: '품질팀으로 보냅니다 · 관제실로',",
    '    // `${dept}로` 예전 문구',
    '    count: (name: string) => `${name}에서`,',
  ].join('\n');
  assert.deepEqual(particleHits(src), []);
});

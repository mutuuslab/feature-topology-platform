// ADS 상태 용어 규칙 시험 — 결함 주입: 단독 '차단'·'보류'와 금지 낱말을 잡고, 정해진 합성어는 통과시킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adsTermHits } from './ads-copy-terms.ts';

test('금지 — 단독 차단·보류, 모름의 다른 낱말, 사용 준비 완료', () => {
  for (const s of ["a: '차단 중',", "b: '보류된 차량',", "c: '확인 불가',", "d: '사용 준비 완료',", "e: '차단 해제',"]) assert.equal(adsTermHits(s).length, 1, s);
});

test('허용 — 긴급 차단·종료 차단·종료 차단 해제·전달 보류·확대 보류·판단 불가·미확인, 주석', () => {
  for (const s of ["a: '긴급 차단',", "b: '종료 차단 해제',", "c: '전달 보류',", "d: '확대 보류 — 지표 지연',", "e: '품질 보류',", "f: '판단 불가 · 미확인',", "// 차단 보류 확인 불가"]) assert.deepEqual(adsTermHits(s), [], s);
});

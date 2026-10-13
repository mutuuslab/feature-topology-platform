// 형제 저장소 고정 판정 — 회귀: FF_IMP가 고정 커밋을 포함하지 않는 checkout(다른 세션의 브랜치)이면 verify가 실패해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFfImp } from './siblings.ts';

const PIN = '5a1138cd7884343566d4dce2f909a177c2889b6d';

test('저장소가 없으면 SKIP (CI)', () => {
  assert.equal(judgeFfImp({ present: false, isGit: false, containsPin: false, dirty: [] }, PIN).status, 'SKIP');
});

test('고정 커밋을 포함하지 않는 checkout은 FAIL', () => {
  const v = judgeFfImp({ present: true, isGit: true, containsPin: false, dirty: [], head: '88c13f7' }, PIN);
  assert.equal(v.status, 'FAIL');
  assert.match(v.note, /5a1138c/);
});

test('시험이 쓰는 폴더에 미커밋 변경이 있으면 FAIL', () => {
  assert.equal(judgeFfImp({ present: true, isGit: true, containsPin: true, dirty: [' M gleo/decision_engine.py'], head: '0a044dd' }, PIN).status, 'FAIL');
});

test('고정 커밋 이후의 깨끗한 checkout은 PASS', () => {
  assert.equal(judgeFfImp({ present: true, isGit: true, containsPin: true, dirty: [], head: '0a044dd' }, PIN).status, 'PASS');
});

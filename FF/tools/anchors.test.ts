// 판정 근거 줄 잠금(tools/anchors.ts) — 같은 줄 번호에 다른 내용이 오면 잡고, 줄이 밀렸으면 해시로 찾아 옮긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorProblems, anchorsOf, lineHash, lockedAnchors, readLock, relock, remapByLock, type AnchorLock } from './anchors.ts';

const fs = (files: Record<string, string>) => (p: string) => files[p] ?? null;
const SRC = ['import x;', '', 'export function gate() {', '  if (!ok) throw new Error("막힘");', '}'].join('\n');

test('같은 줄 번호에 다른 내용이 오면 실패한다 — 옛 검사(빈 줄·닫는 괄호만)는 통과시키던 경우', () => {
  const lock = relock(['a.ts:4'], fs({ 'a.ts': SRC }));
  assert.deepEqual(anchorProblems(['a.ts:4'], lock, fs({ 'a.ts': SRC })), []);
  const changed = SRC.replace('throw new Error("막힘")', 'console.warn("통과")'); // 4번째 줄이 여전히 내용 있는 줄
  const p = anchorProblems(['a.ts:4'], lock, fs({ 'a.ts': changed }));
  assert.equal(p.length, 1);
  assert.match(p[0], /근거 줄 내용이 바뀜: a\.ts:4/);
  // 공백·줄 끝(CRLF)만 다르면 같은 내용
  assert.deepEqual(anchorProblems(['a.ts:4'], lock, fs({ 'a.ts': SRC.replace(/\n/g, '\r\n').replace('  if', '    if') })), []);
});

test('잠금에 없는 근거는 실패한다(새 근거는 판정을 확인하고 --lock)', () => {
  const p = anchorProblems(['a.ts:3'], { note: '', anchors: {} }, fs({ 'a.ts': SRC }));
  assert.match(p[0], /근거 줄 잠금 없음: a\.ts:3/);
  // 파일·줄이 없는 근거는 여기서 내지 않는다(evidenceProblem이 낸다)
  assert.deepEqual(anchorProblems(['b.ts:1', 'a.ts:99'], { note: '', anchors: {} }, fs({ 'a.ts': SRC })), []);
});

test('줄이 밀리면 같은 해시의 가장 가까운 줄로 옮기고 잠금 키도 옮긴다, 내용이 사라지면 LOST', () => {
  const lock: AnchorLock = { note: '', anchors: { 'a.ts:4': lineHash('  if (!ok) throw new Error("막힘");'), 'a.ts:3': lineHash('export function gate() {') } };
  const shifted = ['import x;', '// 새 주석', '', 'export function gate() {', '  if (!ok) throw new Error("막힘");', '}'].join('\n');
  const texts = { 'review.json': '{"evidence":["a.ts:4","a.ts:3"]}', 'other.json': '"a.ts:4"' };
  const r = remapByLock(texts, lock, fs({ 'a.ts': shifted }));
  assert.deepEqual(r.moved.sort(), [['a.ts:3', 'a.ts:4'], ['a.ts:4', 'a.ts:5']]);
  // 한 번에 바꾼다 — a.ts:3→4와 a.ts:4→5가 겹쳐도 두 번 밀리지 않는다
  assert.equal(r.texts['review.json'], '{"evidence":["a.ts:5","a.ts:4"]}');
  assert.equal(r.texts['other.json'], '"a.ts:5"');
  assert.deepEqual(Object.keys(r.lock.anchors).sort(), ['a.ts:4', 'a.ts:5']);
  assert.deepEqual(anchorProblems(['a.ts:4', 'a.ts:5'], r.lock, fs({ 'a.ts': shifted })), []);
  const gone = remapByLock(texts, lock, fs({ 'a.ts': shifted.replace('throw new Error("막힘")', 'return') }));
  assert.deepEqual(gone.lost, ['a.ts:4']);
  // 사라진 근거(a.ts:4)는 그대로 두고, 밀린 a.ts:3만 4로 옮긴다
  assert.equal(gone.texts['review.json'], '{"evidence":["a.ts:4","a.ts:4"]}');
});

test('잠금 키가 사슬로 밀려도(a→b, b→c) 앞 근거의 키를 지우지 않는다 — 잠금 순서와 상관없이', () => {
  // 회귀(2026-11-06 통합): 잠금이 a.ts:3, a.ts:4 순서면 3→4로 넣은 키를 이어서 4→5가 지워 a.ts:4 잠금이 사라졌다
  const h3 = lineHash('export function gate() {');
  const h4 = lineHash('  if (!ok) throw new Error("막힘");');
  const shifted = ['import x;', '// 새 주석', '', 'export function gate() {', '  if (!ok) throw new Error("막힘");', '}'].join('\n');
  for (const anchors of [{ 'a.ts:3': h3, 'a.ts:4': h4 }, { 'a.ts:4': h4, 'a.ts:3': h3 }]) {
    const r = remapByLock({ 'review.json': '{"evidence":["a.ts:3","a.ts:4"]}' }, { note: '', anchors }, fs({ 'a.ts': shifted }));
    assert.deepEqual(r.lock.anchors, { 'a.ts:4': h3, 'a.ts:5': h4 });
    assert.equal(r.texts['review.json'], '{"evidence":["a.ts:4","a.ts:5"]}');
  }
});

test('evidence 배열의 "경로:줄"만 모은다(경로만 있는 근거·tests 경로는 빼고)', () => {
  const review = { requirements: { R1: { evidence: ['a.ts:3', 'b.ts'], tests: ['t.spec.ts:1'] } }, items: { x: { evidence: ['c.tsx:10', 'a.ts:3'] } } };
  assert.deepEqual(anchorsOf(review), ['a.ts:3', 'c.tsx:10']);
});

test('저장소 잠금은 ADS·Orca 판정 근거와 정확히 같은 집합이다(빠진 근거·안 쓰는 잠금 없음)', () => {
  const anchors = lockedAnchors();
  assert.ok(anchors.length > 100, `근거가 너무 적다: ${anchors.length}`);
  assert.deepEqual(Object.keys(readLock().anchors).sort(), anchors);
});

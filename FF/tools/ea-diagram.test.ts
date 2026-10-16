// EA 원본 다이어그램 렌더 — 색 변환(BGR)·그리기 순서·원본 파일에서 읽은 구성(6 도메인·12 레이어·49 컴포넌트)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bgr, build, renderSvg, sourceFile, textWidth, wrapName, type Shape } from './ea-diagram.ts';

test('EA 색 정수는 BGR, 음수는 기본색', () => {
  assert.equal(bgr(12903679), '#ffe4c4');
  assert.equal(bgr(16443110), '#e6e6fa');
  assert.equal(bgr(-1), null);
});

test('Sequence가 큰 상자(도메인)를 먼저 그려 작은 상자가 위에 온다, 빈 글 상자는 그리지 않는다', () => {
  const s = (id: number, seq: number, type = 'Component', name = `n${id}`): Shape => ({ id, name, type, stereotype: '', x: 0, y: 0, w: 10, h: 10, seq, fill: null });
  const svg = renderSvg([s(1, 1), s(2, 9, 'Package'), s(3, 5, 'Text', '')], 't');
  assert.ok(svg.indexOf('data-ea-id="2"') < svg.indexOf('data-ea-id="1"'));
  assert.ok(!svg.includes('data-ea-id="3"'));
});

// 회귀: 상자 폭보다 긴 이름이 상자 밖으로 넘쳤다('SW 배포·기능 출시 분리' 115 px 상자)
test('상자 폭을 넘는 이름은 공백·가운뎃점에서 두 줄로, 짧은 이름은 한 줄', () => {
  assert.deepEqual(wrapName('Feature Registry', 140, 12), ['Feature Registry']);
  const two = wrapName('SW 배포·기능 출시 분리', 105, 12);
  assert.equal(two.length, 2);
  assert.ok(two.every((l) => textWidth(l, 11) <= 105), two.join(' / '));
  assert.deepEqual(wrapName('RBAC', 10, 12), ['RBAC']);
});

test('원본 .qea — Layered Architecture: 6 도메인 · 12 레이어 · 49 컴포넌트, 이름은 원본 그대로', () => {
  const { meta, shapes } = build(sourceFile());
  const m = JSON.parse(meta);
  assert.deepEqual(m.counts, { domains: 6, layers: 12, components: 49, nesting: 12 });
  assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.ok(shapes.some((x) => x.name === 'Feature Registry' && x.fill === '#e6e6fa'));
});

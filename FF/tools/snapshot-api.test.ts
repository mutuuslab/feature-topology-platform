// 스냅샷 백엔드가 도중에 끝날 때의 문구(tools/snapshot-api.ts) — 2026-11-06 static-build가 'snapshot:api 실패: fetch failed' 한 줄만 남겨
// 원인(바깥 timeout이 프로세스 트리를 끊음·포트 충돌)을 알 수 없었다. 종료 신호·코드·포트·마지막 출력과 힌트가 보이는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendGoneMessage, pushTail } from './snapshot-api.ts';

test('출력 꼬리는 색 코드를 빼고 빈 줄 없이 마지막 N줄만', () => {
  const tail: string[] = [];
  pushTail(tail, '\x1b[32m[Nest] LOG\x1b[39m 시작\r\n\r\n', 3);
  pushTail(tail, 'a\nb\nc\n', 3);
  assert.deepEqual(tail, ['a', 'b', 'c']);
  pushTail(tail, '[Nest] LOG 시작', 3);
  assert.deepEqual(tail, ['b', 'c', '[Nest] LOG 시작']);
});

test('신호로 끝나면 바깥에서 끝냈다는 힌트, 포트 충돌이면 SNAPSHOT_PORT 힌트, 마지막 출력을 붙인다', () => {
  const killed = backendGoneMessage('/api/features 요청 중에', { code: null, signal: 'SIGTERM' }, 51234, ['[Nest] LOG ShowcaseFill 19/19']);
  assert.match(killed, /\/api\/features 요청 중에 끝났습니다\(신호 SIGTERM, 포트 51234\)/);
  assert.match(killed, /바깥에서 끝냈습니다/);
  assert.match(killed, /ShowcaseFill 19\/19/);
  const busy = backendGoneMessage('시작하기 전에', { code: 1, signal: null }, 9243, ['Error: listen EADDRINUSE: address already in use :::9243']);
  assert.match(busy, /종료 1, 포트 9243/);
  assert.match(busy, /포트가 이미 쓰이고 있습니다/);
  assert.match(backendGoneMessage('도중에', { code: 1, signal: null }, 1, []), /\(없음\)/);
});

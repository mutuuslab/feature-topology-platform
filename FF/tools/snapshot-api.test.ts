// 스냅샷 백엔드가 도중에 끝날 때의 문구(tools/snapshot-api.ts) — 2026-11-06 static-build가 'snapshot:api 실패: fetch failed' 한 줄만 남겨
// 원인(바깥 timeout이 프로세스 트리를 끊음·포트 충돌)을 알 수 없었다. 종료 신호·코드·포트·마지막 출력과 힌트가 보이는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendGoneMessage, evidenceManifestIds, pushTail, retryableFetchError, snapshotCostReferencePicker } from './snapshot-api.ts';
import { snapshotTx } from './snapshot-tx.ts';

test('captures the complete taxonomy tree and the exact level queries used by the classification editor',async()=>{
  const calls:{name:string;params:Record<string,string>;query:Record<string,unknown>}[]=[];
  await snapshotTx(async(name,params={},query={})=>{calls.push({name,params,query});return {items:[]};},{features:[],policies:[]});
  const nodes=calls.filter(c=>c.name==='taxonomyNodes');
  assert.deepEqual(nodes.map(c=>c.query.level??'ALL'),['ALL','L0','L1','L2','L3','L4','L5']);
  assert.deepEqual(nodes.find(c=>c.query.level==='L2'),{name:'taxonomyNodes',params:{},query:{level:'L2'}});
});

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

// 통합 10단계(ads) 결함 — 정규식 /EVM-d{4}/(백슬래시 빠짐)가 실제 ID를 하나도 못 찾아 Evidence manifest 스냅샷이 0개였다
test('Safety Case 응답의 Evidence manifest ID를 중복 없이 모두 찾는다', () => {
  const sc = { features: [{ featureId: 'FEAT-00004', evidence: [{ manifestId: 'EVM-0001' }, { ref: 'EVM-0002' }] }, { note: 'EVM-0001 재사용' }] };
  assert.deepEqual(evidenceManifestIds(sc), ['EVM-0001', 'EVM-0002']);
  assert.deepEqual(evidenceManifestIds({ text: 'EVM-dddd' }), []);
});

// 통합 12단계 — 공개본 스냅샷(전시 480대·ADS 차량별 판정 수천 건)을 찍다 유지 연결(keep-alive)을 서버가 닫는 순간 다시 쓴 GET이 ECONNRESET으로 끊겨 빌드 전체가 멈췄다.
// 읽기(GET)는 한 번 다시 보내고, 쓰기·다른 오류는 그대로 실패시킨다
test('끊긴 연결의 GET만 한 번 다시 보낸다', () => {
  const err = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
  assert.equal(retryableFetchError(err('ECONNRESET')), true);
  assert.equal(retryableFetchError(err('UND_ERR_SOCKET'), { method: 'GET' }), true);
  assert.equal(retryableFetchError(err('ECONNRESET'), { method: 'POST' }), false, '쓰기는 다시 보내지 않는다');
  assert.equal(retryableFetchError(err('ECONNREFUSED')), false, '서버가 없으면 다시 보내도 같다');
  assert.equal(retryableFetchError(new Error('x')), false);
});

test('cost reference picker captures its exact initial native GET, without inventing a sliced response', async () => {
  const calls: unknown[] = [];
  await snapshotCostReferencePicker(async (...args) => { calls.push(args); return { items: [] }; });
  assert.deepEqual(calls, [['listRefs', {}, { limit: 10, offset: 0 }]]);
  assert.deepEqual(Object.keys((calls[0] as any[])[2]), ['limit', 'offset']);
});

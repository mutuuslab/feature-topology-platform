// CARLA 검증 서버 점검 판정 — 공유 서버(2000)·FF 외 차량은 FAIL, 실행기가 스스로 고치는 상태(맵·동기 모드·잔여 FF 차량)는 WARN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './carla-doctor.ts';

const OK = { server: '0.9.16', map: 'Town04', synchronous: false, vehicles: 0, foreignVehicles: 0 };
const worst = (c: ReturnType<typeof judge>) => (c.some((x) => x.status === 'FAIL') ? 'FAIL' : c.some((x) => x.status === 'WARN') ? 'WARN' : 'PASS');

test('준비된 검증 전용 서버는 PASS', () => {
  assert.equal(worst(judge(OK, 2100)), 'PASS');
});

test('공유 서버 포트(2000)는 탐침 없이 FAIL', () => {
  const c = judge(OK, 2000);
  assert.equal(worst(c), 'FAIL');
  assert.match(c[0].note, /공유 서버/);
});

test('서버가 없거나 FF 외 차량이 있거나 버전이 다르면 FAIL', () => {
  assert.match(judge({ error: '127.0.0.1:2100에 연결할 수 없습니다' }, 2100)[0].note, /npm run carla:up/);
  assert.equal(worst(judge({ ...OK, vehicles: 28, foreignVehicles: 28 }, 2100)), 'FAIL');
  assert.equal(worst(judge({ ...OK, server: '0.9.15' }, 2100)), 'FAIL');
  assert.equal(worst(judge(null, 2100)), 'FAIL');
});

test('다른 맵·동기 모드 잔류·이전 FF 차량은 WARN (실행기가 정리)', () => {
  assert.equal(worst(judge({ ...OK, map: 'Town10HD_Opt' }, 2100)), 'WARN');
  assert.equal(worst(judge({ ...OK, synchronous: true }, 2100)), 'WARN');
  assert.equal(worst(judge({ ...OK, vehicles: 2 }, 2100)), 'WARN');
});

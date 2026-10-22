// 'Twin/트윈' 표기 검사 — 화면에 보이는 문구만 잡고, 경로·식별자·주석은 통과시킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twinVisible } from './twin-terms.ts';

test('문자열·JSX 텍스트 안의 Twin 표기를 잡는다', () => {
  assert.equal(twinVisible("title: 'Twin Fleet'"), true);
  assert.equal(twinVisible('<h2>디지털 트윈 현황</h2>'), true);
  assert.equal(twinVisible("label: 'Digital Twin'"), true);
});

// 회귀(2026-10-23): pages/twinOps.tsx의 여러 줄 JSX 텍스트 둘째 줄
// "장애 주입 → Twin 이상 감지 → …"는 같은 줄에 따옴표·'>'가 없어 검사를 빠져나갔다.
test('여러 줄 JSX 텍스트의 이어지는 줄도 잡는다', () => {
  assert.equal(twinVisible('        장애 주입 → Twin 이상 감지 → Rollout 자동 일시정지 → 운영자 판단 → Kill-Switch'), true);
  assert.equal(twinVisible('  트윈 계층이 실제로 발행한 이벤트'), true);
});

test('경로·식별자·코드·주석은 통과', () => {
  assert.equal(twinVisible("navigate('/twin/vehicle/VIN-1')"), false);
  assert.equal(twinVisible('import { TwinVehicle } from "./twin";'), false);
  assert.equal(twinVisible('const twins = data.twins.map((t) => t.vin);'), false);
  assert.equal(twinVisible('// Twin 계층이 실제로 발행한 두 원천'), false);
  assert.equal(twinVisible(' * Twin 이벤트 + Twin 감사 이력을 합친다.'), false);
  assert.equal(twinVisible('        12단계 폐루프를 검증합니다.'), false);
});

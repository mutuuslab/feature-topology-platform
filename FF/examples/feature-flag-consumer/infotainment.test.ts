import assert from 'node:assert/strict';
import { test } from 'node:test';
import { infotainmentDecision } from './infotainment.ts';

test('가상 IVI 소비 코드는 네 Flag를 독립적으로 적용하며 동일 VIN과 명시한 OFF 기본값을 사용한다', () => {
  const calls: { key: string; fallback: boolean; vin: string }[] = [];
  const enabled = new Set(['ivi_00027_voice', 'ivi_00024_guide']);
  const client = { getBooleanValue(key: string, fallback: false, context: { targetingKey: string }) { calls.push({ key, fallback, vin: context.targetingKey }); return enabled.has(key); } };
  assert.deepEqual(infotainmentDecision(client, 'DEMO-VIN-001'), { detail: false, banner: false, voice: true, guide: true });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.fallback === false && c.vin === 'DEMO-VIN-001'));
  enabled.clear();
  assert.deepEqual(infotainmentDecision(client, 'DEMO-VIN-001'), { detail: false, banner: false, voice: false, guide: false });
  enabled.add('ivi_00027_detail'); enabled.add('ivi_00027_banner');
  assert.deepEqual(infotainmentDecision(client, 'DEMO-VIN-001'), { detail: true, banner: true, voice: false, guide: false });
});

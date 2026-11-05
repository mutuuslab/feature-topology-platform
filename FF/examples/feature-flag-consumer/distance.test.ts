import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceDecision, type FlagClient } from './distance.ts';

test('Flag false는 기본 제어, Signal true는 경고 계산, Parameter는 별도로 켜진다', async () => {
  const calls: { key: string; fallback: boolean; vin: string }[] = [];
  const client = (values: Record<string, boolean>): FlagClient => ({ getBooleanValue: async (key, fallback, context) => {
    calls.push({ key, fallback, vin: context.targetingKey });
    return values[key] ?? fallback;
  } });
  assert.deepEqual(await distanceDecision(client({}), 'TEST-VIN', 5), { mode: 'BASE_CONTROL', warning: false, parameterEnabled: false });
  assert.deepEqual(await distanceDecision(client({ care_00022_signal: true }), 'TEST-VIN', 5), { mode: 'FEATURE', warning: true, parameterEnabled: false });
  assert.deepEqual(await distanceDecision(client({ care_00022_signal: true, care_00022_param: true }), 'TEST-VIN', 30), { mode: 'FEATURE', warning: false, parameterEnabled: true });
  assert.ok(calls.every((c) => c.fallback === false && c.vin === 'TEST-VIN'));
});

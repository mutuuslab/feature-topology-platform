// OTA 사실 ↔ 차량 결과 불일치(P9, 80-45 §14) — 판정은 바꾸지 않고 어긋난 차량만 골라낸다
import { describe, expect, it } from 'vitest';
import { otaMismatches } from './ota-reconcile';
import type { OtaVehicleOutcome } from './ota';

const node = (nodeId: string, state: string, reason = state === 'UNKNOWN' ? 'NO_REPORT' : 'MATCH') => ({ nodeId, state, reason });

describe('otaMismatches', () => {
  it('넘겼다(DELIVERED)는데 차량 결과 없음, 못 넘겼다는데 결과 있음만 — 나머지(일치·OTA 기록 없음·전달 중)는 보지 않는다', () => {
    const ota = new Map<string, OtaVehicleOutcome>([
      ['V1', 'DELIVERED'],
      ['V2', 'DELIVERED'],
      ['V3', 'NO_RESPONSE'],
      ['V4', 'NO_RESPONSE'],
      ['V5', 'NOT_ELIGIBLE'],
      ['V6', 'DELIVERING'],
      ['V8', 'CANCELLED'],
    ]);
    const nodes = [node('V1', 'UNKNOWN'), node('V2', 'CONFIRMED'), node('V3', 'CONFIRMED'), node('V4', 'UNKNOWN'), node('V5', 'UNKNOWN', 'REJECTED:BAD_SIGNATURE'), node('V6', 'UNKNOWN'), node('V7', 'UNKNOWN'), node('V8', 'DIVERGED')];
    expect(otaMismatches(nodes, ota)).toEqual([
      { vin: 'V1', code: 'OTA_DELIVERED_NO_VEHICLE_RESULT', otaOutcome: 'DELIVERED' },
      { vin: 'V3', code: 'VEHICLE_RESULT_WITHOUT_OTA_DELIVERY', otaOutcome: 'NO_RESPONSE' },
      { vin: 'V5', code: 'VEHICLE_RESULT_WITHOUT_OTA_DELIVERY', otaOutcome: 'NOT_ELIGIBLE' },
      { vin: 'V8', code: 'VEHICLE_RESULT_WITHOUT_OTA_DELIVERY', otaOutcome: 'CANCELLED' },
    ]);
  });

  it('모두 일치하면 빈 목록', () => {
    expect(otaMismatches([node('V1', 'CONFIRMED'), node('V2', 'UNKNOWN')], new Map<string, OtaVehicleOutcome>([['V1', 'DELIVERED'], ['V2', 'NO_RESPONSE']]))).toEqual([]);
  });
});

// OTA 서버 연동 규격 IF-05 계약 — webhook 본문은 모르는 필드를 무시하고(뒤 호환), 판 번호는 주 번호로 맞춘다
import { describe, expect, it } from 'vitest';
import { OTA_ERROR_CODES, OTA_SPEC_VERSION, OTA_VEHICLE_OUTCOMES, OTA_VEHICLE_REPORTED, OtaEvent, otaSpecCompatible } from './ota';

const EVENT = { specVersion: '1.0', eventId: 'evt-0000001', type: 'vehicle.results', jobId: 'OTJ-PUB-00001', occurredAt: '2026-10-24T01:00:00.000Z', results: [{ vin: 'V1', outcome: 'APPLIED', at: '2026-10-24T01:00:00.000Z', observed: 'x' }] };

describe('OTA 연동 규격 IF-05 계약', () => {
  it('판 번호 — 같은 주 번호면 맞고, 다른 주 번호·형식 오류는 맞지 않는다', () => {
    expect(OTA_SPEC_VERSION).toBe('1.0');
    expect(otaSpecCompatible('1.0')).toBe(true);
    expect(otaSpecCompatible('1.7')).toBe(true);
    expect(otaSpecCompatible('2.0')).toBe(false);
    expect(otaSpecCompatible('1')).toBe(false);
    expect(otaSpecCompatible(undefined)).toBe(false);
  });

  it('webhook 본문 — 모르는 필드는 버리고 받는다(필드 추가는 호환), 모르는 결과 값은 거부', () => {
    const r = OtaEvent.parse({ ...EVENT, futureField: 1, results: [{ ...EVENT.results[0], futureVehicleField: 'x' }] });
    expect(r).not.toHaveProperty('futureField');
    expect(r.results![0]).not.toHaveProperty('futureVehicleField');
    expect(OtaEvent.safeParse({ ...EVENT, results: [{ ...EVENT.results[0], outcome: 'MAYBE' }] }).success).toBe(false);
    expect(OtaEvent.safeParse({ ...EVENT, eventId: 'x' }).success).toBe(false);
  });

  it('차량이 직접 알린 결과는 끝 결과 목록에 있고, 오류 코드 표는 재시도 여부를 정한다', () => {
    for (const o of OTA_VEHICLE_REPORTED) expect(OTA_VEHICLE_OUTCOMES).toContain(o);
    expect(OTA_ERROR_CODES.UNAVAILABLE.retryable).toBe(true);
    expect(OTA_ERROR_CODES.IDEMPOTENCY_CONFLICT.retryable).toBe(false);
  });
});

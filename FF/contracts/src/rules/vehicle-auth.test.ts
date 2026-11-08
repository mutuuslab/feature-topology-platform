// 차량 요청 인증 계약 — 정규 문자열 고정, 모든 실패 코드가 보안 이벤트로 센다, 확인 본문 규칙
import { describe, expect, it } from 'vitest';
import { securityEventOf } from './security-events';
import { VEHICLE_AUTH_FAILURES, VEHICLE_AUTH_FORMAT, VehicleDeliveryAck, vehicleRequestCanonical } from './vehicle-auth';

describe('차량 요청 인증 계약 (RD-SEC-08)', () => {
  it('정규 문자열은 판·메서드·경로·VIN·epoch·시각·nonce·본문 해시를 줄바꿈으로 잇는다(메서드는 대문자)', () => {
    expect(vehicleRequestCanonical({ method: 'post', path: '/vehicle/v1/V1/reports?x=1', vin: 'V1', keyEpoch: 2, timestamp: '1760000000000', nonce: 'n'.repeat(22), bodySha256: 'ab' })).toBe(
      ['FFV1-REQ', 'POST', '/vehicle/v1/V1/reports?x=1', 'V1', '2', '1760000000000', 'n'.repeat(22), 'ab'].join('\n'),
    );
  });

  it('인증 실패 코드는 모두 보안 이벤트(진위 실패·재전송)로 센다', () => {
    for (const code of Object.keys(VEHICLE_AUTH_FAILURES)) expect(securityEventOf(code), code).not.toBeNull();
    expect(securityEventOf('REQUEST_MAC_INVALID')!.id).toBe('AUTH_FAILURE');
    expect(securityEventOf('REQUEST_REPLAY')!.id).toBe('REPLAY_SEQUENCE');
    expect(securityEventOf('REQUEST_TIME_SKEW')!.id).toBe('REPLAY_SEQUENCE');
  });

  it('머리글 형식 — 태그는 16바이트 base64url, nonce는 16자 이상', () => {
    expect(VEHICLE_AUTH_FORMAT.mac.test('A'.repeat(22))).toBe(true);
    expect(VEHICLE_AUTH_FORMAT.mac.test('A'.repeat(21))).toBe(false);
    expect(VEHICLE_AUTH_FORMAT.nonce.test('short')).toBe(false);
    expect(VEHICLE_AUTH_FORMAT.vin.test('KMH-NX4-0002')).toBe(true);
    expect(VEHICLE_AUTH_FORMAT.vin.test('../etc')).toBe(false);
  });

  it('전달 확인 — 적용은 되읽은 값, 거부는 사유가 필요하다', () => {
    const h = 'sha256:' + 'a'.repeat(64);
    expect(VehicleDeliveryAck.safeParse({ bootId: 'B1', result: 'APPLIED', observed: 'x', policyHash: h }).success).toBe(true);
    expect(VehicleDeliveryAck.safeParse({ bootId: 'B1', result: 'APPLIED', policyHash: h }).success).toBe(false);
    expect(VehicleDeliveryAck.safeParse({ bootId: 'B1', result: 'REJECTED', policyHash: h }).success).toBe(false);
    expect(VehicleDeliveryAck.safeParse({ bootId: 'B1', result: 'REJECTED', rejectReason: 'REPLAY', policyHash: h }).success).toBe(true);
  });
});

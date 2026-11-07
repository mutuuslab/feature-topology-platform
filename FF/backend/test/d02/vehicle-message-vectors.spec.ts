// TL-M01 — FFV1-MSG 시험 벡터의 태그를 플랫폼 암호 코드로 다시 계산한다(차량·참조 Lake·FF가 같은 값을 내야 한다).
// 요청 키 K_r은 FFV1-REQ와 같은 파생(requestKeyOf), 태그는 AES-CMAC-128(RFC 4493).
import { FFV1_MSG_TEST_VECTORS as V, vehicleMessageCanonical, vehicleRequestCanonical } from '@ff/contracts';
import { describe, expect, it } from 'vitest';
import { aesCmac, sha256hex, vehiclePseudonym } from '../../src/kernel/crypto';
import { requestKeyOf } from '../../src/kernel/vehicle-auth-client';

const kr = requestKeyOf(Buffer.from(V.vehicleKeyHex, 'hex'));

describe('FFV1-MSG 시험 벡터(TL-M01)', () => {
  it('요청 키·가명 파생이 벡터와 같다', () => {
    expect(kr.toString('hex')).toBe(V.requestKeyHex);
    expect(vehiclePseudonym(V.vin)).toBe(V.pseudonym);
  });

  it.each(V.vectors.map((v) => [v.name, v] as const))('%s — 정규 문자열의 AES-CMAC이 벡터 태그다', (_, v) => {
    const m = v.message;
    expect(sha256hex(Buffer.from(m.body_b64, 'base64'))).toBe(m.body_sha256);
    const canonical = vehicleMessageCanonical({ kind: m.kind, ref: m.ref, pseudonym: m.pseudonym, keyEpoch: m.auth.key_epoch, timestamp: m.auth.timestamp, nonce: m.auth.nonce, bodySha256: m.body_sha256 });
    expect(aesCmac(kr, Buffer.from(canonical, 'utf8')).toString('base64url')).toBe(m.auth.mac);
    // 같은 값을 FFV1-REQ로 서명하면 다른 태그 — 두 서명을 서로 옮겨 쓸 수 없다
    const req = vehicleRequestCanonical({ method: 'POST', path: `/vehicle/v1/${V.vin}/status`, vin: V.vin, keyEpoch: m.auth.key_epoch, timestamp: m.auth.timestamp, nonce: m.auth.nonce, bodySha256: m.body_sha256 });
    expect(aesCmac(kr, Buffer.from(req, 'utf8')).toString('base64url')).toBe(v.ffv1ReqMac);
  });
});

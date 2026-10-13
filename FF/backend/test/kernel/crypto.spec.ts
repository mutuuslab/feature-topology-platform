// 소프트웨어 HSM 기본 연산 — AES-CMAC-128 RFC 4493 §4 시험 벡터, HKDF 결정성 (보고서 9.2 cmd_auth·9.7 state_auth)
import { describe, expect, it } from 'vitest';
import { aesCmac, equalBytes, hkdf16 } from '../../src/kernel/crypto';

const K = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
const M = Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710', 'hex');

describe('AES-CMAC-128 (RFC 4493 시험 벡터)', () => {
  it.each([
    [0, 'bb1d6929e95937287fa37d129b756746'],
    [16, '070a16b46b4d4144f79bdd9dd04a287c'],
    [40, 'dfa66747de9ae63030ca32611497c827'],
    [64, '51f0bebf7e3b9d92fc49741779363cfe'],
  ])('길이 %i 바이트', (n, tag) => {
    expect(aesCmac(K, M.subarray(0, n)).toString('hex')).toBe(tag);
  });
  it('키 길이가 16바이트가 아니면 거부', () => {
    expect(() => aesCmac(Buffer.alloc(8), M)).toThrow(/16바이트/);
  });
});

describe('차량 키 파생(HKDF-SHA256)', () => {
  it('같은 root·epoch·VIN이면 같은 키, epoch나 VIN이 다르면 다른 키', () => {
    const root = Buffer.alloc(32, 7);
    const a = hkdf16(root, 'epoch:1', 'ffp-vehicle-key|ego-01');
    expect(a.length).toBe(16);
    expect(equalBytes(a, hkdf16(root, 'epoch:1', 'ffp-vehicle-key|ego-01'))).toBe(true);
    expect(equalBytes(a, hkdf16(root, 'epoch:2', 'ffp-vehicle-key|ego-01'))).toBe(false);
    expect(equalBytes(a, hkdf16(root, 'epoch:1', 'ffp-vehicle-key|lead-01'))).toBe(false);
  });
});

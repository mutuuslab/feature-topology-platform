// RFC 8785 정규화 — 표준 문서의 예와 같은 바이트(FFG-PLT-001 서명 입력)
import { describe, expect, it } from 'vitest';
import { b64url, fromB64url, jcs } from './jcs';

describe('JCS RFC 8785 (FFG-PLT-001)', () => {
  it('RFC 8785 §3.2.2 예 — 키 정렬·숫자·문자열 이스케이프', () => {
    // 원문: {"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"€$\u000F\u000aA'B"\\\\"\/","literals":[null,true,false]}
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: '€$\u000f\nA\'B"\\\\"/',
      literals: [null, true, false],
    };
    // 원문 출력: {"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}
    const want = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
    expect(jcs(input)).toBe(want);
  });
  it('키는 UTF-16 코드 단위 순, undefined는 빠진다', () => {
    expect(jcs({ b: 1, a: undefined, A: [2, { z: true, y: null }] })).toBe('{"A":[2,{"y":null,"z":true}],"b":1}');
  });
  it('NaN·Infinity는 거부', () => {
    expect(() => jcs({ x: Infinity })).toThrow(/I-JSON/);
  });
  it('base64url 왕복(패딩 없음)', () => {
    const b = Uint8Array.from([251, 255, 0, 1, 2]);
    expect(b64url(b)).toBe('-_8AAQI');
    expect([...fromB64url('-_8AAQI')]).toEqual([...b]);
  });
});

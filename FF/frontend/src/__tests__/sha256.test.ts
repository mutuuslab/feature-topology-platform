import { sha256Hex } from '../data/sha256';

describe('SHA-256 (NIST 벡터)', () => {
  it('빈 문자열·abc·표준 벡터와 일치한다', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('56바이트 경계(패딩 블록 추가)를 넘겨도 맞는다', () => {
    expect(sha256Hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(sha256Hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('한글(멀티바이트)도 UTF-8 기준으로 해싱한다', () => {
    expect(sha256Hex('안전 기본값')).toBe(sha256Hex('안전 기본값'));
    expect(sha256Hex('안전 기본값')).toHaveLength(64);
    expect(sha256Hex('안전 기본값')).not.toBe(sha256Hex('안전기본값'));
  });
});

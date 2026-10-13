// JSON Canonicalization Scheme(RFC 8785) — 서명·승인 서명·해시의 입력 바이트. 보고서 8.2: "JWS 분리 서명, JCS 정규화".
// 키는 UTF-16 코드 단위 순으로 정렬(JS 기본 정렬), 숫자·문자열은 ECMAScript JSON 직렬화를 따른다(RFC 8785 §3.2.2).
/** @rule FFG-PLT-001 — 서명 대상 바이트의 정규화(스키마 v2 적합성 검사는 정책 게이트 WP3에서) */
export function jcs(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('JCS: NaN·Infinity는 직렬화할 수 없습니다(I-JSON)');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`)
      .join(',')}}`;
  }
  throw new Error(`JCS: 직렬화할 수 없는 값(${typeof v})`);
}

/** base64url(패딩 없음) — JWS·approval_sig·cmd_auth 표기 */
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

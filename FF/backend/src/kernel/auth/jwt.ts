// JWT(JWS compact) 검증 — 외부 의존성 없이 node:crypto만. OIDC id_token·Bearer 접근 토큰에 같은 함수를 쓴다.
//  · 서명 알고리즘 허용 목록: RS256·PS256·ES256 (none·HS* 거부 — 공개키로 HMAC을 위조하는 알고리즘 혼동 방지)
//  · 발급자(iss)·대상(aud)·만료(exp)·발효(nbf)·발급(iat) — 시계 차이 60초 허용
//  · 토큰 크기 상한 — 거대한 토큰으로 파싱·서명 검증 비용을 키우지 못하게
import { constants, createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from 'node:crypto';

export const ALLOWED_ALGS = ['RS256', 'PS256', 'ES256'] as const;
export type JwtAlg = (typeof ALLOWED_ALGS)[number];
export const MAX_TOKEN_LENGTH = 12 * 1024;
export const CLOCK_SKEW_SEC = 60;

export interface Jwk extends JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export type JwtClaims = Record<string, unknown> & { iss?: string; sub?: string; aud?: string | string[]; exp?: number; nbf?: number; iat?: number; nonce?: string; azp?: string };

export class JwtError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const B64URL = /^[A-Za-z0-9_-]*$/;

function part(s: string): Buffer {
  if (!B64URL.test(s)) throw new JwtError('MALFORMED');
  return Buffer.from(s, 'base64url');
}

function json<T>(s: string): T {
  try {
    const v = JSON.parse(part(s).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new JwtError('MALFORMED');
  }
}

/** 서명 확인 없이 머리·본문만 — kid 고르기용. 형식이 틀리면 JwtError */
export function decodeJwt(token: string): { header: JwtHeader; claims: JwtClaims; signingInput: string; signature: Buffer } {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) throw new JwtError(token?.length > MAX_TOKEN_LENGTH ? 'TOO_LARGE' : 'MALFORMED');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new JwtError('MALFORMED');
  const header = json<JwtHeader>(parts[0]);
  const claims = json<JwtClaims>(parts[1]);
  return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature: part(parts[2]) };
}

/** JWK → 공개키. 비밀키 성분(d)이 있거나 대칭키(oct)면 거부 */
export function publicKeyOf(jwk: Jwk): KeyObject {
  if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') throw new JwtError('UNSUPPORTED_KEY');
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...pub } = jwk as Jwk & Record<string, unknown>;
  return createPublicKey({ key: pub as JsonWebKey, format: 'jwk' });
}

function verifySignature(alg: JwtAlg, key: KeyObject, input: string, sig: Buffer): boolean {
  const data = Buffer.from(input);
  if (alg === 'RS256') return key.asymmetricKeyType === 'rsa' && cryptoVerify('sha256', data, key, sig);
  if (alg === 'PS256') return (key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss') && cryptoVerify('sha256', data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, sig);
  // ES256 — JWS는 r||s(64바이트) 원시 형식
  if (key.asymmetricKeyType !== 'ec' || sig.length !== 64) return false;
  return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
}

export interface VerifyOptions {
  issuer: string;
  /** 허용 대상 — 토큰 aud 중 하나가 여기에 있어야 한다 */
  audience: string;
  /** kid로 키 찾기(없으면 null) — 캐시·재조회는 부르는 쪽 */
  key: (header: JwtHeader) => Promise<Jwk | null>;
  /** id_token — 로그인 요청 때 만든 nonce와 같아야 한다 */
  nonce?: string;
  /** 여러 대상이면 azp가 이 클라이언트여야 한다(OIDC Core 3.1.3.7) */
  clientId?: string;
  nowSec?: number;
}

/** 검증된 클레임. 실패는 JwtError(reason) — reason에 토큰 값을 넣지 않는다 */
export async function verifyJwt(token: string, o: VerifyOptions): Promise<JwtClaims> {
  const { header, claims, signingInput, signature } = decodeJwt(token);
  if (!(ALLOWED_ALGS as readonly string[]).includes(header.alg)) throw new JwtError('ALG_NOT_ALLOWED');
  const jwk = await o.key(header);
  if (!jwk) throw new JwtError('UNKNOWN_KEY');
  if (jwk.alg && jwk.alg !== header.alg) throw new JwtError('ALG_MISMATCH');
  if (jwk.use && jwk.use !== 'sig') throw new JwtError('KEY_NOT_FOR_SIGNING');
  let key: KeyObject;
  try {
    key = publicKeyOf(jwk);
  } catch {
    throw new JwtError('BAD_KEY');
  }
  let ok = false;
  try {
    ok = verifySignature(header.alg as JwtAlg, key, signingInput, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new JwtError('BAD_SIGNATURE');

  const now = o.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== o.issuer) throw new JwtError('WRONG_ISSUER');
  const aud = typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud.filter((a) => typeof a === 'string') : [];
  if (!aud.includes(o.audience)) throw new JwtError('WRONG_AUDIENCE');
  if (o.clientId && aud.length > 1 && claims.azp !== undefined && claims.azp !== o.clientId) throw new JwtError('WRONG_AZP');
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) throw new JwtError('NO_EXPIRY');
  if (now - CLOCK_SKEW_SEC >= claims.exp) throw new JwtError('EXPIRED');
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || now + CLOCK_SKEW_SEC < claims.nbf)) throw new JwtError('NOT_YET_VALID');
  if (claims.iat !== undefined && (typeof claims.iat !== 'number' || now + CLOCK_SKEW_SEC < claims.iat)) throw new JwtError('ISSUED_IN_FUTURE');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new JwtError('NO_SUBJECT');
  if (o.nonce !== undefined && claims.nonce !== o.nonce) throw new JwtError('NONCE_MISMATCH');
  return claims;
}

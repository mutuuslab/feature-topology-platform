// 인증 부품 단위 시험 — JWT 검증(알고리즘 허용 목록·서명·클레임), 설정 검사(FF_AUTH·OIDC_*), 안전한 returnTo, 서명 쿠키, 역할 매핑.
// readiness: RD-SEC-01
import { constants, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authConfigProblems, authModeOf, claimValues, mapRoles, parseRoleMap } from '../../src/kernel/auth/auth-config';
import { safeReturnTo } from '../../src/kernel/auth/auth.service';
import { safeEqual, signValue, unsignValue } from '../../src/kernel/auth/cookies';
import { JwtError, verifyJwt, type Jwk } from '../../src/kernel/auth/jwt';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const ISS = 'https://idp.example/realms/ff';

function token(alg: string, key: KeyObject | null, claims: Record<string, unknown>, opts: { kid?: string; dsa?: 'ieee-p1363' | 'der'; pss?: boolean } = {}) {
  const input = `${b64u(JSON.stringify({ alg, kid: opts.kid ?? 'k1' }))}.${b64u(JSON.stringify(claims))}`;
  if (!key) return `${input}.`;
  const sig =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(input), { key, dsaEncoding: opts.dsa ?? 'ieee-p1363' })
      : alg === 'PS256'
        ? sign('sha256', Buffer.from(input), { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
        : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64u(sig)}`;
}
const base = (over: Record<string, unknown> = {}) => ({ iss: ISS, aud: 'ff', sub: 'u1', iat: now(), exp: now() + 300, ...over });

describe('JWT 검증 — RS256·PS256·ES256만, 클레임 엄격', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = (k: KeyObject, extra: Partial<Jwk> = {}): Jwk => ({ ...(k.export({ format: 'jwk' }) as Jwk), kid: 'k1', ...extra });
  const opts = (key: Jwk | null, more: Record<string, unknown> = {}) => ({ issuer: ISS, audience: 'ff', key: async () => key, ...more });
  const reason = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'OK';
    } catch (e) {
      return e instanceof JwtError ? e.reason : 'OTHER';
    }
  };

  it('세 알고리즘 모두 올바른 서명을 받는다', async () => {
    expect((await verifyJwt(token('RS256', rsa.privateKey, base()), opts(jwk(rsa.publicKey)))).sub).toBe('u1');
    expect((await verifyJwt(token('PS256', rsa.privateKey, base()), opts(jwk(rsa.publicKey)))).sub).toBe('u1');
    expect((await verifyJwt(token('ES256', ec.privateKey, base()), opts(jwk(ec.publicKey)))).sub).toBe('u1');
  });

  it('none·HS256·RS512 거부, 키의 alg와 다르면 거부, 알고리즘 혼동(RSA 키로 ES256) 거부, DER 형식 ES 서명 거부', async () => {
    expect(await reason(verifyJwt(token('none', null, base()), opts(jwk(rsa.publicKey))))).toBe('ALG_NOT_ALLOWED');
    expect(await reason(verifyJwt(token('HS256', rsa.privateKey, base()), opts(jwk(rsa.publicKey))))).toBe('ALG_NOT_ALLOWED');
    expect(await reason(verifyJwt(token('RS512', rsa.privateKey, base()), opts(jwk(rsa.publicKey))))).toBe('ALG_NOT_ALLOWED');
    expect(await reason(verifyJwt(token('PS256', rsa.privateKey, base()), opts(jwk(rsa.publicKey, { alg: 'RS256' }))))).toBe('ALG_MISMATCH');
    expect(await reason(verifyJwt(token('ES256', ec.privateKey, base()), opts(jwk(rsa.publicKey))))).toBe('BAD_SIGNATURE');
    expect(await reason(verifyJwt(token('ES256', ec.privateKey, base(), { dsa: 'der' }), opts(jwk(ec.publicKey))))).toBe('BAD_SIGNATURE');
    expect(await reason(verifyJwt(token('RS256', rsa.privateKey, base()), opts(jwk(rsa.publicKey, { use: 'enc' }))))).toBe('KEY_NOT_FOR_SIGNING');
    expect(await reason(verifyJwt(token('RS256', rsa.privateKey, base()), opts(null)))).toBe('UNKNOWN_KEY');
    // 대칭키(oct) JWK는 키로 받지 않는다
    expect(await reason(verifyJwt(token('RS256', rsa.privateKey, base()), opts({ kty: 'oct', k: 'AAAA', kid: 'k1' })))).toBe('BAD_KEY');
  });

  it('발급자·대상·만료·발효·발급·주체·nonce·azp', async () => {
    const k = jwk(rsa.publicKey);
    const t = (c: Record<string, unknown>) => token('RS256', rsa.privateKey, base(c));
    expect(await reason(verifyJwt(t({ iss: `${ISS}/` }), opts(k)))).toBe('WRONG_ISSUER');
    expect(await reason(verifyJwt(t({ aud: ['other'] }), opts(k)))).toBe('WRONG_AUDIENCE');
    expect(await reason(verifyJwt(t({ aud: ['ff', 'other'] }), opts(k)))).toBe('OK');
    expect(await reason(verifyJwt(t({ aud: ['ff', 'other'], azp: 'other' }), opts(k, { clientId: 'ff' })))).toBe('WRONG_AZP');
    expect(await reason(verifyJwt(t({ exp: now() - 61 }), opts(k)))).toBe('EXPIRED');
    expect(await reason(verifyJwt(t({ exp: now() - 59 }), opts(k)))).toBe('OK');
    expect(await reason(verifyJwt(t({ exp: undefined }), opts(k)))).toBe('NO_EXPIRY');
    expect(await reason(verifyJwt(t({ nbf: now() + 120 }), opts(k)))).toBe('NOT_YET_VALID');
    expect(await reason(verifyJwt(t({ iat: now() + 120 }), opts(k)))).toBe('ISSUED_IN_FUTURE');
    expect(await reason(verifyJwt(t({ sub: '' }), opts(k)))).toBe('NO_SUBJECT');
    expect(await reason(verifyJwt(t({ nonce: 'n1' }), opts(k, { nonce: 'n2' })))).toBe('NONCE_MISMATCH');
    expect(await reason(verifyJwt(t({ nonce: 'n1' }), opts(k, { nonce: 'n1' })))).toBe('OK');
  });

  it('형식 오류·거대 토큰', async () => {
    const k = jwk(rsa.publicKey);
    expect(await reason(verifyJwt('a.b', opts(k)))).toBe('MALFORMED');
    expect(await reason(verifyJwt('!!.e30.x', opts(k)))).toBe('MALFORMED');
    expect(await reason(verifyJwt(`${b64u('[]')}.${b64u('{}')}.x`, opts(k)))).toBe('MALFORMED');
    expect(await reason(verifyJwt('a'.repeat(13_000), opts(k)))).toBe('TOO_LARGE');
  });
});

describe('인증 설정 검사 — 문제를 모두 알려 주고 비밀값은 메시지에 없다', () => {
  const OIDC = {
    FF_AUTH: 'oidc',
    OIDC_ISSUER: 'https://idp.oem.example/realms/ff',
    OIDC_CLIENT_ID: 'ff-platform',
    OIDC_CLIENT_SECRET: 'super-secret-client-value',
    FF_PUBLIC_URL: 'https://ff.oem.example',
    FF_SESSION_SECRET: 's'.repeat(40),
    OIDC_ROLE_MAP: '/ff/authors=FEATURE_AUTHOR,ff-safety=SAFETY_OFFICER|GATE_JUDGE',
  };

  it('데모가 기본(운영 모드가 아닐 때), 운영 모드 기본은 oidc', () => {
    expect(authModeOf({})).toBe('demo');
    expect(authModeOf({ FF_ENV: 'production' })).toBe('oidc');
    expect(authConfigProblems({})).toEqual([]);
    expect(authConfigProblems(OIDC)).toEqual([]);
  });

  it('운영 모드에서 데모 인증은 부팅 거부', () => {
    const p = runtimeConfigProblems({ FF_ENV: 'production', FF_AUTH: 'demo' }).join('\n');
    expect(p).toContain('FF_AUTH=demo');
  });

  it('필수 값이 없거나 틀리면 한 번에 모두 — 운영 모드는 https만', () => {
    const p = authConfigProblems({ FF_ENV: 'production', FF_AUTH: 'oidc', OIDC_ISSUER: 'http://idp.local', FF_PUBLIC_URL: 'http://ff.local/app', FF_SESSION_SECRET: 'short-secret-value', OIDC_ROLE_MAP: 'g1=NOT_A_ROLE,g2=SYSTEM,broken', FF_SESSION_IDLE_MIN: '0' }).join('\n');
    for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'FF_PUBLIC_URL', 'FF_SESSION_SECRET', "'NOT_A_ROLE'", "'SYSTEM'", "'broken'", 'FF_SESSION_IDLE_MIN']) expect(p).toContain(k);
    expect(p).not.toContain('short-secret-value');
    expect(authConfigProblems({ FF_AUTH: 'oidc' }).join('\n')).toContain('OIDC_ROLE_MAP이 없습니다');
    // 비밀은 문제 메시지에 나오지 않는다
    expect(authConfigProblems({ ...OIDC, FF_SESSION_SECRET: 'tooshort' }).join('\n')).not.toContain('tooshort');
    expect(authConfigProblems({ ...OIDC, OIDC_CLIENT_SECRET: '' }).join('\n')).not.toContain('super-secret-client-value');
  });

  it('역할 표 — 그룹 이름의 =·경로, 여러 역할, 사람 역할만', () => {
    const m = parseRoleMap('/ff/a=b=FEATURE_AUTHOR,ff-s=SAFETY_OFFICER|GATE_JUDGE,ff-s=OPERATOR');
    expect(m.get('/ff/a=b')).toEqual(['FEATURE_AUTHOR']);
    expect(m.get('ff-s')).toEqual(['SAFETY_OFFICER', 'GATE_JUDGE', 'OPERATOR']);
    // 역할 목록(contracts ROLES) 순서, 중복 없이
    expect(mapRoles(['ff-s', 'unknown', 'ff-s'], m)).toEqual(['SAFETY_OFFICER', 'GATE_JUDGE', 'OPERATOR']);
    expect(mapRoles(['unknown'], m)).toEqual([]);
  });

  it('클레임 — 배열·공백 문자열·중첩 경로(Keycloak realm_access.roles)·점이 든 이름', () => {
    expect(claimValues({ groups: ['a', 1, 'b'] }, 'groups')).toEqual(['a', 'b']);
    expect(claimValues({ roles: 'a b' }, 'roles')).toEqual(['a', 'b']);
    expect(claimValues({ realm_access: { roles: ['ff-x'] } }, 'realm_access.roles')).toEqual(['ff-x']);
    expect(claimValues({ 'https://ff/roles': ['r'] }, 'https://ff/roles')).toEqual(['r']);
    expect(claimValues({}, 'groups')).toEqual([]);
  });
});

describe('안전한 returnTo·서명 쿠키', () => {
  it('같은 출처의 상대 경로만', () => {
    expect(safeReturnTo('/features?q=1#x')).toBe('/features?q=1#x');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '/\t/evil', '/\n/evil', '/api/auth/login', '', null, 42, '/' + 'a'.repeat(3000)]) expect(safeReturnTo(bad)).toBe('/');
  });

  it('용도별 HMAC 서명 — 값·서명·용도가 바뀌면 null, 비교는 상수 시간', () => {
    const s = signValue('k'.repeat(32), 'session', 'abc');
    expect(unsignValue('k'.repeat(32), 'session', s)).toBe('abc');
    expect(unsignValue('k'.repeat(32), 'login', s)).toBeNull();
    expect(unsignValue('j'.repeat(32), 'session', s)).toBeNull();
    expect(unsignValue('k'.repeat(32), 'session', s.replace('abc', 'abd'))).toBeNull();
    expect(unsignValue('k'.repeat(32), 'session', 'abc')).toBeNull();
    expect(unsignValue('k'.repeat(32), 'session', null)).toBeNull();
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });
});

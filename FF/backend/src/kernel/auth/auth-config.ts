// 인증 설정 — 출시 준비 RD-SEC-01·RD-SEC-04 (docs/20-architecture/20-90-production-readiness.md "인증(OIDC)").
// FF_AUTH = demo(운영 모드가 아닐 때 기본 — X-Actor-* 헤더 데모 인증) | oidc(고객사 IdP SSO, BFF 세션 쿠키 + Bearer).
// 운영 모드(FF_ENV=production)는 oidc만 받는다. 값(비밀)은 문제 메시지에 넣지 않는다.
import { HUMAN_ROLES, type Role } from '@ff/contracts';

type Env = Record<string, string | undefined>;

export type AuthMode = 'demo' | 'oidc';

export const authModeOf = (env: Env = process.env): AuthMode => {
  const v = (env.FF_AUTH ?? '').trim();
  if (v === 'oidc' || v === 'demo') return v;
  return env.FF_ENV === 'production' ? 'oidc' : 'demo';
};

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** 설치의 공개 출처(https://ff.oem.example) — redirect URI = publicUrl + /api/auth/callback */
  publicUrl: string;
  publicOrigin: string;
  redirectUri: string;
  sessionSecret: string;
  /** IdP 그룹 → 플랫폼 역할 */
  roleMap: Map<string, Role[]>;
  /** 역할을 읽을 클레임 — 점으로 중첩 경로(Keycloak realm_access.roles) */
  roleClaim: string;
  /** Bearer 접근 토큰의 대상(aud) — 기본 client id */
  audience: string;
  scopes: string;
  /** 세션 절대 수명·유휴 만료(분) */
  sessionTtlMin: number;
  sessionIdleMin: number;
  /** 운영 모드 — 쿠키 Secure */
  secureCookies: boolean;
  /** CSRF Origin 허용 — 공개 출처 + FF_CORS_ORIGINS */
  allowedOrigins: string[];
}

const ROLE_SET = new Set<string>(HUMAN_ROLES);

/** OIDC_ROLE_MAP `idpGroup=ROLE,idpGroup2=ROLE|ROLE2` — 문제는 errors에 모은다(값 일부만) */
export function parseRoleMap(raw: string | undefined, errors: string[] = []): Map<string, Role[]> {
  const out = new Map<string, Role[]>();
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    // 그룹 이름에 '='가 들어갈 수 있어 마지막 '='로 나눈다(역할 이름에는 '='가 없다)
    const i = part.lastIndexOf('=');
    const group = i > 0 ? part.slice(0, i).trim() : '';
    const roles = i > 0 ? part.slice(i + 1).split('|').map((s) => s.trim()).filter(Boolean) : [];
    if (!group || !roles.length) {
      errors.push(`OIDC_ROLE_MAP 항목 '${part.slice(0, 60)}' — 'IdP그룹=역할' 또는 'IdP그룹=역할|역할' 형식이어야 합니다`);
      continue;
    }
    const bad = roles.filter((r) => !ROLE_SET.has(r));
    if (bad.length) {
      errors.push(`OIDC_ROLE_MAP의 역할 ${bad.map((b) => `'${b.slice(0, 40)}'`).join(', ')} — 사람 역할(${HUMAN_ROLES.join(', ')})만 쓸 수 있습니다`);
      continue;
    }
    out.set(group, [...new Set([...(out.get(group) ?? []), ...(roles as Role[])])]);
  }
  return out;
}

const positive = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const originOf = (u: string): string | null => {
  try {
    const x = new URL(u);
    return x.origin === 'null' ? null : x.origin;
  } catch {
    return null;
  }
};

/** 인증 설정 문제 — FF_AUTH=oidc면 운영 모드가 아니어도 검사한다(설정이 틀린 채 부팅하지 않게) */
export function authConfigProblems(env: Env = process.env): string[] {
  const out: string[] = [];
  const prod = env.FF_ENV === 'production';
  const mode = authModeOf(env);
  if (prod && mode !== 'oidc') out.push(`FF_AUTH=${env.FF_AUTH} — 운영 모드는 고객사 IdP SSO(FF_AUTH=oidc)만 씁니다. 데모 헤더 인증은 누구나 역할을 주장할 수 있습니다`);
  if (mode !== 'oidc') return out;
  const issuer = (env.OIDC_ISSUER ?? '').trim();
  if (!issuer) out.push('OIDC_ISSUER가 없습니다 — IdP 발급자 주소(예: https://idp.example.com/realms/ff)');
  else if (!/^https?:\/\/[^\s]+$/.test(issuer) || (prod && !issuer.startsWith('https://'))) out.push('OIDC_ISSUER — http(s) 주소여야 하고 운영 모드는 https만 받습니다');
  if (!env.OIDC_CLIENT_ID?.trim()) out.push('OIDC_CLIENT_ID가 없습니다 — IdP에 등록한 클라이언트 ID');
  if (!env.OIDC_CLIENT_SECRET?.trim()) out.push('OIDC_CLIENT_SECRET이 없습니다 — 기밀 클라이언트 비밀(BFF가 토큰을 교환한다)');
  const pub = (env.FF_PUBLIC_URL ?? '').trim();
  const origin = originOf(pub);
  if (!pub) out.push('FF_PUBLIC_URL이 없습니다 — 설치의 공개 출처(예: https://ff.example.com), redirect URI는 FF_PUBLIC_URL/api/auth/callback');
  else if (!origin || origin !== pub.replace(/\/+$/, '') || (prod && !pub.startsWith('https://'))) out.push(`FF_PUBLIC_URL '${pub.slice(0, 80)}' — scheme://host[:port] 출처 하나(경로 없이)이고 운영 모드는 https만 받습니다`);
  const secret = env.FF_SESSION_SECRET ?? '';
  if (secret.length < 32) out.push('FF_SESSION_SECRET이 없거나 32자보다 짧습니다 — 쿠키 서명용 무작위 비밀(예: openssl rand -base64 48)');
  const errs: string[] = [];
  const map = parseRoleMap(env.OIDC_ROLE_MAP, errs);
  out.push(...errs);
  if (!errs.length && !map.size) out.push('OIDC_ROLE_MAP이 없습니다 — IdP 그룹을 플랫폼 역할에 잇는 표(예: ff-authors=FEATURE_AUTHOR,ff-safety=SAFETY_OFFICER|GATE_JUDGE)');
  for (const k of ['FF_SESSION_TTL_MIN', 'FF_SESSION_IDLE_MIN'] as const) {
    if (env[k] !== undefined && !(Number(env[k]) > 0)) out.push(`${k} — 양의 분 단위 숫자여야 합니다`);
  }
  return out;
}

/** 검증된 설정 — authConfigProblems가 비었을 때만 부른다 */
export function oidcConfigOf(env: Env = process.env): OidcConfig {
  const publicUrl = (env.FF_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  const publicOrigin = originOf(publicUrl) ?? publicUrl;
  const clientId = (env.OIDC_CLIENT_ID ?? '').trim();
  const cors = (env.FF_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    issuer: (env.OIDC_ISSUER ?? '').trim().replace(/\/+$/, ''),
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET ?? '',
    publicUrl,
    publicOrigin,
    redirectUri: `${publicUrl}/api/auth/callback`,
    sessionSecret: env.FF_SESSION_SECRET ?? '',
    roleMap: parseRoleMap(env.OIDC_ROLE_MAP),
    roleClaim: (env.OIDC_ROLE_CLAIM ?? '').trim() || 'groups',
    audience: (env.OIDC_AUDIENCE ?? '').trim() || clientId,
    scopes: (env.OIDC_SCOPES ?? '').trim() || 'openid profile email',
    sessionTtlMin: positive(env.FF_SESSION_TTL_MIN, 480),
    sessionIdleMin: positive(env.FF_SESSION_IDLE_MIN, 60),
    secureCookies: env.FF_ENV === 'production',
    allowedOrigins: [...new Set([publicOrigin, ...cors])],
  };
}

/** 클레임 값(배열·공백 구분 문자열·중첩 경로) → IdP 그룹들 */
export function claimValues(claims: Record<string, unknown>, path: string): string[] {
  let v: unknown = claims;
  // 정확한 이름이 먼저 — Azure AD처럼 클레임 이름에 점이 들어가는 경우
  if (Object.prototype.hasOwnProperty.call(claims, path)) v = claims[path];
  else for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean);
  return [];
}

/** IdP 그룹 → 플랫폼 역할(중복 없이, 역할 목록 순서) */
export function mapRoles(groups: string[], roleMap: Map<string, Role[]>): Role[] {
  const got = new Set<Role>();
  for (const g of groups) for (const r of roleMap.get(g) ?? []) got.add(r);
  return HUMAN_ROLES.filter((r) => got.has(r));
}

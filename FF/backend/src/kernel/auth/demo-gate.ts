// 공개 데모 게이트 — 클라우드 VM 공개 시연(docs/20-architecture/20-99-cloud-vm-deploy.md §인증).
// 데모 헤더 인증(FF_AUTH=demo)은 누구나 X-Actor-* 머리글로 역할을 주장할 수 있어 인터넷에 그대로 열 수 없다.
// FF_DEMO_GATE=on이면 그 위에 서버 세션을 하나 더 둔다:
//  · POST /api/auth/demo-login(데모 ID·비밀번호) → 서버 쪽 세션(auth_session) + httpOnly 쿠키. 세션 없이 오는 요청은 401
//  · 머리글은 데모 계정 표(contracts DEMO_PERSONAS, 행위자 ID usr-<계정>) 안의 조합만 받는다 — 표 밖의 ID·역할·SYSTEM·VEHICLE은 403·DENIED
//  · 쿠키로 오는 변경 요청은 Origin이 FF_PUBLIC_URL이어야 한다(CSRF)
// 운영 모드(FF_ENV=production)는 이 게이트를 쓰지 않는다 — 고객 설치는 OIDC만(auth-config.ts).
// 이 파일의 설정은 고객 설치 템플릿(docker/app/.env.example)이 아니라 deploy/cloud-vm/.env.example에 있다.
import { DEMO_PERSONAS, Role, type Role as RoleT } from '@ff/contracts';
import { MOCK_WEBHOOK_SECRETS } from '../runtime-config';

type Env = Record<string, string | undefined>;

export const demoGateOn = (env: Env = process.env) => ['on', '1', 'true'].includes((env.FF_DEMO_GATE ?? '').trim().toLowerCase());

/** 공개 데모 기본 자격 증명 — 화면의 데모 로그인과 같다(대소문자 구분 없음). 비공개 시연이면 FF_DEMO_PASSWORD로 바꾼다 */
export const DEMO_GATE_DEFAULT_ID = 'FF';
export const DEMO_GATE_DEFAULT_PASSWORD = 'FF';
/** 출처(IP)별 10분 창 로그인 성공 한도 — 공개 비밀번호로 세션·감사 이력을 끝없이 쌓지 못하게(한 사무실 NAT 뒤 시연 인원은 넉넉히) */
export const DEMO_LOGIN_LIMIT = 60;

/** ID·비밀번호 비교용 — ASCII 대소문자만 무시한다(유니코드 대문자 변환은 'ﬀ'→'FF'처럼 다른 문자열을 같게 만든다) */
export const foldAscii = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

export interface DemoGateConfig {
  loginId: string;
  password: string;
  sessionSecret: string;
  sessionTtlMin: number;
  sessionIdleMin: number;
  publicOrigin: string;
  allowedOrigins: string[];
  secureCookies: boolean;
}

const WEBHOOK_ENV = ['GITLAB_WEBHOOK_TOKEN', 'JIRA_WEBHOOK_SECRET', 'CODEBEAMER_WEBHOOK_SECRET'] as const;

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

/** 게이트 설정 문제 — 값(비밀)은 메시지에 넣지 않는다 */
export function demoGateProblems(env: Env = process.env): string[] {
  if (!demoGateOn(env)) return [];
  const out: string[] = [];
  if (env.FF_ENV === 'production') out.push('FF_DEMO_GATE — 운영 모드는 데모 게이트를 쓰지 않습니다(고객사 IdP SSO, FF_AUTH=oidc)');
  if ((env.FF_AUTH ?? 'demo').trim() !== 'demo') out.push('FF_DEMO_GATE — 데모 인증(FF_AUTH=demo) 위에만 둡니다');
  if ((env.FF_SESSION_SECRET ?? '').length < 32) out.push('FF_SESSION_SECRET이 없거나 32자보다 짧습니다 — 데모 게이트 세션 쿠키 서명용 무작위 비밀');
  const pub = (env.FF_PUBLIC_URL ?? '').trim();
  const origin = originOf(pub);
  if (!pub || !origin || origin !== pub.replace(/\/+$/, '')) out.push('FF_PUBLIC_URL — 공개 출처 하나(scheme://host[:port], 경로 없이). 쿠키 변경 요청의 Origin을 이것과 비교합니다');
  // 쿠키 변경 요청의 출처 확인이 이 목록을 쓴다 — 'null'·'*'·경로가 섞이면 다른 사이트(샌드박스 iframe 등)의 요청이 통과한다
  for (const o of (env.FF_CORS_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (originOf(o) !== o) out.push(`FF_CORS_ORIGINS — 출처(scheme://host[:port], 경로·끝 빗금 없이)만 씁니다: '${o.slice(0, 80)}'`);
  }
  const pw = env.FF_DEMO_PASSWORD;
  if (pw !== undefined && pw !== '' && pw.length < 2) out.push('FF_DEMO_PASSWORD — 2자 이상(비우면 공개 데모 기본값)');
  // 공개 저장소의 모의 webhook 비밀이면 누구나 외부 시스템인 척 상태를 바꿀 수 있다
  for (const k of WEBHOOK_ENV) if (!env[k] || MOCK_WEBHOOK_SECRETS.includes(env[k]!)) out.push(`${k} — 공개 데모도 새 무작위 값이 필요합니다(비었거나 공개된 모의 값)`);
  if ((env.FF_VEHICLE_AUTH ?? '').trim() !== 'required') out.push('FF_VEHICLE_AUTH — 공개 데모도 required(차량 CMAC·mTLS). 머리글만으로 차량인 척할 수 없게');
  return out;
}

/** 검증된 설정 — demoGateProblems가 비었을 때만 */
export function demoGateConfigOf(env: Env = process.env): DemoGateConfig {
  const publicOrigin = originOf((env.FF_PUBLIC_URL ?? '').trim()) ?? '';
  const cors = (env.FF_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    loginId: (env.FF_DEMO_LOGIN_ID ?? '').trim() || DEMO_GATE_DEFAULT_ID,
    password: env.FF_DEMO_PASSWORD || DEMO_GATE_DEFAULT_PASSWORD,
    sessionSecret: env.FF_SESSION_SECRET ?? '',
    sessionTtlMin: positive(env.FF_SESSION_TTL_MIN, 480),
    sessionIdleMin: positive(env.FF_SESSION_IDLE_MIN, 120),
    publicOrigin,
    allowedOrigins: [...new Set([publicOrigin, ...cors])],
    secureCookies: publicOrigin.startsWith('https://'),
  };
}

/** 게스트(역할 전환기에서 계정을 고르지 않은 화면) — 조회만 */
const GUEST = 'usr-guest';

/**
 * 머리글 → 데모 계정 표 안의 행위자. 표 밖이면 거부 사유.
 *  · 둘 다 없으면 조회는 익명 감사 조회자, 변경은 401(데모와 같다)
 *  · ID는 usr-<DEMO_PERSONAS 키>(또는 usr-guest), 역할은 그 계정이 맡은 것만
 */
export type GateActor = { ok: true; id: string; role: RoleT; roles: RoleT[] } | { ok: false; status: 401 | 403; reason: string };
/** 거부인가 — strict 설정이 아니어도 좁혀지게 'reason' 유무로 본다 */
export const gateRejected = (g: GateActor): g is Extract<GateActor, { ok: false }> => 'reason' in g;

export function gateActorOf(idRaw: string, roleRaw: string, write: boolean): GateActor {
  const id = idRaw.trim();
  const role = roleRaw.trim();
  if (!id && !role) {
    if (write) return { ok: false, status: 401, reason: '변경 요청에는 데모 계정(X-Actor-Id·X-Actor-Role)이 필요합니다' };
    return { ok: true, id: 'anonymous', role: 'AUDITOR', roles: ['AUDITOR'] };
  }
  const parsed = Role.safeParse(role);
  const key = /^usr-([a-z0-9]{1,32})$/.exec(id)?.[1];
  const granted: RoleT[] | undefined = id === GUEST ? ['AUDITOR'] : key && Object.prototype.hasOwnProperty.call(DEMO_PERSONAS, key) ? DEMO_PERSONAS[key] : undefined;
  if (!granted) return { ok: false, status: 403, reason: '데모 계정 표에 없는 행위자 ID' };
  if (!parsed.success || !granted.includes(parsed.data)) return { ok: false, status: 403, reason: `데모 계정 ${id}에 없는 역할 주장` };
  return { ok: true, id, role: parsed.data, roles: [...granted] };
}

/** 로그인 횟수 제한 — 출처(IP)별 10분 창 limit회(기본 10, 실패 기록용). 비밀번호를 바꾼 비공개 시연에서 대입 공격을 늦춘다. 성공(세션 생성) 한도도 같은 틀(DEMO_LOGIN_LIMIT) */
export class LoginThrottle {
  private readonly fails = new Map<string, { start: number; n: number }>();
  constructor(
    private readonly limit = 10,
    private readonly windowMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 막혔으면 다시 시도까지 초, 아니면 0 */
  blocked(key: string): number {
    const w = this.fails.get(key);
    const t = this.now();
    if (!w || t - w.start >= this.windowMs) return 0;
    return w.n >= this.limit ? Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000)) : 0;
  }

  fail(key: string) {
    const t = this.now();
    let w = this.fails.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, n: 0 };
      this.fails.set(key, w);
      if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (t - v.start >= this.windowMs) this.fails.delete(k);
    }
    w.n++;
  }

  reset(key: string) {
    this.fails.delete(key);
  }
}

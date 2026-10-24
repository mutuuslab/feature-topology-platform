// 실행 모드 설정 검사 — 출시 준비 RD-OPS-01·RD-OPS-12·RD-SEC-07·RD-SEC-09 (docs/20-architecture/20-90-production-readiness.md).
// FF_ENV=production(운영 모드)이면 데모·시험용 기본값을 받아들이지 않는다. 문제를 한 번에 모두 알려 주고 부팅을 멈춘다.
// 운영 모드가 아니면(기본 개발·데모·시험) 지금까지의 기본값을 그대로 쓴다. 값(비밀)은 메시지에 넣지 않는다.
// 인증(FF_AUTH·OIDC_*·FF_SESSION_*)은 auth/auth-config.ts — FF_AUTH=oidc면 운영 모드가 아니어도 검사한다(RD-SEC-01).
import { authConfigProblems } from './auth/auth-config';

type Env = Record<string, string | undefined>;

export const isProduction = (env: Env = process.env) => env.FF_ENV === 'production';

/** 데모·시험에서만 쓰는 손잡이 — 운영 모드에서 켜져 있으면 거부 */
const TEST_KNOBS = ['FF_CLOCK_AT', 'FF_SCHEDULER', 'FF_HSM_VEHICLE_ROOT', 'FF_DEMO_FIXTURES', 'FF_SYNTHETIC', 'FF_EXT_FIXTURES', 'FF_SEED_ANCHOR'] as const;

/** 공개 저장소에 적힌 모의 비밀 — 운영 모드에서 이 값이면 아무나 서명을 만들 수 있다 */
export const MOCK_WEBHOOK_SECRETS = ['ff-mock-gitlab-token', 'ff-mock-jira-secret', 'ff-mock-codebeamer-secret'];
const WEBHOOK_ENV = ['GITLAB_WEBHOOK_TOKEN', 'JIRA_WEBHOOK_SECRET', 'CODEBEAMER_WEBHOOK_SECRET'] as const;

/** 시드 기본값 — 운영 모드는 빈 DB(none), 그 밖에는 데모 데이터(v0.81) */
export const seedOf = (env: Env = process.env) => env.FF_SEED ?? (isProduction(env) ? 'none' : 'v0.81');

/** CORS 허용 출처 — 운영 모드는 FF_CORS_ORIGINS(쉼표)만, 비었으면 다른 출처를 허용하지 않는다(같은 출처 배치). 그 밖에는 모두 허용 */
export function corsOrigins(env: Env = process.env): true | string[] {
  if (!isProduction(env)) return true;
  return (env.FF_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 문제 목록(비었으면 시작해도 됨) — 시험과 시작 검사가 같은 함수를 쓴다 */
export function runtimeConfigProblems(env: Env = process.env): string[] {
  if (!isProduction(env)) return authConfigProblems(env);
  const out: string[] = [];
  const db = (env.FF_DB ?? '').trim();
  if (!db || db === ':memory:') out.push('FF_DB가 없거나 :memory:입니다 — 운영 모드는 재시작 뒤에도 남는 DB 파일이 필요합니다');
  const seed = seedOf(env);
  if (seed !== 'none') out.push(`FF_SEED=${seed} — 운영 모드는 데모 데이터를 넣지 않습니다(FF_SEED=none 또는 지우기)`);
  if (env.FF_EXT_SYNC_SEED && env.FF_EXT_SYNC_SEED !== '0') out.push('FF_EXT_SYNC_SEED — 운영 모드는 외부 연계 예시 항목을 넣지 않습니다');
  if (!env.FF_INSTANCE_ID?.trim()) out.push('FF_INSTANCE_ID가 없습니다 — 한 설치 = 한 고객, 설치(고객) 식별을 정하세요');
  for (const k of TEST_KNOBS) if (env[k]) out.push(`${k} — 시험·데모 전용 설정입니다. 운영 모드에서는 지우세요`);
  for (const k of WEBHOOK_ENV) if (env[k] && MOCK_WEBHOOK_SECRETS.includes(env[k]!)) out.push(`${k} — 공개된 모의 값입니다. 외부 시스템 webhook 설정과 같은 새 비밀값을 쓰세요`);
  for (const o of corsOrigins(env) as string[]) if (o === '*' || !/^https?:\/\/[^/\s]+$/.test(o)) out.push(`FF_CORS_ORIGINS의 '${o}' — 출처는 scheme://host[:port] 하나씩(* 금지)`);
  const unleash = env.UNLEASH_MODE ?? 'mock';
  if (unleash === 'mock') out.push('UNLEASH_MODE가 mock입니다 — 운영 모드는 live(실제 Unleash) 또는 off');
  if (unleash === 'live') {
    if (!env.UNLEASH_URL?.trim()) out.push('UNLEASH_MODE=live인데 UNLEASH_URL이 없습니다');
    if (!env.UNLEASH_ADMIN_TOKEN?.trim()) out.push('UNLEASH_MODE=live인데 UNLEASH_ADMIN_TOKEN이 없습니다');
  }
  // 감사 체인 고정점(RD-SEC-13) — 키는 DB 밖, 파일은 추가만 하는 저장소(WORM 볼륨)
  if ((env.FF_AUDIT_KEY ?? '').length < 32) out.push('FF_AUDIT_KEY가 없거나 32자보다 짧습니다 — 감사 체인 끝을 DB 밖에서 서명하는 키');
  if (!env.FF_AUDIT_ANCHOR_FILE?.trim()) out.push('FF_AUDIT_ANCHOR_FILE이 없습니다 — 감사 체인 고정점을 추가만 하는 파일(WORM 볼륨)에 남깁니다');
  if (env.SIM_MODE && env.SIM_MODE !== 'off') out.push(`SIM_MODE=${env.SIM_MODE} — 운영 모드에서 가상 검증 실행기는 꺼 둡니다(off)`);
  out.push(...authConfigProblems(env));
  return out;
}

/** 시작 때 한 번 — 운영 모드에서 문제가 있으면 멈춘다 */
export function assertRuntimeConfig(env: Env = process.env): void {
  const problems = runtimeConfigProblems(env);
  if (problems.length) throw new Error(`${isProduction(env) ? '운영 모드(FF_ENV=production)' : '인증(FF_AUTH=oidc)'} 설정 오류 — 백엔드를 시작하지 않습니다:\n  - ${problems.join('\n  - ')}`);
}

// OTA 서버 연동 설정(IF-05, FF_VEHICLE_CHANNEL=ota) — 시작 검사(runtime-config)·연결 상태(connections)·어댑터가 같은 규칙을 쓴다.
// 규격 docs/80-integration/80-45-ota-server-if05.md. 값(비밀)은 메시지에 넣지 않는다.
// FF_OTA_URL이 있으면 차량 전달 채널 기본값이 ota가 된다(vehicle-auth-config.ts vehicleChannelOf) — 설정이 있으면 실제 연결.
import { vehicleChannelOf } from './vehicle-auth-config';

type Env = Record<string, string | undefined>;

export interface OtaConfig {
  /** OTA 서버 API 기준 주소(경로 /ota/v1 앞까지) */
  url: string;
  /** OAuth2 토큰 끝점(client credentials) */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** webhook HMAC 비밀 — 첫째가 지금 것, 둘째가 교체 중인 이전 것 */
  webhookSecrets: string[];
  /** 요청 한 번의 제한 시간 */
  timeoutMs: number;
  /** 자동 재시도 횟수(첫 제출 제외) */
  retryMax: number;
  /** 재시도 간격의 시작값 — 두 배씩 늘린다(상한 5분) */
  retryBaseMs: number;
}

const trim = (v: string | undefined) => (v ?? '').trim();
const num = (v: string | undefined, d: number) => (trim(v) === '' ? d : Number(v));

/** 설정이 있는가 — OTA 연결의 live 여부를 정한다 */
export const otaConfigured = (env: Env = process.env) => trim(env.FF_OTA_URL) !== '' && vehicleChannelOf(env) === 'ota';

export function otaConfigOf(env: Env = process.env): OtaConfig | null {
  if (!otaConfigured(env)) return null;
  return {
    url: trim(env.FF_OTA_URL).replace(/\/+$/, ''),
    tokenUrl: trim(env.FF_OTA_TOKEN_URL),
    clientId: trim(env.FF_OTA_CLIENT_ID),
    clientSecret: trim(env.FF_OTA_CLIENT_SECRET),
    scope: trim(env.FF_OTA_SCOPE) || 'ota.jobs.write ota.jobs.read',
    webhookSecrets: [trim(env.FF_OTA_WEBHOOK_SECRET), trim(env.FF_OTA_WEBHOOK_SECRET_PREVIOUS)].filter(Boolean),
    timeoutMs: num(env.FF_OTA_TIMEOUT_MS, 10_000),
    retryMax: num(env.FF_OTA_RETRY_MAX, 8),
    retryBaseMs: num(env.FF_OTA_RETRY_BASE_MS, 2_000),
  };
}

const urlProblem = (name: string, v: string, production: boolean) => {
  if (!v) return `${name}가 없습니다`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return `${name} — http(s) 주소가 아닙니다`;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return `${name} — http(s) 주소가 아닙니다`;
  if (production && u.protocol !== 'https:') return `${name} — 운영 모드는 https만(토큰·서명 게시본이 오간다)`;
  if (u.username || u.password) return `${name} — 주소에 계정·비밀번호를 넣지 마세요(FF_OTA_CLIENT_ID·FF_OTA_CLIENT_SECRET)`;
  return null;
};

export function otaConfigProblems(env: Env): string[] {
  const out: string[] = [];
  const channel = vehicleChannelOf(env);
  const url = trim(env.FF_OTA_URL);
  const explicit = trim(env.FF_VEHICLE_CHANNEL);
  if (url && explicit && explicit !== 'ota') out.push(`FF_OTA_URL이 있는데 FF_VEHICLE_CHANNEL=${explicit} — OTA 서버로 전달하려면 ota로 두고, 아니면 FF_OTA_URL을 지우세요`);
  if (channel !== 'ota') return out;
  const production = env.FF_ENV === 'production';
  if (env.IF_MODE_05 === 'off') out.push('FF_VEHICLE_CHANNEL=ota인데 IF_MODE_05=off — OTA 서버 연동(IF-05)을 끄면 차량에 아무것도 가지 않습니다');
  for (const [name, v] of [
    ['FF_OTA_URL', url],
    ['FF_OTA_TOKEN_URL', trim(env.FF_OTA_TOKEN_URL)],
  ] as const) {
    const p = urlProblem(name, v, production);
    if (p) out.push(name === 'FF_OTA_URL' && !v ? 'FF_VEHICLE_CHANNEL=ota인데 FF_OTA_URL이 없습니다 — OTA 서버 API 주소' : p);
  }
  if (!trim(env.FF_OTA_CLIENT_ID)) out.push('FF_OTA_CLIENT_ID가 없습니다 — OTA 서버 토큰 끝점에 등록한 FF 클라이언트');
  if (trim(env.FF_OTA_CLIENT_SECRET).length < 16) out.push('FF_OTA_CLIENT_SECRET이 없거나 16자보다 짧습니다');
  if (trim(env.FF_OTA_WEBHOOK_SECRET).length < 32) out.push('FF_OTA_WEBHOOK_SECRET이 없거나 32자보다 짧습니다 — OTA 서버 webhook 서명(HMAC) 비밀');
  const prev = trim(env.FF_OTA_WEBHOOK_SECRET_PREVIOUS);
  if (prev && prev.length < 32) out.push('FF_OTA_WEBHOOK_SECRET_PREVIOUS — 32자 이상(교체 중인 이전 비밀만, 끝나면 지운다)');
  const range = (name: string, v: string | undefined, min: number, max: number) => {
    if (trim(v) === '') return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) out.push(`${name} — ${min}~${max} 사이 정수`);
  };
  range('FF_OTA_TIMEOUT_MS', env.FF_OTA_TIMEOUT_MS, 500, 120_000);
  range('FF_OTA_RETRY_MAX', env.FF_OTA_RETRY_MAX, 0, 100);
  range('FF_OTA_RETRY_BASE_MS', env.FF_OTA_RETRY_BASE_MS, 10, 600_000);
  return out;
}

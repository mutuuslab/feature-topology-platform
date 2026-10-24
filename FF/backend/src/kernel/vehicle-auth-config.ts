// 차량 채널 설정(출시 준비 RD-SEC-08·RD-OPS-04) — 시작 검사(runtime-config)와 서비스가 같은 규칙을 쓴다. 값은 메시지에 넣지 않는다.
type Env = Record<string, string | undefined>;
const production = (env: Env) => env.FF_ENV === 'production';

export type VehicleAuthMode = 'demo' | 'required';

/** 차량 요청 인증 방식 — 운영 모드는 required(고정), 그 밖에는 demo(머리글만도 받되 서명이 오면 확인) */
export const vehicleAuthModeOf = (env: Env = process.env): VehicleAuthMode =>
  env.FF_VEHICLE_AUTH === 'required' || env.FF_VEHICLE_AUTH === 'demo' ? env.FF_VEHICLE_AUTH : production(env) ? 'required' : 'demo';

/** 차량 전달 채널 — 운영 모드 기본은 실제 채널(pull), 그 밖에는 내부 시뮬레이터(sim). 고객 게이트웨이 어댑터는 등록한 이름 */
export const vehicleChannelOf = (env: Env = process.env): string => env.FF_VEHICLE_CHANNEL?.trim() || (production(env) ? 'pull' : 'sim');

export function vehicleChannelConfigProblems(env: Env): string[] {
  const out: string[] = [];
  const m = env.FF_VEHICLE_AUTH;
  if (m && m !== 'demo' && m !== 'required') out.push(`FF_VEHICLE_AUTH=${m} — demo 또는 required`);
  if (production(env) && m === 'demo') out.push('FF_VEHICLE_AUTH=demo — 운영 모드의 차량 요청은 CMAC 서명 또는 mTLS 인증서 주체가 필요합니다(required)');
  const h = env.FF_VEHICLE_CERT_HEADER;
  if (h !== undefined && !/^[a-z0-9-]{3,64}$/i.test(h)) out.push('FF_VEHICLE_CERT_HEADER — TLS 게이트웨이가 넣는 인증서 주체 머리글 이름(영문·숫자·- 3~64자)');
  const c = env.FF_VEHICLE_CHANNEL?.trim();
  if (c !== undefined && c !== '' && !/^[a-z][a-z0-9-]{1,31}$/.test(c)) out.push('FF_VEHICLE_CHANNEL — 채널 이름(sim · pull · 등록한 게이트웨이 어댑터 이름)');
  if (production(env) && vehicleChannelOf(env) === 'sim') out.push('FF_VEHICLE_CHANNEL=sim — 운영 모드에서는 내부 차량 시뮬레이터로 전달하지 않습니다(pull 또는 고객 게이트웨이 어댑터)');
  return out;
}

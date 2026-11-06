// Grafana Cloud OTLP 게이트웨이로 보내기(80-80) — 지표·로그·추적을 http/protobuf(gzip)로, Basic(Instance ID:토큰).
// 비밀은 GitHub 저장소 비밀로만 받는다: GRAFANA_OTLP_URL · GRAFANA_OTLP_INSTANCE_ID · GRAFANA_OTLP_TOKEN. 값은 출력하지 않는다.
import { gzipSync } from 'node:zlib';
import { decodePartialSuccess, encodeLogs, encodeMetrics, encodeTraces, type OtlpAttrs, type OtlpLogRecord, type OtlpMetric, type OtlpSpan } from '../../backend/src/kernel/otlp/otlp-proto.ts';

const SOFT_REJECT = /duplicate|out.of.order|too old|too far in the past|sample.timestamp/i;

export const OTLP_SECRETS = ['GRAFANA_OTLP_URL', 'GRAFANA_OTLP_INSTANCE_ID', 'GRAFANA_OTLP_TOKEN'] as const;

export interface OtlpTarget {
  base: string;
  auth: string;
}

/** 비밀 확인 — 빠진 이름을 모두 알린다(값은 보이지 않는다) */
export function otlpTarget(env: Record<string, string | undefined> = process.env): { target: OtlpTarget | null; missing: string[]; problems: string[] } {
  const missing = OTLP_SECRETS.filter((k) => !env[k]?.trim());
  const problems: string[] = [];
  if (missing.length) return { target: null, missing, problems };
  const base = env.GRAFANA_OTLP_URL!.trim().replace(/\/+$/, '').replace(/\/v1\/(metrics|logs|traces)$/, '');
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) problems.push('GRAFANA_OTLP_URL은 https 주소여야 한다(예: https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp)');
  } catch {
    problems.push('GRAFANA_OTLP_URL이 주소 형식이 아니다');
  }
  if (!/^\d+$/.test(env.GRAFANA_OTLP_INSTANCE_ID!.trim())) problems.push('GRAFANA_OTLP_INSTANCE_ID는 숫자(Grafana Cloud 스택 OpenTelemetry 화면의 Instance ID)여야 한다');
  const auth = 'Basic ' + Buffer.from(`${env.GRAFANA_OTLP_INSTANCE_ID!.trim()}:${env.GRAFANA_OTLP_TOKEN!.trim()}`).toString('base64');
  return { target: problems.length ? null : { base, auth }, missing, problems };
}

export interface SendResult {
  signal: 'metrics' | 'logs' | 'traces';
  requests: number;
  bytes: number;
  rejected: number;
  /** 표본 단위로 일부 거부된 요청 수(거부 수 모름) */
  soft: number;
  messages: string[];
}

async function post(target: OtlpTarget, path: string, body: Uint8Array, fetchImpl: typeof fetch): Promise<{ rejected: number; message: string }> {
  const gz = gzipSync(body);
  for (let attempt = 0; ; attempt++) {
    const r = await fetchImpl(target.base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-protobuf', 'Content-Encoding': 'gzip', Authorization: target.auth }, body: gz, signal: AbortSignal.timeout(30_000) });
    if (r.ok) return decodePartialSuccess(new Uint8Array(await r.arrayBuffer()));
    const text = (await r.text()).slice(0, 400);
    // 표본 단위 거부(같은 시각 다른 값·순서 어긋남·너무 오래됨) — Mimir는 나머지 표본은 넣고 400을 돌려준다(soft error).
    // 생성기를 바꾼 직후 겹친 창에서 생긴다 — 실패가 아니라 거부로 센다(수를 모르면 -1)
    if (r.status === 400 && SOFT_REJECT.test(text)) return { rejected: -1, message: text };
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`OTLP ${path} → HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' (Instance ID·토큰·쓰기 권한 확인)' : ''}: ${text}`);
  }
}

/** 지표를 요청 하나에 점 maxPoints개 안으로 나눠 보낸다 */
export async function sendMetrics(target: OtlpTarget, resource: OtlpAttrs, metrics: OtlpMetric[], fetchImpl: typeof fetch = fetch, maxPoints = 4000): Promise<SendResult> {
  const out: SendResult = { signal: 'metrics', requests: 0, bytes: 0, rejected: 0, soft: 0, messages: [] };
  let batch: OtlpMetric[] = [];
  let n = 0;
  const flush = async () => {
    if (!batch.length) return;
    const body = encodeMetrics(resource, { name: 'ff-grafana-demo', version: '1' }, batch);
    const r = await post(target, '/v1/metrics', body, fetchImpl);
    out.requests++;
    out.bytes += body.length;
    out.rejected += Math.max(0, r.rejected);
    if (r.rejected < 0) out.soft++;
    if (r.message) out.messages.push(r.message);
    batch = [];
    n = 0;
  };
  for (const m of metrics) {
    // 한 지표의 점이 너무 많으면 잘라 여러 요청으로
    for (let i = 0; i < m.points.length; i += maxPoints) {
      const part = { ...m, points: m.points.slice(i, i + maxPoints) } as OtlpMetric;
      if (n + part.points.length > maxPoints) await flush();
      batch.push(part);
      n += part.points.length;
    }
  }
  await flush();
  return out;
}

export async function sendLogs(target: OtlpTarget, resource: OtlpAttrs, logs: OtlpLogRecord[], fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const out: SendResult = { signal: 'logs', requests: 0, bytes: 0, rejected: 0, soft: 0, messages: [] };
  for (let i = 0; i < logs.length; i += 1000) {
    const body = encodeLogs(resource, { name: 'ff-grafana-demo', version: '1' }, logs.slice(i, i + 1000));
    const r = await post(target, '/v1/logs', body, fetchImpl);
    out.requests++;
    out.bytes += body.length;
    out.rejected += Math.max(0, r.rejected);
    if (r.rejected < 0) out.soft++;
    if (r.message) out.messages.push(r.message);
  }
  return out;
}

export async function sendTraces(target: OtlpTarget, resource: OtlpAttrs, spans: OtlpSpan[], fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const out: SendResult = { signal: 'traces', requests: 0, bytes: 0, rejected: 0, soft: 0, messages: [] };
  for (let i = 0; i < spans.length; i += 1000) {
    const body = encodeTraces(resource, { name: 'ff-grafana-demo', version: '1' }, spans.slice(i, i + 1000));
    const r = await post(target, '/v1/traces', body, fetchImpl);
    out.requests++;
    out.bytes += body.length;
    out.rejected += Math.max(0, r.rejected);
    if (r.rejected < 0) out.soft++;
    if (r.message) out.messages.push(r.message);
  }
  return out;
}

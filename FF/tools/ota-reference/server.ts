// 시험용 OTA 서버(참조 구현) — FF ↔ OTA 서버 연동 규격 IF-05 v1(docs/80-integration/80-45-ota-server-if05.md)을 그대로 따른다.
//   npm run ota:reference -- [--port 9590] [--scenario all-applied] [--webhook-url http://127.0.0.1:9001/api/ota/v1/events] [--lake-url http://127.0.0.1:9001]
// 의존성 없음(node:http·node:crypto만) — 고객 OTA 서버를 만드는 쪽이 이 파일을 읽고 동작을 그대로 확인할 수 있게 FF 코드를 가져오지 않는다.
// 진짜 차량은 없다: 시나리오(모두 적용·일부 응답 없음·서명 실패·거부·무응답·제출 실패)대로 차량을 흉내 내고, FF webhook에는
// OTA 서버 자신의 사실(DELIVERING·DELIVERED·NO_RESPONSE·CANCELLED·NOT_ELIGIBLE)만 보낸다 — 차량 회신은 실제로 차량 → Data Lake → FF(80-45 §7.5).
// --lake-url을 주면 그 경로도 흉내 낸다: 차량이 알린 결과를 FF IF-06 입구(POST /api/telemetry/readback, 데모 인증 SYSTEM)로 넣는다.
//   · 차량 서명(게시본 검증)은 흉내만 낸다 — SIGNATURE_FAILED는 시나리오가 정한다(실제 OTA 서버도 서명을 검증하지 않는다: 차량 몫)
//   · 차단·복원 v2 봉투의 끝 상태(차량 키로 서명한 status_report v2)는 만들 수 없다 — v2 차단 시험은 차량 시뮬레이터·실차로
// /_sim/* 는 규격 밖의 시험 손잡이(시나리오·webhook 주소 바꾸기, 상태 보기) — 머리글 x-sim-admin: <클라이언트 비밀>.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

export const SPEC_VERSION = '1.0';
/** webhook 전달 결과 — OTA 서버 자신의 사실만(80-45 §7.1). 차량이 만든 결과(적용·거부)는 싣지 않는다 */
export const OUTCOMES = ['DELIVERING', 'DELIVERED', 'NO_RESPONSE', 'CANCELLED', 'NOT_ELIGIBLE'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** 흉내 낸 차량의 행동 — 적용·거부·서명 실패는 차량 회신(Lake 경로)으로만 드러나고, webhook에는 DELIVERED로 보인다 */
export type VehicleBehavior = 'APPLIED' | 'REFUSED' | 'SIGNATURE_FAILED' | 'NO_RESPONSE';
const MAX_BODY = 16 * 1024 * 1024;
const MAX_TARGETS = 10_000;

export interface Scenario {
  /** 대상 차량 기본 행동 */
  default: VehicleBehavior;
  /** VIN별 행동 */
  overrides?: Record<string, VehicleBehavior>;
  /** 작업마다 마지막 n대는 응답 없음(NO_RESPONSE — 기한에 알린다) */
  lastNoResponse?: number;
  /** 작업마다 첫 차량의 결과 */
  first?: VehicleBehavior;
  /** true면 webhook을 보내지 않는다(FF가 기한에 TIMEOUT으로 닫는다) */
  silent?: boolean;
  /** 처음 n번 제출은 503(재시도 시험) */
  failSubmissions?: number;
  /** 등록되지 않은 차량 — 접수 때 rejectedTargets(UNKNOWN_VEHICLE) */
  unknownVins?: string[];
}

export const SCENARIOS: Record<string, Scenario> = {
  'all-applied': { default: 'APPLIED' },
  'some-no-response': { default: 'APPLIED', lastNoResponse: 1 },
  'signature-failure': { default: 'APPLIED', first: 'SIGNATURE_FAILED' },
  refused: { default: 'APPLIED', first: 'REFUSED' },
  silent: { default: 'APPLIED', silent: true },
  flaky: { default: 'APPLIED', failSubmissions: 2 },
};

/** 일부러 규격을 어기는 동작 — 적합성 검사가 실제로 잡는지 보는 시험용 */
export type Fault = 'no-idempotency' | 'bad-webhook-signature' | 'no-webhook-retry' | 'vehicle-results-in-webhook';

export interface RefOptions {
  port?: number;
  host?: string;
  clientId?: string;
  clientSecret?: string;
  webhookUrl?: string | null;
  webhookSecret?: string;
  /** 차량 → Data Lake → FF 흉내: FF 기준 주소(예 http://127.0.0.1:9001). 없으면 차량 회신을 보내지 않는다 */
  lakeUrl?: string | null;
  scenario?: Scenario | string;
  /** 접수 → 차량 결과까지(ms) */
  delayMs?: number;
  tokenTtlSec?: number;
  /** webhook 재시도 간격 시작값(ms) — 두 배씩, 최대 retries번 */
  webhookRetryMs?: number;
  webhookRetries?: number;
  faults?: Fault[];
  log?: (event: Record<string, unknown>) => void;
}

interface VehicleState {
  vin: string;
  outcome: Outcome | 'PENDING';
  at: string | null;
}
interface Job {
  jobId: string;
  otaJobId: string;
  state: 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  request: Record<string, any>;
  bodyHash: string;
  response: Record<string, unknown>;
  vehicles: Map<string, VehicleState>;
  timers: NodeJS.Timeout[];
  createdAt: string;
  updatedAt: string;
}
export interface SentEvent {
  eventId: string;
  type: string;
  jobId: string;
  attempts: number;
  status: number | null;
  body: Record<string, unknown>;
}

const DEFAULT_CLIENT_ID = 'ff-platform';
const DEFAULT_CLIENT_SECRET = 'ota-reference-client-secret';
const DEFAULT_WEBHOOK_SECRET = 'ota-reference-webhook-secret-change-me-0000';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const webhookSignature = (secret: string, timestamp: string, raw: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
const majorOk = (v: string | undefined) => !!v && /^\d+\.\d+$/.test(v) && v.split('.')[0] === SPEC_VERSION.split('.')[0];

export interface RefServer {
  url: string;
  tokenUrl: string;
  server: Server;
  jobs: Map<string, Job>;
  sent: SentEvent[];
  configure(o: Partial<Pick<RefOptions, 'webhookUrl' | 'webhookSecret' | 'lakeUrl' | 'scenario' | 'delayMs' | 'faults'>>): void;
  close(): Promise<void>;
}

export async function startOtaReference(opts: RefOptions = {}): Promise<RefServer> {
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? DEFAULT_CLIENT_SECRET;
  const cfg = {
    webhookUrl: opts.webhookUrl ?? null,
    webhookSecret: opts.webhookSecret ?? DEFAULT_WEBHOOK_SECRET,
    lakeUrl: opts.lakeUrl ?? null,
    scenario: resolveScenario(opts.scenario ?? 'all-applied'),
    delayMs: opts.delayMs ?? 300,
    faults: new Set<Fault>(opts.faults ?? []),
  };
  const ttl = opts.tokenTtlSec ?? 3600;
  const retryMs = opts.webhookRetryMs ?? 500;
  const retries = opts.webhookRetries ?? 6;
  const log = opts.log ?? (() => {});
  const tokens = new Map<string, { until: number; scope: string }>();
  const jobs = new Map<string, Job>();
  const sent: SentEvent[] = [];
  let failuresLeft = cfg.scenario.failSubmissions ?? 0;
  const pending = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      pending.delete(t);
      fn();
    }, ms);
    pending.add(t);
    return t;
  };

  const configure: RefServer['configure'] = (o) => {
    if (o.webhookUrl !== undefined) cfg.webhookUrl = o.webhookUrl;
    if (o.webhookSecret) cfg.webhookSecret = o.webhookSecret;
    if (o.lakeUrl !== undefined) cfg.lakeUrl = o.lakeUrl;
    if (o.scenario) {
      cfg.scenario = resolveScenario(o.scenario);
      failuresLeft = cfg.scenario.failSubmissions ?? 0;
    }
    if (o.delayMs !== undefined) cfg.delayMs = o.delayMs;
    if (o.faults) cfg.faults = new Set(o.faults);
  };

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'ota-spec-version': SPEC_VERSION, ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string, message: string, retryable = false, headers: Record<string, string> = {}, details?: unknown) =>
    send(res, status, { error: { code, message, retryable, ...(details === undefined ? {} : { details }) } }, headers);

  const readBody = (req: IncomingMessage) =>
    new Promise<string | null>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          resolve(null);
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const bearer = (req: IncomingMessage, scope: string) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const t = m ? tokens.get(m[1]) : undefined;
    if (!t || t.until < Date.now()) return 'UNAUTHENTICATED';
    if (!t.scope.split(' ').includes(scope)) return 'FORBIDDEN';
    return null;
  };

  // ── webhook 보내기(규격 7장) — 2xx면 끝, 5xx·408·429·네트워크 실패는 같은 본문·같은 eventId로 다시, 그 밖의 4xx는 그만 ──
  const emit = (job: Job, type: string, extra: Record<string, unknown>) => {
    if (!cfg.webhookUrl || cfg.scenario.silent) return;
    const body = { specVersion: SPEC_VERSION, eventId: randomUUID(), type, jobId: job.jobId, otaJobId: job.otaJobId, occurredAt: new Date().toISOString(), ...extra };
    const raw = JSON.stringify(body);
    const rec: SentEvent = { eventId: body.eventId, type, jobId: job.jobId, attempts: 0, status: null, body };
    sent.push(rec);
    const url = cfg.webhookUrl;
    const attempt = async () => {
      rec.attempts++;
      const ts = String(Math.floor(Date.now() / 1000));
      const secret = cfg.faults.has('bad-webhook-signature') ? `${cfg.webhookSecret}-wrong` : cfg.webhookSecret;
      let status: number | null = null;
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'ota-spec-version': SPEC_VERSION, 'x-ota-event-id': body.eventId, 'x-ota-timestamp': ts, 'x-ota-signature': webhookSignature(secret, ts, raw) }, body: raw, signal: AbortSignal.timeout(10_000) });
        status = r.status;
        await r.arrayBuffer().catch(() => undefined);
      } catch {
        status = null;
      }
      rec.status = status;
      log({ event: 'webhook', eventId: body.eventId, type, jobId: job.jobId, attempt: rec.attempts, status });
      const retry = status === null || status >= 500 || status === 408 || status === 429;
      if (retry && !cfg.faults.has('no-webhook-retry') && rec.attempts <= retries) later(retryMs * 2 ** (rec.attempts - 1), () => void attempt());
    };
    void attempt();
  };

  const finishIfDone = (job: Job) => {
    if (job.state !== 'IN_PROGRESS' && job.state !== 'ACCEPTED') return;
    if ([...job.vehicles.values()].every((v) => v.outcome !== 'PENDING' && v.outcome !== 'DELIVERING')) {
      job.state = 'COMPLETED';
      job.updatedAt = new Date().toISOString();
      emit(job, 'job.state', { state: 'COMPLETED' });
    }
  };

  /** 전달 결과(webhook results[]) — OTA 서버 자신의 사실만. 차량의 적용·거부·되읽은 값은 싣지 않는다(차량 회신은 Lake 경로) */
  const vehicleResult = (_job: Job, vin: string, outcome: Outcome, extra: { attempts?: number; code?: string; detail?: string } = {}) => ({
    vin,
    // 시험용 규격 위반 — 차량이 만든 결과(APPLIED)를 webhook에 싣는다(적합성 검사 C16이 잡아야 한다)
    outcome: cfg.faults.has('vehicle-results-in-webhook') && outcome === 'DELIVERED' ? 'APPLIED' : outcome,
    at: new Date().toISOString(),
    ...extra,
  });

  /** 차량 → Data Lake → FF 흉내 — 차량이 알린 결과를 FF IF-06 회신 입구로(데모 인증 SYSTEM). 실제 OTA 서버의 일이 아니다 */
  const lake = (job: Job, results: [string, VehicleBehavior][]) => {
    if (!cfg.lakeUrl) return;
    const pub = job.request.publication ?? {};
    for (const [vin, o] of results) {
      if (o !== 'APPLIED' && o !== 'REFUSED' && o !== 'SIGNATURE_FAILED') continue;
      const body = {
        vin,
        publicationId: job.request.publicationId,
        metricType: 'READBACK',
        policyHash: pub.signature?.payloadHash,
        featureVersion: String(pub.payload?.featureVersion ?? ''),
        bootId: `BOOT-${vin}-1`,
        sequence: Number(pub.payload?.sequence ?? 0),
        observed: o === 'APPLIED' ? String(pub.payload?.desired ?? '') : 'REJECTED',
        ...(o === 'APPLIED' ? {} : { rejectReason: o === 'SIGNATURE_FAILED' ? 'SIGNATURE_INVALID' : 'REPLAY' }),
      };
      void fetch(`${cfg.lakeUrl}/api/telemetry/readback`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': 'data-lake-sim', 'x-actor-role': 'SYSTEM' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
        .then((r) => log({ event: 'lake.readback', jobId: job.jobId, vin, status: r.status }))
        .catch(() => log({ event: 'lake.readback', jobId: job.jobId, vin, status: null }));
    }
  };

  /** 시나리오대로 차량 결과를 짓는다 — 응답 없음은 기한에, 나머지는 delayMs 뒤 한 묶음으로 */
  const run = (job: Job) => {
    const sc = cfg.scenario;
    const vins = [...job.vehicles.keys()].filter((v) => job.vehicles.get(v)!.outcome === 'PENDING');
    const plan = new Map<string, VehicleBehavior>();
    vins.forEach((vin, i) => {
      let o: VehicleBehavior = sc.overrides?.[vin] ?? sc.default;
      if (i === 0 && sc.first && !sc.overrides?.[vin]) o = sc.first;
      if (sc.lastNoResponse && i >= vins.length - sc.lastNoResponse && vins.length > 1 && !sc.overrides?.[vin]) o = 'NO_RESPONSE';
      plan.set(vin, o);
    });
    job.timers.push(
      later(cfg.delayMs, () => {
        if (job.state !== 'ACCEPTED') return;
        job.state = 'IN_PROGRESS';
        // 닿은 차량은 DELIVERED(OTA 사실), 닿지 않은 차량은 DELIVERING(재시도 중) — 차량의 적용·거부는 Lake 흉내로만
        const now = [...plan].filter(([, o]) => o !== 'NO_RESPONSE');
        const waiting = [...plan].filter(([, o]) => o === 'NO_RESPONSE').map(([v]) => v);
        const at = new Date().toISOString();
        for (const [vin] of now) job.vehicles.set(vin, { vin, outcome: 'DELIVERED', at });
        for (const vin of waiting) job.vehicles.set(vin, { vin, outcome: 'DELIVERING', at });
        const results = [...now.map(([vin]) => vehicleResult(job, vin, 'DELIVERED', { attempts: 1 })), ...waiting.map((vin) => vehicleResult(job, vin, 'DELIVERING', { attempts: 1, code: 'NOT_CONNECTED' }))];
        if (results.length) emit(job, 'vehicle.results', { results });
        lake(job, now);
        finishIfDone(job);
      }),
    );
    const silentVins = [...plan].filter(([, o]) => o === 'NO_RESPONSE').map(([v]) => v);
    if (silentVins.length) {
      const due = Math.max(cfg.delayMs, new Date(job.request.deadlineAt).getTime() - Date.now() - 200);
      job.timers.push(
        later(due, () => {
          if (job.state !== 'IN_PROGRESS' && job.state !== 'ACCEPTED') return;
          for (const vin of silentVins) job.vehicles.set(vin, { vin, outcome: 'NO_RESPONSE', at: new Date().toISOString() });
          emit(job, 'vehicle.results', { results: silentVins.map((vin) => vehicleResult(job, vin, 'NO_RESPONSE', { code: 'NOT_CONNECTED', detail: '기한까지 차량에 닿지 못했습니다(시험 서버)' })) });
          finishIfDone(job);
        }),
      );
    }
  };

  const validateJob = (b: any): string | null => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return '본문은 JSON 객체';
    if (typeof b.jobId !== 'string' || !b.jobId || b.jobId.length > 100) return 'jobId(문자열 1~100자)';
    if (typeof b.publicationId !== 'string' || !b.publicationId) return 'publicationId';
    if (!['POLICY', 'KILL', 'RESTORE'].includes(b.kind)) return 'kind(POLICY·KILL·RESTORE)';
    if (!['NORMAL', 'EMERGENCY'].includes(b.priority)) return 'priority(NORMAL·EMERGENCY)';
    if (!Array.isArray(b.targets) || !b.targets.length || b.targets.length > MAX_TARGETS || b.targets.some((v: unknown) => typeof v !== 'string' || !v || v.length > 64)) return `targets(VIN 1~${MAX_TARGETS}개)`;
    if (new Set(b.targets).size !== b.targets.length) return 'targets에 같은 VIN이 두 번';
    if (typeof b.deadlineAt !== 'string' || !Number.isFinite(Date.parse(b.deadlineAt))) return 'deadlineAt(ISO 8601)';
    const p = b.publication;
    if (!p || typeof p !== 'object' || p.publicationId !== b.publicationId || typeof p.payload !== 'object' || !p.signature || !/^sha256:[0-9a-f]{64}$/.test(p.signature.payloadHash ?? '')) return 'publication(publicationId·payload·signature.payloadHash — 바꾸지 않고 그대로)';
    if (b.envelopes !== undefined && (typeof b.envelopes !== 'object' || Array.isArray(b.envelopes) || Object.keys(b.envelopes).some((v) => !b.targets.includes(v)))) return 'envelopes(대상 VIN → 봉투)';
    return null;
  };

  const jobView = (job: Job) => {
    const counts: Record<string, number> = { total: job.vehicles.size, pending: 0 };
    for (const v of job.vehicles.values()) counts[v.outcome === 'PENDING' ? 'pending' : v.outcome] = (counts[v.outcome === 'PENDING' ? 'pending' : v.outcome] ?? 0) + 1;
    return { jobId: job.jobId, otaJobId: job.otaJobId, publicationId: job.request.publicationId, payloadHash: job.request.publication.signature.payloadHash, state: job.state, deadlineAt: job.request.deadlineAt, createdAt: job.createdAt, updatedAt: job.updatedAt, counts, vehicles: [...job.vehicles.values()] };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const path = u.pathname;
    const method = req.method ?? 'GET';
    log({ event: 'request', method, path });

    // ── OAuth2 토큰 끝점(client credentials) ──
    if (method === 'POST' && path === '/oauth/token') {
      const raw = (await readBody(req)) ?? '';
      const form = new URLSearchParams(raw);
      let id = form.get('client_id') ?? '';
      let secret = form.get('client_secret') ?? '';
      const basic = /^Basic (\S+)$/.exec(req.headers.authorization ?? '');
      if (basic) {
        const [a, b] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
        id = decodeURIComponent(a ?? '');
        secret = decodeURIComponent(b ?? '');
      }
      if (form.get('grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' });
      if (!same(id, clientId) || !same(secret, clientSecret)) return send(res, 401, { error: 'invalid_client' }, { 'www-authenticate': 'Basic realm="ota"' });
      const allowed = ['ota.jobs.write', 'ota.jobs.read'];
      const asked = (form.get('scope') ?? allowed.join(' ')).split(' ').filter(Boolean);
      if (asked.some((s) => !allowed.includes(s))) return send(res, 400, { error: 'invalid_scope' });
      const token = randomBytes(24).toString('base64url');
      tokens.set(token, { until: Date.now() + ttl * 1000, scope: asked.join(' ') });
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: ttl, scope: asked.join(' ') });
    }

    // ── 상태 점검(인증 없음) ──
    if (method === 'GET' && path === '/ota/v1/health') return send(res, 200, { status: 'ok', specVersions: [SPEC_VERSION], server: 'ff-ota-reference', time: new Date().toISOString() });

    // ── 시험 손잡이(규격 밖) ──
    if (path.startsWith('/_sim/')) {
      if (!same(String(req.headers['x-sim-admin'] ?? ''), clientSecret)) return fail(res, 401, 'UNAUTHENTICATED', 'x-sim-admin 필요');
      if (method === 'POST' && path === '/_sim/config') {
        const b = JSON.parse((await readBody(req)) || '{}');
        configure(b);
        return send(res, 200, { ok: true, webhookUrl: cfg.webhookUrl, lakeUrl: cfg.lakeUrl, scenario: cfg.scenario, delayMs: cfg.delayMs });
      }
      if (method === 'GET' && path === '/_sim/state') return send(res, 200, { jobs: [...jobs.values()].map(jobView), sent });
      return fail(res, 404, 'JOB_NOT_FOUND', '없는 시험 손잡이');
    }

    if (!path.startsWith('/ota/v1/')) return fail(res, 404, 'JOB_NOT_FOUND', `없는 경로 ${path}`);
    const write = method === 'POST';
    const auth = bearer(req, write ? 'ota.jobs.write' : 'ota.jobs.read');
    if (auth === 'UNAUTHENTICATED') return fail(res, 401, 'UNAUTHENTICATED', '접근 토큰이 없거나 만료되었습니다', true, { 'www-authenticate': 'Bearer' });
    if (auth === 'FORBIDDEN') return fail(res, 403, 'FORBIDDEN', '토큰 범위가 모자랍니다');
    const ver = req.headers['ota-spec-version'];
    const version = Array.isArray(ver) ? ver[0] : ver;
    if (!version) return fail(res, 400, 'VALIDATION', 'OTA-Spec-Version 머리글이 필요합니다');
    if (!majorOk(version)) return fail(res, 400, 'UNSUPPORTED_SPEC_VERSION', `규격 판 ${version}은(는) 받지 않습니다`, false, {}, { supported: [SPEC_VERSION] });

    // ── 작업 제출 ──
    if (method === 'POST' && path === '/ota/v1/jobs') {
      const raw = await readBody(req);
      if (raw === null) return fail(res, 413, 'PAYLOAD_TOO_LARGE', `본문이 ${MAX_BODY}바이트보다 큽니다`);
      let b: any;
      try {
        b = JSON.parse(raw);
      } catch {
        return fail(res, 400, 'VALIDATION', 'JSON이 아닙니다');
      }
      const key = String(req.headers['idempotency-key'] ?? '');
      if (!key) return fail(res, 400, 'VALIDATION', 'Idempotency-Key 머리글이 필요합니다');
      const bad = validateJob(b);
      if (bad) return fail(res, 400, 'VALIDATION', `본문이 규격과 맞지 않습니다 — ${bad}`);
      if (key !== b.jobId) return fail(res, 400, 'VALIDATION', 'Idempotency-Key는 jobId와 같아야 합니다');
      const hash = sha(JSON.stringify(b));
      const prev = jobs.get(b.jobId);
      if (prev && !cfg.faults.has('no-idempotency')) {
        if (prev.bodyHash !== hash) return fail(res, 409, 'IDEMPOTENCY_CONFLICT', `작업 ${b.jobId}은(는) 이미 다른 내용으로 받았습니다`);
        return send(res, 202, prev.response, { 'idempotent-replayed': 'true' });
      }
      if (Date.parse(b.deadlineAt) <= Date.now()) return fail(res, 422, 'DEADLINE_PASSED', '회신 기한이 이미 지났습니다');
      if (failuresLeft > 0) {
        failuresLeft--;
        return fail(res, 503, 'UNAVAILABLE', '잠시 처리할 수 없습니다(시험 서버 — 제출 실패 시나리오)', true, { 'retry-after': '0' });
      }
      const unknown = new Set(cfg.scenario.unknownVins ?? []);
      const now = new Date().toISOString();
      const job: Job = { jobId: b.jobId, otaJobId: `ota-${randomBytes(6).toString('hex')}`, state: 'ACCEPTED', request: b, bodyHash: hash, response: {}, vehicles: new Map(), timers: [], createdAt: now, updatedAt: now };
      const rejectedTargets: { vin: string; code: string; message: string }[] = [];
      for (const vin of b.targets as string[]) {
        if (unknown.has(vin)) {
          rejectedTargets.push({ vin, code: 'UNKNOWN_VEHICLE', message: '이 OTA 서버에 등록되지 않은 차량' });
          job.vehicles.set(vin, { vin, outcome: 'NOT_ELIGIBLE', at: now });
        } else job.vehicles.set(vin, { vin, outcome: 'PENDING', at: null });
      }
      job.response = { jobId: job.jobId, otaJobId: job.otaJobId, state: job.state, acceptedTargets: b.targets.length - rejectedTargets.length, rejectedTargets, acceptedAt: now };
      jobs.set(job.jobId, job);
      log({ event: 'job.accepted', jobId: job.jobId, targets: b.targets.length, rejected: rejectedTargets.length });
      // 기한 — 그때까지 끝나지 않은 차량은 NO_RESPONSE, 작업은 EXPIRED
      job.timers.push(
        later(Math.max(0, Date.parse(b.deadlineAt) - Date.now()), () => {
          if (job.state !== 'ACCEPTED' && job.state !== 'IN_PROGRESS') return;
          const left = [...job.vehicles.values()].filter((v) => v.outcome === 'PENDING' || v.outcome === 'DELIVERING');
          for (const v of left) job.vehicles.set(v.vin, { vin: v.vin, outcome: 'NO_RESPONSE', at: new Date().toISOString() });
          if (left.length) emit(job, 'vehicle.results', { results: left.map((v) => vehicleResult(job, v.vin, 'NO_RESPONSE', { code: 'DEADLINE' })) });
          job.state = left.length ? 'EXPIRED' : 'COMPLETED';
          emit(job, 'job.state', { state: job.state });
        }),
      );
      run(job);
      return send(res, 202, job.response);
    }

    const m = /^\/ota\/v1\/jobs\/([^/]+)(\/cancel)?$/.exec(path);
    if (!m) return fail(res, 404, 'JOB_NOT_FOUND', `없는 경로 ${path}`);
    const job = jobs.get(decodeURIComponent(m[1]));
    if (!job) return fail(res, 404, 'JOB_NOT_FOUND', `작업 ${decodeURIComponent(m[1])}이(가) 없습니다`);
    if (method === 'GET' && !m[2]) return send(res, 200, jobView(job));
    if (method === 'POST' && m[2]) {
      await readBody(req);
      if (job.state === 'CANCELLED') return send(res, 202, { jobId: job.jobId, state: job.state, cancelledTargets: 0 });
      if (job.state !== 'ACCEPTED' && job.state !== 'IN_PROGRESS') return fail(res, 409, 'JOB_FINAL', `작업이 이미 ${job.state}입니다`);
      const left = [...job.vehicles.values()].filter((v) => v.outcome === 'PENDING' || v.outcome === 'DELIVERING');
      for (const t of job.timers) clearTimeout(t);
      const now = new Date().toISOString();
      for (const v of left) job.vehicles.set(v.vin, { vin: v.vin, outcome: 'CANCELLED', at: now });
      job.state = 'CANCELLED';
      job.updatedAt = now;
      if (left.length) emit(job, 'vehicle.results', { results: left.map((v) => vehicleResult(job, v.vin, 'CANCELLED')) });
      emit(job, 'job.state', { state: 'CANCELLED' });
      return send(res, 202, { jobId: job.jobId, state: job.state, cancelledTargets: left.length });
    }
    return fail(res, 404, 'JOB_NOT_FOUND', `없는 경로 ${method} ${path}`);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log({ event: 'error', message: (e as Error)?.message });
      if (!res.headersSent) fail(res, 500, 'INTERNAL', '시험 서버 내부 오류', true);
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://${opts.host ?? '127.0.0.1'}:${addr.port}`;
  const api: RefServer = {
    url,
    tokenUrl: `${url}/oauth/token`,
    server,
    jobs,
    sent,
    configure,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of pending) clearTimeout(t);
        for (const j of jobs.values()) for (const t of j.timers) clearTimeout(t);
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
  return api;
}

function resolveScenario(s: Scenario | string): Scenario {
  if (typeof s !== 'string') return s;
  const v = SCENARIOS[s];
  if (!v) throw new Error(`알 수 없는 시나리오 ${s} — ${Object.keys(SCENARIOS).join(' · ')}`);
  return v;
}

// ── 명령줄 ──
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(arg('port') ?? process.env.OTA_REF_PORT ?? 9590);
  const clientId = process.env.OTA_REF_CLIENT_ID ?? DEFAULT_CLIENT_ID;
  const clientSecret = process.env.OTA_REF_CLIENT_SECRET ?? DEFAULT_CLIENT_SECRET;
  const webhookSecret = process.env.OTA_REF_WEBHOOK_SECRET ?? DEFAULT_WEBHOOK_SECRET;
  const webhookUrl = arg('webhook-url') ?? process.env.OTA_REF_WEBHOOK_URL ?? 'http://127.0.0.1:9001/api/ota/v1/events';
  const ref = await startOtaReference({
    port,
    clientId,
    clientSecret,
    webhookSecret,
    webhookUrl,
    scenario: arg('scenario') ?? process.env.OTA_REF_SCENARIO ?? 'all-applied',
    delayMs: Number(arg('delay-ms') ?? process.env.OTA_REF_DELAY_MS ?? 500),
    lakeUrl: arg('lake-url') ?? process.env.OTA_REF_LAKE_URL ?? null,
    log: (e) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })),
  });
  console.log(JSON.stringify({ event: 'listening', url: ref.url, specVersion: SPEC_VERSION, webhookUrl, scenarios: Object.keys(SCENARIOS) }));
  // FF에 넣을 설정(비밀은 시험 기본값일 때만 그대로 보인다)
  const shown = (v: string, d: string) => (v === d ? v : '<OTA_REF_* 에 준 값>');
  console.log(
    [
      '# FF 백엔드 설정(시험용):',
      `FF_VEHICLE_CHANNEL=ota`,
      `FF_OTA_URL=${ref.url}`,
      `FF_OTA_TOKEN_URL=${ref.tokenUrl}`,
      `FF_OTA_CLIENT_ID=${clientId}`,
      `FF_OTA_CLIENT_SECRET=${shown(clientSecret, DEFAULT_CLIENT_SECRET)}`,
      `FF_OTA_WEBHOOK_SECRET=${shown(webhookSecret, DEFAULT_WEBHOOK_SECRET)}`,
    ].join('\n'),
  );
  const stop = () => void ref.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

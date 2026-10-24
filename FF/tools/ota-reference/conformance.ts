// OTA 서버 적합성 검사(IF-05 v1) — 고객 OTA 서버가 규격 docs/80-integration/80-45-ota-server-if05.md를 지키는지 주소에 대고 확인한다.
//   npm run ota:conformance -- --url https://ota.example.com --token-url https://ota.example.com/oauth/token \
//     --client-id ff-platform --webhook-port 9599 [--vins VIN1,VIN2] [--deadline-sec 20]
//   비밀은 환경 변수로: OTA_CLIENT_SECRET · OTA_WEBHOOK_SECRET (명령줄에 쓰지 않는다)
// OTA 서버의 webhook 주소를 이 검사기의 수신 주소(http://<이 호스트>:<webhook-port>/ota-conformance/events)로, 비밀을 OTA_WEBHOOK_SECRET로 맞춰 둔다.
// 의존성 없음 — 시험 OTA 서버(server.ts)와 마찬가지로 FF 코드를 가져오지 않는다(규격 문서만 보고 만든 두 번째 구현).
// 검사 대상에 실제 작업 2건(검사용 jobId, 기한 짧음)을 만든다 — 시험 차량(--vins)만 쓰는 시험 환경에서 돌린다.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

export const SPEC_VERSION = '1.0';
/** OTA 서버 자신의 사실만(80-45 §7.1) — 차량이 만든 APPLIED·거부를 보내면 C16이 실패한다 */
const OUTCOMES = ['DELIVERING', 'DELIVERED', 'NO_RESPONSE', 'CANCELLED', 'NOT_ELIGIBLE'];
const FINAL = OUTCOMES.filter((o) => o !== 'DELIVERING');
const JOB_STATES = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'];
const TOLERANCE_SEC = 300;

export interface ConformanceOptions {
  url: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  /** 수신기 포트(0 = OS가 고름) */
  webhookPort?: number;
  webhookHost?: string;
  /** 시험 차량 VIN — 검사 대상 OTA 서버에 등록된 차량 */
  vins?: string[];
  /** 검사 작업의 회신 기한(초) */
  deadlineSec?: number;
  /** 기한 뒤 결과를 더 기다리는 시간(ms) */
  graceMs?: number;
  timeoutMs?: number;
  /** 수신기가 열린 뒤 — 시험 OTA 서버는 여기서 webhook 주소를 맞춘다 */
  onReceiver?: (url: string) => void | Promise<void>;
  log?: (line: string) => void;
}

export interface Check {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
}

interface Received {
  at: number;
  headers: IncomingMessage['headers'];
  raw: string;
  body: any;
  status: number;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const sign = (secret: string, ts: string, raw: string) => `sha256=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex64 = (c: string) => c.repeat(64);

/** 검사용 게시본 — 서명은 형식만 맞다(OTA 서버는 서명을 검증하지 않는다: 차량 몫, 규격 2장) */
function sampleJob(jobId: string, vins: string[], deadlineAt: string) {
  const publicationId = `PUB-${String(90000 + Math.floor(Math.random() * 9999)).padStart(5, '0')}`;
  const payload = { publicationId, kind: 'POLICY', sequence: 1, issuedAt: new Date().toISOString(), featureId: 'FEAT-CONF', featureVersion: '1.0.0', flagKey: 'conformance_flag', policy: { flagKey: 'conformance_flag', contentHash: `sha256:${hex64('c')}` }, kill: null, targets: vins, desired: `sha256:${hex64('c')}` };
  return {
    jobId,
    publicationId,
    kind: 'POLICY',
    priority: 'NORMAL',
    targets: vins,
    deadlineAt,
    createdAt: new Date().toISOString(),
    publication: { publicationId, kind: 'POLICY', payload, signature: { keyId: 'conformance-key', alg: 'Ed25519', payloadHash: `sha256:${hex64('a')}`, signature: Buffer.alloc(64, 1).toString('base64') } },
  };
}

export async function runConformance(o: ConformanceOptions): Promise<{ ok: boolean; checks: Check[] }> {
  const log = o.log ?? (() => {});
  const checks: Check[] = [];
  const check = (id: string, title: string, ok: boolean, detail = '') => {
    checks.push({ id, title, ok, detail });
    log(`${ok ? '✓' : '✕'} ${id} ${title}${detail ? ` — ${detail}` : ''}`);
  };
  const timeout = o.timeoutMs ?? 10_000;
  const vins = o.vins?.length ? o.vins : ['CONF-VIN-0001', 'CONF-VIN-0002'];
  const deadlineSec = o.deadlineSec ?? 20;
  const grace = o.graceMs ?? 10_000;

  // ── webhook 수신기 — 서명·시각·이벤트 ID를 확인하고 기록한다. 첫 이벤트 하나는 503으로 돌려 재전송을 본다 ──
  const received: Received[] = [];
  let failedOnce: string | null = null;
  const receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: any = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      let status = 202;
      if (req.method !== 'POST' || !req.url?.startsWith('/ota-conformance/events')) status = 404;
      else if (!failedOnce && body?.eventId) {
        failedOnce = body.eventId;
        status = 503;
      }
      received.push({ at: Date.now(), headers: req.headers, raw, body, status });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 202 ? { accepted: true } : { error: { code: 'UNAVAILABLE', message: '적합성 검사 — 재전송 확인', retryable: true } }));
    });
  });
  await new Promise<void>((r) => receiver.listen(o.webhookPort ?? 0, o.webhookHost ?? '127.0.0.1', r));
  const receiverUrl = `http://${o.webhookHost ?? '127.0.0.1'}:${(receiver.address() as AddressInfo).port}/ota-conformance/events`;
  log(`· webhook 수신 ${receiverUrl}`);
  await o.onReceiver?.(receiverUrl);

  const http = async (method: string, url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    try {
      const r = await fetch(url, { method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(timeout) });
      const text = await r.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: r.status, json, headers: r.headers };
    } catch (e) {
      return { status: 0, json: null, headers: new Headers(), error: (e as Error).message };
    }
  };
  const errorShape = (j: any, code: string) => j?.error?.code === code && typeof j.error.message === 'string' && typeof j.error.retryable === 'boolean';

  try {
    // C01 상태 점검
    const h = await http('GET', `${o.url}/ota/v1/health`);
    check('C01', '상태 점검 GET /ota/v1/health — 200, status ok, 같은 주 번호의 규격 판', h.status === 200 && h.json?.status === 'ok' && Array.isArray(h.json?.specVersions) && h.json.specVersions.some((v: string) => v.split('.')[0] === '1'), `HTTP ${h.status} ${JSON.stringify(h.json)?.slice(0, 120)}`);

    // C02·C03 토큰
    const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    const tokenReq = (secret: string) => http('POST', o.tokenUrl, { headers: { authorization: basic(o.clientId, secret), 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&scope=ota.jobs.write%20ota.jobs.read' });
    const t = await tokenReq(o.clientSecret);
    const token: string | null = typeof t.json?.access_token === 'string' ? t.json.access_token : null;
    check('C02', 'OAuth2 client credentials — 접근 토큰(Bearer, expires_in)', t.status === 200 && !!token && /^bearer$/i.test(t.json?.token_type ?? '') && Number(t.json?.expires_in) > 0, `HTTP ${t.status}`);
    const tBad = await tokenReq(`${o.clientSecret}-wrong`);
    check('C03', '틀린 클라이언트 비밀 — 토큰을 내주지 않는다(400·401)', (tBad.status === 401 || tBad.status === 400) && !tBad.json?.access_token, `HTTP ${tBad.status}`);
    if (!token) throw new Error('토큰이 없어 나머지 검사를 할 수 없습니다');

    const H = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'ota-spec-version': SPEC_VERSION, ...extra });
    const submit = (job: Record<string, unknown>, headers: Record<string, string> = {}) => http('POST', `${o.url}/ota/v1/jobs`, { headers: H({ 'idempotency-key': String(job.jobId), ...headers }), body: JSON.stringify(job) });
    const deadline = () => new Date(Date.now() + deadlineSec * 1000).toISOString();

    // C04 인증 없음·틀린 토큰
    const job0 = sampleJob(`OTJ-CONF-${randomUUID()}`, vins, deadline());
    const noAuth = await http('POST', `${o.url}/ota/v1/jobs`, { headers: { 'content-type': 'application/json', 'ota-spec-version': SPEC_VERSION, 'idempotency-key': job0.jobId }, body: JSON.stringify(job0) });
    const badAuth = await http('POST', `${o.url}/ota/v1/jobs`, { headers: { ...H({ 'idempotency-key': job0.jobId }), authorization: 'Bearer not-a-token' }, body: JSON.stringify(job0) });
    check('C04', '토큰 없음·틀린 토큰 — 401 UNAUTHENTICATED', noAuth.status === 401 && badAuth.status === 401 && errorShape(badAuth.json, 'UNAUTHENTICATED'), `HTTP ${noAuth.status}·${badAuth.status}`);

    // C05 판 협상
    const v9 = await submit(job0, { 'ota-spec-version': '9.0' });
    check('C05', '다른 주 번호의 규격 판 — 400 UNSUPPORTED_SPEC_VERSION', v9.status === 400 && errorShape(v9.json, 'UNSUPPORTED_SPEC_VERSION'), `HTTP ${v9.status} ${v9.json?.error?.code ?? ''}`);

    // C06 본문 검사
    const noTargets = await submit({ ...job0, targets: [] });
    check('C06', '대상 없는 작업 — 400 VALIDATION(오류 봉투 code·message·retryable)', noTargets.status === 400 && errorShape(noTargets.json, 'VALIDATION'), `HTTP ${noTargets.status} ${noTargets.json?.error?.code ?? ''}`);

    // C07 지난 기한
    const late = sampleJob(`OTJ-CONF-${randomUUID()}`, vins, new Date(Date.now() - 1000).toISOString());
    const lateR = await submit(late);
    check('C07', '이미 지난 기한 — 422 DEADLINE_PASSED', lateR.status === 422 && errorShape(lateR.json, 'DEADLINE_PASSED'), `HTTP ${lateR.status} ${lateR.json?.error?.code ?? ''}`);

    // C08 접수
    const job = sampleJob(`OTJ-CONF-${randomUUID()}`, vins, deadline());
    const sentAt = Date.now();
    const a = await submit(job);
    const okState = (s: unknown) => typeof s === 'string' && JOB_STATES.includes(s);
    check('C08', '작업 제출 — 202, jobId 그대로, otaJobId, 상태, OTA-Spec-Version 응답 머리글', a.status === 202 && a.json?.jobId === job.jobId && typeof a.json?.otaJobId === 'string' && okState(a.json?.state) && (a.headers.get('ota-spec-version') ?? '').split('.')[0] === '1', `HTTP ${a.status} ${JSON.stringify(a.json)?.slice(0, 160)}`);

    // C09 같은 키·같은 본문 → 같은 응답
    const again = await submit(job);
    check('C09', '같은 멱등 키·같은 본문 다시 제출 — 같은 otaJobId, Idempotent-Replayed: true', again.status >= 200 && again.status < 300 && again.json?.otaJobId === a.json?.otaJobId && again.headers.get('idempotent-replayed') === 'true', `HTTP ${again.status} replayed=${again.headers.get('idempotent-replayed')}`);

    // C10 같은 키·다른 본문 → 409
    const conflict = await submit({ ...job, priority: 'EMERGENCY' });
    check('C10', '같은 멱등 키·다른 본문 — 409 IDEMPOTENCY_CONFLICT', conflict.status === 409 && errorShape(conflict.json, 'IDEMPOTENCY_CONFLICT'), `HTTP ${conflict.status} ${conflict.json?.error?.code ?? ''}`);

    // C11·C12 조회
    const g = await http('GET', `${o.url}/ota/v1/jobs/${encodeURIComponent(job.jobId)}`, { headers: H() });
    check('C11', '작업 조회 — 200, jobId·상태·counts.total = 대상 수, payloadHash 그대로', g.status === 200 && g.json?.jobId === job.jobId && okState(g.json?.state) && g.json?.counts?.total === vins.length && g.json?.payloadHash === job.publication.signature.payloadHash, `HTTP ${g.status} ${JSON.stringify(g.json?.counts ?? null)}`);
    const nf = await http('GET', `${o.url}/ota/v1/jobs/OTJ-CONF-none-${randomUUID()}`, { headers: H() });
    check('C12', '없는 작업 조회 — 404 JOB_NOT_FOUND', nf.status === 404 && errorShape(nf.json, 'JOB_NOT_FOUND'), `HTTP ${nf.status}`);

    // C15 취소(두 번째 작업)
    const job2 = sampleJob(`OTJ-CONF-${randomUUID()}`, vins, new Date(Date.now() + 10 * 60_000).toISOString());
    await submit(job2);
    const c1 = await http('POST', `${o.url}/ota/v1/jobs/${encodeURIComponent(job2.jobId)}/cancel`, { headers: H({ 'idempotency-key': `${job2.jobId}:cancel` }), body: JSON.stringify({ reason: '적합성 검사' }) });
    const c2 = await http('POST', `${o.url}/ota/v1/jobs/${encodeURIComponent(job2.jobId)}/cancel`, { headers: H({ 'idempotency-key': `${job2.jobId}:cancel` }), body: JSON.stringify({ reason: '적합성 검사' }) });
    const g2 = await http('GET', `${o.url}/ota/v1/jobs/${encodeURIComponent(job2.jobId)}`, { headers: H() });
    const cNf = await http('POST', `${o.url}/ota/v1/jobs/OTJ-CONF-none-${randomUUID()}/cancel`, { headers: H(), body: JSON.stringify({ reason: '없는 작업' }) });
    check('C13', '취소 — 202, 다시 취소해도 202(멱등), 조회 상태 CANCELLED, 없는 작업 404', c1.status === 202 && c2.status === 202 && g2.json?.state === 'CANCELLED' && cNf.status === 404, `HTTP ${c1.status}·${c2.status} state=${g2.json?.state} 없는 작업 ${cNf.status}`);

    // C14~C17 webhook — 첫 작업의 모든 대상이 기한 + 여유 안에 끝 결과를 받는다
    const until = sentAt + deadlineSec * 1000 + grace;
    const finals = () => {
      const m = new Map<string, string>();
      for (const r of received) if (r.status === 202 && r.body?.jobId === job.jobId) for (const x of r.body.results ?? []) if (FINAL.includes(x.outcome)) m.set(x.vin, x.outcome);
      return m;
    };
    while (Date.now() < until && finals().size < vins.length) await wait(200);
    const forJob = received.filter((r) => r.body?.jobId === job.jobId || r.body?.jobId === job2.jobId);
    const f = finals();
    check('C14', 'webhook — 첫 작업의 모든 대상 차량이 기한 안에 끝 결과를 받는다(NO_RESPONSE 포함)', vins.every((v) => f.has(v)), `${f.size}/${vins.length} ${JSON.stringify(Object.fromEntries(f))}`);
    const now = Date.now() / 1000;
    const sigOk = forJob.length > 0 && forJob.every((r) => {
      const ts = String(r.headers['x-ota-timestamp'] ?? '');
      return same(String(r.headers['x-ota-signature'] ?? ''), sign(o.webhookSecret, ts, r.raw)) && Math.abs(Number(ts) - r.at / 1000) <= TOLERANCE_SEC && Math.abs(Number(ts) - now) <= TOLERANCE_SEC + 600;
    });
    check('C15', 'webhook 서명 — X-OTA-Signature = sha256=HMAC(비밀, "<X-OTA-Timestamp>.<원문>"), 시각 ±300초', sigOk, `${forJob.length}건`);
    const shapeOk =
      forJob.length > 0 &&
      forJob.every((r) => {
        const b = r.body;
        return (
          b &&
          typeof b.eventId === 'string' &&
          b.eventId.length >= 8 &&
          String(r.headers['x-ota-event-id'] ?? '') === b.eventId &&
          String(b.specVersion ?? '').split('.')[0] === '1' &&
          typeof b.type === 'string' &&
          typeof b.occurredAt === 'string' &&
          (b.results ?? []).every((x: any) => typeof x.vin === 'string' && OUTCOMES.includes(x.outcome) && typeof x.at === 'string' && vins.includes(x.vin)) &&
          (b.state === undefined || JOB_STATES.includes(b.state))
        );
      });
    check('C16', 'webhook 본문 — eventId(머리글과 같음)·specVersion·type·occurredAt·results[vin·outcome(OTA 사실만)·at]', shapeOk, '');
    const byId = new Map<string, string[]>();
    for (const r of forJob) byId.set(r.body?.eventId, [...(byId.get(r.body?.eventId) ?? []), r.raw]);
    const retried = failedOnce ? (byId.get(failedOnce) ?? []) : [];
    check('C17', 'webhook 재전송 — 503을 받은 이벤트를 같은 eventId·같은 본문으로 다시 보낸다', retried.length >= 2 && retried.every((x) => x === retried[0]), `eventId ${failedOnce ?? '-'} ${retried.length}회`);
    const distinct = [...byId.values()].every((raws) => raws.every((x) => x === raws[0]));
    check('C18', 'webhook 이벤트 ID — 다른 내용에 같은 eventId를 쓰지 않는다', distinct, `${byId.size}개 이벤트`);
  } catch (e) {
    check('C00', '검사 진행', false, (e as Error).message);
  } finally {
    receiver.closeAllConnections?.();
    await new Promise<void>((r) => receiver.close(() => r()));
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// ── 명령줄 ──
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = arg('url');
  if (!url) {
    console.error('사용: npm run ota:conformance -- --url <OTA 서버> --token-url <토큰 끝점> --client-id <id> --webhook-port <포트> [--webhook-host 0.0.0.0] [--vins V1,V2] [--deadline-sec 20]\n비밀: OTA_CLIENT_SECRET · OTA_WEBHOOK_SECRET 환경 변수');
    process.exit(2);
  }
  const r = await runConformance({
    url: url.replace(/\/+$/, ''),
    tokenUrl: arg('token-url') ?? `${url.replace(/\/+$/, '')}/oauth/token`,
    clientId: arg('client-id') ?? 'ff-platform',
    clientSecret: process.env.OTA_CLIENT_SECRET ?? '',
    webhookSecret: process.env.OTA_WEBHOOK_SECRET ?? '',
    webhookPort: Number(arg('webhook-port') ?? 9599),
    webhookHost: arg('webhook-host') ?? '127.0.0.1',
    vins: arg('vins')?.split(',').filter(Boolean),
    deadlineSec: Number(arg('deadline-sec') ?? 20),
    log: (l) => console.log(l),
  });
  console.log(`\nOTA 서버 적합성(IF-05 v${SPEC_VERSION}): ${r.checks.filter((c) => c.ok).length}/${r.checks.length} ${r.ok ? '통과' : '실패'}`);
  process.exit(r.ok ? 0 : 1);
}

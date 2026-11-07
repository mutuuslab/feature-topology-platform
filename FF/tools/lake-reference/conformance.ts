// Lake 중계 적합성 검사(IF-15 차량 입구·중계, TL-M07) — Data Lake 서버가 FF가 기대는 중계 계약(80-75 3·4장, datalake-if15.openapi.json)을 지키는지 주소에 대고 확인한다.
//   npm run lake:conformance -- --url https://lake.example.internal [--gateway-subject "CN=oem-gateway-1"] [--long-wait-sec 2]
//   비밀은 환경 변수로: LAKE_RELAY_TOKEN (명령줄에 쓰지 않는다)
// 의존성 없음 — 참조 서버(server.ts)와 따로, 계약 문서만 보고 만든 두 번째 구현. 검사 메시지는 무작위 가명·서명 자리값이다(Lake는 서명을 검증하지 않는다 —
// FF가 떨어뜨린다). 검사 대상 Lake의 중계 흐름에 실제 기록이 남으므로 시험 환경에서 돌린다(FF가 같은 Lake를 당기고 있으면 검사 메시지는 UNKNOWN_VEHICLE로 떨어진다).
// 차량 직접 입구의 mTLS는 TLS를 끝내는 프록시가 넘기는 주체 머리글(x-client-cert-subject)로 흉내 낸다 — 실제 mTLS 설치에서는 그 프록시 뒤 주소로 돌린다.
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const SUBJECT_HEADER = 'x-client-cert-subject';
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface LakeConformanceOptions {
  url: string;
  relayToken: string;
  /** 등록된 OEM 게이트웨이 인증서 주체 — 없으면 L15를 건너뛴다 */
  gatewaySubject?: string;
  /** 긴 대기 검사에 쓸 wait(초) */
  longWaitSec?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface Check {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
}

type Kind = 'STATUS_REPORT' | 'INBOX_ACK' | 'VEHICLE_REPORT';

/** 형식만 맞춘 검사 메시지 — 서명은 자리값(22자) */
export function sampleMessage(pseudonym: string, kind: Kind, body: Record<string, unknown> = { probe: randomBytes(4).toString('hex') }) {
  const raw = Buffer.from(JSON.stringify(body));
  const nonce = randomBytes(16).toString('base64url');
  return {
    schema: 'ff.vehicle.msg/1',
    message_id: `${pseudonym}:${nonce}`,
    pseudonym,
    kind,
    ref: kind === 'INBOX_ACK' ? `DLV-${randomBytes(4).toString('hex')}` : null,
    auth: { scheme: 'FFV1-MSG', key_epoch: 1, timestamp: String(Date.now()), nonce, mac: randomBytes(16).toString('base64url') },
    body_b64: raw.toString('base64'),
    body_sha256: createHash('sha256').update(raw).digest('hex'),
  };
}

const newPseudonym = () => randomBytes(8).toString('hex');

export async function runLakeConformance(o: LakeConformanceOptions): Promise<{ ok: boolean; checks: Check[] }> {
  const base = o.url.replace(/\/$/, '');
  const timeout = o.timeoutMs ?? 30_000;
  const longWait = o.longWaitSec ?? 2;
  const checks: Check[] = [];
  const log = o.log ?? (() => {});
  const check = (id: string, title: string, ok: boolean, detail = '') => {
    checks.push({ id, title, ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title}${detail ? ` — ${detail}` : ''}`);
  };
  const call = async (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* JSON 아님 */
    }
    return { status: res.status, json };
  };
  const relayAuth = { authorization: `Bearer ${o.relayToken}` };
  const post = (subject: string | null, messages: unknown[]) => call('POST', '/v1/vehicle/messages', { body: { messages }, headers: subject ? { [SUBJECT_HEADER]: `CN=${subject}` } : {} });
  const pull = (stream: string, after: number, q: Record<string, number> = {}) => call('GET', `/v1/relay/${stream}?${new URLSearchParams({ after: String(after), wait: '0', ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) })}`, { headers: relayAuth });
  const resultOf = (r: { json: any }, i = 0) => r.json?.results?.[i] ?? {};
  const heads = async () => {
    const r = await call('GET', '/v1/relay/status', { headers: relayAuth });
    const by = Object.fromEntries((r.json?.streams ?? []).map((s: any) => [s.stream, s]));
    return { status: r.status, json: r.json, safety: Number(by.safety?.head_seq ?? 0), normal: Number(by.normal?.head_seq ?? 0) };
  };
  /** after 뒤 기록 중 이 가명의 것만 */
  const mine = (page: any, pseudonym: string) => (page?.items ?? []).filter((r: any) => r?.message?.pseudonym === pseudonym);

  try {
    const live = await call('GET', '/v1/health/live');
    check('L01', '살아 있음 점검 200·status', live.status === 200 && ['ok', 'degraded', 'down'].includes(live.json?.status), `${live.status} ${live.json?.status}`);

    const ps = newPseudonym();
    const start = await heads();
    check('L14', '중계 상태 — 두 흐름의 head_seq·backlog·last_read_after·oldest_unread_age_ms', start.status === 200 && ['safety', 'normal'].every((s) => (start.json?.streams ?? []).some((x: any) => x.stream === s && Number.isInteger(x.head_seq) && Number.isInteger(x.backlog) && 'last_read_after' in x && 'oldest_unread_age_ms' in x)), JSON.stringify(start.json).slice(0, 200));

    const m1 = sampleMessage(ps, 'STATUS_REPORT');
    const noCert = await post(null, [m1]);
    check('L02', '클라이언트 인증서 없음 401', noCert.status === 401, String(noCert.status));
    const wrong = await post(newPseudonym(), [sampleMessage(ps, 'STATUS_REPORT')]);
    check('L03', '인증서 주체와 가명이 다르면 403(게이트웨이가 아닐 때)', wrong.status === 403, String(wrong.status));

    const stored = await post(ps, [m1]);
    const s1 = resultOf(stored);
    check('L04', '저장 뒤 202 STORED·relay_seq', stored.status === 202 && s1.status === 'STORED' && s1.message_id === m1.message_id && Number.isInteger(s1.relay_seq), JSON.stringify(stored.json).slice(0, 200));
    const again = await post(ps, [m1]);
    check('L05', '같은 message_id는 DUPLICATE(다시 저장하지 않는다)', again.status === 202 && resultOf(again).status === 'DUPLICATE', JSON.stringify(again.json).slice(0, 200));

    const badHash = { ...sampleMessage(ps, 'STATUS_REPORT'), body_sha256: '0'.repeat(64) };
    const vinField = { ...sampleMessage(ps, 'STATUS_REPORT'), vin: 'KMH-NX4-0002' };
    const inv = await post(ps, [badHash, vinField]);
    check('L06', '본문 해시 불일치·스키마 밖(VIN 필드)은 INVALID(사유)', inv.status === 202 && resultOf(inv, 0).status === 'INVALID' && resultOf(inv, 0).reason === 'BODY_HASH_MISMATCH' && resultOf(inv, 1).status === 'INVALID' && resultOf(inv, 1).reason === 'NOT_SCHEMA', JSON.stringify(inv.json).slice(0, 240));

    const noToken = await call('GET', `/v1/relay/safety?after=${start.safety}&wait=0`);
    check('L07', '중계 토큰 없음 401', noToken.status === 401, String(noToken.status));

    const p1 = await pull('safety', start.safety);
    const r1 = mine(p1.json, ps);
    const rec = r1[0];
    const keysOk = rec && Object.keys(rec).sort().join() === ['message', 'received_at', 'relay_seq', 'stream'].join();
    check(
      'L08',
      '중계 기록 — 받은 메시지를 한 글자도 바꾸지 않고(relay_seq·stream·received_at만 덧붙임), 묶음 키가 계약대로',
      p1.status === 200 && r1.length === 1 && keysOk && JSON.stringify(rec.message) === JSON.stringify(m1) && rec.stream === 'SAFETY' && RFC3339.test(rec.received_at) && rec.relay_seq === s1.relay_seq && ['stream', 'items', 'next_after', 'more', 'lag'].every((k) => k in (p1.json ?? {})),
      JSON.stringify(rec ?? p1.json).slice(0, 240),
    );

    const report = sampleMessage(ps, 'VEHICLE_REPORT');
    const ack = sampleMessage(ps, 'INBOX_ACK');
    await post(ps, [report, ack]);
    const sp = await pull('safety', start.safety);
    const np = await pull('normal', start.normal);
    check(
      'L09',
      '흐름 — STATUS_REPORT·INBOX_ACK는 safety, VEHICLE_REPORT는 normal',
      mine(sp.json, ps).some((r: any) => r.message.message_id === ack.message_id && r.stream === 'SAFETY') && !mine(sp.json, ps).some((r: any) => r.message.kind === 'VEHICLE_REPORT') && mine(np.json, ps).some((r: any) => r.message.message_id === report.message_id && r.stream === 'NORMAL'),
      `safety ${mine(sp.json, ps).map((r: any) => r.message.kind).join(',')} · normal ${mine(np.json, ps).map((r: any) => r.message.kind).join(',')}`,
    );

    const replay = await pull('safety', start.safety);
    check('L10', '같은 after로 다시 부르면 같은 기록(최소 한 번)', JSON.stringify(mine(replay.json, ps).map((r: any) => r.relay_seq)) === JSON.stringify(mine(sp.json, ps).map((r: any) => r.relay_seq)) && mine(replay.json, ps).length === 2, '');

    // 순서 — 같은 차량의 메시지를 하나씩 보낸 순서대로 내준다
    const ps2 = newPseudonym();
    const h2 = await heads();
    const seqMsgs = [0, 1, 2].map((i) => sampleMessage(ps2, 'STATUS_REPORT', { order: i }));
    for (const m of seqMsgs) await post(ps2, [m]);
    const ordered = mine((await pull('safety', h2.safety)).json, ps2);
    const seqs = ordered.map((r: any) => r.relay_seq);
    check('L11', '같은 차량의 메시지는 받은 순서대로(relay_seq 오름차순)', JSON.stringify(ordered.map((r: any) => r.message.message_id)) === JSON.stringify(seqMsgs.map((m) => m.message_id)) && seqs.every((s: number, i: number) => i === 0 || s > seqs[i - 1]), seqs.join(','));

    // 긴 대기 — 새 기록이 없으면 wait초까지 기다렸다가 빈 묶음
    const head = (await heads()).safety;
    const t0 = Date.now();
    const empty = await call('GET', `/v1/relay/safety?after=${head}&wait=${longWait}`, { headers: relayAuth });
    const waited = Date.now() - t0;
    check('L12', `긴 대기 — 새 기록이 없으면 wait(${longWait}초)까지 기다렸다가 빈 묶음, next_after 그대로`, empty.status === 200 && (empty.json?.items ?? []).length === 0 && empty.json?.next_after === head && waited >= longWait * 1000 * 0.8, `${waited} ms`);

    // 긴 대기 중 새 메시지 — 곧바로 깬다
    const ps3 = newPseudonym();
    const h3 = (await heads()).safety;
    const t1 = Date.now();
    const waiting = call('GET', `/v1/relay/safety?after=${h3}&wait=10`, { headers: relayAuth });
    await new Promise((r) => setTimeout(r, 300));
    const m3 = sampleMessage(ps3, 'STATUS_REPORT');
    await post(ps3, [m3]);
    const woke = await waiting;
    const woken = Date.now() - t1;
    check('L13', '긴 대기 중 저장되면 곧바로 답한다(2초 안)', woke.status === 200 && mine(woke.json, ps3).some((r: any) => r.message.message_id === m3.message_id) && woken < 2_000, `${woken} ms`);

    // 묶음 크기 — limit을 넘으면 more
    const ps4 = newPseudonym();
    const h4 = (await heads()).safety;
    await post(ps4, [sampleMessage(ps4, 'STATUS_REPORT'), sampleMessage(ps4, 'STATUS_REPORT')]);
    const limited = await pull('safety', h4, { limit: 1 });
    check('L16', 'limit을 넘는 기록이 있으면 more=true, next_after는 준 기록의 마지막 relay_seq', limited.status === 200 && limited.json?.items?.length === 1 && limited.json?.more === true && limited.json?.next_after === limited.json?.items?.[0]?.relay_seq, JSON.stringify({ n: limited.json?.items?.length, more: limited.json?.more, next: limited.json?.next_after }));

    if (o.gatewaySubject) {
      const gw = await call('POST', '/v1/vehicle/messages', { body: { messages: [sampleMessage(newPseudonym(), 'STATUS_REPORT'), sampleMessage(newPseudonym(), 'VEHICLE_REPORT')] }, headers: { [SUBJECT_HEADER]: o.gatewaySubject } });
      check('L15', '등록된 게이트웨이는 여러 차량을 대신 보낸다', gw.status === 202 && (gw.json?.results ?? []).every((r: any) => r.status === 'STORED'), JSON.stringify(gw.json).slice(0, 200));
    }

    const after = await heads();
    check('L17', '중계 상태가 FF가 읽은 위치(last_read_after)를 보인다', (after.json?.streams ?? []).some((s: any) => s.stream === 'safety' && Number.isInteger(s.last_read_after) && s.last_read_after >= start.safety), JSON.stringify(after.json).slice(0, 200));
  } catch (e) {
    check('L00', '검사 실행', false, (e as Error).message);
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
  const token = process.env.LAKE_RELAY_TOKEN;
  if (!url || !token) {
    console.error('사용법: LAKE_RELAY_TOKEN=… npm run lake:conformance -- --url <Lake 주소> [--gateway-subject "CN=…"] [--long-wait-sec 2]');
    process.exit(2);
  }
  const r = await runLakeConformance({ url, relayToken: token, gatewaySubject: arg('gateway-subject'), longWaitSec: Number(arg('long-wait-sec') ?? 2), log: (l) => console.log(l) });
  console.log(r.ok ? `적합 — 검사 ${r.checks.length}개 모두 통과` : `부적합 — ${r.checks.filter((c) => !c.ok).length}개 실패`);
  process.exit(r.ok ? 0 : 1);
}

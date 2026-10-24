// OTA 서버 연동(IF-05) 통합 — FF + 시험 OTA 서버(tools/ota-reference, 별도 프로세스·OS가 고른 포트):
// 게시본 → OTA 작업 제출 → 시험 서버가 webhook으로 OTA 사실(DELIVERING·DELIVERED·NO_RESPONSE…) + 차량 결과는 차량 → Lake → FF(시험 서버의 Lake 흉내가
// 지금의 IF-06 입구로) → 회신 집계 CONFIRMED·PARTIAL. 끝 상태는 차량 결과만 정한다 — OTA 사실만으로는 닫히지 않고, 어긋나면 차량 결과가 이긴다(80-45 §7.5).
// 보안(틀린 HMAC·오래된 서명·이벤트 재전송·같은 ID 다른 본문), 멱등 재제출, 제출 실패 → 전달 실패(재시도 가능) → 자동·수동 재시도.
// readiness: RD-OPS-04
// readiness: RD-UX-04
// 실제 시간에 기대지 않는다(2026-10-25 CI 흔들림 — 부하 기계에서 회신 기한 8초가 먼저 지나 TIMEOUT): 회신 기한은 시험보다 길게 두고(10분),
// 기한이 필요한 시험은 시험 OTA 서버의 /_sim/expire(그 작업의 예약을 지금 실행)와 FF 회신 기한 닫기(close)를 직접 부른다.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OtaServerAdapter, otaWebhookSignature } from '../../src/adapters/ota/ota-server.adapter';
import { SecureDeployService } from '../../src/domains/d06-qsec/secure-deploy/secure-deploy.service';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

// 회신 기한은 모듈을 읽을 때 정해진다(secure-deploy.service의 PUBLICATION_TIMEOUT_MS) — import보다 먼저 넣는다.
// 예전에는 beforeAll에서 넣어 4초가 적용되지 않고 기본 8초가 쓰였다.
vi.hoisted(() => {
  process.env.PUBLICATION_TIMEOUT_MS = '600000';
});

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const CLIENT_SECRET = 'ota-reference-client-secret';
const WEBHOOK_SECRET = 'ota-reference-webhook-secret-change-me-0000';
const ENV = {
  FF_OTA_CLIENT_ID: 'ff-platform',
  FF_OTA_CLIENT_SECRET: CLIENT_SECRET,
  FF_OTA_WEBHOOK_SECRET: WEBHOOK_SECRET,
  FF_OTA_RETRY_BASE_MS: '40',
  FF_OTA_RETRY_MAX: '2',
  // OTA 호출 제한 시간 — 부하 기계에서 호출이 늦어도 실패·재시도로 번지지 않게(재시도 횟수를 단언한다)
  FF_OTA_TIMEOUT_MS: '60000',
  FF_BOOT_PUBLISH: '0',
  GLEO_MODE: 'internal',
  CARLA_RUNNER: join(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'ff-ota-')),
};
type Boot = Awaited<ReturnType<typeof bootApp>>;

/** 시험 OTA 서버를 별도 프로세스로 — 고객이 만드는 서버처럼 HTTP로만 이어진다 */
async function startReference(): Promise<{ url: string; proc: ChildProcess }> {
  const script = join(__dirname, '..', '..', '..', 'tools', 'ota-reference', 'server.ts');
  const proc = spawn(process.execPath, [script, '--port', '0', '--delay-ms', '150', '--webhook-url', 'http://127.0.0.1:1/unset'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: proc.stdout! });
  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('시험 OTA 서버가 시작하지 않았습니다')), 15_000);
    lines.on('line', (l) => {
      if (!l.startsWith('{')) return;
      const e = JSON.parse(l);
      if (e.event === 'listening') (clearTimeout(t), resolve(e.url));
    });
    proc.once('exit', (c) => reject(new Error(`시험 OTA 서버 종료 ${c}`)));
  });
  return { url, proc };
}

describe('OTA 서버 연동(IF-05) — FF + 시험 OTA 서버', { timeout: 40_000 }, () => {
  let b: Boot;
  let ref: { url: string; proc: ChildProcess };
  let ffUrl: string;
  const sim = (body: unknown, path = '/_sim/config') => fetch(`${ref.url}${path}`, { method: 'POST', headers: { 'x-sim-admin': CLIENT_SECRET, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  /** 회신 기한이 지났다 — 시험 OTA 서버가 기한에 할 일(응답 없음·끝 상태)을 지금 하게 한다 */
  const expireOta = async (publicationId: string) => expect((await sim({ jobId: `OTJ-${publicationId}` }, '/_sim/expire')).status).toBe(200);
  /** FF 회신 기한 닫기 — 스케줄러가 기한에 부르는 것과 같은 함수 */
  const closeAtDeadline = async (publicationId: string) => {
    b.get<SecureDeployService>(SecureDeployService).close(publicationId);
    return pub(publicationId);
  };
  const pub = async (id: string) => (await b.http().get(`/api/publications/${id}`).expect(200)).body;
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000) => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v)) {
      if (Date.now() > end) throw new Error(`기다리던 상태가 오지 않았습니다: ${JSON.stringify(v).slice(0, 600)}`);
      await new Promise((r) => setTimeout(r, 100));
      v = await fn();
    }
    return v;
  };
  let n = 0;
  /** 정책 하나를 만들어 배포 → 게시본 ID */
  const deploy = async () => {
    n++;
    const c = await b.http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: `care_00022_ota${n}`, description: `OTA 연동 시험 ${n}`, safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    await b.http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    expect((await b.http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await b.http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    return (await b.http().post(`/api/policies/${c.body.policyId}/deploy`).set(RELEASE).send({ reason: 'OTA 배포' }).expect(200)).body.publicationId as string;
  };
  /** FF webhook에 직접 보낸다(시험 OTA 서버를 거치지 않고 위조·재전송을 흉내) */
  const post = (body: unknown, o: { secret?: string; ts?: number; raw?: string; eventId?: string } = {}) => {
    const raw = o.raw ?? JSON.stringify(body);
    const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
    return b
      .http()
      .post('/api/ota/v1/events')
      .set({ 'content-type': 'application/json', 'x-ota-timestamp': ts, 'x-ota-event-id': o.eventId ?? (body as { eventId: string }).eventId, 'x-ota-signature': otaWebhookSignature(o.secret ?? WEBHOOK_SECRET, ts, raw), 'ota-spec-version': '1.0' })
      .send(raw);
  };

  beforeAll(async () => {
    ref = await startReference();
    Object.assign(process.env, ENV, { FF_OTA_URL: ref.url, FF_OTA_TOKEN_URL: `${ref.url}/oauth/token` });
    b = await bootApp();
    await b.app.listen(0, '127.0.0.1');
    ffUrl = `http://127.0.0.1:${(b.app.getHttpServer().address() as AddressInfo).port}`;
    expect((await sim({ webhookUrl: `${ffUrl}/api/ota/v1/events`, lakeUrl: ffUrl, scenario: 'all-applied' })).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await b?.app.close();
    ref?.proc.kill();
    for (const k of [...Object.keys(ENV), 'FF_OTA_URL', 'FF_OTA_TOKEN_URL', 'PUBLICATION_TIMEOUT_MS']) delete process.env[k];
  });

  it('설정이 있으면 채널은 ota(기본), 연결 상태는 live — 화면의 OTA 모의 표시가 사라진다(RD-UX-04)', async () => {
    const ch = (await b.http().get('/api/vehicle-channel').expect(200)).body;
    expect(ch.active).toBe('ota');
    expect(ch.adapters.find((a: any) => a.id === 'ota')).toMatchObject({ active: true, status: { specVersion: '1.0', url: ref.url } });
    const conn = (await b.http().get('/api/system/connections').expect(200)).body;
    expect(conn.items.find((i: any) => i.key === 'ota')).toEqual({ key: 'ota', mode: 'live', ifId: 'IF-05', liveAdapter: true });
  });

  let first: string;
  it('모두 적용 — 게시본 → OTA 작업(멱등 키 = jobId) → webhook 전달 결과 + 차량 회신(Lake → IF-06) → 회신 집계 CONFIRMED', async () => {
    first = await deploy();
    const done = await until(() => pub(first), (p) => p.publication.status !== 'DISPATCHED' && p.publication.status !== 'SIGNED');
    expect(done.publication.status).toBe('CONFIRMED');
    // 회신 기한은 시험보다 길다(vi.hoisted) — 기한이 시험 속도와 경주하지 않는다
    expect(Date.parse(done.publication.deadlineAt) - Date.parse(done.publication.createdAt)).toBe(600_000);
    expect(done.publication.campaignId).toBe(`OTJ-${first}`);
    expect(done.publication.confirmed).toBe(done.publication.denominator);
    // FF가 연결 끊김으로 아는 차량(KMH-NX4-0003)도 OTA 서버에 맡긴다 — 연결은 OTA 서버가 추적한다
    expect(done.publication.payload.targets).toContain('KMH-NX4-0003');
    const d = await until(() => pub(first), (p) => p.delivery?.state === 'COMPLETED');
    expect(d.delivery).toMatchObject({ jobId: `OTJ-${first}`, channel: 'ota', state: 'COMPLETED', serverState: 'COMPLETED', otaJobId: expect.stringMatching(/^ota-/), attempts: 1, lastError: null });
    // webhook은 OTA 사실만 — 차량에 넘겼다(DELIVERED). 적용은 차량 결과(Lake 경로)가 알린다
    expect(d.delivery.vehicles.every((v: any) => v.outcome === 'DELIVERED')).toBe(true);
    expect(d.readbacks.every((r: any) => r.via === 'IF-06')).toBe(true);
    // 게시본 화면의 연계 호출(IF-05)은 실제 요청 요약과 OTA 서버 응답 — 모의 캠페인(CMP-)이 아니다
    const call = d.calls.find((c: any) => c.ifId === 'IF-05');
    expect(call.request).toMatchObject({ channel: 'OTA_SERVER', jobId: `OTJ-${first}`, specVersion: '1.0' });
    expect(call.response).toMatchObject({ jobId: `OTJ-${first}`, otaJobId: d.delivery.otaJobId, state: 'ACCEPTED' });
  });

  it('같은 작업을 다시 제출해도 OTA 서버는 같은 작업을 돌려준다(멱등) — 차량에 두 번 가지 않는다', async () => {
    const ota = b.get<OtaServerAdapter>(OtaServerAdapter);
    const row = (ota as any).jobs.get(`OTJ-${first}`);
    const body = ota.request(row, (ota as any).publications.get(first));
    const res = await (ota as any).client.submit(body, row.job_id);
    expect(res.replayed).toBe(true);
    expect(res.body.otaJobId).toBe((await pub(first)).delivery.otaJobId);
    const state = (await (await fetch(`${ref.url}/_sim/state`, { headers: { 'x-sim-admin': CLIENT_SECRET } })).json()) as { jobs: { jobId: string }[] };
    expect(state.jobs.filter((j) => j.jobId === `OTJ-${first}`)).toHaveLength(1);
  });

  it('일부 응답 없음 — 차량이 끝내 답하지 않으면 회신 기한에 PARTIAL, 그 차량은 NO_RESPONSE', async () => {
    await sim({ scenario: 'some-no-response' });
    const id = await deploy();
    // 닿은 차량의 회신이 모두 온 뒤(기한 전에는 열려 있다) 기한을 지나게 한다
    const open = await until(() => pub(id), (p) => p.publication.confirmed === p.publication.denominator - 1);
    expect(open.publication.closedAt).toBeNull();
    await expireOta(id);
    await until(() => pub(id), (p) => p.delivery?.state === 'COMPLETED');
    const done = await closeAtDeadline(id);
    expect(done.publication.status).toBe('PARTIAL');
    expect(done.publication.confirmed).toBe(done.publication.denominator - 1);
    const silent = done.delivery.vehicles.filter((v: any) => v.outcome === 'NO_RESPONSE');
    expect(silent).toHaveLength(1);
    expect(done.delivery.state).toBe('COMPLETED');
    // 차량 회신이 없는 차량은 OTA 전달 기록을 사유로 보인다
    expect(done.publication.nodes.find((x: any) => x.nodeId === silent[0].vin)).toMatchObject({ state: 'UNKNOWN', reason: 'OTA:NO_RESPONSE' });
  });

  it('OTA 사실만으로는 닫히지 않는다 — 끝 상태는 차량 결과(Lake → FF)가 정하고, 어긋나면 차량 결과가 이긴다', async () => {
    await sim({ scenario: 'some-no-response', lakeUrl: null });
    const id = await deploy();
    const targets = (await pub(id)).publication.payload.targets as string[];
    const sent = await until(() => pub(id), (p) => p.delivery?.vehicles.length === targets.length);
    expect(sent.publication.status).toBe('DISPATCHED');
    expect(sent.readbacks).toEqual([]);
    const [second, third] = targets;
    const last = targets[targets.length - 1];
    expect(sent.delivery.vehicles.find((v: any) => v.vin === last)).toMatchObject({ outcome: 'DELIVERING', detail: expect.stringContaining('NOT_CONNECTED') });
    expect(sent.publication.nodes.find((x: any) => x.nodeId === third)).toMatchObject({ state: 'UNKNOWN', reason: 'OTA:DELIVERED' });
    // 차량 결과(지금은 IF-06 입구, Lake 중계 뒤에는 차량 서명 FFV1-MSG): OTA는 아직 못 닿았다는데 차량은 적용 → 차량 결과가 이긴다.
    // OTA는 넘겼다는데 차량은 거부 → 거부
    const p = sent.publication;
    const readback = (vin: string, extra: Record<string, unknown>) =>
      b.http().post('/api/telemetry/readback').set(actor('data-lake', 'SYSTEM')).send({ vin, publicationId: id, metricType: 'READBACK', policyHash: p.signature.payloadHash, featureVersion: p.payload.featureVersion, bootId: `BOOT-${vin}-1`, sequence: p.payload.sequence, ...extra }).expect(202);
    await readback(last, { observed: p.payload.desired });
    await readback(second, { observed: 'REJECTED', rejectReason: 'TARGET_MISMATCH' });
    const after = await pub(id);
    expect(after.publication.nodes.find((x: any) => x.nodeId === last)).toMatchObject({ state: 'CONFIRMED' });
    expect(after.publication.nodes.find((x: any) => x.nodeId === second)).toMatchObject({ state: 'UNKNOWN', reason: 'REJECTED:TARGET_MISMATCH' });
    expect(after.publication.nodes.find((x: any) => x.nodeId === third)).toMatchObject({ reason: 'OTA:DELIVERED' });
    const closed = await closeAtDeadline(id);
    expect(closed.publication.status).toBe('PARTIAL');
    expect(closed.publication.confirmed).toBe(1);
    // 기한에 OTA가 NO_RESPONSE라 알려도 차량 결과로 확인된 노드는 그대로
    await expireOta(id);
    const final = await until(() => pub(id), (q) => q.delivery?.vehicles.find((v: any) => v.vin === last)?.outcome === 'NO_RESPONSE');
    expect(final.publication.nodes.find((x: any) => x.nodeId === last)).toMatchObject({ state: 'CONFIRMED' });
    await sim({ scenario: 'all-applied', lakeUrl: ffUrl });
  });

  it('서명 실패 — 차량 거부는 집계하지 않고 노드 사유로 보인다(PARTIAL)', async () => {
    await sim({ scenario: 'signature-failure' });
    const id = await deploy();
    // 차량 회신(거부 1 + 적용 나머지)이 모두 온 뒤 회신 기한에 닫는다
    await until(() => pub(id), (p) => p.readbacks.length === p.publication.denominator);
    const done = await closeAtDeadline(id);
    expect(done.publication.status).toBe('PARTIAL');
    expect(done.publication.nodes.some((x: any) => x.reason === 'REJECTED:SIGNATURE_INVALID')).toBe(true);
    // 차량이 서명 검증에서 거부한 것은 차량 결과로만 드러난다 — OTA 사실은 넘겼다(DELIVERED)
    expect(done.delivery.vehicles.every((v: any) => v.outcome === 'DELIVERED')).toBe(true);
  });

  it('webhook 보안 — 틀린 HMAC·서명 없음·오래된 시각은 401, 상태는 바뀌지 않는다', async () => {
    const before = (await pub(first)).readbacks.length;
    const ev = { specVersion: '1.0', eventId: randomUUID(), type: 'vehicle.results', jobId: `OTJ-${first}`, occurredAt: new Date().toISOString(), results: [{ vin: 'lead-01', outcome: 'NO_RESPONSE', at: new Date().toISOString() }] };
    expect((await post(ev, { secret: 'w'.repeat(40) })).status).toBe(401);
    expect((await b.http().post('/api/ota/v1/events').send(ev)).status).toBe(401);
    const stale = await post(ev, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.status).toBe(401);
    expect(stale.body.error.message).toContain('허용 범위');
    expect((await pub(first)).readbacks.length).toBe(before);
  });

  it('webhook 재전송 — 같은 이벤트는 한 번만 반영(duplicate), 같은 ID·다른 본문 409, 모르는 작업 404, 규격과 다른 본문 400', async () => {
    const id = await until(
      async () => (await b.http().get('/api/ota/jobs').set(RELEASE).expect(200)).body.items,
      (items: any[]) => items.length >= 1,
    );
    const job = id.find((j: any) => j.publicationId === first);
    const vin = (await pub(first)).publication.payload.targets[0];
    const ev = { specVersion: '1.0', eventId: randomUUID(), type: 'vehicle.results', jobId: job.jobId, occurredAt: new Date().toISOString(), results: [{ vin, outcome: 'NO_RESPONSE', at: new Date().toISOString() }] };
    const r1 = await post(ev);
    expect(r1.status).toBe(202);
    expect(r1.body).toMatchObject({ duplicate: false });
    // 늦게 온 NO_RESPONSE는 이미 넘긴(DELIVERED) 사실을 덮지 않는다
    expect(r1.body).toMatchObject({ applied: 0, ignored: 1 });
    expect((await pub(first)).delivery.vehicles.find((v: any) => v.vin === vin).outcome).toBe('DELIVERED');
    const r2 = await post(ev);
    expect(r2.status).toBe(202);
    expect(r2.body).toMatchObject({ duplicate: true, applied: 0 });
    expect((await post({ ...ev, type: 'job.state', state: 'COMPLETED' })).status).toBe(409);
    expect((await post({ ...ev, eventId: randomUUID(), jobId: 'OTJ-PUB-99999' })).status).toBe(404);
    // 모르는 결과 값(뒤 판 추가·차량이 만든 APPLIED)은 받기만 하고 쓰지 않는다(호환 규칙·OTA 사실만)
    for (const outcome of ['QUEUED_AT_EDGE', 'APPLIED']) {
      const u = await post({ ...ev, eventId: randomUUID(), results: [{ vin, outcome, at: new Date().toISOString() }] });
      expect(u.status).toBe(202);
      expect(u.body).toMatchObject({ applied: 0, ignored: 1, ignoredResults: [{ vin, reason: 'UNKNOWN_OUTCOME' }] });
    }
    expect((await post({ ...ev, eventId: randomUUID(), results: [{ vin, at: 'x' }] })).status).toBe(400);
    expect((await post({ ...ev, eventId: randomUUID(), specVersion: '2.0' })).status).toBe(400);
  });

  // 2026-10-25 CI 흔들림의 근본 원인: 재시도 타이머는 단조 시계로 깨는데 '제출할 때가 됐나'는 벽시계로 다시 물었다 —
  // 타이머가 시계보다 1 ms라도 일찍 깨면 작업이 RETRY_WAIT에 멈춰(다시 걸지도 않아) 회신 기한에 TIMEOUT이 됐다.
  // 시계를 멈춰(= 타이머가 언제나 시계보다 일찍 깬다) 재현한다. 수정 전: RETRY_WAIT에서 멈춤, 수정 뒤: 예약한 시각까지의 작업을 낸다
  it('제출 실패 — 게시본은 남고 전달만 전달 실패(재시도 가능) → 자동 재시도로 접수(타이머가 시계보다 일찍 깨도)', async () => {
    await sim({ scenario: 'flaky' }); // 처음 두 번 503
    const clock = b.get<Clock>(Clock);
    clock.set(new Date());
    let done: Awaited<ReturnType<typeof pub>>;
    let id: string;
    try {
      id = await deploy();
      done = await until(() => pub(id), (p) => p.delivery?.state === 'COMPLETED' || p.delivery?.state === 'FAILED');
    } finally {
      clock.set(null);
    }
    expect(done.delivery).toMatchObject({ state: 'COMPLETED', attempts: 3 });
    const closed = await until(() => pub(id), (p) => !!p.publication.closedAt);
    expect(closed.publication.status).toBe('CONFIRMED');
  });

  it('자동 재시도가 다하면 FAILED(게시본은 서명된 채 DISPATCHED) → 화면에서 다시 제출하면 같은 멱등 키로 접수', async () => {
    await sim({ scenario: { default: 'APPLIED', failSubmissions: 3 } });
    const id = await deploy();
    const failed = await until(() => pub(id), (p) => p.delivery?.state === 'FAILED');
    expect(failed.publication.status).toBe('DISPATCHED');
    expect(failed.delivery).toMatchObject({ attempts: 3, otaJobId: null, lastError: { code: 'UNAVAILABLE', status: 503, retryable: true } });
    // 역할 — 감사자는 다시 제출하지 못한다
    await b.http().post(`/api/ota/jobs/${failed.delivery.jobId}/retry`).set(actor('kim.auditor', 'AUDITOR')).send({ reason: '다시 제출' }).expect(403);
    const r = await b.http().post(`/api/ota/jobs/${failed.delivery.jobId}/retry`).set(RELEASE).send({ reason: 'OTA 서버 복구 확인' }).expect(200);
    expect(r.body).toMatchObject({ state: 'SUBMITTED', attempts: 1, lastError: null });
    const closed = await until(() => pub(id), (p) => !!p.publication.closedAt);
    expect(closed.publication.status).toBe('CONFIRMED');
    // 접수된 작업은 다시 제출하지 않는다
    await b.http().post(`/api/ota/jobs/${failed.delivery.jobId}/retry`).set(RELEASE).send({ reason: '한 번 더' }).expect(422);
  });

  it('취소 — 아직 전달하지 않은 차량은 CANCELLED, 작업은 CANCELLED', async () => {
    await sim({ scenario: 'silent', delayMs: 2000 });
    const id = await deploy();
    const sub = await until(() => pub(id), (p) => p.delivery?.state === 'SUBMITTED');
    const r = await b.http().post(`/api/ota/jobs/${sub.delivery.jobId}/cancel`).set(RELEASE).send({ reason: '배포 중단' }).expect(200);
    expect(r.body).toMatchObject({ state: 'CANCELLED', serverState: 'CANCELLED' });
    await b.http().post(`/api/ota/jobs/${sub.delivery.jobId}/cancel`).set(RELEASE).send({ reason: '한 번 더' }).expect(422);
    await sim({ scenario: 'all-applied', delayMs: 150 });
  });
});

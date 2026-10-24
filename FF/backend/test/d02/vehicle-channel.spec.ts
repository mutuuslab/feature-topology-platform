// 실제 차량 전달 경로 — 차량 당겨받기 HTTPS(pull): 서명된 게시본이 전달함에 쌓이고, 차량이 서명한 요청으로 받아 가 직접 검증·적용한 뒤 서명한 확인을 보낸다.
// readiness: RD-OPS-04
// 운영 모드 기본 채널은 pull(시뮬레이터 아님), sim은 운영 모드에서 거부, 고른 어댑터가 없으면 시작 거부, 고객 게이트웨이 어댑터를 끼울 수 있다.
Object.assign(process.env, {
  FF_SCHEDULER: 'manual',
  GLEO_MODE: 'internal',
  CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-vch-')),
});
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Publication } from '@ff/contracts';
import { VehicleChannelRegistry } from '../../src/domains/d02-runtime/vehicle-channel/vehicle-channel';
import { payloadHash } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';
import { signVehicleRequest, vehicleKeyFromRoot } from '../../src/kernel/vehicle-auth-client';
import { vehicleChannelOf } from '../../src/kernel/vehicle-auth-config';
import { actor, bootApp, killV2 } from '../helpers';

const ROOT = randomBytes(32);
const ENV = ['FF_VEHICLE_CHANNEL', 'FF_VEHICLE_AUTH', 'FF_HSM_VEHICLE_ROOT'];
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');

type Boot = Awaited<ReturnType<typeof bootApp>>;

/** 차량 쪽 클라이언트 — 공장에서 받은 차량 키로 서명하고, 플랫폼 공개키(신뢰 앵커)로 게시본을 직접 검증한다 */
function vehicle(b: Boot, vin: string) {
  const key = vehicleKeyFromRoot(ROOT, 1, vin);
  const now = () => b.get(Clock).now().getTime();
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers = signVehicleRequest({ vehicleKey: key, vin, epoch: 1, method, path, body: text, now: now() });
    const req = method === 'GET' ? b.http().get(path).set(headers) : b.http().post(path).set({ ...headers, 'content-type': 'application/json' }).send(text ?? '');
    return req;
  };
  return {
    inbox: () => call('GET', `/vehicle/v1/${vin}/inbox`),
    ack: (deliveryId: string, body: Record<string, unknown>) => call('POST', `/vehicle/v1/${vin}/inbox/${deliveryId}/ack`, body),
    call,
  };
}

describe('차량 당겨받기 채널(pull) — 서명된 전달함과 서명한 확인', () => {
  let b: Boot;
  let anchors: { keyId: string; publicKeyPem: string }[];
  const pub = async (id: string) => (await b.http().get(`/api/publications/${id}`).expect(200)).body;
  const advance = (ms: number) => {
    const clock = b.get(Clock);
    const until = clock.now().getTime() + ms;
    b.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  /** 차량의 검증 — 신뢰 앵커의 공개키로 payloadHash 서명, 본문 해시 일치 */
  const vehicleVerifies = (p: Pick<Publication, 'payload' | 'signature'>) => {
    const k = anchors.find((a) => a.keyId === p.signature.keyId);
    return !!k && payloadHash(p.payload) === p.signature.payloadHash && verify(null, Buffer.from(p.signature.payloadHash), createPublicKey(k.publicKeyPem), Buffer.from(p.signature.signature, 'base64'));
  };

  beforeAll(async () => {
    Object.assign(process.env, { FF_VEHICLE_CHANNEL: 'pull', FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: ROOT.toString('base64') });
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    anchors = (await b.http().get('/api/pki/keys').expect(200)).body.items;
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of [...ENV, 'FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it('채널 상태 — 고른 어댑터는 pull, 시뮬레이터(sim)도 어댑터로 등록돼 있다', async () => {
    const r = await b.http().get('/api/vehicle-channel').expect(200);
    expect(r.body.active).toBe('pull');
    expect(r.body.adapters.map((a: any) => a.id).sort()).toEqual(['pull', 'sim']);
    expect(r.body.adapters.find((a: any) => a.id === 'pull')).toMatchObject({ active: true, status: { pending: expect.any(Number) } });
  });

  let pubId: string;
  it('정책 배포 → 대상 차량 전달함에 서명 게시본, 시뮬레이터는 회신하지 않는다(실제 차량이 확인할 때까지 대기)', async () => {
    const c = await b.http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    await b.http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    expect((await b.http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    await b.http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    pubId = (await b.http().post(`/api/policies/${c.body.policyId}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200)).body.publicationId;
    advance(5_000); // 시뮬레이터였다면 이 사이에 회신했다
    const p = await pub(pubId);
    expect(p.publication.status).toBe('DISPATCHED');
    expect(p.publication.confirmed).toBe(0);
    expect(p.readbacks).toEqual([]);
  });

  it('차량이 서명한 요청으로 전달함을 받아 가 직접 검증 → 적용 확인 → 그 차량이 CONFIRMED, 전달함에서 빠진다', async () => {
    const v = vehicle(b, 'KMH-NX4-0002');
    const box = await v.inbox();
    expect(box.status).toBe(200);
    const item = box.body.items.find((i: any) => i.publication.publicationId === pubId);
    expect(item).toMatchObject({ deliveryId: expect.stringMatching(/^DLV-/), fetchCount: 1, envelope: null });
    expect(vehicleVerifies(item.publication)).toBe(true);
    // 받아 가도 확인 전에는 다시 나온다(차량 재시작·통신 끊김)
    expect((await v.inbox()).body.items.find((i: any) => i.deliveryId === item.deliveryId).fetchCount).toBe(2);

    const ack = { bootId: 'BOOT-KMH-NX4-0002-7', result: 'APPLIED', observed: item.publication.payload.policy.contentHash, policyHash: item.publication.signature.payloadHash };
    const r = await v.ack(item.deliveryId, ack);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: 'ACCEPTED', publicationId: pubId, statusReport: 'NONE', readback: { observed: ack.observed } });
    const p = await pub(pubId);
    expect(p.publication.nodes.find((n: any) => n.nodeId === 'KMH-NX4-0002')).toMatchObject({ state: 'CONFIRMED' });
    expect(p.readbacks.find((x: any) => x.vin === 'KMH-NX4-0002')).toMatchObject({ via: 'IF-06', bootId: 'BOOT-KMH-NX4-0002-7' });
    expect((await v.inbox()).body.items.find((i: any) => i.deliveryId === item.deliveryId)).toBeUndefined();

    // 같은 확인 재시도는 같은 응답, 다른 내용은 409
    expect((await v.ack(item.deliveryId, ack)).body.outcome).toBe('DUPLICATE');
    expect((await v.ack(item.deliveryId, { ...ack, result: 'REJECTED', rejectReason: 'REPLAY', observed: undefined })).status).toBe(409);
  });

  it('차량 Guard 거부도 확인으로 — 거부 사유가 노드에 보이고 게시본은 닫히지 않는다', async () => {
    const v = vehicle(b, 'KMH-NX4-0001');
    const item = (await v.inbox()).body.items.find((i: any) => i.publication.publicationId === pubId);
    const r = await v.ack(item.deliveryId, { bootId: 'BOOT-KMH-NX4-0001-1', result: 'REJECTED', rejectReason: 'PAYLOAD_TAMPERED', policyHash: item.publication.signature.payloadHash });
    expect(r.status).toBe(200);
    const p = await pub(pubId);
    expect(p.publication.status).toBe('DISPATCHED');
    expect(p.publication.nodes.find((n: any) => n.nodeId === 'KMH-NX4-0001')).toMatchObject({ state: 'UNKNOWN', reason: 'REJECTED:PAYLOAD_TAMPERED' });
  });

  it('남의 전달함·남의 전달 확인·서명 없는 조회는 거부', async () => {
    const other = vehicle(b, 'KMH-NX4-0004');
    const steal = await other.call('GET', '/vehicle/v1/KMH-NX4-0002/inbox');
    expect(steal.status).toBe(403);
    expect(steal.body.error.code).toBe('VEHICLE_SCOPE');
    const theirs = (await vehicle(b, 'lead-01').inbox()).body.items[0];
    expect(theirs).toBeTruthy();
    expect((await other.ack(theirs.deliveryId, { bootId: 'B', result: 'APPLIED', observed: 'x', policyHash: theirs.publication.signature.payloadHash })).status).toBe(404); // 다른 차량의 전달 ID
    expect((await b.http().get('/vehicle/v1/KMH-NX4-0002/inbox').set({ 'X-Vehicle-Id': 'KMH-NX4-0002' })).status).toBe(401);
  });

  it('긴급 차단 — 전달함에 이 차량의 kill_command v2 봉투가 함께 오고, 확인 뒤 끝 상태는 서명된 상태 보고로', async () => {
    const k = await killV2(b.http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '당겨받기 채널 차단 시험', confirm: 'FEAT-00022' });
    anchors = (await b.http().get('/api/pki/keys').expect(200)).body.items; // 차단 용도 키는 처음 쓸 때 생긴다 — 신뢰 앵커 다시 받기(실차는 공장 주입 묶음)
    const v = vehicle(b, 'ego-01');
    const item = (await v.inbox()).body.items.find((i: any) => i.publication.kind === 'KILL' && i.publication.payload.kill?.killId === k.killId);
    expect(item.envelope).toMatchObject({ type: 'kill_command', request: 'deactivate', vehicle_auth: { cmd_auth: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) } });
    expect(vehicleVerifies(item.publication)).toBe(true);
    const r = await v.ack(item.deliveryId, { bootId: 'BOOT-ego-01-1', result: 'APPLIED', observed: 'DEACT_WARNING', policyHash: item.publication.signature.payloadHash });
    expect(r.body).toMatchObject({ outcome: 'ACCEPTED', statusReport: 'REQUIRED', readback: null });
  });

  it('회신 기한까지 확인하지 않은 차량은 무회신(NO_REPORT)', async () => {
    advance(60 * 60_000);
    const p = await pub(pubId);
    expect(p.publication.closedAt).not.toBeNull();
    expect(p.publication.nodes.find((n: any) => n.nodeId === 'ego-01')).toMatchObject({ state: 'UNKNOWN' });
  });
});

describe('채널 선택 — 운영 모드는 실제 채널, 시뮬레이터는 데모·시험에서만', () => {
  afterAll(() => {
    for (const k of ENV) delete process.env[k];
  });

  it('운영 모드 기본은 pull, sim을 고르면 시작 검사가 거부, 이름 형식', () => {
    expect(vehicleChannelOf({ FF_ENV: 'production' })).toBe('pull');
    expect(vehicleChannelOf({})).toBe('sim');
    expect(runtimeConfigProblems({ FF_ENV: 'production', FF_VEHICLE_CHANNEL: 'sim' }).join('\n')).toMatch(/FF_VEHICLE_CHANNEL=sim/);
    expect(runtimeConfigProblems({ FF_ENV: 'production' }).join('\n')).not.toMatch(/FF_VEHICLE_CHANNEL/);
    expect(runtimeConfigProblems({ FF_VEHICLE_CHANNEL: 'Bad Name' }).join('\n')).toMatch(/FF_VEHICLE_CHANNEL/);
  });

  it('등록되지 않은 채널 이름이면 시작하지 않는다(오타로 차량에 아무것도 가지 않는 일 방지)', async () => {
    process.env.FF_VEHICLE_CHANNEL = 'oem-telematics';
    await expect(bootApp()).rejects.toThrow(/FF_VEHICLE_CHANNEL=oem-telematics[\s\S]*등록됨: (sim, pull|pull, sim)/);
    delete process.env.FF_VEHICLE_CHANNEL;
  });

  it('고객 텔레매틱스 게이트웨이 어댑터 — VehicleDeliveryAdapter를 등록하고 이름으로 고른다', () => {
    process.env.FF_VEHICLE_CHANNEL = 'oem-telematics';
    const reg = new VehicleChannelRegistry();
    const sent: string[][] = [];
    reg.register({ id: 'sim', description: 'sim', deliver: () => ({ ackOnly: [] }) });
    reg.register({ id: 'oem-telematics', description: 'OEM 게이트웨이(예: MQTT 브로커)', deliver: (_p, vins) => (sent.push(vins), { ackOnly: vins.slice(0, 1) }) });
    expect(() => reg.onModuleInit()).not.toThrow();
    expect(reg.current().deliver({} as Publication, ['V1', 'V2'])).toEqual({ ackOnly: ['V1'] });
    expect(sent).toEqual([['V1', 'V2']]);
    expect(() => reg.register({ id: 'sim', description: 'x', deliver: () => ({ ackOnly: [] }) })).toThrow(/이미 등록/);
    delete process.env.FF_VEHICLE_CHANNEL;
  });
});

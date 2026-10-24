// 차량 요청 인증 — X-Vehicle-Id 머리글만으로는 차량이 아니다. 차량 키에서 파생한 요청 CMAC(본문·시각·nonce) 또는 신뢰 프록시의 mTLS 주체.
// readiness: RD-SEC-08
// 서명 없음·서명 불일치·재전송·다른 VIN 흉내·시각 밖·지난 epoch는 401 + 감사 DENIED + 보안 이벤트(VIN은 가명). 데모 모드는 머리글만도 받는다.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { DB, type Db } from '../../src/kernel/db';
import { runtimeConfigProblems } from '../../src/kernel/runtime-config';
import { signVehicleRequest, vehicleKeyFromRoot } from '../../src/kernel/vehicle-auth-client';
import { vehicleAuthModeOf } from '../../src/kernel/vehicle-auth-config';
import { subjectVin } from '../../src/kernel/vehicle-auth';
import request from 'supertest';
import { createApp } from '../../src/app.factory';
import { bootApp } from '../helpers';

const ROOT = randomBytes(32);
const VIN = 'KMH-NX4-0002';
const ENV = ['FF_VEHICLE_AUTH', 'FF_HSM_VEHICLE_ROOT', 'FF_VEHICLE_CERT_HEADER'];

/** 차량 쪽 — 공장에서 받은 차량 키(루트에서 파생한 값)만으로 서명한다. 플랫폼 HSM 코드를 쓰지 않는다 */
const sign = (vin: string, method: string, path: string, body?: unknown, o: { now?: number; epoch?: number; keyVin?: string; nonce?: string } = {}) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const epoch = o.epoch ?? 1;
  return { text, headers: signVehicleRequest({ vehicleKey: vehicleKeyFromRoot(ROOT, epoch, o.keyVin ?? vin), vin, epoch, method, path, body: text, now: o.now, nonce: o.nonce }) };
};

type Boot = Awaited<ReturnType<typeof bootApp>>;
const reasonOf = (r: { body: any }) => r.body.error?.details?.code;

describe('운영 방식(required) — 서명된 차량 요청만', () => {
  let b: Boot;
  beforeAll(async () => {
    Object.assign(process.env, { FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: ROOT.toString('base64'), FF_VEHICLE_CERT_HEADER: 'x-client-cert-subject' });
    b = await bootApp();
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ENV) delete process.env[k];
  });
  const post = (path: string, s: { text?: string; headers: Record<string, string> }) => b.http().post(path).set({ ...s.headers, 'content-type': 'application/json' }).send(s.text ?? '');
  const securityEvents = async () => (await b.http().get('/api/security-events').set({ 'X-Actor-Id': 'usr-csm', 'X-Actor-Role': 'SECURITY_OFFICER' }).expect(200)).body.items;
  const denied = (target: string) => b.get<Db>(DB).all<{ reason: string }>("SELECT reason FROM audit WHERE action = 'VEHICLE_REQUEST_AUTH' AND result = 'DENIED' AND target = ? ORDER BY id", target).map((r) => r.reason);

  it('서명한 조회·보고는 받는다(본문·쿼리 경로까지 묶인다)', async () => {
    const path = `/vehicle/v1/${VIN}/flags`;
    expect((await post(path, sign(VIN, 'POST', path, {}))).status).toBe(200);
    const rp = `/vehicle/v1/${VIN}/reports`;
    const hello = { type: 'HELLO', bootId: 'BOOT-auth-1', sequence: 0, observedAt: new Date().toISOString(), highest: {} };
    const r = await post(rp, sign(VIN, 'POST', rp, hello));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ vin: VIN, type: 'HELLO', outcome: 'ACCEPTED' });
  });

  it('머리글(X-Vehicle-Id)만 — 401 REQUEST_AUTH_MISSING, 감사 DENIED, 보안 이벤트(가명)', async () => {
    const path = '/vehicle/v1/KMH-NX4-0003/flags';
    const r = await b.http().post(path).set({ 'X-Vehicle-Id': 'KMH-NX4-0003' }).send({});
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('VEHICLE_UNAUTHENTICATED');
    expect(reasonOf(r)).toBe('REQUEST_AUTH_MISSING');
    expect(denied(path)[0]).toMatch(/^REQUEST_AUTH_MISSING/);
    const ev = (await securityEvents()).find((e: any) => e.code === 'REQUEST_AUTH_MISSING');
    expect(ev).toMatchObject({ eventId: 'AUTH_FAILURE', vehicle: vehiclePseudonym('KMH-NX4-0003') });
    expect(JSON.stringify(ev)).not.toContain('KMH-NX4-0003'); // 포렌식 기록에 VIN 없음
  });

  it('서명 뒤 본문을 바꾸면 401 REQUEST_MAC_INVALID', async () => {
    const path = `/vehicle/v1/${VIN}/reports`;
    const body = { type: 'FAULT', bootId: 'BOOT-auth-1', sequence: 1, observedAt: new Date().toISOString(), featureId: 'FEAT-00022', code: 'X', severity: 'INFO' };
    const s = sign(VIN, 'POST', path, body);
    const r = await post(path, { headers: s.headers, text: JSON.stringify({ ...body, severity: 'CRITICAL' }) });
    expect(r.status).toBe(401);
    expect(reasonOf(r)).toBe('REQUEST_MAC_INVALID');
    // 경로를 바꿔도(다른 창구로 옮겨 쓰기) 불일치
    const s2 = sign(VIN, 'POST', `/vehicle/v1/${VIN}/flags`, {});
    expect(reasonOf(await post(`/vehicle/v1/${VIN}/flags/care_00022_param`, s2))).toBe('REQUEST_MAC_INVALID');
  });

  it('같은 요청을 다시 보내면(재전송) 401 REQUEST_REPLAY — 보안 이벤트 재전송·순번 이상', async () => {
    const path = `/vehicle/v1/${VIN}/flags`;
    const s = sign(VIN, 'POST', path, {});
    expect((await post(path, s)).status).toBe(200);
    const again = await post(path, s);
    expect(again.status).toBe(401);
    expect(reasonOf(again)).toBe('REQUEST_REPLAY');
    expect((await securityEvents()).find((e: any) => e.code === 'REQUEST_REPLAY')).toMatchObject({ eventId: 'REPLAY_SEQUENCE' });
  });

  it('다른 VIN 흉내 — 내 키로 남의 VIN을 주장하면 서명 불일치, 내 VIN으로 남의 경로를 부르면 403 VEHICLE_SCOPE', async () => {
    const victim = 'ego-01';
    const path = `/vehicle/v1/${victim}/flags`;
    const forged = sign(victim, 'POST', path, {}, { keyVin: VIN }); // 공격 차량(VIN)의 키로 ego-01이라고 서명
    const r = await post(path, forged);
    expect(r.status).toBe(401);
    expect(reasonOf(r)).toBe('REQUEST_MAC_INVALID');
    const scope = await post(path, sign(VIN, 'POST', path, {}));
    expect(scope.status).toBe(403);
    expect(scope.body.error.code).toBe('VEHICLE_SCOPE');
  });

  it('시각이 허용 범위(±5분) 밖이면 401 REQUEST_TIME_SKEW, 지난 key epoch면 REQUEST_KEY_EPOCH(현재 epoch 안내)', async () => {
    const path = `/vehicle/v1/${VIN}/flags`;
    const old = await post(path, sign(VIN, 'POST', path, {}, { now: Date.now() - 10 * 60_000 }));
    expect(old.status).toBe(401);
    expect(reasonOf(old)).toBe('REQUEST_TIME_SKEW');
    const future = await post(path, sign(VIN, 'POST', path, {}, { now: Date.now() + 10 * 60_000 }));
    expect(reasonOf(future)).toBe('REQUEST_TIME_SKEW');
    const ep = await post(path, sign(VIN, 'POST', path, {}, { epoch: 2 }));
    expect(ep.status).toBe(401);
    expect(ep.body.error.details).toMatchObject({ code: 'REQUEST_KEY_EPOCH', currentEpoch: 1 });
    const bad = await b.http().post(path).set({ 'X-Vehicle-Id': VIN, 'X-Vehicle-Mac': 'x' }).send({});
    expect(reasonOf(bad)).toBe('REQUEST_AUTH_MALFORMED');
  });

  it('진위 실패가 같은 차량 10분 3건이면 VSOC 경보 + 그 차량 상태 보고 채널 제한', async () => {
    const vin = 'KMH-NX4-0004';
    const path = `/vehicle/v1/${vin}/flags`;
    for (let i = 0; i < 3; i++) expect((await post(path, sign(vin, 'POST', path, {}, { keyVin: 'KMH-NX4-0001' }))).status).toBe(401);
    const sp = `/vehicle/v1/${vin}/status`;
    const limited = await post(sp, sign(vin, 'POST', sp, {}));
    expect(limited.status).toBe(429);
    expect(limited.body.error.details).toMatchObject({ code: 'CHANNEL_LIMITED' });
  });

  it('mTLS — 신뢰 프록시의 인증서 주체(CN)가 차량 신원, X-Vehicle-Id와 다르면 거부, 신뢰하지 않는 경로의 머리글은 거부', async () => {
    const express = b.app.getHttpAdapter().getInstance();
    const path = `/vehicle/v1/${VIN}/flags`;
    express.set('trust proxy', 'loopback');
    expect((await b.http().post(path).set({ 'x-client-cert-subject': `CN=${VIN},O=OEM Vehicles,C=KR` }).send({})).status).toBe(200);
    const mismatch = await b.http().post(path).set({ 'x-client-cert-subject': `CN=${VIN}`, 'X-Vehicle-Id': 'ego-01' }).send({});
    expect(mismatch.status).toBe(401);
    expect(reasonOf(mismatch)).toBe('REQUEST_IDENTITY_MISMATCH');
    // 둘 다 오면 둘 다 확인 — 인증서는 맞아도 서명이 틀리면 거부
    const both = sign(VIN, 'POST', path, {}, { keyVin: 'ego-01' });
    expect(reasonOf(await b.http().post(path).set({ ...both.headers, 'x-client-cert-subject': `CN=${VIN}`, 'content-type': 'application/json' }).send(both.text!))).toBe('REQUEST_MAC_INVALID');
    express.set('trust proxy', false);
    const spoof = await b.http().post(path).set({ 'x-client-cert-subject': `CN=${VIN}` }).send({});
    expect(spoof.status).toBe(401);
    expect(reasonOf(spoof)).toBe('REQUEST_PROXY_UNTRUSTED');
  });

  it('플랫폼 HSM의 차량 키와 공장 주입 키가 같다(차량은 루트가 아니라 차량 키만 가진다)', () => {
    const p = b.get(HsmService).factoryProvision(VIN);
    expect(p.epoch).toBe(1);
    expect(p.vehicleKey.equals(vehicleKeyFromRoot(ROOT, 1, VIN))).toBe(true);
  });
});

describe('main.ts와 같은 조립(createApp — 원문 본문·빈 본문 처리·보안 미들웨어) — 서명 확인이 같다', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    Object.assign(process.env, { FF_DB: ':memory:', FF_SEED: 'v0.81', FF_VEHICLE_AUTH: 'required', FF_HSM_VEHICLE_ROOT: ROOT.toString('base64') });
    app = await createApp({ logger: false });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    for (const k of ENV) delete process.env[k];
  });

  it('본문 없는 GET(빈 본문 해시)·JSON 본문 POST 모두 원문 바이트로 확인, 본문을 바꾸면 거부', async () => {
    const http = () => request(app.getHttpServer());
    const ip = `/vehicle/v1/${VIN}/inbox`;
    expect((await http().get(ip).set(sign(VIN, 'GET', ip).headers)).status).toBe(200);
    const fp = `/vehicle/v1/${VIN}/flags`;
    const s = sign(VIN, 'POST', fp, { context: { targetingKey: VIN } });
    expect((await http().post(fp).set({ ...s.headers, 'content-type': 'application/json' }).send(s.text!)).status).toBe(200);
    const t = sign(VIN, 'POST', fp, {});
    const r = await http().post(fp).set({ ...t.headers, 'content-type': 'application/json' }).send('{ }'); // 같은 JSON, 다른 바이트
    expect(r.status).toBe(401);
    expect(r.body.error.details.code).toBe('REQUEST_MAC_INVALID');
  });
});

describe('데모 방식 — 머리글만도 받되, 서명 머리글이 오면 똑같이 확인', () => {
  let b: Boot;
  beforeAll(async () => {
    process.env.FF_HSM_VEHICLE_ROOT = ROOT.toString('base64');
    b = await bootApp();
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ENV) delete process.env[k];
  });

  it('X-Vehicle-Id만 → 200, 머리글 없음 → 401, 틀린 서명 → 401', async () => {
    const path = `/vehicle/v1/${VIN}/flags`;
    expect((await b.http().post(path).set({ 'X-Vehicle-Id': VIN }).send({})).status).toBe(200);
    expect((await b.http().post(path).send({})).status).toBe(401);
    const s = sign(VIN, 'POST', path, {}, { keyVin: 'ego-01' });
    const r = await b.http().post(path).set({ ...s.headers, 'content-type': 'application/json' }).send(s.text!);
    expect(r.status).toBe(401);
    expect(r.body.error.details.code).toBe('REQUEST_MAC_INVALID');
  });
});

describe('설정', () => {
  it('운영 모드 기본은 required, demo로 낮추면 시작 거부. 인증서 주체 머리글 이름 형식', () => {
    expect(vehicleAuthModeOf({ FF_ENV: 'production' })).toBe('required');
    expect(vehicleAuthModeOf({})).toBe('demo');
    expect(runtimeConfigProblems({ FF_ENV: 'production', FF_VEHICLE_AUTH: 'demo' }).join('\n')).toMatch(/FF_VEHICLE_AUTH=demo/);
    expect(runtimeConfigProblems({ FF_VEHICLE_CERT_HEADER: 'bad header!' }).join('\n')).toMatch(/FF_VEHICLE_CERT_HEADER/);
  });

  it('인증서 주체 해석 — RFC 2253·OpenSSL 슬래시·URL 인코딩, 이상한 값은 null', () => {
    expect(subjectVin('CN=KMH-NX4-0002,O=OEM')).toBe('KMH-NX4-0002');
    expect(subjectVin('/C=KR/O=OEM/CN=ego-01')).toBe('ego-01');
    expect(subjectVin(encodeURIComponent('CN=lead-01,OU=Vehicles'))).toBe('lead-01');
    expect(subjectVin('KMH-NX4-0002')).toBe('KMH-NX4-0002');
    expect(subjectVin('CN=../../etc')).toBeNull();
  });
});

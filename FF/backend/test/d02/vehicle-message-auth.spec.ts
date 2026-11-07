// TL-M02 — Lake가 중계한 차량 서명 메시지(FFV1-MSG)를 FF가 차량 키로 직접 검증한다(80-75 4.1). Lake는 신뢰 경계가 아니다.
// 가명 → VIN(등록 차량만), epoch → K_r, CMAC(상수 시간), 나이(미래 5분 거부·72시간 넘으면 STALE, 결정 U-15), nonce 창 72시간
// (같은 본문 = DUPLICATE 정상, 다른 본문 = REQUEST_REPLAY 보안 이벤트). 위조·변조·다른 종류 서명·FFV1-REQ 서명 재사용은 떨어진다.
import { VEHICLE_MESSAGE_MAX_AGE_MS, vehicleRequestCanonical, type VehicleMessage } from '@ff/contracts';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { Clock } from '../../src/kernel/clock';
import { aesCmac, sha256hex, vehiclePseudonym } from '../../src/kernel/crypto';
import { DB, type Db } from '../../src/kernel/db';
import { VehicleAuthService } from '../../src/kernel/vehicle-auth';
import { requestKeyOf, signVehicleMessage } from '../../src/kernel/vehicle-auth-client';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { bootApp } from '../helpers';

const ROOT = randomBytes(32);
const VIN = 'KMH-NX4-0002';
const OTHER = 'KMH-NX4-0003';
const AT = '2026-10-20T00:00:00.000Z';
const NOW = Date.parse(AT);
const HOUR = 3600_000;

const status = (seq: number) => JSON.stringify({ type: 'status_report', schema_version: '2.0', vehicle_pseudonym: vehiclePseudonym(VIN), report_seq: seq });
/** 차량 쪽 — 공장에서 주입받은 차량 키(모의 공장 주입)로만 서명한다 */
let hsm: HsmService;
const keyOf = (vin: string) => hsm.factoryProvision(vin);
const msg = (o: { vin?: string; keyVin?: string; body?: string; kind?: VehicleMessage['kind']; ref?: string | null; now?: number; nonce?: string; epoch?: number } = {}) =>
  signVehicleMessage({
    vehicleKey: keyOf(o.keyVin ?? o.vin ?? VIN).vehicleKey,
    vin: o.vin ?? VIN,
    epoch: o.epoch ?? keyOf(VIN).epoch,
    kind: o.kind ?? 'STATUS_REPORT',
    ref: o.ref ?? null,
    body: o.body ?? status(1),
    now: o.now ?? NOW - 2_000,
    nonce: o.nonce,
  });

type Boot = Awaited<ReturnType<typeof bootApp>>;

describe('FFV1-MSG 검증기(TL-M02)', () => {
  let b: Boot;
  let auth: VehicleAuthService;
  beforeAll(async () => {
    process.env.FF_HSM_VEHICLE_ROOT = ROOT.toString('base64');
    b = await bootApp({ at: AT });
    auth = b.get(VehicleAuthService);
    hsm = b.get(HsmService);
    b.get(Clock).set(AT);
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_HSM_VEHICLE_ROOT;
  });
  const securityCodes = () => b.get<Db>(DB).all<{ code: string; vehicle: string | null; doc: string }>('SELECT code, vehicle, doc FROM security_event ORDER BY id');
  const denied = () => b.get<Db>(DB).all<{ reason: string }>("SELECT reason FROM audit WHERE action = 'VEHICLE_MESSAGE_AUTH' AND result = 'DENIED' ORDER BY id").map((r) => r.reason);

  it('차량이 서명한 메시지는 받는다 — VIN·원문 바이트·나이를 돌려주고, 같은 메시지를 다시 받으면 DUPLICATE(보안 이벤트 없음)', () => {
    const m = msg({ nonce: 'nonce-accept-0000001' });
    const before = securityCodes().length;
    const r = auth.verifyMessage(m);
    expect(r).toMatchObject({ outcome: 'ACCEPTED', vin: VIN, code: null });
    expect(r.outcome === 'ACCEPTED' && r.body.toString('utf8')).toBe(status(1));
    expect(r.outcome === 'ACCEPTED' && r.ageMs).toBe(2_000);
    // 중계 재전송(최소 한 번) — 정상 경우
    expect(auth.verifyMessage(structuredClone(m))).toMatchObject({ outcome: 'DUPLICATE', vin: VIN, code: null });
    expect(securityCodes().length).toBe(before);
  });

  it('같은 nonce에 다른 본문 — REJECTED REQUEST_REPLAY + 보안 이벤트(가명) + 감사 DENIED', () => {
    auth.verifyMessage(msg({ nonce: 'nonce-replay-0000001', body: status(2) }));
    const r = auth.verifyMessage(msg({ nonce: 'nonce-replay-0000001', body: status(3) }));
    expect(r).toMatchObject({ outcome: 'REJECTED', vin: VIN, code: 'REQUEST_REPLAY' });
    const ev = securityCodes().at(-1)!;
    expect(ev).toMatchObject({ code: 'REQUEST_REPLAY', vehicle: vehiclePseudonym(VIN) });
    expect(ev.doc).not.toContain(VIN);
    expect(denied().at(-1)).toMatch(/^REQUEST_REPLAY/);
  });

  it('위조·변조 — 다른 차량 키(Lake·게이트웨이는 키가 없다), 서명 뒤 본문 바꿈(해시 다시 계산), 종류·ref 바꿈은 REQUEST_MAC_INVALID', () => {
    expect(auth.verifyMessage(msg({ keyVin: OTHER, nonce: 'nonce-forged-0000001' })).code).toBe('REQUEST_MAC_INVALID');
    const m = msg({ nonce: 'nonce-tamper-0000001' });
    const body = Buffer.from(status(99));
    const tampered = { ...m, body_b64: body.toString('base64'), body_sha256: sha256hex(body) };
    expect(auth.verifyMessage(tampered).code).toBe('REQUEST_MAC_INVALID');
    expect(auth.verifyMessage({ ...msg({ nonce: 'nonce-kind-00000001' }), kind: 'VEHICLE_REPORT' }).code).toBe('REQUEST_MAC_INVALID');
    const ack = msg({ kind: 'INBOX_ACK', ref: 'DLV-1', nonce: 'nonce-ref-000000001', body: '{}' });
    expect(auth.verifyMessage({ ...ack, ref: 'DLV-2' }).code).toBe('REQUEST_MAC_INVALID');
    expect(securityCodes().filter((e) => e.code === 'REQUEST_MAC_INVALID').length).toBeGreaterThanOrEqual(4);
  });

  it('FFV1-REQ 서명을 옮겨 쓰면 떨어진다 — 같은 키·같은 값이라도 머리말이 다르다', () => {
    const m = msg({ nonce: 'nonce-ffv1req-000001' });
    const reqMac = aesCmac(requestKeyOf(keyOf(VIN).vehicleKey), Buffer.from(vehicleRequestCanonical({ method: 'POST', path: `/vehicle/v1/${VIN}/status`, vin: VIN, keyEpoch: m.auth.key_epoch, timestamp: m.auth.timestamp, nonce: m.auth.nonce, bodySha256: m.body_sha256 }))).toString('base64url');
    expect(auth.verifyMessage({ ...m, auth: { ...m.auth, mac: reqMac } }).code).toBe('REQUEST_MAC_INVALID');
  });

  it('위조 메시지는 진짜 차량의 nonce를 먼저 태우지 못한다', () => {
    const nonce = 'nonce-burn-00000001';
    expect(auth.verifyMessage(msg({ keyVin: OTHER, nonce })).code).toBe('REQUEST_MAC_INVALID');
    expect(auth.verifyMessage(msg({ nonce })).outcome).toBe('ACCEPTED');
  });

  it('나이 — 72시간 안은 받고, 넘으면 STALE(보안 이벤트 아님·nonce를 쓰지 않음), 5분 넘게 미래면 REQUEST_TIME_SKEW', () => {
    expect(auth.verifyMessage(msg({ now: NOW - 71 * HOUR, nonce: 'nonce-age-71h-00001' })).outcome).toBe('ACCEPTED');
    const before = securityCodes().length;
    const stale = auth.verifyMessage(msg({ now: NOW - VEHICLE_MESSAGE_MAX_AGE_MS - 1, nonce: 'nonce-age-stale-0001' }));
    expect(stale).toMatchObject({ outcome: 'STALE', code: 'MESSAGE_STALE', vin: VIN });
    expect(securityCodes().length).toBe(before);
    expect(b.get<Db>(DB).get('SELECT 1 AS x FROM vehicle_message_nonce WHERE nonce = ?', 'nonce-age-stale-0001')).toBeUndefined();
    expect(auth.verifyMessage(msg({ now: NOW + 4 * 60_000, nonce: 'nonce-future-4m-0001' })).outcome).toBe('ACCEPTED');
    expect(auth.verifyMessage(msg({ now: NOW + 6 * 60_000, nonce: 'nonce-future-6m-0001' })).code).toBe('REQUEST_TIME_SKEW');
  });

  it('형식 — 스키마 밖·message_id ≠ <가명>:<nonce>·본문 해시 불일치는 MESSAGE_AUTH 층에서 떨어진다', () => {
    expect(auth.verifyMessage({ hello: 'world' }).code).toBe('MESSAGE_SCHEMA_INVALID');
    const m = msg({ nonce: 'nonce-format-000001' });
    expect(auth.verifyMessage({ ...m, vin: VIN }).code).toBe('MESSAGE_SCHEMA_INVALID');
    expect(auth.verifyMessage({ ...m, message_id: `${m.pseudonym}:nonce-other-0000001` }).code).toBe('MESSAGE_ID_MISMATCH');
    expect(auth.verifyMessage({ ...m, body_sha256: '0'.repeat(64) }).code).toBe('BODY_HASH_MISMATCH');
  });

  it('가명 → VIN — 등록되지 않은 가명은 UNKNOWN_VEHICLE, 키가 없는 epoch는 REQUEST_KEY_EPOCH', () => {
    const ghost = 'ZZZ-NOT-REGISTERED';
    expect(auth.verifyMessage(msg({ vin: ghost, nonce: 'nonce-ghost-0000001' }))).toMatchObject({ outcome: 'REJECTED', code: 'UNKNOWN_VEHICLE', vin: null });
    expect(auth.verifyMessage(msg({ epoch: 999, nonce: 'nonce-epoch-0000001' })).code).toBe('REQUEST_KEY_EPOCH');
  });

  it('차량 등록 때 가명이 이미 다른 VIN에 쓰이면 거부한다(가명 충돌)', () => {
    const fleet = b.get(FleetRepo);
    const v = { ...fleet.vehicle(VIN)!, vin: 'KMH-COLLIDE-0001' };
    expect(() => fleet.insertVehicle(v, () => vehiclePseudonym(VIN))).toThrow(/가명/);
    expect(fleet.vehicle('KMH-COLLIDE-0001')).toBeUndefined();
  });
});

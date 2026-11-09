// 차량 상태 보고 2.1 동시 수락(W — ADS-BE01·BE07·FFP-F031, D-ADS-1) — 2.0은 그대로 받고, 2.1은 판정·전달 단계·제어 책임·MRC를 ADS 상태에 투영한다.
// Feature epoch: 긴급 차단 뒤 늦게 도착한 과거 정책 게시본은 차단 상태와 무관하게 STALE_EPOCH(TC13). 재연결 대조: 서버 의도(epoch·종료 차단) vs 차량 보고.
// FFG-TEL-003 · FFG-ADS-004
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterEach, describe, expect, it } from 'vitest';
import { reportSeqOf, statusAuthCanonical } from '@ff/contracts';
import { vehiclePseudonym } from '../../src/kernel/crypto';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { DB, type Db } from '../../src/kernel/db';
import { HsmService } from '../../src/domains/d06-qsec/pki-kms/hsm.service';
import { PublicationRepo, RuntimeRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { SecureDeployService } from '../../src/domains/d06-qsec/secure-deploy/secure-deploy.service';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import type { Actor } from '../../src/kernel/actor';
import { bootApp, killV2, restoreV2 } from '../helpers';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});
async function boot() {
  const b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  close = () => b.app.close();
  const clock = b.get(Clock);
  const scheduler = b.get(Scheduler);
  const advance = (ms: number) => {
    const until = clock.now().getTime() + ms;
    scheduler.flush(ms);
    clock.set(new Date(until));
  };
  const hsm = b.get(HsmService);
  const sign = (vin: string, r: Record<string, any>) => ({ ...r, state_auth: hsm.cmac(vin, r.key_epoch, Buffer.from(statusAuthCanonical(r))) });
  const post = async (vin: string, r: Record<string, any>) => (await b.http().post(`/vehicle/v1/${vin}/status`).set({ 'X-Vehicle-Id': vin }).send(sign(vin, r)).expect(200)).body;
  return { ...b, advance, hsm, sign, post, clock, db: b.get<Db>(DB) };
}
const KILL = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: 'v2.1 차량 연결 시험', confirm: 'FEAT-00022' };
const ADS_VIN = 'KMH-GN7-0001';
const ADS_FEATURE = 'FEAT-00004';

/** 차단 → 수신(400 ms) → 끝 상태까지 — 마지막으로 받아들인 ego-01 보고 */
async function killed(b: Awaited<ReturnType<typeof boot>>) {
  const k = await killV2(b.http, KILL);
  b.advance(400);
  b.advance(8_000);
  const last = (await b.http().get('/api/vehicles/ego-01/status').expect(200)).body.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00022').report;
  return { k: (await b.http().get(`/api/kill-requests/${k.killId}`).expect(200)).body, last };
}

/** ADS 기능(FEAT-00004) 2.1 보고 — 원격 명령 없는 차량 자체(ONBOARD) 보고, 순번은 시동 1 안에서 n */
function adsReport(b: Awaited<ReturnType<typeof boot>>, n: number, secAfter: number, over: Record<string, unknown> = {}) {
  const version = b.get(FeatureRepo).versions(ADS_FEATURE).filter((f) => f.lifecycle === 'RELEASED').at(-1)!.version;
  const at = new Date(b.clock.now().getTime() + secAfter * 1000).toISOString();
  return {
    type: 'status_report',
    schema_version: '2.1',
    vehicle_pseudonym: vehiclePseudonym(ADS_VIN),
    feature: { id: ADS_FEATURE, version },
    state: 'ACTIVE',
    reason: { category: 'OPERATIONAL', source: 'ONBOARD' },
    request_result: 'NONE',
    vehicle_seq: 0,
    durable: true,
    hmi: 'NONE',
    feature_weight_permille: 1000,
    edr_aligned_state: 'ENGAGED_OR_ARMED',
    observed_at: at,
    time_sync: 'SYNCED',
    offline_since: null,
    data_category: 'SAFETY_OPERATION',
    key_epoch: b.hsm.epoch(),
    report_seq: reportSeqOf(1, n),
    persistence: 'DURABLE',
    reported_at: at,
    runtime_state: 'ACTIVE',
    ddt_owner: 'ADS',
    feature_epoch: 0,
    inhibits: [],
    ...over,
  };
}
const decision = (at: string, over: Record<string, unknown> = {}) => ({
  decision_id: '0b8d6c1e-2f3a-4b5c-9d7e-8f6a5b4c3d2e',
  action: 'ACTIVATE',
  verdict: 'ALLOW',
  reason_codes: [],
  input_quality: 'OK',
  odd_state: 'IN',
  inputs: [{ signal: 'lane.confidence', source: 'SENSOR', valid: true, trust: 'TRUSTED', local_ts: at, max_age_ms: 1000 }],
  valid_until: new Date(Date.parse(at) + 60_000).toISOString(),
  evaluated_state_digest: 'sha256:' + 'cd'.repeat(32),
  ...over,
});

describe('2.0·2.1 동시 수락', () => {
  it('시뮬 차량의 차단 회신은 2.1 — 실제 실행 TERMINATED·전달 단계 APPLIED·Feature epoch 1·종료 차단=사건별 Kill ID, 수신 시각 ≠ 적용 시각, 6축에는 가상 데이터로', async () => {
    const b = await boot();
    const { k, last } = await killed(b);
    expect(last).toMatchObject({ schema_version: '2.1', state: 'DISABLED', runtime_state: 'TERMINATED', feature_epoch: 1, inhibits: [k.killId], delivery: { subject_kind: 'KILL', subject_id: k.publicationId, stage: 'APPLIED' } });
    expect(Date.parse(last.received_at)).toBeLessThan(Date.parse(last.applied_at));
    const acks = b.db.all<{ stage: string; source: string }>("SELECT stage, source FROM delivery_ack WHERE subject_id = ? AND vin = 'ego-01' ORDER BY id", k.publicationId);
    expect(acks.map((a) => a.stage)).toEqual(['ACCEPTED', 'ACCEPTED', 'APPLIED']);
    expect(new Set(acks.map((a) => a.source))).toEqual(new Set(['SIMULATED']));
    const axes = (await b.http().get('/api/vehicles/ego-01/feature-state').expect(200)).body.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00022');
    expect(axes).toMatchObject({ simulated: true, runtime: { current: 'TERMINATED' }, freshness: { state: 'FRESH' } });
    // 재연결 대조 — 서버 의도와 같다
    const rc = (await b.http().get('/api/vehicles/ego-01/reconcile').expect(200)).body;
    expect(rc.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00022')).toMatchObject({ intent: { epoch: 1, inhibits: [k.killId] }, reported: { featureEpoch: 1 }, mismatches: [], unconfirmed: null });
  });

  it('회귀: 2.0 보고는 그대로 받아들이고 ADS 상태 투영(차량 보고 행)은 만들지 않는다', async () => {
    const b = await boot();
    const before = b.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM vehicle_feature_report WHERE vin = ?", ADS_VIN)!.n;
    const { reported_at: _r, runtime_state: _s, ddt_owner: _d, feature_epoch: _e, inhibits: _i, ...v20 } = adsReport(b, 1, 0, { schema_version: '2.0' });
    expect(await b.post(ADS_VIN, v20)).toMatchObject({ accepted: true, violation: null });
    expect(b.db.get<{ schema_version: string }>('SELECT schema_version FROM vehicle_feature_status WHERE vin = ? AND feature_id = ?', ADS_VIN, ADS_FEATURE)!.schema_version).toBe('2.0');
    expect(b.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vehicle_feature_report WHERE vin = ?', ADS_VIN)!.n).toBe(before);
  });
});

describe('Feature epoch (ADS-BE07 · TC13)', () => {
  it('KILL 뒤 늦게 도착한 과거 정책 게시본(차단 전 발행)은 STALE_EPOCH — 차단을 풀어도 다시 거부, 차단 뒤 발행한 게시본(epoch 실음)은 적용', async () => {
    const b = await boot();
    const { k } = await killed(b);
    const runtime = b.get(VehicleRuntimeService);
    const s = b.get(RuntimeRepo).get('ego-01');
    // 부팅 동기화 정책 게시본 — 차단 전에 발행됐고(epoch 없음) 수동 시계라 차단 뒤에 도착했다
    const stale = s.log.filter((l) => l.kind === 'POLICY' && l.detail === 'STALE_EPOCH');
    expect(stale.length).toBeGreaterThan(0);
    const old = b.get(PublicationRepo).get(stale[0].publicationId)!;
    expect(old.payload.featureId).toBe('FEAT-00022');
    expect(old.payload.featureEpochs).toBeUndefined();
    expect(Object.values(s.bundles).some((x) => x.publicationId === old.publicationId)).toBe(false);
    // 보안 사건이 아니다 — 보호 동작
    const sec = (await b.http().get('/api/anomalies?kind=SECURITY&featureId=FEAT-00022').expect(200)).body.items;
    expect(sec.flatMap((a: { signals: { code: string }[] }) => a.signals.map((x) => x.code))).not.toContain('STALE_EPOCH');
    // 차단을 풀어도(kill 상태와 무관) 과거 게시본은 다시 거부
    await restoreV2(b.http, k.killId);
    b.advance(10_000);
    expect(b.get(RuntimeRepo).get('ego-01').kills['FEAT-00022']).toBeUndefined();
    runtime.receive('ego-01', old);
    expect(b.get(RuntimeRepo).get('ego-01').log.at(-1)).toMatchObject({ publicationId: old.publicationId, result: 'REJECTED', detail: 'STALE_EPOCH' });
    // 차단 뒤 발행 — 지금 epoch(1)를 싣고 차량이 적용한다
    const db = b.db;
    const operator: Actor = { id: 'usr-operator', role: 'OPERATOR', correlationId: 'w-epoch' };
    const fresh = db.tx(() => b.get(SecureDeployService).publishPolicy(old.payload.policy!, operator));
    expect(fresh.payload.featureEpochs).toEqual({ 'FEAT-00022': 1 });
    b.advance(2_000);
    expect(b.get(RuntimeRepo).get('ego-01').bundles[old.payload.flagKey!].publicationId).toBe(fresh.publicationId);
  });
});

describe('판정·MRC·제어 책임 (ADS-BE01 · FFP-F031)', () => {
  it('ADS 보고열 ADS → UNKNOWN → MRC = 제어 책임 공백 1건(예산 값·출처·상태 기록) + 위급 이상 징후, 대조 화면 사건 목록에', async () => {
    const b = await boot();
    expect(await b.post(ADS_VIN, adsReport(b, 1, 0))).toMatchObject({ accepted: true });
    expect(await b.post(ADS_VIN, adsReport(b, 2, 0.5, { runtime_state: 'IN_TRANSITION', ddt_owner: 'UNKNOWN' }))).toMatchObject({ accepted: true });
    expect(await b.post(ADS_VIN, adsReport(b, 3, 1, { runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: new Date(b.clock.now().getTime() + 1000).toISOString(), hold_means: 'EPB', risk_mitigation_ref: 'RM-0001' } }))).toMatchObject({ accepted: true });
    const cases = b.db.all<{ kind: string; doc: string }>('SELECT kind, doc FROM ads_vehicle_case WHERE vin = ?', ADS_VIN);
    expect(cases.map((c) => c.kind)).toEqual(['RESPONSIBILITY_GAP']);
    expect(JSON.parse(cases[0].doc).detail).toMatchObject({ gap: 'OWNER_GAP', budgetMs: 2000, budgetSource: 'DEFAULT', budgetStatus: 'ASSUMED' });
    const ff = (await b.http().get(`/api/anomalies?kind=FEATURE_FAULT&featureId=${ADS_FEATURE}`).expect(200)).body.items;
    expect(ff[0]).toMatchObject({ severity: 'CRITICAL', vins: [ADS_VIN] });
    const axes = (await b.http().get(`/api/vehicles/${ADS_VIN}/feature-state`).expect(200)).body.features.find((f: { featureId: string }) => f.featureId === ADS_FEATURE);
    expect(axes).toMatchObject({ simulated: false, runtime: { current: 'MRC', ddtOwner: 'FALLBACK' } });
    expect((await b.http().get(`/api/vehicles/${ADS_VIN}/reconcile`).expect(200)).body.cases.map((c: { kind: string }) => c.kind)).toEqual(['RESPONSIBILITY_GAP']);
  });

  it('ADS → FALLBACK → MRC 연속이면 공백 0건, 정지 유지 수단이 없는 MRC는 미달성 사건 — 실제 실행은 MRC가 아닌 전환 중', async () => {
    const b = await boot();
    await b.post(ADS_VIN, adsReport(b, 1, 0));
    await b.post(ADS_VIN, adsReport(b, 2, 0.5, { runtime_state: 'IN_TRANSITION', ddt_owner: 'FALLBACK' }));
    expect(await b.post(ADS_VIN, adsReport(b, 3, 1, { runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: new Date(b.clock.now().getTime() + 1000).toISOString(), hold_means: null, risk_mitigation_ref: null } }))).toMatchObject({ accepted: true });
    expect(b.db.all<{ kind: string }>('SELECT kind FROM ads_vehicle_case WHERE vin = ?', ADS_VIN).map((c) => c.kind)).toEqual(['MRC_NOT_ACHIEVED']);
    const axes = (await b.http().get(`/api/vehicles/${ADS_VIN}/feature-state`).expect(200)).body.features.find((f: { featureId: string }) => f.featureId === ADS_FEATURE);
    expect(axes.runtime.current).toBe('IN_TRANSITION');
  });

  it('승인된 상태 프로필의 보고 간격 예산 — 종료 진행 중 예산을 넘긴 보고 간격은 공백 1건(APPROVED 표시)', async () => {
    const b = await boot();
    b.db.run("INSERT INTO feature_state_profile (feature_id, allowed_states, report_budget_ms, budget_status, updated_at) VALUES (?, ?, 500, 'APPROVED', ?)", ADS_FEATURE, JSON.stringify(['INACTIVE', 'AVAILABLE', 'ACTIVE', 'IN_TRANSITION', 'MRC', 'TERMINATED', 'RECOVERY_PENDING']), b.clock.iso());
    await b.post(ADS_VIN, adsReport(b, 1, 0));
    await b.post(ADS_VIN, adsReport(b, 2, 0.2, { runtime_state: 'IN_TRANSITION', ddt_owner: 'FALLBACK' }));
    await b.post(ADS_VIN, adsReport(b, 3, 1.5, { runtime_state: 'IN_TRANSITION', ddt_owner: 'FALLBACK' }));
    const c = b.db.all<{ doc: string }>('SELECT doc FROM ads_vehicle_case WHERE vin = ?', ADS_VIN).map((x) => JSON.parse(x.doc).detail);
    expect(c).toEqual([expect.objectContaining({ gap: 'REPORT_INTERVAL', intervalMs: 1300, budgetMs: 500, budgetSource: 'PROFILE', budgetStatus: 'APPROVED' })]);
  });

  it('비 ADS 기능(FEAT-00022, ADAS)의 MRC 보고는 대상 단계에서 거부', async () => {
    const b = await boot();
    const { last } = await killed(b);
    const { state_auth: _a, ...base } = last;
    const r = await b.post('ego-01', { ...base, report_seq: last.report_seq + 1, runtime_state: 'MRC', mrc: { reached_at: last.observed_at, hold_means: 'EPB', risk_mitigation_ref: 'RM-0001' } });
    expect(r).toMatchObject({ accepted: false, violation: { step: 'TARGET', code: 'MRC_NOT_ALLOWED' } });
  });

  it('노후 입력으로 허용 판정 → 위반(확인 집계 제외·위급 이상 징후), ODD 밖 거부는 ODD_OUT로 기록되고 과거 허용을 다시 쓰지 않는다(TC06)', async () => {
    const b = await boot();
    const at0 = new Date(b.clock.now().getTime()).toISOString();
    const staleInput = decision(at0, { inputs: [{ signal: 'lane.confidence', source: 'SENSOR', valid: true, trust: 'TRUSTED', local_ts: new Date(Date.parse(at0) - 5000).toISOString(), max_age_ms: 1000 }] });
    expect(await b.post(ADS_VIN, adsReport(b, 1, 0, { decision: staleInput }))).toMatchObject({ accepted: false, violation: { step: 'SCHEMA', code: 'ALLOW_WITH_INVALID_INPUT' } });
    const sec = (await b.http().get(`/api/anomalies?kind=SECURITY&featureId=${ADS_FEATURE}`).expect(200)).body.items;
    expect(sec[0]).toMatchObject({ severity: 'CRITICAL' });
    // 정상 허용 → ODD 밖 거부
    expect(await b.post(ADS_VIN, adsReport(b, 2, 0, { decision: decision(at0) }))).toMatchObject({ accepted: true });
    const at1 = new Date(b.clock.now().getTime() + 1000).toISOString();
    expect(await b.post(ADS_VIN, adsReport(b, 3, 1, { decision: decision(at1, { decision_id: '1c9e7d2f-3a4b-4c5d-8e6f-9a7b6c5d4e3f', verdict: 'DENY', odd_state: 'OUT', reason_codes: ['ODD_OUT'] }) }))).toMatchObject({ accepted: true });
    const v = (await b.http().get(`/api/vehicles/${ADS_VIN}/verdicts`).expect(200)).body.items.find((x: { featureId: string; action: string }) => x.featureId === ADS_FEATURE && x.action === 'ACTIVATE');
    expect(v).toMatchObject({ verdict: 'DENY', reasonCodes: ['ODD_OUT'], simulated: false });
    expect(b.db.get<{ decision_id: string; odd_state: string }>("SELECT decision_id, odd_state FROM safety_verdict WHERE vin = ? AND source = 'VEHICLE' ORDER BY id DESC LIMIT 1", ADS_VIN)).toEqual({ decision_id: '1c9e7d2f-3a4b-4c5d-8e6f-9a7b6c5d4e3f', odd_state: 'OUT' });
    const axes = (await b.http().get(`/api/vehicles/${ADS_VIN}/feature-state`).expect(200)).body.features.find((f: { featureId: string }) => f.featureId === ADS_FEATURE);
    expect(axes.eligibility.current).toBe('ODD_OUT');
  });

  it('허용 판정도 유효 기한(valid_until)이 지나면 현재 활성 적격으로 쓰지 않는다', async () => {
    const b = await boot();
    const at0 = b.clock.iso();
    await b.post(ADS_VIN, adsReport(b, 1, 0, { decision: decision(at0, { valid_until: new Date(Date.parse(at0) + 2000).toISOString() }) }));
    expect((await b.http().get(`/api/vehicles/${ADS_VIN}/feature-state`).expect(200)).body.features.find((f: { featureId: string }) => f.featureId === ADS_FEATURE).eligibility.current).toBe('ALLOW');
    b.advance(5_000);
    const axes = (await b.http().get(`/api/vehicles/${ADS_VIN}/feature-state`).expect(200)).body.features.find((f: { featureId: string }) => f.featureId === ADS_FEATURE);
    expect(axes.eligibility).toMatchObject({ current: null, past: 'ALLOW' });
  });
});

describe('재시동 복구·재연결 대조', () => {
  it('재부팅 보고의 inhibits_restored가 서버 차단 1건을 빠뜨림 → RESTORE_UNVERIFIED, 그 차량은 실제 실행 집계에서 빠지고, 오프라인 기간이면 대조에 불일치 1건·미확인 기간', async () => {
    const b = await boot();
    const { k, last } = await killed(b);
    const { state_auth: _a, delivery: _d, ...base } = last;
    const offline = new Date(b.clock.now().getTime() - 60_000).toISOString();
    b.advance(120_000);
    const obs = b.clock.iso();
    const r = await b.post('ego-01', {
      ...base,
      reason: { category: 'SAFETY', source: 'STARTUP' },
      request_result: 'NONE',
      report_seq: reportSeqOf((last.report_seq >>> 16) + 1, 1),
      observed_at: obs,
      reported_at: obs,
      offline_since: offline,
      inhibits: [],
      restore: { booted_at: obs, integrity: 'OK', inhibits_restored: [] },
    });
    expect(r).toMatchObject({ accepted: true, violation: null });
    const c = b.db.all<{ kind: string; doc: string }>("SELECT kind, doc FROM ads_vehicle_case WHERE vin = 'ego-01'");
    expect(c.map((x) => x.kind)).toEqual(['RESTORE_UNVERIFIED']);
    expect(JSON.parse(c[0].doc).detail).toMatchObject({ code: 'INHIBIT_NOT_RESTORED', missing: [k.killId] });
    const axes = (await b.http().get('/api/vehicles/ego-01/feature-state').expect(200)).body.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00022');
    expect(axes.runtime).toMatchObject({ current: null, past: 'TERMINATED' });
    const rc = (await b.http().get('/api/vehicles/ego-01/reconcile').expect(200)).body.features.find((f: { featureId: string }) => f.featureId === 'FEAT-00022');
    expect(rc.mismatches).toEqual([{ kind: 'INHIBIT_MISSING', ref: k.killId, expected: k.killId, reported: null }]);
    expect(rc.unconfirmed).toEqual({ from: offline, to: obs });
    expect((await b.http().get('/api/anomalies?kind=SECURITY&featureId=FEAT-00022').expect(200)).body.items[0].reasons.join(' ')).toContain('RESTORE_UNVERIFIED');
  });

  it('없는 차량의 재연결 대조는 404', async () => {
    const b = await boot();
    await b.http().get('/api/vehicles/NO-SUCH-VIN/reconcile').expect(404);
  });
});

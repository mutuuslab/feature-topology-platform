// GLEO 상태 보고 2.1 교차 언어 시험 벡터(ADS-SIM04 준비, D-ADS-1) — FF가 결정적으로 만들고(contracts/src/gleo-v2_1.vectors.json),
// FF_IMP(Python)가 2.1 동기 때 같은 입력으로 state_auth(JCS·AES-CMAC)·수신 판정·제어 책임 공백·재시동 복구·Feature epoch·재연결 대조를 직접 계산해 대조한다.
// 키는 v2 벡터(gleo-v2.vectors.json)와 같은 시험 전용 고정값. 손으로 고치지 않는다. 다시 만들기: UPDATE_VECTORS=1 npx vitest run test/d03/gleo-v2_1-vectors.spec.ts
// FFG-TEL-003 · FFG-ADS-004
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkStatusReport,
  defaultStateProfile,
  gleoMessageErrors,
  projectedRuntime,
  reconcileFeature,
  responsibilityGaps,
  restoreVerdict,
  staleEpoch,
  statusAuthCanonical,
  type OwnerObservation,
  type StatusCheckContext,
  type StatusReportV2_1,
} from '@ff/contracts';
import { aesCmac, hkdf16, vehiclePseudonym } from '../../src/kernel/crypto';

const FILE = join(__dirname, '..', '..', '..', 'contracts', 'src', 'gleo-v2_1.vectors.json');
const sha = (s: string) => createHash('sha256').update(s).digest();
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** 시험 전용 고정값 — v2 벡터와 같다(운영 키 아님) */
const ROOT = sha('ffp-test-vehicle-root-v1');
const EPOCH = 1;
const cmac = (vin: string, bytes: Buffer) => b64url(aesCmac(hkdf16(ROOT, `epoch:${EPOCH}`, `ffp-vehicle-key|${vin}`), bytes));

const T = (s: number) => new Date(Date.parse('2026-10-13T00:00:00Z') + s * 1000).toISOString();
const DECISION = {
  decision_id: '0b8d6c1e-2f3a-4b5c-9d7e-8f6a5b4c3d2e',
  action: 'ACTIVATE',
  verdict: 'ALLOW',
  reason_codes: [] as string[],
  input_quality: 'OK',
  odd_state: 'IN',
  inputs: [{ signal: 'lane.confidence', source: 'SENSOR', valid: true, trust: 'TRUSTED', local_ts: T(7.5), max_age_ms: 1000 }],
  valid_until: T(60),
  evaluated_state_digest: 'sha256:' + 'cd'.repeat(32),
};

function report(vin: string, over: Record<string, unknown> = {}) {
  const base = {
    type: 'status_report',
    schema_version: '2.1',
    vehicle_pseudonym: vehiclePseudonym(vin),
    feature: { id: 'FEAT-00004', version: '4.1.0' },
    state: 'ACTIVE',
    reason: { category: 'OPERATIONAL', source: 'ONBOARD' },
    request_result: 'NONE',
    vehicle_seq: 0,
    durable: true,
    hmi: 'NONE',
    feature_weight_permille: 1000,
    edr_aligned_state: 'ENGAGED_OR_ARMED',
    received_at: null,
    applied_at: null,
    observed_at: T(8),
    time_sync: 'SYNCED',
    offline_since: null,
    data_category: 'SAFETY_OPERATION',
    key_epoch: EPOCH,
    report_seq: (1 << 16) | 3,
    persistence: 'DURABLE',
    reported_at: T(8.1),
    runtime_state: 'ACTIVE',
    ddt_owner: 'ADS',
    feature_epoch: 1,
    inhibits: [],
    ...over,
  };
  const canonical = statusAuthCanonical(base);
  return { report: { ...base, state_auth: cmac(vin, Buffer.from(canonical)) } as unknown as StatusReportV2_1, canonical };
}

function build() {
  const ADS = defaultStateProfile('ADS');
  const ADAS = defaultStateProfile('ADAS');
  const ctx: StatusCheckContext = { authOk: true, lastReportSeq: (1 << 16) | 2, expectedVersion: '4.1.0', lastCommand: null, profile: ADS };
  const ok = report('ego-01', { decision: DECISION });
  const stale = report('ego-01', { decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], local_ts: T(5) }] } });
  const oddOut = report('ego-01', { decision: { ...DECISION, verdict: 'DENY', odd_state: 'OUT', reason_codes: ['ODD_OUT'] } });
  const oddWrongCode = report('ego-01', { decision: { ...DECISION, verdict: 'DENY', odd_state: 'OUT', reason_codes: ['INPUT_INVALID_OR_STALE'] } });
  const commercial = report('ego-01', { decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], signal: 'entitlement.state' }] } });
  const mrc = report('ego-01', { runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: T(8), hold_means: 'EPB', risk_mitigation_ref: 'RM-0001' } });
  const mrcHalf = report('ego-01', { runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: T(8), hold_means: null, risk_mitigation_ref: null } });
  const mrcAdas = report('ego-01', { feature: { id: 'FEAT-00022', version: '1.0.0' }, runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: T(8), hold_means: 'EPB', risk_mitigation_ref: 'RM-0001' } });
  const staleEpochReject = report('ego-01', { request_result: 'REJECTED', reject_code: 'STALE_EPOCH', delivery: { subject_kind: 'POLICY', subject_id: 'PUB-00001', stage: 'REJECTED', reason_code: 'STALE_EPOCH' } });
  const status = (name: string, r: ReturnType<typeof report>, c: StatusCheckContext, extra: Record<string, unknown> = {}) => ({
    name,
    vin: 'ego-01',
    report: r.report,
    state_auth_canonical: r.canonical,
    context: c,
    expected: { ...checkStatusReport(r.report, c), projected_runtime: projectedRuntime(r.report) },
    ...extra,
  });
  const o = (s: number, ddtOwner: OwnerObservation['ddtOwner'], runtimeState: OwnerObservation['runtimeState']): OwnerObservation => ({ at: T(s), ddtOwner, runtimeState });
  const gap = (name: string, seq: OwnerObservation[], budgetMs: number) => ({ name, sequence: seq, budget_ms: budgetMs, expected: responsibilityGaps(seq, budgetMs) });
  const restore = (name: string, i: Parameters<typeof restoreVerdict>[0]) => ({ name, input: i, expected: restoreVerdict(i) });
  const push = { type: 'policy_push', feature_id: 'FEAT-00022', action: 'enable', scope: { vehicle_ids: ['ego-01'] }, issued_at: T(0), reason: 'PUB-00001 care_00022_param' };
  return {
    _note: 'GLEO 상태 보고 2.1 교차 언어 시험 벡터(ADS-SIM04) — backend/test/d03/gleo-v2_1-vectors.spec.ts가 만든다(손으로 고치지 않는다). 키는 gleo-v2.vectors.json과 같은 시험 전용 고정값. 스키마 초안은 FF/harness/wire/status_report.v2_1.schema.json.',
    keys: { same_as: 'gleo-v2.vectors.json keys', epoch: EPOCH, pseudonym: { 'ego-01': vehiclePseudonym('ego-01') } },
    profiles: { ADS, ADAS },
    status_cases: [
      status('2.1 정상(허용 판정)', ok, ctx),
      status('노후 입력으로 허용 → 위반', stale, ctx),
      status('ODD 밖 거부(ODD_OUT)', oddOut, ctx),
      status('ODD 밖인데 사유가 입력 이상 → 위반', oddWrongCode, ctx),
      status('상업 상태를 판정 입력에 → 위반', commercial, ctx),
      status('ADS MRC 달성', mrc, ctx),
      status('ADS MRC 미달성(정지 유지 수단 없음) — 받되 실제 실행은 전환 중', mrcHalf, ctx),
      status('비 ADS 기능 MRC → 거부', mrcAdas, { ...ctx, expectedVersion: '1.0.0', profile: ADAS }),
      status('과거 정책 게시본 거부(STALE_EPOCH) 보고 — 조치는 새 게시본', staleEpochReject, ctx),
    ],
    gap_cases: [
      gap('ADS → UNKNOWN → MRC = 1건', [o(0, 'ADS', 'ACTIVE'), o(0.5, 'UNKNOWN', 'IN_TRANSITION'), o(1, 'NONE', 'MRC')], 2000),
      gap('ADS → FALLBACK → MRC = 0건', [o(0, 'ADS', 'ACTIVE'), o(0.5, 'FALLBACK', 'IN_TRANSITION'), o(1, 'FALLBACK', 'MRC')], 2000),
      gap('종료 진행 중 간격 초과 = 1건', [o(0, 'ADS', 'ACTIVE'), o(0.5, 'FALLBACK', 'IN_TRANSITION'), o(3.5, 'FALLBACK', 'IN_TRANSITION'), o(4, 'FALLBACK', 'MRC')], 2000),
    ],
    restore_cases: [
      restore('재시동 — 서버 차단 1건 빠뜨림', { newBoot: true, restore: { booted_at: T(100), integrity: 'OK', inhibits_restored: [] }, serverInhibits: ['ANM-00001'] }),
      restore('재시동 — 무결성 실패', { newBoot: true, restore: { booted_at: T(100), integrity: 'FAILED', inhibits_restored: ['ANM-00001'] }, serverInhibits: ['ANM-00001'] }),
      restore('재시동 — restore 없음', { newBoot: true, restore: undefined, serverInhibits: [] }),
      restore('재시동 — 검증', { newBoot: true, restore: { booted_at: T(100), integrity: 'OK', inhibits_restored: ['ANM-00001'] }, serverInhibits: ['ANM-00001'] }),
    ],
    epoch_cases: [
      { name: '차단 전 게시본(epoch 없음)이 차단 뒤 도착', policy_push: push, vehicle_seen_epoch: 1, expected_reject: staleEpoch(undefined, 1) ? 'STALE_EPOCH' : 'NONE', schema_errors: gleoMessageErrors(push) },
      { name: '차단 뒤 게시본(epoch 1)', policy_push: { ...push, feature_epoch: 1 }, vehicle_seen_epoch: 1, expected_reject: staleEpoch(1, 1) ? 'STALE_EPOCH' : 'NONE', schema_errors: gleoMessageErrors({ ...push, feature_epoch: 1 }) },
    ],
    reconcile_cases: [
      {
        name: '오프라인 중 서버 차단 → 재연결 보고에 차단 없음',
        intent: { epoch: 1, inhibits: ['ANM-00001'] },
        reported: { featureEpoch: 1, inhibits: [], observedAt: T(7200), offlineSince: T(3600) },
        expected: reconcileFeature({ epoch: 1, inhibits: ['ANM-00001'] }, { featureEpoch: 1, inhibits: [], observedAt: T(7200), offlineSince: T(3600) }),
      },
    ],
  };
}

describe('GLEO 상태 보고 2.1 교차 언어 시험 벡터', () => {
  it('파일이 재생성 결과와 같다(UPDATE_VECTORS=1이면 다시 쓴다)', () => {
    const fresh = JSON.stringify(build(), null, 2) + '\n';
    if (process.env.UPDATE_VECTORS === '1') writeFileSync(FILE, fresh);
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(fresh);
  });

  it('판정 기대값이 의도와 같다', () => {
    const v = build();
    expect(v.status_cases.map((c) => (c.expected.violation ? `${c.expected.violation.step}:${c.expected.violation.code}` : `ACCEPTED:${c.expected.projected_runtime}`))).toEqual([
      'ACCEPTED:ACTIVE',
      'SCHEMA:ALLOW_WITH_INVALID_INPUT',
      'ACCEPTED:ACTIVE',
      'SCHEMA:REASON_CODE_INCONSISTENT',
      'SCHEMA:COMMERCIAL_INPUT',
      'ACCEPTED:MRC',
      'ACCEPTED:IN_TRANSITION',
      'TARGET:MRC_NOT_ALLOWED',
      'ACCEPTED:ACTIVE',
    ]);
    expect(v.status_cases.at(-1)!.expected.action.kind).toBe('NEW_COMMAND');
    expect(v.gap_cases.map((g) => g.expected.length)).toEqual([1, 0, 1]);
    expect(v.restore_cases.map((r) => r.expected.code)).toEqual(['INHIBIT_NOT_RESTORED', 'INTEGRITY_FAILED', 'RESTORE_MISSING', null]);
    expect(v.epoch_cases.map((e) => [e.expected_reject, e.schema_errors.length])).toEqual([
      ['STALE_EPOCH', 0],
      ['NONE', 0],
    ]);
    expect(v.reconcile_cases[0].expected.mismatches.map((m) => m.kind)).toEqual(['INHIBIT_MISSING']);
  });
});

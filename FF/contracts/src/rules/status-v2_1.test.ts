// 상태 보고 2.1 계약(ADS-BE01·BE07·FFP-F031) — 2.0·2.1 동시 수락, 판정 입력 계약, MRC는 ADS만, 제어 책임 공백, 재시동 복구, Feature epoch, 재연결 대조.
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import { RUNTIME_STATES } from './ads-state';
import { checkStatusReport, type StatusCheckContext } from './status-v2';
import {
  contractViolationV21,
  defaultStateProfile,
  guardRuntimeState,
  mrcAchieved,
  projectedRuntime,
  reconcileFeature,
  responsibilityGaps,
  restoreVerdict,
  staleEpoch,
  type OwnerObservation,
} from './status-v2_1';
import { RUNTIME_STATES_V2_1, StatusReportV2_1, wireErrors, type StatusReportV2_1 as R21 } from '../schemas/wire';

const v20 = () => loadGuide('schema/examples/status_disabled.ok.json');
const DECISION = {
  decision_id: '0b8d6c1e-2f3a-4b5c-9d7e-8f6a5b4c3d2e',
  action: 'ACTIVATE',
  verdict: 'ALLOW',
  reason_codes: [],
  input_quality: 'OK',
  odd_state: 'IN',
  inputs: [{ signal: 'lane.confidence', source: 'SENSOR', valid: true, trust: 'TRUSTED', local_ts: '2026-10-13T00:01:09.500Z', max_age_ms: 1000 }],
  valid_until: '2026-10-13T00:01:20Z',
  evaluated_state_digest: 'sha256:' + 'cd'.repeat(32),
};
/** 2.0 예제 + 2.1 블록 — 서명 검사는 문맥(authOk)으로 대신한다 */
function v21(over: Record<string, unknown> = {}): R21 {
  return { ...v20(), schema_version: '2.1', reported_at: '2026-10-13T00:01:10.200Z', runtime_state: 'TERMINATED', ddt_owner: 'USER', feature_epoch: 1, inhibits: [], ...over } as R21;
}
const CTX: StatusCheckContext = { authOk: true, lastReportSeq: 0, expectedVersion: '1.0.0', lastCommand: { request: 'deactivate', vehicleSeq: 11 } };
const ADAS = defaultStateProfile('ADAS');
const ADS = defaultStateProfile('ADS');

describe('2.0·2.1 동시 수락', () => {
  it('2.0 보고는 그대로 받아들인다(회귀) — 2.1 문맥(profile)이 있어도', () => {
    expect(checkStatusReport(v20(), { ...CTX, profile: ADAS })).toMatchObject({ accepted: true, violation: null });
  });
  it('2.1 보고는 2.1 스키마로 검사해 받아들인다', () => {
    expect(wireErrors(StatusReportV2_1, v21())).toEqual([]);
    expect(checkStatusReport(v21(), { ...CTX, profile: ADAS })).toMatchObject({ accepted: true, violation: null });
  });
  it('2.1에 필수 블록(runtime_state·feature_epoch·inhibits·reported_at)이 없으면 스키마 위반, 2.0 보고에 2.1 필드가 있어도 위반', () => {
    const { runtime_state: _r, ...noRuntime } = v21();
    expect(checkStatusReport(noRuntime, CTX).violation).toMatchObject({ step: 'SCHEMA', code: 'SCHEMA' });
    expect(checkStatusReport({ ...v20(), feature_epoch: 1 }, CTX).violation).toMatchObject({ step: 'SCHEMA' });
  });
  it('2.1은 STALE_EPOCH 거부 코드를 실을 수 있고 조치는 새 게시본(보안 사건 아님), 2.0은 못 싣는다', () => {
    const r = checkStatusReport(v21({ request_result: 'REJECTED', reject_code: 'STALE_EPOCH' }), CTX);
    expect(r).toMatchObject({ accepted: true, action: { kind: 'NEW_COMMAND', security: false } });
    expect(checkStatusReport({ ...v20(), request_result: 'REJECTED', reject_code: 'STALE_EPOCH' }, CTX).violation?.step).toBe('SCHEMA');
  });
  it('실제 실행 상태 목록은 읽기 모델과 같다', () => {
    expect([...RUNTIME_STATES_V2_1]).toEqual([...RUNTIME_STATES]);
  });
});

describe('판정 입력 계약 (decision)', () => {
  it('노후 입력(관측 − 입력 시각 > 허용 나이) 또는 무효 입력이 하나라도 있으면 ALLOW 금지', () => {
    const stale = v21({ decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], local_ts: '2026-10-13T00:01:05Z' }] } });
    expect(checkStatusReport(stale, CTX).violation).toMatchObject({ step: 'SCHEMA', code: 'ALLOW_WITH_INVALID_INPUT' });
    const invalid = v21({ decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], valid: false }] } });
    expect(contractViolationV21(invalid)?.code).toBe('ALLOW_WITH_INVALID_INPUT');
    expect(contractViolationV21(v21({ decision: DECISION }))).toBeNull();
  });
  it('TC06 — ODD 밖 거부는 ODD_OUT, 입력 이상 거부는 INPUT_INVALID_OR_STALE로 따로 적는다(서로 바꿔 쓰면 위반)', () => {
    const oddOut = { ...DECISION, verdict: 'DENY', odd_state: 'OUT' };
    expect(contractViolationV21(v21({ decision: { ...oddOut, reason_codes: ['ODD_OUT'] } }))).toBeNull();
    expect(contractViolationV21(v21({ decision: { ...oddOut, reason_codes: ['INPUT_INVALID_OR_STALE'] } }))?.code).toBe('REASON_CODE_INCONSISTENT');
    const badInput = { ...DECISION, verdict: 'DENY', inputs: [{ ...DECISION.inputs[0], valid: false }] };
    expect(contractViolationV21(v21({ decision: { ...badInput, reason_codes: ['INPUT_INVALID_OR_STALE'] } }))).toBeNull();
    expect(contractViolationV21(v21({ decision: { ...badInput, reason_codes: ['ODD_OUT'] } }))?.code).toBe('REASON_CODE_INCONSISTENT');
    expect(contractViolationV21(v21({ decision: { ...DECISION, odd_state: 'UNKNOWN' } }))?.code).toBe('ALLOW_OUTSIDE_ODD');
  });
  it('상업 상태는 판정 입력이 아니다 — 출처 COMMERCIAL은 스키마가, entitlement 신호 이름은 계약 검사가 거부', () => {
    expect(wireErrors(StatusReportV2_1, v21({ decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], source: 'COMMERCIAL' }] } }))).not.toEqual([]);
    expect(contractViolationV21(v21({ decision: { ...DECISION, inputs: [{ ...DECISION.inputs[0], signal: 'entitlement.state' }] } }))?.code).toBe('COMMERCIAL_INPUT');
    expect(wireErrors(StatusReportV2_1, v21({ decision: DECISION, commercial: { entitlement_state: 'TRIAL', effective_at: '2026-10-13T00:00:00Z' } }))).toEqual([]);
  });
});

describe('MRC (FFP-F031)', () => {
  const MRC = { runtime_state: 'MRC', ddt_owner: 'FALLBACK', mrc: { reached_at: '2026-10-13T00:01:09Z', hold_means: 'EPB', risk_mitigation_ref: 'RM-001' } };
  it('비 ADS 기능의 MRC 보고는 대상 단계에서 거부, ADS 기능은 받는다', () => {
    expect(checkStatusReport(v21(MRC), { ...CTX, profile: ADAS }).violation).toMatchObject({ step: 'TARGET', code: 'MRC_NOT_ALLOWED' });
    expect(checkStatusReport(v21(MRC), { ...CTX, profile: ADS })).toMatchObject({ accepted: true });
  });
  it('정지 유지 수단·위험 저감 근거가 비면 MRC 미달성 — 읽기 모델은 MRC가 아닌 전환 중으로 센다(종료 완료와 MRC 별도)', () => {
    expect(mrcAchieved(v21(MRC))).toBe(true);
    const half = v21({ ...MRC, mrc: { ...MRC.mrc, hold_means: null } });
    expect(mrcAchieved(half)).toBe(false);
    expect(projectedRuntime(half)).toBe('IN_TRANSITION');
    expect(projectedRuntime(v21(MRC))).toBe('MRC');
    expect(projectedRuntime(v21())).toBe('TERMINATED');
  });
  it('Guard 상태 → 실제 실행 상태', () => {
    expect([guardRuntimeState('ACTIVE'), guardRuntimeState('DEACT_WARNING'), guardRuntimeState('DISABLED'), guardRuntimeState('RESTORE_PENDING')]).toEqual(['ACTIVE', 'IN_TRANSITION', 'TERMINATED', 'RECOVERY_PENDING']);
  });
});

describe('제어 책임 공백 (RESPONSIBILITY_GAP)', () => {
  const at = (s: number) => new Date(Date.parse('2026-10-13T00:00:00Z') + s * 1000).toISOString();
  const o = (s: number, ddtOwner: OwnerObservation['ddtOwner'], runtimeState: OwnerObservation['runtimeState']): OwnerObservation => ({ at: at(s), ddtOwner, runtimeState });
  it('ADS → UNKNOWN → MRC = 1건', () => {
    const g = responsibilityGaps([o(0, 'ADS', 'ACTIVE'), o(0.5, 'UNKNOWN', 'IN_TRANSITION'), o(1, 'NONE', 'MRC')], 2000);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ index: 1, kind: 'OWNER_GAP' });
  });
  it('ADS → FALLBACK → MRC 연속 = 0건', () => {
    expect(responsibilityGaps([o(0, 'ADS', 'ACTIVE'), o(0.5, 'FALLBACK', 'IN_TRANSITION'), o(1, 'FALLBACK', 'MRC')], 2000)).toEqual([]);
  });
  it('종료 진행 중 보고 간격 초과 = 1건(구간당 한 번), 정상 운행 중 간격은 세지 않는다', () => {
    const g = responsibilityGaps([o(0, 'ADS', 'ACTIVE'), o(60, 'ADS', 'ACTIVE'), o(60.5, 'FALLBACK', 'IN_TRANSITION'), o(63.5, 'FALLBACK', 'IN_TRANSITION'), o(70, 'FALLBACK', 'IN_TRANSITION'), o(70.5, 'FALLBACK', 'MRC')], 2000);
    expect(g).toEqual([{ index: 3, kind: 'REPORT_INTERVAL', at: at(63.5), episodeStart: at(60.5), intervalMs: 3000 }]);
  });
  it('운전자 인계(USER)로 구간이 끝나면 뒤 보고는 세지 않는다', () => {
    expect(responsibilityGaps([o(0, 'ADS', 'ACTIVE'), o(1, 'USER', 'IN_TRANSITION'), o(9, 'NONE', 'IN_TRANSITION')], 2000)).toEqual([]);
  });
});

describe('재시동 복구 (RESTORE_UNVERIFIED)', () => {
  const restore = (over: Record<string, unknown> = {}) => ({ booted_at: '2026-10-13T00:01:00Z', integrity: 'OK' as const, inhibits_restored: ['ANM-00001'], ...over });
  it('재시동 뒤 inhibits_restored가 서버 차단 1건을 빠뜨리면 미검증', () => {
    expect(restoreVerdict({ newBoot: true, restore: restore({ inhibits_restored: [] }), serverInhibits: ['ANM-00001'] })).toMatchObject({ verified: false, code: 'INHIBIT_NOT_RESTORED', missing: ['ANM-00001'] });
  });
  it('restore 누락·무결성 실패도 미검증, 재시동이 아니면 필요 없음, 모두 맞으면 검증', () => {
    expect(restoreVerdict({ newBoot: true, restore: undefined, serverInhibits: [] }).code).toBe('RESTORE_MISSING');
    expect(restoreVerdict({ newBoot: true, restore: restore({ integrity: 'FAILED' }), serverInhibits: ['ANM-00001'] }).code).toBe('INTEGRITY_FAILED');
    expect(restoreVerdict({ newBoot: false, restore: undefined, serverInhibits: ['ANM-00001'] })).toMatchObject({ required: false, verified: true });
    expect(restoreVerdict({ newBoot: true, restore: restore(), serverInhibits: ['ANM-00001'] })).toMatchObject({ required: true, verified: true });
  });
});

describe('Feature epoch·재연결 대조 (ADS-BE07)', () => {
  it('차량이 본 epoch보다 낮은 게시본은 과거 게시본(epoch 없는 게시본은 0)', () => {
    expect(staleEpoch(undefined, 1)).toBe(true);
    expect(staleEpoch(1, 1)).toBe(false);
    expect(staleEpoch(2, 1)).toBe(false);
    expect(staleEpoch(undefined, undefined)).toBe(false);
  });
  it('오프라인 중 서버 차단 → 재연결 보고에 차단 없음 → 불일치 1건, 미확인 기간 = 오프라인 시작 ~ 재연결 관측', () => {
    const r = reconcileFeature({ epoch: 1, inhibits: ['ANM-00001'] }, { featureEpoch: 1, inhibits: [], observedAt: '2026-10-13T02:00:00Z', offlineSince: '2026-10-13T01:00:00Z' });
    expect(r.mismatches).toEqual([{ kind: 'INHIBIT_MISSING', ref: 'ANM-00001', expected: 'ANM-00001', reported: null }]);
    expect(r.unconfirmed).toEqual({ from: '2026-10-13T01:00:00Z', to: '2026-10-13T02:00:00Z' });
  });
  it('epoch 뒤처짐·차량에만 있는 차단·보고 없음', () => {
    expect(reconcileFeature({ epoch: 2, inhibits: [] }, { featureEpoch: 1, inhibits: ['X-001'], observedAt: '2026-10-13T02:00:00Z', offlineSince: null }).mismatches.map((m) => m.kind)).toEqual(['EPOCH_BEHIND', 'INHIBIT_EXTRA']);
    expect(reconcileFeature({ epoch: 1, inhibits: [] }, null).mismatches.map((m) => m.kind)).toEqual(['NOT_REPORTED']);
    expect(reconcileFeature({ epoch: 0, inhibits: [] }, null).mismatches).toEqual([]);
  });
});

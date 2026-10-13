// 상태 보고 v2 수신 검사 6단계·차량 Guard 검증 순서 — FFG-TEL-003 · FFG-DEAC-007 · FFG-ADS-004 · FFG-VEH-013 · TC-FF-24 · TC-FF-58
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import { bootRefOf, checkStatusReport, guardCheck, reportSeqOf, statusAuthCanonical, type StatusCheckContext } from './status-v2';

const report = () => loadGuide('schema/examples/status_disabled.ok.json');
const CTX: StatusCheckContext = { authOk: true, lastReportSeq: 196649, expectedVersion: '1.0.0', lastCommand: { request: 'deactivate', vehicleSeq: 11 } };

describe('수신 검사 6단계 (13.3.1)', () => {
  it('예제 DISABLED 보고는 받아들인다 — 조치 APPLIED', () => {
    expect(checkStatusReport(report(), CTX)).toMatchObject({ accepted: true, violation: null, action: { kind: 'APPLIED' } });
  });
  it('1 스키마 · 2 TC-FF-24 위조(state_auth 불일치) · 3 재전송 — 순서대로 첫 위반에서 멈춘다', () => {
    const { state_auth: _x, ...noAuth } = report();
    expect(checkStatusReport(noAuth, CTX).violation).toMatchObject({ step: 'SCHEMA' });
    expect(checkStatusReport(report(), { ...CTX, authOk: false }).violation).toMatchObject({ step: 'AUTH', code: 'AUTH_FAILED' });
    expect(checkStatusReport(report(), { ...CTX, lastReportSeq: 196650 }).violation).toMatchObject({ step: 'SEQUENCE', code: 'REPLAY' });
  });
  it('4 대상 — 전개되지 않은 Feature, 다른 Version', () => {
    expect(checkStatusReport(report(), { ...CTX, expectedVersion: null }).violation).toMatchObject({ step: 'TARGET', code: 'UNKNOWN_FEATURE' });
    expect(checkStatusReport(report(), { ...CTX, expectedVersion: '1.1.0' }).violation).toMatchObject({ step: 'TARGET', code: 'VERSION_MISMATCH' });
  });
  it('5 명령 이력 — 명령 없는 원격 DISABLED, 발급하지 않은 vehicle_seq, TC-FF-58 해제 없이 ACTIVE', () => {
    expect(checkStatusReport(report(), { ...CTX, lastCommand: null }).violation).toMatchObject({ step: 'HISTORY', code: 'STATE_WITHOUT_COMMAND' });
    expect(checkStatusReport(report(), { ...CTX, lastCommand: { request: 'deactivate', vehicleSeq: 10 } }).violation).toMatchObject({ code: 'SEQ_AHEAD' });
    const active = { ...report(), state: 'ACTIVE', hmi: 'NONE', edr_aligned_state: 'AVAILABLE', feature_weight_permille: 1000, reason: { category: 'SAFETY', source: 'STARTUP' } };
    expect(checkStatusReport(active, CTX).violation).toMatchObject({ step: 'HISTORY', code: 'ACTIVE_WITHOUT_RESTORE' });
    expect(checkStatusReport(active, { ...CTX, lastCommand: { request: 'restore', vehicleSeq: 12 } }).accepted).toBe(true);
  });
  it('6 영속 — 받아들이되 저장 실패는 같은 명령 재발행 조치', () => {
    const r = checkStatusReport({ ...report(), request_result: 'ACCEPTED_NOT_DURABLE', durable: false, persistence: 'PENDING' }, CTX);
    expect(r).toMatchObject({ accepted: true, action: { kind: 'REISSUE_SAME' } });
  });
  it('state_auth 대상은 state_auth를 뺀 JCS, report_seq 상위 16비트는 시동 참조', () => {
    const r = report();
    expect(statusAuthCanonical(r)).not.toContain('state_auth');
    expect(statusAuthCanonical({ ...r, state_auth: 'x' })).toBe(statusAuthCanonical(r));
    expect(bootRefOf(r.report_seq)).toBe(3); // 196650 = 3 << 16 | 42
    expect(reportSeqOf(3, 42)).toBe(196650);
  });
});

describe('차량 Guard 검증 순서 (9.3)', () => {
  const ok = {
    jwsOk: true,
    cmdAuthOk: true,
    keyEpoch: 1,
    currentEpoch: 1,
    vehicleSeq: 5,
    lastVehicleSeq: 4,
    now: 100,
    notBefore: 50,
    expiresAt: 200,
    designClass: 'DC2',
    commandClass: 'DC2',
    approverRefs: [1, 2] as const,
  };
  it('통과하면 NONE, 각 단계는 고유 코드', () => {
    expect(guardCheck(ok)).toBe('NONE');
    expect(guardCheck({ ...ok, jwsOk: false })).toBe('SIGNATURE_INVALID');
    expect(guardCheck({ ...ok, cmdAuthOk: false })).toBe('AUTH_FAILED');
    expect(guardCheck({ ...ok, keyEpoch: 0 })).toBe('KEY_EPOCH_OLD');
    expect(guardCheck({ ...ok, vehicleSeq: 4 })).toBe('REPLAY');
    expect(guardCheck({ ...ok, vehicleSeq: 4 + 1025 })).toBe('SEQ_JUMP');
    expect(guardCheck({ ...ok, now: 10 })).toBe('NOT_YET_VALID');
    expect(guardCheck({ ...ok, now: 200 })).toBe('EXPIRED');
    expect(guardCheck({ ...ok, commandClass: 'DC4' })).toBe('DC4_REMOTE_FORBIDDEN');
    expect(guardCheck({ ...ok, commandClass: 'DC0' })).toBe('CLASS_MISMATCH');
    expect(guardCheck({ ...ok, approverRefs: [7, 7] })).toBe('SAME_APPROVER');
  });
});

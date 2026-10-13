// 비활성화 규칙(보고서 7.2·7.3·9.3) — 차량 Guard 예제(ff_effective_class)와 같은 판정.
import { describe, expect, it } from 'vitest';
import { DEACT_CLASSES, REASON_CATEGORIES, REJECT_CODES } from '../schemas/safety';
import { deactStages, effectiveClass, endState, REASON_ACTIONS, reasonAction, stageIndexOf } from './deactivation';

describe('7.2 사유별 유효 등급 (FFG-DEAC-004 · TC-FF-11)', () => {
  it('안전·보안·법규는 설계 등급 그대로', () => {
    for (const r of ['SAFETY', 'SECURITY', 'REGULATORY'] as const) for (const dc of DEACT_CLASSES) expect(effectiveClass(dc, r)).toBe(dc);
  });
  it('상업·운영은 DC0·DC4가 아니면 DC3, 끝 상태 INACTIVE', () => {
    for (const r of ['COMMERCIAL', 'OPERATIONAL'] as const) {
      expect(DEACT_CLASSES.map((dc) => effectiveClass(dc, r))).toEqual(['DC0', 'DC3', 'DC3', 'DC3', 'DC4']);
      expect(endState(r)).toBe('INACTIVE');
    }
    expect(endState('SAFETY')).toBe('DISABLED');
  });
});

describe('7.3 등급별 단계', () => {
  it('DC2 안전 사유: 요청 → 경고 → 인계 → 램프 → DISABLED', () => {
    expect(deactStages('DC2', 'SAFETY').map((s) => `${s.id}:${s.state ?? '-'}`)).toEqual(['REQUESTED:-', 'WARNING:DEACT_WARNING', 'TAKEOVER:DEACT_WARNING', 'RAMP:DEACT_RAMP', 'OFF:DISABLED']);
  });
  it('DC2 상업 사유(체험권 만료)는 다음 시동으로 미뤄 INACTIVE — 주행 중 거동 변화 없음(CS-02)', () => {
    expect(deactStages('DC2', 'COMMERCIAL').map((s) => `${s.id}:${s.state ?? '-'}`)).toEqual(['REQUESTED:-', 'WAIT_CYCLE:DEACT_PENDING_CYCLE', 'OFF:INACTIVE']);
  });
  it('DC4는 원격 요청 거부로 끝난다(CS-07)', () => {
    expect(deactStages('DC4', 'SAFETY').map((s) => s.id)).toEqual(['REQUESTED', 'REJECTED']);
  });
  it('보고 상태 → 진행 위치. 인계 시간이 지나기 전 DEACT_WARNING은 경고 단계, UNKNOWN은 -1', () => {
    const st = deactStages('DC2', 'SAFETY');
    expect(stageIndexOf(st, 'DEACT_WARNING')).toBe(1);
    expect(stageIndexOf(st, 'DEACT_WARNING', { takeoverElapsed: true })).toBe(2);
    expect(stageIndexOf(st, 'DEACT_RAMP')).toBe(3);
    expect(stageIndexOf(st, 'DISABLED')).toBe(4);
    expect(stageIndexOf(st, 'UNKNOWN')).toBe(-1);
    expect(stageIndexOf(st, null)).toBe(-1);
  });
});

describe('9.3 결과 코드 → 조치', () => {
  it('모든 거부 코드에 조치가 있다', () => {
    expect(Object.keys(REASON_ACTIONS).sort()).toEqual([...REJECT_CODES].sort());
  });
  it('보안 이벤트 코드는 재전송하지 않는다', () => {
    for (const c of ['AUTH_FAILED', 'KEY_EPOCH_OLD', 'REPLAY', 'SEQ_JUMP', 'TARGET_MISMATCH', 'CLASS_MISMATCH', 'APPROVALS_INVALID', 'SAME_APPROVER'] as const) {
      expect(REASON_ACTIONS[c]).toEqual({
        kind: 'SECURITY_EVENT',
        retry: false,
        security: true,
      });
    }
  });
  it('ACCEPTED_NOT_DURABLE은 같은 명령 재발행, E2E는 링크 재시도, 응답 이상은 UNKNOWN', () => {
    expect(reasonAction('ACCEPTED_NOT_DURABLE')).toEqual({
      kind: 'REISSUE_SAME',
      retry: true,
      security: false,
    });
    expect(reasonAction('REJECTED', 'E2E_CRC').kind).toBe('LINK_RETRY');
    expect(reasonAction('REJECTED', 'RESPONSE_INVALID').kind).toBe('DISCARD_UNKNOWN');
    expect(reasonAction('ACCEPTED').kind).toBe('APPLIED');
  });
  it('사유 분류는 다섯 가지', () => expect(REASON_CATEGORIES.length).toBe(5));
});

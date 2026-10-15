// 보안 이벤트 — FFG-SEC-007 합격: 14.4절 이벤트 100%가 IdsM 보고와 VSOC 경보로 이어진다(임계값 도달 시 한 번), 진위 실패는 채널 제한
import { describe, expect, it } from 'vitest';
import { SECURITY_EVENTS, securityAlert, securityEventOf, type SecurityObservation } from './security-events';

const at = (min: number) => new Date(Date.parse('2026-10-12T01:00:00Z') + min * 60_000).toISOString();
const o = (min: number, code: string, vehicle: string | null = 'pv-1'): SecurityObservation => ({ at: at(min), code, vehicle });

describe('보안 이벤트 (FFG-SEC-007, 보고서 14.4)', () => {
  it('14.4 표의 이벤트가 모두 정의되고, 원천 코드는 한 이벤트에만 속한다', () => {
    expect(SECURITY_EVENTS.map((e) => e.id)).toEqual(['AUTH_FAILURE', 'REPLAY_SEQUENCE', 'APPROVAL_VIOLATION', 'UNTRUSTED_TIME_KILL', 'E2E_REPEAT', 'STATE_PROOF_FAILURE']);
    const codes = SECURITY_EVENTS.flatMap((e) => e.codes);
    expect(new Set(codes).size).toBe(codes.length);
    expect(securityEventOf('NONE')).toBeNull();
  });

  it('진위 실패: 같은 차량 10분에 3건째에 경보 + 채널 제한, 다른 차량·창 밖은 세지 않는다, 넘친 뒤에는 다시 울리지 않는다', () => {
    const h = [o(0, 'AUTH_FAILED'), o(1, 'AUTH_FAILED', 'pv-2'), o(2, 'SIGNATURE_INVALID')];
    expect(securityAlert(o(3, 'TARGET_MISMATCH'), h)).toMatchObject({ eventId: 'AUTH_FAILURE', category: 'SECURITY_MONITORING', vehicle: 'pv-1', count: 3, limitChannel: true });
    expect(securityAlert(o(12, 'AUTH_FAILED'), h)).toBeNull(); // 0분 건은 창 밖
    expect(securityAlert(o(4, 'AUTH_FAILED'), [...h, o(3, 'TARGET_MISMATCH')])).toBeNull(); // 4건째
  });

  it('재전송·상태 증명 실패·승인 위반은 1건에 경보, 신뢰 시간 없는 Kill은 Fleet 1% 기준', () => {
    expect(securityAlert(o(0, 'REPLAY'), [])).toMatchObject({ eventId: 'REPLAY_SEQUENCE', limitChannel: false });
    expect(securityAlert(o(0, 'STATE_AUTH_FAILED'), [])).toMatchObject({ eventId: 'STATE_PROOF_FAILURE' });
    expect(securityAlert(o(0, 'FFG-PLT-005', null), [])).toMatchObject({ eventId: 'APPROVAL_VIOLATION', vehicle: null });
    expect(securityAlert(o(0, 'FF_EV_TIME_UNVERIFIED'), [], 300)).toBeNull(); // 300대의 1% = 3건
    expect(securityAlert(o(2, 'FF_EV_TIME_UNVERIFIED', 'pv-3'), [o(0, 'FF_EV_TIME_UNVERIFIED'), o(1, 'FF_EV_TIME_UNVERIFIED', 'pv-2')], 300)).toMatchObject({ eventId: 'UNTRUSTED_TIME_KILL', count: 3 });
  });
});

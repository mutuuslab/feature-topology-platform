// Kill v2 — 요청 프레임(보고서 9.2절 ICD 예제)과 승인 규칙. FFG-VEH-002 · FFG-PLT-005 · FFG-DEAC-008 · TC-FF-16
import { describe, expect, it } from 'vitest';
import { approvalCheck, approvalPlan, approverRef, authBlock, crc32, DC_CODES, REASON_CODES, REQUEST_CODES, requestFrame } from './kill-v2';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('요청 프레임 (9.2절)', () => {
  it('코드값은 패키지 ff_types.h와 같다', () => {
    expect(REQUEST_CODES).toEqual({ deactivate: 0x3c, restore: 0xc3, activate: 0x5a, sync: 0x69 });
    expect(REASON_CODES).toEqual({ SAFETY: 0x1e, SECURITY: 0x2d, REGULATORY: 0x4b, COMMERCIAL: 0x87, OPERATIONAL: 0xb4 });
    expect(DC_CODES).toEqual({ DC0: 0x35, DC1: 0x53, DC2: 0x6f, DC3: 0x90, DC4: 0xca });
  });
  it('cmd_auth 블록은 4~35바이트 배치(big endian) — 부록 D.5 매핑', () => {
    const b = authBlock({
      featureId: 'FEAT-00022',
      version: '1.0.0',
      request: 'deactivate',
      reason: 'SAFETY',
      deactClass: 'DC2',
      keyEpoch: 3,
      vehicleSeq: 11,
      notBefore: '2026-10-13T00:00:00Z',
      expiresAt: '2026-10-13T12:00:00Z',
      targetHash: 0xdeadbeef,
      approverRefs: [101, 202],
    });
    expect(b.length).toBe(32);
    // feature_id 22 · version 0x0100 · 0x3C 0x1E 0x6F · epoch 3 · seq 11 · nb 1791849600(0x6ACD7480) · ex +12h(0x6ACE1D40) · hash · refs 101·202 · resync 0
    expect(hex(b)).toBe('00000016' + '0100' + '3c1e6f' + '03' + '0000000b' + '6acd7480' + '6ace1d40' + 'deadbeef' + '0065' + '00ca' + '0000');
  });
  it('CRC-32/ISO-HDLC 검사값 "123456789" → 0xCBF43926, 프레임은 0~51바이트 CRC를 끝에', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const block = new Uint8Array(32).fill(7);
    const f = requestFrame(block, new Uint8Array(16).fill(9), 1);
    expect(f.length).toBe(56);
    expect(hex(f.subarray(0, 4))).toBe('0f220001');
    expect(new DataView(f.buffer).getUint32(52)).toBe(crc32(f.subarray(0, 52)));
  });
  it('승인자 참조는 16비트·0 아님·결정적', () => {
    for (const id of ['usr-safety', 'usr-ops-lead', 'u-1001', '']) {
      const r = approverRef(id);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(0xffff);
      expect(approverRef(id)).toBe(r);
    }
    expect(approverRef('usr-safety')).not.toBe(approverRef('usr-ops-lead'));
  });
});

describe('승인 규칙 (FFG-PLT-005 · SOD-08·09)', () => {
  const plan = approvalPlan('F3', 'deactivate', 'SAFETY');
  const base = { requestedBy: 'usr-ops', approvals: [] as { approverId: string; role: 'FSM' | 'OPS_LEAD' | 'CSM' }[], plan };
  it('F2 이상 안전·보안 비활성화·복원만 FSM 필수', () => {
    expect(plan.fsm).toBe(true);
    expect(approvalPlan('F3', 'deactivate', 'COMMERCIAL').fsm).toBe(false);
    expect(approvalPlan('F1', 'deactivate', 'SAFETY').fsm).toBe(false);
    expect(approvalPlan('F2', 'restore', 'SECURITY').fsm).toBe(true);
  });
  it('요청자 승인 0건 — 요청자는 승인 역할이 있어도 거부', () => {
    expect(approvalCheck(base, { id: 'usr-ops', roles: ['FSM'] })).toMatchObject({ ok: false, code: 'SELF_APPROVAL' });
  });
  it('FSM 칸이 남으면 FSM이 아닌 두 번째 승인은 거부, FSM은 FSM 역할로 서명', () => {
    const one = { ...base, approvals: [{ approverId: 'usr-lead', role: 'OPS_LEAD' as const }] };
    expect(approvalCheck(one, { id: 'usr-csm', roles: ['CSM'] })).toMatchObject({ ok: false, code: 'FSM_REQUIRED' });
    expect(approvalCheck(one, { id: 'usr-safety', roles: ['FSM', 'QA'] })).toEqual({ ok: true, role: 'FSM' });
    expect(approvalCheck(one, { id: 'usr-lead', roles: ['OPS_LEAD'] })).toMatchObject({ ok: false, code: 'DUPLICATE' });
  });
  it('TC-FF-16 복원은 직전 Kill 승인자 제외, 승인 역할 없으면 거부, 두 칸이 차면 끝', () => {
    const restore = { ...base, plan: approvalPlan('F3', 'restore', 'SAFETY'), excluded: ['usr-safety'] };
    expect(approvalCheck(restore, { id: 'usr-safety', roles: ['FSM'] })).toMatchObject({ ok: false, code: 'KILL_APPROVER' });
    expect(approvalCheck(base, { id: 'usr-author', roles: [] })).toMatchObject({ ok: false, code: 'NO_APPROVER_ROLE' });
    const full = {
      ...base,
      approvals: [
        { approverId: 'a', role: 'FSM' as const },
        { approverId: 'b', role: 'OPS_LEAD' as const },
      ],
    };
    expect(approvalCheck(full, { id: 'c', roles: ['CSM'] })).toMatchObject({ ok: false, code: 'COMPLETE' });
  });
});

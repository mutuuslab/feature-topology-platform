// Kill v2 — 요청 프레임(보고서 9.2절 ICD 예제)과 승인 규칙. FFG-VEH-002 · FFG-PLT-005 · FFG-DEAC-008 · TC-FF-16
import { describe, expect, it } from 'vitest';
import { approvalCheck, approvalPlan, approverRef, authBlock, crc32, DC_CODES, nextApprovers, REASON_CODES, REQUEST_CODES, requestFrame, restoreOutlook } from './kill-v2';

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
    // 복원 계획(필수 FSM 하나) — 차단은 FSM+CSM 쌍이라 운영 리더가 첫 칸을 채울 수 없다(아래 쌍 시험)
    const one = { ...base, plan: approvalPlan('F3', 'restore', 'SAFETY'), approvals: [{ approverId: 'usr-lead', role: 'OPS_LEAD' as const }] };
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

describe('긴급 차단 서명 역할 쌍 (2026-11-04 결정 · P3-2·P4-1)', () => {
  const kill = approvalPlan('F3', 'deactivate', 'SAFETY');
  const restore = approvalPlan('F3', 'restore', 'SAFETY');
  const base = { requestedBy: 'usr-operator', approvals: [] as { approverId: string; role: 'FSM' | 'CSM' | 'OPS_LEAD' | 'QA' }[], plan: kill };
  it('F2 이상 안전 차단은 FSM + CSM — FSM 뒤 두 번째 FSM은 거부(FSM+FSM 기록 방지), 운영 리더도 거부', () => {
    expect(kill.required).toEqual(['FSM', 'CSM']);
    const one = { ...base, approvals: [{ approverId: 'usr-quality', role: 'FSM' as const }] };
    expect(approvalCheck(one, { id: 'usr-safety2', roles: ['FSM'] })).toMatchObject({ ok: false, code: 'CSM_REQUIRED' });
    expect(approvalCheck(one, { id: 'usr-opslead', roles: ['OPS_LEAD'] })).toMatchObject({ ok: false, code: 'CSM_REQUIRED' });
    expect(approvalCheck(one, { id: 'usr-integrator', roles: ['CSM'] })).toEqual({ ok: true, role: 'CSM' });
    // 첫 칸도 필수 역할만 — 운영 리더가 먼저 승인하면 남은 한 칸으로 FSM·CSM을 다 채울 수 없다
    expect(approvalCheck(base, { id: 'usr-opslead', roles: ['OPS_LEAD'] })).toMatchObject({ ok: false, code: 'FSM_REQUIRED' });
    // 상업 사유·F1은 그대로 아무 승인 역할 2인
    expect(approvalPlan('F3', 'deactivate', 'COMMERCIAL').required).toEqual([]);
  });
  it('FSM·CSM을 함께 가진 사람은 고른 서명 역할(부서 맥락)로 — 사이버보안 부서에서 승인하면 CSM으로 기록', () => {
    const both = { id: 'usr-integrator', roles: ['FSM', 'CSM'] as const };
    expect(approvalCheck(base, both)).toEqual({ ok: true, role: 'FSM' });
    expect(approvalCheck(base, both, 'CSM')).toEqual({ ok: true, role: 'CSM' });
    const one = { ...base, approvals: [{ approverId: 'usr-quality', role: 'FSM' as const }] };
    // FSM이 이미 있으면 FSM을 골라도 CSM으로 서명
    expect(approvalCheck(one, both, 'FSM')).toEqual({ ok: true, role: 'CSM' });
  });
  it('복원은 직전 차단을 승인하지 않은 FSM + 다른 1인 — 운영 리더가 먼저 승인해도 남은 칸은 FSM', () => {
    expect(restore.required).toEqual(['FSM']);
    const s = { requestedBy: 'usr-operator', approvals: [] as { approverId: string; role: 'FSM' | 'OPS_LEAD' }[], plan: restore, excluded: ['usr-quality', 'usr-integrator'] };
    expect(approvalCheck(s, { id: 'usr-opslead', roles: ['OPS_LEAD'] })).toEqual({ ok: true, role: 'OPS_LEAD' });
    const one = { ...s, approvals: [{ approverId: 'usr-opslead', role: 'OPS_LEAD' as const }] };
    expect(approvalCheck(one, { id: 'usr-approver', roles: ['PRODUCT_OWNER'] })).toMatchObject({ ok: false, code: 'FSM_REQUIRED' });
    expect(approvalCheck(one, { id: 'usr-safety2', roles: ['FSM'] })).toEqual({ ok: true, role: 'FSM' });
  });
  it('복원 전망 — 차단 승인자를 빼고 FSM이 남지 않으면 끝낼 수 없다(영구 막힘), 두 번째 FSM 계정이 있으면 끝난다', () => {
    const accounts = [
      { id: 'usr-quality', roles: ['FSM', 'QA'] as const },
      { id: 'usr-integrator', roles: ['CSM', 'FSM'] as const },
      { id: 'usr-opslead', roles: ['OPS_LEAD'] as const },
      { id: 'usr-operator', roles: [] as const },
    ];
    const dead = restoreOutlook(accounts, restore, ['usr-quality', 'usr-integrator']);
    expect(dead).toMatchObject({ complete: false, missing: ['FSM'] });
    expect(dead.candidates.map((a) => a.id)).toEqual(['usr-opslead']);
    const ok = restoreOutlook([...accounts, { id: 'usr-safety2', roles: ['FSM'] }], restore, ['usr-quality', 'usr-integrator']);
    expect(ok).toMatchObject({ complete: true, missing: [] });
    expect(ok.byRole).toEqual([{ role: 'FSM', ids: ['usr-safety2'] }]);
    // 다음 칸 후보 — 요청자·이미 승인한 사람·제외 대상은 빠진다
    expect(nextApprovers(accounts, { requestedBy: 'usr-opslead', approvals: [], plan: kill }).map((a) => a.id)).toEqual(['usr-quality', 'usr-integrator']);
  });
});

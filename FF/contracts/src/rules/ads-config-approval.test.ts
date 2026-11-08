// 승인 조합 제안→승인·보안 최소 버전 표 규칙(AC — B14·C4)
import { describe, expect, it } from 'vitest';
import { configSetApprovalBlocker, effectiveSecurityMins, isApprovedConfigSet, securityMinApprovalBlocker, securityMinProposalBlocker, unregisteredSecurityMin, type SecurityMinEntry } from './ads-config-approval';

const entry = (id: string, swId: string, version: string, status: SecurityMinEntry['status'] = 'APPROVED', proposedBy = 'usr-a'): SecurityMinEntry => ({ entryId: id, swId, version, status, rationale: 'r', proposedBy, proposedAt: '2026-11-01T00:00:00Z', approvedBy: status === 'APPROVED' ? 'usr-b' : null, approvedAt: null, approvalReason: null });

describe('승인 조합 제안 → 승인', () => {
  it('승인 대기는 근거가 아니다, 제안자 본인 승인·이미 승인 거부', () => {
    expect(isApprovedConfigSet({ status: 'PROPOSED' })).toBe(false);
    expect(isApprovedConfigSet({ status: 'APPROVED' })).toBe(true);
    expect(configSetApprovalBlocker({ status: 'PROPOSED', proposedBy: 'usr-a' }, 'usr-a')?.code).toBe('SELF_APPROVAL');
    expect(configSetApprovalBlocker({ status: 'APPROVED', proposedBy: 'usr-a' }, 'usr-b')?.code).toBe('ALREADY_APPROVED');
    expect(configSetApprovalBlocker({ status: 'PROPOSED', proposedBy: 'usr-a' }, 'usr-b')).toBeNull();
  });
});

describe('보안 최소 버전 표', () => {
  const table = [entry('SMV-0001', 'SW-A', '1.2.0'), entry('SMV-0002', 'SW-A', '1.10.0'), entry('SMV-0003', 'SW-A', '2.0.0', 'PROPOSED'), entry('SMV-0004', 'SW-B', '3.0.0')];
  it('지금 하한 = 승인된 행 중 가장 높은 버전(숫자 비교, 승인 대기 제외)', () => {
    expect(effectiveSecurityMins(table)).toEqual([{ swId: 'SW-A', version: '1.10.0' }, { swId: 'SW-B', version: '3.0.0' }]);
  });
  it('표에 없는 SW는 따로 — 판단 불가를 통과로 보지 않는다', () => {
    expect(unregisteredSecurityMin([{ swId: 'SW-A' }, { swId: 'SW-C' }, { swId: 'SW-C' }], effectiveSecurityMins(table))).toEqual(['SW-C']);
  });
  it('제안은 올리기만 — 같거나 낮으면 거부, 처음 SW는 허용', () => {
    expect(securityMinProposalBlocker(table, 'SW-A', '1.10.0')?.code).toBe('SECURITY_MIN_LOWERING');
    expect(securityMinProposalBlocker(table, 'SW-A', '1.9.9')?.code).toBe('SECURITY_MIN_LOWERING');
    expect(securityMinProposalBlocker(table, 'SW-A', '1.10.1')).toBeNull();
    expect(securityMinProposalBlocker(table, 'SW-NEW', '0.1.0')).toBeNull();
  });
  it('승인 — 제안자 본인 거부, 그 사이 더 높은 값이 승인됐으면 거부', () => {
    const p = entry('SMV-0003', 'SW-A', '2.0.0', 'PROPOSED', 'usr-a');
    expect(securityMinApprovalBlocker(table, p, 'usr-a')?.code).toBe('SELF_APPROVAL');
    expect(securityMinApprovalBlocker(table, p, 'usr-c')).toBeNull();
    expect(securityMinApprovalBlocker([...table, entry('SMV-0005', 'SW-A', '2.1.0')], p, 'usr-c')?.code).toBe('SECURITY_MIN_LOWERING');
  });
});

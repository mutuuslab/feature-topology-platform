// 비활성화 조건 확인(FR-SVS-002-001)·차단 범위 규칙(P11a)
import { describe, expect, it } from 'vitest';
import { deactivationCheck, KillIntakeBody } from './kill-intake';
import { activationBlockers, blockedVins, impactGroups, isKilled, missingRestoreChecks, scopeKinds, scopeMatches } from './kill-scope';

const OK = { advice: 'KILL', severity: 'CRITICAL', registry: { deact_class: 'DC2', gsr_mandatory: false }, vehicles: 3, openKill: null, openIntake: null };
describe('비활성화 조건 확인', () => {
  it('넷 다 참이면 충족, 하나라도 거짓이면 미충족 사유', () => {
    expect(deactivationCheck(OK)).toMatchObject({ met: true, unmet: [] });
    const dc4 = deactivationCheck({ ...OK, registry: { deact_class: 'DC4', gsr_mandatory: false } });
    expect(dc4.met).toBe(false);
    expect(dc4.unmet[0]).toContain('원격 비활성화 가능 등급');
    expect(deactivationCheck({ ...OK, advice: 'INVESTIGATE' }).unmet[0]).toContain('긴급 차단 권고');
    expect(deactivationCheck({ ...OK, openKill: 'KILL-00001' }).unmet[0]).toContain('KILL-00001');
    expect(deactivationCheck({ ...OK, registry: null, vehicles: 0 }).unmet).toHaveLength(2);
  });
  it('외부 접수 본문 — 실행 필드(승인·서명)는 받지 않는다', () => {
    expect(KillIntakeBody.safeParse({ featureId: 'FEAT-00022', featureVersion: '1.0.0', reason: '현장 결함' }).success).toBe(true);
    expect(KillIntakeBody.safeParse({ featureId: 'FEAT-00022', featureVersion: '1.0.0', reason: '현장 결함', approvals: [] }).success).toBe(false);
  });
});

describe('차단 범위 규칙', () => {
  const k = { killId: 'KILL-00001', featureId: 'FEAT-00022', featureIds: ['FEAT-00022', 'FEAT-00030'], vins: ['A', 'B'], status: 'ACTIVE' as const, reasonCategory: 'SAFETY' as const, restoredVins: ['A'] };
  it('부분 복원한 차량은 차단에서 빠진다 — 의존 Feature도 같은 차량 범위', () => {
    expect(blockedVins(k)).toEqual(['B']);
    expect(isKilled([k], 'FEAT-00022', 'A')).toBe(false);
    expect(isKilled([k], 'FEAT-00030', 'B')).toBe(true);
    expect(blockedVins({ ...k, status: 'RELEASED' })).toEqual([]);
  });
  it('활성화 거부 — 긴급 사유만, 상업 차단·다 풀린 차단은 막지 않는다', () => {
    expect(activationBlockers([k], 'FEAT-00022')).toHaveLength(1);
    expect(activationBlockers([{ ...k, reasonCategory: 'COMMERCIAL' }], 'FEAT-00022')).toHaveLength(0);
    expect(activationBlockers([{ ...k, restoredVins: ['A', 'B'] }], 'FEAT-00022')).toHaveLength(0);
  });
  it('해제 확인 항목 — 둘 다 true여야', () => {
    expect(missingRestoreChecks({})).toEqual(['resolved', 'causeFixed']);
    expect(missingRestoreChecks({ resolved: true, causeFixed: true })).toEqual([]);
  });
  it('범위 칸 — 준 칸이 모두 맞아야, 영향 그룹은 범위 유형별', () => {
    const v = { vin: 'A', country: 'KR', vehicleModel: 'NX4', trim: 'P', upgVc: 'U1', swVersion: '1.0.0' };
    expect(scopeKinds({})).toEqual([]);
    expect(scopeMatches({ countries: ['KR'], swVersions: ['1.0.0'] }, v)).toBe(true);
    expect(scopeMatches({ countries: ['KR'], swVersions: ['2.0.0'] }, v)).toBe(false);
    const g = impactGroups([{ ...v, verdict: 'APPLICABLE' }, { ...v, vin: 'B', verdict: 'UNKNOWN' }, { ...v, vin: 'C', swVersion: '2.0.0', verdict: 'APPLICABLE' }]);
    expect(g.map((x) => [x.vins.length, x.verdicts])).toEqual([
      [2, { APPLICABLE: 1, UNKNOWN: 1 }],
      [1, { APPLICABLE: 1 }],
    ]);
  });
});

// Flag Retirement 6단계 — FFG-LCY-011 플랫폼 몫: 순서·완료 조건, 코드 삭제 기한(6개월·다음 정기 릴리스 중 이른 쪽), F2 이상은 Safety Manager 승인
import { describe, expect, it } from 'vitest';
import { codeRemovalDue, RETIREMENT_STEPS, retirementApprovers, retirementBlocker, type RetirementState } from './retirement';

const approved: RetirementState = { approvals: [{ by: 'a', role: 'FEATURE_APPROVER', at: '2026-10-15T00:00:00Z' }], approvedAt: '2026-10-15T00:00:00.000Z', steps: {} };
const done = (keys: string[]): RetirementState => ({ ...approved, steps: Object.fromEntries(keys.map((k) => [k, { at: 'x', by: 'y', data: {} }])) });

describe('Flag Retirement 6단계 (FFG-LCY-011)', () => {
  it('FFG-LCY-011 6단계 순서와 승인 역할 — F2 이상은 Safety Manager도', () => {
    expect(RETIREMENT_STEPS.map((s) => s.key)).toEqual(['APPROVED', 'REMAINING_VEHICLES', 'FINAL_STATE', 'CODE_REMOVED', 'REGISTRY_RETIRED', 'RECORDS_RETAINED']);
    expect(retirementApprovers('F1')).toEqual(['FEATURE_APPROVER']);
    expect(retirementApprovers('F3')).toEqual(['FEATURE_APPROVER', 'SAFETY_OFFICER']);
  });

  it('FFG-LCY-011 코드 삭제 기한 = 승인 후 6개월과 다음 정기 릴리스 중 이른 쪽', () => {
    expect(codeRemovalDue(null, null)).toBeNull();
    expect(codeRemovalDue('2026-10-15T00:00:00.000Z', null)).toBe('2027-04-15T00:00:00.000Z');
    expect(codeRemovalDue('2026-10-15T00:00:00.000Z', '2026-12-01T00:00:00.000Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(codeRemovalDue('2026-10-15T00:00:00.000Z', '2027-12-01T00:00:00.000Z')).toBe('2027-04-15T00:00:00.000Z');
  });

  it('FFG-LCY-011 승인 전·앞 단계 미완·배포 완료율 미달·코드 참조 남음·중복 기록은 진행 불가', () => {
    const need = ['FEATURE_APPROVER'];
    expect(retirementBlocker({ ...approved, approvedAt: null }, { step: 'REMAINING_VEHICLES' }, need)).toMatch(/승인 전/);
    expect(retirementBlocker(approved, { step: 'REGISTRY_RETIRED' }, need)).toMatch(/REMAINING_VEHICLES, FINAL_STATE, CODE_REMOVED/);
    expect(retirementBlocker(done(['REMAINING_VEHICLES']), { step: 'FINAL_STATE', swVersion: '1.0.0', completionRate: 90, requiredRate: 95, evidenceRef: 'x1' }, need)).toMatch(/90% < 기준 95%/);
    expect(retirementBlocker(done(['REMAINING_VEHICLES', 'FINAL_STATE']), { step: 'CODE_REMOVED', analysisRef: 'x1', references: 1 }, need)).toMatch(/참조 1건/);
    expect(retirementBlocker(done(['REMAINING_VEHICLES', 'FINAL_STATE']), { step: 'CODE_REMOVED', analysisRef: 'x1', references: 0 }, need)).toBeNull();
    expect(retirementBlocker(done(['REMAINING_VEHICLES']), { step: 'REMAINING_VEHICLES' }, need)).toMatch(/이미/);
  });
});

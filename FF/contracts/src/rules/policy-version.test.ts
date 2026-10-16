import { describe, expect, it } from 'vitest';
import { PolicySpec } from '../schemas/policy';
import { policyChangeLog, policyDiff, policySpecOf, type PolicyRevision } from './policy-version';

const base = PolicySpec.parse({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '위험 단계 감속' });
const rev = (revision: number, kind: PolicyRevision['kind'], spec = base, restoredFrom: number | null = null): PolicyRevision => ({
  policyId: 'POL-00001',
  revision,
  contentHash: `h${revision}`,
  kind,
  changedBy: 'usr-author',
  changedAt: `2026-10-17T0${revision}:00:00.000Z`,
  restoredFrom,
  reason: null,
  spec,
});

describe('정책 버전 이력', () => {
  it('정책 내용만 고른다 — 상태·승인자는 버전 내용이 아니다', () => {
    const s = policySpecOf({ ...base, policyId: 'POL-00001', status: 'DEPLOYED', approvedBy: 'usr-approver' });
    expect(s).toEqual(base);
    expect('status' in s).toBe(false);
  });

  it('차이는 점 경로로, 배열은 통째로 — 같으면 빈 목록', () => {
    const next = { ...base, enabled: false, rollout: { ...base.rollout, basisPoints: 500, mode: 'COHORT' as const } };
    expect(policyDiff(base, base)).toEqual([]);
    expect(policyDiff(base, next)).toEqual([
      { path: 'enabled', before: true, after: false },
      { path: 'rollout.basisPoints', before: 10000, after: 500 },
      { path: 'rollout.mode', before: 'ALL', after: 'COHORT' },
    ]);
    expect(policyDiff(base, { ...base, strategies: [{ name: 'default', constraints: [] } as never] })).toEqual([{ path: 'strategies', before: [], after: [{ name: 'default', constraints: [] }] }]);
  });

  it('없어진 선택 항목(ODD 축소)은 통째로 null이 된 한 줄', () => {
    const odd = { ...base, oddRestriction: { baseVersion: '0.9.0', reason: '고속도로 한정' } as never };
    expect(policyDiff(odd, base)).toEqual([{ path: 'oddRestriction', before: { baseVersion: '0.9.0', reason: '고속도로 한정' }, after: null }]);
  });

  it('변경 이력은 최신 순, 각 줄에 변경 전·후 — 이력 시작(IMPORTED)은 앞 내용이 없다', () => {
    const r2 = { ...base, description: '감속 강화' };
    const log = policyChangeLog([rev(3, 'RESTORE', base, 1), rev(1, 'CREATE'), rev(2, 'UPDATE', r2)]);
    expect(log.map((e) => e.revision)).toEqual([3, 2, 1]);
    expect(log[0]).toMatchObject({ kind: 'RESTORE', restoredFrom: 1, before: r2, after: base, changes: [{ path: 'description', before: '감속 강화', after: '위험 단계 감속' }] });
    expect(log[2].before).toBeNull();
    expect(log[2].changes.length).toBeGreaterThan(0);
    const imported = policyChangeLog([rev(4, 'IMPORTED')]);
    expect(imported[0]).toMatchObject({ before: null, changes: [] });
  });
});

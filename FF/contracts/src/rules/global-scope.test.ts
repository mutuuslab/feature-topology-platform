// 브랜드·권역별 Feature 정책(B7 (b), FR-GLB-001-001~004) — 브랜드 상수 3종·목록 외 거부·수정 권한(Feature Owner·시스템 관리자)·조건 조회
import { describe, expect, it } from 'vitest';
import { BRANDS, PolicyGlobalScopeBody, type PolicyGlobalScope } from '../schemas/global-scope';
import { canEditGlobalScope, matchGlobalScopes, SYSTEM_ADMIN_ROLE } from './global-scope';

describe('브랜드 목록 @req FR-GLB-001-002', () => {
  it('현대·기아·제네시스 3종', () => {
    expect(BRANDS).toEqual(['HYUNDAI', 'KIA', 'GENESIS']);
  });
  it('목록 밖 브랜드는 등록 불가 메시지와 함께 거부', () => {
    const r = PolicyGlobalScopeBody.safeParse({ brands: ['TESLA'], regionCodes: [], complianceRuleIds: [], reason: '브랜드 등록' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/등록할 수 없는 브랜드.*TESLA/);
  });
  it('지역 코드도 체계 밖이면 거부, 같은 브랜드 두 번도 거부', () => {
    expect(PolicyGlobalScopeBody.safeParse({ brands: ['KIA'], regionCodes: ['Z'], complianceRuleIds: [], reason: '등록' }).success).toBe(false);
    expect(PolicyGlobalScopeBody.safeParse({ brands: ['KIA', 'KIA'], regionCodes: [], complianceRuleIds: [], reason: '등록' }).success).toBe(false);
    expect(PolicyGlobalScopeBody.safeParse({ brands: ['KIA'], regionCodes: ['4'], complianceRuleIds: ['CR-SAF-001'], reason: '등록' }).success).toBe(true);
  });
  it('브랜드는 하나 이상', () => {
    expect(PolicyGlobalScopeBody.safeParse({ brands: [], regionCodes: ['4'], complianceRuleIds: [], reason: '등록' }).success).toBe(false);
  });
});

describe('수정 권한 @req FR-GLB-001-004', () => {
  const feature = { ownerId: 'usr-author' };
  it('Feature Owner 본인은 수정', () => {
    expect(canEditGlobalScope({ id: 'usr-author', roles: ['FEATURE_AUTHOR'] }, feature)).toEqual({ ok: true });
  });
  it('시스템 관리자는 수정', () => {
    expect(canEditGlobalScope({ id: 'usr-admin', roles: [SYSTEM_ADMIN_ROLE] }, feature)).toEqual({ ok: true });
  });
  it('그 밖은 수정 불가 사유', () => {
    const r = canEditGlobalScope({ id: 'usr-other', roles: ['FEATURE_AUTHOR', 'RELEASE_MANAGER'] }, feature);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toMatch(/Owner.*시스템 관리자/);
  });
});

describe('조건 조회 @req FR-GLB-001-001 FR-GLB-001-003', () => {
  const s = (policyId: string, brands: PolicyGlobalScope['brands'], regionCodes: string[], complianceRuleIds: string[] = []): PolicyGlobalScope => ({
    policyId, featureId: 'FEAT-00001', brands, regionCodes, complianceRuleIds, revision: 1, updatedBy: 'usr-author', updatedAt: '2026-11-07T00:00:00Z', reason: '등록',
  });
  const all = [s('POL-00001', ['HYUNDAI', 'KIA'], ['1']), s('POL-00002', ['GENESIS'], ['4', '7'], ['CR-PRV-001']), s('POL-00003', ['KIA'], ['4'])];
  it('브랜드로', () => {
    expect(matchGlobalScopes(all, { brand: 'KIA' }).map((x) => x.policyId)).toEqual(['POL-00001', 'POL-00003']);
  });
  it('권역(지역 코드)·법규 조건으로', () => {
    expect(matchGlobalScopes(all, { regionCode: '4' }).map((x) => x.policyId)).toEqual(['POL-00002', 'POL-00003']);
    expect(matchGlobalScopes(all, { regionCode: '4', ruleId: 'CR-PRV-001' }).map((x) => x.policyId)).toEqual(['POL-00002']);
  });
  it('없으면 빈 목록', () => {
    expect(matchGlobalScopes(all, { brand: 'GENESIS', regionCode: '1' })).toEqual([]);
  });
});

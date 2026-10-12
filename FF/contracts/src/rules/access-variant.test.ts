// IAM 권한표(ROUTES에서 파생)·Variant/지원 조건 판정
import { describe, expect, it } from 'vitest';
import type { Vehicle } from '../schemas/policy';
import { HUMAN_ROLES, permissions, rolesView, SOD_RULES } from './access';
import { requiredSw, variantMatrix, variantRow } from './variant';

describe('IAM (D06-09)', () => {
  it('사람 역할에서 차량 기기 신원·시스템은 뺀다', () => {
    expect(HUMAN_ROLES).not.toContain('VEHICLE');
    expect(HUMAN_ROLES).not.toContain('SYSTEM');
    expect(HUMAN_ROLES).toContain('OPERATOR');
  });
  it('권한은 ROUTES의 roles에서 나온다 — 긴급 차단은 운영자·안전 담당만, 감사 조회자는 변경 권한 없음', () => {
    const issue = permissions().find((p) => p.name === 'issueKill')!;
    expect(issue.roles.sort()).toEqual(['OPERATOR', 'SAFETY_OFFICER']);
    const view = rolesView();
    expect(view.find((r) => r.role === 'AUDITOR')!.allowed).toEqual([]);
    expect(view.find((r) => r.role === 'OPERATOR')!.allowed).toContain('issueKill');
    expect(permissions().every((p) => p.method !== 'GET')).toBe(true);
  });
  it('직무 분리 규칙 표 — 정책 자기 승인 금지 포함', () => {
    expect(SOD_RULES.map((r) => r.id)).toContain('SOD-05');
  });
});

const F = { featureId: 'FEAT-00022', version: '1.0.0', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', upgVc: ['F111A114001'], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] };
const V = (o: Partial<Vehicle>): Vehicle => ({ vin: 'v', label: 'l', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', modelYear: '2026', upgVc: 'F111A114001', swVersion: '1.2.1', quality: 'TRUSTED', link: 'ONLINE', gleo: false, ...o });

describe('Variant·기능 지원 조건 (D02-01·D02-02)', () => {
  it.each([
    ['범위·UPG-VC·SW 충족', {}, 'APPLICABLE'],
    ['SW 낮음 → 지원 안 됨', { swVersion: '1.1.9' }, 'NOT_SUPPORTED'],
    ['UPG-VC 다름', { upgVc: 'F111A114999' }, 'NOT_APPLICABLE'],
    ['국가 다름', { country: 'US' }, 'NOT_APPLICABLE'],
    ['문맥 STALE', { quality: 'STALE' as const }, 'UNKNOWN'],
  ])('%s', (_n, o, verdict) => {
    expect(variantRow(F, V(o)).verdict).toBe(verdict);
  });
  it('요구 SW는 구현 연결의 첫 SW(기능 앱), UPG-VC 조건이 없으면 null', () => {
    expect(requiredSw({ swVersions: ['1.2.1', '2.3.0'] })).toBe('1.2.1'); // FEAT-00022: 앱 1.2.1 · SCC 어댑터 2.3.0
    expect(variantRow({ ...F, upgVc: [] }, V({})).upgVc).toBeNull();
    const m = variantMatrix(F, [V({ vin: 'a' }), V({ vin: 'b', swVersion: '1.1.9' }), V({ vin: 'c', country: 'EU' })]);
    expect(m.summary).toEqual({ applicable: 1, notSupported: 1, notApplicable: 1, unknown: 0 });
  });
});

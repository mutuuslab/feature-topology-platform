import { describe, expect, it } from 'vitest';
import { authConfigProblems, mappedDepartment, oidcConfigOf, parseDepartmentMap } from '../../src/kernel/auth/auth-config';
import { migrate, SqliteDb } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';

const ENV = { FF_AUTH: 'oidc', OIDC_ISSUER: 'https://idp.example.test', OIDC_CLIENT_ID: 'ff', OIDC_CLIENT_SECRET: 'test-only', FF_PUBLIC_URL: 'https://ff.example.test', FF_SESSION_SECRET: 's'.repeat(48), OIDC_ROLE_MAP: 'cost=COST_ESTIMATOR' };
describe('선택적 부서 매핑 설정', () => {
  it('설정이 없으면 기존 설치는 공통 컨텍스트이며 역할 설정은 그대로다', () => {
    expect(authConfigProblems(ENV)).toEqual([]);
    const cfg = oidcConfigOf(ENV);
    expect(mappedDepartment({ department: 'DEP-PUR' }, cfg)).toBeUndefined();
    expect([...cfg.roleMap]).toEqual([['cost', ['COST_ESTIMATOR']]]);
  });
  it('명시한 클레임만 정확히 매핑하며 이름의 공백·중첩 키·문자열/배열을 구분한다', () => {
    const departmentMap = parseDepartmentMap('Purchasing Department=DEP-PUR,legal=DEP-LEG');
    expect(mappedDepartment({ org: { department: 'Purchasing Department' } }, { departmentClaim: 'org.department', departmentMap })).toBe('DEP-PUR');
    expect(mappedDepartment({ 'org.department': ['legal', 'legal'] }, { departmentClaim: 'org.department', departmentMap })).toBe('DEP-LEG');
    expect(mappedDepartment({ groups: ['cost', 'legal'] }, { departmentClaim: 'groups', departmentMap })).toBe('DEP-LEG');
    for (const value of [42, null, {}, ['legal', 'Purchasing Department'], 'COST_APPROVER', 'DEP-PUR']) expect(mappedDepartment({ department: value }, { departmentClaim: 'department', departmentMap })).toBeUndefined();
  });
  it('잘못된 모델 ID·중복 모호 매핑·한쪽만 설정은 부팅 설정 오류다', () => {
    expect(authConfigProblems({ ...ENV, OIDC_DEPARTMENT_CLAIM: 'org.department' }).join()).toContain('함께');
    expect(authConfigProblems({ ...ENV, OIDC_DEPARTMENT_MAP: 'p=DEP-PUR' }).join()).toContain('함께');
    for (const raw of ['p=DEP-UNKNOWN', 'p=DEP-PUR,p=DEP-LEG', 'broken']) {
      expect(authConfigProblems({ ...ENV, OIDC_DEPARTMENT_CLAIM: 'department', OIDC_DEPARTMENT_MAP: raw }).join()).toContain('OIDC_DEPARTMENT_MAP');
    }
    expect(authConfigProblems({ ...ENV, OIDC_DEPARTMENT_CLAIM: 'department', OIDC_DEPARTMENT_MAP: 'p=DEP-PUR' })).toEqual([]);
  });
});

it('이전 세션을 삭제하거나 역할을 바꾸지 않고 nullable 부서 컬럼을 업그레이드한다', () => {
  const db = new SqliteDb();
  try {
    const prior = MIGRATIONS.filter((m) => m.name !== '401_oidc_department_context');
    migrate(db, prior);
    db.run('INSERT INTO auth_session (id_hash,sub,name,email,roles,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)', 'old-id', 'old-user', null, null, '["AUDITOR"]', '2026-01-01', '2030-01-01', '2026-01-01');
    expect(migrate(db, MIGRATIONS)).toEqual(['401_oidc_department_context']);
    expect(db.get('SELECT sub,roles,department_id FROM auth_session WHERE id_hash=?', 'old-id')).toEqual({ sub: 'old-user', roles: '["AUDITOR"]', department_id: null });
    expect(migrate(db, MIGRATIONS)).toEqual([]);
  } finally { db.close(); }
});

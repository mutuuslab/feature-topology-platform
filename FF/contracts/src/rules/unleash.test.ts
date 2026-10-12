// IF-04 Unleash 연계 계획 — P0 개정 기준(배포 정책만, 코호트는 서명 목록, EXCLUDES는 BLOCKED)
import { describe, expect, it } from 'vitest';
import type { Policy } from '../schemas/policy';
import { planUnleash, toUnleashConstraint, unleashContext, unleashDrift } from './unleash';

const POL: Policy = {
  policyId: 'POL-00002',
  revision: 1,
  status: 'DEPLOYED',
  contentHash: 'sha256:f3436402a4b06629edc6ee5e7ae602006ed4dc7a7dcfd17db1e64ecdccdc46bc',
  createdBy: 'a',
  createdAt: 'x',
  approvedBy: 'b',
  approvedAt: 'x',
  lastValidationId: null,
  stageBasisPoints: null,
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  controlPoint: 'Parameter',
  flagKey: 'care_00022_param',
  description: '감속 요청',
  enabled: true,
  safeDefault: false,
  entitlementCatalogId: 'CAT-00019',
  strategies: [],
  rollout: { mode: 'ALL', basisPoints: 10000, salt: 'S' },
};
const base = { policy: POL, scope: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }, requires: [{ featureId: 'FEAT-00145', flagKeys: ['care_00145_flag'] }], excludes: [], cohortMembers: null };

describe('Unleash 계획 (IF-04)', () => {
  it('배포 정책 → flexibleRollout 100% + 적용 범위·사용 권한 제약, REQUIRES는 의존 flag, 추적 태그', () => {
    const p = planUnleash(base);
    expect(p).toMatchObject({ flagName: 'care_00022_param', project: 'default', environment: 'development', enabled: true, ready: true, dependencies: ['care_00145_flag'] });
    expect(p.strategies).toHaveLength(1);
    expect(p.strategies[0].parameters).toEqual({ groupId: 'care_00022_param', rollout: '100', stickiness: 'default' });
    expect(p.strategies[0].constraints.map((c) => `${c.contextName} ${c.operator} ${c.values}`)).toEqual(['country IN KR', 'vehicleModel IN NX4 PE', 'vehicleTrim IN Premium', 'trialSessionValid IN true']);
    expect(p.tags).toEqual([
      { type: 'fp-source', value: 'FF-PLATFORM' },
      { type: 'fp-policy', value: 'POL-00002@r1' },
      { type: 'fp-digest', value: 'f3436402a4' },
      { type: 'fp-feature', value: 'FEAT-00022@1.0.0' },
    ]);
  });

  it('정책 전략 여러 개 → Unleash 전략 여러 개(OR), 단일 값 연산자는 value로', () => {
    const p = planUnleash({ ...base, policy: { ...POL, strategies: [{ name: 'SW 최신', constraints: [{ contextName: 'swVersion', operator: 'SEMVER_GT', values: ['1.2.0'], inverted: false, caseInsensitive: false }] }, { name: '시연차', constraints: [{ contextName: 'vehicleKey', operator: 'IN', values: ['ego-01'], inverted: false, caseInsensitive: false }] }] } });
    expect(p.strategies.map((s) => s.title)).toEqual(['POL-00002 SW 최신', 'POL-00002 시연차']);
    expect(p.strategies[0].constraints.at(-1)).toEqual({ contextName: 'swVersion', operator: 'SEMVER_GT', value: '1.2.0', inverted: false, caseInsensitive: false });
  });

  it('REQUIRES 대상에 배포 flag가 없으면 의존 없이 참고만 — 막지 않는다', () => {
    const p = planUnleash({ ...base, requires: [{ featureId: 'FEAT-00145', flagKeys: [] }] });
    expect([p.ready, p.dependencies]).toEqual([true, []]);
    expect(p.notes[0]).toMatch(/REQUIRES FEAT-00145/);
  });

  it('코호트 정책은 서명 코호트 목록(vehicleKey IN)으로, 빈 코호트는 env off', () => {
    const c = { ...POL, rollout: { mode: 'COHORT' as const, basisPoints: 5000, salt: 'S' } };
    expect(planUnleash({ ...base, policy: c, cohortMembers: ['lead-01', 'ego-01'] }).strategies[0].constraints.at(-1)).toMatchObject({ contextName: 'vehicleKey', operator: 'IN', values: ['ego-01', 'lead-01'] });
    expect(planUnleash({ ...base, policy: c, cohortMembers: [] }).enabled).toBe(false);
  });

  it.each([
    ['배포 전 정책', { policy: { ...POL, status: 'APPROVED' as const } }, /배포\(DEPLOYED\)된 정책만/],
    ['EXCLUDES 관계', { excludes: ['FEAT-00030'] }, /EXCLUDES FEAT-00030/],
  ])('BLOCKED: %s', (_n, over, msg) => {
    const p = planUnleash({ ...base, ...over });
    expect(p.ready).toBe(false);
    expect(p.blockers.join(' ')).toMatch(msg);
  });

  it('차량 문맥: userId=vehicleKey=VIN, 권한 확인 불가면 trialSessionValid 생략', () => {
    const v = { vin: 'ego-01', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' };
    expect(unleashContext(v, true).properties).toEqual({ vehicleKey: 'ego-01', country: 'KR', vehicleModel: 'NX4 PE', vehicleTrim: 'Premium', trialSessionValid: 'true' });
    expect(unleashContext(v, null).properties).not.toHaveProperty('trialSessionValid');
    expect(toUnleashConstraint({ contextName: 'x', operator: 'NUM_GTE', values: ['3'], inverted: false, caseInsensitive: false })).toHaveProperty('value', '3');
  });

  it('drift: 서버 정의가 계획과 다르면 항목별로 알린다', () => {
    const p = planUnleash(base);
    expect(unleashDrift(p, { enabled: true, strategies: p.strategies, tags: p.tags })).toEqual([]);
    expect(unleashDrift(p, null)).toEqual(['Unleash에 flag가 없습니다']);
    const d = unleashDrift(p, { enabled: false, strategies: [{ ...p.strategies[0], parameters: { rollout: '50' } }], tags: [] });
    expect(d).toHaveLength(2 + p.tags.length);
  });
});

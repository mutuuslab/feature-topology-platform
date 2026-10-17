import { describe, expect, it } from 'vitest';
import {
  CreateRollbackPlanBody,
  dtcTrigger,
  dtcType,
  failureRate,
  failureRateTrigger,
  productionRegionOf,
  recoveryBlockers,
  RollbackConditions,
  RollbackScope,
  scopeBlockers,
  targetTypeBlockers,
  vehicleGroups,
  vehicleInScope,
  type RecoveryFacts,
} from './rollback';

const v = (vin: string, over: Partial<{ country: string; upgVc: string; swVersion: string }> = {}) => ({ vin, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', upgVc: 'F111A114001', swVersion: '1.2.1', ...over });
const scope = (s: Partial<RollbackScope>) => RollbackScope.parse(s);

describe('롤백 — 입력 검증', () => {
  it('적용 대상 범위·자동 롤백 조건·승인대상자는 필수, DTC 조건은 코드나 유형이 있어야 한다', () => {
    const ok = { deploymentId: 'PUB-000001', targetTypes: ['POLICY_VERSION'], recovery: { policyId: 'POL-00001' }, conditions: { failureRate: { thresholdPercent: 20 } }, scope: { featureIds: ['FEAT-00022'] }, approvers: ['usr-coordinator'] };
    expect(CreateRollbackPlanBody.safeParse(ok).success).toBe(true);
    expect(CreateRollbackPlanBody.safeParse({ ...ok, scope: {} }).success).toBe(false);
    expect(CreateRollbackPlanBody.safeParse({ ...ok, conditions: {} }).success).toBe(false);
    expect(CreateRollbackPlanBody.safeParse({ ...ok, approvers: [] }).success).toBe(false);
    expect(CreateRollbackPlanBody.safeParse({ ...ok, targetTypes: [] }).success).toBe(false);
    expect(RollbackConditions.safeParse({ dtc: { codes: [], types: [] } }).success).toBe(false);
    expect(RollbackConditions.safeParse({ dtc: { codes: ['C1234'] } }).success).toBe(false); // 6자리 16진수
    expect(RollbackConditions.safeParse({ dtc: { codes: ['4A1345'] } }).success).toBe(true);
  });

  it('SW 버전은 OTA(IF-05) 위임 사유로 막고, 정책 버전이 없으면 막는다', () => {
    expect(targetTypeBlockers(['POLICY_VERSION'])).toEqual([]);
    expect(targetTypeBlockers(['POLICY_VERSION', 'SW_VERSION'])).toEqual(['SW_VERSION_EXTERNAL']);
    expect(targetTypeBlockers(['SW_VERSION'])).toEqual(['POLICY_TARGET_REQUIRED', 'SW_VERSION_EXTERNAL']);
  });
});

describe('롤백 — 적용 범위·차량 그룹', () => {
  it('차원 안은 OR, 차원 사이는 AND — 생산 지역은 VIN 앞자리', () => {
    expect(productionRegionOf('KMH-NX4-0001')).toBe('KMH');
    expect(vehicleInScope(v('KMH-NX4-0001'), 'FEAT-00022', scope({ featureIds: ['FEAT-00022'] }))).toBe(true);
    expect(vehicleInScope(v('KMH-NX4-0001'), 'FEAT-00022', scope({ featureIds: ['FEAT-00024'] }))).toBe(false);
    expect(vehicleInScope(v('KMH-NX4-0001'), 'FEAT-00022', scope({ productionRegions: ['KMH', 'HMA'], swVersions: ['1.2.1'] }))).toBe(true);
    expect(vehicleInScope(v('KMH-NX4-0001', { swVersion: '1.2.0' }), 'FEAT-00022', scope({ productionRegions: ['KMH'], swVersions: ['1.2.1'] }))).toBe(false);
    expect(vehicleInScope(v('KMH-NX4-0001'), 'FEAT-00022', scope({ marketRegions: ['US'] }))).toBe(false);
    expect(vehicleInScope(v('KMH-NX4-0001'), 'FEAT-00022', scope({ variantRules: ['F111A114001'], vins: ['KMH-NX4-0001'] }))).toBe(true);
  });

  it('차량 그룹은 생산 지역·적용 지역·Variant·SW 버전별, 큰 묶음 먼저', () => {
    const g = vehicleGroups([v('KMH-NX4-0001'), v('KMH-NX4-0002', { swVersion: '1.2.0' }), v('KMH-NX4-0003')]);
    expect(g.map((x) => [x.productionRegion, x.swVersion, x.vins.length])).toEqual([
      ['KMH', '1.2.1', 2],
      ['KMH', '1.2.0', 1],
    ]);
  });

  it('정책 롤백은 flag 단위 — 범위가 배포 대상 전부를 덮지 못하면 막는다', () => {
    expect(scopeBlockers(['A', 'B'], ['A', 'B'])).toEqual([]);
    expect(scopeBlockers(['A', 'B'], ['A'])).toEqual(['SCOPE_PARTIAL']);
    expect(scopeBlockers(['A'], [])).toEqual(['SCOPE_EMPTY']);
    expect(scopeBlockers([], [])).toEqual([]);
  });
});

describe('롤백 — 복구 기준 버전', () => {
  const facts = (over: Partial<RecoveryFacts> = {}): RecoveryFacts => ({
    policy: { policyId: 'POL-00004', flagKey: 'care_00022_param', status: 'RETIRED', contentHash: 'sha256:old', approvedBy: 'usr-approver', deployedAt: '2026-10-10T00:00:00.000Z' },
    current: { policyId: 'POL-00005', flagKey: 'care_00022_param', contentHash: 'sha256:new' },
    validatedGo: true,
    artifact: { status: 'CONFIRMED', signatureValid: true },
    featureDeployable: true,
    ...over,
  });

  it('배포 완료·검증 통과·운영 승인·서명된 배포 산출물을 모두 갖추면 복구 가능', () => {
    expect(recoveryBlockers(facts())).toEqual([]);
    expect(recoveryBlockers(facts({ artifact: { status: 'PARTIAL', signatureValid: true } }))).toEqual([]);
  });

  it('하나라도 없으면 사유를 모두 돌려준다 (fail-closed)', () => {
    expect(recoveryBlockers(facts({ policy: null }))).toEqual(['RECOVERY_NOT_FOUND']);
    expect(recoveryBlockers(facts({ validatedGo: false, artifact: null }))).toEqual(['GATE_NOT_PASSED', 'NO_ARTIFACT']);
    expect(recoveryBlockers(facts({ artifact: { status: 'TIMEOUT', signatureValid: false } }))).toEqual(['ARTIFACT_SIGNATURE_INVALID', 'ARTIFACT_NOT_COMPLETED']);
    const never = facts();
    never.policy = { ...never.policy!, deployedAt: null, approvedBy: null, flagKey: 'other_flag' };
    expect(recoveryBlockers(never)).toEqual(['RECOVERY_OTHER_FLAG', 'NOT_DEPLOYED_BEFORE', 'NOT_APPROVED']);
    expect(recoveryBlockers(facts({ current: { policyId: 'POL-00004', flagKey: 'care_00022_param', contentHash: 'sha256:old' } }))).toEqual(['RECOVERY_IS_CURRENT']);
    expect(recoveryBlockers(facts({ current: { policyId: 'POL-00005', flagKey: 'care_00022_param', contentHash: 'sha256:old' } }))).toEqual(['RECOVERY_SAME_CONTENT']);
    expect(recoveryBlockers(facts({ featureDeployable: false }))).toEqual(['FEATURE_NOT_DEPLOYABLE']);
  });
});

describe('롤백 — 자동 조건', () => {
  it('DTC 유형은 첫 자리 상위 2비트(SAE J2012)', () => {
    expect(['012345', '4A0001', '8B0002', 'C10003'].map(dtcType)).toEqual(['P', 'C', 'B', 'U']);
  });

  it('배포 실패율은 기준값을 넘어야(초과) 조건 충족', () => {
    expect(failureRate(8, 10)).toBe(20);
    const c = RollbackConditions.parse({ failureRate: { thresholdPercent: 20 } });
    expect(failureRateTrigger(c, 8, 10)).toBeNull();
    expect(failureRateTrigger(c, 7, 10)).toMatchObject({ kind: 'FAILURE_RATE', detail: expect.stringContaining('30%') });
    expect(failureRateTrigger(c, 0, 0)).toBeNull();
    expect(failureRateTrigger(RollbackConditions.parse({ dtc: { types: ['U'] } }), 0, 10)).toBeNull();
  });

  it('등록한 DTC 코드 또는 유형이 발생하면 조건 충족', () => {
    const c = RollbackConditions.parse({ dtc: { codes: ['4A0001'], types: ['U'] } });
    expect(dtcTrigger(c, 'KMH-NX4-0001', ['012345'])).toBeNull();
    expect(dtcTrigger(c, 'KMH-NX4-0001', ['012345', '4A0001'])).toMatchObject({ kind: 'DTC', detail: expect.stringContaining('4A0001') });
    expect(dtcTrigger(c, 'KMH-NX4-0001', ['C10003'])).toMatchObject({ kind: 'DTC', detail: expect.stringContaining('U 네트워크') });
    expect(dtcTrigger(RollbackConditions.parse({ failureRate: { thresholdPercent: 5 } }), 'V', ['C10003'])).toBeNull();
  });
});

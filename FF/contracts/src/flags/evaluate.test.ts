// 단일 평가기 + 검증기 8종 — FEAT-00022(전방 안전거리 3단계)와 데모 Fleet으로 PoC ②③ 판단을 고정한다.
import { judgeVirtual, virtualScenariosFor } from '../rules/virtual';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Policy, Vehicle } from '../schemas/policy';
import { loadDataset } from '../testing/fixtures';
import { deploySafety, runValidators, type ValidationInput } from '../rules/validators';
import { evaluateFlag, type PolicyScope } from './evaluate';

const fleet: Vehicle[] = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'data', 'fixtures', 'demo', 'fleet.json'), 'utf8'));
const V = (vin: string) => fleet.find((v) => v.vin === vin)!;
const ds = loadDataset();
const f22 = ds.features.find((f) => f.featureId === 'FEAT-00022')!;
const scope: PolicyScope = { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' };

const policy = (p: Partial<Policy> = {}): Policy => ({
  policyId: 'POL-00001',
  revision: 1,
  status: 'DEPLOYED',
  contentHash: 'h',
  createdBy: 'usr-author',
  createdAt: '2026-10-12T00:00:00Z',
  approvedBy: 'usr-approver',
  approvedAt: '2026-10-12T00:00:00Z',
  lastValidationId: null,
  stageBasisPoints: null,
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  controlPoint: 'Parameter',
  flagKey: 'care_00022_param',
  description: '전방 안전거리 3단계 활성화',
  enabled: true,
  safeDefault: false,
  entitlementCatalogId: 'CAT-00019',
  strategies: [],
  rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' },
  ...p,
});
const ev = (p: Partial<Policy>, vin: string, opts: { killed?: boolean; ent?: boolean | null } = {}) =>
  evaluateFlag({ policy: policy(p), scope, killed: opts.killed ?? false, vehicle: V(vin), entitlementActive: opts.ent === undefined ? true : opts.ent });

describe('Flag 평가 — PoC ③ 서버 활성화 판단', () => {
  it('체험권이 유효한 ego-01은 ALLOW → ON', async () => {
    const r = await ev({}, 'ego-01');
    expect(r).toMatchObject({ value: true, variant: 'on', decision: 'ALLOW', reason: 'POLICY_MATCH' });
    expect(r.trace.map((t) => t.step)).toEqual(['DEPLOYED', 'KILL', 'APPLICABILITY', 'ENTITLEMENT', 'TARGETING', 'COHORT', 'DECIDE']);
  });
  it('체험권이 없으면 DENY(NO_ENTITLEMENT) → OFF', async () => {
    expect(await ev({}, 'KMH-NX4-0002', { ent: false })).toMatchObject({ value: false, decision: 'DENY', reason: 'NO_ENTITLEMENT' });
  });
  it('긴급 차단이 모든 조건보다 먼저 — Safe Default', async () => {
    expect(await ev({}, 'ego-01', { killed: true })).toMatchObject({ value: false, decision: 'SAFE_DEFAULT', reason: 'KILL_SWITCH' });
  });
  it('범위 밖 차량(EU)은 NOT_APPLICABLE', async () => {
    expect(await ev({}, 'TMA-NX4-0001')).toMatchObject({ value: false, reason: 'NOT_APPLICABLE' });
  });
  it('오래된 문맥(STALE)은 HOLD → Safe Default (P0: UNKNOWN은 판단하지 않는다)', async () => {
    expect(await ev({ safeDefault: false }, 'KMH-NX4-0003')).toMatchObject({ value: false, decision: 'HOLD', reason: 'CONTEXT_UNKNOWN' });
  });
  it('배포 전 정책은 평가하지 않는다', async () => {
    expect(await ev({ status: 'APPROVED' }, 'ego-01')).toMatchObject({ reason: 'NOT_DEPLOYED', value: false });
  });
  it('대상 전략: SW 1.2.0 이상만 (SEMVER) — 구형 SW 차량은 TARGETING_MISS', async () => {
    const strategies = [{ name: 'SW 1.2.0+', constraints: [{ contextName: 'swVersion', operator: 'SEMVER_LT' as const, values: ['1.2.0'], inverted: true, caseInsensitive: false }] }];
    expect(await ev({ strategies }, 'ego-01')).toMatchObject({ decision: 'ALLOW' });
    expect(await ev({ strategies, entitlementCatalogId: null }, 'KMH-NX4-0004')).toMatchObject({ decision: 'DENY', reason: 'TARGETING_MISS' });
  });
  it('코호트: FP-COHORT-1 버킷 기준 — 0%면 모두 COHORT_MISS, 100%면 모두 ALLOW, 결과는 결정적', async () => {
    expect(await ev({ rollout: { mode: 'COHORT', basisPoints: 0, salt: 'S' } }, 'ego-01')).toMatchObject({ reason: 'COHORT_MISS' });
    expect(await ev({ rollout: { mode: 'COHORT', basisPoints: 10000, salt: 'S' } }, 'ego-01')).toMatchObject({ decision: 'ALLOW' });
    const a = await ev({ rollout: { mode: 'COHORT', basisPoints: 5000, salt: 'S' } }, 'ego-01');
    const b = await ev({ rollout: { mode: 'COHORT', basisPoints: 5000, salt: 'S' } }, 'ego-01');
    expect(a.decision).toBe(b.decision);
  });
  it('단계 배포: 승인 범위(ALL) 안에서 단계 0%면 아무도, 단계는 승인 범위를 넓힐 수 없다', async () => {
    expect(await ev({ stageBasisPoints: 0 }, 'ego-01')).toMatchObject({ reason: 'COHORT_MISS' });
    expect(await ev({ rollout: { mode: 'COHORT', basisPoints: 0, salt: 'S' }, stageBasisPoints: 10000 }, 'ego-01')).toMatchObject({ reason: 'COHORT_MISS' });
  });
});

const input = (p: Partial<Policy> = {}, over: Partial<ValidationInput> = {}): ValidationInput => ({
  policy: policy({ status: 'DRAFT', ...p }),
  feature: f22,
  gates: { G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: 'PASS', G6: 'PASS', G7: 'PASS', G8: 'PASS', G9: 'PASS' },
  requiresTargets: [{ dependencyId: 'DEP-00013', targetFeatureId: 'FEAT-00145', targetVersion: '5.4.2', targetLifecycle: 'RELEASED' }],
  trace: f22.swIds.map((swId, i) => ({ swId, swVersion: f22.swVersions[i], ecuPno: f22.ecuPnos[i], swFound: true, ecuActive: true })),
  activePolicies: [],
  flagKeyClash: [],
  fleet,
  affectedProducts: [],
  entitlementProductOk: true,
  ...over,
});

describe('PoC ② 분야별 검증 8종 + 배포 안전성', () => {
  it('FEAT-00022 정상 정책은 8종 모두 PASS → GO', async () => {
    const r = await runValidators(input());
    expect(r.map((x) => x.componentId)).toEqual(['D06-01', 'D03-01', 'D06-03', 'D06-06', 'D06-02', 'D06-05', 'D04-02', 'D06-07']);
    expect(r.filter((x) => x.result !== 'PASS')).toEqual([]);
    expect(deploySafety(r)).toEqual({ decision: 'GO', reasons: [] });
    // 통신 지연(STALE) 차량은 HOLD — Safe Default 유지는 결함이 아니라 요약에만 남는다
    expect(r.find((x) => x.componentId === 'D06-03')!.summary).toMatch(/HOLD\(Safe Default\) 1/);
  });

  it.each([
    ['없는 제어점', { controlPoint: 'DTC' as const }, {}, 'D06-01', 'FAIL'],
    ['모순 조건', { strategies: [{ name: 'X', constraints: [{ contextName: 'country', operator: 'IN' as const, values: ['KR'], inverted: false, caseInsensitive: false }, { contextName: 'country', operator: 'IN' as const, values: ['EU'], inverted: false, caseInsensitive: false }] }] }, {}, 'D06-01', 'FAIL'],
    ['ASIL B인데 Safe Default ON', { safeDefault: true }, {}, 'D03-01', 'FAIL'],
    ['권한 상품에 Feature 없음', {}, { entitlementProductOk: false }, 'D03-01', 'FAIL'],
    ['G4 미판정', {}, { gates: { G2: 'PASS', G5: 'PASS', G7: 'PASS' } as any }, 'D06-06', 'FAIL'],
    ['SW 기준정보 없음', {}, { trace: [{ swId: 'SW-X', swVersion: '9', ecuPno: 'E', swFound: false, ecuActive: true }] }, 'D06-02', 'FAIL'],
    ['필요 Feature 미성숙', {}, { requiresTargets: [{ dependencyId: 'DEP-1', targetFeatureId: 'FEAT-00145', targetVersion: '5.4.2', targetLifecycle: 'DEVELOPING' as const }] }, 'D06-05', 'CONDITIONAL'],
    ['G5 검토 중', {}, { gates: { G2: 'PASS', G4: 'PASS', G5: '검토 중', G7: 'PASS' } as any }, 'D04-02', 'CONDITIONAL'],
    ['G7 미판정(ASIL B)', {}, { gates: { G2: 'PASS', G4: 'PASS', G5: 'PASS' } as any }, 'D06-07', 'CONDITIONAL'],
    ['범위 안 차량이 하나도 활성화 안 됨', { enabled: false }, {}, 'D06-03', 'CONDITIONAL'],
  ] as const)('%s → %s %s', async (_n, p, over, id, expected) => {
    const r = await runValidators(input(p as any, over as any));
    expect(r.find((x) => x.componentId === id)!.result).toBe(expected);
    expect(deploySafety(r).decision).toBe(expected === 'FAIL' ? 'BLOCKED' : 'HOLD');
  });
  // 회귀: 배포된 정책의 새 개정은 늘 "대체" 사실과 "출시 상품 영향"이 생긴다 — 이것이 HOLD면 출시된 Feature의 정책을 영영 고칠 수 없었다.
  it('배포 정책 대체·출시 상품 영향은 알림(INFO) — 기록은 남고 판정은 GO', async () => {
    const r = await runValidators(
      input({}, {
        activePolicies: [{ policyId: 'POL-00002', revision: 1, status: 'DEPLOYED', controlPoint: 'Parameter' }] as any,
        affectedProducts: [{ catalogId: 'CAT-00013', version: '1.0.0', lifecycle: 'RELEASED' }],
      } as any),
    );
    const pol = r.find((x) => x.componentId === 'D06-01')!;
    const imp = r.find((x) => x.componentId === 'D06-05')!;
    expect([pol.result, imp.result]).toEqual(['PASS', 'PASS']);
    expect(pol.findings).toEqual([{ result: 'INFO', message: expect.stringContaining('POL-00002 r1을(를) 대체합니다') }]);
    expect(imp.findings).toEqual([{ result: 'INFO', message: expect.stringContaining('CAT-00013') }]);
    expect(pol.summary).toContain('대체합니다');
    expect(deploySafety(r)).toEqual({ decision: 'GO', reasons: [] });
  });
});

describe('vECU 가상검증 → 차량 시나리오(D06-03)·안전 동작(D06-06) 검증', () => {
  const [NOM, FK] = virtualScenariosFor('FEAT-00022');
  const crit = (over: Record<string, string> = {}) =>
    ['kill_latency', 'misjudge', 'danger_time', 'min_ttc', 'max_decel', 'recovery'].map((id) => ({ id, label: id, unit: 's', op: '<=', limit: 1, status: (over[id] ?? 'pass') as any, value: 0.3, at: 1 }));
  const run = (scenario: typeof NOM, over: Record<string, string> = {}, source: 'vecu' | 'unavailable' = 'vecu') => {
    const j = judgeVirtual(crit(over), scenario);
    return { runId: 'VV-00001', source, testId: 'TEST-x', gateResult: source === 'vecu' ? j.gateResult : ('UNAVAILABLE' as const), overall: 'PASS' as const, criteria: j.criteria, contentHash: 'h' };
  };

  it('판정 기준: 정상 추종은 모든 기준, 오류+Kill은 Kill 경로(지연·복귀·감속)만', () => {
    expect(judgeVirtual(crit({ danger_time: 'fail' }), NOM).gateResult).toBe('FAIL');
    expect(judgeVirtual(crit({ danger_time: 'fail', misjudge: 'fail' }), FK).gateResult).toBe('PASS');
    expect(judgeVirtual(crit({ kill_latency: 'fail' }), FK).gateResult).toBe('FAIL');
    expect(judgeVirtual(crit({ recovery: 'pending' }), FK).gateResult).toBe('FAIL'); // 끝나지 않은 기준은 통과가 아니다
  });

  it('미실행·vECU 미연결은 HOLD — 증적 없이 GO 불가', async () => {
    let r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: null }, { scenario: FK, run: null }] }));
    expect(deploySafety(r).decision).toBe('HOLD');
    expect(r.find((x) => x.componentId === 'D06-03')!.findings[0].message).toMatch(/SCN-FEAT00022-NOMINAL 미실행/);
    r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run(NOM, {}, 'unavailable') }, { scenario: FK, run: run(FK) }] }));
    expect(r.find((x) => x.componentId === 'D06-03')!.result).toBe('CONDITIONAL');
  });

  it('정상 추종 FAIL → 차량 시나리오 검증 FAIL → BLOCKED', async () => {
    const r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run(NOM, { min_ttc: 'fail' }) }, { scenario: FK, run: run(FK) }] }));
    expect(r.find((x) => x.componentId === 'D06-03')!.result).toBe('FAIL');
    expect(deploySafety(r).decision).toBe('BLOCKED');
  });

  it('둘 다 PASS → GO. 오류 주입 구간 위험은 의도된 결과로 INFO에 남는다', async () => {
    const r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run(NOM) }, { scenario: FK, run: run(FK, { danger_time: 'fail' }) }] }));
    expect(deploySafety(r)).toEqual({ decision: 'GO', reasons: [] });
    const sb = r.find((x) => x.componentId === 'D06-06')!;
    expect(sb.result).toBe('PASS');
    expect(sb.findings.map((f) => f.result)).toEqual(['INFO', 'INFO']);
    expect(sb.findings[1].message).toMatch(/의도된 결과/);
  });
});

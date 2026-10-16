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
  it('FFG-VEH-006 지원 조건 불만족(SW 미달) 차량은 체험권이 있어도 DENY(NOT_SUPPORTED) — 사유를 trace로 보고, 판정 불명은 Safe Default', async () => {
    const sup = (verdict: 'APPLICABLE' | 'NOT_SUPPORTED' | 'UNKNOWN', reason: string) =>
      evaluateFlag({ policy: policy(), scope, killed: false, vehicle: V('ego-01'), entitlementActive: true, support: { verdict, reason } });
    const no = await sup('NOT_SUPPORTED', 'SW 1.1.9 < 요구 1.2.1');
    expect(no).toMatchObject({ value: false, decision: 'DENY', reason: 'NOT_SUPPORTED' });
    expect(no.trace.find((t) => t.step === 'SUPPORT')).toEqual({ step: 'SUPPORT', result: 'FALSE', detail: 'SW 1.1.9 < 요구 1.2.1' });
    expect(await sup('UNKNOWN', '문맥 STALE')).toMatchObject({ value: false, decision: 'HOLD', reason: 'CONTEXT_UNKNOWN' });
    const ok = await sup('APPLICABLE', 'SW 1.2.1 ≥ 1.2.1');
    expect(ok).toMatchObject({ value: true, reason: 'POLICY_MATCH' });
    expect(ok.trace.map((t) => t.step)).toEqual(['DEPLOYED', 'KILL', 'APPLICABILITY', 'SUPPORT', 'ENTITLEMENT', 'TARGETING', 'COHORT', 'DECIDE']);
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

describe('가상검증(CARLA) → 차량 시나리오(D06-03)·안전 동작(D06-06) 검증 (FFG-TST-009 · FFG-LCY-006)', () => {
  const [NOM, ONB, BASE] = virtualScenariosFor('FEAT-00022');
  const REPRO = { toolVersion: 'ff-carla 1.0', scenarioHash: 'a'.repeat(64), scriptHash: 'b'.repeat(64), seed: 0 };
  const crit = (over: Record<string, string> = {}) =>
    ['kill_latency', 'detect_latency', 'ftti_margin', 'misjudge', 'danger_time', 'min_ttc', 'max_decel', 'recovery'].map((id) => ({ id, label: id, unit: 's', op: '<=', limit: 1, status: (over[id] ?? 'pass') as any, value: 0.3, at: 1 }));
  const run = (over: Record<string, string> = {}, source: 'carla' | 'vecu' | 'unavailable' = 'carla', repro: unknown = REPRO) => {
    const j = judgeVirtual(crit(over), repro);
    return { runId: 'VV-00001', source, testId: 'TEST-x', gateResult: source !== 'unavailable' ? j.gateResult : ('UNAVAILABLE' as const), gateReasons: j.reasons, overall: 'PASS' as const, criteria: j.criteria, contentHash: 'h' };
  };

  it('시나리오: 정상 추종(D06-03)·차량 내 감지(D06-06)가 결정하고, 원격 DC2만 쓴 실행은 비교 기준선(검증기 없음)', () => {
    expect([NOM, ONB, BASE].map((s) => [s.role, s.validator])).toEqual([['NOMINAL', 'D06-03'], ['FAULT_ONBOARD', 'D06-06'], ['BASELINE_REMOTE', 'BASELINE']]);
    expect(ONB.params.onboard).toMatchObject({ rel_pct: 20, debounce_s: 0.2 });
    expect(BASE.params.kill).toEqual({ at_s: 48 });
  });

  it('회귀(12.7 알려진 실패로 G5 통과 금지): 오류 주입 구간의 위험·오판단도 판정 기준 — 정보 항목으로 면제하지 않는다', () => {
    // 이전 실행기 1.x 방식은 오류+Kill 시나리오에서 danger_time·misjudge를 빼고 PASS를 냈다(종합 FAIL과 어긋남)
    expect(judgeVirtual(crit({ danger_time: 'fail', misjudge: 'fail' }), REPRO)).toMatchObject({ gateResult: 'FAIL' });
    expect(judgeVirtual(crit({ danger_time: 'fail' }), REPRO).reasons).toEqual(['danger_time 0.3s (기준 ≤ 1)']);
    expect(judgeVirtual(crit({ recovery: 'pending' }), REPRO).gateResult).toBe('FAIL'); // 끝나지 않은 기준은 통과가 아니다
    expect(judgeVirtual(crit({ kill_latency: 'na' }), REPRO)).toMatchObject({ gateResult: 'PASS' }); // 해당 없음은 판정에서 뺀다
    expect(judgeVirtual(crit({ kill_latency: 'na' }), REPRO).criteria.find((c) => c.id === 'kill_latency')!.deciding).toBe(false);
  });

  it('재현 정보(도구 Version·시나리오 해시·판정 스크립트 해시·시드)가 없으면 모든 기준이 통과해도 근거가 아니다', () => {
    expect(judgeVirtual(crit(), null)).toMatchObject({ gateResult: 'FAIL', reasons: [expect.stringMatching(/재현 정보/)] });
    expect(judgeVirtual(crit(), { ...REPRO, scriptHash: 'x' }).gateResult).toBe('FAIL');
    expect(judgeVirtual(crit(), REPRO)).toMatchObject({ gateResult: 'PASS', reasons: [] });
  });

  it('미실행·실행기 미연결은 HOLD — Evidence 없이 GO 불가', async () => {
    let r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: null }, { scenario: ONB, run: null }] }));
    expect(deploySafety(r).decision).toBe('HOLD');
    expect(r.find((x) => x.componentId === 'D06-03')!.findings[0].message).toMatch(/SCN-FEAT00022-NOMINAL 미실행/);
    r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run({}, 'unavailable') }, { scenario: ONB, run: run() }] }));
    expect(r.find((x) => x.componentId === 'D06-03')!.result).toBe('CONDITIONAL');
  });

  it('정상 추종 FAIL → 차량 시나리오 검증 FAIL → BLOCKED', async () => {
    const r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run({ min_ttc: 'fail' }) }, { scenario: ONB, run: run() }] }));
    expect(r.find((x) => x.componentId === 'D06-03')!.result).toBe('FAIL');
    expect(deploySafety(r).decision).toBe('BLOCKED');
  });

  it('차량 내 감지에서 위험 구간이 남거나 재현 정보가 없으면 안전 동작 검증 FAIL — 기준선 실행은 검증기에 쓰이지 않는다', async () => {
    let r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run() }, { scenario: ONB, run: run({ danger_time: 'fail' }) }, { scenario: BASE, run: run({ danger_time: 'fail' }) }] }));
    expect(r.find((x) => x.componentId === 'D06-06')!.result).toBe('FAIL');
    r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run() }, { scenario: ONB, run: run({}, 'carla', null) }] }));
    expect(r.find((x) => x.componentId === 'D06-06')!.findings[0].message).toMatch(/재현 정보/);
    r = await runValidators(input({}, { virtual: [{ scenario: NOM, run: run() }, { scenario: ONB, run: run() }, { scenario: BASE, run: run({ danger_time: 'fail' }) }] }));
    expect(deploySafety(r)).toEqual({ decision: 'GO', reasons: [] });
    expect(r.find((x) => x.componentId === 'D06-06')!.findings.map((f) => f.result)).toEqual(['INFO']);
  });
});

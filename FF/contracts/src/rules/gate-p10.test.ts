// P10 — Gate 4상태·Go/No-Go·N/A 규칙, Gate 자동 검사, 반려·재작업·즉시 폐기·Retired 관문, 판정 근거 필수
import { describe, expect, it } from 'vitest';
import type { GateId, GateStatus, Lifecycle } from '../enums';
import type { FeatureVersionRow } from '../schemas/dataset';
import { JudgeGateBody } from '../schemas/api';
import { loadDataset } from '../testing/fixtures';
import { GATE_STATUS_SPEC, gateNaBlocker, gateSatisfied, goNoGo } from './gate-outcome';
import { gateChecks, transitionCheckFailures, type GateCheckFacts } from './gate-checks';
import { immediateRetireBlockers, RejectFeatureBody, retirementGateBlockers } from './feature-retire';
import { evaluateTransition, type TransitionContext } from './lifecycle';
import { gateStageBlocker } from './gate-evidence';

const ds = loadDataset();
const base = ds.features.find((f) => f.featureId === 'FEAT-00022')!;
const at = (lc: Lifecycle, patch: Partial<FeatureVersionRow> = {}): FeatureVersionRow => ({ ...base, lifecycle: lc, ...patch });
const all = (s: GateStatus, ...gs: GateId[]) => Object.fromEntries(gs.map((g) => [g, s]));
const ctx = (p: Partial<TransitionContext> = {}): TransitionContext => ({ latestGates: {}, dependencies: [], policyCoverage: 99, ...p });
const codes = (r: ReturnType<typeof evaluateTransition>) => r.blockers.map((b) => b.code);

const facts = (p: Partial<GateCheckFacts> = {}): GateCheckFacts => ({
  ownerId: 'kim.author',
  asil: 'B',
  requires: [],
  variant: { country: 'KR', vehicleModel: 'NE', trim: 'Premium', upgVc: ['UPG-VC-01'] },
  tests: { required: 2, withEvidence: 2, missing: [] },
  analysis: { hara: true, tara: false, securityRelevant: false },
  controlPoints: 1,
  swCount: 1,
  policies: [{ policyId: 'POL-00001', flagKey: 'care_00022_param', status: 'APPROVED', safeDefault: false, rolloutMode: 'ALL' }],
  flags: [{ flagKey: 'care_00022_param', bound: true, retired: false }],
  priorReleased: null,
  telemetry: { connected: true },
  auditEntries: 3,
  alertRules: ['kill.issued', 'anomaly.opened', 'rollout.halt-required', 'rollback.failed'].map((event) => ({ event, name: event, recipients: 2 })),
  ...p,
});
const failed = (p: Partial<GateCheckFacts>) => gateChecks(facts(p)).filter((x) => !x.pass).map((x) => x.key);

describe('Gate 상태 4값·Go/No-Go (FR-REG-005-008·009)', () => {
  it('저장 상태 → 명세 PASS·PENDING·FAIL·N/A', () => {
    expect(GATE_STATUS_SPEC).toEqual({ PASS: 'PASS', '검토 중': 'PENDING', FAIL: 'FAIL', 'N/A': 'N/A' });
    expect(gateSatisfied('N/A')).toBe(true);
    expect(gateSatisfied('검토 중')).toBe(false);
  });
  it('FAIL이 1건이면 No-Go, 모두 PASS면 Go, N/A는 필수에서 빠짐, 미판정은 판정 중', () => {
    const allPass = all('PASS', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9');
    expect(goNoGo(allPass).result).toBe('GO');
    expect(goNoGo({ ...allPass, G6: 'FAIL' })).toMatchObject({ result: 'NO_GO', failed: ['G6'] });
    expect(goNoGo({ ...allPass, G8: 'N/A' })).toMatchObject({ result: 'GO', notApplicable: ['G8'] });
    expect(goNoGo({ ...allPass, G8: 'N/A' }).required).not.toContain('G8');
    expect(goNoGo({ G1: 'PASS' })).toMatchObject({ result: 'PENDING' });
    expect(goNoGo({ ...allPass, G5: '검토 중', G6: 'FAIL' }).result).toBe('NO_GO');
  });
  it('N/A로 둘 수 없는 Gate — G1·G4·G9 언제나, G2·G7은 QM만', () => {
    for (const g of ['G1', 'G4', 'G9'] as const) expect(gateNaBlocker(g, 'QM')).toMatch(/해당 없음으로 둘 수 없습니다/);
    expect(gateNaBlocker('G7', 'B')).toMatch(/QM Feature만/);
    expect(gateNaBlocker('G7', 'QM')).toBeNull();
    expect(gateNaBlocker('G8', 'D')).toBeNull();
  });
  it('승인된 N/A는 전이·단계 순서를 막지 않는다', () => {
    const g = { ...all('PASS', 'G1', 'G2'), G3: 'N/A' as GateStatus };
    expect(codes(evaluateTransition(at('PROPOSED'), 'APPROVED', ctx({ latestGates: g })))).not.toContain('GATE_NOT_PASSED');
    expect(gateStageBlocker({ lifecycle: 'DEVELOPING', gate: 'G4', role: 'GATE_JUDGE', latest: g })).toBeNull();
  });
  it('판정 근거 필수 — FAIL·CONDITIONAL도 Evidence 1건 이상(FR-REG-005-011)', () => {
    expect(JudgeGateBody.safeParse({ gate: 'G1', inputResult: 'FAIL', rationale: '누락 확인', evidenceRef: null }).success).toBe(false);
    expect(JudgeGateBody.safeParse({ gate: 'G1', inputResult: 'CONDITIONAL', rationale: '누락 확인' }).success).toBe(false);
    expect(JudgeGateBody.safeParse({ gate: 'G1', inputResult: 'FAIL', rationale: '누락 확인', evidenceRef: 'EV-1' }).success).toBe(true);
  });
});

describe('Gate 자동 검사 (FR-REG-005-001·002·004·006·007·020)', () => {
  it('모두 갖추면 실패 없음', () => expect(failed({})).toEqual([]));
  it('G1 — Owner 없음·requires 대상이 RELEASED가 아님', () => {
    expect(failed({ ownerId: ' ' })).toEqual(['OWNER']);
    expect(failed({ requires: [{ dependencyId: 'DEP-00001', targetFeatureId: 'FEAT-00001', targetVersion: '1.0.0', targetLifecycle: 'VERIFIED' }] })).toEqual(['REQUIRES_RELEASED']);
    expect(failed({ requires: [{ dependencyId: 'DEP-00001', targetFeatureId: 'FEAT-00001', targetVersion: '1.0.0', targetLifecycle: 'RELEASED' }] })).toEqual([]);
  });
  it('G3 — UPG-VC 등 Variant 조건 미등록', () => expect(failed({ variant: { country: 'KR', vehicleModel: 'NE', trim: '', upgVc: [] } })).toEqual(['VARIANT_RULE']));
  it('G4 — Safe Default(ASIL B 이상 ON 금지)·Rollback Plan·긴급 차단 Flag 결속', () => {
    const on = [{ policyId: 'POL-00001', flagKey: 'care_00022_param', status: 'APPROVED', safeDefault: true, rolloutMode: 'ALL' as const }];
    expect(failed({ policies: on })).toEqual(['SAFE_DEFAULT', 'ROLLBACK_PLAN']);
    expect(failed({ policies: on, asil: 'QM', priorReleased: '1.0.0' })).toEqual([]);
    expect(failed({ flags: [{ flagKey: 'care_00022_param', bound: true, retired: true }] })).toEqual(['KILL_READY', 'TELEMETRY']);
    expect(failed({ controlPoints: 2 })).toEqual(['SAFE_DEFAULT']);
  });
  it('G5 — 필수 Test Case Evidence·안전 등급 HARA·보안 관련 TARA', () => {
    expect(failed({ tests: { required: 2, withEvidence: 1, missing: ['TC-1'] } })).toEqual(['TEST_EVIDENCE']);
    expect(failed({ analysis: { hara: false, tara: false, securityRelevant: true } })).toEqual(['SAFETY_EVIDENCE']);
    expect(failed({ asil: 'QM', analysis: { hara: false, tara: false, securityRelevant: false } })).toEqual([]);
  });
  it('G8 — 승인되지 않은 정책·보낼 것(OTA SW·Flag 정책) 없음은 배포 방식 미확정', () => {
    expect(failed({ policies: [{ policyId: 'POL-00001', flagKey: 'care_00022_param', status: 'DRAFT', safeDefault: false, rolloutMode: 'COHORT' }] })).toEqual(['DEPLOY_METHOD']);
    expect(gateChecks(facts({ swCount: 0, policies: [], flags: [] })).find((x) => x.key === 'DEPLOY_METHOD')!.pass).toBe(false);
    expect(gateChecks(facts({ policies: [], flags: [] })).find((x) => x.key === 'DEPLOY_METHOD')!.pass).toBe(true);
  });
  it('G9 — Lake 연결·감사 기록·운영 경보 수신자', () => {
    expect(failed({ telemetry: { connected: false } })).toEqual(['TELEMETRY']);
    expect(failed({ auditEntries: 0 })).toEqual(['AUDIT_LOG']);
    expect(failed({ alertRules: [] })).toEqual(['ALERT_RULE']);
  });
  it('전이는 자기 Gate의 실패 검사만 막는다 — 정의 승인 G1·G3, 검증 완료 G4·G5, 출시 G8·G9', () => {
    const checks = gateChecks(facts({ ownerId: '', auditEntries: 0 }));
    expect(transitionCheckFailures('APPROVED', checks).map((x) => x.key)).toEqual(['OWNER']);
    expect(transitionCheckFailures('RELEASED', checks).map((x) => x.key)).toEqual(['AUDIT_LOG']);
    expect(transitionCheckFailures('VERIFIED', checks)).toEqual([]);
    const r = evaluateTransition(at('VERIFIED'), 'RELEASED', ctx({ latestGates: all('PASS', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'), releaseSignoff: { signedBy: 'a', signedAt: 'b' }, gateChecks: checks }));
    expect(r.blockers.find((b) => b.code === 'GATE_CHECK_FAILED')?.message).toMatch(/G9 Operations Gate 자동 검사 — 감사 기록/);
  });
});

describe('반려·재작업·즉시 폐기·Retired 관문 (FR-REG-002-010~016, FR-REG-005-017·018)', () => {
  it('반려는 사유·이슈 항목·재작업 사유가 모두 있어야 한다', () => {
    expect(RejectFeatureBody.safeParse({ reason: '요구 누락', issues: [], reworkReason: '보완' }).success).toBe(false);
    expect(RejectFeatureBody.safeParse({ reason: '요구 누락', issues: [{ item: '요구 ID 누락' }], reworkReason: '요구 연결 후 재요청' }).success).toBe(true);
  });
  it('사람이 VERIFIED → DEVELOPING으로 되돌리면 이슈 항목 필수', () => {
    const actor = { id: 'choi.judge', role: 'GATE_JUDGE' as const };
    expect(codes(evaluateTransition(at('VERIFIED'), 'DEVELOPING', ctx({ actor, reason: '재작업' })))).toContain('ISSUE_REQUIRED');
    expect(codes(evaluateTransition(at('VERIFIED'), 'DEVELOPING', ctx({ actor, reason: '재작업', issues: [{ item: '회귀 오류', detail: '' }] })))).toEqual([]);
  });
  it('Retired 관문 — 출시된 적 있는 Version만, 배포 중 Flag·끝나지 않은 Retirement를 막는다', () => {
    const g = { deployedFlags: ['care_00022_param'], openRetirements: [{ retirementId: 'RET-00001', flagKey: 'x_00001_flag', status: 'APPROVED' }] };
    expect(retirementGateBlockers('PROPOSED', g)).toEqual([]);
    expect(retirementGateBlockers('DEPRECATED', g)).toHaveLength(2);
    expect(codes(evaluateTransition(at('DEPRECATED'), 'RETIRED', ctx({ retirementGate: g })))).toContain('RETIREMENT_INCOMPLETE');
    expect(codes(evaluateTransition(at('DEPRECATED'), 'RETIRED', ctx({ retirementGate: { deployedFlags: [], openRetirements: [] } })))).toEqual([]);
  });
  it('즉시 폐기 승인 — 요청자·작성자 승인 불가, 승인 역할만, Retired 관문', () => {
    const gate = { deployedFlags: [], openRetirements: [] };
    const req = { requestedBy: 'kim.author', status: 'PENDING' as const };
    const b = (actor: { id: string; role: string }, lc: Lifecycle = 'DEVELOPING', createdBy: string | null = 'park.author', g = gate) => immediateRetireBlockers({ lifecycle: lc, request: req, actor, createdBy, gate: g }).map((x) => x.code);
    expect(b({ id: 'lee.approver', role: 'FEATURE_APPROVER' })).toEqual([]);
    expect(b({ id: 'kim.author', role: 'FEATURE_APPROVER' })).toEqual(['SEPARATION_OF_DUTY']);
    expect(b({ id: 'park.author', role: 'RELEASE_MANAGER' })).toEqual(['SEPARATION_OF_DUTY']);
    expect(b({ id: 'han.ops', role: 'OPERATOR' })).toEqual(['ROLE']);
    expect(b({ id: 'lee.approver', role: 'FEATURE_APPROVER' }, 'RELEASED', null, { deployedFlags: ['f_00001_flag'], openRetirements: [] })).toEqual(['RETIREMENT_INCOMPLETE']);
    expect(b({ id: 'lee.approver', role: 'FEATURE_APPROVER' }, 'RETIRED')).toEqual(['NO_RULE']);
  });
});

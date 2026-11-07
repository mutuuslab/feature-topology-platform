// 예외 정책·임시 우회(FR-EXC-001·002)·Gate PENDING 예외(FR-REG-005-010)·출시 전 Shadow만(FR-RDD-001-006)·중단 기준 기록(FR-ROL-002-008)
// 우회 불가 4가지(서명·무결성, 긴급 차단 2인 승인, 직무 분리, 멈추기)는 예외로 열 수 없다(사용자 결정 2026-11-07 확정 2).
import { describe, expect, it } from 'vitest';
import {
  CreateExceptionBody,
  EXCEPTION_CHECKS,
  EXCEPTION_MAX_HOURS,
  ExceptionDecisionBody,
  approvalProblems,
  exceptionActive,
  exceptionWaiver,
  finalExpiry,
  gatePendingProblems,
  releaseGateDecision,
  requestProblems,
  stopCriteriaCheck,
  attributeFreshness,
  type ExceptionPolicy,
} from './exception-policy';

const NOW = '2026-11-07T00:00:00.000Z';
const base = (o: Partial<ExceptionPolicy> = {}): ExceptionPolicy => ({
  exceptionId: 'EXC-00001',
  kind: 'BYPASS',
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  policyId: 'POL-00009',
  checks: ['COMPLIANCE_RULE'],
  ruleIds: ['CR-PRV-001'],
  gates: [],
  restriction: 'LIMITED',
  reason: '현장 결함 긴급 대응',
  periodHours: 24,
  dueDate: null,
  residualRisk: null,
  status: 'ACTIVE',
  requestedBy: 'usr-coordinator',
  requestedAt: '2026-11-06T00:00:00.000Z',
  approvals: [],
  rejection: null,
  appliedAt: '2026-11-06T01:00:00.000Z',
  expiresAt: '2026-11-07T01:00:00.000Z',
  applications: [],
  closedAt: null,
  revert: null,
  ...o,
});

describe('예외 요청 등록(FR-EXC-001-001)', () => {
  it('요청자·긴급 사유·대상 Feature·적용 기간·우회할 정책 ID를 받는다 — 적용 기간은 최대치를 넘을 수 없다(무기한 없음)', () => {
    const ok = CreateExceptionBody.safeParse({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: 'POL-00009', checks: ['COMPLIANCE_RULE'], ruleIds: ['CR-PRV-001'], restriction: 'LIMITED', reason: '현장 결함 긴급 대응', periodHours: 24 });
    expect(ok.success).toBe(true);
    expect(CreateExceptionBody.safeParse({ ...ok.data, periodHours: EXCEPTION_MAX_HOURS + 1 }).success).toBe(false);
    expect(CreateExceptionBody.safeParse({ ...ok.data, periodHours: undefined }).success).toBe(false);
  });

  it('우회 불가 4가지는 예외로 요청할 수 없다', () => {
    const forbidden = EXCEPTION_CHECKS.filter((c) => !c.bypassable).map((c) => c.id);
    expect(forbidden).toEqual(['SIGNATURE_INTEGRITY', 'KILL_TWO_PERSON', 'SEPARATION_OF_DUTY', 'STOP_ALWAYS']);
    for (const id of forbidden) {
      const p = requestProblems(CreateExceptionBody.parse({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: 'POL-00009', checks: [id], restriction: 'LIMITED', reason: '긴급 사유 기록', periodHours: 4 }));
      expect(p).toEqual([expect.objectContaining({ code: 'NOT_BYPASSABLE' })]);
    }
  });

  it('임시 우회는 대상 정책·우회할 검사가 있어야 하고, 룰 우회는 룰 ID를 지정해야 하며 Shadow 제한은 쓸 수 없다', () => {
    const b = (o: Record<string, unknown>) => requestProblems(CreateExceptionBody.parse({ kind: 'BYPASS', featureId: 'FEAT-00022', featureVersion: '1.0.0', reason: '긴급 사유 기록', periodHours: 4, restriction: 'LIMITED', ...o }));
    expect(b({ checks: ['COMPLIANCE_RULE'], ruleIds: ['CR-1'] }).map((x) => x.code)).toContain('POLICY_REQUIRED');
    expect(b({ policyId: 'POL-00001' }).map((x) => x.code)).toContain('CHECK_REQUIRED');
    expect(b({ policyId: 'POL-00001', checks: ['COMPLIANCE_RULE'] }).map((x) => x.code)).toContain('RULE_REQUIRED');
    expect(b({ policyId: 'POL-00001', checks: ['FLAG_CODE'], restriction: 'SHADOW' }).map((x) => x.code)).toContain('RESTRICTION');
    expect(b({ policyId: 'POL-00001', checks: ['RELEASE_GATE'] }).map((x) => x.code)).toContain('USE_GATE_EXCEPTION');
    expect(b({ policyId: 'POL-00001', checks: ['FLAG_CODE'] })).toEqual([]);
  });

  it('Gate 예외(FR-REG-005-010)는 Gate·제한 조건·완료 예정일·잔여 리스크가 있어야 하고, PENDING(검토 중·미판정) Gate만 대상이다', () => {
    const g = (o: Record<string, unknown>) => requestProblems(CreateExceptionBody.parse({ kind: 'GATE_PENDING', featureId: 'FEAT-00022', featureVersion: '1.1.0', reason: '긴급 사유 기록', periodHours: 48, restriction: 'PILOT', ...o }));
    expect(g({}).map((x) => x.code)).toEqual(expect.arrayContaining(['GATE_REQUIRED', 'DUE_DATE_REQUIRED', 'RESIDUAL_RISK_REQUIRED']));
    expect(g({ gates: ['G8', 'G9'], dueDate: '2026-11-20', residualRisk: '야간 주행 시험 미완' })).toEqual([]);
    expect(gatePendingProblems(['G8', 'G9'], { G8: '검토 중' })).toEqual([]);
    expect(gatePendingProblems(['G8'], { G8: 'PASS' }).map((x) => x.code)).toEqual(['GATE_PASSED']);
    expect(gatePendingProblems(['G8'], { G8: 'FAIL' }).map((x) => x.code)).toEqual(['GATE_FAILED']);
  });
});

describe('2인 승인·만료(FR-EXC-001-002·002-001~003)', () => {
  const req = base({ status: 'REQUESTED', approvals: [], appliedAt: null, expiresAt: null });
  const approve = (expiresAt = '2026-11-07T12:00:00.000Z') => ExceptionDecisionBody.parse({ decision: 'APPROVE', reason: '긴급 대응 확인', expiresAt });

  it('요청자는 승인할 수 없고(직무 분리), 같은 사람이 두 번 승인할 수 없다', () => {
    expect(approvalProblems(req, 'usr-coordinator', approve(), NOW).map((x) => x.code)).toEqual(['SELF_APPROVAL']);
    const one = { ...req, status: 'APPROVING' as const, approvals: [{ by: 'usr-quality', role: 'SAFETY_OFFICER' as const, at: NOW, reason: 'x', expiresAt: '2026-11-07T12:00:00.000Z' }] };
    expect(approvalProblems(one, 'usr-quality', approve(), NOW).map((x) => x.code)).toEqual(['SAME_APPROVER']);
    expect(approvalProblems(one, 'usr-opslead', approve(), NOW)).toEqual([]);
  });

  it('승인에는 만료 일시가 필수이고 지금 이후·최대 기간 안이어야 한다 — 반려는 사유를 남긴다', () => {
    expect(ExceptionDecisionBody.safeParse({ decision: 'APPROVE', reason: '확인' }).success).toBe(false);
    expect(ExceptionDecisionBody.safeParse({ decision: 'REJECT', reason: '근거 부족' }).success).toBe(true);
    expect(approvalProblems(req, 'usr-quality', approve('2026-11-06T00:00:00.000Z'), NOW).map((x) => x.code)).toEqual(['EXPIRY_PAST']);
    expect(approvalProblems(req, 'usr-quality', approve('2026-12-30T00:00:00.000Z'), NOW).map((x) => x.code)).toEqual(['EXPIRY_TOO_LONG']);
    expect(approvalProblems({ ...req, status: 'REJECTED' }, 'usr-quality', approve(), NOW).map((x) => x.code)).toEqual(['NOT_PENDING']);
  });

  it('만료 일시 = 적용 시각 + 적용 기간과 승인자 지정 만료 중 가장 이른 것', () => {
    expect(finalExpiry(NOW, 24, ['2026-11-07T12:00:00.000Z', '2026-11-07T18:00:00.000Z'])).toBe('2026-11-07T12:00:00.000Z');
    expect(finalExpiry(NOW, 6, ['2026-11-07T12:00:00.000Z'])).toBe('2026-11-07T06:00:00.000Z');
  });

  it('적용 중 = ACTIVE이고 만료 전 — 만료 일시가 지나면 상태와 무관하게 적용하지 않는다', () => {
    expect(exceptionActive(base(), NOW)).toBe(true);
    expect(exceptionActive(base(), '2026-11-07T01:00:00.000Z')).toBe(false);
    expect(exceptionActive(base({ status: 'EXPIRED' }), NOW)).toBe(false);
  });
});

describe('예외 층 — 판정은 그대로, 기록된 범위만 연다', () => {
  it('임시 우회는 같은 Feature·정책·검사에만, 룰 우회는 지정한 룰을 모두 덮어야 한다', () => {
    const list = [base()];
    const q = { featureId: 'FEAT-00022', featureVersion: '1.0.0', policyId: 'POL-00009', check: 'COMPLIANCE_RULE' as const };
    expect(exceptionWaiver(list, { ...q, ruleIds: ['CR-PRV-001'] }, NOW)?.exceptionId).toBe('EXC-00001');
    expect(exceptionWaiver(list, { ...q, ruleIds: ['CR-PRV-001', 'CR-SAF-002'] }, NOW)).toBeNull();
    expect(exceptionWaiver(list, { ...q, policyId: 'POL-00010', ruleIds: ['CR-PRV-001'] }, NOW)).toBeNull();
    expect(exceptionWaiver(list, { ...q, check: 'FLAG_CODE' }, NOW)).toBeNull();
    expect(exceptionWaiver(list, { ...q, ruleIds: ['CR-PRV-001'] }, '2026-11-08T00:00:00.000Z')).toBeNull();
  });

  it('출시 전(G8·G9 미통과) Version은 Shadow만 — 실제 켜기는 출시 뒤', () => {
    const d = releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: { G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: 'PASS', G6: 'PASS', G7: 'PASS' }, exceptions: [], now: NOW });
    expect(d).toMatchObject({ allowed: false, shadowOnly: true, pendingGates: ['G8', 'G9'] });
    expect(releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.0.0', lifecycle: 'RELEASED', latestGates: {}, exceptions: [], now: NOW })).toMatchObject({ allowed: true, cap: null });
    // 출시 전이가 다른 사유(재-HARA 등)로 남았어도 출시 Gate가 통과했으면 배포는 된다 · ODD 축소 정책은 줄이는 조치라 출시 전에도 된다
    expect(releaseGateDecision({ featureId: 'FEAT-00001', featureVersion: '2.1.0', lifecycle: 'VERIFIED', latestGates: { G8: 'PASS', G9: 'PASS' }, exceptions: [], now: NOW })).toMatchObject({ allowed: true, cap: null });
    expect(releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: {}, exceptions: [], now: NOW, narrowing: true })).toMatchObject({ allowed: true });
  });

  it('PENDING Gate 예외가 남은 Gate를 모두 덮으면 제한 조건 범위만 연다 — Gate 판정은 PENDING 그대로, Shadow 제한이면 열지 않는다', () => {
    const gates = { G1: 'PASS', G2: 'PASS', G3: 'PASS', G4: 'PASS', G5: 'PASS', G6: 'PASS', G7: 'PASS', G8: '검토 중' } as const;
    const exc = base({ exceptionId: 'EXC-00002', kind: 'GATE_PENDING', policyId: null, checks: [], ruleIds: [], gates: ['G8', 'G9'], featureVersion: '1.1.0', restriction: 'PILOT', dueDate: '2026-11-20', residualRisk: '야간 시험 미완' });
    const d = releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: gates, exceptions: [exc], now: NOW });
    expect(d).toMatchObject({ allowed: true, cap: 100, exceptionIds: ['EXC-00002'], restriction: 'PILOT' });
    expect(releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: gates, exceptions: [{ ...exc, gates: ['G8'] }], now: NOW }).allowed).toBe(false);
    expect(releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: { ...gates, G9: 'FAIL' }, exceptions: [exc], now: NOW }).allowed).toBe(false);
    expect(releaseGateDecision({ featureId: 'FEAT-00022', featureVersion: '1.1.0', lifecycle: 'VERIFIED', latestGates: gates, exceptions: [{ ...exc, restriction: 'SHADOW' }], now: NOW })).toMatchObject({ allowed: false, shadowOnly: true });
  });
});

describe('중단 기준 충족 여부(FR-ROL-002-008) — 기록만, 중단은 언제나 허용', () => {
  it('열린 이상 징후·진행 중 차단·중단 기준 초과가 있으면 충족, 없으면 미충족 — 어느 쪽도 중단을 막지 않는다', () => {
    expect(stopCriteriaCheck({ openAnomalies: ['ANO-1'], activeKills: [], abort: [] })).toMatchObject({ met: true, allowed: true });
    expect(stopCriteriaCheck({ openAnomalies: [], activeKills: [], abort: [] })).toMatchObject({ met: false, allowed: true, reasonRequired: true });
  });
});

describe('차량 속성 최신성(FR-SUP-004-003)', () => {
  it('기준 시간보다 오래된 보고는 판단하지 않고 최신성 미충족 메시지 — 보고 없음도 미충족', () => {
    expect(attributeFreshness('2026-11-06T12:00:00.000Z', NOW)).toMatchObject({ met: true });
    const old = attributeFreshness('2026-11-05T00:00:00.000Z', NOW);
    expect(old).toMatchObject({ met: false });
    expect(old.message).toMatch(/최신성 미충족/);
    expect(attributeFreshness(null, NOW)).toMatchObject({ met: false });
  });
});

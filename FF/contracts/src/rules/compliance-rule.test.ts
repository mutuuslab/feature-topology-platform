// 컴플라이언스 룰 레지스트리(D03-01, FR-CRC-001·002) — 입력 검증·상태 전이·Major.Minor 버전·유효 기간·적용 대상 선정·배포 검증 판정.
import { describe, expect, it } from 'vitest';
import { loadDataset } from '../testing/fixtures';
import type { Policy } from '../schemas/policy';
import { ComplianceDecisionBody, CreateComplianceRuleBody, UpdateComplianceRuleBody, type ComplianceRule } from '../schemas/compliance-rule';
import {
  applicableRules,
  bumpRuleVersion,
  canMoveRule,
  complianceMarketOf,
  evaluateComplianceRules,
  ruleDiff,
  ruleEffective,
  ruleExpired,
  ruleFeatureCandidates,
  ruleInScope,
} from './compliance-rule';
import { validateCompliance, type ValidationInput } from './validators';

const ds = loadDataset();
const f22 = ds.features.find((f) => f.featureId === 'FEAT-00022')!;

const BODY = {
  ruleId: 'CR-SAF-001',
  name: 'ASIL 기능 Safe Default 꺼짐',
  type: 'SAFETY',
  scope: { markets: ['KR', 'EU'], asil: ['A', 'B', 'C', 'D'] },
  criteria: [{ check: 'SAFE_DEFAULT_OFF' }],
  approverIds: ['usr-quality'],
  evidence: { url: 'https://www.iso.org/standard/68383.html', docName: 'ISO 26262-3', clause: '§7.4.2', memo: '안전 상태 기본값' },
  validFrom: '2026-01-01',
  validTo: null,
};

const rule = (o: Partial<ComplianceRule> = {}): ComplianceRule => ({
  ...(CreateComplianceRuleBody.parse(BODY) as Omit<ComplianceRule, 'version' | 'status'>),
  version: '1.0',
  status: 'APPROVED',
  ownerId: 'usr-steward',
  createdBy: 'usr-steward',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'usr-steward',
  updatedAt: '2026-01-01T00:00:00.000Z',
  decidedBy: 'usr-quality',
  decidedAt: '2026-01-02T00:00:00.000Z',
  retiredAt: null,
  ...o,
});

const policy = (p: Partial<Policy> = {}): Policy => ({
  policyId: 'POL-00001',
  revision: 1,
  status: 'DRAFT',
  contentHash: 'h',
  createdBy: 'usr-author',
  createdAt: '2026-10-12T00:00:00Z',
  approvedBy: null,
  approvedAt: null,
  lastValidationId: null,
  stageBasisPoints: null,
  featureId: 'FEAT-00022',
  featureVersion: '1.0.0',
  controlPoint: 'Parameter',
  flagKey: 'care_00022_param',
  description: 'x',
  enabled: true,
  safeDefault: false,
  entitlementCatalogId: null,
  strategies: [],
  rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' },
  ...p,
});

const input = (p: Partial<Policy> = {}, over: Partial<ValidationInput> = {}): ValidationInput => ({
  policy: policy(p),
  feature: f22,
  gates: { G7: 'PASS' },
  requiresTargets: [],
  trace: [],
  activePolicies: [],
  flagKeyClash: [],
  fleet: [],
  affectedProducts: [],
  entitlementProductOk: true,
  ...over,
});

describe('룰 입력 검증 (FR-CRC-001-001·005~010)', () => {
  it('필수 정보(룰 ID·명칭·유형·적용 지역·검증 기준·승인 대상자)와 근거·유효 기간을 받는다 — 종료일이 없으면 무기한(null)', () => {
    const r = CreateComplianceRuleBody.parse({ ...BODY, validTo: undefined });
    expect(r).toMatchObject({ ruleId: 'CR-SAF-001', type: 'SAFETY', validTo: null, evidence: { docName: 'ISO 26262-3', clause: '§7.4.2' } });
    expect(r.scope).toMatchObject({ featureIds: [], rolloutModes: [], cal: [] });
    for (const k of ['ruleId', 'name', 'type', 'scope', 'criteria', 'approverIds', 'validFrom'] as const) {
      const { [k]: _, ...rest } = BODY;
      expect(CreateComplianceRuleBody.safeParse(rest).success, k).toBe(false);
    }
  });

  it('근거 URL은 http:// 또는 https://만 — 다른 형식은 저장하지 않는다', () => {
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, evidence: { ...BODY.evidence, url: 'http://example.com/a' } }).success).toBe(true);
    for (const url of ['ftp://example.com/a', 'javascript:alert(1)', 'example.com', 'https://'])
      expect(CreateComplianceRuleBody.safeParse({ ...BODY, evidence: { ...BODY.evidence, url } }).success, url).toBe(false);
    // 근거는 URL 또는 문서명 중 하나 이상
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, evidence: { memo: '메모만' } }).success).toBe(false);
  });

  it('유효 종료일은 시작일보다 빠를 수 없다(같은 날은 허용)', () => {
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, validTo: '2025-12-31' }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, validTo: '2026-01-01' }).success).toBe(true);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, validFrom: '2026-02-30' }).success).toBe(false);
  });

  it('검증 기준·적용 지역·룰 ID 형식, Gate 기준은 Gate를 함께 적는다', () => {
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, criteria: [] }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, criteria: [{ check: 'GATE_PASS' }] }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, criteria: [{ check: 'GATE_PASS', gate: 'G7' }] }).success).toBe(true);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, scope: { markets: [] } }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, scope: { markets: ['XX'] } }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, scope: { markets: ['KR'], featureIds: ['FEAT-1'] } }).success).toBe(false);
    expect(CreateComplianceRuleBody.safeParse({ ...BODY, ruleId: 'cr 1' }).success).toBe(false);
  });

  it('수정 본문은 바꿀 항목 하나 이상과 사유, 승인 결정은 승인·반려와 사유', () => {
    expect(UpdateComplianceRuleBody.safeParse({ reason: '사유만' }).success).toBe(false);
    expect(UpdateComplianceRuleBody.safeParse({ name: '새 이름', reason: '명칭 정정' }).success).toBe(true);
    expect(UpdateComplianceRuleBody.safeParse({ validFrom: '2026-05-01', validTo: '2026-04-01', reason: '기간' }).success).toBe(false);
    expect(UpdateComplianceRuleBody.safeParse({ ruleId: 'CR-X-1', reason: 'ID 변경' }).success).toBe(false);
    expect(ComplianceDecisionBody.safeParse({ decision: 'APPROVE', reason: '근거 확인' }).success).toBe(true);
    expect(ComplianceDecisionBody.safeParse({ decision: 'MAYBE', reason: '근거 확인' }).success).toBe(false);
  });
});

describe('상태·버전 (FR-CRC-001-013·021·023·024)', () => {
  it('상태는 Proposed·Approved·Rejected·Retired — 승인·반려는 Proposed에서만, 수정하면 Proposed로, Retired는 끝', () => {
    expect(canMoveRule('PROPOSED', 'APPROVED')).toBe(true);
    expect(canMoveRule('PROPOSED', 'REJECTED')).toBe(true);
    expect(canMoveRule('APPROVED', 'APPROVED')).toBe(false);
    expect(canMoveRule('APPROVED', 'PROPOSED')).toBe(true);
    expect(canMoveRule('REJECTED', 'PROPOSED')).toBe(true);
    expect(canMoveRule('APPROVED', 'RETIRED')).toBe(true);
    expect(canMoveRule('RETIRED', 'PROPOSED')).toBe(false);
  });

  it('승인 대상자·부가 정보(근거·유효 기간) 변경은 Minor, 명칭·유형·적용 지역·검증 기준 변경은 Major', () => {
    const a = rule();
    const minor = ruleDiff(a, { ...a, approverIds: ['usr-quality', 'usr-integrator'], evidence: { ...a.evidence, clause: '§7.4.3' }, validTo: '2027-12-31' });
    expect(minor.map((c) => [c.field, c.level])).toEqual([
      ['approverIds', 'MINOR'],
      ['evidence.clause', 'MINOR'],
      ['validTo', 'MINOR'],
    ]);
    expect(minor.find((c) => c.field === 'validTo')).toMatchObject({ before: null, after: '2027-12-31' });
    expect(bumpRuleVersion('1.3', minor)).toBe('1.4');
    const major = ruleDiff(a, { ...a, scope: { ...a.scope, markets: ['KR'] }, approverIds: ['usr-x'] });
    expect(major.map((c) => c.level)).toContain('MAJOR');
    expect(bumpRuleVersion('1.3', major)).toBe('2.0');
    for (const ch of [{ name: 'n' }, { type: 'LEGAL' as const }, { criteria: [{ check: 'STAGED_ROLLOUT' as const }] }]) expect(bumpRuleVersion('1.0', ruleDiff(a, { ...a, ...ch }))).toBe('2.0');
    expect(ruleDiff(a, { ...a })).toEqual([]);
    expect(bumpRuleVersion('2.9', [])).toBe('2.9');
  });
});

describe('유효 기간·적용 대상 (FR-CRC-001-004·016·018·025, FR-CRC-002-001~003)', () => {
  it('유효 기간은 시작일~종료일(종료일 포함), 종료일 없음은 무기한 — 종료일이 기준일보다 이전이면 만료', () => {
    const r = rule({ validFrom: '2026-03-01', validTo: '2026-06-30' });
    expect(['2026-02-28', '2026-03-01', '2026-06-30', '2026-07-01'].map((d) => ruleEffective(r, `${d}T09:00:00.000Z`))).toEqual([false, true, true, false]);
    expect(ruleEffective(rule({ validTo: null }), '2099-01-01T00:00:00Z')).toBe(true);
    expect(ruleExpired(r, '2026-06-30')).toBe(false);
    expect(ruleExpired(r, '2026-07-01')).toBe(true);
    expect(ruleExpired(rule({ validTo: null }), '2099-01-01')).toBe(false);
  });

  it('시장은 Feature 판매국에서 — 목록에 없는 국가는 OTHER', () => {
    expect(['KR', 'EU', 'US', 'ME'].map(complianceMarketOf)).toEqual(['KR', 'EU', 'US', 'OTHER']);
  });

  it('적용 범위: 지역·Feature·배포 유형·ASIL·CAL로 고른다(빈 목록 = 모두)', () => {
    const ctx = { featureId: 'FEAT-00022', market: 'KR', rolloutMode: 'ALL' as const, asil: 'B' as const, cal: 'CAL2' as const };
    expect(ruleInScope(rule(), ctx)).toBe(true);
    expect(ruleInScope(rule(), { ...ctx, market: 'US' })).toBe(false);
    expect(ruleInScope(rule(), { ...ctx, asil: 'QM' })).toBe(false);
    expect(ruleInScope(rule({ scope: { ...rule().scope, featureIds: ['FEAT-00001'] } }), ctx)).toBe(false);
    expect(ruleInScope(rule({ scope: { ...rule().scope, rolloutModes: ['COHORT'] } }), ctx)).toBe(false);
    expect(ruleInScope(rule({ scope: { ...rule().scope, cal: ['CAL3', 'CAL4'] } }), ctx)).toBe(false);
    expect(ruleInScope(rule({ scope: { ...rule().scope, cal: ['CAL2'] } }), { ...ctx, cal: null })).toBe(false);
  });

  it('승인되고 배포 시점에 유효한 룰만 적용 — 승인 전·만료·기간 전 룰은 이유와 함께 적용하지 않는다', () => {
    const ctx = { featureId: 'FEAT-00022', market: 'KR', rolloutMode: 'ALL' as const, asil: 'B' as const, cal: null };
    const rows = applicableRules(
      [
        rule({ ruleId: 'CR-A-001' }),
        rule({ ruleId: 'CR-A-002', status: 'PROPOSED' }),
        rule({ ruleId: 'CR-A-003', validTo: '2026-05-31' }),
        rule({ ruleId: 'CR-A-004', validFrom: '2026-12-01' }),
        rule({ ruleId: 'CR-A-005', status: 'RETIRED' }),
        rule({ ruleId: 'CR-A-006', scope: { ...rule().scope, markets: ['US'] } }),
      ],
      ctx,
      '2026-06-15T00:00:00.000Z',
    );
    expect(rows.map((r) => [r.ruleId, r.applied])).toEqual([
      ['CR-A-001', true],
      ['CR-A-002', false],
      ['CR-A-003', false],
      ['CR-A-004', false],
      ['CR-A-005', false],
    ]);
    expect(rows.find((r) => r.ruleId === 'CR-A-002')).toMatchObject({ approved: false, effective: true, reason: expect.stringMatching(/승인 전/) });
    expect(rows.find((r) => r.ruleId === 'CR-A-003')).toMatchObject({ approved: true, effective: false, reason: expect.stringMatching(/유효 기간/) });
  });

  it('적용 대상 Feature 후보 — 적용 지역(판매국)·ASIL·지정 Feature 기준', () => {
    const scope = { markets: ['EU'] as const, featureIds: [], rolloutModes: [], asil: ['C', 'D'] as const, cal: [] };
    const c = ruleFeatureCandidates(ds.features, { ...scope, markets: [...scope.markets], asil: [...scope.asil] });
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((f) => f.country === 'EU' && ['C', 'D'].includes(f.asil))).toBe(true);
    const named = ruleFeatureCandidates(ds.features, { markets: ['KR'], featureIds: ['FEAT-00022'], rolloutModes: [], asil: [], cal: [] });
    expect([...new Set(named.map((f) => f.featureId))]).toEqual(['FEAT-00022']);
  });
});

describe('배포 전 자동 검증 (FR-CRC-002-001~004·007)', () => {
  const at = '2026-10-12T00:00:00.000Z';
  const reg = (rules: ComplianceRule[]) => ({ rules, market: 'KR', cal: 'CAL2' as const, at });

  it('적용 룰의 검증 기준을 판정하고, 미충족은 룰 ID·항목·사유로 남긴다', () => {
    const rules = [
      rule({ ruleId: 'CR-SAF-001', version: '1.1' }),
      rule({ ruleId: 'CR-SEC-002', type: 'SECURITY', scope: { ...rule().scope, asil: [] }, criteria: [{ check: 'STAGED_ROLLOUT' }, { check: 'GATE_PASS', gate: 'G5' }, { check: 'TARA_RECORDED' }] }),
    ];
    const r = evaluateComplianceRules(input({ safeDefault: true }), reg(rules));
    expect(r.findings.filter((f) => f.result === 'FAIL').map((f) => [f.ruleId, f.item])).toEqual([
      ['CR-SAF-001', 'SAFE_DEFAULT_OFF'],
      ['CR-SEC-002', 'STAGED_ROLLOUT'],
      ['CR-SEC-002', 'GATE_PASS:G5'],
    ]);
    expect(r.findings[0].message).toMatch(/CR-SAF-001 v1\.1/);
    expect(r.rules.map((x) => [x.ruleId, x.version, x.applied])).toEqual([
      ['CR-SAF-001', '1.1', true],
      ['CR-SEC-002', '1.0', true],
    ]);
  });

  it('검증 기준 — 차량 식별자 대상 지정 금지·요구사항 연결·사용 권한 상품·시장 Profile 확인', () => {
    const one = (check: string, p: Partial<Policy> = {}, over: Partial<ValidationInput> = {}, market = 'KR') =>
      evaluateComplianceRules(input(p, over), { ...reg([rule({ scope: { ...rule().scope, markets: ['KR', 'CA'], asil: [] }, criteria: [{ check } as never] })]), market }).findings.filter((f) => f.result === 'FAIL').length;
    expect(one('NO_VEHICLE_ID_TARGETING', { strategies: [{ name: 's', constraints: [{ contextName: 'vehicleKey', operator: 'IN', values: ['V1'], inverted: false, caseInsensitive: false }] }] })).toBe(1);
    expect(one('NO_VEHICLE_ID_TARGETING')).toBe(0);
    expect(one('REQUIREMENT_TRACE', {}, { feature: { ...f22, requirementIds: [] } })).toBe(1);
    expect(one('ENTITLEMENT_REQUIRED')).toBe(1);
    expect(one('ENTITLEMENT_REQUIRED', { entitlementCatalogId: 'CAT-00019' })).toBe(0);
    expect(one('MARKET_PROFILE_CONFIRMED')).toBe(0);
    expect(one('MARKET_PROFILE_CONFIRMED', {}, {}, 'CA')).toBe(1);
  });

  it('validateCompliance — 적용 룰 미충족은 FAIL(배포 차단), 승인 전 룰은 판정에 넣지 않고 참고로만, 적용 룰 목록을 결과에 남긴다', () => {
    const ok = validateCompliance(input({}, { compliance: reg([rule(), rule({ ruleId: 'CR-NEW-009', status: 'PROPOSED', criteria: [{ check: 'STAGED_ROLLOUT' }] })]) }));
    expect(ok.result).toBe('PASS');
    expect(ok.rules?.map((x) => [x.ruleId, x.applied])).toEqual([
      ['CR-SAF-001', true],
      ['CR-NEW-009', false],
    ]);
    expect(ok.findings).toEqual([expect.objectContaining({ result: 'INFO', ruleId: 'CR-NEW-009', message: expect.stringMatching(/승인 전/) })]);
    expect(ok.summary).toMatch(/적용 룰 1건/);
    const bad = validateCompliance(input({ safeDefault: true }, { compliance: reg([rule()]) }));
    expect(bad.result).toBe('FAIL');
    // 플랫폼 기본 규칙(ASIL Safe Default)도 항목 코드를 남긴다 — 룰 ID는 등록 룰에만
    expect(bad.findings.map((f) => [f.ruleId ?? null, f.item])).toEqual([
      [null, 'SAFE_DEFAULT_OFF'],
      ['CR-SAF-001', 'SAFE_DEFAULT_OFF'],
    ]);
    // 레지스트리 입력이 없으면 예전과 같다(시험·이전 이력)
    expect(validateCompliance(input()).rules).toBeUndefined();
  });
});

describe('룰 알림 (FR-CRC-001-026)', () => {
  const ctx = (type: string, payload: Record<string, unknown>) => ({ event: { seq: 1, type, at: '2026-07-01T00:00:00.000Z', aggregate: 'CR-PRV-006', payload } });
  it('만료 알림 — 룰 ID·명칭·유형·적용 지역·유효 종료일·만료 일시를 관련 Feature Owner 팀·작성자·승인 대상자에게', async () => {
    const { NOTIFICATION_RULES } = await import('./notification');
    const { NOTIFICATION_RULE_SPECS } = await import('./notification-rules');
    const { NOTIFICATION_EVENT_TYPES } = await import('./notification-keys');
    const n = NOTIFICATION_RULES['compliance.rule.expired'].build(
      ctx('compliance.rule.expired', { ruleId: 'CR-PRV-006', name: '텔레메트리 동의 확인', type: 'PRIVACY', markets: ['EU'], validTo: '2026-06-30', expiredAt: '2026-07-01T00:00:00.000Z', version: '1.0', authorId: 'usr-steward', approverIds: ['usr-quality'], ownerTeams: ['ADAS기획팀'] }),
    )!;
    expect(n.fields.map((f) => f.label)).toEqual(['룰 ID', '룰 명칭', '룰 유형', '적용 지역', '유효 종료일', '만료 일시']);
    expect(n.fields.map((f) => f.value)).toEqual(['CR-PRV-006 v1.0', '텔레메트리 동의 확인', '개인정보', 'EU', '2026-06-30', '2026-07-01T00:00:00.000Z']);
    expect(n.recipients).toEqual([{ kind: 'team', team: 'ADAS기획팀' }, { kind: 'user', id: 'usr-steward' }, { kind: 'user', id: 'usr-quality' }]);
    expect(n.requirementIds).toEqual(['FR-CRC-001-026']);
    expect(n.link).toBe('/verify/compliance?tab=registry&rule=CR-PRV-006');
    expect(NOTIFICATION_RULE_SPECS.some((s) => s.event === 'compliance.rule.expired' && s.requirementIds.includes('FR-CRC-001-026'))).toBe(true);
    expect(NOTIFICATION_EVENT_TYPES).toContain('compliance.rule.expired');
  });
  it('승인 요청 알림 — 지정 승인 대상자에게(요청자 본인 제외)', async () => {
    const { NOTIFICATION_RULES } = await import('./notification');
    const n = NOTIFICATION_RULES['compliance.rule.approval-requested'].build(ctx('compliance.rule.approval-requested', { ruleId: 'CR-SEC-004', name: 'CAL3 단계 배포', version: '1.0', requestedBy: 'usr-integrator', approverIds: ['usr-steward'] }))!;
    expect(n).toMatchObject({ category: 'APPROVAL', recipients: [{ kind: 'user', id: 'usr-steward' }], exclude: ['usr-integrator'] });
  });
});

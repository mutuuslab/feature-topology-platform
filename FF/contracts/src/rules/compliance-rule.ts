// 컴플라이언스 룰 레지스트리 규칙(D03-01, FR-CRC-001·002) — 상태 전이·Major.Minor 버전·유효 기간·적용 대상 선정·검증 기준 판정.
// 순수 함수: 백엔드(등록·승인·만료·배포 검증)와 화면(미리보기·표시)이 같은 결과를 낸다.
// 승인(Approved)이고 배포 시점이 유효 기간 안인 룰만 판정에 넣는다. 승인 전 룰은 참고로만 보인다 —
// 시장 Compliance Profile의 '미확인이면 넓히는 조치 차단'(kill 게이트)은 그대로 두며, 그 완화 여부는 결정 대기(D4).
import type { FeatureVersionRow } from '../schemas/dataset';
import type { Policy } from '../schemas/policy';
import { MARKETS, type Market } from '../schemas/wire';
import type { Asil, GateId, GateStatus } from '../enums';
import type { Cal } from './gate-evidence';
import { profileOf, PROFILE_STATUS_LABEL } from './compliance-profile';
import type { ComplianceCheck, ComplianceCriterion, ComplianceRule, ComplianceRuleContent, ComplianceRuleStatus, ComplianceRuleType, ComplianceScope } from '../schemas/compliance-rule';

export const COMPLIANCE_RULE_TYPE_LABEL: Record<ComplianceRuleType, string> = { LEGAL: '법규', PRIVACY: '개인정보', SAFETY: '안전', SECURITY: '보안' };
export const COMPLIANCE_RULE_STATUS_LABEL: Record<ComplianceRuleStatus, string> = { PROPOSED: '승인 대기', APPROVED: '승인', REJECTED: '반려', RETIRED: '만료' };
export const COMPLIANCE_CHECK_LABEL: Record<ComplianceCheck, string> = {
  SAFE_DEFAULT_OFF: 'Safe Default 꺼짐',
  STAGED_ROLLOUT: '코호트 단계 배포',
  REQUIREMENT_TRACE: '요구사항 연결',
  GATE_PASS: 'Gate 통과',
  ENTITLEMENT_REQUIRED: '사용 권한 상품 연결',
  NO_VEHICLE_ID_TARGETING: '차량 식별자로 대상 지정 금지',
  MARKET_PROFILE_CONFIRMED: '시장 Profile 확인',
  TARA_RECORDED: 'TARA 기록',
};
export const criterionLabel = (c: Pick<ComplianceCriterion, 'check' | 'gate'>) => (c.check === 'GATE_PASS' ? `${c.gate} ${COMPLIANCE_CHECK_LABEL.GATE_PASS}` : COMPLIANCE_CHECK_LABEL[c.check]);
/** 미충족 항목 코드 — Gate 기준은 Gate까지 */
export const criterionItem = (c: Pick<ComplianceCriterion, 'check' | 'gate'>) => (c.check === 'GATE_PASS' ? `GATE_PASS:${c.gate}` : c.check);

/** 상태 전이 — 승인·반려는 승인 대기에서만, 수정하면 승인 대기로(같은 상태 유지 포함), 만료(RETIRED)는 끝 */
export const COMPLIANCE_RULE_TRANSITIONS: Record<ComplianceRuleStatus, ComplianceRuleStatus[]> = {
  PROPOSED: ['PROPOSED', 'APPROVED', 'REJECTED', 'RETIRED'],
  APPROVED: ['PROPOSED', 'RETIRED'],
  REJECTED: ['PROPOSED', 'RETIRED'],
  RETIRED: [],
};
export const canMoveRule = (from: ComplianceRuleStatus, to: ComplianceRuleStatus) => COMPLIANCE_RULE_TRANSITIONS[from].includes(to);

/** Major 항목 — 명칭·유형·적용 지역·검증 기준(적용 범위 조건 포함). 나머지(승인 대상자·근거·유효 기간)는 Minor (FR-CRC-001-024) */
const MAJOR_PREFIX = ['name', 'type', 'scope.', 'criteria'];
export interface RuleFieldChange {
  field: string;
  before: unknown;
  after: unknown;
  level: 'MAJOR' | 'MINOR';
}

/** 비교용 평탄화 — 순서를 고정한다(같은 내용이면 같은 결과) */
export function ruleFields(r: ComplianceRuleContent): [string, unknown][] {
  return [
    ['name', r.name],
    ['type', r.type],
    ['scope.markets', r.scope.markets],
    ['scope.featureIds', r.scope.featureIds],
    ['scope.rolloutModes', r.scope.rolloutModes],
    ['scope.asil', r.scope.asil],
    ['scope.cal', r.scope.cal],
    ['criteria', r.criteria.map((c) => criterionItem(c))],
    ['approverIds', r.approverIds],
    ['evidence.url', r.evidence.url],
    ['evidence.docName', r.evidence.docName],
    ['evidence.clause', r.evidence.clause],
    ['evidence.memo', r.evidence.memo],
    ['validFrom', r.validFrom],
    ['validTo', r.validTo],
  ];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 바뀐 항목·전후 값·버전 영향 */
export function ruleDiff(before: ComplianceRuleContent, after: ComplianceRuleContent): RuleFieldChange[] {
  const a = new Map(ruleFields(after));
  return ruleFields(before)
    .filter(([k, v]) => !same(v, a.get(k)))
    .map(([field, v]) => ({ field, before: v ?? null, after: a.get(field) ?? null, level: MAJOR_PREFIX.some((p) => field === p || (p.endsWith('.') && field.startsWith(p))) ? 'MAJOR' : 'MINOR' }));
}

/** 다음 버전 — Major 항목이 하나라도 바뀌면 (M+1).0, 아니면 M.(m+1), 바뀐 것이 없으면 그대로 */
export function bumpRuleVersion(version: string, changes: Pick<RuleFieldChange, 'level'>[]): string {
  const [M, m] = version.split('.').map((x) => Number(x) || 0);
  if (!changes.length) return `${M}.${m}`;
  return changes.some((c) => c.level === 'MAJOR') ? `${M + 1}.0` : `${M}.${m + 1}`;
}

/** 배포 시점(ISO 또는 날짜)이 유효 기간 안인가 — 시작일·종료일 포함, 종료일 없음은 무기한(FR-CRC-001-008·018, FR-CRC-002-003) */
export function ruleEffective(r: Pick<ComplianceRule, 'validFrom' | 'validTo'>, at: string): boolean {
  const d = at.slice(0, 10);
  return r.validFrom <= d && (r.validTo == null || d <= r.validTo);
}

/** 종료일이 기준일보다 이전이면 만료(FR-CRC-001-025) */
export const ruleExpired = (r: Pick<ComplianceRule, 'validTo'>, today: string) => r.validTo != null && r.validTo < today.slice(0, 10);

/** Feature 판매국 → 시장(목록에 없는 국가는 OTHER) */
export const complianceMarketOf = (country: string): Market => ((MARKETS as readonly string[]).includes(country) ? (country as Market) : 'OTHER');

/** 배포 검증 맥락 — Feature·대상 지역·배포 유형·Safety(ASIL)·Security(CAL) 등급 */
export interface ComplianceContext {
  featureId: string;
  market: string;
  rolloutMode: 'ALL' | 'COHORT' | 'NONE';
  asil: Asil;
  cal: Cal | null;
}

/** 룰 적용 범위에 드는가 — 빈 목록은 모두, CAL 조건이 있는데 TARA가 없으면 들지 않는다 */
export function ruleInScope(r: Pick<ComplianceRule, 'scope'>, c: ComplianceContext): boolean {
  const s = r.scope;
  return (
    (s.markets as string[]).includes(c.market) &&
    (!s.featureIds.length || s.featureIds.includes(c.featureId)) &&
    (!s.rolloutModes.length || s.rolloutModes.includes(c.rolloutMode)) &&
    (!s.asil.length || s.asil.includes(c.asil)) &&
    (!s.cal.length || (c.cal != null && s.cal.includes(c.cal)))
  );
}

export interface ApplicableRule {
  ruleId: string;
  version: string;
  name: string;
  type: ComplianceRuleType;
  status: ComplianceRuleStatus;
  approved: boolean;
  effective: boolean;
  /** 판정에 넣는가 = 승인 + 유효 기간 안 */
  applied: boolean;
  reason: string;
}

/** 적용 대상 룰 — 범위에 드는 룰 전부와 적용 여부·이유(FR-CRC-001-016·018, FR-CRC-002-001~003). 등록 순서대로 */
export function applicableRules(rules: ComplianceRule[], ctx: ComplianceContext, at: string): ApplicableRule[] {
  return rules
    .filter((r) => ruleInScope(r, ctx))
    .map((r) => {
      const approved = r.status === 'APPROVED';
      const effective = ruleEffective(r, at);
      const reason = approved
        ? effective
          ? '승인 · 유효 기간 안 — 적용'
          : `유효 기간(${r.validFrom} ~ ${r.validTo ?? '무기한'}) 밖 — 적용하지 않음`
        : `${COMPLIANCE_RULE_STATUS_LABEL[r.status]} — 승인 전이라 판정에 넣지 않음`;
      return { ruleId: r.ruleId, version: r.version, name: r.name, type: r.type, status: r.status, approved, effective, applied: approved && effective, reason: r.status === 'RETIRED' ? '만료된 룰 — 적용하지 않음' : reason };
    });
}

/** 룰 적용 대상 Feature 후보 — 판매국 시장·ASIL·지정 Feature(FR-CRC-001-004). Variant Rule 경유 조회는 결정 대기(D8) */
export function ruleFeatureCandidates<T extends Pick<FeatureVersionRow, 'featureId' | 'country' | 'asil'>>(features: T[], scope: ComplianceScope): T[] {
  return features.filter(
    (f) => (scope.markets as string[]).includes(complianceMarketOf(f.country)) && (!scope.featureIds.length || scope.featureIds.includes(f.featureId)) && (!scope.asil.length || scope.asil.includes(f.asil)),
  );
}

/** 판정 입력 — 정책 검증 입력(ValidationInput)의 일부 */
export interface ComplianceCheckInput {
  policy: Pick<Policy, 'safeDefault' | 'rollout' | 'entitlementCatalogId' | 'strategies' | 'featureId'>;
  feature: Pick<FeatureVersionRow, 'requirementIds' | 'asil' | 'featureId'>;
  gates: Partial<Record<GateId, GateStatus>>;
  entitlementProductOk: boolean | null;
}

/** 레지스트리 입력 — 백엔드가 룰 목록·대상 지역·CAL·검증 시각을 채운다 */
export interface ComplianceRegistryInput {
  rules: ComplianceRule[];
  market: string;
  cal: Cal | null;
  at: string;
}

/** 검증 기준 하나 판정 — 미충족이면 사유 */
export function checkCriterion(c: ComplianceCriterion, i: ComplianceCheckInput, reg: Pick<ComplianceRegistryInput, 'market' | 'cal'>): string | null {
  const p = i.policy;
  switch (c.check) {
    case 'SAFE_DEFAULT_OFF':
      return p.safeDefault ? 'Safe Default가 켜져 있습니다 — 꺼짐(OFF)이어야 합니다' : null;
    case 'STAGED_ROLLOUT':
      return p.rollout.mode === 'ALL' ? '전체 배포입니다 — 코호트 단계 배포여야 합니다' : null;
    case 'REQUIREMENT_TRACE':
      return i.feature.requirementIds.length ? null : 'Feature에 연결된 요구사항이 없습니다';
    case 'GATE_PASS':
      return i.gates[c.gate!] === 'PASS' ? null : `${c.gate} Gate가 ${i.gates[c.gate!] ?? '미판정'}입니다 — PASS여야 합니다`;
    case 'ENTITLEMENT_REQUIRED':
      return !p.entitlementCatalogId ? '사용 권한 상품이 연결되어 있지 않습니다' : i.entitlementProductOk === true ? null : `사용 권한 상품 ${p.entitlementCatalogId} 구성에 이 Feature가 없습니다`;
    case 'NO_VEHICLE_ID_TARGETING':
      return p.strategies.some((s) => s.constraints.some((k) => k.contextName === 'vehicleKey')) ? '차량 식별자(vehicleKey)로 대상을 지정했습니다 — 차종·국가 등 속성으로 지정해야 합니다' : null;
    case 'MARKET_PROFILE_CONFIRMED': {
      const prof = profileOf(reg.market);
      return prof?.status === 'CONFIRMED' ? null : `${reg.market} 시장 Profile이 ${prof ? PROFILE_STATUS_LABEL[prof.status] : PROFILE_STATUS_LABEL.UNKNOWN} 상태입니다`;
    }
    case 'TARA_RECORDED':
      return reg.cal ? null : 'TARA(위협 분석) 기록이 없습니다';
  }
}

export interface ComplianceFinding {
  result: 'FAIL' | 'INFO';
  message: string;
  ruleId?: string;
  item?: string;
}

/**
 * 적용 대상 룰을 고르고 검증 기준을 판정 — 미충족은 룰 ID·항목·사유(FR-CRC-002-004), 승인 전·기간 밖 룰은 참고(INFO).
 * @req FR-CRC-001-016, FR-CRC-001-018, FR-CRC-002-001, FR-CRC-002-002, FR-CRC-002-003, FR-CRC-002-004
 */
export function evaluateComplianceRules(i: ComplianceCheckInput & { policy: Pick<Policy, 'rollout'> }, reg: ComplianceRegistryInput): { findings: ComplianceFinding[]; rules: ApplicableRule[] } {
  const ctx: ComplianceContext = { featureId: i.feature.featureId, market: reg.market, rolloutMode: i.policy.rollout.mode, asil: i.feature.asil, cal: reg.cal };
  const rows = applicableRules(reg.rules, ctx, reg.at);
  const byId = new Map(reg.rules.map((r) => [r.ruleId, r]));
  const findings: ComplianceFinding[] = [];
  for (const row of rows) {
    if (!row.applied) {
      findings.push({ result: 'INFO', ruleId: row.ruleId, item: 'NOT_APPLIED', message: `룰 ${row.ruleId} v${row.version} ${row.name}: ${row.reason}` });
      continue;
    }
    for (const c of byId.get(row.ruleId)!.criteria) {
      const why = checkCriterion(c, i, reg);
      if (why) findings.push({ result: 'FAIL', ruleId: row.ruleId, item: criterionItem(c), message: `룰 ${row.ruleId} v${row.version} ${row.name} — ${criterionLabel(c)}: ${why}` });
    }
  }
  return { findings, rules: rows };
}

/** 같은 적용 룰 집합인가(룰 ID·버전) — 검증한 뒤 배포 시점에 적용 룰이 바뀌었으면 다시 검증해야 한다 */
export function appliedRuleKeys(rows: Pick<ApplicableRule, 'ruleId' | 'version' | 'applied'>[] | undefined): string[] {
  return (rows ?? [])
    .filter((r) => r.applied)
    .map((r) => `${r.ruleId}@${r.version}`)
    .sort();
}

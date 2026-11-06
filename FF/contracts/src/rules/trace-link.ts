// Feature 추적 연결 규칙(FR-DEP-005~008, FR-DEP-002-004) — 종류별 등록 역할, Test Case별 Evidence 상태, 요구·Test 커버리지.
// 백엔드(trace-link.service)·화면(Feature 상세 '추적 연결' 탭·추적 커버리지)이 같은 계산을 쓴다.
import type { Role } from '../enums';
import { TRACE_KINDS, type TestEvidenceRow, type TestResult, type TraceKind, type TraceLinkRow } from '../schemas/trace-link';

export interface TraceKindRule {
  /** 등록·해제할 수 있는 역할 */
  roles: Role[];
  /** 출처 존재 확인 연계 */
  ifId: string | null;
}

export const TRACE_KIND_RULES: Record<TraceKind, TraceKindRule> = {
  REQUIREMENT: { roles: ['FEATURE_AUTHOR'], ifId: 'IF-01' },
  ARCHITECTURE: { roles: ['IMPLEMENTER', 'FEATURE_AUTHOR'], ifId: 'IF-02' },
  INTERFACE: { roles: ['IMPLEMENTER', 'FEATURE_AUTHOR'], ifId: 'IF-02' },
  TEST_CASE: { roles: ['GATE_JUDGE', 'IMPLEMENTER', 'FEATURE_AUTHOR'], ifId: 'IF-09' },
  OTA: { roles: ['RELEASE_MANAGER', 'IMPLEMENTER'], ifId: 'IF-02' },
};
/** Test Evidence를 등록할 수 있는 역할 */
export const TEST_EVIDENCE_ROLES: Role[] = ['GATE_JUDGE', 'IMPLEMENTER'];
/** 추적 연결 경로에 들어올 수 있는 역할(합집합) — 종류별 역할은 서비스가 다시 본다 */
export const TRACE_LINK_ROLES: Role[] = [...new Set(TRACE_KINDS.flatMap((k) => TRACE_KIND_RULES[k].roles))];
export const traceRolesFor = (kind: TraceKind) => TRACE_KIND_RULES[kind].roles;

export interface TestCaseStatus {
  hasEvidence: boolean;
  evidenceCount: number;
  latestResult: TestResult | null;
  latestAt: string | null;
  latestEvidenceId: string | null;
}

/** Test Case 하나의 Evidence 등록 여부·최종 실행 결과(가장 늦은 실행 일시) */
export function testCaseStatus(link: Pick<TraceLinkRow, 'linkId'>, evidence: TestEvidenceRow[]): TestCaseStatus {
  const mine = evidence.filter((e) => e.linkId === link.linkId);
  const last = [...mine].sort((a, b) => (a.executedAt < b.executedAt ? 1 : a.executedAt > b.executedAt ? -1 : a.recordId < b.recordId ? 1 : -1))[0];
  return { hasEvidence: mine.length > 0, evidenceCount: mine.length, latestResult: last?.result ?? null, latestAt: last?.executedAt ?? null, latestEvidenceId: last?.evidenceId ?? null };
}

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 10000 : null);

/**
 * Feature 하나의 커버리지 — 해제한 연결은 세지 않는다.
 * 요구: 출처(ALM)의 전체 요구 중 연결된 것의 비율(FR-DEP-005-004). Test: 필수 Test Case 중 Evidence가 등록된 것의 비율(FR-DEP-008-005).
 * @req FR-DEP-005-004 FR-DEP-008-005
 */
export function featureTraceCoverage(links: TraceLinkRow[], evidence: TestEvidenceRow[], sourceRequirements: string[]) {
  const active = links.filter((l) => l.status === 'ACTIVE');
  const reqIds = new Set(active.filter((l) => l.kind === 'REQUIREMENT').map((l) => l.elementId));
  const total = [...new Set(sourceRequirements)];
  const covered = total.filter((r) => reqIds.has(r));
  const required = active.filter((l) => l.kind === 'TEST_CASE' && l.required);
  const status = new Map(required.map((l) => [l.linkId, testCaseStatus(l, evidence)]));
  const withEvidence = required.filter((l) => status.get(l.linkId)!.hasEvidence);
  const missing = required.filter((l) => !status.get(l.linkId)!.hasEvidence).map((l) => l.elementId);
  return {
    requirement: { total: total.length, linked: reqIds.size, covered: covered.length, ratio: ratio(covered.length, total.length), unlinked: total.filter((r) => !reqIds.has(r)) },
    test: { required: required.length, withEvidence: withEvidence.length, ratio: ratio(withEvidence.length, required.length), missing, failing: required.filter((l) => status.get(l.linkId)!.latestResult === 'FAIL').map((l) => l.elementId) },
    /** 요구가 1건도 연결되지 않았는가의 반대(FR-DEP-005-005) */
    hasRequirementLink: reqIds.size > 0,
    /** 필수 Test Case에 Evidence가 없는 것이 있는가(FR-DEP-008-006) */
    missingRequiredEvidence: missing.length > 0,
  };
}
export type FeatureTraceCoverage = ReturnType<typeof featureTraceCoverage>;

/** 연결 현황 — 종류마다 유형·출처별 건수(FR-DEP-005-003·006-003·007-003) */
export function groupTraceLinks(links: TraceLinkRow[]) {
  return Object.fromEntries(
    TRACE_KINDS.map((k) => {
      const mine = links.filter((l) => l.kind === k);
      const count = (key: 'elementType' | 'sourceSystem') => mine.reduce<Record<string, number>>((m, l) => ((m[l[key]] = (m[l[key]] ?? 0) + 1), m), {});
      return [k, { count: mine.length, byType: count('elementType'), bySource: count('sourceSystem') }];
    }),
  ) as Record<TraceKind, { count: number; byType: Record<string, number>; bySource: Record<string, number> }>;
}

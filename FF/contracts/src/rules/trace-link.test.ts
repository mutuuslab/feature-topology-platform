// Feature 추적 연결 — 등록 본문 검증, Test Case별 Evidence 상태(FR-DEP-008-004), 요구·Test 커버리지(FR-DEP-005-004·008-005), 미연결·미등록 판정(005-005·008-006)
import { describe, expect, it } from 'vitest';
import { CreateTraceLinkBody, type TestEvidenceRow, type TraceLinkRow } from '../schemas/trace-link';
import { featureTraceCoverage, groupTraceLinks, TRACE_KIND_RULES, traceRolesFor, testCaseStatus } from './trace-link';

const link = (o: Partial<TraceLinkRow> & Pick<TraceLinkRow, 'linkId' | 'kind' | 'elementId'>): TraceLinkRow => ({
  featureId: 'FEAT-00022', elementType: 'SYSTEM', elementName: null, elementVersion: null, sourceSystem: 'CODEBEAMER', required: null, existence: 'VERIFIED', sourceRef: null,
  status: 'ACTIVE', linkedBy: 'usr-author', linkedAt: '2026-11-01T00:00:00Z', unlinkedBy: null, unlinkedAt: null, unlinkReason: null, ...o,
});
const ev = (linkId: string, executedAt: string, result: TestEvidenceRow['result']): TestEvidenceRow => ({
  recordId: `TEV-${linkId}-${executedAt}`, linkId, featureId: 'FEAT-00022', testCaseId: linkId, evidenceId: `EV-${executedAt}`, executedAt, result, environment: 'HIL 벤치 2', registeredBy: 'usr-judge', registeredAt: executedAt,
});

describe('등록 본문 검증', () => {
  const base = { featureId: 'FEAT-00022', elementId: 'IF-X', elementName: null, elementVersion: null };
  it('종류별 요소 유형·출처만 받는다', () => {
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'INTERFACE', elementType: 'SIGNAL', sourceSystem: 'IDT' }).success).toBe(true);
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'INTERFACE', elementType: 'HW', sourceSystem: 'IDT' }).success).toBe(false);
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'ARCHITECTURE', elementType: 'HW', sourceSystem: 'TMS' }).success).toBe(false);
  });
  it('Test Case는 필수 여부가 있어야 하고, 다른 종류는 필수 여부를 받지 않는다', () => {
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'TEST_CASE', elementType: 'HIL', sourceSystem: 'TMS' }).success).toBe(false);
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'TEST_CASE', elementType: 'HIL', sourceSystem: 'TMS', required: true }).success).toBe(true);
    expect(CreateTraceLinkBody.safeParse({ ...base, kind: 'REQUIREMENT', elementType: 'SW', sourceSystem: 'ALM', required: false }).success).toBe(false);
  });
  it('종류마다 등록 역할이 정해져 있다 — 요구는 Feature 작성자, Test Case는 Gate 판정자·구현 담당도', () => {
    expect(TRACE_KIND_RULES.REQUIREMENT.roles).toContain('FEATURE_AUTHOR');
    expect(TRACE_KIND_RULES.TEST_CASE.roles).toEqual(expect.arrayContaining(['GATE_JUDGE', 'IMPLEMENTER']));
    expect(traceRolesFor('OTA')).not.toContain('GATE_JUDGE');
  });
});

describe('Test Case별 Evidence 상태', () => {
  it('Evidence가 없으면 미등록, 있으면 가장 늦은 실행 결과가 최종 결과', () => {
    const tc = link({ linkId: 'TRL-00001', kind: 'TEST_CASE', elementId: 'TC-00022-01', elementType: 'HIL', sourceSystem: 'TMS', required: true });
    expect(testCaseStatus(tc, [])).toEqual({ hasEvidence: false, evidenceCount: 0, latestResult: null, latestAt: null, latestEvidenceId: null });
    const s = testCaseStatus(tc, [ev('TRL-00001', '2026-11-02T00:00:00Z', 'PASS'), ev('TRL-00001', '2026-11-03T00:00:00Z', 'FAIL'), ev('TRL-00002', '2026-11-04T00:00:00Z', 'PASS')]);
    expect(s).toMatchObject({ hasEvidence: true, evidenceCount: 2, latestResult: 'FAIL', latestAt: '2026-11-03T00:00:00Z' });
  });
});

describe('커버리지', () => {
  const links = [
    link({ linkId: 'TRL-00001', kind: 'REQUIREMENT', elementId: 'REQ-1' }),
    link({ linkId: 'TRL-00002', kind: 'REQUIREMENT', elementId: 'REQ-2', status: 'UNLINKED' }),
    link({ linkId: 'TRL-00003', kind: 'REQUIREMENT', elementId: 'REQ-X' }), // 출처 목록에 없는 연결 — 커버리지에 세지 않는다
    link({ linkId: 'TRL-00004', kind: 'TEST_CASE', elementId: 'TC-1', elementType: 'HIL', sourceSystem: 'TMS', required: true }),
    link({ linkId: 'TRL-00005', kind: 'TEST_CASE', elementId: 'TC-2', elementType: 'VIRTUAL', sourceSystem: 'TMS', required: true }),
    link({ linkId: 'TRL-00006', kind: 'TEST_CASE', elementId: 'TC-3', elementType: 'VEHICLE', sourceSystem: 'TMS', required: false }),
  ];
  const evidence = [ev('TRL-00004', '2026-11-02T00:00:00Z', 'PASS'), ev('TRL-00006', '2026-11-02T00:00:00Z', 'PASS')];

  it('요구 커버리지 = 연결된 요구 ÷ 출처의 전체 요구(해제한 연결은 빼고)', () => {
    const c = featureTraceCoverage(links, evidence, ['REQ-1', 'REQ-2', 'REQ-3', 'REQ-4']);
    expect(c.requirement).toEqual({ total: 4, linked: 2, covered: 1, ratio: 0.25, unlinked: ['REQ-2', 'REQ-3', 'REQ-4'] });
  });
  it('Test 커버리지 = Evidence 있는 필수 TC ÷ 필수 TC, 미등록 필수 TC 목록', () => {
    const c = featureTraceCoverage(links, evidence, []);
    expect(c.test).toEqual({ required: 2, withEvidence: 1, ratio: 0.5, missing: ['TC-2'], failing: [] });
    expect(c.requirement.ratio).toBeNull();
    expect(c.hasRequirementLink).toBe(true);
    expect(c.missingRequiredEvidence).toBe(true);
  });
  it('요구 연결이 하나도 없으면 미연결 Feature, 필수 TC가 없으면 Test 커버리지는 판단 불가(null)', () => {
    const c = featureTraceCoverage([link({ linkId: 'TRL-00009', kind: 'REQUIREMENT', elementId: 'REQ-1', status: 'UNLINKED' })], [], ['REQ-1']);
    expect(c.hasRequirementLink).toBe(false);
    expect(c.test.ratio).toBeNull();
    expect(c.missingRequiredEvidence).toBe(false);
  });
  it('유형·출처별 묶음(현황 조회)', () => {
    const g = groupTraceLinks(links.filter((l) => l.status === 'ACTIVE'));
    expect(g.TEST_CASE.byType).toEqual({ HIL: 1, VIRTUAL: 1, VEHICLE: 1 });
    expect(g.REQUIREMENT.bySource).toEqual({ CODEBEAMER: 2 });
    expect(g.OTA.count).toBe(0);
  });
});

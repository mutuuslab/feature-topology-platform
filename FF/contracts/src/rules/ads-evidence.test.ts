// ADS 증거 규칙 — 기한 계산(인지 시각 기준)·30초 창 분류·확정 전 제외·Safety Case 지지 판정·독립성·요구 추적 판정
import { describe, expect, it } from 'vitest';
import {
  adsIncidentSummary,
  adsIncidentView,
  adsPeriodicReport,
  classifyActiveWindow,
  manifestSupport,
  promotionVerdict,
  reviewerIndependenceBlocker,
  revisionImpact,
  safetyCaseView,
  shortTermDueOf,
  traceSummary,
  traceVerdict,
  ADS_REVIEWER_NOT_INDEPENDENT,
  type AdsCaseNode,
  type AdsConfigBinding,
  type AdsDetermination,
  type AdsEvidenceManifest,
  type AdsIncidentReport,
  type AdsMarketDeadline,
  type AdsReviewFinding,
  type AdsTraceDoc,
} from './ads-evidence';

const DAY = 86_400_000;
const NOW = new Date('2026-11-06T00:00:00.000Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

const KR: AdsMarketDeadline = { market: 'KR', label: '대한민국', shortTermDays: 30, periodicMonths: 12, status: 'APPROVED', approvedBy: 'usr-steward', approvedAt: ago(60), basis: '규제 담당 승인' };
const US: AdsMarketDeadline = { ...KR, market: 'US', label: '미국', status: 'DRAFT', approvedBy: null, approvedAt: null };

const report = (o: Partial<AdsIncidentReport> = {}): AdsIncidentReport => ({
  reportId: 'ADSI-2026-0001',
  featureId: 'FEAT-00004',
  featureVersion: '4.1.0',
  vin: 'KMH-GN7-0001',
  market: 'KR',
  summary: '시험',
  occurredAt: ago(30),
  awareAt: ago(25),
  firstNoticeAt: ago(25),
  activeWindow: { value: 'IN_WINDOW', basis: '차량 보고' },
  configSet: 'CFG-FEAT-00004-01',
  oddProfileRef: 'ODD-FEAT-00004-v1',
  dssadCorrelationId: 'DSSAD-1',
  auditTarget: 'ADSI-2026-0001',
  shortTermSubmittedAt: null,
  events: [],
  ...o,
});
const decided = (decision: AdsDetermination['decision'], version = 1): AdsDetermination => ({ reportId: 'ADSI-2026-0001', version, decision, reason: '검토', decidedBy: 'usr-steward', decidedRole: 'REGULATORY_OWNER', decidedAt: ago(1) });

describe('ADS 사건 보고 — 기한·30초 창·확정', () => {
  it('단기 보고 기한은 발생 시각이 아니라 인지 시각 + 30일이다', () => {
    const r = report({ occurredAt: ago(40), awareAt: ago(25) });
    expect(shortTermDueOf(r.awareAt, KR)).toBe(new Date(Date.parse(ago(25)) + 30 * DAY).toISOString());
    const v = adsIncidentView(r, KR, [decided('REPORTABLE')], NOW);
    expect(v.daysLeft).toBe(5);
    expect(v.dueWithin7).toBe(true);
  });

  it('시장 기한 표가 승인 전이면 기한을 계산하지 않는다(기한 기준 미등록)', () => {
    const v = adsIncidentView(report({ market: 'US' }), US, [decided('REPORTABLE')], NOW);
    expect(v.shortTermDue).toBeNull();
    expect(v.deadlineRegistered).toBe(false);
    expect(v.dueWithin7).toBe(false);
  });

  it('보고 대상 확정 전에는 30초 창이 해당이어도 기한 경보·보고 대상 수에 세지 않는다 — 후보로 따로', () => {
    const cand = adsIncidentView(report(), KR, [], NOW);
    expect(cand.reportStatus).toBe('CANDIDATE');
    expect(cand.dueWithin7).toBe(false);
    const s = adsIncidentSummary([cand]);
    expect(s).toMatchObject({ dueWithin7: 0, reportable: 0, candidates: 1 });
  });

  it('판단 불가는 해당 없음·비대상으로 세지 않고, 확정은 마지막 기록이 유효하다', () => {
    const u = adsIncidentView(report({ activeWindow: { value: 'UNDECIDABLE', basis: '근거 부족' } }), KR, [], NOW);
    expect(u.reportStatus).toBe('UNDECIDABLE');
    const o = adsIncidentView(report({ activeWindow: { value: 'OUT_OF_WINDOW', basis: '' } }), KR, [], NOW);
    expect(o.reportStatus).toBe('OUT_UNDECIDED'); // 해당 없음도 비대상 확정이 아니다
    const v = adsIncidentView(report(), KR, [decided('REPORTABLE', 1), decided('NOT_REPORTABLE', 2)], NOW);
    expect(v.reportStatus).toBe('NOT_REPORTABLE');
    expect(adsIncidentSummary([u, o, v])).toMatchObject({ undecidable: 1, candidates: 0, reportable: 0 });
  });

  it('제출한 사건·기한을 넘긴 사건은 7일 안에 세지 않는다', () => {
    expect(adsIncidentView(report({ shortTermSubmittedAt: ago(1) }), KR, [decided('REPORTABLE')], NOW).dueWithin7).toBe(false);
    const late = adsIncidentView(report({ awareAt: ago(31) }), KR, [decided('REPORTABLE')], NOW);
    expect(late).toMatchObject({ dueWithin7: false, overdue: true });
  });

  it('최초 통지는 카운트다운이 아니라 인지 후 경과 시간', () => {
    expect(adsIncidentView(report({ awareAt: new Date(NOW.getTime() - 3 * 3600_000 - 60_000).toISOString() }), KR, [], NOW).elapsedHours).toBe(3);
  });

  it('차량 순서와 서버 수신 순서가 다르면 표지한다(두 순서를 각각 보존)', () => {
    const ev = (vehicleSeq: number, ingestSeq: number) => ({ kind: 'VERDICT' as const, label: 'x', vehicleAt: ago(1), vehicleSeq, serverAt: ago(1), ingestSeq, owner: null, ref: null });
    expect(adsIncidentView(report({ events: [ev(1, 1), ev(2, 2)] }), KR, [], NOW).orderDiffers).toBe(false);
    expect(adsIncidentView(report({ events: [ev(1, 2), ev(2, 1)] }), KR, [], NOW).orderDiffers).toBe(true);
  });

  it('30초 창 분류 — 활성 구간이 창에 걸치면 해당, 보고 범위가 창을 덮지 못하면 판단 불가', () => {
    const at = '2026-10-01T00:00:30.000Z';
    expect(classifyActiveWindow({ occurredAt: at, activeSpans: [{ from: '2026-09-30T23:50:00.000Z', to: '2026-10-01T00:00:10.000Z' }], coverage: { from: '2026-09-30T23:00:00.000Z', to: at } })).toBe('IN_WINDOW');
    expect(classifyActiveWindow({ occurredAt: at, activeSpans: [{ from: '2026-09-30T23:50:00.000Z', to: '2026-09-30T23:55:00.000Z' }], coverage: { from: '2026-09-30T23:00:00.000Z', to: at } })).toBe('OUT_OF_WINDOW');
    expect(classifyActiveWindow({ occurredAt: at, activeSpans: [], coverage: { from: '2026-10-01T00:00:20.000Z', to: at } })).toBe('UNDECIDABLE');
    expect(classifyActiveWindow({ occurredAt: null, activeSpans: [], coverage: null })).toBe('UNDECIDABLE');
  });

  it('정기 보고 — 노출량당 비율은 확정된 사건만', () => {
    const items = [adsIncidentView(report(), KR, [decided('REPORTABLE')], NOW), adsIncidentView(report({ reportId: 'ADSI-2026-0002' }), KR, [], NOW)];
    const p = adsPeriodicReport(2026, [{ month: '2026-10', hours: 2000, km: 100_000 }, { month: '2025-12', hours: 9, km: 9 }], items);
    expect(p.exposure).toEqual({ hours: 2000, km: 100_000 });
    expect(p.incidents).toMatchObject({ reportable: 1, candidates: 1 });
    expect(p.per1kHours).toBe(0.5);
    expect(p.per100kKm).toBe(1);
  });
});

const TARGET: AdsConfigBinding = { policy: 'POL-A', configSet: 'CFG-FEAT-00004-01', odd: 'ODD-FEAT-00004-v1', hw: 'HW-3', sw: '4.1.0', model: 'M-1', calibration: 'CAL-1' };
const manifest = (o: Partial<AdsEvidenceManifest> = {}): AdsEvidenceManifest => ({
  manifestId: 'EVM-0001',
  featureId: 'FEAT-00004',
  featureVersion: '4.1.0',
  requirementIds: ['FFP-F001'],
  hazardIds: ['H01'],
  config: TARGET,
  tool: { name: 'CARLA', version: '0.9.15', validRange: '고속도로' },
  toolValidity: 'IN_RANGE',
  scenario: { id: 'S01', title: 's' },
  expectedTransition: 'a',
  actualTransition: 'a',
  timing: { measuredMs: 100, budgetMs: 200, budgetStatus: 'APPROVED' },
  result: 'PASS',
  resultDigest: 'sha256:00',
  origin: 'NEW',
  evidenceRef: null,
  gateRecordId: null,
  author: 'usr-integrator',
  authoredAt: ago(3),
  review: { status: 'APPROVED', by: 'usr-quality', at: ago(2) },
  ...o,
});
const finding = (o: Partial<AdsReviewFinding> = {}): AdsReviewFinding => ({ findingId: 'RF-0001', featureId: 'FEAT-00004', manifestId: 'EVM-0001', severity: 'MAJOR', summary: 's', status: 'OPEN', reviewer: 'usr-safety2', reviewerIndependent: true, openedAt: ago(1), closedAt: null, closeReason: null, ...o });

describe('Safety Case — 지지 판정·독립 검토·승격', () => {
  it('회귀: 다른 형상의 PASS는 재사용 불가 — 형상 불일치로 주장을 뒷받침하지 않는다', () => {
    expect(manifestSupport(manifest({ config: { ...TARGET, sw: '4.0.1' } }), TARGET)).toBe('MISMATCH');
  });
  it('도구 유효 범위 밖은 한계, 검토 전은 미검토, 가정값 시간 예산 PASS도 지지가 아니다', () => {
    expect(manifestSupport(manifest({ toolValidity: 'OUT_OF_RANGE' }), TARGET)).toBe('LIMIT');
    expect(manifestSupport(manifest({ review: { status: 'PENDING', by: null, at: null } }), TARGET)).toBe('UNREVIEWED');
    expect(manifestSupport(manifest({ timing: { measuredMs: 1, budgetMs: 2, budgetStatus: 'ASSUMED' } }), TARGET)).toBe('ASSUMED');
    expect(manifestSupport(manifest(), TARGET)).toBe('SUPPORTS');
  });
  it('Evidence 없는 주장 수 — 한계·형상 불일치·미검토만 연결된 주장도 Evidence 없는 주장', () => {
    const nodes: AdsCaseNode[] = [
      { nodeId: 'C01', kind: 'CLAIM', parentId: null, text: 'c1', manifestId: null },
      { nodeId: 'C01-A1', kind: 'ARGUMENT', parentId: 'C01', text: 'a', manifestId: null },
      { nodeId: 'C01-A1-E1', kind: 'EVIDENCE', parentId: 'C01-A1', text: 'e', manifestId: 'EVM-0001' },
      { nodeId: 'C02', kind: 'CLAIM', parentId: null, text: 'c2', manifestId: null },
      { nodeId: 'C02-A1', kind: 'ARGUMENT', parentId: 'C02', text: 'a', manifestId: null },
      { nodeId: 'C02-A1-E1', kind: 'EVIDENCE', parentId: 'C02-A1', text: 'e', manifestId: 'EVM-0002' },
      { nodeId: 'C03', kind: 'CLAIM', parentId: null, text: 'c3', manifestId: null },
    ];
    const v = safetyCaseView(nodes, [manifest(), manifest({ manifestId: 'EVM-0002', toolValidity: 'OUT_OF_RANGE' })], TARGET, []);
    expect(v.counts).toMatchObject({ claims: 3, unsupportedClaims: 2, evidence: 2, supports: 1, limit: 1 });
    expect(v.claims[0]).toMatchObject({ linked: 1, supporting: 1 });
  });
  it('열린 중대 발견이 있으면 승격 불가, 종결되면 가능', () => {
    expect(promotionVerdict([finding()])).toEqual({ promotable: false, openMajor: 1 });
    expect(promotionVerdict([finding({ status: 'CLOSED' }), finding({ severity: 'MINOR' })])).toEqual({ promotable: true, openMajor: 0 });
  });
  it('Evidence 작성자는 독립 검토자가 될 수 없다', () => {
    expect(reviewerIndependenceBlocker('usr-integrator', manifest())).toBe(ADS_REVIEWER_NOT_INDEPENDENT);
    expect(reviewerIndependenceBlocker('usr-safety2', manifest())).toBeNull();
  });
});

describe('요구 추적 판정', () => {
  const SHA = 'a'.repeat(64);
  it('근거 경로 없는 구현은 근거 없음, 검토 전은 미판정, 원본 판이 바뀌면 재검토 필요', () => {
    expect(traceVerdict({ verdict: '구현', evidence: [] }, SHA, SHA)).toBe('NO_EVIDENCE');
    expect(traceVerdict({ verdict: '구현', evidence: ['x.ts:1'] }, SHA, SHA)).toBe('IMPLEMENTED');
    expect(traceVerdict(null, SHA, SHA)).toBe('UNJUDGED');
    expect(traceVerdict({ verdict: '부분', evidence: [] }, SHA, 'b'.repeat(64))).toBe('SOURCE_CHANGED');
  });
  it('구현되지 않은 요구 수는 부분·미구현·근거 없음을 센다, 표준 개정 영향은 미판정 요구·시험도 함께', () => {
    const req = (id: string, review: AdsTraceDoc['requirements'][number]['review'], basis = 'GTR §4.1.5') => ({ id, title: id, category: 'c', priority: 'P0', owner: 'CP', content: '', acceptance: '', basis, tests: [], claims: [], hazards: [], review, defects: [] });
    const r = (verdict: string, evidence: string[] = ['x']) => ({ verdict, evidence, tests: [], gap: '', plan: [] });
    const doc: AdsTraceDoc = {
      source: { file: 'f', sha256: SHA, revision: '3.0', date: '' },
      reviewed: { sha256: SHA, reviewedAt: '', reviewedCommit: '' },
      requirements: [req('A', r('구현')), req('B', r('부분')), req('C', r('미구현')), req('D', r('구현', [])), req('E', r('범위 밖')), req('F', null, 'GTR §5.2')],
      tests: [{ id: 'TC01', name: 't', expected: '', requirements: ['F'], review: null }],
      scenarios: [],
    };
    const s = traceSummary(doc);
    expect(s.notImplemented).toBe(3);
    expect(s.counts).toMatchObject({ IMPLEMENTED: 1, PARTIAL: 1, NOT_IMPLEMENTED: 1, NO_EVIDENCE: 1, OUT_OF_SCOPE: 1, UNJUDGED: 1 });
    const imp = revisionImpact(doc, '§5.2');
    expect(imp.requirements.map((x) => x.id)).toEqual(['F']);
    expect(imp.tests.map((x) => x.id)).toEqual(['TC01']);
  });
});

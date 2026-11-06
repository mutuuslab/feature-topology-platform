// ADS 증거(ADS 사건 보고·Safety Case·요구 추적) — 순수 규칙·표·타입(첫 화면에 들어가므로 zod 최상위 호출 금지, 본문 스키마는 schemas/ads-evidence.ts)
// ADS-BE13 사건 보고 기한 · ADS-BE14 Safety Case 지지 판정·독립 검토 · ADS-UI10 요구 추적 판정. 백엔드·프론트가 같은 함수를 쓴다.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── ADS 사건 보고(ADS-BE13·UI07) ──

/** 30초 활성 창 — 사건 당시나 직전 30초 안에 ADS가 활성이었는가(차량 보고 기준). 근거가 없으면 판단 불가 */
export type AdsActiveWindow = 'IN_WINDOW' | 'OUT_OF_WINDOW' | 'UNDECIDABLE';
export const ADS_ACTIVE_WINDOW_SECONDS = 30;

/** 차량 보고 근거로 30초 활성 창을 분류한다. 보고 범위가 사건 시각 앞 30초를 덮지 못하면 판단 불가(해당 없음으로 세지 않는다) */
export function classifyActiveWindow(e: {
  occurredAt: string | null;
  /** 차량이 보고한 ADS 활성 구간(시작·끝, 끝이 없으면 사건 시각까지 활성) */
  activeSpans: { from: string; to: string | null }[] | null;
  /** 차량 보고가 덮는 시간 범위 — 이 범위 밖은 활성 여부를 모른다 */
  coverage: { from: string; to: string } | null;
}): AdsActiveWindow {
  if (!e.occurredAt || !e.activeSpans || !e.coverage) return 'UNDECIDABLE';
  const at = Date.parse(e.occurredAt);
  const from = at - ADS_ACTIVE_WINDOW_SECONDS * 1000;
  const hit = e.activeSpans.some((s) => Date.parse(s.from) <= at && (s.to === null || Date.parse(s.to) >= from));
  if (hit) return 'IN_WINDOW';
  // 활성 구간이 없더라도 보고 범위가 창 전체를 덮어야 '해당 없음'
  return Date.parse(e.coverage.from) <= from && Date.parse(e.coverage.to) >= at ? 'OUT_OF_WINDOW' : 'UNDECIDABLE';
}

/** 시장별 기한 표 한 행 — 규제 담당 승인 데이터. 승인 전(DRAFT)이면 기한을 계산하지 않는다 */
export interface AdsMarketDeadline {
  market: string;
  label: string;
  /** 단기 보고 기한 — 인지 후 일수 */
  shortTermDays: number;
  /** 정기 보고 주기 — 개월 */
  periodicMonths: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy: string | null;
  approvedAt: string | null;
  basis: string;
}

export type AdsDecision = 'REPORTABLE' | 'NOT_REPORTABLE';
/** 보고 대상 확정 — 안전·법규 담당의 기록 행위(추가만, 마지막 기록이 유효) */
export interface AdsDetermination {
  reportId: string;
  version: number;
  decision: AdsDecision;
  reason: string;
  decidedBy: string;
  decidedRole: string;
  decidedAt: string;
}

export type AdsTimelineKind = 'POLICY' | 'CONFIG' | 'ODD' | 'VERDICT' | 'TRANSITION' | 'INCIDENT';
export interface AdsIncidentEvent {
  kind: AdsTimelineKind;
  label: string;
  /** 차량 시각(차량 순서) — 차량 시계 기준, 없으면 미상 */
  vehicleAt: string | null;
  vehicleSeq: number | null;
  /** 서버 수신 시각(서버 순서) */
  serverAt: string;
  ingestSeq: number;
  owner: string | null;
  ref: string | null;
  /** 앞 이벤트와 사이에 수집 누락 구간 */
  gap?: boolean;
}

export interface AdsIncidentReport {
  reportId: string;
  featureId: string;
  featureVersion: string;
  vin: string;
  market: string;
  summary: string;
  /** 발생 시각(차량 기록) — 미상이면 null, 인지 시각으로 채우지 않는다 */
  occurredAt: string | null;
  /** 인지 시각 — 기한 계산의 기준 */
  awareAt: string;
  /** 최초 통지 기록 시각(지체 없이) */
  firstNoticeAt: string | null;
  activeWindow: { value: AdsActiveWindow; basis: string };
  configSet: string;
  oddProfileRef: string;
  /** DSSAD 기록은 차량 소관 — 상관 ID만 */
  dssadCorrelationId: string | null;
  /** 운영 감사 기록 대상 ID */
  auditTarget: string;
  shortTermSubmittedAt: string | null;
  events: AdsIncidentEvent[];
}

export type AdsReportStatus = 'REPORTABLE' | 'NOT_REPORTABLE' | 'CANDIDATE' | 'OUT_UNDECIDED' | 'UNDECIDABLE';

export interface AdsIncidentView extends AdsIncidentReport {
  determination: AdsDetermination | null;
  reportStatus: AdsReportStatus;
  deadline: AdsMarketDeadline | null;
  /** 단기 보고 기한 — 시장 기한 표가 승인 전이면 null(기한 기준 미등록) */
  shortTermDue: string | null;
  deadlineRegistered: boolean;
  /** 남은 날(올림) — 기한이 없으면 null */
  daysLeft: number | null;
  /** 인지 후 경과 시간(최초 통지 '지체 없이' — 카운트다운이 아니라 경과) */
  elapsedHours: number;
  /** 확정된 보고 대상이고, 미제출이며 기한이 7일 안 */
  dueWithin7: boolean;
  overdue: boolean;
  /** 차량 순서와 서버 수신 순서가 다른 이벤트가 있다 */
  orderDiffers: boolean;
  periodicYear: number;
}

/** 확정 기록 중 마지막(가장 큰 version) */
export const latestDetermination = (ds: AdsDetermination[], reportId: string): AdsDetermination | null =>
  ds.filter((d) => d.reportId === reportId).sort((a, b) => b.version - a.version)[0] ?? null;

/** 보고 대상 상태 — 확정 전에는 30초 창 값과 관계없이 보고 대상이 아니다(후보·미확정·판단 불가) */
export function reportStatusOf(window: AdsActiveWindow, d: AdsDetermination | null): AdsReportStatus {
  if (d) return d.decision;
  return window === 'IN_WINDOW' ? 'CANDIDATE' : window === 'OUT_OF_WINDOW' ? 'OUT_UNDECIDED' : 'UNDECIDABLE';
}

/** 단기 보고 기한 — 인지 시각 기준(발생 시각 아님), 승인된 시장 기한 표만 */
export function shortTermDueOf(awareAt: string, rule: AdsMarketDeadline | null): string | null {
  if (!rule || rule.status !== 'APPROVED') return null;
  return new Date(Date.parse(awareAt) + rule.shortTermDays * DAY).toISOString();
}

/** KST 연도 — 정기 보고 기간 */
export const kstYear = (iso: string) => new Date(Date.parse(iso) + 9 * HOUR).getUTCFullYear();

export function adsIncidentView(r: AdsIncidentReport, rule: AdsMarketDeadline | null, ds: AdsDetermination[], now: Date): AdsIncidentView {
  const determination = latestDetermination(ds, r.reportId);
  const reportStatus = reportStatusOf(r.activeWindow.value, determination);
  const shortTermDue = shortTermDueOf(r.awareAt, rule);
  const left = shortTermDue ? Date.parse(shortTermDue) - now.getTime() : null;
  const open = reportStatus === 'REPORTABLE' && !r.shortTermSubmittedAt;
  const byVehicle = r.events.filter((e) => e.vehicleSeq !== null).sort((a, b) => a.vehicleSeq! - b.vehicleSeq!);
  const byServer = [...byVehicle].sort((a, b) => a.ingestSeq - b.ingestSeq);
  return {
    ...r,
    determination,
    reportStatus,
    deadline: rule,
    shortTermDue,
    deadlineRegistered: !!rule && rule.status === 'APPROVED',
    daysLeft: left === null ? null : Math.ceil(left / DAY),
    elapsedHours: Math.max(0, Math.floor((now.getTime() - Date.parse(r.awareAt)) / HOUR)),
    dueWithin7: open && left !== null && left >= 0 && left <= 7 * DAY,
    overdue: open && left !== null && left < 0,
    orderDiffers: byVehicle.some((e, i) => byServer[i] !== e),
    periodicYear: kstYear(r.awareAt),
  };
}

/** 목록 요약 — 보고 대상 수·기한 경보는 확정된 것만. 후보·판단 불가는 따로 센다 */
export function adsIncidentSummary(items: AdsIncidentView[]) {
  const due = items.filter((i) => i.dueWithin7).sort((a, b) => Date.parse(a.shortTermDue!) - Date.parse(b.shortTermDue!));
  return {
    total: items.length,
    dueWithin7: due.length,
    nearestDue: due[0]?.shortTermDue ?? null,
    overdue: items.filter((i) => i.overdue).length,
    reportable: items.filter((i) => i.reportStatus === 'REPORTABLE').length,
    candidates: items.filter((i) => i.reportStatus === 'CANDIDATE').length,
    undecidable: items.filter((i) => i.reportStatus === 'UNDECIDABLE').length,
    deadlineUnregistered: items.filter((i) => !i.deadlineRegistered).length,
  };
}
export type AdsIncidentSummary = ReturnType<typeof adsIncidentSummary>;

/** 정기 보고 — 노출량(운행 시간·거리)당 확정된 ADS 사건. 후보·판단 불가는 비율에 넣지 않는다 */
export interface AdsExposureMonth {
  /** YYYY-MM (KST) */
  month: string;
  hours: number;
  km: number;
}
const kstMonth = (iso: string) => new Date(Date.parse(iso) + 9 * HOUR).toISOString().slice(0, 7);
export function adsPeriodicReport(year: number, months: AdsExposureMonth[], items: AdsIncidentView[]) {
  const inYear = months.filter((m) => m.month.startsWith(`${year}-`)).sort((a, b) => a.month.localeCompare(b.month));
  const incidents = items.filter((i) => i.periodicYear === year);
  const confirmed = incidents.filter((i) => i.reportStatus === 'REPORTABLE');
  const hours = inYear.reduce((a, m) => a + m.hours, 0);
  const km = inYear.reduce((a, m) => a + m.km, 0);
  const rate = (n: number, d: number, per: number) => (d > 0 ? Math.round((n / d) * per * 1000) / 1000 : null);
  return {
    year,
    months: inYear.map((m) => ({ ...m, incidents: confirmed.filter((i) => kstMonth(i.awareAt) === m.month).length })),
    exposure: { hours, km },
    incidents: {
      reportable: confirmed.length,
      candidates: incidents.filter((i) => i.reportStatus === 'CANDIDATE').length,
      undecidable: incidents.filter((i) => i.reportStatus === 'UNDECIDABLE').length,
      total: incidents.length,
    },
    per1kHours: rate(confirmed.length, hours, 1000),
    per100kKm: rate(confirmed.length, km, 100_000),
  };
}
export type AdsPeriodicReport = ReturnType<typeof adsPeriodicReport> & { featureId: string; featureVersion: string; basis: string };

// ── Safety Case 근거 지도(ADS-BE14·UI08) ──

export type AdsCaseNodeKind = 'CLAIM' | 'ARGUMENT' | 'EVIDENCE';
export interface AdsCaseNode {
  nodeId: string;
  kind: AdsCaseNodeKind;
  parentId: string | null;
  text: string;
  /** EVIDENCE 노드가 가리키는 manifest */
  manifestId: string | null;
}

/** manifest가 결합된 형상 — 현재 형상과 하나라도 다르면 재사용 불가 */
export interface AdsConfigBinding {
  policy: string;
  configSet: string;
  odd: string;
  hw: string;
  sw: string;
  model: string;
  calibration: string;
}
export const ADS_CONFIG_FIELDS = ['policy', 'configSet', 'odd', 'hw', 'sw', 'model', 'calibration'] as const;

export interface AdsEvidenceManifest {
  manifestId: string;
  featureId: string;
  featureVersion: string;
  requirementIds: string[];
  hazardIds: string[];
  config: AdsConfigBinding;
  tool: { name: string; version: string; validRange: string };
  /** 도구 유효 범위 안의 결과인가 — 밖이면 '한계' */
  toolValidity: 'IN_RANGE' | 'OUT_OF_RANGE';
  scenario: { id: string; title: string };
  expectedTransition: string;
  actualTransition: string;
  timing: { measuredMs: number; budgetMs: number; budgetStatus: 'APPROVED' | 'ASSUMED' };
  result: 'PASS' | 'FAIL';
  resultDigest: string;
  origin: 'NEW' | 'REUSED';
  /** 기존 Evidence 원장(/verify/evidence)의 참조 — 같은 원장을 두 화면이 쓰지 않는다 */
  evidenceRef: string | null;
  gateRecordId: string | null;
  author: string;
  authoredAt: string;
  review: { status: 'APPROVED' | 'PENDING'; by: string | null; at: string | null };
}

export type AdsSupport = 'SUPPORTS' | 'MISMATCH' | 'LIMIT' | 'UNREVIEWED' | 'ASSUMED' | 'FAIL';

/** 형상이 다른 항목 */
export const configDiff = (a: AdsConfigBinding, target: AdsConfigBinding) => ADS_CONFIG_FIELDS.filter((k) => a[k] !== target[k]);

/** Evidence 지지 판정 — 형상 불일치·한계·미검토·실패·가정값 시간 예산은 주장을 뒷받침한 것으로 세지 않는다 */
export function manifestSupport(m: AdsEvidenceManifest, target: AdsConfigBinding): AdsSupport {
  if (configDiff(m.config, target).length) return 'MISMATCH';
  if (m.toolValidity === 'OUT_OF_RANGE') return 'LIMIT';
  if (m.review.status !== 'APPROVED') return 'UNREVIEWED';
  if (m.result === 'FAIL') return 'FAIL';
  if (m.timing.budgetStatus === 'ASSUMED') return 'ASSUMED';
  return 'SUPPORTS';
}

export type AdsFindingSeverity = 'MAJOR' | 'MINOR';
export interface AdsReviewFinding {
  findingId: string;
  featureId: string;
  manifestId: string;
  severity: AdsFindingSeverity;
  summary: string;
  status: 'OPEN' | 'CLOSED';
  reviewer: string;
  /** 검토자 ≠ Evidence 작성자 */
  reviewerIndependent: boolean;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
}

export const ADS_REVIEWER_NOT_INDEPENDENT = '이 Evidence를 만든 사람은 독립 검토자로 발견사항을 등록할 수 없습니다.';

/** 독립성 — Safety Manager 중 그 Evidence 작성자가 아닌 사람만 독립 검토자(작성자면 사유) */
export function reviewerIndependenceBlocker(reviewer: string, m: Pick<AdsEvidenceManifest, 'author'>): string | null {
  return reviewer === m.author ? ADS_REVIEWER_NOT_INDEPENDENT : null;
}

/** 승격 가능 여부 — 열린 중대 발견이 있으면 다음 단계로 승격할 수 없다 */
export function promotionVerdict(findings: AdsReviewFinding[]) {
  const openMajor = findings.filter((f) => f.status === 'OPEN' && f.severity === 'MAJOR').length;
  return { promotable: openMajor === 0, openMajor };
}

export interface AdsCaseEvidenceView extends AdsCaseNode {
  support: AdsSupport | null;
  manifest: AdsEvidenceManifest | null;
  mismatch: string[];
}
export interface AdsClaimView {
  claim: AdsCaseNode;
  arguments: { node: AdsCaseNode; evidence: AdsCaseEvidenceView[] }[];
  linked: number;
  supporting: number;
}

/** 주장마다 연결된 Evidence와 지지하는 Evidence 수 — 주장 순서는 노드 ID 순 */
export function safetyCaseView(nodes: AdsCaseNode[], manifests: AdsEvidenceManifest[], target: AdsConfigBinding, findings: AdsReviewFinding[]) {
  const byId = new Map(manifests.map((m) => [m.manifestId, m]));
  const kids = (id: string, kind: AdsCaseNodeKind) => nodes.filter((n) => n.parentId === id && n.kind === kind).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const claims: AdsClaimView[] = nodes
    .filter((n) => n.kind === 'CLAIM')
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    .map((claim) => {
      const args = kids(claim.nodeId, 'ARGUMENT').map((node) => ({
        node,
        evidence: kids(node.nodeId, 'EVIDENCE').map((e): AdsCaseEvidenceView => {
          const m = e.manifestId ? (byId.get(e.manifestId) ?? null) : null;
          return { ...e, manifest: m, support: m ? manifestSupport(m, target) : null, mismatch: m ? configDiff(m.config, target) : [] };
        }),
      }));
      const ev = args.flatMap((a) => a.evidence).filter((e) => e.manifest);
      return { claim, arguments: args, linked: ev.length, supporting: ev.filter((e) => e.support === 'SUPPORTS').length };
    });
  const all = claims.flatMap((c) => c.arguments.flatMap((a) => a.evidence)).filter((e) => e.manifest);
  const count = (s: AdsSupport) => all.filter((e) => e.support === s).length;
  return {
    claims,
    counts: {
      claims: claims.length,
      unsupportedClaims: claims.filter((c) => c.supporting === 0).length,
      evidence: all.length,
      supports: count('SUPPORTS'),
      mismatch: count('MISMATCH'),
      limit: count('LIMIT'),
      unreviewed: count('UNREVIEWED'),
      assumed: count('ASSUMED'),
      fail: count('FAIL'),
    },
    promotion: promotionVerdict(findings),
  };
}
export type AdsSafetyCaseView = ReturnType<typeof safetyCaseView> & {
  featureId: string;
  featureVersion: string;
  featureName: string;
  target: AdsConfigBinding;
  findings: AdsReviewFinding[];
  features: { featureId: string; featureVersion: string; name: string }[];
};

// ── 요구·시험 추적(ADS-UI10) — 원천 harness/ads catalog·review를 tools/ads-trace.ts가 생성 파일로 굳힌다 ──

export type AdsTraceVerdict = 'IMPLEMENTED' | 'PARTIAL' | 'NOT_IMPLEMENTED' | 'OUT_OF_SCOPE' | 'NO_EVIDENCE' | 'SOURCE_CHANGED' | 'UNJUDGED';
export const ADS_TRACE_VERDICTS: AdsTraceVerdict[] = ['IMPLEMENTED', 'PARTIAL', 'NOT_IMPLEMENTED', 'NO_EVIDENCE', 'OUT_OF_SCOPE', 'SOURCE_CHANGED', 'UNJUDGED'];
const REVIEW_VERDICT: Record<string, AdsTraceVerdict> = { 구현: 'IMPLEMENTED', 부분: 'PARTIAL', 미구현: 'NOT_IMPLEMENTED', '범위 밖': 'OUT_OF_SCOPE' };

/** 요구 판정 — 검토 전은 미판정, 원본 판이 바뀌었으면 재검토 필요, 근거 경로 없는 '구현'은 근거 없음(구현으로 세지 않는다) */
export function traceVerdict(review: { verdict: string; evidence: string[] } | null, sourceSha: string, reviewedSha: string): AdsTraceVerdict {
  if (!review) return 'UNJUDGED';
  if (sourceSha !== reviewedSha) return 'SOURCE_CHANGED';
  const v = REVIEW_VERDICT[review.verdict] ?? 'UNJUDGED';
  return v === 'IMPLEMENTED' && review.evidence.length === 0 ? 'NO_EVIDENCE' : v;
}

/** 구현되지 않은 요구 — 부분 구현·근거 없음 포함 */
export const ADS_NOT_IMPLEMENTED: AdsTraceVerdict[] = ['PARTIAL', 'NOT_IMPLEMENTED', 'NO_EVIDENCE'];

export interface AdsTraceRequirement {
  id: string;
  title: string;
  category: string;
  priority: string;
  owner: string;
  content: string;
  acceptance: string;
  basis: string;
  tests: string[];
  claims: string[];
  hazards: string[];
  review: { verdict: string; evidence: string[]; tests: string[]; gap: string; plan: string[] } | null;
  /** 열린 결함 기록(it.fails) — probe는 시험 파일:줄 */
  defects: { probe: string; title: string }[];
}
export interface AdsTraceTest {
  id: string;
  name: string;
  expected: string;
  requirements: string[];
  review: { status: string; evidence: string[]; plan: string[] } | null;
}
export interface AdsTraceScenario {
  id: string;
  title: string;
  situation: string;
  /** 목표 — 보고서의 처리 방안 */
  handling: string;
  review: { current: string; gap: string; plan: string[] } | null;
}
export interface AdsTraceDoc {
  source: { file: string; sha256: string; revision: string; date: string };
  reviewed: { sha256: string; reviewedAt: string; reviewedCommit: string } | null;
  requirements: AdsTraceRequirement[];
  tests: AdsTraceTest[];
  scenarios: AdsTraceScenario[];
}

/** 인수시험 상태 — 검토 전·원본 변경은 null(미판정) */
export const traceTestStatus = (t: AdsTraceTest, sourceSha: string, reviewedSha: string): string | null => (!t.review || sourceSha !== reviewedSha ? null : t.review.status);

/** 표준 개정 영향 — 근거 조항에 질의가 들어간 요구와 연결 시험(미판정 포함) */
export function revisionImpact(doc: AdsTraceDoc, clause: string) {
  const q = clause.trim();
  if (!q) return { requirements: [] as AdsTraceRequirement[], tests: [] as AdsTraceTest[] };
  const reqs = doc.requirements.filter((r) => r.basis.includes(q));
  const ids = new Set(reqs.map((r) => r.id));
  return { requirements: reqs, tests: doc.tests.filter((t) => t.requirements.some((id) => ids.has(id))) };
}

export function traceSummary(doc: AdsTraceDoc) {
  const reviewedSha = doc.reviewed?.sha256 ?? '';
  const verdicts = doc.requirements.map((r) => traceVerdict(r.review, doc.source.sha256, reviewedSha));
  const by = (v: AdsTraceVerdict) => verdicts.filter((x) => x === v).length;
  return {
    total: doc.requirements.length,
    notImplemented: verdicts.filter((v) => ADS_NOT_IMPLEMENTED.includes(v)).length,
    counts: Object.fromEntries(ADS_TRACE_VERDICTS.map((v) => [v, by(v)])) as Record<AdsTraceVerdict, number>,
    openDefects: doc.requirements.reduce((a, r) => a + r.defects.length, 0),
    testsAutomated: doc.tests.filter((t) => traceTestStatus(t, doc.source.sha256, reviewedSha) === '자동 시험 있음').length,
  };
}

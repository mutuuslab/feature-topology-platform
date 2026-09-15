// PLM 기준정보·원천 연계 화면의 작업 데이터 (UI07 · UI21 · UI22 · UI23 · UI24 · UI26 · UI30).
//
// 이 화면들은 기준정보를 **정확 버전으로 고정해** 상품·구성·사양·연계·추적에 연결한다.
// 값은 화면 동작을 확인하기 위한 시드이며, 화면은 여기 값 + 사용자가 만든 행을 함께 다룬다.

// ── UI07 Catalog 상품 구성 ─────────────────────────────
export const OFFER_STATES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'WITHDRAWN'] as const;
export type OfferState = (typeof OFFER_STATES)[number];
export const OFFER_DELIVERY = ['BASIC', 'OPTION', 'SUBSCRIPTION'] as const;

export interface OfferingItem { feature: string; exactVersion: string; role: 'BASE' | 'ADDON'; }
export interface Offer {
  id: string; name: string; version: string; bomRef: string; topologyRef: string;
  market: 'KR' | 'EU'; delivery: (typeof OFFER_DELIVERY)[number]; publish: OfferState;
  description: string; items: OfferingItem[];
}

export const SEED_OFFERS: Offer[] = [
  {
    id: 'OFF-BDC-PREM', name: 'Body Control Premium', version: '1.2', bomRef: 'BL-BDC-2027.1@1.0.0', topologyRef: 'TOPO-BDC-BODY@3.1.0',
    market: 'KR', delivery: 'SUBSCRIPTION', publish: 'PUBLISHED', description: 'KR Premium 차종 대상 정책형 구독 상품.',
    items: [{ feature: 'FEAT-BDC-001', exactVersion: '1.1.0', role: 'BASE' }],
  },
  {
    id: 'OFF-ADAS-PACK', name: 'ADAS Safety Pack', version: '2.0', bomRef: 'BL-ADAS-2027.1@1.0.0', topologyRef: 'TOPO-ADAS-LONG@2.0.0',
    market: 'EU', delivery: 'OPTION', publish: 'IN_REVIEW', description: 'EU Gen3 대상 ADAS 옵션 패키지.',
    items: [{ feature: 'FEAT-ADAS-001', exactVersion: '2.4.0', role: 'BASE' }, { feature: 'FEAT-BDC-001', exactVersion: '1.1.0', role: 'ADDON' }],
  },
  {
    id: 'OFF-LIGHT-BASIC', name: 'Welcome Light Basic', version: '1.0', bomRef: 'BL-LIGHT-2026.1@2.0.0', topologyRef: 'TOPO-BDC-BODY@1.0.0',
    market: 'KR', delivery: 'BASIC', publish: 'DRAFT', description: '기본 제공형 라이트 상품.',
    items: [{ feature: 'FEAT-LIGHT-001', exactVersion: '2.0.0', role: 'BASE' }],
  },
];

export const OFFER_STATE_KO: Record<OfferState, string> = {
  DRAFT: '초안', IN_REVIEW: '검토', APPROVED: '승인', PUBLISHED: '발행', WITHDRAWN: '철회',
};
export const OFFER_STATE_TONE: Record<OfferState, string> = {
  DRAFT: '#8a8f98', IN_REVIEW: '#b8860b', APPROVED: '#2b6cb0', PUBLISHED: '#2f855a', WITHDRAWN: '#c53030',
};

/** 발행 조건 — 승인과 구성 검증을 통과해야 판매에 쓸 수 있다. */
export function offerGate(o: Offer, baselinesHave: (ref: string) => boolean): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const need = (c: boolean, m: string) => { if (!c) reasons.push(m); };
  if (o.publish !== 'PUBLISHED') {
    need(!!o.bomRef.trim(), 'BOM 기준선 미지정');
    need(baselinesHave(o.bomRef), `BOM 기준선 ${o.bomRef} 이 Registry 에 없다`);
    need(o.items.length > 0, 'OfferingItem(Feature 구성) 없음 — 빈 상품은 발행하지 않는다');
    need(o.items.every(i => !!i.exactVersion.trim()), 'Feature 정확 버전 미지정');
    if (o.delivery === 'SUBSCRIPTION') need(o.publish === 'APPROVED', '구독 상품은 승인(APPROVED) 후에만 발행한다');
  }
  return { ok: reasons.length === 0, reasons };
}

// ── UI21 UPG와 UPG VC ────────────────────────────────
export const UPG_STATES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED'] as const;
export type UpgState = (typeof UPG_STATES)[number];
export const UPG_STATE_KO: Record<UpgState, string> = { DRAFT: '초안', IN_REVIEW: '검토', APPROVED: '승인', RETIRED: '폐기' };

export interface Upg {
  id: string; name: string; vc: string; approved: UpgState; source: string;
  /** 식별 5절 — System(2) · Component(4) · 차종 번호(2) · 차종 코드(3) · Serial(3) */
  system: string; component: string; modelNo: string; modelCode: string; serial: string;
}

export const SEED_UPGS: Upg[] = [
  { id: 'UPG-BDC-001', name: 'BDC Body Control', vc: 'VC-A', approved: 'APPROVED', source: 'PLM-UPG-2026.08', system: '11', component: '2201', modelNo: '00', modelCode: 'BDC', serial: '001' },
  { id: 'UPG-ADAS-014', name: 'ADAS Long Range', vc: 'VC-A', approved: 'APPROVED', source: 'PLM-UPG-2026.08', system: '22', component: '3310', modelNo: '07', modelCode: 'ADL', serial: '014' },
  { id: 'UPG-CONN-007', name: 'Connectivity Gateway', vc: 'VC-B', approved: 'IN_REVIEW', source: 'PLM-UPG-2026.09', system: '33', component: '4402', modelNo: '00', modelCode: 'CNG', serial: '007' },
  { id: 'UPG-SEAT-003', name: 'Seat Comfort Module', vc: 'VC-A', approved: 'DRAFT', source: 'PLM-UPG-2026.09', system: '44', component: '551', modelNo: '12', modelCode: 'SCT', serial: '003' },
];

/** UPG 식별자 조립 — 2/4/2/3/3 자리 규칙을 그대로 검사한다. */
export function upgIdent(system: string, component: string, modelNo: string, modelCode: string, serial: string) {
  const fixed = (v: string, n: number) => new RegExp(`^[0-9A-Z]{${n}}$`).test(v);
  const reasons: string[] = [];
  if (!fixed(system, 2)) reasons.push('System 은 2자리');
  if (!fixed(component, 4)) reasons.push('Component 는 4자리');
  if (!(modelNo === '' || fixed(modelNo, 2))) reasons.push('차종 번호는 2자리');
  if (!fixed(modelCode, 3)) reasons.push('차종 코드는 3자리');
  if (!(serial === '' || fixed(serial, 3))) reasons.push('Serial 은 3자리 후보');
  return { ok: reasons.length === 0, reasons, id: `${system}-${component}-${modelNo || '00'}-${modelCode}-${serial || '000'}` };
}

// ── UI22 SW Structure ────────────────────────────────
export const STRUCT_STATES = ['DRAFT', 'INVALID', 'VALIDATED', 'FROZEN'] as const;
export type StructState = (typeof STRUCT_STATES)[number];
export const STRUCT_STATE_KO: Record<StructState, string> = { DRAFT: '초안', INVALID: '오류', VALIDATED: '검증', FROZEN: '고정' };

export interface StructMember { node: string; parent: string; sw: string; level: number; qty: number; upgvc: string }
export interface SwStructure {
  id: string; name: string; version: string; upg: string; state: StructState; reason: string;
  members: StructMember[];
}

export const SEED_STRUCTURES: SwStructure[] = [
  {
    id: 'STR-BDC-SW', name: 'BDC Body Control SW Structure', version: '1.1', upg: 'UPG-BDC-001', state: 'VALIDATED', reason: 'POLICY-EVALUATOR 포함 계층 확정',
    members: [
      { node: 'SWC-BDC-TOP', parent: '', sw: 'v1.1.0', level: 1, qty: 1, upgvc: 'VC-A' },
      { node: 'SWC-POLICY-EVALUATOR', parent: 'SWC-BDC-TOP', sw: 'v1.1.0', level: 2, qty: 1, upgvc: 'VC-A' },
      { node: 'SIG-BDC-LOCK', parent: 'SWC-POLICY-EVALUATOR', sw: 'v1.1.0', level: 3, qty: 2, upgvc: 'VC-A' },
    ],
  },
  {
    id: 'STR-ADAS-SW', name: 'ADAS Long Range SW Structure', version: '2.0', upg: 'UPG-ADAS-014', state: 'FROZEN', reason: 'AEB 분류 확장 반영 완료',
    members: [
      { node: 'SWC-ADAS-TOP', parent: '', sw: 'v2.0.0', level: 1, qty: 1, upgvc: 'VC-A' },
      { node: 'SWC-AEB-CLASSIFY', parent: 'SWC-ADAS-TOP', sw: 'v2.0.0', level: 2, qty: 1, upgvc: 'VC-A' },
    ],
  },
  {
    id: 'STR-CONN-SW', name: 'Connectivity Gateway SW Structure', version: '0.9', upg: 'UPG-CONN-007', state: 'INVALID', reason: '부모 미지정 구성원 존재',
    members: [
      { node: 'SWC-CONN-TOP', parent: '', sw: 'v0.9.0', level: 1, qty: 1, upgvc: 'VC-B' },
      { node: 'SWC-TLS-TERM', parent: '', sw: 'v0.9.0', level: 2, qty: 1, upgvc: 'VC-B' },
    ],
  },
];

/** 구조 검사 — 정확 SW 버전·부모 연결·수량·UPG VC 일관성을 본다. */
export function structureCheck(s: SwStructure) {
  const issues: { node: string; code: 'NO_PARENT' | 'NO_VERSION' | 'QTY' | 'UPGVC' | 'CYCLE' }[] = [];
  const nodes = new Set(s.members.map(m => m.node));
  s.members.forEach(m => {
    if (m.level > 1 && !m.parent) issues.push({ node: m.node, code: 'NO_PARENT' });
    if (!/^v\d+\.\d+\.\d+$/.test(m.sw)) issues.push({ node: m.node, code: 'NO_VERSION' });
    if (m.qty < 1) issues.push({ node: m.node, code: 'QTY' });
    if (!m.upgvc) issues.push({ node: m.node, code: 'UPGVC' });
    if (m.parent && !nodes.has(m.parent)) issues.push({ node: m.node, code: 'CYCLE' });
  });
  return { ok: issues.length === 0, issues };
}

export const CHECK_KO: Record<string, string> = {
  NO_PARENT: '부모 미지정', NO_VERSION: 'SW 정확 버전 아님', QTY: '수량 1 미만', UPGVC: 'UPG VC 미지정', CYCLE: '부모 참조 오류',
};

// ── UI23 SW EO 변경관리 ───────────────────────────────
export const EO_STATES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ISSUE_PENDING', 'ISSUED', 'ACK_PENDING', 'ACKED'] as const;
export type EoState = (typeof EO_STATES)[number];
export const EO_STATE_KO: Record<EoState, string> = {
  DRAFT: '초안', IN_REVIEW: '협조 검토', APPROVED: '승인', ISSUE_PENDING: '발행 대기',
  ISSUED: '발행', ACK_PENDING: 'BOM 반영 대기', ACKED: '반영 확인',
};
export const EO_CHANGE_TYPES = ['I', 'R', 'P', 'U'] as const;

export interface SwEo {
  id: string; name: string; structure: string; oldStructure: string; changeType: (typeof EO_CHANGE_TYPES)[number];
  reason: string; mainText: string; aText: string; bText: string; officialNo: string;
  state: EoState; review: string; bomAck: string;
}

export const SEED_EOS: SwEo[] = [
  { id: 'EO-2026-0042', name: 'BDC Policy Evaluator 포함', structure: 'STR-BDC-SW@1.1', oldStructure: 'STR-BDC-SW@1.0',
    changeType: 'I', reason: '정책 평가 SWC 포함 계층 확정', mainText: 'SWC-POLICY-EVALUATOR 를 1.1 에 포함', aText: 'A 차종 적용 없음', bText: 'B 차종 적용 없음',
    officialNo: 'EO-BDC-2026-0042', state: 'ACKED', review: '품질 검토 완료 (2026-09-02)', bomAck: 'BOM-BDC-2026.09@1.1 반영' },
  { id: 'EO-2026-0043', name: 'ADAS AEB 분류 확장', structure: 'STR-ADAS-SW@2.0', oldStructure: 'STR-ADAS-SW@1.9',
    changeType: 'R', reason: 'AEB 목표물 분류 SWC 교체', mainText: 'SWC-AEB-CLASSIFY v2.0.0 로 교체', aText: 'A 차종 2026-10 적용', bText: '—',
    officialNo: 'EO-ADAS-2026-0043', state: 'ACK_PENDING', review: '기술 검토 완료 (2026-09-08)', bomAck: '' },
  { id: 'EO-2026-0044', name: 'Connectivity TLS 종단 추가', structure: 'STR-CONN-SW@0.9', oldStructure: '',
    changeType: 'I', reason: 'TLS 종단 SWC 신규', mainText: 'SWC-TLS-TERM 추가', aText: '—', bText: '—',
    officialNo: '', state: 'DRAFT', review: '', bomAck: '' },
];

/** 발행·대사 게이트 — 발행 요청 전 협조 검토, 반영 확인 전 대사가 필요하다. */
export function eoGate(e: SwEo, to: EoState): { ok: boolean; reasons: string[] } {
  const order: EoState[] = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'ISSUE_PENDING', 'ISSUED', 'ACK_PENDING', 'ACKED'];
  const from = order.indexOf(e.state);
  const toIdx = order.indexOf(to);
  const reasons: string[] = [];
  if (toIdx <= from) return { ok: false, reasons: ['발행 흐름은 앞으로만 진행한다 — 되돌리려면 새 요청(변경 유형 R)을 만든다'] };
  if (toIdx - from > 1) return { ok: false, reasons: [`${EO_STATE_KO[e.state]} 에서 ${EO_STATE_KO[to]} 로 건너뛸 수 없다`] };
  if (to === 'APPROVED') {
    if (!e.reason.trim()) reasons.push('변경 사유 없음');
    if (!e.mainText.trim()) reasons.push('Main 변경 내용 없음');
    if (!e.oldStructure.trim() && e.changeType !== 'I') reasons.push('New/Old 구성 비교에 Old 구성 없음');
  }
  if (to === 'ISSUED') {
    if (!e.officialNo.trim()) reasons.push('공식 번호 미발급 — 발행은 공식 번호와 함께만 성립한다');
    if (!e.review.trim()) reasons.push('협조 검토 결과 없음');
  }
  if (to === 'ACKED') {
    if (!e.bomAck.trim()) reasons.push('BOM 반영 대사 결과 없음');
  }
  return { ok: reasons.length === 0, reasons };
}

// ── UI24 제품사양과 HW Variant ────────────────────────
export const SPEC_STATES = ['DRAFT', 'ALLOW', 'DENY', 'UNKNOWN'] as const;
export type SpecState = (typeof SPEC_STATES)[number];
export const SPEC_STATE_KO: Record<SpecState, string> = { DRAFT: '작성', ALLOW: '허용', DENY: '차단', UNKNOWN: '미정' };
export const SPEC_STATE_TONE: Record<SpecState, string> = { DRAFT: '#8a8f98', ALLOW: '#2f855a', DENY: '#c53030', UNKNOWN: '#b8860b' };

export interface VariantRow { nation: string; market: string; model: string; trim: string; variant: string; review: SpecState; note: string }
export interface ProductSpec {
  id: string; revision: string; model: string; plant: string; market: 'KR' | 'EU';
  options: string; state: SpecState; rows: VariantRow[];
}

export const SEED_SPECS: ProductSpec[] = [
  {
    id: 'SPEC-BDC-MY27', revision: '1.1', model: 'BDC', plant: 'KR-HMA', market: 'KR', options: 'Premium · Gen3', state: 'ALLOW',
    rows: [
      { nation: 'KR', market: 'KR', model: 'BDC-BODY', trim: 'Premium', variant: 'ECU-BDC-B · v3.2.0', review: 'ALLOW', note: '' },
      { nation: 'EU', market: 'EU', model: 'BDC-BODY', trim: 'Premium', variant: 'ECU-BDC-C · v3.2.0', review: 'ALLOW', note: '' },
      { nation: 'US', market: 'US', model: 'BDC-BODY', trim: 'Premium', variant: 'ECU-BDC-C · v3.2.0', review: 'DENY', note: 'US 미인증 구성 — Variant Blocked' },
      { nation: 'CN', market: 'CN', model: 'BDC-BODY', trim: 'Standard', variant: 'ECU-BDC-B · v3.1.x', review: 'UNKNOWN', note: 'PIPL 검토 중 — 임의 확정하지 않는다' },
    ],
  },
  {
    id: 'SPEC-ADAS-MY27', revision: '2.0', model: 'ADAS-LONG', plant: 'KR-HMA', market: 'KR', options: 'ADAS Pack · Gen3', state: 'DRAFT',
    rows: [
      { nation: 'KR', market: 'KR', model: 'ADAS-LONG', trim: 'ANY', variant: 'ECU-ADAS-A · v2.0.0', review: 'UNKNOWN', note: 'HIL 미실시' },
      { nation: 'EU', market: 'EU', model: 'ADAS-LONG', trim: 'ANY', variant: 'ECU-ADAS-A · v2.0.0', review: 'UNKNOWN', note: 'R156 추가 심사 필요' },
    ],
  },
];

export const specStats = (rows: VariantRow[]) => ({
  allow: rows.filter(r => r.review === 'ALLOW').length,
  deny: rows.filter(r => r.review === 'DENY').length,
  unknown: rows.filter(r => r.review === 'UNKNOWN').length,
});

// ── UI26 연계 작업과 재처리 ───────────────────────────
export const JOB_STAGES = ['PENDING', 'ACK_WAIT', 'RETRY_READY', 'DEAD_LETTER', 'SUCCEEDED', 'CANCELLED'] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const JOB_STAGE_KO: Record<JobStage, string> = {
  PENDING: '대기', ACK_WAIT: '응답 대기', RETRY_READY: '재처리 가능', DEAD_LETTER: '격리', SUCCEEDED: '성공', CANCELLED: '취소',
};
export const JOB_STAGE_TONE: Record<JobStage, string> = {
  PENDING: '#8a8f98', ACK_WAIT: '#b8860b', RETRY_READY: '#2b6cb0', DEAD_LETTER: '#c53030', SUCCEEDED: '#2f855a', CANCELLED: '#9ca3af',
};

export interface IntegrationJob {
  id: string; source: string; object: string; stage: JobStage; attempts: number;
  nextRetry: string; error: string; owner: string;
  capture?: { requestId: string; payloadHash: string; origin: string };
  cancel?: { reason: string; isolated: boolean; handedTo: string };
}

export const SEED_JOBS: IntegrationJob[] = [
  { id: 'JOB-2026-0912', source: 'PLM-UPG', object: 'UPG-CONN-007', stage: 'ACK_WAIT', attempts: 2, nextRetry: '2026-09-14 11:20', error: '원천 승인 응답 지연', owner: 'integrator', capture: { requestId: 'req-77a1', payloadHash: 'sha256:9f21c4', origin: 'PLM-UPG-2026.09' } },
  { id: 'JOB-2026-0911', source: 'BOM-SYNC', object: 'BOM-BDC-2026.09@1.1', stage: 'SUCCEEDED', attempts: 1, nextRetry: '', error: '', owner: 'steward', capture: { requestId: 'req-77a0', payloadHash: 'sha256:1b04d8', origin: 'PLM-BOM-2026.09' } },
  { id: 'JOB-2026-0908', source: 'PLM-UPG', object: 'UPG-SEAT-003', stage: 'RETRY_READY', attempts: 3, nextRetry: '2026-09-14 12:05', error: '필수 속성 누락 (Component)', owner: 'integrator', capture: { requestId: 'req-779c', payloadHash: 'sha256:c3aa71', origin: 'PLM-UPG-2026.09' } },
  { id: 'JOB-2026-0902', source: 'SUPPLIER-API', object: 'API-BDC-POLICY-CONTROL@1.5', stage: 'DEAD_LETTER', attempts: 5, nextRetry: '', error: '계약 버전 불일치 — 4회 재시도 후 격리', owner: 'coordinator', capture: { requestId: 'req-7788', payloadHash: 'sha256:44be03', origin: 'SUPPLIER-ACK-2026.09' } },
  { id: 'JOB-2026-0899', source: 'PLM-UPG', object: 'UPG-ADAS-014', stage: 'CANCELLED', attempts: 1, nextRetry: '', error: '요청 취소 — 상위 변경요청 반려', owner: 'integrator', capture: { requestId: 'req-7780', payloadHash: 'sha256:0d9c12', origin: 'PLM-UPG-2026.08' }, cancel: { reason: 'CR-2026-0129 반려', isolated: true, handedTo: 'steward' } },
];

// ── UI30 요구·설계 추적 ───────────────────────────────
export const TRACE_STATES = ['SOURCE', 'DESIGN_LINKED', 'REVIEW_REQUIRED', 'TEST_NOT_RUN'] as const;
export type TraceState = (typeof TRACE_STATES)[number];
export const TRACE_STATE_KO: Record<TraceState, string> = {
  SOURCE: '원문만', DESIGN_LINKED: '설계 연결', REVIEW_REQUIRED: '검토 필요', TEST_NOT_RUN: '시험 미실시',
};
export const TRACE_STATE_TONE: Record<TraceState, string> = {
  SOURCE: '#8a8f98', DESIGN_LINKED: '#2f855a', REVIEW_REQUIRED: '#b8860b', TEST_NOT_RUN: '#c53030',
};

export interface TraceRow {
  id: string; requirement: string; source: string; screen: string; design: string; test: string; verdict: TraceState;
}

export const SEED_TRACES: TraceRow[] = [
  { id: 'FR-REG-002', requirement: 'Feature 등록은 7개 기준을 심사한다', source: 'SRC38 김효정책임_AVP_Feature_등록!20', screen: 'UI02', design: 'C01 Feature Registry', test: 'ui02Register', verdict: 'DESIGN_LINKED' },
  { id: 'FR-REG-005', requirement: '승인된 버전의 직접 수정은 차단한다', source: 'SRC46 01_Feature 정책 관리!23', screen: 'UI02', design: 'C01 Feature Registry', test: 'specData', verdict: 'DESIGN_LINKED' },
  { id: 'FR-PRP-001', requirement: '제안 5단계와 3개 경로를 구분한다', source: 'SRC38 김효정책임_AVP_Feature_등록!2', screen: 'UI19', design: 'C01 Feature 제안', test: '', verdict: 'TEST_NOT_RUN' },
  { id: 'FR-PRP-004', requirement: '개발 이관을 착수 승인으로 표시하지 않는다', source: 'SRC38 김효정책임_AVP_Feature_등록!5', screen: 'UI19', design: 'C01 개발 이관', test: '', verdict: 'REVIEW_REQUIRED' },
  { id: 'FR-BOM-011', requirement: 'Quality 확인과 G+M 허가 후 정책을 발행한다', source: 'SRC46 01_Feature 정책 관리!23', screen: 'UI04', design: 'C03 Feature BOM', test: 'featureBom', verdict: 'DESIGN_LINKED' },
  { id: 'FR-STR-007', requirement: 'Structure 는 정확 SW 버전으로 계층을 고정한다', source: 'SRC52 PLM SW Structure!4', screen: 'UI22', design: 'C03 SW Structure', test: '', verdict: 'SOURCE' },
  { id: 'FR-SPEC-003', requirement: 'HW 사양은 국가·차종·Trim 조합으로 판정한다', source: 'SRC55 제품사양 관리!7', screen: 'UI24', design: 'C15 적용 대상 선정', test: '', verdict: 'SOURCE' },
];

export const traceStats = (rows: TraceRow[]) => ({
  total: rows.length,
  linked: rows.filter(r => r.verdict === 'DESIGN_LINKED').length,
  review: rows.filter(r => r.verdict === 'REVIEW_REQUIRED').length,
  notRun: rows.filter(r => r.verdict === 'TEST_NOT_RUN').length,
  sourceOnly: rows.filter(r => r.verdict === 'SOURCE').length,
});

// codeBeamer 산출물 8종과 완결성 규칙(80-50 §5, D-ALM-9·12·13) — 순수 함수. 백엔드(수집·게이트)·화면·모의 서버 시험이 같은 표를 쓴다.
// '작성됨' = codeBeamer 승인 상태 + 위·아래 추적 완결. 관계는 아래(소비) 항목 → 위(근거) 항목 방향: SW_REQ ─derived→ SYS_REQ.
import type { GateId } from '../../enums';

export const WP_KINDS = ['SYS_REQ', 'SYS_ARCH', 'SW_REQ', 'SW_ARCH', 'SW_DD', 'SAFETY_REQ', 'CS_REQ', 'TEST_SPEC'] as const;
export type WpKind = (typeof WP_KINDS)[number];
export const WP_RELATIONS = ['derived', 'allocated', 'refines', 'verifies'] as const;
export type WpRelationKind = (typeof WP_RELATIONS)[number];

export interface WorkProductRule {
  key: WpKind;
  /** ASPICE 공정·표준 */
  process: string;
  /** 화면 이름 */
  ko: string;
  /** 트래커 이름(실서버 명명 방식, D-ALM-15) */
  tracker: string;
}
export const WORK_PRODUCTS: readonly WorkProductRule[] = [
  { key: 'SYS_REQ', process: 'SYS.2', ko: '시스템 요구', tracker: '[SYS.2]System Requirements Specification' },
  { key: 'SYS_ARCH', process: 'SYS.3', ko: '시스템 아키텍처', tracker: '[SYS.3]System Architectural Design' },
  { key: 'SW_REQ', process: 'SWE.1', ko: 'SW 요구', tracker: '[SWE.1]Software Requirements Specification' },
  { key: 'SW_ARCH', process: 'SWE.2', ko: 'SW 아키텍처', tracker: '[SWE.2]Software Architectural Design' },
  { key: 'SW_DD', process: 'SWE.3', ko: 'SW 상세설계', tracker: '[SWE.3]Software Detailed Design' },
  { key: 'SAFETY_REQ', process: 'ISO 26262', ko: '기능안전 요구', tracker: '[FSR/TSR]Functional & Technical Safety Requirements' },
  { key: 'CS_REQ', process: 'ISO/SAE 21434', ko: '사이버보안 요구', tracker: '[CS]Cybersecurity Requirements' },
  { key: 'TEST_SPEC', process: 'SWE.4~6·SYS.4~5', ko: '시험 사양', tracker: '[TEST]Test Specification' },
];
export const WORK_PRODUCT = Object.fromEntries(WORK_PRODUCTS.map((w) => [w.key, w])) as Record<WpKind, WorkProductRule>;
/** 트래커 이름 → 종류(실서버 트래커 목록에서 고른다) */
export const wpKindOfTracker = (name: string): WpKind | null => WORK_PRODUCTS.find((w) => w.tracker.toLowerCase() === name.trim().toLowerCase())?.key ?? null;

/** 위(근거) 종류별로 아래 항목이 걸 수 있는 관계 — 참조 필드처럼 관계 이름이 없을 때 종류 쌍으로 고른다 */
export function relationKindOf(from: WpKind, to: WpKind): WpRelationKind | null {
  if (from === 'TEST_SPEC') return 'verifies';
  if (from === 'SW_REQ' && to === 'SYS_REQ') return 'derived';
  if (from === 'SW_REQ' && to === 'SYS_ARCH') return 'derived';
  if (from === 'SYS_ARCH' && to === 'SYS_REQ') return 'allocated';
  if (from === 'SW_ARCH' && to === 'SW_REQ') return 'allocated';
  if (from === 'SW_DD' && to === 'SW_ARCH') return 'refines';
  if ((from === 'SYS_REQ' || from === 'SW_REQ') && (to === 'SAFETY_REQ' || to === 'CS_REQ')) return 'allocated';
  return null;
}

export interface WpItem {
  /** 'CB-1234' */
  key: string;
  kind: WpKind;
  title: string;
  status: string;
  approved: boolean;
  /** codeBeamer item version */
  version: number;
  /** FF Version 칸 — 비면 모든 버전 */
  ffVersion?: string | null;
  /** HW 전용 SYS_REQ의 면제 사유(Allocation Rationale, WP-2) */
  allocationRationale?: string | null;
  obsolete?: boolean;
  /** Requirement ID 칸(SYS_REQ) — FF Feature의 요구 ID와 대조(FR-DEP-005-002) */
  reqId?: string | null;
  /** codeBeamer가 이 항목에 의심 링크를 표시함(cbQL hasSuspectedLink) — FF 계산과 대조만 */
  cbSuspected?: boolean;
}
export interface WpRelation {
  from: string;
  to: string;
  kind: WpRelationKind;
  /** FF가 계산한 의심(승인 뒤 위 항목이 바뀜, §5.6) */
  suspect: boolean;
}
/** 필요 조건(§5.1) — ASIL·사이버보안 대상 */
export interface WpContext {
  asil: string;
  /** TARA 대상(D10 A-4 기본값: 차량 외부 통신·원격 제어·OTA 관련) */
  cyber: boolean;
}

/** 사이버보안 요구가 필요한가(A-4) — 형식승인 영향(R155)·ADS·TARA 기록이 있거나 연결 도메인이 통신·텔레매틱스, 이름·태그에 원격·OTA·커넥티드 */
export function cyberRequired(p: { regClass?: string | null; adsFeature?: boolean; hasTara?: boolean; refDomains?: string[]; name?: string; tags?: string[] }): { required: boolean; why: string } {
  if (p.hasTara) return { required: true, why: 'TARA 기록이 있는 Feature' };
  if (p.adsFeature) return { required: true, why: 'ADS 기능' };
  if (p.regClass && p.regClass !== 'R0') return { required: true, why: `형식승인 영향 ${p.regClass}(UNECE R155 범위)` };
  if ((p.refDomains ?? []).includes('CO')) return { required: true, why: '차량 외부 통신(Connectivity & Telematics)' };
  const text = `${p.name ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase();
  if (/원격|remote|ota|커넥티드|connected|텔레매틱스|telematics/.test(text)) return { required: true, why: '원격 제어·OTA·외부 통신' };
  return { required: false, why: '외부 통신·원격 제어·OTA 관련이 아님' };
}

/** 이 Feature에 필요한 종류 */
export function requiredKinds(ctx: WpContext): WpKind[] {
  return WP_KINDS.filter((k) => (k === 'SAFETY_REQ' ? ctx.asil !== 'QM' : k === 'CS_REQ' ? ctx.cyber : true));
}

export const WP_RULES = ['WP-1', 'WP-2', 'WP-3', 'WP-4', 'WP-5', 'WP-6', 'WP-7'] as const;
export type WpRule = (typeof WP_RULES)[number];
export const WP_RULE_KO: Record<WpRule, string> = {
  'WP-1': '승인된 항목이 있어야 합니다',
  'WP-2': '시스템 요구마다 SW 요구 도출 또는 시스템 아키텍처 할당',
  'WP-3': 'SW 요구 → SW 아키텍처 → SW 상세설계 추적',
  'WP-4': '안전·보안 요구마다 시스템·SW 요구 할당',
  'WP-5': '요구·설계 항목마다 시험 사양 검증',
  'WP-6': '승인 항목이 미승인 항목에 기대지 않음',
  'WP-7': '의심(suspect) 관계 없음',
};
export interface WpProblem {
  rule: WpRule;
  kind: WpKind;
  /** 문제 항목(없으면 종류 전체) */
  item: string | null;
  why: string;
}
export interface WpKindRow {
  kind: WpKind;
  required: boolean;
  items: number;
  approved: number;
  passed: boolean;
  problems: number;
}
export interface WpResult {
  featureId: string;
  version: string;
  kinds: WpKindRow[];
  /** 규칙을 통과한 종류 / 필요한 종류 */
  passedKinds: number;
  requiredKinds: number;
  rate: number;
  problems: WpProblem[];
  suspects: number;
  /** 결과 판정에 쓴 항목·관계(증거 해시의 원문) */
  basis: string;
}

/** 이 버전에 해당하는 항목 — 폐기(Obsolete) 빼고, FF Version이 비었거나 같은 것 */
export const itemsForVersion = (items: readonly WpItem[], version: string) => items.filter((i) => !i.obsolete && (!i.ffVersion || i.ffVersion === version));

/** 완결성(§5.4) — 종류별 통과·작성률·누락 목록 */
export function computeCompleteness(input: { featureId: string; version: string; ctx: WpContext; items: readonly WpItem[]; relations: readonly WpRelation[] }): WpResult {
  const items = itemsForVersion(input.items, input.version);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const rels = input.relations.filter((r) => byKey.has(r.from) && byKey.has(r.to));
  const need = new Set(requiredKinds(input.ctx));
  const problems: WpProblem[] = [];
  const of = (k: WpKind) => items.filter((i) => i.kind === k);
  const into = (to: string, kinds: WpKind[], rel?: WpRelationKind) => rels.some((r) => r.to === to && (!rel || r.kind === rel) && kinds.includes(byKey.get(r.from)!.kind));
  // WP-1
  for (const k of need) if (!of(k).some((i) => i.approved)) problems.push({ rule: 'WP-1', kind: k, item: null, why: `${WORK_PRODUCT[k].ko} 승인 항목 0건` });
  // WP-2
  for (const i of of('SYS_REQ')) if (!i.allocationRationale && !into(i.key, ['SW_REQ'], 'derived') && !into(i.key, ['SYS_ARCH'], 'allocated')) problems.push({ rule: 'WP-2', kind: 'SYS_REQ', item: i.key, why: `${i.key} — SW 요구 도출·시스템 아키텍처 할당 없음` });
  // WP-3
  for (const i of of('SW_REQ')) if (!into(i.key, ['SW_ARCH'], 'allocated')) problems.push({ rule: 'WP-3', kind: 'SW_REQ', item: i.key, why: `${i.key} — SW 아키텍처 할당 없음` });
  for (const i of of('SW_ARCH')) if (!into(i.key, ['SW_DD'], 'refines')) problems.push({ rule: 'WP-3', kind: 'SW_ARCH', item: i.key, why: `${i.key} — SW 상세설계 없음` });
  // WP-4
  for (const k of ['SAFETY_REQ', 'CS_REQ'] as const) for (const i of of(k)) if (!into(i.key, ['SYS_REQ', 'SW_REQ'], 'allocated')) problems.push({ rule: 'WP-4', kind: k, item: i.key, why: `${i.key} — 시스템·SW 요구 할당 없음` });
  // WP-5
  for (const k of ['SYS_REQ', 'SYS_ARCH', 'SW_REQ', 'SW_ARCH', 'SW_DD'] as const) for (const i of of(k)) if (!into(i.key, ['TEST_SPEC'], 'verifies')) problems.push({ rule: 'WP-5', kind: k, item: i.key, why: `${i.key} — 시험 사양 검증 없음` });
  // WP-6 — 승인 항목(아래)이 기대는 위 항목도 승인
  for (const r of rels) {
    const a = byKey.get(r.from)!;
    const b = byKey.get(r.to)!;
    if (a.approved && !b.approved) problems.push({ rule: 'WP-6', kind: a.kind, item: a.key, why: `${a.key}(승인)이 미승인 ${b.key}(${b.status})에 기댑니다` });
  }
  // WP-7
  for (const r of rels.filter((x) => x.suspect)) problems.push({ rule: 'WP-7', kind: byKey.get(r.from)!.kind, item: r.from, why: `${r.from} → ${r.to} 의심(위 항목이 승인 뒤 바뀜)` });
  const kinds: WpKindRow[] = WP_KINDS.map((k) => {
    const mine = problems.filter((p) => p.kind === k);
    const list = of(k);
    return { kind: k, required: need.has(k), items: list.length, approved: list.filter((i) => i.approved).length, passed: mine.length === 0, problems: mine.length };
  });
  const required = kinds.filter((k) => k.required);
  const passedKinds = required.filter((k) => k.passed).length;
  const basis = JSON.stringify({ items: [...items].sort((x, y) => (x.key < y.key ? -1 : 1)).map((i) => [i.key, i.kind, i.version, i.status, i.approved ? 1 : 0]), relations: [...rels].sort((x, y) => (`${x.from}${x.to}${x.kind}` < `${y.from}${y.to}${y.kind}` ? -1 : 1)).map((r) => [r.from, r.to, r.kind, r.suspect ? 1 : 0]) });
  return { featureId: input.featureId, version: input.version, kinds, passedKinds, requiredKinds: required.length, rate: required.length ? Math.round((passedKinds / required.length) * 100) : 100, problems, suspects: rels.filter((r) => r.suspect).length, basis };
}

/** Epic 읽기 전용 칸·화면 한 줄 — '산출물 5/8 완결(62%)' */
export const wpSummaryText = (r: Pick<WpResult, 'passedKinds' | 'requiredKinds' | 'rate'>) => `산출물 ${r.passedKinds}/${r.requiredKinds} 완결(${r.rate}%)`;

/**
 * 게이트·전이에 묶는 필수 산출물(§5.5, D-ALM-13) — 그 단계까지 통과해야 할 종류와 규칙.
 * G2(요구 게이트)는 FR-REG-005-019(연결 요구가 시스템·SW 요구와 추적 연결)에 따라 WP-2도 본다.
 */
export const WP_GATE_STAGES: readonly { gates: GateId[]; to: 'APPROVED' | 'VERIFIED' | 'RELEASED'; judgeGate: GateId; kinds: WpKind[]; rules: WpRule[] }[] = [
  { gates: ['G1', 'G2', 'G3'], to: 'APPROVED', judgeGate: 'G2', kinds: ['SYS_REQ', 'SAFETY_REQ', 'CS_REQ'], rules: ['WP-1', 'WP-2', 'WP-4'] },
  { gates: ['G4', 'G5', 'G6', 'G7'], to: 'VERIFIED', judgeGate: 'G5', kinds: ['SYS_ARCH', 'SW_REQ', 'SW_ARCH', 'SW_DD'], rules: ['WP-1', 'WP-2', 'WP-3', 'WP-6'] },
  { gates: ['G8', 'G9'], to: 'RELEASED', judgeGate: 'G8', kinds: WP_KINDS.slice(), rules: WP_RULES.slice() },
];

/** 이 게이트·전이에 막히는 문제(필요한 종류만) — 비면 통과 */
export function wpStageBlockers(r: WpResult, stage: (typeof WP_GATE_STAGES)[number]): WpProblem[] {
  const need = new Set(r.kinds.filter((k) => k.required).map((k) => k.kind));
  return r.problems.filter((p) => stage.rules.includes(p.rule) && stage.kinds.includes(p.kind) && need.has(p.kind));
}

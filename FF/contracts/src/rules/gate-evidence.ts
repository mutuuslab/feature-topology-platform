// 분석 근거·Gate 조건(담당자 웨이브 P3-1·3·9·10, 2026-11-05) — Feature Version마다 HARA(ISO 26262)·TARA(ISO/SAE 21434)·SOTIF(ISO 21448)·
// 형식승인 영향(UNECE R155·R156·R157…) 판단을 담당 역할이 개인 서명으로 남기고, Gate가 그 기록을 본다. 서버 판정과 화면 미리 막기가 같은 함수를 쓴다.
//   G2 PASS — 이 Version의 HARA(+ 보안 관련이면 TARA), Feature ASIL이 대표 기준 행 대표 ASIL과 다르면 판정자의 'ASIL 사유 검토함' 확인
//   G7 PASS — 기능안전 담당(SM)과 사이버보안 담당(CSM)의 G7 서명(서로 다른 사람, 지금의 HARA·TARA에 묶인 것)
// 절차 Gate(업무 절차 모델 gate_decision)와 플랫폼 Gate(G1~G9)의 대응도 여기 한 곳에 둔다.
import { z } from 'zod';
import { Asil, GATE_META, GATES, type GateId, type GateResult, type Lifecycle, type Role } from '../enums';

export const ANALYSIS_KINDS = ['HARA', 'TARA', 'SOTIF', 'HOMOLOGATION'] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

/** 분석마다 쓰고 서명하는 역할 — HARA: Safety Manager(R-SM), TARA: CSM(R-CSM), SOTIF: 아키텍트(R-ARC), 형식승인 영향: 법규 담당(R-REG) */
export const ANALYSIS_AUTHOR_ROLE: Record<AnalysisKind, Role> = {
  HARA: 'SAFETY_OFFICER',
  TARA: 'SECURITY_OFFICER',
  SOTIF: 'IMPLEMENTER',
  HOMOLOGATION: 'REGULATORY_OWNER',
};

export const ANALYSIS_LABEL: Record<AnalysisKind, string> = {
  HARA: 'HARA(위험 분석)',
  TARA: 'TARA(위협 분석)',
  SOTIF: 'SOTIF(의도된 기능 안전)',
  HOMOLOGATION: '형식승인 영향 판단',
};

/** TARA 사이버보안 보증 수준(ISO/SAE 21434 CAL) */
export const CALS = ['CAL1', 'CAL2', 'CAL3', 'CAL4'] as const;
export type Cal = (typeof CALS)[number];

/** 형식승인 영향을 볼 규정 — UNECE R155(CSMS)·R156(SUMS)·R157(ALKS)·R79(조향)·R13-H(제동)·R152(AEBS)·GSR(EU 2019/2144) */
export const HOMOLOGATION_REGULATIONS = ['R155', 'R156', 'R157', 'R79', 'R13H', 'R152', 'GSR'] as const;
export type HomologationRegulation = (typeof HOMOLOGATION_REGULATIONS)[number];

/** 형식승인 영향 판단 — 영향 없음 · 기술 기관 통보 · 승인 확장 · 새 형식승인 */
export const HOMOLOGATION_DECISIONS = ['NO_IMPACT', 'NOTIFY', 'EXTENSION', 'NEW_APPROVAL'] as const;
export type HomologationDecision = (typeof HOMOLOGATION_DECISIONS)[number];
export const HOMOLOGATION_DECISION_LABEL: Record<HomologationDecision, string> = {
  NO_IMPACT: '형식승인 영향 없음',
  NOTIFY: '기술 기관 통보',
  EXTENSION: '형식승인 확장',
  NEW_APPROVAL: '새 형식승인',
};

const docId = z.string().trim().min(2).max(64);
const text = z.string().trim().min(2).max(300);
const reason = z.string().trim().min(2).max(500);

export const HaraBody = z
  .object({
    docId,
    /** HARA가 평가한 ASIL — 대표 ASIL 변경 사유와 대조한다 */
    asil: Asil,
    safetyGoals: z.array(z.object({ id: z.string().trim().min(2).max(32), text, asil: Asil }).strict()).min(1).max(20),
    reason,
  })
  .strict();
export type HaraBody = z.infer<typeof HaraBody>;

export const TaraBody = z
  .object({
    docId,
    threats: z.array(z.object({ id: z.string().trim().min(2).max(32), text, cal: z.enum(CALS) }).strict()).min(1).max(20),
    reason,
  })
  .strict();
export type TaraBody = z.infer<typeof TaraBody>;

export const SotifBody = z
  .object({
    docId,
    triggeringConditions: z.array(text).min(1).max(20),
    reason,
  })
  .strict();
export type SotifBody = z.infer<typeof SotifBody>;

export const HomologationBody = z
  .object({
    regulations: z.array(z.enum(HOMOLOGATION_REGULATIONS)).max(HOMOLOGATION_REGULATIONS.length),
    decision: z.enum(HOMOLOGATION_DECISIONS),
    rxswin: z.array(z.string().trim().min(2).max(64)).max(10).default([]),
    reason,
  })
  .strict()
  .refine((b) => b.decision === 'NO_IMPACT' || b.regulations.length > 0, { message: '영향이 있으면 영향받는 규정을 하나 이상 고릅니다.', path: ['regulations'] });
export type HomologationBody = z.infer<typeof HomologationBody>;

export const G7SignoffBody = z.object({ reason }).strict();
export type G7SignoffBody = z.infer<typeof G7SignoffBody>;

/** 분석 기록 — 추가만(같은 종류를 다시 쓰면 새 기록이 지금 근거가 된다). 서명은 기록 본문(kid=''·sig=null)의 JCS 바이트에 */
export interface AnalysisRecord {
  recordId: string;
  kind: AnalysisKind;
  featureId: string;
  version: string;
  /** 분석 문서 번호(사내 ALM·문서 관리) — 형식승인 판단은 없음 */
  docId: string | null;
  content: Record<string, unknown>;
  reason: string;
  signedBy: string;
  signedRole: Role;
  signedAt: string;
  /** PERSONAL: 담당자 개인 서명 · IMPORT: 데모 이관 기록(플랫폼 봉인) */
  provenance: 'PERSONAL' | 'IMPORT';
  supersedes: string | null;
  kid: string;
  sig: string | null;
}

export const G7_SIGNOFF_ROLES = ['SAFETY_OFFICER', 'SECURITY_OFFICER'] as const;
export type G7SignoffRole = (typeof G7_SIGNOFF_ROLES)[number];

/** G7 서명 — 서명할 때의 HARA·TARA 기록에 묶인다. 분석을 다시 쓰면 이전 서명은 효력이 없다(stale) */
export interface G7Signoff {
  signoffId: string;
  featureId: string;
  version: string;
  role: G7SignoffRole;
  signedBy: string;
  signedAt: string;
  reason: string;
  bound: { HARA: string | null; TARA: string | null };
  kid: string;
  sig: string | null;
}

/** 대표 ASIL 변경 — 등록 때 남긴 사유(Feature Version asilDeviation)와 대표 기준 행 */
export interface AsilDeviationView {
  from: string;
  to: string;
  reason: string;
  refId: string | null;
}

/**
 * 보안 관련 Feature — TARA가 G2의 근거로 필요하다. 형식승인 영향 등급(R1·R2, UNECE R155 CSMS 범위)이거나 ADS 기능이면 보안 관련으로 본다.
 * 보고서 FFG-SEC-001(공동 HARA·TARA, SM·CSM 몫)의 근거를 플랫폼이 받아 두는 조건 — ISO/SAE 21434 cl.15
 */
export function securityRelevance(p: { regClass: string; adsFeature: boolean }): { relevant: boolean; why: string } {
  if (p.adsFeature) return { relevant: true, why: 'ADS 기능' };
  if (p.regClass !== 'R0') return { relevant: true, why: `형식승인 영향 등급 ${p.regClass}(UNECE R155 범위)` };
  return { relevant: false, why: '형식승인 무관(R0)·ADS 아님' };
}

// ── 판정 단계 가드 ─────────────────────────────────────────────
const STAGES: GateId[][] = [
  ['G1', 'G2', 'G3'],
  ['G4', 'G5', 'G6', 'G7'],
  ['G8', 'G9'],
];
const ORDER: Lifecycle[] = ['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'];
const rank = (l: Lifecycle) => ORDER.indexOf(l);
const STAGE_NEED: Lifecycle[] = ['PROPOSED', 'DEVELOPING', 'VERIFIED'];
export const gateStageOf = (g: GateId) => STAGES.findIndex((s) => s.includes(g));

/**
 * 이 Gate를 지금 판정할 수 있는가 — 막히면 사람이 읽는 사유(코드 없음). 서버(GateService)와 화면(판정 폼 미리 막기)이 같은 함수를 쓴다.
 * readOnly: RELEASED 이후 버전(새 Version으로)
 */
export function gateStageBlocker(input: { lifecycle: Lifecycle; gate: GateId; role: string; latest: Partial<Record<GateId, string | null | undefined>> }): { reason: string; readOnly: boolean } | null {
  const { lifecycle, gate, role, latest } = input;
  if (rank(lifecycle) >= rank('RELEASED')) return { reason: `${lifecycle} 버전은 읽기 전용입니다. 새 Version을 만들어 판정하세요.`, readOnly: true };
  if (role === 'SAFETY_OFFICER' && gate !== 'G7') return { reason: '기능안전·보안 담당자는 G7만 판정할 수 있습니다.', readOnly: false };
  const stage = gateStageOf(gate);
  if (rank(lifecycle) < rank(STAGE_NEED[stage])) return { reason: `${gate}은(는) ${GATE_META[gate].stage} 단계 Gate입니다 — 지금은 ${lifecycle} 단계라 판정할 수 없습니다.`, readOnly: false };
  for (const prev of STAGES.slice(0, stage).flat())
    if (latest[prev] !== 'PASS') return { reason: `앞 단계 ${prev}이(가) PASS가 아닙니다 (${latest[prev] ?? '미판정'}) — ${prev}부터 판정합니다.`, readOnly: false };
  return null;
}

// ── 분석 근거 조건 ─────────────────────────────────────────────
export interface GateEvidenceInput {
  gate: GateId;
  inputResult: GateResult;
  /** 이 Version의 지금 분석 기록(종류별 최신) */
  current: Partial<Record<AnalysisKind, Pick<AnalysisRecord, 'recordId'>>>;
  securityRelevant: boolean;
  asilDeviation: AsilDeviationView | null;
  asilReasonReviewed: boolean;
  /** 지금 유효한 G7 서명(분석 기록이 바뀌지 않은 것) */
  g7: Pick<G7Signoff, 'role' | 'signedBy'>[];
}

/**
 * Gate PASS의 분석 근거 조건 — 빠진 것마다 사람이 읽는 사유. PASS가 아니면(CONDITIONAL·FAIL) 막지 않는다.
 * @rule FFG-LCY-001 — G2는 현재 Version의 HARA(+TARA), 대표 ASIL 변경 사유 검토, G7은 SM·CSM 두 사람의 서명
 */
export function gateEvidenceBlockers(i: GateEvidenceInput): string[] {
  if (i.inputResult !== 'PASS') return [];
  const out: string[] = [];
  if (i.gate === 'G2') {
    if (!i.current.HARA) out.push('이 Version의 HARA(위험 분석) 기록이 없습니다 — 기능안전 담당자가 분석 근거에 HARA를 서명해 남긴 뒤 G2를 PASS로 판정합니다.');
    if (i.securityRelevant && !i.current.TARA) out.push('보안 관련 Feature인데 이 Version의 TARA(위협 분석) 기록이 없습니다 — 사이버보안 담당자가 TARA를 서명해 남깁니다.');
    if (i.asilDeviation && !i.asilReasonReviewed)
      out.push(`대표 ASIL ${i.asilDeviation.from} → ${i.asilDeviation.to} 변경 사유를 검토했다는 확인이 없습니다 — 사유를 읽고 'ASIL 사유 검토함'을 고릅니다.`);
  }
  if (i.gate === 'G7') {
    const sm = i.g7.find((s) => s.role === 'SAFETY_OFFICER');
    const csm = i.g7.find((s) => s.role === 'SECURITY_OFFICER');
    if (!sm) out.push('G7에는 기능안전 담당자(Safety Manager)의 서명이 필요합니다 — 분석 근거에서 G7 서명을 남깁니다.');
    if (!csm) out.push('G7에는 사이버보안 담당자(CSM)의 서명이 필요합니다 — 분석 근거에서 G7 서명을 남깁니다.');
    if (sm && csm && sm.signedBy === csm.signedBy) out.push('기능안전 서명과 사이버보안 서명을 같은 사람이 했습니다 — 서로 다른 두 사람이 서명해야 합니다.');
  }
  return out;
}

/** 분석 근거 조회 응답 */
export interface AnalysisView {
  featureId: string;
  version: string;
  lifecycle: Lifecycle;
  asil: string;
  security: { relevant: boolean; why: string };
  asilDeviation: AsilDeviationView | null;
  current: Partial<Record<AnalysisKind, AnalysisRecord & { valid: boolean }>>;
  history: AnalysisRecord[];
  g7: (G7Signoff & { valid: boolean; stale: boolean })[];
}

/** 조회 응답 → 판정 조건 입력 */
export const gateEvidenceInputOf = (v: AnalysisView, gate: GateId, inputResult: GateResult, asilReasonReviewed: boolean): GateEvidenceInput => ({
  gate,
  inputResult,
  current: Object.fromEntries(Object.entries(v.current).filter(([, record]) => record?.valid)),
  securityRelevant: v.security.relevant,
  asilDeviation: v.asilDeviation,
  asilReasonReviewed,
  g7: v.g7.filter((s) => s.valid),
});

// ── 절차 Gate ↔ 플랫폼 Gate ─────────────────────────────────────
/**
 * 절차 Gate(업무 절차 모델 gate_decision, 보고서 6.1 G1~G8)마다 플랫폼에서 판정·확인하는 Gate(G1~G9, 상세설계서). 한 곳의 대응표 —
 * 절차 화면과 Feature 상세 Gate 탭이 이것을 보인다. 플랫폼 Gate가 없는 절차 Gate는 전이·운영 기록으로 확인한다(note).
 */
export const PROCEDURE_GATE_MAP: { procedureGate: string; name: string; platformGates: GateId[]; note: string }[] = [
  { procedureGate: 'G1', name: '등록·분류', platformGates: ['G1', 'G3'], note: 'Feature Gate·Variant Gate' },
  { procedureGate: 'G2', name: 'HARA 영향', platformGates: ['G2', 'G7'], note: 'Requirement Gate(HARA·TARA 근거) + Safety/Security Gate(SM·CSM 서명)' },
  { procedureGate: 'G3', name: '안전요구·정의 승인', platformGates: ['G1', 'G2', 'G3'], note: 'G1~G3 PASS 뒤 정의 승인(APPROVED) 전이' },
  { procedureGate: 'G4', name: '설계 독립 검토', platformGates: ['G4', 'G7'], note: 'Control Gate + Safety/Security Gate' },
  { procedureGate: 'G5', name: 'V&V', platformGates: ['G5', 'G6'], note: 'Verification Gate·Supplier Gate' },
  { procedureGate: 'G6', name: '서명 배포', platformGates: ['G8'], note: 'OTA Gate — 서명 게시·배포' },
  { procedureGate: 'G7', name: '출시·활성화', platformGates: ['G9'], note: 'Operations Gate + Release Sign-off' },
  { procedureGate: 'G8', name: '운영 판정', platformGates: [], note: '플랫폼 Gate 없음 — 분기 드릴·긴급 차단·감사 기록으로 확인' },
];

export const procedureGateOf = (procedureGate: string) => PROCEDURE_GATE_MAP.find((m) => m.procedureGate === procedureGate) ?? null;

/** 플랫폼 Gate가 대응하는 절차 Gate들 — Gate 탭의 '절차 Gate' 표시 */
export const procedureGatesFor = (platformGate: GateId) => PROCEDURE_GATE_MAP.filter((m) => m.platformGates.includes(platformGate));

/** "절차 G2 = 플랫폼 G2 + G7" — 두 곳이 같은 문장을 쓴다 */
export function procedureGateText(procedureGate: string): string {
  const m = procedureGateOf(procedureGate);
  if (!m) return `절차 ${procedureGate}`;
  return m.platformGates.length ? `절차 ${m.procedureGate} ${m.name} = 플랫폼 ${m.platformGates.map((g) => `${g} ${GATE_META[g].name}`).join(' + ')}` : `절차 ${m.procedureGate} ${m.name} — ${m.note}`;
}

/** 대응표가 쓰는 플랫폼 Gate가 모두 실재하는가(계약 시험) */
export const procedureGateMapValid = () => PROCEDURE_GATE_MAP.every((m) => m.platformGates.every((g) => (GATES as readonly string[]).includes(g)));

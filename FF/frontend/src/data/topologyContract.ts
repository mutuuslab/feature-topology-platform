/**
 * Topology 관계 레코드 계약 · 검증 4단계 · 도구 의존성 경계 (정본 데이터 계층).
 *
 * 기준 정본
 *  · Feature_Topology_Definition v0.8 §4.4 관계의 공통 속성 / §4.5 원문 관계명 ↔ 통합 사전 /
 *    §4.6 검증 처리 순서 / §4.7 변경 영향 탐색 / §4.8 도구 의존성과 실행 조건
 *  · FP_SW_Detailed_Design v4.6 — DD-03-4(FlagBinding) · DD-03-5(Capability·RuntimeBinding)
 *  · FP_Architecture_Design v4.5 — C03 BOM·구성·의존관계 관리 · C14 Topology·Capability 평가
 *  · UL-OSS-R1 — Unleash OSS 무료 에디션 통합 검토(계약 UL-OSS-01~14 · IF-FF-01~07)
 *
 * 이 모듈이 소유하는 것은 **관계의 계약**이다. 관계의 그래프 적재·탐색은 `pages/topologyArch.tsx`
 * 가, Feature BOM 기준선은 `data/featureBom.ts` 가 소유한다. 여기서는
 *  ① 15종 관계 유형마다 대칭성·제약 수준·요구 상태·실행 지원 경계를 못박고,
 *  ② 그래프의 각 관계에 붙는 **관계 레코드**(정확 참조·조건·범위·근거)를 선언하고,
 *  ③ 그 레코드가 §4.6 의 4단계(구조·구성·의미·실행 계약) 중 어디에서 걸리는지를 계산한다.
 *
 * 판정 원칙 — 화면은 판정하지 않는다. 여기의 순수 함수가 계산한 값만 화면이 그린다.
 *  · 무조건 관계도 "항상 참"임을 명시한다(`conditionRef = ALWAYS`). 미선언은 미선언이다.
 *  · `excludes` 의 동시 활성 배타를 대안 Feature 의 BOM 공존 금지로 확대하지 않는다.
 *    제약 수준(constraintScope)을 선언하지 않으면 배타 범위를 알 수 없으므로 차단하지 않고 보류한다.
 *  · 저장은 허용하되 승인·발행은 보류하는 위반은 `blocksApproval` 로 구분한다.
 *  · Unleash 의 `parent` 는 한 도구 안의 단일 관계다. Topology 관계로 승격하지 않는다.
 */
import {
  ARTIFACT_RECORDS,
  FLAG_BINDINGS,
} from './implementation';
import { BOM_BASELINES, BOM_CONDITION_PROFILES, type BomBaseline } from './featureBom';
import * as M from './model';
import { sha256Hex } from './sha256';

// ════════════════════════════════════════════════════════════════════════════
// 1. 제약 수준 · 요구 상태 · 실행 지원 경계 (§4.4)
// ════════════════════════════════════════════════════════════════════════════

/** 배타·요구가 어느 수준에서 성립하는가. 같은 대상이라도 수준이 다르면 다른 제약이다. */
export type ConstraintScope =
  | 'BOM_COEXISTENCE'
  | 'CATALOG_SELECTION'
  | 'INSTALLATION_COMBINATION'
  | 'CONCURRENT_ACTIVATION';

export const CONSTRAINT_SCOPES: ConstraintScope[] = [
  'BOM_COEXISTENCE', 'CATALOG_SELECTION', 'INSTALLATION_COMBINATION', 'CONCURRENT_ACTIVATION',
];

export const CONSTRAINT_SCOPE_KO: Record<ConstraintScope, { ko: string; means: string }> = {
  BOM_COEXISTENCE: { ko: 'BOM 공존', means: '같은 승인 기준선에 함께 담을 수 없다' },
  CATALOG_SELECTION: { ko: '상품 선택', means: '고객에게 함께 선택될 수 없다' },
  INSTALLATION_COMBINATION: { ko: '설치 조합', means: '차량에 함께 설치할 수 없다' },
  CONCURRENT_ACTIVATION: { ko: '동시 활성', means: '동시에 켜 둘 수 없다 — BOM 공존은 허용' },
};

/**
 * `requires` 의 요구 상태 — **판정 시점**을 함께 고정한다(§12 UI02-S03).
 * 정본 §12 가 화면 계약이므로 INCLUDED · INSTALLED · EFFECTIVE 세 값을 쓴다.
 */
export type RequiredState = 'INCLUDED' | 'INSTALLED' | 'EFFECTIVE';

export const REQUIRED_STATES: RequiredState[] = ['INCLUDED', 'INSTALLED', 'EFFECTIVE'];

export const REQUIRED_STATE_JUDGE: Record<RequiredState, {
  ko: string; when: string; owner: string; evidence: string;
}> = {
  INCLUDED: {
    ko: '구성 포함', when: 'BOM 기준선 승인 시', owner: 'C03 BOM·구성·의존관계 관리',
    evidence: '같은 승인 기준선의 멤버 목록 (구성 대조)',
  },
  INSTALLED: {
    ko: '차량 탑재', when: '차량 적용·탑재 확인 시', owner: 'C17 로컬 정책 캐시',
    evidence: '차량 로컬 캐시의 탑재 스냅샷',
  },
  EFFECTIVE: {
    ko: '기능 유효', when: '실행 판정 시', owner: 'C14 Topology·Capability 평가',
    evidence: 'C16 평가 결과 · 관측 이력',
  },
};

/** 관계를 평가기·차량 실행 계층이 어디까지 집행할 수 있는가. */
export type ExecutionSupport =
  | 'STORAGE_ONLY'
  | 'STRUCTURE_VALIDATION'
  | 'SEMANTIC_EVALUATION'
  | 'VEHICLE_ENFORCEMENT';

export const EXECUTION_SUPPORT_KO: Record<ExecutionSupport, { ko: string; judge: string }> = {
  STORAGE_ONLY: { ko: '저장 전용', judge: '보관만 한다 — 평가기 판정 대상이 아니다' },
  STRUCTURE_VALIDATION: { ko: '구조 검증', judge: '참조·정확 버전·존재 여부만 본다' },
  SEMANTIC_EVALUATION: { ko: '의미 평가', judge: '방향·조건·요구 상태·배타를 조건 위에서 판정한다' },
  VEHICLE_ENFORCEMENT: { ko: '차량 집행', judge: '차량에서 실제로 값을 만들거나 막는다' },
};

/** 필수(REQUIRED) 단계 관계가 이 지원 수준이면 저장은 하되 승인·발행을 보류한다. */
export const APPROVAL_HELD_EXECUTION: ExecutionSupport[] = ['STORAGE_ONLY'];

/** 순환 허용 정책 — 일괄 DAG 금지. 구성·의존은 DAG, 관측·대체는 제한적 허용. */
export type CyclePolicy = 'DAG' | 'RESTRICTED' | 'ALLOWED';

export const CYCLE_POLICY_KO: Record<CyclePolicy, string> = {
  DAG: '순환 금지 — 실행 순서를 정할 수 없다',
  RESTRICTED: '제한 허용 — 자기 참조만 금지하고 상호 참조는 근거를 남긴다',
  ALLOWED: '허용 — 관측·중복 연결은 순환이 성립한다',
};

// ════════════════════════════════════════════════════════════════════════════
// 2. 관계 유형 계약 15종 (§4.4 · §4.5)
// ════════════════════════════════════════════════════════════════════════════

export interface RelationContract {
  type: string;
  ko: string;
  /** 의미 방향. excludes·duplicates 는 대칭이다 — 한 방향 선언이 양 방향으로 성립한다. */
  symmetry: 'DIRECTED' | 'SYMMETRIC';
  /** 제약 수준 선언이 필수인가. 구조 관계(parent_of·composed_of)와 Artifact 결속은 아니다. */
  scopeRequired: boolean;
  scopes: ConstraintScope[];
  /** requires 에서 선언할 수 있는 요구 상태. */
  requiredStates?: RequiredState[];
  cardinality: string;
  execution: ExecutionSupport;
  cycle: CyclePolicy;
  pinRequired: boolean;
  /** 판정 책임 Core. */
  judge: string;
  refs: string;
}

/**
 * 15종 관계 유형 계약. `REL_VOCAB`(화면 사전)의 15종과 같은 집합이며, 화면은 이 계약을
 * 읽어 표를 그린다 — 사전 항목이 계약 없이 늘어나는 것을 막는다.
 */
export const RELATION_CONTRACTS: RelationContract[] = [
  { type: 'parent_of', ko: '상위 구성', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['BOM_COEXISTENCE'], cardinality: '1:N', execution: 'STRUCTURE_VALIDATION', cycle: 'DAG', pinRequired: false, judge: 'C14', refs: 'TD §4.4 · DD-03-4' },
  { type: 'composed_of', ko: '하위 구성', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['BOM_COEXISTENCE'], cardinality: '1:N', execution: 'STRUCTURE_VALIDATION', cycle: 'DAG', pinRequired: false, judge: 'C14', refs: 'TD §4.4 · DD-03-4' },
  { type: 'requires', ko: '요구', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['BOM_COEXISTENCE', 'CATALOG_SELECTION', 'INSTALLATION_COMBINATION', 'CONCURRENT_ACTIVATION'], requiredStates: ['INCLUDED', 'INSTALLED', 'EFFECTIVE'], cardinality: 'N:M', execution: 'SEMANTIC_EVALUATION', cycle: 'DAG', pinRequired: false, judge: 'C03 · C14', refs: 'TD §4.4 · §12 UI02-S03' },
  { type: 'excludes', ko: '배타', symmetry: 'SYMMETRIC', scopeRequired: true, scopes: ['BOM_COEXISTENCE', 'CATALOG_SELECTION', 'INSTALLATION_COMBINATION', 'CONCURRENT_ACTIVATION'], cardinality: 'N:M', execution: 'SEMANTIC_EVALUATION', cycle: 'ALLOWED', pinRequired: false, judge: 'C03 · C14', refs: 'TD §4.4 · §4.8' },
  { type: 'overrides', ko: '대체 실행', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['CONCURRENT_ACTIVATION'], cardinality: '1:1', execution: 'SEMANTIC_EVALUATION', cycle: 'RESTRICTED', pinRequired: false, judge: 'C14', refs: 'TD §4.4' },
  { type: 'fallback_to', ko: '실패 시 대체', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['CONCURRENT_ACTIVATION'], cardinality: '1:1', execution: 'SEMANTIC_EVALUATION', cycle: 'RESTRICTED', pinRequired: false, judge: 'C14', refs: 'TD §4.4' },
  { type: 'degrades_to', ko: '성능 저하 대체', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['CONCURRENT_ACTIVATION'], cardinality: '1:1', execution: 'SEMANTIC_EVALUATION', cycle: 'RESTRICTED', pinRequired: false, judge: 'C14', refs: 'TD §4.4' },
  { type: 'replaces', ko: '교체', symmetry: 'DIRECTED', scopeRequired: true, scopes: ['BOM_COEXISTENCE', 'CATALOG_SELECTION'], cardinality: '1:N', execution: 'SEMANTIC_EVALUATION', cycle: 'RESTRICTED', pinRequired: false, judge: 'C14', refs: 'TD §4.4' },
  { type: 'duplicates', ko: '중복 기능', symmetry: 'SYMMETRIC', scopeRequired: true, scopes: ['BOM_COEXISTENCE', 'CATALOG_SELECTION'], cardinality: 'N:M', execution: 'STORAGE_ONLY', cycle: 'ALLOWED', pinRequired: false, judge: 'C03', refs: 'TD §4.4' },
  { type: 'implemented_by', ko: '구현 결속', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: '1:N', execution: 'STRUCTURE_VALIDATION', cycle: 'ALLOWED', pinRequired: true, judge: 'C03', refs: 'TD §4.3 · DD-03-3' },
  { type: 'verified_by', ko: '검증 결속', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: '1:N', execution: 'STRUCTURE_VALIDATION', cycle: 'ALLOWED', pinRequired: true, judge: 'C44', refs: 'TD §4.3 · DD-09' },
  { type: 'observed_by', ko: '관측 결속', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: '1:N', execution: 'STRUCTURE_VALIDATION', cycle: 'ALLOWED', pinRequired: true, judge: 'C23', refs: 'TD §4.3' },
  { type: 'deployed_on', ko: '배치 대상', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: 'N:M', execution: 'STRUCTURE_VALIDATION', cycle: 'ALLOWED', pinRequired: false, judge: 'C28 · C46', refs: 'TD §4.3 · DD-03-4' },
  { type: 'governed_by', ko: '통제 규칙', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: 'N:M', execution: 'STRUCTURE_VALIDATION', cycle: 'ALLOWED', pinRequired: true, judge: 'C19', refs: 'TD §4.3' },
  { type: 'emits', ko: '신호 발생', symmetry: 'DIRECTED', scopeRequired: false, scopes: [], cardinality: '1:N', execution: 'VEHICLE_ENFORCEMENT', cycle: 'ALLOWED', pinRequired: false, judge: 'C16 · C17', refs: 'TD §4.4 — UIAsset 출발 금지' },
];

export const CONTRACT_BY_TYPE = new Map(RELATION_CONTRACTS.map(c => [c.type, c]));

/**
 * 관계 레코드 계약을 요구하는 범위 — Feature↔Feature 구조·의존 관계 9종.
 * Artifact 결속 6종(implemented_by·verified_by·observed_by·deployed_on·governed_by·emits)의
 * 정확 참조·contentDigest·resolution 은 구현 Artifact 표(UI04)가 소유하므로 여기서 중복 요구하지 않는다.
 */
export const RECORD_SCOPE_TYPES: string[] = RELATION_CONTRACTS
  .filter(c => c.scopeRequired)
  .map(c => c.type);

/**
 * 관계 유형마다 다른 실행 경계를 한 줄로 고정한다 — 필수 단계 관계가 저장 전용이면
 * 저장은 하되 승인·발행은 보류한다(§4.4).
 */
export const executionHoldsApproval = (type: string): boolean => {
  const c = CONTRACT_BY_TYPE.get(type);
  return !!c && APPROVAL_HELD_EXECUTION.includes(c.execution);
};

// ════════════════════════════════════════════════════════════════════════════
// 3. 원문 관계명 ↔ 통합 사전 (§4.5) — 자동 변환 금지
// ════════════════════════════════════════════════════════════════════════════

export type LegacyHandling = 'MAP' | 'KEEP_SEPARATE' | 'SPLIT_BY_CONTEXT' | 'MANUAL_REVIEW';

export interface LegacyRelationRow {
  source: string;
  handling: LegacyHandling;
  target?: string;
  note: string;
}

export const LEGACY_HANDLING_KO: Record<LegacyHandling, string> = {
  MAP: '동일 계약으로 이관',
  KEEP_SEPARATE: '독립 관계로 보존',
  SPLIT_BY_CONTEXT: '문맥에 따라 분리',
  MANUAL_REVIEW: '사람이 의미 확인',
};

export const LEGACY_RELATION_MAP: LegacyRelationRow[] = [
  { source: 'REQUIRES', handling: 'MAP', target: 'requires', note: '대소문자만 다른 표기 — 같은 계약이다' },
  { source: 'PRECEDES', handling: 'KEEP_SEPARATE', target: 'precedes', note: '실행 선후관계를 표현하는 독립 관계 — requires 로 자동 변환하지 않는다(사전 미등록이면 저장 전용)' },
  { source: 'CONFLICTS', handling: 'SPLIT_BY_CONTEXT', target: 'excludes', note: '상품 선택·설치 조합·동시 활성 중 어느 수준인지 확인해 분리한다' },
  { source: 'MUTUALLY EXCLUSIVE', handling: 'MAP', target: 'excludes', note: '제약 수준을 반드시 함께 기록한다' },
  { source: 'COMBI', handling: 'MANUAL_REVIEW', note: '의미 확인 없이 requires 로 바꾸지 않는다 — 사전 항목을 사람이 고른다' },
];

export const LEGACY_BY_SOURCE = new Map(LEGACY_RELATION_MAP.map(r => [r.source.trim().toUpperCase(), r]));

// ════════════════════════════════════════════════════════════════════════════
// 4. 관계 레코드 — 정확 참조 · 조건 · 범위 · 근거 (§4.4)
// ════════════════════════════════════════════════════════════════════════════

export const DICTIONARY_VERSION = 'TD-0.8';

/** 정확 객체 참조 — scope·kind·id·version·contentHash 를 모두 담는다(§12). */
export interface ObjectRef {
  scope: 'platform' | 'vehicle';
  kind: string;
  id: string;
  version: string;
  contentHash: string;
}

export interface RelationRecord {
  edgeId: string;
  sourceRef: ObjectRef;
  targetRef: ObjectRef;
  relationType: string;
  dictionaryVersion: string;
  direction: 'out' | 'symmetric';
  /** 조건 참조. 무조건 관계도 `ALWAYS` 로 항상 참임을 명시한다. */
  conditionRef: string;
  constraintScope?: ConstraintScope;
  requiredState?: RequiredState;
  cardinality: string;
  /** 유효 조건 참조 — `ALL` 또는 조건 Profile `id@version`. */
  validityRef: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  sourceRefs: string[];
  rationale: string;
  assessmentRef?: string;
}

export const ALWAYS_CONDITION = 'ALWAYS';

export interface RecordFieldSpec {
  id: keyof RelationRecord;
  ko: string;
  required: boolean;
  note: string;
}

/** 관계 레코드 필수 속성 카탈로그 — 화면은 이 표를 그대로 열로 쓴다. */
export const RELATION_RECORD_FIELDS: RecordFieldSpec[] = [
  { id: 'edgeId', ko: '관계 ID', required: true, note: '그래프 관계와 1:1' },
  { id: 'sourceRef', ko: '출발 참조', required: true, note: 'scope·kind·id·version·contentHash' },
  { id: 'targetRef', ko: '도착 참조', required: true, note: '정확 버전 — 없는 endpoint 차단' },
  { id: 'relationType', ko: '관계 유형', required: true, note: '정본 15종 중 하나' },
  { id: 'dictionaryVersion', ko: '사전 버전', required: true, note: '판정에 쓴 사전 버전' },
  { id: 'direction', ko: '방향', required: true, note: '대칭 관계는 symmetric' },
  { id: 'conditionRef', ko: '조건 참조', required: true, note: '무조건이면 ALWAYS' },
  { id: 'constraintScope', ko: '제약 수준', required: false, note: '배타·요구 관계는 필수' },
  { id: 'requiredState', ko: '요구 상태', required: false, note: 'requires 는 INCLUDED·INSTALLED·EFFECTIVE 중 하나' },
  { id: 'cardinality', ko: '기수', required: true, note: '1:1 / 1:N / N:M' },
  { id: 'validityRef', ko: '유효성 참조', required: true, note: 'ALL 또는 조건 Profile' },
  { id: 'status', ko: '상태', required: true, note: 'DRAFT·ACTIVE·RETIRED' },
  { id: 'sourceRefs', ko: '근거 참조', required: true, note: '요구·설계 문장 ID' },
  { id: 'rationale', ko: '근거', required: true, note: '왜 이 관계인가' },
  { id: 'assessmentRef', ko: '평가 참조', required: false, note: '평가 결과가 있으면 결속' },
];

const FEATURE_BY_ID = new Map(M.features.map(f => [f.id, f]));
const ARTIFACT_BY_KEY = new Map(ARTIFACT_RECORDS.map(a => [`${a.id}@${a.version}`, a]));
const CONDITION_BY_REF = new Map(BOM_CONDITION_PROFILES.map(r => [`${r.id}@${r.version}`, r]));

/**
 * 참조 객체의 내용 해시 — 실측 Registry 행과 구현 Artifact 의 digest 를 그대로 쓴다.
 * Feature 는 정본 행(이름·단계·lifecycle·안전·보안·배포)과 정확 버전을 함께 해시한다.
 */
export function refContentHash(id: string, version: string): string {
  const f = FEATURE_BY_ID.get(id);
  if (f) {
    return sha256Hex([f.id, f.displayName, f.level, f.lifecycle, f.safety, f.security, f.deployType, version].join('|'));
  }
  const a = ARTIFACT_BY_KEY.get(`${id}@${version}`) || ARTIFACT_BY_KEY.get(`ART-${id}@${version}`);
  if (a) return a.contentDigest;
  return sha256Hex(`${id}|${version}`);
}

/** 정확 참조 생성 — 버전이 없으면 만들지 않는다(정확 버전 계약). */
export function objectRef(kind: string, id: string, version: string, scope: ObjectRef['scope'] = 'platform'): ObjectRef {
  return { scope, kind, id, version, contentHash: refContentHash(id, version) };
}

export const featureRef = (id: string, version: string) => objectRef('Feature', id, version);

/** 화면·로그에 쓰는 정규 표기 — scope:kind:id@version#hash8. */
export const formatRef = (r: ObjectRef): string =>
  `${r.scope === 'vehicle' ? 'v' : 'p'}:${r.kind}:${r.id}@${r.version}#${r.contentHash.slice(0, 8)}`;

/** Registry Feature 의 버전 — BOM 기준선·Topology node 가 쓰는 값과 같다. */
export const FEATURE_VERSION: Record<string, string> = {
  'FEAT-BODY-001': '1.0.0',
  'FEAT-BDC-001': '1.1.0',
  'FEAT-BDC-002': '1.0.0',
  'FEAT-RUNTIME-001': '1.0.0',
  'FEAT-MANUAL-001': '1.0.0',
  'FEAT-ADAS-001': '2.4.0',
  'FEAT-CONN-001': '1.0.0',
  'FEAT-SEAT-001': '1.0.0',
  'FEAT-LIGHT-001': '2.0.0',
  'FEAT-PARK-001': '1.0.0',
};

interface RecordSeed {
  edgeId: string;
  source: string;
  target: string;
  type: string;
  scope?: ConstraintScope;
  requiredState?: RequiredState;
  conditionRef?: string;
  validityRef?: string;
  refs: string[];
  rationale: string;
  assessmentRef?: string;
}

/**
 * 그래프 관계 E1~E15 의 관계 레코드. 값은 Registry·조건 Profile 실측값에서 왔고,
 * 비어 있는 속성은 **선언되지 않은 것**이다 — 기본값을 지어내지 않는다.
 *   E3  : constraintScope 미선언 → 배타 범위를 알 수 없어 승인 보류(SCOPE_UNDECLARED)
 *   E15 : requiredState 미선언 → 판정 시점 미지정(REQUIRED_STATE_MISSING)
 *   E10 : 레코드 자체가 없다 → RECORD_MISSING (작성 중 상태를 그대로 드러낸다)
 */
const RECORD_SEEDS: RecordSeed[] = [
  { edgeId: 'E1', source: 'FEAT-BODY-001', target: 'FEAT-BDC-001', type: 'parent_of', scope: 'BOM_COEXISTENCE', refs: ['FRI-031', 'DD-03-4'], rationale: 'Body Comfort 상위 구성 아래 BDC 정책 제어가 있다' },
  { edgeId: 'E2', source: 'FEAT-BDC-001', target: 'FEAT-RUNTIME-001', type: 'requires', scope: 'BOM_COEXISTENCE', requiredState: 'INSTALLED', refs: ['FRI-051', 'DD-03-5'], rationale: '정책 실행 주체인 Policy Agent 가 차량에 탑재되어야 한다', assessmentRef: 'ASM-BDC-0390' },
  { edgeId: 'E3', source: 'FEAT-BDC-001', target: 'FEAT-MANUAL-001', type: 'excludes', validityRef: 'ALL', refs: ['FRI-052', 'TD §4.8'], rationale: '정책 제어와 수동 개입의 동시 활성 여부를 별도 검토 중 — 제약 수준 미선언' },
  { edgeId: 'E4', source: 'FEAT-BDC-001', target: 'FEAT-BDC-002', type: 'fallback_to', scope: 'CONCURRENT_ACTIVATION', conditionRef: 'AP-KR-A@1', refs: ['DD-04-2'], rationale: 'KR 프리미엄 조건에서 실패 시 레거시 로직으로 내려간다' },
  { edgeId: 'E5', source: 'FEAT-BDC-001', target: 'FEAT-BDC-002', type: 'replaces', scope: 'BOM_COEXISTENCE', refs: ['FRI-030'], rationale: 'BDC Policy Control 이 BDC Legacy Logic 을 교체한다' },
  { edgeId: 'E6', source: 'FEAT-BODY-001', target: 'FEAT-MANUAL-001', type: 'composed_of', scope: 'BOM_COEXISTENCE', refs: ['FRI-031'], rationale: '수동 개입은 Body Comfort 하위 기능이다' },
  { edgeId: 'E7', source: 'FEAT-BODY-001', target: 'FEAT-SEAT-001', type: 'composed_of', scope: 'BOM_COEXISTENCE', refs: ['FRI-031'], rationale: '시트 히팅 인증은 Body Comfort 하위 기능이다' },
  { edgeId: 'E8', source: 'FEAT-BODY-001', target: 'FEAT-LIGHT-001', type: 'composed_of', scope: 'BOM_COEXISTENCE', refs: ['FRI-031'], rationale: '웰컴 라이트는 Body Comfort 하위 기능이다' },
  { edgeId: 'E9', source: 'FEAT-MANUAL-001', target: 'FEAT-BDC-001', type: 'overrides', scope: 'CONCURRENT_ACTIVATION', refs: ['FRI-052'], rationale: '수동 개입이 정책 판정을 덮어쓴다 — 동시 활성 수준 제약' },
  { edgeId: 'E11', source: 'FEAT-CONN-001', target: 'FEAT-BDC-001', type: 'duplicates', scope: 'CATALOG_SELECTION', refs: ['GAP-04'], rationale: 'Remote Door Lock 이 상품 선택 수준에서 중복된다' },
  { edgeId: 'E12', source: 'FEAT-ADAS-001', target: 'FEAT-PARK-001', type: 'composed_of', scope: 'BOM_COEXISTENCE', refs: ['FRI-031'], rationale: '원격 주차는 ADAS 종방향 보조 구성에 포함된다' },
  { edgeId: 'E13', source: 'FEAT-SEAT-001', target: 'FEAT-RUNTIME-001', type: 'requires', scope: 'BOM_COEXISTENCE', requiredState: 'INCLUDED', refs: ['FRI-051'], rationale: '시트 인증도 Policy Agent 구성을 함께 포함해야 한다' },
  { edgeId: 'E14', source: 'FEAT-LIGHT-001', target: 'FEAT-RUNTIME-001', type: 'requires', scope: 'BOM_COEXISTENCE', requiredState: 'INCLUDED', refs: ['FRI-051'], rationale: '라이트 안무 실행도 Policy Agent 구성을 함께 포함해야 한다' },
  { edgeId: 'E15', source: 'FEAT-PARK-001', target: 'FEAT-RUNTIME-001', type: 'requires', scope: 'BOM_COEXISTENCE', refs: ['FRI-051'], rationale: '원격 주차 실행 주체 확인 중 — 요구 상태 어휘 미선언' },
];

/** 레코드를 만들지 않는 관계 — E10(degrades_to)은 승인 근거가 등록되지 않은 실측 결함이다. */
export const UNRECORDED_EDGE_IDS: string[] = ['E10'];

function buildRecord(seed: RecordSeed): RelationRecord {
  const c = CONTRACT_BY_TYPE.get(seed.type);
  return {
    edgeId: seed.edgeId,
    sourceRef: featureRef(seed.source, FEATURE_VERSION[seed.source] ?? '1.0.0'),
    targetRef: featureRef(seed.target, FEATURE_VERSION[seed.target] ?? '1.0.0'),
    relationType: seed.type,
    dictionaryVersion: DICTIONARY_VERSION,
    direction: c?.symmetry === 'SYMMETRIC' ? 'symmetric' : 'out',
    conditionRef: seed.conditionRef ?? ALWAYS_CONDITION,
    constraintScope: seed.scope,
    requiredState: seed.requiredState,
    cardinality: c?.cardinality ?? 'N:M',
    validityRef: seed.validityRef ?? 'ALL',
    status: 'ACTIVE',
    sourceRefs: seed.refs,
    rationale: seed.rationale,
    assessmentRef: seed.assessmentRef,
  };
}

export const RELATION_RECORDS: RelationRecord[] = RECORD_SEEDS
  .filter(s => !UNRECORDED_EDGE_IDS.includes(s.edgeId))
  .map(buildRecord);
export const RECORD_BY_EDGE = new Map(RELATION_RECORDS.map(r => [r.edgeId, r]));

/**
 * 무조건 필수인 속성 중 선언되지 않은 것. 제약 수준·요구 상태처럼 **관계 유형에 따라**
 * 필수가 되는 속성은 `SCOPE_UNDECLARED` · `REQUIRED_STATE_MISSING` 이 따로 잡는다.
 */
export function missingRecordFields(rec: RelationRecord): RecordFieldSpec[] {
  return RELATION_RECORD_FIELDS.filter(f => {
    if (!f.required) return false;
    const v = rec[f.id];
    return v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : v === '');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 검증 처리 순서 4단계 (§4.6)
// ════════════════════════════════════════════════════════════════════════════

export type VerifyPhase = 'STRUCTURE' | 'COMPOSITION' | 'SEMANTIC' | 'RUNTIME_SUPPORT';

export const VERIFY_PHASES: { id: VerifyPhase; no: string; ko: string; what: string; engine: string }[] = [
  { id: 'STRUCTURE', no: '①', ko: '구조', what: 'schema·ID·endpoint·관계 유형·정확 버전', engine: '그래프 적재 + 관계 레코드 대조' },
  { id: 'COMPOSITION', no: '②', ko: '구성', what: 'Feature 노드 집합 ↔ BOM 멤버·Artifact 참조 대조', engine: '기준선 멤버 대조 + 제약 수준 평가' },
  { id: 'SEMANTIC', no: '③', ko: '의미', what: '방향·조건·요구 상태·배타·허용 순환', engine: 'requires 경로 · 배타 대칭 판정' },
  { id: 'RUNTIME_SUPPORT', no: '④', ko: '실행 계약 지원', what: '평가기·차량 실행 계층이 그 관계를 집행할 수 있는가', engine: '실행 지원 경계 + 도구 의존성 경계' },
];

export const PHASE_KO: Record<VerifyPhase, string> = {
  STRUCTURE: '① 구조',
  COMPOSITION: '② 구성',
  SEMANTIC: '③ 의미',
  RUNTIME_SUPPORT: '④ 실행 계약',
};

/**
 * 결함 코드 → 검증 단계. 새 결함 코드를 넣으면 여기에도 단계를 지정해야 한다
 * (테스트가 25종 전부에 단계가 있는지 확인한다).
 */
export const FINDING_PHASE: Record<string, VerifyPhase> = {
  // ① 구조
  DANGLING_REFERENCE: 'STRUCTURE',
  SELF_REFERENCE: 'STRUCTURE',
  DUPLICATE_RELATION: 'STRUCTURE',
  UNMAPPED_RELATION_TYPE: 'STRUCTURE',
  UNPINNED_VERSION: 'STRUCTURE',
  SNAPSHOT_NODE_MISSING: 'STRUCTURE',
  RECORD_MISSING: 'STRUCTURE',
  RECORD_FIELD_MISSING: 'STRUCTURE',
  RECORD_ENDPOINT_MISMATCH: 'STRUCTURE',
  // ② 구성
  ORPHAN_NODE: 'COMPOSITION',
  NODE_SET_SCOPE_DRIFT: 'COMPOSITION',
  MISSING_REQUIRED_RELATION: 'COMPOSITION',
  RETIRED_REFERENCED: 'COMPOSITION',
  CONDITION_UNDECLARED: 'COMPOSITION',
  SCOPE_UNDECLARED: 'COMPOSITION',
  SCOPE_NOT_ALLOWED: 'COMPOSITION',
  REQUIRED_STATE_MISSING: 'COMPOSITION',
  REQUIRED_STATE_UNSATISFIED: 'COMPOSITION',
  COEXISTENCE_CONFLICT: 'COMPOSITION',
  // ③ 의미
  RELATION_CONFLICT: 'SEMANTIC',
  CYCLE: 'SEMANTIC',
  REQUIRES_PATH_INCOMPLETE: 'SEMANTIC',
  // ④ 실행 계약 지원
  EXECUTION_UNSUPPORTED: 'RUNTIME_SUPPORT',
  TOOL_RELATION_NOT_TOPOLOGY: 'RUNTIME_SUPPORT',
  SEGMENT_IMPACT_INCOMPLETE: 'RUNTIME_SUPPORT',
};

export const phaseOf = (code: string): VerifyPhase => FINDING_PHASE[code] ?? 'STRUCTURE';

/** 단계별 결함 수 — 화면 파이프라인 상자가 그대로 쓴다. */
export function phaseCounts(findings: { code: string }[]): Record<VerifyPhase, number> {
  const out = { STRUCTURE: 0, COMPOSITION: 0, SEMANTIC: 0, RUNTIME_SUPPORT: 0 } as Record<VerifyPhase, number>;
  for (const f of findings) out[phaseOf(f.code)] += 1;
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 관계 레코드 감사 — ① 구조 · ② 구성
// ════════════════════════════════════════════════════════════════════════════

export interface ContractEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface ContractInput {
  edges: ContractEdge[];
  relations: ContractEdge[];
}

export interface RecordIssue {
  code: string;
  detail: string;
  /** 승인·발행을 보류시키는 항목인가. */
  blocksApproval: boolean;
}

export interface RecordAuditRow {
  edgeId: string;
  type: string;
  source: string;
  target: string;
  /** 정본 사전 안에 있는 관계 유형인가. 사전 밖은 이관 대상이라 레코드를 요구하지 않는다. */
  inDictionary: boolean;
  record?: RelationRecord;
  contract?: RelationContract;
  missingFields: string[];
  issues: RecordIssue[];
}

const baseIdOf = (ref: string): string => (ref.includes('@') ? ref.slice(0, ref.indexOf('@')) : ref);

/**
 * 그래프의 모든 관계를 관계 레코드와 대조한다.
 * 사전 밖 유형은 `UNMAPPED_RELATION_TYPE` 이 이미 잡으므로 여기서는 다루지 않는다.
 */
export function auditRelationRecords(g: ContractInput): RecordAuditRow[] {
  const rows: RecordAuditRow[] = [];
  for (const e of [...g.edges, ...g.relations]) {
    const contract = CONTRACT_BY_TYPE.get(e.type);
    const record = RECORD_BY_EDGE.get(e.id);
    const issues: RecordIssue[] = [];
    const missing: string[] = [];

    if (!contract) {
      rows.push({ edgeId: e.id, type: e.type, source: e.source, target: e.target, inDictionary: false, record, contract, missingFields: [], issues: [] });
      continue;
    }

    if (!RECORD_SCOPE_TYPES.includes(e.type)) {
      // Artifact 결속 — 구현 Artifact 표가 정확 참조를 소유한다.
      rows.push({ edgeId: e.id, type: e.type, source: e.source, target: e.target, inDictionary: true, record, contract, missingFields: [], issues: [] });
      continue;
    }

    if (!record) {
      issues.push({
        code: 'RECORD_MISSING',
        detail: `\`${e.type}\` 관계 레코드가 없다 — 조건·제약 수준·근거를 선언해야 승인 근거가 남는다`,
        blocksApproval: true,
      });
      rows.push({ edgeId: e.id, type: e.type, source: e.source, target: e.target, inDictionary: true, record, contract, missingFields: [], issues });
      continue;
    }

    for (const f of missingRecordFields(record)) missing.push(`${f.ko}(${String(f.id)})`);

    if (record.sourceRef.id !== e.source || record.targetRef.id !== e.target) {
      issues.push({
        code: 'RECORD_ENDPOINT_MISMATCH',
        detail: `레코드 endpoint \`${record.sourceRef.id} → ${record.targetRef.id}\` 가 그래프 \`${e.source} → ${e.target}\` 와 다르다`,
        blocksApproval: true,
      });
    }
    if (!record.sourceRef.version || !record.targetRef.version || !record.targetRef.contentHash) {
      issues.push({
        code: 'RECORD_FIELD_MISSING',
        detail: '출발·도착 참조에 정확 버전 또는 contentHash 가 없다',
        blocksApproval: true,
      });
    } else if (missing.length > 0) {
      issues.push({
        code: 'RECORD_FIELD_MISSING',
        detail: `필수 속성 미선언 — ${missing.join(', ')}`,
        blocksApproval: true,
      });
    }

    if (record.conditionRef !== ALWAYS_CONDITION && !CONDITION_BY_REF.has(record.conditionRef)) {
      issues.push({
        code: 'CONDITION_UNDECLARED',
        detail: `조건 참조 \`${record.conditionRef}\` 가 조건 Profile 에 없다 — 무조건이면 ALWAYS 로 선언한다`,
        blocksApproval: true,
      });
    }
    if (record.validityRef !== 'ALL' && !CONDITION_BY_REF.has(record.validityRef)) {
      issues.push({
        code: 'CONDITION_UNDECLARED',
        detail: `유효성 참조 \`${record.validityRef}\` 가 조건 Profile 에 없다`,
        blocksApproval: true,
      });
    }

    if (contract.scopeRequired && !record.constraintScope) {
      issues.push({
        code: 'SCOPE_UNDECLARED',
        detail: `제약 수준 미선언 — ${CONSTRAINT_SCOPES.map(s => CONSTRAINT_SCOPE_KO[s].ko).join(' · ')} 중 하나여야 배타 범위를 판정할 수 있다`,
        blocksApproval: true,
      });
    } else if (record.constraintScope && !contract.scopes.includes(record.constraintScope)) {
      issues.push({
        code: 'SCOPE_NOT_ALLOWED',
        detail: `\`${record.constraintScope}\` 는 \`${record.relationType}\` 에 허용되지 않는다 — 허용 ${contract.scopes.join(', ')}`,
        blocksApproval: true,
      });
    }

    if (contract.requiredStates && !record.requiredState) {
      issues.push({
        code: 'REQUIRED_STATE_MISSING',
        detail: `요구 상태 미선언 — 판정 시점을 정할 수 없다 (${REQUIRED_STATES.join(' · ')})`,
        blocksApproval: true,
      });
    }

    if (contract.execution === 'STORAGE_ONLY') {
      issues.push({
        code: 'EXECUTION_UNSUPPORTED',
        detail: `\`${record.relationType}\` 는 ${EXECUTION_SUPPORT_KO[contract.execution].ko} — 저장은 허용하되 승인·발행은 보류한다`,
        blocksApproval: true,
      });
    }

    rows.push({ edgeId: e.id, type: e.type, source: e.source, target: e.target, inDictionary: true, record, contract, missingFields: missing, issues });
  }
  return rows;
}

/** 감사 결과에서 코드별로 갈라낸 결함 — 검증기는 이 목록을 그대로 결함으로 승격한다. */
export function recordFindings(rows: RecordAuditRow[]): { code: string; subject: string; detail: string }[] {
  const out: { code: string; subject: string; detail: string }[] = [];
  for (const r of rows) {
    const where = `${r.source} → ${r.target}`;
    if (!r.inDictionary) continue;
    for (const i of r.issues) out.push({ code: i.code, subject: r.edgeId === where ? where : `${where} (${r.edgeId})`, detail: i.detail });
  }
  return out;
}

/** 승인·발행을 보류시키는 감사 항목 수. */
export const approvalHeldRecords = (rows: RecordAuditRow[]): RecordAuditRow[] =>
  rows.filter(r => r.issues.some(i => i.blocksApproval));

// ════════════════════════════════════════════════════════════════════════════
// 7. requires 전체 경로와 요구 상태 판정 (§4.4 · §4.8)
// ════════════════════════════════════════════════════════════════════════════

export type RequiresOutcome = 'COMPLETE' | 'UNSATISFIED' | 'AWAITING' | 'INCOMPLETE';

export interface RequiresPath {
  edgeId: string;
  source: string;
  target: string;
  requiredState?: RequiredState;
  /** 요구 경로 — A requires B, B requires D 이면 [A, B, D] */
  path: string[];
  hops: number;
  outcome: RequiresOutcome;
  /** 경로 위에서 해석되지 않는 참조. */
  unresolved: string[];
  detail: string;
  /** outcome 이 UNSATISFIED 일 때 어긋난 기준선. */
  baselines: string[];
}

export const REQUIRES_OUTCOME_KO: Record<RequiresOutcome, string> = {
  COMPLETE: '성립',
  UNSATISFIED: '미충족 — 승인 보류',
  AWAITING: '판정 시점 미도달',
  INCOMPLETE: '경로 미완 — 전체 경로 미확보',
};

/**
 * `requires` 의 전체 경로를 검사한다. A requires B, B requires D 이면 B 너머 D 까지 본다.
 * 요구 상태별 판정 시점(REQUIRED_STATE_JUDGE)에서 확보 가능한 증적으로만 판정한다.
 */
export function requiresPaths(
  g: ContractInput & { features?: { id: string; lifecycle: string }[] },
  baselines: BomBaseline[] = BOM_BASELINES,
  knownFeatureIds: Set<string> = new Set(M.features.map(f => f.id)),
): RequiresPath[] {
  const out: RequiresPath[] = [];
  const reqBySource = new Map<string, ContractEdge[]>();
  for (const e of g.edges) {
    if (e.type !== 'requires') continue;
    const list = reqBySource.get(e.source) ?? [];
    list.push(e);
    reqBySource.set(e.source, list);
  }

  for (const e of g.edges) {
    if (e.type !== 'requires') continue;
    const record = RECORD_BY_EDGE.get(e.id);
    const requiredState = record?.requiredState;
    const path = [e.source, e.target];
    const unresolved: string[] = [];
    const seen = new Set<string>([e.source]);
    let cursor = e.target;
    // 전체 경로 — 요구 대상이 다시 요구하는 대상을 끝까지 따라간다.
    while (!seen.has(cursor)) {
      seen.add(cursor);
      if (!knownFeatureIds.has(cursor)) break;   // 미등록 참조는 아래 경로 전체 검사에서 한 번만 보고한다.
      const next = (reqBySource.get(cursor) ?? [])[0];
      if (!next) break;
      path.push(next.target);
      cursor = next.target;
    }
    for (const id of path.slice(1)) if (!knownFeatureIds.has(id)) unresolved.push(id);

    let outcome: RequiresOutcome = unresolved.length > 0 ? 'INCOMPLETE' : 'COMPLETE';
    let detail = unresolved.length > 0
      ? `경로 위 미등록 참조 ${unresolved.join(', ')}`
      : `경로 ${path.join(' → ')} 성립`;
    const hitBaselines: string[] = [];

    if (unresolved.length === 0 && requiredState) {
      const judge = REQUIRED_STATE_JUDGE[requiredState];
      if (requiredState === 'INCLUDED') {
        // 구성 포함 — 같은 승인 기준선의 멤버 목록으로만 판정한다.
        const scoped = baselines.filter(b => b.members.some(m => baseIdOf(m.featureVersionRef) === e.source));
        const broken = scoped.filter(b => !b.members.some(m => baseIdOf(m.featureVersionRef) === e.target));
        if (scoped.length === 0) {
          outcome = 'AWAITING';
          detail = '요구 주체가 어떤 기준선에도 편성되지 않아 구성 포함을 판정할 시점이 아니다';
        } else if (broken.length > 0) {
          outcome = 'UNSATISFIED';
          hitBaselines.push(...broken.map(b => `${b.id}@${b.version}`));
          detail = `기준선 ${hitBaselines.join(', ')} 에 \`${e.target}\` 멤버가 없다 — 구성 포함 요구 미충족`;
        } else {
          detail = `기준선 ${scoped.map(b => `${b.id}@${b.version}`).join(', ')} 에서 구성 포함 성립`;
        }
      } else {
        // 차량 탑재·기능 유효 — 차량 실행 계층 증적이 확보된 뒤 판정한다.
        outcome = 'AWAITING';
        detail = `${judge.ko} 판정 시점(${judge.when}) 미도달 — 증적 원천 ${judge.evidence}`;
      }
    }

    out.push({ edgeId: e.id, source: e.source, target: e.target, requiredState, path, hops: path.length - 1, outcome, unresolved, detail, baselines: hitBaselines });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 제약 수준 평가 — 동시 활성 배타를 BOM 공존 금지로 확대하지 않는다 (§4.8)
// ════════════════════════════════════════════════════════════════════════════

export interface ScopeEvaluation {
  edgeId: string;
  source: string;
  target: string;
  /** 대칭 평가를 위해 정규화한 쌍 — 작은 id 가 앞. */
  pair: string;
  scope?: ConstraintScope;
  /** 같은 승인 기준선에 두 FeatureVersion 이 함께 담겨 있는가. */
  coexisting: string[];
  verdict: 'ALLOWED_ALTERNATIVES' | 'BLOCKING' | 'ONLY_AT_ACTIVATION' | 'SCOPE_UNKNOWN' | 'NOT_COEXISTING';
  detail: string;
}

export const SCOPE_VERDICT_KO: Record<ScopeEvaluation['verdict'], string> = {
  ALLOWED_ALTERNATIVES: 'BOM 공존 허용',
  BLOCKING: '승인 기준선 차단',
  ONLY_AT_ACTIVATION: '동시 활성만 배타',
  SCOPE_UNKNOWN: '제약 수준 미선언',
  NOT_COEXISTING: '공존 없음',
};

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * 배타·중복 관계의 제약 수준을 기준선과 대조한다.
 * 대칭 관계는 한 방향 선언으로 양 방향이 성립하므로 쌍으로 정규화해 중복 계산하지 않는다.
 */
export function evaluateScopeConflicts(
  g: ContractInput,
  baselines: BomBaseline[] = BOM_BASELINES,
): ScopeEvaluation[] {
  const out: ScopeEvaluation[] = [];
  const done = new Set<string>();
  for (const e of [...g.edges, ...g.relations]) {
    const contract = CONTRACT_BY_TYPE.get(e.type);
    if (!contract || contract.symmetry !== 'SYMMETRIC') continue;
    const key = `${pairKey(e.source, e.target)}|${e.type}`;
    if (done.has(key)) continue;
    done.add(key);

    const record = RECORD_BY_EDGE.get(e.id);
    const scope = record?.constraintScope;
    const coexisting = baselines
      .filter(b => b.members.some(m => baseIdOf(m.featureVersionRef) === e.source)
        && b.members.some(m => baseIdOf(m.featureVersionRef) === e.target))
      .map(b => `${b.id}@${b.version}`);

    let verdict: ScopeEvaluation['verdict'];
    let detail: string;
    if (!scope) {
      verdict = 'SCOPE_UNKNOWN';
      detail = '제약 수준 미선언 — 배타 범위를 알 수 없어 승인 기준선 판정을 보류한다';
    } else if (coexisting.length === 0) {
      verdict = 'NOT_COEXISTING';
      detail = `같은 기준선에 함께 담긴 적이 없다 — ${CONSTRAINT_SCOPE_KO[scope].ko} 제약만 기록`;
    } else if (scope === 'BOM_COEXISTENCE') {
      verdict = 'BLOCKING';
      detail = `기준선 ${coexisting.join(', ')} 에 두 FeatureVersion 이 함께 담겨 있다 — BOM 공존 금지 위반`;
    } else if (scope === 'CONCURRENT_ACTIVATION') {
      verdict = 'ALLOWED_ALTERNATIVES';
      detail = `기준선 ${coexisting.join(', ')} 의 대안 구성으로 함께 담는 것은 허용한다 — 동시 활성만 막는다`;
    } else {
      verdict = 'ONLY_AT_ACTIVATION';
      detail = `${CONSTRAINT_SCOPE_KO[scope].ko} 수준 제약 — BOM 공존 금지로 확대하지 않는다`;
    }
    out.push({ edgeId: e.id, source: e.source, target: e.target, pair: pairKey(e.source, e.target), scope, coexisting, verdict, detail });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 도구 의존성 경계 — Unleash `parent` 는 Topology 가 아니다 (§4.8 · UL-OSS-R1)
// ════════════════════════════════════════════════════════════════════════════

export const UNLEASH_TOOL_RELATION = {
  tool: 'Unleash OSS (자체 호스팅)',
  product: 'Unleash/unleash v8.2.0',
  wireType: 'parent',
  nature: '단일 도구 관계',
  rule: 'Unleash 의 `parent` 는 한 도구 안의 정의 간 표시 관계일 뿐 Feature Topology 의 관계 유형이 아니다. 수집 어댑터(IF-FF-01)가 parent payload 를 받으면 **미지원 후보로 보존하고 거절**한다 — Topology 관계로 승격하지 않는다.',
  owner: 'C03 BOM·구성·의존관계 관리 · C14 Topology·Capability 평가',
  evidence: '무료 에디션에 Flag·Variant 의존성 판정이 없다 — 의존 판정 정본은 FP 이며 검증 증적은 FP 정본 시험이다',
  refs: 'TD §4.8 · UL-OSS-04 · UL-OSS-10 · FR-ULOSS-004',
};

export interface ToolEdgeCandidate {
  id: string;
  flag: string;
  toolBinding: string;
  payload: string;
  verdict: 'REJECT_UNSUPPORTED' | 'KEEP_CANDIDATE';
  reason: string;
  fpAction: string;
}

export const TOOL_EDGE_VERDICT_KO: Record<ToolEdgeCandidate['verdict'], string> = {
  REJECT_UNSUPPORTED: '미지원 후보 — 보존 후 거절',
  KEEP_CANDIDATE: '사람 확인 대기',
};

/**
 * 도구 정의 수집(IF-FF-01)이 넘겨준 parent payload 후보. 실측 FlagBinding 6건에서 만들고,
 * 정본 §4.8 이 지목한 `FP-VEHICLE-BOOL-1` 사례를 함께 둔다.
 */
export function toolEdgeCandidates(): ToolEdgeCandidate[] {
  const fromBindings: ToolEdgeCandidate[] = FLAG_BINDINGS
    .filter((fb, i, all) => all.findIndex(x => x.flagVersionRef === fb.flagVersionRef) === i)
    .map(fb => ({
      id: `UL-PARENT-${baseIdOf(fb.flagVersionRef)}`,
      flag: fb.flagVersionRef,
      toolBinding: fb.toolBindingRef,
      payload: `parent: ${fb.toolBindingRef}`,
      verdict: 'REJECT_UNSUPPORTED' as const,
      reason: 'parent 는 도구 내부 표시 관계 — Topology 관계 유형 15종에 없다',
      fpAction: '정의만 수집하고 관계는 FP C03·C14 에서 다시 선언한다',
    }));
  return [
    ...fromBindings,
    {
      id: 'UL-PARENT-FP-VEHICLE-BOOL-1',
      flag: 'FP-VEHICLE-BOOL-1',
      toolBinding: 'TOOL-RELEASE@2',
      payload: 'parent: FP-VEHICLE-BASE',
      verdict: 'REJECT_UNSUPPORTED',
      reason: '부모가 있어 의존처럼 보이지만 도구 단일 관계다 — requires 로 승격하지 않는다',
      fpAction: 'FP 정본에서 관계 유형·조건·제약 수준을 다시 선언한 뒤 Topology 에 넣는다',
    },
  ];
}

export const TOOL_EDGE_CANDIDATES: ToolEdgeCandidate[] = toolEdgeCandidates();

// ════════════════════════════════════════════════════════════════════════════
// 10. SegmentVersion 역탐색 — FlagBinding → Policy → Offering → Release (§4.8)
// ════════════════════════════════════════════════════════════════════════════

export type SegmentChainStage = 'FLAG_BINDING' | 'POLICY' | 'OFFERING' | 'RELEASE';

export interface SegmentImpactRow {
  stage: SegmentChainStage;
  ko: string;
  owner: string;
  /** 실측으로 찾은 사용처. */
  found: string[];
  /** 원천이 이 저장소에 연결되어 있는가. */
  linked: boolean;
  note: string;
}

export interface SegmentImpactSet {
  segmentRef: string;
  liveRead: false;
  rows: SegmentImpactRow[];
  /** 전체 영향 목록을 확보했는가. 미확보면 새 검토 제출 불가. */
  complete: boolean;
  frontier: SegmentChainStage[];
  notice: string;
}

export const SEGMENT_STAGE_KO: Record<SegmentChainStage, { ko: string; owner: string }> = {
  FLAG_BINDING: { ko: 'FlagBinding', owner: 'C47 인증·키 관리 · DD-03-4' },
  POLICY: { ko: 'Policy (적용 조건)', owner: 'C08 정책 저장·버전 관리' },
  OFFERING: { ko: 'Offering', owner: 'C06 단계적 기능 배포' },
  RELEASE: { ko: 'Release / Wave', owner: 'C29 단계적 배포 자동화 · C46 보안 배포 관리' },
};

/**
 * 승인 Snapshot 은 live Segment 를 읽지 않는다 — 정확 버전이 고정된 승인본만 참조한다.
 * 정확 버전이 없으면 승인용 참조로 쓸 수 없다.
 */
export function assertSnapshotSegment(segmentRef: string): { ok: boolean; reason?: string } {
  if (!/@\d/.test(segmentRef)) {
    return { ok: false, reason: '정확 버전 없는 SegmentVersion 은 승인 Snapshot 에서 읽지 않는다 — live Segment 조회 금지' };
  }
  return { ok: true };
}

/**
 * SegmentVersion 변경의 사용처를 역탐색한다.
 * 실측으로 연결된 단계만 `found` 를 채우고, 원천이 없는 단계는 frontier 로 남긴다 —
 * 확보하지 못한 영향 목록을 0건으로 지어내지 않는다.
 */
export function segmentImpact(
  segmentRef: string,
  opts: { flagBindings?: typeof FLAG_BINDINGS; profiles?: typeof BOM_CONDITION_PROFILES } = {},
): SegmentImpactSet {
  const bindings = opts.flagBindings ?? FLAG_BINDINGS;
  const profiles = opts.profiles ?? BOM_CONDITION_PROFILES;
  const [segId] = segmentRef.split('@');

  // FlagBinding — 적용 조건(applicability)과 Segment 축이 맞는 결속을 찾는다.
  const segTokens = segId.split('-').map(t => t.toUpperCase());
  const flagHits = bindings
    .filter(fb => segTokens.some(t => t.length >= 2 && fb.applicabilityRef.toUpperCase().includes(t)))
    .map(fb => fb.id);

  // Policy — Segment 축과 조건 Profile 의 시장·트림이 맞는 정책 조건.
  const policyHits = profiles
    .filter(p => segTokens.includes(p.market.toUpperCase()) || segTokens.includes(p.trim.toUpperCase()))
    .map(p => `${p.id}@${p.version}`);

  const rows: SegmentImpactRow[] = [
    { stage: 'FLAG_BINDING', ko: SEGMENT_STAGE_KO.FLAG_BINDING.ko, owner: SEGMENT_STAGE_KO.FLAG_BINDING.owner, found: [...new Set(flagHits)], linked: true, note: '정확 적용 조건으로 역탐색' },
    { stage: 'POLICY', ko: SEGMENT_STAGE_KO.POLICY.ko, owner: SEGMENT_STAGE_KO.POLICY.owner, found: [...new Set(policyHits)], linked: true, note: '조건 Profile 축으로 역탐색' },
    { stage: 'OFFERING', ko: SEGMENT_STAGE_KO.OFFERING.ko, owner: SEGMENT_STAGE_KO.OFFERING.owner, found: [], linked: false, note: 'Offering 원천이 이 저장소에 연결되어 있지 않다' },
    { stage: 'RELEASE', ko: SEGMENT_STAGE_KO.RELEASE.ko, owner: SEGMENT_STAGE_KO.RELEASE.owner, found: [], linked: false, note: 'Release·Wave 원천이 이 저장소에 연결되어 있지 않다' },
  ];
  const frontier = rows.filter(r => !r.linked).map(r => r.stage);
  const complete = frontier.length === 0;
  return {
    segmentRef,
    liveRead: false,
    rows,
    complete,
    frontier,
    notice: complete
      ? '전체 영향 목록 확보 — 새 검토 제출 가능'
      : `전체 영향 목록 미확보(${frontier.map(f => SEGMENT_STAGE_KO[f].ko).join(' · ')}) — 새 검토를 제출할 수 없다`,
  };
}

/** 승인 Snapshot 이 live Segment 를 읽지 않는다는 계약 값 — 화면이 그대로 표기한다. */
export const APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT = false as const;

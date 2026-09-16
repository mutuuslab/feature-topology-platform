/**
 * UI05 Topology 와 변경 영향 — **Topology 동작 메커니즘** (구현 결과물).
 *
 * 정본
 *  · Feature_Topology_Definition v0.8 §2(Feature BOM)·§4(관계 사전)
 *  · FP_SW_Detailed_Design v4.6 — DD-03-3(Item 합집합·resolution), DD-03-4(FlagBinding),
 *    DD-03-5(Capability 평가·RuntimeBinding), DD-09(Import)
 *  · FP_Architecture_Design v4.5 — C01 Registry / C03 Feature BOM / C14 Feature Topology·Capability / C43 변경 영향
 *  · FP_Detailed_Screen_and_API_Reference v1.1 — UI05-S01 ~ UI05-S07 (표시 열은 정본 열을 그대로 쓴다)
 *
 * 이 화면은 요구사항을 서술하지 않는다 — **실제로 도는 두 계층을 같은 시뮬레이터 클럭 위에** 그린다.
 *   상단 : Feature Topology 엔진 파이프라인 6단계
 *          Registry SoT → 그래프 적재 → 15종 관계 검증 → TopologySnapshot 동결 → Capability 평가
 *          → ImpactSet · TestSelection
 *          입력은 `state.features / state.edges / state.relations / state.bomBaselines` 실측 데이터이고,
 *          각 단계의 수치·차단 여부는 이 파일 상단의 순수 함수가 계산한 값만 그린다(렌더러는 판정하지 않는다).
 *   하단 : Twin 런타임 토폴로지 (`scene/ArchitectureFlow` 재사용) — 차량·정책·수렴 게이트 실행 계층.
 *   두 계층 모두 `clock.rate === 0` 이면 함께 멈춘다(`data-paused`).
 *
 * 관계 어휘는 정본 15종(`SPEC_TOPOLOGY_RELATIONS`)이 기준이다. 앱 모델의 `EdgeType`/`RelType` 은
 * 이름이 다른 항목이 있으므로 **별칭으로 자동 변환하지 않고** 별칭/미매핑을 그대로 드러낸다
 * (UI05-S07 "의미가 다른 관계의 자동 변환 금지").
 */
import type { JSX } from 'react';
import { Fragment, useMemo, useState } from 'react';
import { Bars, Donut } from '../components/charts';
import { simClockLabel } from '../components/liveMonitor';
import {
  ARTIFACT_RECORDS,
  CONTROL_POINTS,
  FLAG_BINDINGS,
  RUNTIME_BINDINGS,
  kindLabel,
  roleLabel,
  type ControlPointRecord,
} from '../data/implementation';
import {
  BOM_CONDITION_PROFILES,
  PROFILE_OUTCOME_KO,
  evaluateProfiles,
  type BomBaseline,
  type ConditionRow,
  type ProfileOutcome,
} from '../data/featureBom';
import { sha256Hex, shortDigest } from '../data/sha256';
import {
  ALWAYS_CONDITION,
  APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT,
  CONTRACT_BY_TYPE,
  CONSTRAINT_SCOPE_KO,
  CONSTRAINT_SCOPES,
  CYCLE_POLICY_KO,
  DICTIONARY_VERSION,
  EXECUTION_SUPPORT_KO,
  LEGACY_BY_SOURCE,
  LEGACY_HANDLING_KO,
  LEGACY_RELATION_MAP,
  PHASE_KO,
  RECORD_BY_EDGE,
  RECORD_SCOPE_TYPES,
  RELATION_CONTRACTS,
  RELATION_RECORD_FIELDS,
  RELATION_RECORDS,
  REQUIRED_STATES,
  REQUIRED_STATE_JUDGE,
  REQUIRES_OUTCOME_KO,
  SCOPE_VERDICT_KO,
  SEGMENT_STAGE_KO,
  TOOL_EDGE_CANDIDATES,
  TOOL_EDGE_VERDICT_KO,
  UNLEASH_TOOL_RELATION,
  UNRECORDED_EDGE_IDS,
  VERIFY_PHASES,
  approvalHeldRecords,
  auditRelationRecords,
  evaluateScopeConflicts,
  executionHoldsApproval,
  formatRef,
  missingRecordFields,
  phaseCounts,
  phaseOf,
  recordFindings,
  requiresPaths,
  segmentImpact,
  type RecordAuditRow,
  type RequiresPath,
  type ScopeEvaluation,
  type VerifyPhase,
} from '../data/topologyContract';
import {
  DEPENDENCY_SOT_COMPENSATION,
  OSS_COMPARISON_URL,
  SOURCE_PROVENANCE,
  UL_AUDIT_CHECK_COUNT,
  UL_AUDIT_JSON,
  UL_COLLECTION_OWNER,
  UL_CONTRACTS,
  UL_CRITERIA,
  UL_DECISIONS,
  UL_DIAGRAMS,
  UL_FORBIDDEN_IN_UI,
  UL_GAP_REF,
  UL_INTERFACES,
  UL_LIMITS,
  UL_LINKED_DOCS,
  UL_SCREEN_BOUNDARIES,
  UL_SUMMARY,
  UL_UNRUN_NOTICE,
  UL_USAGE,
  UL_VERIFICATION,
  UL_WEBHOOK_USED,
  ULOSS_BASELINE,
  ULOSS_REVISION,
  ULOSS_REVISION_DATE,
  ULOSS_ROLE,
  ulVerificationComplete,
  type UlUsageVerdict,
} from '../data/unleashOss';
import { SPEC_TOPOLOGY_RELATIONS } from '../data/specNav';
import { SPEC_CORE_LABEL } from '../data/specPlanesGen';
import * as M from '../data/model';
import { TOPOLOGY_CONDITIONS, pick, type Lang } from '../data/twin/types';
// 확장자를 명시한다 — Windows/macOS 의 대소문자 비구분 해석에서 `architectureFlow.ts`(순수 모델)로
// 먼저 붙는 것을 막는다(`__tests__/twinArchitecture.test.tsx` 와 같은 관례).
import ArchitectureFlow from '../scene/ArchitectureFlow.tsx';
import { useTwin } from '../state/twinStore';
import { useApp, useAppShell, useToast } from '../store';
import './topologyArch.css';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

// ════════════════════════════════════════════════════════════════════════════
// 1. 관계 사전 — 정본 15종 + 앱 모델 원천 대응
// ════════════════════════════════════════════════════════════════════════════

export type Severity = 'BLOCKING' | 'WARNING' | 'INFO';
export type Tone = 'pass' | 'pending' | 'fail' | 'info' | 'muted';
export type Stage = 'REQUIRED' | 'CONDITIONAL' | 'ADVISORY';

export interface RelationVocab {
  id: string;
  ko: string;
  dir: string;
  stage: Stage;
  /** 이 사전 항목을 채우는 앱 모델 원천 관계 타입 */
  from: string[];
  /** 앱 모델에서 사전 이름과 다르게 부르는 경우의 원천 이름(별칭) — 자동 변환하지 않는다 */
  aliasOf?: string;
  /** 정본 상 필수 판정 단계 */
  gate: string;
}

/** 정본 `SPEC_TOPOLOGY_RELATIONS` 순서 그대로 — 순서가 화면·검증 순서다. */
const VOCAB_SEED: Omit<RelationVocab, 'id'>[] = [
  { ko: '상위 Feature 계층 포함', dir: '상위 → 하위', stage: 'REQUIRED', from: ['parent_of'], gate: 'R01' },
  { ko: '구성 요소 결합', dir: '복합 → 구성', stage: 'REQUIRED', from: ['composed_of'], aliasOf: 'child_of', gate: 'R01' },
  { ko: '동작 필수 선행 조건', dir: '의존 → 선행', stage: 'REQUIRED', from: ['requires'], gate: 'R02' },
  { ko: '동시 활성 금지', dir: '배타 ↔ 배타', stage: 'REQUIRED', from: ['excludes'], gate: 'R02' },
  { ko: '상위 규칙 대체', dir: '대체 → 피대체', stage: 'CONDITIONAL', from: ['overrides'], gate: 'R03' },
  { ko: '실패 시 대체 동작', dir: '대상 → Safe Default', stage: 'REQUIRED', from: ['fallback_to'], gate: 'R04' },
  { ko: '성능 저하 대체 동작', dir: '대상 → 저하 모드', stage: 'CONDITIONAL', from: ['degrades_to'], gate: 'R04' },
  { ko: '버전·모델 대체', dir: '신 → 구', stage: 'REQUIRED', from: ['replaces'], gate: 'R05' },
  { ko: '중복 존재(정리 대상)', dir: '원본 ↔ 중복', stage: 'ADVISORY', from: ['duplicates'], gate: 'R05' },
  { ko: '구현 산출물 결속', dir: 'Feature → 구현 Artifact', stage: 'REQUIRED', from: ['implemented_by'], gate: 'R06' },
  { ko: '시험·증적 결속', dir: 'Feature → 시험 증적', stage: 'REQUIRED', from: ['verified_by'], gate: 'R07' },
  { ko: '운행 관측 결속', dir: 'Feature → 관측 요소', stage: 'ADVISORY', from: ['observed_by'], gate: 'R07' },
  { ko: '배포 위치 결속', dir: 'SW API → DeploymentNode', stage: 'REQUIRED', from: ['deployed_on', 'deployed_as'], aliasOf: 'deployed_as', gate: 'R08' },
  { ko: '규칙 적용 결속', dir: '대상 → Rule', stage: 'REQUIRED', from: ['governed_by', 'controlled_by'], aliasOf: 'controlled_by', gate: 'R09' },
  { ko: '신호·이벤트 방출', dir: 'SW API → Event·Signal', stage: 'CONDITIONAL', from: ['emits', 'emits_event'], aliasOf: 'emits_event', gate: 'R10' },
];

/**
 * 사전 15종의 id 를 정본에서 직접 받아 순서를 고정한다 — 두 목록의 길이·순서가 어긋나면
 * 화면이 아니라 테스트가 먼저 깨지도록 `SPEC_TOPOLOGY_RELATIONS` 를 유일한 출처로 삼는다.
 */
export const REL_VOCAB: RelationVocab[] = SPEC_TOPOLOGY_RELATIONS.map((id, i) => ({
  id,
  ...VOCAB_SEED[i],
}));

export const REL_BY_ID = new Map(REL_VOCAB.map(r => [r.id, r]));

/** 사전 밖 원천 타입 → 의미상 가까운 사전 항목. **자동 변환 금지** — 사람 확인 안내로만 쓴다. */
export const REL_UNMAPPED_HINT: Record<string, string> = {
  child_of: 'composed_of',
  derives: 'parent_of',
  uses_api: 'implemented_by',
  applies_to: 'governed_by',
  controlled_by: 'governed_by',
  deployed_as: 'deployed_on',
  realized_by: 'implemented_by',
  emits_event: 'emits',
};

export const STAGE_KO: Record<Stage, string> = { REQUIRED: '필수', CONDITIONAL: '조건부', ADVISORY: '권고' };

// ════════════════════════════════════════════════════════════════════════════
// 2. 그래프 적재
// ════════════════════════════════════════════════════════════════════════════

export interface TopologyInput {
  features: M.Feature[];
  edges: M.Edge[];
  relations: M.Relation[];
}

export interface TpNode {
  id: string;
  kind: 'Feature' | 'Artifact' | 'External';
  label: string;
  version?: string;
  lifecycle?: string;
  detail?: string;
}

export interface TpLink {
  key: string;
  id: string;
  /** 정규화된 기준 ID (`@version` 제거) */
  source: string;
  target: string;
  /** 원문 참조 — 정확 버전 pin 이 붙어 있으면 그대로 보존한다 */
  sourceRef: string;
  targetRef: string;
  /** 원문 target 에 붙은 정확 버전 */
  pin?: string;
  type: string;
  origin: 'edge' | 'relation';
  criticality?: string;
  safeDefault?: string;
  /** 정본 15종 사전에 있는가 */
  mapped: boolean;
  hint?: string;
}

export interface TopologyGraph {
  nodes: Map<string, TpNode>;
  links: TpLink[];
  out: Map<string, TpLink[]>;
  in: Map<string, TpLink[]>;
}

/** `FEAT-BDC-001@1.1.0` → `FEAT-BDC-001` */
export const baseId = (ref: string): string => (ref.includes('@') ? ref.slice(0, ref.indexOf('@')) : ref);
/** `FEAT-BDC-001@1.1.0` → `1.1.0` */
export const refVersion = (ref: string): string => (ref.includes('@') ? ref.slice(ref.indexOf('@') + 1) : '');

export function buildTopologyGraph(g: TopologyInput, artifacts: M.ArtifactNode[] = M.artifacts): TopologyGraph {
  const nodes = new Map<string, TpNode>();
  for (const f of g.features) {
    nodes.set(f.id, {
      id: f.id, kind: 'Feature', label: f.displayName,
      version: f.baselineVer, lifecycle: f.lifecycle, detail: f.domain,
    });
  }
  for (const a of artifacts) {
    if (!nodes.has(a.id)) nodes.set(a.id, { id: a.id, kind: 'Artifact', label: a.displayName, detail: a.kind });
  }
  const ensure = (id: string): TpNode => {
    let n = nodes.get(id);
    if (!n) { n = { id, kind: 'External', label: id }; nodes.set(id, n) }
    return n;
  };

  const links: TpLink[] = [];
  const add = (p: { id: string; source: string; target: string; type: string; origin: 'edge' | 'relation'; criticality?: string; safeDefault?: string }) => {
    // 끝점은 기준 ID 로 정규화해 노드 집합과 맞춘다. 정확 버전 pin 은 관계에 그대로 보존하므로
    // `TARGET@1.0.0` 참조가 유령 노드를 만들지 않는다.
    const source = baseId(p.source);
    const target = baseId(p.target);
    links.push({
      ...p, source, target,
      sourceRef: p.source, targetRef: p.target, pin: refVersion(p.target) || undefined,
      key: `${source}|${p.type}|${target}`,
      mapped: REL_BY_ID.has(p.type),
      hint: REL_UNMAPPED_HINT[p.type],
    });
  };
  for (const e of g.edges) add({ ...e, origin: 'edge' });
  for (const r of g.relations) add({ ...r, origin: 'relation' });
  for (const l of links) { ensure(l.source); ensure(l.target); }

  const out = new Map<string, TpLink[]>();
  const inc = new Map<string, TpLink[]>();
  const push = (m: Map<string, TpLink[]>, k: string, l: TpLink) => {
    const arr = m.get(k);
    if (arr) arr.push(l); else m.set(k, [l]);
  };
  for (const l of links) { push(out, l.source, l); push(inc, l.target, l); }

  return { nodes, links, out, in: inc };
}

export function relationUsage(graph: TopologyGraph): { counts: Map<string, number>; unmapped: Map<string, number>; total: number } {
  const counts = new Map<string, number>(REL_VOCAB.map(r => [r.id, 0]));
  const unmapped = new Map<string, number>();
  for (const l of graph.links) {
    if (counts.has(l.type)) counts.set(l.type, (counts.get(l.type) ?? 0) + 1);
    else unmapped.set(l.type, (unmapped.get(l.type) ?? 0) + 1);
  }
  return { counts, unmapped, total: graph.links.length };
}

/** Feature 와 그에 `derives` 로 결속된 요구 노드 — Capability 평가의 시작점. */
export function capabilityRoots(graph: TopologyGraph, featureId: string): string[] {
  const roots = [featureId];
  for (const l of graph.in.get(featureId) ?? []) {
    if (l.type === 'derives') roots.push(l.source);
  }
  return [...new Set(roots)];
}

/** 구현·배포·시험·통제·관측 역할 — 값이 아니라 **역할의 존재**를 본다(DD-03-5). */
export const CAPABILITY_ROLES: { id: string; ko: string; types: string[] }[] = [
  { id: 'impl', ko: '구현', types: ['implemented_by', 'realized_by'] },
  { id: 'deploy', ko: '배포', types: ['deployed_as'] },
  { id: 'verify', ko: '시험', types: ['verified_by'] },
  { id: 'control', ko: '통제', types: ['controlled_by', 'governed_by'] },
  { id: 'observe', ko: '관측', types: ['observed_by'] },
];

/** BOM 멤버의 기준선 버전 참조에서 Capability 평가 범위(Feature 기준 ID)를 만든다. */
export function bomScopeFeatureIds(baselines: BomBaseline[]): string[] {
  const ids = new Set<string>();
  for (const b of baselines) {
    if (b.state === 'REVOKED') continue;
    for (const m of b.members) ids.add(baseId(m.featureVersionRef));
  }
  return [...ids].sort();
}

export interface CapabilityRow {
  root: string;
  /** 평가 시작 노드 전체 (선택 Feature + 결속 요구 노드) */
  from: string[];
  targets: string[];
  roles: Record<string, string[]>;
  missing: string[];
  outcome: ProfileOutcome;
  reason: string;
}

/**
 * 범위(scopeIds)는 BOM 멤버 집합이 정한다 — 범위 밖 Feature 를 SELECTED 로 세면
 * Capability 판정이 BOM 과 어긋난다. 범위를 주지 않으면 Registry 전체를 평가한다.
 */
export function evaluateCapability(graph: TopologyGraph, g: TopologyInput, scopeIds?: string[]): CapabilityRow[] {
  const scope = scopeIds ? new Set(scopeIds) : null;
  return g.features.filter(f => !scope || scope.has(f.id)).map(f => {
    const from = capabilityRoots(graph, f.id);
    const byRole: Record<string, string[]> = {};
    for (const name of CAPABILITY_ROLES) byRole[name.id] = [];
    const push = (role: string, id: string) => { if (!byRole[role].includes(id)) byRole[role].push(id) };
    for (const root of from) {
      for (const l of graph.out.get(root) ?? []) {
        for (const name of CAPABILITY_ROLES) if (name.types.includes(l.type)) push(name.id, l.target);
        // 배포 위치는 구현 산출물 한 단계 아래에 있다 — 구현 Artifact → DeploymentNode(deployed_on).
        if (graph.nodes.get(l.target)?.kind === 'Artifact') {
          for (const inner of graph.out.get(l.target) ?? []) if (inner.type === 'deployed_on') push('deploy', inner.target);
        }
      }
    }
    const targets = [...new Set(Object.values(byRole).flat())];
    const missing = CAPABILITY_ROLES.filter(r => byRole[r.id].length === 0).map(r => r.ko);
    // 통제점이 같은 역할에 둘 이상 + 다른 적용 조건이면 조건 충돌로 남긴다(임의 우선순위 금지).
    const conflict = byRole.deploy.length > 1 && byRole.control.length > 1;
    const outcome: ProfileOutcome = targets.length === 0
      ? 'NOT_SUPPORTED'
      : conflict ? 'CONFIG_CONFLICT' : missing.length > 0 ? 'UNVERIFIED' : 'SELECTED';
    const reason = outcome === 'SELECTED'
      ? `역할 ${CAPABILITY_ROLES.length}종 모두 결속 · 참조 ${targets.length}건`
      : outcome === 'NOT_SUPPORTED'
        ? '구현 결속 관계 없음(implemented_by 부재)'
        : outcome === 'CONFIG_CONFLICT'
          ? '배포·통제 역할에 복수 결속 — 적용 조건으로 분리 필요'
          : `역할 누락: ${missing.join(', ')}`;
    return { root: f.id, from, targets, roles: byRole, missing, outcome, reason };
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 검증 — UI05-S04 / UI05-S07
// ════════════════════════════════════════════════════════════════════════════

export interface TpFinding {
  code: string;
  severity: Severity;
  subject: string;
  detail: string;
  remedy: string;
  refs: string;
  stage: 'graph' | 'validate' | 'snapshot' | 'capability' | 'impact';
  /** §4.6 검증 4단계 — ① 구조 ② 구성 ③ 의미 ④ 실행 계약. */
  phase: VerifyPhase;
  /** 승인·발행을 보류시키는 결함인가 (저장은 허용). */
  blocksApproval?: boolean;
}

interface FindingMeta {
  severity: Severity;
  remedy: string;
  refs: string;
  stage: TpFinding['stage'];
  blocksApproval?: boolean;
}

/**
 * 결함 코드 25종의 고정 속성. 새 코드는 §4.6 4단계(FINDING_PHASE)와 여기 양쪽에 있어야 한다.
 * `blocksApproval` 은 승인만 보류하고 저장·검증은 계속하는 결함이다(§4.4 저장 우선).
 */
const FINDING_META: Record<string, FindingMeta> = {
  DANGLING_REFERENCE: { severity: 'BLOCKING', remedy: '원천 객체를 Registry 에 등록하거나 참조를 제거한 뒤 재적재', refs: 'TD 4.2 · IA-R06', stage: 'graph' },
  SELF_REFERENCE: { severity: 'BLOCKING', remedy: '자기 참조 관계 삭제', refs: 'TD 4.4', stage: 'validate' },
  DUPLICATE_RELATION: { severity: 'BLOCKING', remedy: '중복 선언 제거 — 같은 방향·같은 종류는 1건만', refs: 'TD 4.5', stage: 'validate' },
  RELATION_CONFLICT: { severity: 'BLOCKING', remedy: 'requires/excludes 를 조건 Profile 로 분리', refs: 'TD 4.6', stage: 'validate' },
  CYCLE: { severity: 'BLOCKING', remedy: '순환 참조 해소 — 계층 관계는 DAG 여야 함', refs: 'TD 4.6 · SW DD-03-4', stage: 'validate' },
  UNMAPPED_RELATION_TYPE: { severity: 'WARNING', remedy: '사전 항목으로 사람이 확인 후 재입력(자동 변환 금지)', refs: 'TD 4.4 · GAP-03', stage: 'validate' },
  UNPINNED_VERSION: { severity: 'WARNING', remedy: '정확 버전 pin 지정 — latest·범위 표현 금지', refs: 'TD 4.6', stage: 'validate' },
  MISSING_REQUIRED_RELATION: { severity: 'BLOCKING', remedy: '누락 관계 등록 후 단계 전환', refs: 'TD 4.2 · C14', stage: 'capability' },
  ORPHAN_NODE: { severity: 'WARNING', remedy: '관계 미연결 노드 — 등록 취소 또는 결속 추가', refs: 'TD 4.3', stage: 'graph' },
  RETIRED_REFERENCED: { severity: 'WARNING', remedy: 'Retired 노드 참조는 replaces/fallback_to 로만 허용', refs: 'TD 4.2', stage: 'validate' },
  SNAPSHOT_NODE_MISSING: { severity: 'BLOCKING', remedy: '기준선 BOM_Topology_MISMATCH 해소 후 동결', refs: 'TD 4.5 · C03', stage: 'snapshot' },
  NODE_SET_SCOPE_DRIFT: { severity: 'WARNING', remedy: 'BOM 멤버 확정 또는 node 제거 — graph node 집합과 BOM 멤버를 맞춘다', refs: 'DD-03-5', stage: 'graph' },
  // ── §4.4 관계 레코드 — 저장은 허용하되 승인 근거가 없으면 승인만 보류한다 ──────
  RECORD_MISSING: { severity: 'WARNING', blocksApproval: true, remedy: '관계 레코드(조건·제약 수준·근거) 등록 — 저장은 유지된다', refs: 'TD §4.4', stage: 'validate' },
  RECORD_FIELD_MISSING: { severity: 'WARNING', blocksApproval: true, remedy: '필수 속성 채우기 — 관계 ID·정확 참조·사전 버전·조건·기수·유효성·근거', refs: 'TD §4.4', stage: 'validate' },
  RECORD_ENDPOINT_MISMATCH: { severity: 'BLOCKING', remedy: '레코드 endpoint 를 그래프 관계와 일치시키기 — 다른 관계의 근거를 인용할 수 없다', refs: 'TD §4.4', stage: 'validate' },
  CONDITION_UNDECLARED: { severity: 'WARNING', blocksApproval: true, remedy: '조건 Profile 등록 또는 무조건이면 ALWAYS 선언', refs: 'TD §4.4 · UI02-S03', stage: 'validate' },
  SCOPE_UNDECLARED: { severity: 'WARNING', blocksApproval: true, remedy: '제약 수준 선언 — 배타 범위를 알 수 없으면 승인 기준선 판정을 보류한다', refs: 'TD §4.4 · §4.8', stage: 'validate' },
  SCOPE_NOT_ALLOWED: { severity: 'WARNING', blocksApproval: true, remedy: '해당 관계 유형에 허용된 제약 수준으로 다시 선언', refs: 'TD §4.4', stage: 'validate' },
  REQUIRED_STATE_MISSING: { severity: 'WARNING', blocksApproval: true, remedy: '요구 상태(INCLUDED·INSTALLED·EFFECTIVE) 선언 — 판정 시점이 정해져야 한다', refs: 'TD §4.4 · §12 UI02-S03', stage: 'validate' },
  REQUIRED_STATE_UNSATISFIED: { severity: 'WARNING', blocksApproval: true, remedy: '기준선에 요구 대상을 편성하거나 요구 관계를 조건별로 분리', refs: 'TD §4.4', stage: 'validate' },
  REQUIRES_PATH_INCOMPLETE: { severity: 'WARNING', remedy: '경로 위 미등록 참조 해소 — A requires B, B requires D 전체 경로를 본다', refs: 'TD §4.8', stage: 'validate' },
  COEXISTENCE_CONFLICT: { severity: 'BLOCKING', remedy: 'BOM 공존 금지 위반 — 기준선에서 두 FeatureVersion 을 분리', refs: 'TD §4.8', stage: 'validate' },
  EXECUTION_UNSUPPORTED: { severity: 'WARNING', blocksApproval: true, remedy: '저장 전용 관계다 — 차량 집행 계약을 별도로 선언하기 전에는 승인·발행 보류', refs: 'TD §4.4', stage: 'validate' },
  TOOL_RELATION_NOT_TOPOLOGY: { severity: 'INFO', remedy: '도구 parent payload 는 미지원 후보로 보존 — FP 정본에서 관계를 다시 선언', refs: 'TD §4.8 · UL-OSS-04', stage: 'capability' },
  SEGMENT_IMPACT_INCOMPLETE: { severity: 'WARNING', blocksApproval: true, remedy: 'Offering·Release 원천을 연결해 전체 영향 목록 확보 — 0건으로 간주하지 않는다', refs: 'TD §4.8', stage: 'impact' },
};

const mkFinding = (code: string, subject: string, detail: string): TpFinding => {
  const meta = FINDING_META[code];
  return { code, subject, detail, ...meta, phase: phaseOf(code) };
};

/** 사전에 있는 계층 관계 — 순환 판정 대상. */
const LAYER_REL_TYPES = ['parent_of', 'composed_of', 'child_of', 'derives', 'requires'];

/**
 * 정확 버전 pin 이 필수인 결속 관계. 구조 관계(parent_of/composed_of/requires/excludes)는
 * Feature 자체의 개정으로 버전이 결정되므로 여기서 pin 을 요구하지 않는다.
 */
const PIN_REQUIRED = ['implemented_by', 'verified_by', 'observed_by', 'governed_by'];

/** 같은 제어점·같은 적용 조건을 두 Binding 이 점유한 경우 — 정본 판정은 UI03 이 소유한다. */
export function bindingConflicts(): { key: string; first: string; second: string }[] {
  const seen = new Map<string, string>();
  const dup: { key: string; first: string; second: string }[] = [];
  for (const fb of FLAG_BINDINGS) {
    const k = `${fb.controlPointRef}|${fb.applicabilityRef}`;
    const prev = seen.get(k);
    if (prev) dup.push({ key: k, first: prev, second: fb.id }); else seen.set(k, fb.id);
  }
  return dup;
}

export function validateTopology(graph: TopologyGraph, g: TopologyInput, baselines: BomBaseline[], scopeIds?: string[]): TpFinding[] {
  const out: TpFinding[] = [];

  // (1) 그래프 적재 — 해석 불가 참조 / 고아 노드
  const external = [...graph.nodes.values()].filter(n => n.kind === 'External');
  for (const n of external) {
    const from = graph.links.filter(l => l.source === n.id).map(l => `${l.source} ${l.type} → ${l.target}`);
    const to = graph.links.filter(l => l.target === n.id).map(l => `${l.source} ${l.type} → ${l.target}`);
    out.push(mkFinding('DANGLING_REFERENCE', n.id, `Registry·Artifact 어디에도 없는 참조 — ${[...to, ...from].slice(0, 3).join(' / ')}`));
  }
  for (const n of graph.nodes.values()) {
    const deg = (graph.out.get(n.id)?.length ?? 0) + (graph.in.get(n.id)?.length ?? 0);
    if (deg === 0) out.push(mkFinding('ORPHAN_NODE', n.id, `${n.kind} 노드에 연결 관계 0건`));
  }

  // (2) 관계 검증 — 사전 외 타입 / 자기 참조 / 중복
  const seen = new Map<string, TpLink>();
  for (const l of graph.links) {
    if (!l.mapped) {
      const hint = REL_UNMAPPED_HINT[l.type];
      out.push(mkFinding('UNMAPPED_RELATION_TYPE', `${l.source} → ${l.target}`,
        `\`${l.type}\` 는 정본 15종 밖${hint ? ` — 의미상 \`${hint}\` 후보이나 자동 변환하지 않음` : ' — 대응 후보 없음'}`));
    }
    if (l.source === l.target) out.push(mkFinding('SELF_REFERENCE', l.source, `${l.type} 자기 참조`));
    if (seen.has(l.key)) {
      out.push(mkFinding('DUPLICATE_RELATION', `${l.source} → ${l.target}`, `\`${l.type}\` 중복 (${seen.get(l.key)!.id} / ${l.id})`));
    } else seen.set(l.key, l);
  }

  // (3) requires ↔ excludes 충돌
  const reqPairs = new Set(graph.links.filter(l => l.type === 'requires').map(l => `${l.source}|${l.target}`));
  for (const l of graph.links.filter(l => l.type === 'excludes')) {
    if (reqPairs.has(`${l.source}|${l.target}`)) {
      out.push(mkFinding('RELATION_CONFLICT', `${l.source} → ${l.target}`, 'requires 와 excludes 가 동시에 선언됨'));
    }
  }

  // (4) 계층 관계 순환 (DFS 색칠)
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const l of graph.out.get(id) ?? []) {
      if (!LAYER_REL_TYPES.includes(l.type)) continue;
      const c = color.get(l.target) ?? 0;
      if (c === 1) {
        const at = stack.indexOf(l.target);
        out.push(mkFinding('CYCLE', `${l.target} ↻`, `순환 경로 ${[...stack.slice(at), l.target].join(' → ')}`));
      } else if (c === 0) visit(l.target);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const n of graph.nodes.values()) if ((color.get(n.id) ?? 0) === 0) visit(n.id);

  // (5) 정확 버전 pin · Retired 참조
  for (const l of graph.links) {
    if (PIN_REQUIRED.includes(l.type) && !l.pin) {
      out.push(mkFinding('UNPINNED_VERSION', `${l.source} → ${l.target}`, `\`${l.type}\` 대상에 정확 버전 없음`));
    }
    const t = graph.nodes.get(l.target);
    if (t?.lifecycle === 'Retired' && !['replaces', 'fallback_to', 'duplicates'].includes(l.type)) {
      out.push(mkFinding('RETIRED_REFERENCED', `${l.source} → ${l.target}`, `Retired 노드를 \`${l.type}\` 로 참조`));
    }
  }

  // (6) Snapshot 동결 — 기준선이 선언한 Topology node 가 실제 그래프에 있는가
  for (const b of baselines) {
    const missing = (b.topologyNodes ?? []).filter(ref => !graph.nodes.has(baseId(ref)));
    if (missing.length > 0) {
      out.push(mkFinding('SNAPSHOT_NODE_MISSING', `${b.id}@${b.version} · ${b.topologyRef}`,
        `Topology 에 없는 node ${missing.join(', ')}`));
    }
  }

  // (7) node 집합 정합 — graph 의 Feature 는 BOM 멤버와 일치해야 한다(DD-03-5)
  const scope = new Set(scopeIds ?? g.features.map(f => f.id));
  const drift = [...graph.nodes.values()]
    .filter(n => n.kind === 'Feature' && !scope.has(n.id))
    .map(n => n.id)
    .sort();
  if (drift.length > 0) {
    out.push(mkFinding('NODE_SET_SCOPE_DRIFT', `${drift.length} node`,
      `BOM 멤버 밖 Feature node — ${drift.join(', ')}`));
  }

  // (8) Capability 필수 역할 누락 — 평가 범위는 BOM 멤버 집합이 정한다
  for (const row of evaluateCapability(graph, g, scopeIds)) {
    if (row.missing.length > 0) {
      out.push(mkFinding('MISSING_REQUIRED_RELATION', row.root, `역할 누락 ${row.missing.join(', ')} — ${row.outcome}`));
    }
  }

  // ── §4.4–§4.8 계약 검증 — 저장은 막지 않고 승인·발행만 보류시킨다 ─────────────

  const contractInput = { edges: g.edges, relations: g.relations };
  const audit = auditRelationRecords(contractInput);

  // (9) 관계 레코드 감사 — 조건·제약 수준·요구 상태·정확 참조
  for (const f of recordFindings(audit)) out.push(mkFinding(f.code, f.subject, f.detail));

  // (10) requires 전체 경로 — A requires B, B requires D 를 끝까지 본다
  const requiresRows = requiresPaths({ ...contractInput, features: g.features }, baselines);
  for (const p of requiresRows) {
    if (p.outcome === 'INCOMPLETE') {
      out.push(mkFinding('REQUIRES_PATH_INCOMPLETE', `${p.source} → ${p.target}`,
        `경로 ${p.path.join(' → ')} · 미해석 ${p.unresolved.join(', ')}`));
    } else if (p.outcome === 'UNSATISFIED') {
      out.push(mkFinding('REQUIRED_STATE_UNSATISFIED', `${p.source} → ${p.target}`,
        `${p.detail} (요구 상태 ${p.requiredState})`));
    }
  }

  // (11) 제약 수준 대조 — 동시 활성 배타를 BOM 공존 금지로 확대하지 않는다
  const scopeRows = evaluateScopeConflicts(contractInput, baselines);
  for (const s of scopeRows) {
    if (s.verdict === 'BLOCKING') out.push(mkFinding('COEXISTENCE_CONFLICT', `${s.source} ⇄ ${s.target}`, s.detail));
  }

  // (12) 실행 계약 — 관계 유형마다 지원 수준이 다르다. 저장 전용은 승인·발행 보류.
  for (const r of audit) {
    if (!r.contract || r.contract.execution !== 'STORAGE_ONLY') continue;
    if (out.some(f => f.code === 'EXECUTION_UNSUPPORTED' && f.subject.startsWith(`${r.source} → ${r.target}`))) continue;
    out.push(mkFinding('EXECUTION_UNSUPPORTED', `${r.source} → ${r.target}`,
      `${EXECUTION_SUPPORT_KO[r.contract.execution].ko} — 저장은 허용하되 승인·발행은 보류한다`));
  }
  const rejected = TOOL_EDGE_CANDIDATES.filter(c => c.verdict === 'REJECT_UNSUPPORTED');
  if (rejected.length > 0) {
    out.push(mkFinding('TOOL_RELATION_NOT_TOPOLOGY', `Unleash parent ${rejected.length}건`,
      `도구 단일 관계를 미지원 후보로 보존 — ${rejected.slice(0, 4).map(c => c.flag).join(', ')}${rejected.length > 4 ? ' 외' : ''}. Topology 관계로 승격하지 않는다`));
  }

  // (13) SegmentVersion 역탐색 — 전체 영향 목록을 확보하지 못하면 새 검토를 제출할 수 없다
  const impact = segmentImpact(SEGMENT_REF);
  if (!impact.complete) {
    out.push(mkFinding('SEGMENT_IMPACT_INCOMPLETE', impact.segmentRef, impact.notice));
  }
  return out;
}

/** 역탐색 기준 SegmentVersion — 정확 버전이 고정된 승인 후보. */
export const SEGMENT_REF = 'SEG-KR-PREMIUM@2026.4';

export interface TpContractView {
  audit: RecordAuditRow[];
  holdsApproval: RecordAuditRow[];
  requires: RequiresPath[];
  scopes: ScopeEvaluation[];
  impact: ReturnType<typeof segmentImpact>;
}

/** 정본 계약 계층을 화면이 그대로 그릴 수 있게 한 묶음 — 순수 함수다. */
export function buildContractView(g: TopologyInput, baselines: BomBaseline[], segmentRef = SEGMENT_REF): TpContractView {
  const contractInput = { edges: g.edges, relations: g.relations };
  const audit = auditRelationRecords(contractInput);
  return {
    audit,
    holdsApproval: approvalHeldRecords(audit),
    requires: requiresPaths({ ...contractInput, features: g.features }, baselines),
    scopes: evaluateScopeConflicts(contractInput, baselines),
    impact: segmentImpact(segmentRef),
  };
}

export const countSeverity = (findings: TpFinding[], s: Severity) => findings.filter(f => f.severity === s).length;

// ════════════════════════════════════════════════════════════════════════════
// 4. TopologySnapshot — UI05-S01 · UI05-S05
// ════════════════════════════════════════════════════════════════════════════

export interface TpSnapshot {
  id: string;
  ref: string;
  version: string;
  kind: 'LIVE' | 'BASELINE';
  state: string;
  nodes: string[];
  missing: string[];
  linkKeys: string[];
  hash: string;
  at: string;
  ownerRef: string;
  memberRef: string;
}

/** 정규 직렬화 — 행은 정렬하고 키는 고정한다. hash 입력은 이 문자열만 쓴다. */
function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = norm(o[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export const snapshotHash = (s: Omit<TpSnapshot, 'hash'>) =>
  sha256Hex(canonical({ ref: s.ref, version: s.version, nodes: s.nodes, links: s.linkKeys }));

export function buildSnapshots(graph: TopologyGraph, baselines: BomBaseline[], lastAuditTs: string): TpSnapshot[] {
  const liveNodes = [...graph.nodes.keys()].sort();
  const live: Omit<TpSnapshot, 'hash'> = {
    id: 'LIVE', ref: 'TOPO-EV-2027.4', version: 'working', kind: 'LIVE', state: 'WORKING',
    nodes: liveNodes, missing: [], linkKeys: graph.links.map(l => l.key).sort(),
    at: lastAuditTs, ownerRef: 'Feature 설계', memberRef: 'Registry 작업본',
  };
  const list: TpSnapshot[] = [{ ...live, hash: snapshotHash(live) }];

  for (const b of baselines) {
    const pins = b.topologyNodes ?? [];
    const ids = new Set(pins.map(baseId));
    const keys = graph.links.filter(l => ids.has(baseId(l.source)) && ids.has(baseId(l.target))).map(l => l.key).sort();
    const base: Omit<TpSnapshot, 'hash'> = {
      id: b.id,
      ref: b.topologyRef,
      version: b.version,
      kind: 'BASELINE',
      state: b.state,
      nodes: pins,
      missing: pins.filter(ref => !graph.nodes.has(baseId(ref))),
      linkKeys: keys,
      at: b.approval?.at ?? '—',
      ownerRef: b.ownerRef,
      memberRef: b.memberSetRef,
    };
    list.push({ ...base, hash: snapshotHash(base) });
  }
  return list;
}

export interface DiffRow { item: string; before: string; after: string; effect: string; severity: Severity }

export function diffSnapshots(a: TpSnapshot, b: TpSnapshot, graph: TopologyGraph): DiffRow[] {
  const rows: DiffRow[] = [];
  const push = (item: string, before: string | number, after: string | number, effect: string, severity: Severity) => {
    if (String(before) === String(after)) return;
    rows.push({ item, before: String(before), after: String(after), effect, severity });
  };

  push('Snapshot ref', a.ref, b.ref, '기준선이 결속한 Topology 버전 변경', 'WARNING');
  push('Node 수', a.nodes.length, b.nodes.length, '노드 증감 — Capability 재평가 대상', 'INFO');
  push('관계 수', a.linkKeys.length, b.linkKeys.length, '관계 증감 — 영향 경로 재계산', 'INFO');
  push('내용 hash', shortDigest(a.hash, 12), shortDigest(b.hash, 12), 'hash 불일치 → 재검토 필요', 'BLOCKING');
  push('상태', a.state, b.state, '상태 전이 — 승인·평가 결속 확인', 'INFO');
  push('미해석 pin', a.missing.length, b.missing.length, '미해석 node 존재 시 동결 불가', 'BLOCKING');

  const before = new Set(a.linkKeys);
  const after = new Set(b.linkKeys);
  for (const k of [...new Set([...b.linkKeys, ...a.linkKeys])].sort()) {
    if (before.has(k) && after.has(k)) continue;
    const [s, t, ty] = k.split('|');
    const node = graph.nodes.get(t);
    const added = !before.has(k);
    const tests = graph.out.get(t)?.filter(l => l.type === 'verified_by').map(l => l.target) ?? [];
    rows.push({
      item: `${s} ${ty} → ${t}`,
      before: added ? '—' : '존재',
      after: added ? '존재' : '—',
      effect: `${added ? '관계 추가' : '관계 제거'} · 대상 ${node?.kind ?? 'External'}` +
        (tests.length > 0 ? ` · 시험 재선택 ${tests.join(', ')}` : '') +
        ` · 재검토 ${node?.kind === 'Feature' ? 'Feature' : '구현'} 기준선`,
      severity: added ? 'WARNING' : 'BLOCKING',
    });
  }
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 영향 경로 · 시험 선택 — UI05-S02 · UI05-S05
// ════════════════════════════════════════════════════════════════════════════

export interface WalkRow { id: string; depth: number; via: string; type: string; direction: 'out' | 'in'; kind: TpNode['kind'] }

export interface ImpactWalk {
  rows: WalkRow[];
  /** 방문 단위를 모두 소진했으면 true. false 면 중단 한계에 걸린 것 */
  complete: boolean;
  /** 중단 시점의 미확장 노드 — 재개 지점(frontier) */
  frontier: string[];
  maxHops: number;
}

/** 한 번의 탐색이 만들 수 있는 최대 행 수 — 넘으면 complete=false 로 남긴다. */
export const WALK_ROW_LIMIT = 400;

/**
 * 영향 경로 탐색 — 방문 단위는 `(node, direction, relationType)`.
 * `maxHops` 또는 행 한계로 중단하면 지어내지 않고 `complete=false` + `frontier` 를 반환한다(DD-03-5).
 */
export function walkImpact(graph: TopologyGraph, root: string, maxHops = 3): ImpactWalk {
  const seen = new Set<string>([root]);
  const rows: WalkRow[] = [];
  const dedupe = new Set<string>();
  let frontier = [root];
  let depth = 1;
  let capped = false;
  for (; depth <= maxHops; depth++) {
    if (frontier.length === 0) break;
    if (rows.length >= WALK_ROW_LIMIT) { capped = true; break; }
    const next: string[] = [];
    for (const cur of frontier) {
      const step = [
        ...(graph.out.get(cur) ?? []).map(l => ({ id: l.target, type: l.type, direction: 'out' as const })),
        ...(graph.in.get(cur) ?? []).map(l => ({ id: l.source, type: l.type, direction: 'in' as const })),
      ];
      for (const s of step) {
        const k = `${cur}|${s.type}|${s.id}|${s.direction}`;
        if (dedupe.has(k)) continue;
        dedupe.add(k);
        rows.push({ id: s.id, depth, via: cur, type: s.type, direction: s.direction, kind: graph.nodes.get(s.id)?.kind ?? 'External' });
        if (!seen.has(s.id) && (graph.nodes.get(s.id)?.kind === 'Feature' || graph.nodes.get(s.id)?.kind === 'Artifact')) {
          seen.add(s.id);
          next.push(s.id);
        }
      }
    }
    frontier = next;
  }
  const complete = !capped && frontier.length === 0;
  return { rows, complete, frontier: complete ? [] : frontier, maxHops };
}

export function walkGraph(graph: TopologyGraph, root: string, maxDepth = 3): WalkRow[] {
  return walkImpact(graph, root, maxDepth).rows;
}

/**
 * 시험 선택 — 영향 노드에서 `verified_by` 로 도달하는 시험·증적 산출물.
 * `in` 방향 행의 `id` 는 피검증 대상(Feature)이므로 시험으로 세지 않는다.
 */
export function selectTests(graph: TopologyGraph, roots: string[]): string[] {
  const hits = new Set<string>();
  for (const root of roots) {
    for (const l of graph.out.get(root) ?? []) if (l.type === 'verified_by') hits.add(l.target);
    for (const row of walkGraph(graph, root, 3)) {
      if (row.type === 'verified_by' && row.direction === 'out') hits.add(row.id);
    }
  }
  return [...hits].sort();
}

/** 정본 조건 축 — S04 표시에 쓰는 의미 축 이름. */
export const CONDITION_AXIS_KO: { id: keyof ConditionRow; ko: string }[] = [
  { id: 'market', ko: '국가 의미 축' },
  { id: 'model', ko: '차종' },
  { id: 'modelYear', ko: '연식' },
  { id: 'trim', ko: 'Trim 참조' },
  { id: 'option', ko: '옵션' },
  { id: 'hw', ko: 'HW' },
  { id: 'sw', ko: 'SW' },
  { id: 'upgvc', ko: 'UPGVC' },
];

/** 같은 조건을 만족하면서 다른 구현을 선택하는 행 쌍 — 중복 조건 근거. */
export function duplicateConditionPairs(rows: ConditionRow[] = BOM_CONDITION_PROFILES): Map<string, string[]> {
  const axes = CONDITION_AXIS_KO.map(a => a.id).filter(a => a !== 'option' || true);
  const conf = new Map<string, string[]>();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.implementationRef === b.implementationRef) continue;
      const same = axes.every(ax => a[ax] === b[ax]);
      if (!same) continue;
      const key = `${a.id}@${a.version}`;
      conf.set(key, [...(conf.get(key) ?? []), `${b.id}@${b.version}`]);
    }
  }
  return conf;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 엔진 파이프라인 모델 (상단 시각화)
// ════════════════════════════════════════════════════════════════════════════

export type TpStageId = 'registry' | 'graph' | 'validate' | 'snapshot' | 'capability' | 'impact';

export const TP_STAGE_ORDER: TpStageId[] = ['registry', 'graph', 'validate', 'snapshot', 'capability', 'impact'];

export const TP_STAGE_META: Record<TpStageId, { ko: string; core: string; refs: string }> = {
  registry: { ko: 'Registry SoT 조회', core: 'C01', refs: 'DD-01 · C01-R01~R19' },
  graph: { ko: 'Topology 그래프 적재', core: 'C03', refs: 'TD 4.1 · TD 4.3' },
  validate: { ko: '관계 15종 검증', core: 'C14', refs: 'TD 4.4 · TD 4.6' },
  snapshot: { ko: 'TopologySnapshot 동결', core: 'C14', refs: 'TD 4.5' },
  capability: { ko: 'Capability 평가', core: 'C14', refs: 'DD-03-5' },
  impact: { ko: 'ImpactSet · TestSelection', core: 'C43', refs: 'TD 4.7' },
};

export interface TpStageRow { label: string; value: string; tone: Tone }
export interface TpStage {
  id: TpStageId;
  index: number;
  /** 정본 한국어 단계명 (TP_STAGE_META) */
  title: string;
  /** 흐름 상자에 들어가는 축약명 — 6열 파이프라인 폭에서 잘리지 않는 길이 */
  short: string;
  core: string;
  refs: string;
  rows: TpStageRow[];
  tone: Tone;
  /** 개수 chip — `27 노드 · 50 관계` 처럼 무엇을 몇 개 읽었는지 보여준다. */
  summary: string;
  /** 이 단계가 실제로 읽는 앞 단계 산출물 */
  inputs: TpStageId[];
  /** 입력이 실패해 진행 자체가 막힌 경우 */
  blockedBy?: TpStageId;
  blockedReason?: string;
  /** 입력 실패는 아니지만 판정을 보류한 경우 (예: 검증 BLOCKING 잔존 → 동결 보류) */
  heldBy?: TpStageId;
  heldReason?: string;
}
export interface TpModel { stages: TpStage[] }

/** 단계별 입력 — 연속 차단이 아니라 실제 데이터 의존을 따른다. */
export const TP_STAGE_INPUTS: Record<TpStageId, TpStageId[]> = {
  registry: [],
  graph: ['registry'],
  validate: ['graph'],
  snapshot: ['graph'],
  capability: ['graph'],
  impact: ['capability'],
};

/** 단계마다 내는 실측 행 수 — 화면 행 계약. */
export const TP_MAX_ROWS = 5;

/** 흐름 상자용 축약명 — 정본 단계명은 `title` 에 그대로 남는다. */
export const TP_STAGE_SHORT: Record<TpStageId, string> = {
  registry: 'Registry',
  graph: '그래프 적재',
  validate: '관계 검증',
  snapshot: 'Snapshot 동결',
  capability: 'Capability',
  impact: '영향 · 시험',
};

/** 같은 Core(정본 기능)를 공유하는 단계는 한 줄로 묶는다 — 6단계 · 4 Core. */
export const CORE_LEGEND = (() => {
  const m = new Map<string, { core: string; name: string; stages: string[]; refs: string[] }>();
  for (const id of TP_STAGE_ORDER) {
    const meta = TP_STAGE_META[id];
    const label = SPEC_CORE_LABEL[meta.core] ?? meta.core;
    const name = label.startsWith(`${meta.core} `) ? label.slice(meta.core.length + 1) : label;
    const cur = m.get(meta.core) ?? { core: meta.core, name, stages: [], refs: [] };
    cur.stages.push(TP_STAGE_SHORT[id]);
    for (const r of meta.refs.split('·').map(x => x.trim())) {
      if (r && !cur.refs.includes(r)) cur.refs.push(r);
    }
    m.set(meta.core, cur);
  }
  return [...m.values()];
})();

export function buildTopologyModel(args: {
  g: TopologyInput;
  graph: TopologyGraph;
  baselines: BomBaseline[];
  snapshots: TpSnapshot[];
  findings: TpFinding[];
  capability: CapabilityRow[];
  root: string;
  tests: string[];
  scope: string[];
}): TpModel {
  const { graph, g, snapshots, findings, capability, root, tests, scope } = args;

  const blocking = countSeverity(findings, 'BLOCKING');
  const warning = countSeverity(findings, 'WARNING');
  const dangling = findings.filter(f => f.code === 'DANGLING_REFERENCE').length;
  const cycles = findings.filter(f => f.code === 'CYCLE').length;
  const dups = findings.filter(f => f.code === 'DUPLICATE_RELATION').length;
  const unmapped = findings.filter(f => f.code === 'UNMAPPED_RELATION_TYPE').length;
  const orphan = findings.filter(f => f.code === 'ORPHAN_NODE').length;
  const drift = findings.filter(f => f.code === 'NODE_SET_SCOPE_DRIFT').length;
  const missingPins = snapshots.reduce((n, s) => n + s.missing.length, 0);
  const frozen = snapshots.filter(s => s.kind === 'BASELINE' && s.state === 'APPROVED').length;
  const artifacts = [...graph.nodes.values()].filter(n => n.kind === 'Artifact').length;
  const byOutcome = (o: ProfileOutcome) => capability.filter(c => c.outcome === o).length;
  const walk = walkImpact(graph, root, 3);
  const impactRows = walk.rows;
  const impactFeatures = [...new Set(impactRows.filter(r => r.kind === 'Feature').map(r => r.id))];

  const stageSeed: Array<Omit<TpStage, 'title' | 'short' | 'core' | 'refs' | 'inputs'>> = [
    {
      id: 'registry', index: 0, tone: g.features.length > 0 ? 'pass' : 'fail',
      summary: `${g.features.length} Feature · 범위 ${scope.length}`,
      rows: [
        { label: 'Feature 정의', value: `${g.features.length}건`, tone: g.features.length > 0 ? 'pass' : 'fail' },
        { label: 'Lifecycle', value: `${[...new Set(g.features.map(f => f.lifecycle))].length}종`, tone: 'info' },
        { label: '정확 버전 pin', value: `${g.features.filter(f => f.baselineVer).length}건`, tone: 'info' },
        { label: 'Retired', value: `${g.features.filter(f => f.lifecycle === 'Retired').length}건`, tone: 'pending' },
        { label: 'Registry 계약', value: 'SW 4.2', tone: 'muted' },
      ],
    },
    {
      id: 'graph', index: 1, tone: dangling > 0 ? 'fail' : 'pass',
      summary: `${graph.nodes.size} 노드 · ${graph.links.length} 관계`,
      rows: [
        { label: '노드', value: `${graph.nodes.size}개`, tone: 'pass' },
        { label: '관계', value: `${graph.links.length}건`, tone: 'pass' },
        { label: '해석 불가', value: `${dangling}건`, tone: dangling > 0 ? 'fail' : 'pass' },
        { label: '미연결', value: `${orphan}건`, tone: orphan > 0 ? 'pending' : 'pass' },
        { label: 'Artifact', value: `${artifacts}개`, tone: 'info' },
      ],
    },
    {
      id: 'validate', index: 2,
      tone: blocking > 0 ? 'fail' : warning > 0 ? 'pending' : 'pass',
      summary: `BLOCK ${blocking} · WARN ${warning}`,
      rows: [
        { label: 'BLOCKING', value: `${blocking}건`, tone: blocking > 0 ? 'fail' : 'pass' },
        { label: 'WARNING', value: `${warning}건`, tone: warning > 0 ? 'pending' : 'pass' },
        { label: '순환', value: `${cycles}건`, tone: cycles > 0 ? 'fail' : 'pass' },
        { label: '중복 선언', value: `${dups}건`, tone: dups > 0 ? 'fail' : 'pass' },
        { label: '사전 외 타입', value: `${unmapped}건`, tone: unmapped > 0 ? 'pending' : 'pass' },
      ],
    },
    {
      id: 'snapshot', index: 3, tone: missingPins > 0 ? 'fail' : 'pass',
      summary: `${snapshots.length} Snapshot · 미해석 ${missingPins}`,
      rows: [
        { label: 'Snapshot', value: `${snapshots.length}건`, tone: 'pass' },
        { label: '동결', value: `${frozen}건`, tone: 'info' },
        { label: '작업본 노드', value: `${snapshots[0]?.nodes.length ?? 0}개`, tone: 'info' },
        { label: '미해석 pin', value: `${missingPins}건`, tone: missingPins > 0 ? 'fail' : 'pass' },
        { label: 'LIVE hash', value: shortDigest(snapshots[0]?.hash ?? '', 10), tone: 'muted' },
      ],
    },
    {
      id: 'capability', index: 4,
      tone: byOutcome('CONFIG_CONFLICT') > 0 ? 'fail' : byOutcome('UNVERIFIED') > 0 ? 'pending' : 'pass',
      summary: `${byOutcome('SELECTED')}/${capability.length} SELECTED`,
      rows: [
        { label: 'SELECTED', value: `${byOutcome('SELECTED')}건`, tone: 'pass' },
        { label: 'UNVERIFIED', value: `${byOutcome('UNVERIFIED')}건`, tone: byOutcome('UNVERIFIED') > 0 ? 'pending' : 'pass' },
        { label: '조건 충돌', value: `${byOutcome('CONFIG_CONFLICT')}건`, tone: byOutcome('CONFIG_CONFLICT') > 0 ? 'fail' : 'pass' },
        { label: '미지원', value: `${byOutcome('NOT_SUPPORTED')}건`, tone: byOutcome('NOT_SUPPORTED') > 0 ? 'pending' : 'pass' },
        { label: '평가 범위', value: `${capability.length} Feature`, tone: drift > 0 ? 'pending' : 'pass' },
      ],
    },
    {
      id: 'impact', index: 5, tone: tests.length > 0 ? 'pass' : 'pending',
      summary: `영향 ${impactRows.length} · 시험 ${tests.length}`,
      rows: [
        { label: '영향 노드', value: `${impactRows.length}개`, tone: 'info' },
        { label: '영향 Feature', value: `${impactFeatures.length}개`, tone: 'info' },
        { label: '선택 시험', value: `${tests.length}건`, tone: tests.length > 0 ? 'pass' : 'pending' },
        { label: '경로 깊이', value: `≤${walk.maxHops}`, tone: 'muted' },
        { label: '탐색 완결', value: walk.complete ? '완전' : `잔여 ${walk.frontier.length}`, tone: walk.complete ? 'pass' : 'pending' },
      ],
    },
  ];

  const stages: TpStage[] = stageSeed.map((s) => ({
    ...s,
    inputs: TP_STAGE_INPUTS[s.id],
    title: TP_STAGE_META[s.id].ko,
    short: TP_STAGE_SHORT[s.id],
    core: TP_STAGE_META[s.id].core,
    refs: TP_STAGE_META[s.id].refs,
  }));

  // 실제 데이터 의존만 본다 — 입력 단계가 실패하면 그 단계로 막히고, 아니면 끝까지 진행한다.
  const byId = new Map(stages.map(s => [s.id, s]));
  for (const st of stages) {
    const bad = st.inputs.map(id => byId.get(id)!).find(x => x.tone === 'fail');
    if (bad) {
      st.tone = 'fail';
      st.blockedBy = bad.id;
      st.blockedReason = `${bad.short} 실패 — 입력 미확정`;
    }
  }
  // 검증 BLOCKING 이 남으면 동결은 판정을 보류한다 — 실패가 아니라 보류다.
  const validateStage = byId.get('validate')!;
  const snapshotStage = byId.get('snapshot')!;
  if (!snapshotStage.blockedBy && validateStage.tone === 'fail') {
    snapshotStage.heldBy = 'validate';
    snapshotStage.heldReason = `검증 BLOCKING ${blocking}건 — 동결 보류`;
  }

  return { stages };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Import 검증 — UI05-S07
// ════════════════════════════════════════════════════════════════════════════

export const IMPORT_COLUMNS = ['행', '원천 열', '매핑 속성', '입력값', '검사', '보완 안내'];

export interface ImportRow {
  line: number;
  source: string;
  type: string;
  target: string;
  /** 정확 버전 pin 후보 */
  version: string;
  check: 'OK' | 'UNKNOWN_RELATION' | 'ALIAS_MANUAL' | 'DANGLING_SOURCE' | 'DANGLING_TARGET' | 'SELF_REFERENCE' | 'DUPLICATE' | 'COLUMN_COUNT';
  remedy: string;
  /** 사전에 그대로 있는 행만 반영 대상 */
  applyable: boolean;
}

export function parseImport(text: string, graph: TopologyGraph): ImportRow[] {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 3) {
      rows.push({ line: i + 1, source: cols[0] ?? '', type: cols[1] ?? '', target: cols[2] ?? '', version: '', check: 'COLUMN_COUNT', remedy: 'source,type,target 3열이 필요', applyable: false });
      return;
    }
    const [sourceRaw, type, targetRaw] = cols;
    const target = baseId(targetRaw);
    const version = refVersion(targetRaw);
    const key = `${sourceRaw}|${type}|${target}`;

    let check: ImportRow['check'] = 'OK';
    let remedy = '관계 사전 일치 — 반영 가능';
    if (!REL_BY_ID.has(type)) {
      check = 'UNKNOWN_RELATION';
      remedy = REL_UNMAPPED_HINT[type]
        ? `사전 밖 \`${type}\` — 사람 확인 필요(자동 변환 금지, 후보 \`${REL_UNMAPPED_HINT[type]}\`)`
        : `사전 밖 \`${type}\` — 대응 후보 없음, 반영 차단`;
    } else if (sourceRaw === target) {
      check = 'SELF_REFERENCE';
      remedy = '자기 참조 — 반영 차단';
    } else if (seen.has(key)) {
      check = 'DUPLICATE';
      remedy = '같은 방향·같은 종류 중복 — 1건만 반영';
    } else if (!graph.nodes.has(sourceRaw)) {
      check = 'DANGLING_SOURCE';
      remedy = 'Registry 에 없는 source — 등록 후 재검증';
    } else if (!graph.nodes.has(target)) {
      check = 'DANGLING_TARGET';
      remedy = 'Registry·Artifact 에 없는 target — 등록 후 재검증';
    }
    seen.add(key);
    rows.push({ line: i + 1, source: sourceRaw, type, target: targetRaw, version, check, remedy, applyable: check === 'OK' });
  });
  return rows;
}

export const IMPORT_CHECK_KO: Record<ImportRow['check'], string> = {
  OK: '통과',
  UNKNOWN_RELATION: '사전 외',
  ALIAS_MANUAL: '별칭 — 수동',
  DANGLING_SOURCE: 'source 미해석',
  DANGLING_TARGET: 'target 미해석',
  SELF_REFERENCE: '자기 참조',
  DUPLICATE: '중복',
  COLUMN_COUNT: '열 수 오류',
};

// ════════════════════════════════════════════════════════════════════════════
// 8. 화면
// ════════════════════════════════════════════════════════════════════════════

const AREAS: { id: string; ko: string }[] = [
  { id: 'UI05-S01', ko: 'S01 Topology 목록과 Snapshot' },
  { id: 'UI05-S02', ko: 'S02 연결관계 탐색' },
  { id: 'UI05-S03', ko: 'S03 관계 편집과 15종 사전' },
  { id: 'UI05-S04', ko: 'S04 조건과 제약 검증' },
  { id: 'UI05-S05', ko: 'S05 변경 영향과 경로 비교' },
  { id: 'UI05-S06', ko: 'S06 외부 도구와 차량 실행 연결' },
  { id: 'UI05-S07', ko: 'S07 가져오기와 정합성 이슈' },
];

const TONE_FILL: Record<Tone, string> = {
  pass: 'var(--pass)', pending: 'var(--pending)', fail: 'var(--fail)', info: 'var(--info)', muted: 'var(--muted)',
};

const SEV_CLASS: Record<Severity, string> = { BLOCKING: 'blocking', WARNING: 'warning', INFO: 'info' };

const OUTCOME_TONE: Record<ProfileOutcome, Tone> = {
  SELECTED: 'pass', NOT_SUPPORTED: 'info', UNVERIFIED: 'pending', CONFIG_CONFLICT: 'fail',
};

/** 판정 태그 톤 — 미사용은 보상 책임이 붙는 경고가 아니라 차단색으로 구분한다. */
const UL_USAGE_TONE: Record<UlUsageVerdict, string> = {
  '사용': 'info',
  '조건부 사용': 'warning',
  '부트스트랩 한정': 'warning',
  '미사용': 'blocking',
  '미사용(기본 OFF)': 'blocking',
};

const DEFAULT_IMPORT = [
  '# 원천 CSV — source,type,target  (정확 버전은 target@version 으로 pin)',
  'FEAT-BODY-001,parent_of,FEAT-BDC-001',
  'FEAT-BDC-001,requires,FEAT-RUNTIME-001',
  'FEAT-BDC-001,fallback_to,POLICY-BDC-PREV',
  'SYS-BODY-001,implemented_by,SWC-BDC-ADAPTER@1.0.0',
  'FEAT-BDC-001,related_to,FEAT-ADAS-001',
  'FEAT-ADAS-001,excludes,FEAT-ADAS-001',
  'FEAT-BODY-001,parent_of,FEAT-BDC-001',
].join('\n');

export function TopologyArch(): JSX.Element {
  const { state, dispatch } = useApp();
  const { role, lang } = useAppShell();
  const l10n = lang as Lang;
  const toast = useToast();
  const twin = useTwin();
  const snapshot = twin.snapshot;

  const [tab, setTab] = useState(AREAS[0].id);
  const [root, setRoot] = useState('FEAT-BDC-001');
  const [snapA, setSnapA] = useState('LIVE');
  const [snapB, setSnapB] = useState('BOM-BDC-BODY');
  const [condRow, setCondRow] = useState(BOM_CONDITION_PROFILES[0].id);
  const [importText, setImportText] = useState(DEFAULT_IMPORT);
  const [edit, setEdit] = useState({ source: 'FEAT-BDC-001', type: 'requires', target: 'FEAT-RUNTIME-001', version: '2.0.0' });
  const [editResult, setEditResult] = useState<{ code: string; ok: boolean; text: string } | null>(null);

  // ── 순수 계산 — 모두 실측 state 를 입력으로 쓴다 ──────────────────────────
  const input = useMemo<TopologyInput>(() => ({ features: state.features, edges: state.edges, relations: state.relations }), [state.features, state.edges, state.relations]);
  const graph = useMemo(() => buildTopologyGraph(input), [input]);
  // Capability 평가 범위는 BOM 멤버 집합이 정한다 — Registry 전체로 평가하면 BOM 을 벗어난 판정이 나온다.
  const scope = useMemo(() => bomScopeFeatureIds(state.bomBaselines), [state.bomBaselines]);
  const usage = useMemo(() => relationUsage(graph), [graph]);
  const snapshots = useMemo(() => buildSnapshots(graph, state.bomBaselines, state.audit[0]?.ts ?? '—'), [graph, state.bomBaselines, state.audit]);
  const findings = useMemo(() => validateTopology(graph, input, state.bomBaselines, scope), [graph, input, state.bomBaselines, scope]);
  const capability = useMemo(() => evaluateCapability(graph, input, scope), [graph, input, scope]);
  const tests = useMemo(() => selectTests(graph, capabilityRoots(graph, root)), [graph, root]);
  const walked = useMemo(() => walkGraph(graph, root, 3), [graph, root]);
  const model = useMemo(
    () => buildTopologyModel({ g: input, graph, baselines: state.bomBaselines, snapshots, findings, capability, root, tests, scope }),
    [input, graph, state.bomBaselines, snapshots, findings, capability, root, tests, scope],
  );
  const imports = useMemo(() => parseImport(importText, graph), [importText, graph]);
  const dupConditions = useMemo(() => duplicateConditionPairs(), []);
  const bindDup = useMemo(() => bindingConflicts(), []);
  const activeSnap = snapshots.find(s => s.id === snapA) ?? snapshots[0];
  const otherSnap = snapshots.find(s => s.id === snapB) ?? snapshots[1] ?? snapshots[0];
  const diff = useMemo(() => diffSnapshots(activeSnap, otherSnap, graph), [activeSnap, otherSnap, graph]);
  const capRoot = capability.find(c => c.root === root);
  const cond = BOM_CONDITION_PROFILES.find(r => r.id === condRow) ?? BOM_CONDITION_PROFILES[0];
  const condResult = useMemo(() => evaluateProfiles({ market: cond.market, model: cond.model, modelYear: cond.modelYear, trim: cond.trim, option: cond.option, hw: cond.hw, sw: cond.sw, upgvc: cond.upgvc }), [cond]);

  const paused = snapshot.clock.rate === 0;
  const clock = simClockLabel(snapshot.clock);
  const canEdit = role === 'author';
  const blocking = countSeverity(findings, 'BLOCKING');
  const warning = countSeverity(findings, 'WARNING');

  // ── 정본 계약 계층 (TD §4.4~§4.8) — 값은 모두 실측 state 에서 계산한다 ─────
  const contract = useMemo(() => buildContractView(input, state.bomBaselines), [input, state.bomBaselines]);
  const phases = useMemo(() => phaseCounts(findings), [findings]);
  const recordRows = useMemo(
    () => contract.audit.filter(r => RECORD_SCOPE_TYPES.includes(r.type)),
    [contract],
  );

  // ── S03 관계 저장 ────────────────────────────────────────────────────────
  const submitRelation = (): void => {
    if (!canEdit) {
      setEditResult({ code: '403', ok: false, text: 'FORBIDDEN — 편집은 author 역할만 가능(rolePolicy.edit)' });
      return;
    }
    const src = edit.source;
    const tgt = baseId(edit.target);
    if (src === tgt) { setEditResult({ code: '422', ok: false, text: '자기 참조 관계는 만들 수 없습니다' }); return; }
    if (!graph.nodes.has(src)) { setEditResult({ code: '422', ok: false, text: `source ${src} 가 Registry 에 없습니다` }); return; }
    if (!REL_BY_ID.has(edit.type)) { setEditResult({ code: '422', ok: false, text: `\`${edit.type}\` 는 정본 15종 밖입니다` }); return; }
    const key = `${src}|${edit.type}|${tgt}`;
    if (graph.links.some(l => l.key === key)) { setEditResult({ code: '409', ok: false, text: '같은 방향·같은 종류 관계가 이미 있습니다(DUPLICATE_RELATION)' }); return; }
    const inverse = graph.links.some(l => l.source === src && l.target === tgt && (l.type === 'requires' || l.type === 'excludes'));
    const nowType = edit.type === 'requires' || edit.type === 'excludes';
    if (inverse && nowType) { setEditResult({ code: '412', ok: false, text: '같은 쌍에 requires/excludes 가 이미 있어 조건 충돌입니다' }); return; }

    const id = `RX-${src.slice(-6)}-${edit.type.slice(0, 4)}-${tgt.slice(-6)}`;
    dispatch({ t: 'TOPOLOGY_REL_SAVE', r: { id, source: src, target: `${tgt}@${edit.version}`, type: edit.type as M.RelType } });
    setEditResult({ code: '202', ok: true, text: `관계 저장 — ${src} ${edit.type} → ${tgt}@${edit.version} · Revision 감사에 기록됨` });
  };

  const applyImports = (): void => {
    const ok = imports.filter(r => r.applyable);
    if (ok.length === 0) { toast('반영 가능한 행이 없습니다 — 검사 결과를 확인하세요', 'warn'); return; }
    for (const r of ok) {
      dispatch({
        t: 'TOPOLOGY_REL_SAVE',
        r: { id: `IM-${r.line}-${r.source.slice(-5)}-${r.target.slice(-5)}`, source: r.source, target: r.version ? `${r.target}@${r.version}` : r.target, type: r.type as M.RelType },
      });
    }
    toast(`${ok.length}건 반영 — 미해석 ${imports.filter(r => !r.applyable).length}건은 차단됨`, 'ok');
  };

  return (
    <div className="tpa-root" data-paused={paused} data-testid="topology-arch">
      <Breadcrumb />
      {/* -------------------------------------------------------------- 헤더 */}
      <div className="tpa-head">
        <div className="tpa-head-title">
          <PageTitle className="" fallback="Topology 동작 메커니즘" />
          <span className="tpa-head-sub">
            구성과 PLM · 관계 사전 {SPEC_TOPOLOGY_RELATIONS.length}종 · 그래프 검증 4단계
          </span>
        </div>
        <span className={`tpa-badge ${paused ? 'paused' : 'live'}`} role="status">
          <span className="tpa-dot" aria-hidden />
          {paused ? '⏸ PAUSED' : `▶ LIVE ×${snapshot.clock.rate}`}
        </span>
        <div className="tpa-rates" role="group" aria-label="시뮬레이터 클럭">
          <span className="tpa-lab">클럭</span>
          {[0, 1, 5].map(r => (
            <button key={r} type="button" className={snapshot.clock.rate === r ? 'on' : ''} onClick={() => twin.setRate(r as 0 | 1 | 5)}>
              ×{r}
            </button>
          ))}
          <button type="button" onClick={() => twin.step(60)}>+1m</button>
        </div>
        <div className="tpa-head-clock mono">{clock.text} · revision {snapshot.revision}</div>
      </div>

      {/* ------------------------------------------- 상단: Feature Topology 엔진 */}
      <section className="tpa-panel" data-testid="topology-engine">
        <header>
          <h3>Feature Topology 엔진 — Registry SoT → ImpactSet</h3>
          <span className="tpa-chip" title="작업본 TopologySnapshot 내용 hash — 동결본이 아니다">
            <b className="mono">{shortDigest(snapshots[0]?.hash ?? '', 10)}</b>LIVE snapshot hash
          </span>
          <span className="tpa-ref">{CORE_LEGEND.map(g => g.core).join(' · ')}</span>
        </header>
        <div className="tpa-flow">
          {model.stages.map((st, i) => {
            const active = tab.startsWith('UI05-') && st.id === stageOfArea(tab);
            const status = st.tone === 'pass' ? 'PASS' : st.tone === 'pending' ? 'REVIEW' : st.tone === 'fail' ? 'BLOCK' : 'INFO';
            const prev = model.stages[i - 1];
            return (
              <Fragment key={st.id}>
                {prev && (
                  <div
                    className={`tpa-arrow ${st.blockedBy ? 'blocked' : ''}`}
                    data-testid={`tp-link-${prev.id}-${st.id}`}
                    data-blocked={Boolean(st.blockedBy)}
                    title={st.blockedBy
                      ? `${prev.title} → ${st.title}: 입력 미확정`
                      : `${prev.title} → ${st.title}`}
                  >
                    <span className="tpa-arrow-rail" aria-hidden />
                    <span
                      className={`tpa-packet tpa-tone-${st.tone}`}
                      data-paused={paused}
                      data-blocked={Boolean(st.blockedBy)}
                      aria-hidden
                      style={{
                        animationDuration: `${paused ? 0 : 900 / Math.max(1, snapshot.clock.rate)}ms`,
                        animationDelay: `${(i - 1) * 120}ms`,
                        animationPlayState: st.blockedBy || paused ? 'paused' : 'running',
                      }}
                    />
                  </div>
                )}
                <article
                  className={`tpa-stage ${st.tone === 'fail' ? 'blocked' : ''} ${active ? 'active' : ''}`}
                  data-testid={`tp-stage-${st.id}`}
                  data-tone={st.tone}
                  data-blocked={Boolean(st.blockedBy)}
                  title={`${st.title} · ${st.refs}`}
                >
                  <header className="tpa-stage-head">
                    <span className="tpa-stage-title" title={st.title}>{st.short}</span>
                    <span className="tpa-stage-core mono" title={SPEC_CORE_LABEL[st.core] ?? st.core}>{st.core}</span>
                  </header>
                  <div className="tpa-stage-rows">
                    {st.rows.map(r => (
                      <div key={r.label} className="tpa-row" title={`${r.label} ${r.value}`}>
                        <span className={`tpa-dot tpa-tone-${r.tone}`} aria-hidden />
                        <span className="tpa-row-label">{r.label}</span>
                        <span className="tpa-row-value">{r.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tpa-stage-foot">
                    <span className={`tpa-stage-status tpa-tone-${st.tone}`}>{status}</span>
                    <span className={`tpa-stage-count tpa-tone-${st.tone}`} title={st.summary}>{st.summary}</span>
                  </div>
                  {st.blockedBy && <div className="tpa-stage-blocked">⛔ {st.blockedReason}</div>}
                  {st.heldBy && <div className="tpa-stage-held">⏸ {st.heldReason}</div>}
                </article>
              </Fragment>
            );
          })}
        </div>
        <div className="tpa-legend">
          {CORE_LEGEND.map(g => (
            <span key={g.core} className="tpa-legend-item" title={`${g.core} ${g.name} — ${g.refs.join(' · ')}`}>
              <b className="mono">{g.core}</b>
              <span className="tpa-legend-name">{g.name}</span>
              <span className="tpa-legend-stages">{g.stages.join(' · ')}</span>
              <span className="tpa-legend-refs mono">{g.refs.join(' · ')}</span>
            </span>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- 영역 탭 */}
      <div className="tabs">
        {AREAS.map(a => (
          <button key={a.id} type="button" className={tab === a.id ? 'active' : ''} onClick={() => setTab(a.id)}>{a.ko}</button>
        ))}
      </div>

      <div className="tpa-area-body">
        {tab === 'UI05-S01' && (
          <>
            <div className="kpis">
              <div className="kpi"><div className="v">{snapshots.length}</div><div className="l">TopologySnapshot</div></div>
              <div className="kpi"><div className="v">{snapshots.filter(s => s.state === 'APPROVED').length}</div><div className="l">동결(APPROVED)</div></div>
              <div className="kpi"><div className="v">{graph.nodes.size}</div><div className="l">작업본 노드</div></div>
              <div className="kpi"><div className="v">{graph.links.length}</div><div className="l">작업본 관계</div></div>
              <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{snapshots.reduce((n, s) => n + s.missing.length, 0)}</div><div className="l">미해석 pin</div></div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>Snapshot 목록 (S01-A01 기준선과 Snapshot 선택)</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead>
                    <tr>
                      <th>Snapshot</th><th>Topology ref</th><th>버전</th><th>종류</th><th>상태</th>
                      <th>노드</th><th>관계</th><th>미해석</th><th>내용 hash</th><th>시각</th><th>책임</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map(s => (
                      <tr key={s.id} className={`click ${snapA === s.id ? 'sel' : ''}`} onClick={() => setSnapA(s.id)}>
                        <td className="mono">{s.id}</td>
                        <td className="mono">{s.ref}</td>
                        <td className="mono">{s.version}</td>
                        <td>{s.kind === 'LIVE' ? '작업본' : '기준선 BOM'}</td>
                        <td><span className={`tpa-tag ${s.state === 'APPROVED' ? 'info' : s.state === 'REVOKED' ? 'blocking' : ''}`}>{s.state}</span></td>
                        <td className="num">{s.nodes.length}</td>
                        <td className="num">{s.linkKeys.length}</td>
                        <td className="num" style={{ color: s.missing.length ? 'var(--fail)' : undefined }}>{s.missing.length}</td>
                        <td className="mono">{shortDigest(s.hash, 12)}</td>
                        <td className="mono">{s.at}</td>
                        <td>{s.ownerRef}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tpa-note">
                선택: <b>{activeSnap.id}</b> · {activeSnap.memberRef} · hash 는 <b>nodes + 관계 집합</b>만 정규 직렬화해
                SHA-256 으로 계산한다(상태·승인 기록은 내용이 아니므로 제외 — DD-03-3 의 contentHash 규칙과 동일).
              </p>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>노드와 관계 버전 조회 (S01-A02) — 정본 표시 열 6종</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead>
                    <tr><th>Source</th><th>관계</th><th>Target</th><th>고정 버전</th><th>기준선</th><th className="wrap">영향 이유</th></tr>
                  </thead>
                  <tbody>
                    {graph.links.slice(0, 40).map(l => {
                      const v = REL_BY_ID.get(l.type);
                      const owner = snapshots.find(s => s.kind === 'BASELINE' && s.linkKeys.includes(l.key));
                      return (
                        <tr key={`${l.origin}-${l.id}`}>
                          <td className="mono">{l.source}</td>
                          <td>{v ? v.ko : <span style={{ color: 'var(--pending)' }}>{l.type} (사전 외)</span>}</td>
                          <td className="mono">{l.target}</td>
                          <td className="mono">{graph.nodes.get(l.target)?.version ?? (refVersion(l.target) || '—')}</td>
                          <td className="mono">{owner ? `${owner.id}@${owner.version}` : '작업본'}</td>
                          <td className="wrap">{v
                            ? `${v.dir} · ${STAGE_KO[v.stage]} · 판정 ${v.gate}${l.criticality ? ` · 중요도 ${l.criticality}` : ''}${l.safeDefault ? ` · Safe Default ${l.safeDefault}` : ''}`
                            : `정본 15종 밖 — ${l.hint ? `\`${l.hint}\` 후보, 사람 확인 후 재입력` : '대응 후보 없음'}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {graph.links.length > 40 && <p className="tpa-note">관계 {graph.links.length}건 중 40건 표시 — 상단 파이프라인·S02 탐색에서 전체를 다룬다.</p>}
            </div>
          </>
        )}

        {tab === 'UI05-S02' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>탐색 시작 노드와 범위 지정 (S02-A03)</h3>
              <div className="tpa-form">
                <label>시작 노드
                  <select value={root} onChange={e => setRoot(e.target.value)}>
                    {[...graph.nodes.values()].map(n => (
                      <option key={n.id} value={n.id}>{n.id} · {n.kind} · {n.label}</option>
                    ))}
                  </select>
                </label>
                <label>탐색 방향
                  <input readOnly value="out(구현·배포·시험) + in(요구·상위)" />
                </label>
                <label>최대 깊이
                  <input readOnly value="3" />
                </label>
              </div>
              <div className="tpa-actions">
                <span className="tpa-chip pass"><b>{walked.length}</b>도달 관계</span>
                <span className="tpa-chip"><b>{[...new Set(walked.map(w => w.id))].length}</b>고유 노드</span>
                <span className="tpa-chip pending"><b>{walked.filter(w => w.kind === 'External').length}</b>미해석</span>
                <span className="tpa-chip info" style={{ marginLeft: 'auto' }}>TD 4.3 · TD 4.4 · SW DD-03-5</span>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>연결관계 탐색 — 요구 → SW → HW → UPGVC → 시험 원천</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead>
                    <tr><th>Source</th><th>관계</th><th>Target</th><th>고정 버전</th><th>기준선</th><th className="wrap">영향 이유</th></tr>
                  </thead>
                  <tbody>
                    {walked.map((w, i) => {
                      const v = REL_BY_ID.get(w.type);
                      return (
                        <tr key={`${w.via}|${w.type}|${w.id}|${i}`}>
                          <td className="mono">{w.via}</td>
                          <td>{v ? v.ko : w.type} <span className="tpa-tag">{w.direction === 'out' ? '→' : '←'}</span></td>
                          <td className="mono">{w.id}</td>
                          <td className="mono">{graph.nodes.get(w.id)?.version ?? '—'}</td>
                          <td className="mono">{w.kind === 'Feature' ? 'Feature' : w.kind === 'Artifact' ? 'Artifact' : '미해석'}</td>
                          <td className="wrap">깊이 {w.depth} · {v ? `${v.ko} — ${v.gate}` : '사전 외 타입'}{w.kind === 'External' ? ' · Registry 미등록' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {walked.length === 0 && <div className="tpa-empty">이 시작 노드에서 도달하는 관계가 없습니다.</div>}
              <div className="tpa-chain mt">
                <span className="node">{root}</span>
                {walked.filter(w => w.depth === 1).slice(0, 6).map((w, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    <span className="arrow">{w.direction === 'out' ? '→' : '←'} {w.type}</span>
                    <span className="node">{w.id}</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'UI05-S03' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>관계 편집 (S03-A01 · A02) — 권한 author</h3>
              <p className="tpa-sub">
                저장 시 4가지 게이트를 순서대로 검사한다 — <b>403</b> 권한, <b>422</b> 정확 버전/사전/자기 참조,
                <b>409</b> 중복 선언, <b>412</b> requires·excludes 조건 충돌. 통과분만 Revision 감사에 기록된다.
              </p>
              <div className="tpa-form">
                <label>Source (정확 참조)
                  <select value={edit.source} onChange={e => setEdit({ ...edit, source: e.target.value })}>
                    {[...graph.nodes.values()].map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                  </select>
                </label>
                <label>관계 종류 (정본 15종)
                  <select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}>
                    {REL_VOCAB.map(v => <option key={v.id} value={v.id}>{v.id} — {v.ko}</option>)}
                  </select>
                </label>
                <label>Target (정확 참조)
                  <select value={edit.target} onChange={e => setEdit({ ...edit, target: e.target.value })}>
                    {[...graph.nodes.values()].map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                  </select>
                </label>
                <label>고정 버전 (정확 버전만)
                  <input value={edit.version} onChange={e => setEdit({ ...edit, version: e.target.value })} />
                </label>
              </div>
              <div className="tpa-actions">
                <button className="btn primary" type="button" onClick={submitRelation} disabled={!canEdit}>관계 저장</button>
                <span className="tpa-note">현재 역할 <b>{role}</b> · rolePolicy.edit = author{canEdit ? '' : ' — 읽기 전용'}</span>
              </div>
              {editResult && (
                <div className={`tpa-result ${editResult.ok ? 'ok' : 'bad'}`}>
                  <span className="code">{editResult.code}</span>{editResult.text}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>관계 지원 여부와 실측 사용 수 (S03-A04 · 정본 15종)</h3>
              <div className="tpa-vocab">
                {REL_VOCAB.map(v => {
                  const n = usage.counts.get(v.id) ?? 0;
                  const src = v.from.length > 0 ? v.from.join(', ') : '원천 없음';
                  const c = CONTRACT_BY_TYPE.get(v.id);
                  return (
                    <div key={v.id} className={`tpa-vocab-card ${n === 0 ? 'zero' : ''}`} data-testid={`vocab-${v.id}`}>
                      <div className="id">{v.id}</div>
                      <div className="ko">{v.ko}</div>
                      <div className="meta">{v.dir} · {STAGE_KO[v.stage]} · 판정 {v.gate}</div>
                      <div className="meta">원천 {src}{v.aliasOf ? ` (별칭 ${v.aliasOf})` : ''} · 사용 {n}건</div>
                      {c && (
                        <div className="meta contract" title={`${CYCLE_POLICY_KO[c.cycle]} · 판정 책임 ${c.judge} · ${c.refs}`}>
                          {c.symmetry === 'SYMMETRIC' ? '대칭' : '방향'} · {c.cardinality}
                          {c.scopeRequired ? ' · 제약 수준 필수' : ''}
                          {c.pinRequired ? ' · 정확 버전 필수' : ''}
                          <div className="tpa-vocab-exec">
                            <span className={`tpa-tag ${executionHoldsApproval(c.type) ? 'warning' : 'info'}`}>
                              {EXECUTION_SUPPORT_KO[c.execution].ko}
                            </span>
                            {c.requiredStates && <span className="small muted">요구 상태 {c.requiredStates.join(' · ')}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {usage.unmapped.size > 0 && (
                <div className="mt">
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>사전 밖 원천 타입 — 자동 변환 금지</h4>
                  <div className="tpa-strip">
                    {[...usage.unmapped.entries()].map(([t, n]) => (
                      <span key={t} className="tpa-chip pending">
                        <b>{t}</b>{n}건 → 후보 {REL_UNMAPPED_HINT[t] ?? '없음'} · 사람 확인
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card" data-testid="tp-record-contract">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>관계 레코드 계약 (S03-A01 · TD §4.4) — 정본 필수 속성 {RELATION_RECORD_FIELDS.length}종</h3>
              <p className="tpa-sub">
                관계는 선만이 아니라 <b>레코드</b>다. 조건 참조는 무조건 관계도 <span className="mono">{ALWAYS_CONDITION}</span> 로
                항상 참임을 명시하고, 출발·도착은 정확 버전과 contentHash 를 가진 객체 참조로 고정한다. 필수 속성이 비면
                저장은 하되 <b>승인·발행은 보류</b>한다.
              </p>
              <div className="tpa-strip">
                <span className="tpa-chip"><b>{recordRows.length}</b>계약 대상 관계</span>
                <span className="tpa-chip"><b>{RELATION_RECORDS.length}</b>관계 레코드</span>
                <span className={`tpa-chip ${contract.holdsApproval.length > 0 ? 'pending' : 'pass'}`}>
                  <b>{contract.holdsApproval.length}</b>승인 보류
                </span>
                <span className="tpa-chip"><b className="mono">{DICTIONARY_VERSION}</b>사전 버전</span>
                {UNRECORDED_EDGE_IDS.map(id => (
                  <span key={id} className="tpa-chip pending"><b className="mono">{id}</b>레코드 없음</span>
                ))}
              </div>
              <div className="tpa-fields">
                {RELATION_RECORD_FIELDS.map(f => (
                  <span key={String(f.id)} className={`tpa-field ${f.required ? 'req' : ''}`} title={f.note}>
                    <b className="mono">{String(f.id)}</b>{f.ko}{f.required ? ' ·필수' : ' ·조건부'}
                  </span>
                ))}
              </div>
              <div className="tpa-scroll mt">
                <table className="tpa-table">
                  <thead>
                    <tr>
                      <th>관계</th><th>유형</th><th className="wrap">출발 참조</th><th className="wrap">도착 참조</th>
                      <th>조건</th><th>제약 수준</th><th>요구 상태</th><th>실행 지원</th><th className="wrap">결함</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordRows.map(r => {
                      const rec = r.record;
                      const exec = r.contract?.execution;
                      return (
                        <tr key={r.edgeId} data-testid={`tp-record-${r.edgeId}`}>
                          <td className="mono">{r.edgeId}</td>
                          <td className="mono">{r.type}</td>
                          <td className="wrap mono">{rec ? formatRef(rec.sourceRef) : `${r.source} — 레코드 없음`}</td>
                          <td className="wrap mono">{rec ? formatRef(rec.targetRef) : r.target}</td>
                          <td className="mono">{rec?.conditionRef ?? '—'}</td>
                          <td className="mono">
                            {rec?.constraintScope
                              ? <span title={CONSTRAINT_SCOPE_KO[rec.constraintScope].means}>{CONSTRAINT_SCOPE_KO[rec.constraintScope].ko}</span>
                              : <span className="tpa-tag warning">미선언</span>}
                          </td>
                          <td className="mono">
                            {rec?.requiredState
                              ? <span title={`${REQUIRED_STATE_JUDGE[rec.requiredState].when} · ${REQUIRED_STATE_JUDGE[rec.requiredState].owner}`}>{rec.requiredState}</span>
                              : (r.contract?.requiredStates ? <span className="tpa-tag warning">미선언</span> : '—')}
                          </td>
                          <td className="mono" title={exec ? EXECUTION_SUPPORT_KO[exec].judge : ''}>
                            {exec ? EXECUTION_SUPPORT_KO[exec].ko : '—'}
                          </td>
                          <td className="wrap">
                            {r.issues.length === 0
                              ? <span className="tpa-tag info">계약 충족</span>
                              : r.issues.map(i => (
                                <span key={i.code} className={`tpa-tag ${i.blocksApproval ? 'warning' : 'info'}`} title={i.detail}>
                                  {i.code}
                                </span>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="tpa-note">
                Artifact 결속 6종(implemented_by · verified_by · observed_by · deployed_on · governed_by · emits)의 정확 참조·
                contentDigest·resolution 은 구현 Artifact 표(UI04)가 소유한다 — Topology 가 같은 값을 두 번 요구하지 않는다.
              </p>
            </div>

            <div className="card" data-testid="tp-legacy-map">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>원문 관계명 이관 (TD §4.5 · GAP-03) — 자동 변환 금지</h3>
              <p className="tpa-sub">
                원문 표기를 대소문자만 보고 같은 계약으로 판단하지 않는다. <b>PRECEDES</b> 는 실행 선후를 표현하는 독립 관계로
                보존하고 <b>requires 로 바꾸지 않으며</b>, <b>COMBI</b> 는 의미 확인 없이 requires 로 승격하지 않는다.
              </p>
              <table className="tpa-table">
                <thead><tr><th>원문 관계명</th><th>이관 처리</th><th>통합 사전</th><th className="wrap">이유</th><th>실측</th></tr></thead>
                <tbody>
                  {LEGACY_RELATION_MAP.map(l => {
                    const hit = usage.unmapped.get(l.source) ?? usage.counts.get(l.source) ?? 0;
                    return (
                      <tr key={l.source}>
                        <td className="mono">{l.source}</td>
                        <td>
                          <span className={`tpa-tag ${l.handling === 'MAP' ? 'info' : l.handling === 'MANUAL_REVIEW' ? 'blocking' : 'warning'}`}>
                            {LEGACY_HANDLING_KO[l.handling]}
                          </span>
                        </td>
                        <td className="mono">
                          {l.target ?? '—'}
                          {l.handling === 'KEEP_SEPARATE' && <div className="small muted">사전 미등록 → 저장 전용</div>}
                        </td>
                        <td className="wrap">{l.note}</td>
                        <td className="num">{hit}건</td>
                      </tr>
                    );
                  })}
                  {[...usage.unmapped.entries()]
                    .filter(([t]) => !LEGACY_BY_SOURCE.has(t.toUpperCase()))
                    .map(([t, n]) => (
                      <tr key={t}>
                        <td className="mono">{t}</td>
                        <td><span className="tpa-tag blocking">사람이 의미 확인</span></td>
                        <td className="mono">{REL_UNMAPPED_HINT[t] ?? '—'}</td>
                        <td className="wrap">§4.5 표에 없는 원문 표기다 — 후보만 제시하고 사람이 확인해 재입력한다</td>
                        <td className="num">{n}건</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'UI05-S04' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>조건행별 관계 유효성 (S04-A01) — 정본 표시 열 8종</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead>
                    <tr>
                      <th>조건행</th><th>국가 의미 축</th><th>국가 코드</th><th>차종·연식</th>
                      <th>Trim 참조</th><th>Variant 조건</th><th>구현 참조</th><th>확인 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BOM_CONDITION_PROFILES.map(row => {
                      const dup = dupConditions.get(`${row.id}@${row.version}`) ?? [];
                      const unknown = CONDITION_AXIS_KO.some(a => String(row[a.id]) === 'UNKNOWN');
                      const state = dup.length > 0 ? 'CONFIG_CONFLICT' : unknown ? 'UNVERIFIED' : 'SELECTED';
                      return (
                        <tr key={`${row.id}@${row.version}`} className={`click ${condRow === row.id ? 'sel' : ''}`} onClick={() => setCondRow(row.id)}>
                          <td className="mono">{row.id}@{row.version}</td>
                          <td>시장 축 (market)</td>
                          <td className="mono">{row.market}</td>
                          <td>{row.model} · {row.modelYear}</td>
                          <td>{row.trim}</td>
                          <td className="mono">option={row.option} hw={row.hw} sw={row.sw} upgvc={row.upgvc}</td>
                          <td className="mono">{row.implementationRef}</td>
                          <td>
                            <span className={`tpa-tag ${state === 'CONFIG_CONFLICT' ? 'blocking' : state === 'UNVERIFIED' ? 'warning' : 'info'}`}>
                              {PROFILE_OUTCOME_KO[state]}
                            </span>
                            {dup.length > 0 && <div className="small muted">동일 조건 중복 {dup.join(', ')}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="tpa-result mt">
                <b>선택 조건행 {cond.id}@{cond.version} 판정</b> — <span className={`tpa-tag ${condResult.outcome === 'CONFIG_CONFLICT' ? 'blocking' : 'info'}`}>{PROFILE_OUTCOME_KO[condResult.outcome]}</span>
                <div className="small mt">{condResult.reason}</div>
              </div>
            </div>

            <div className="tpa-2col">
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>순환 · 누락 · 충돌 (S04-A02)</h3>
                <Bars labelWidth={180} data={findings.reduce<Record<string, number>>((acc, f) => { acc[f.code] = (acc[f.code] ?? 0) + 1; return acc; }, {})} />
                <p className="tpa-note mt">
                  BLOCKING <b>{blocking}</b>건 / WARNING <b>{warning}</b>건 — 상단 파이프라인은 실제 입력 의존만 본다.
                  그래프 적재가 실패하면 검증·동결·Capability 가 그 입력으로 막히고, 적재가 성공하면 검증이 경고만 남겨도
                  동결·평가는 진행된다(BLOCKING 잔존 시 동결은 <b>보류</b>로 표시).
                </p>
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>UNKNOWN 경고와 차단 단계 구분 (S04-A04)</h3>
                <Donut
                  center={`${findings.length}`}
                  segments={[
                    { label: 'BLOCKING · 차단', value: blocking, color: 'var(--fail)' },
                    { label: 'WARNING · 경고', value: warning, color: 'var(--pending)' },
                    { label: 'INFO', value: countSeverity(findings, 'INFO'), color: 'var(--info)' },
                  ]}
                />
                <div className="tpa-strip">
                  <span className="tpa-chip fail"><b>{findings.filter(f => f.code === 'DANGLING_REFERENCE').length}</b>미해석 참조 → 적재 차단</span>
                  <span className="tpa-chip pending"><b>{findings.filter(f => f.code === 'UNMAPPED_RELATION_TYPE').length}</b>사전 외 → 경고</span>
                  <span className="tpa-chip pending"><b>{findings.filter(f => f.code === 'NODE_SET_SCOPE_DRIFT').length}</b>BOM 범위 밖 node → 경고</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>제어점 Binding 교차 확인 — 정본 판정은 UI03 이 소유한다</h3>
              <p className="tpa-sub">
                같은 제어점을 같은 적용 조건으로 두 Binding 이 점유하면 어느 쪽이 이기는지 그래프가 결정할 수 없다(DD-03-4 · BD-06).
                이 화면은 결속 <b>횟수</b>만 세지 않고 그 사실을 그대로 인용한다 — 판정은 Feature BOM 화면(UI03)에서 한다.
              </p>
              <div className="tpa-strip">
                <span className="tpa-chip"><b>{FLAG_BINDINGS.length}</b>FlagBinding</span>
                <span className={`tpa-chip ${bindDup.length > 0 ? 'fail' : 'pass'}`}><b>{bindDup.length}</b>제어점·조건 중복</span>
                <span className="tpa-chip"><b>{CONTROL_POINTS.length}</b>Feature 제어점</span>
              </div>
              {bindDup.length > 0 && (
                <div className="tpa-scroll mt">
                  <table className="tpa-table">
                    <thead><tr><th>제어점 · 적용 조건</th><th>선행 Binding</th><th>충돌 Binding</th><th>판정 위치</th></tr></thead>
                    <tbody>
                      {bindDup.map(d => (
                        <tr key={d.key}>
                          <td className="mono">{d.key}</td>
                          <td className="mono">{d.first}</td>
                          <td className="mono">{d.second}</td>
                          <td>UI03 Feature BOM — 같은 코드로 차단</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {bindDup.length === 0 && <div className="tpa-empty">제어점·적용 조건 중복 0건 — 인용할 충돌이 없다.</div>}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>의존성이 차량에서 충족되는지 판단 (S04-A03)</h3>
              <div className="tpa-2col">
                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>Topology 조건 (TOPO-EV-2027.4)</h4>
                  <table className="tpa-table">
                    <thead><tr><th>조건</th><th className="wrap">판정</th><th>미충족 시 동작</th></tr></thead>
                    <tbody>
                      {TOPOLOGY_CONDITIONS.map(c => (
                        <tr key={c.id}>
                          <td className="mono">{c.id}</td>
                          <td className="wrap">{pick(c.label, l10n)}</td>
                          <td className="mono">{pick(c.effect, l10n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>차량 실행 상태</h4>
                  <div className="tpa-strip">
                    <span className="tpa-chip"><b>{snapshot.twins.length}</b>Twin</span>
                    <span className="tpa-chip pass"><b>{snapshot.stats.healthCounts.HEALTHY}</b>Online</span>
                    <span className="tpa-chip"><b>{snapshot.rollout.activatedVins.length}</b>활성 VIN</span>
                    <span className="tpa-chip pending"><b>{snapshot.rollout.binaryOtaVins.length}</b>Binary OTA 선행</span>
                    <span className="tpa-chip"><b>{snapshot.rollout.scope}</b>Scope</span>
                    <span className={`tpa-chip ${snapshot.rollout.paused ? 'pending' : 'pass'}`}><b>{snapshot.rollout.paused ? 'PAUSED' : 'RUNNING'}</b>Rollout</span>
                  </div>
                  <p className="tpa-note">
                    조건 미충족 차량은 <b>Binary OTA 선행</b> 또는 <b>활성 보류</b>로 남고, 조건 판정이 UNKNOWN 이면
                    신규 활성화를 진행하지 않는다 — 하단 Twin 런타임 토폴로지가 같은 클럭으로 이 상태를 실행한다.
                  </p>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>검증 결과 — 코드 · 대상 · 보완 안내</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead><tr><th>단계</th><th>검증 단계</th><th>코드</th><th>대상</th><th className="wrap">상세</th><th className="wrap">보완 안내</th><th className="wrap">근거</th></tr></thead>
                  <tbody>
                    {findings.slice(0, 60).map((f, i) => (
                      <tr key={`${f.code}-${i}`} data-hold={Boolean(f.blocksApproval)}>
                        <td className="mono">{f.stage}</td>
                        <td>
                          <span className={`tpa-tag ${f.blocksApproval ? 'warning' : 'info'}`} title={PHASE_KO[f.phase]}>
                            {PHASE_KO[f.phase]}
                          </span>
                          {f.blocksApproval && <div className="small muted">승인 보류</div>}
                        </td>
                        <td><span className={`tpa-tag ${SEV_CLASS[f.severity]}`}>{f.code}</span></td>
                        <td className="mono">{f.subject}</td>
                        <td className="wrap">{f.detail}</td>
                        <td className="wrap">{f.remedy}</td>
                        <td className="mono">{f.refs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {findings.length === 0 && <div className="tpa-empty">검증 위반 0건 — 그래프가 정본 규칙을 만족한다.</div>}
            </div>

            <div className="card" data-testid="tp-verify-phases">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>검증 4단계 (TD §4.6) — 결과는 「전체 통과」로 표시하지 않는다</h3>
              <p className="tpa-sub">
                정본은 검증을 <b>① 구조 → ② 구성 → ③ 의미 → ④ 평가기·차량 실행 계약</b> 네 단계로 나눈다.
                뒤 단계는 앞 단계 입력이 확정되어야 판정할 수 있으므로, 결함이 남아 있으면
                <span className="mono"> complete=false </span> 로 두고 미탐색 frontier 를 함께 밝힌다.
              </p>
              <div className={`tpa-phases ${findings.length === 0 ? 'clean' : 'open'}`} data-complete={findings.length === 0}>
                {VERIFY_PHASES.map((ph, i) => {
                  const n = phases[ph.id];
                  const held = findings.some(f => f.phase === ph.id && f.blocksApproval);
                  return (
                    <Fragment key={ph.id}>
                      {i > 0 && <span className="tpa-phase-arrow" aria-hidden>→</span>}
                      <div className={`tpa-phase ${n > 0 ? 'open' : 'clean'}`} data-testid={`tp-phase-${ph.id}`} title={ph.what}>
                        <div className="tpa-phase-head">
                          <span className="idx mono">{ph.no}</span>
                          <span className="name">{ph.ko}</span>
                        </div>
                        <div className="tpa-phase-body">
                          <span className={`tpa-tag ${held ? 'warning' : n > 0 ? 'info' : 'pass'}`}>{n}건</span>
                          <span className="small muted">
                            {n === 0 ? '위반 없음' : held ? '승인 보류 항목 포함' : '판정 계속 진행'}
                          </span>
                        </div>
                        <div className="tpa-phase-engine mono">{ph.engine}</div>
                      </div>
                    </Fragment>
                  );
                })}
                <span className="tpa-phase-arrow" aria-hidden>·</span>
                <div className="tpa-phase frontier" data-testid="tp-phase-frontier">
                  <div className="tpa-phase-head"><span className="idx mono">!!</span><span className="name">complete</span></div>
                  <div className="tpa-phase-body">
                    <span className={`tpa-tag ${findings.length === 0 ? 'pass' : 'pending'}`}>
                      {String(findings.length === 0)}
                    </span>
                    <span className="small muted">
                      {findings.length === 0 ? '네 단계 모두 위반 0건' : `미해결 ${findings.length}건 — 전체 통과 아님`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="tpa-strip">
                {VERIFY_PHASES.map(ph => (
                  <span key={ph.id} className={`tpa-chip ${phases[ph.id] > 0 ? 'pending' : 'pass'}`}>
                    <b>{phases[ph.id]}</b>{PHASE_KO[ph.id]}
                  </span>
                ))}
                <span className={`tpa-chip ${blocking > 0 ? 'fail' : 'pass'}`}><b>{blocking}</b>BLOCKING</span>
              </div>
            </div>

            <div className="card" data-testid="tp-requires-paths">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>requires 전체 경로와 요구 상태 판정 (S04-A03 · TD §4.4 · §4.8)</h3>
              <p className="tpa-sub">
                A requires B, B requires D 이면 <b>D 까지 전체 경로</b>를 본다. 요구 상태는 판정 <b>시점</b>을 함께 고정한다 —
                INCLUDED 는 기준선 승인 시, INSTALLED 는 차량 탑재 확인 시, EFFECTIVE 는 실행 판정 시에만 판정한다.
                시점이 오지 않은 경로는 성립으로 세지 않고 <b>판정 시점 미도달</b>로 남긴다.
              </p>
              <table className="tpa-table">
                <thead><tr><th>관계</th><th className="wrap">요구 경로</th><th>hop</th><th>요구 상태</th><th className="wrap">판정 시점 · 책임</th><th>결과</th></tr></thead>
                <tbody>
                  {contract.requires.map(r => (
                    <tr key={r.edgeId} data-testid={`tp-requires-${r.edgeId}`}>
                      <td className="mono">{r.edgeId}<div className="small muted">{r.source} → {r.target}</div></td>
                      <td className="wrap mono">{r.path.join(' → ')}</td>
                      <td className="num">{r.hops}</td>
                      <td className="mono">
                        {r.requiredState
                          ? <span title={REQUIRED_STATE_JUDGE[r.requiredState].evidence}>{r.requiredState} · {REQUIRED_STATE_JUDGE[r.requiredState].ko}</span>
                          : <span className="muted">미선언 — 시점 판정 불가</span>}
                      </td>
                      <td className="wrap small">
                        {r.requiredState ? `${REQUIRED_STATE_JUDGE[r.requiredState].when} · ${REQUIRED_STATE_JUDGE[r.requiredState].owner}` : '—'}
                      </td>
                      <td className="wrap">
                        <span className={`tpa-tag ${r.outcome === 'COMPLETE' ? 'info' : r.outcome === 'UNSATISFIED' ? 'blocking' : 'warning'}`}>
                          {REQUIRES_OUTCOME_KO[r.outcome]}
                        </span>
                        <div className="small muted">{r.detail}</div>
                        {r.baselines.length > 0 && <div className="small muted">기준선 {r.baselines.join(', ')}</div>}
                      </td>
                    </tr>
                  ))}
                  {contract.requires.length === 0 && (
                    <tr><td colSpan={6} className="muted">requires 관계가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
              <p className="tpa-note">
                요구 상태별 확보 가능한 증적 — {REQUIRED_STATES.map(s => `${s}: ${REQUIRED_STATE_JUDGE[s].evidence}`).join(' / ')}
              </p>
            </div>

            <div className="card" data-testid="tp-scope-verdicts">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>배타 제약 수준 판정 (TD §4.8) — 동시 활성 배타를 BOM 공존 금지로 확대하지 않는다</h3>
              <p className="tpa-sub">
                A excludes C 는 <b>동일 조건 + 동일 제약 수준</b>에서만 판정한다. 제약 수준은
                {CONSTRAINT_SCOPES.map(s => ` ${CONSTRAINT_SCOPE_KO[s].ko}(${CONSTRAINT_SCOPE_KO[s].means})`).join(' / ')} 네 가지이며,
                같은 승인 기준선에 두 FeatureVersion 이 함께 담겨 있는지를 실제 기준선 데이터로 대조한다.
              </p>
              <table className="tpa-table">
                <thead><tr><th>쌍</th><th>제약 수준</th><th>함께 담긴 기준선</th><th>판정</th><th className="wrap">근거</th></tr></thead>
                <tbody>
                  {contract.scopes.map(s => (
                    <tr key={s.edgeId} data-testid={`tp-scope-${s.edgeId}`}>
                      <td className="mono">{s.pair}<div className="small muted">{s.edgeId}</div></td>
                      <td className="mono">
                        {s.scope ? CONSTRAINT_SCOPE_KO[s.scope].ko : <span className="tpa-tag warning">미선언</span>}
                      </td>
                      <td className="num">{s.coexisting.length === 0 ? '—' : s.coexisting.join(', ')}</td>
                      <td>
                        <span className={`tpa-tag ${s.verdict === 'BLOCKING' ? 'blocking' : s.verdict === 'SCOPE_UNKNOWN' ? 'warning' : 'info'}`}>
                          {SCOPE_VERDICT_KO[s.verdict]}
                        </span>
                      </td>
                      <td className="wrap">{s.detail}</td>
                    </tr>
                  ))}
                  {contract.scopes.length === 0 && (
                    <tr><td colSpan={5} className="muted">대칭(excludes · duplicates) 관계가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'UI05-S05' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>변경 전후 Snapshot 비교 (S05-A01)</h3>
              <div className="tpa-form">
                <label>기준 버전 (A)
                  <select value={snapA} onChange={e => setSnapA(e.target.value)}>
                    {snapshots.map(s => <option key={s.id} value={s.id}>{s.id}@{s.version} · {s.ref}</option>)}
                  </select>
                </label>
                <label>변경 버전 (B)
                  <select value={snapB} onChange={e => setSnapB(e.target.value)}>
                    {snapshots.map(s => <option key={s.id} value={s.id}>{s.id}@{s.version} · {s.ref}</option>)}
                  </select>
                </label>
                <label>영향 Root
                  <select value={root} onChange={e => setRoot(e.target.value)}>
                    {capability.map(c => <option key={c.root} value={c.root}>{c.root}</option>)}
                  </select>
                </label>
              </div>
              <div className="tpa-scroll mt">
                <table className="tpa-table">
                  <thead><tr><th className="wrap">항목</th><th>기준 버전 값</th><th>변경 값</th><th className="wrap">영향 및 재검토</th></tr></thead>
                  <tbody>
                    {diff.map((d, i) => (
                      <tr key={i}>
                        <td className="wrap mono">{d.item}</td>
                        <td className="mono">{d.before}</td>
                        <td className="mono">{d.after}</td>
                        <td className="wrap">
                          <span className={`tpa-tag ${SEV_CLASS[d.severity]}`}>{d.severity}</span> {d.effect}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {diff.length === 0 && <div className="tpa-empty">두 Snapshot 이 내용·상태 모두 동일합니다(hash 일치).</div>}
            </div>

            <div className="tpa-2col">
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>영향 Feature · 상품 · 시험 (S05-A02)</h3>
                <div className="tpa-strip">
                  <span className="tpa-chip"><b>{walked.length}</b>영향 관계</span>
                  <span className="tpa-chip"><b>{tests.length}</b>시험 선택</span>
                  <span className={`tpa-chip ${capRoot?.outcome === 'SELECTED' ? 'pass' : 'pending'}`}><b>{capRoot ? PROFILE_OUTCOME_KO[capRoot.outcome] : '—'}</b>Capability</span>
                </div>
                <table className="tpa-table mt">
                  <thead><tr><th>선택 시험</th><th className="wrap">결속 근거</th><th>증적</th></tr></thead>
                  <tbody>
                    {tests.map(t => {
                      const ev = M.evidence.find((e) => e.testCaseId === t);
                      return (
                        <tr key={t}>
                          <td className="mono">{t}</td>
                          <td className="wrap">verified_by · {graph.nodes.get(t)?.label ?? t}</td>
                          <td className="mono">{ev ? `${ev.result} ${ev.coverage}` : '증적 없음'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {tests.length === 0 && <div className="tpa-empty">이 Root 에서 선택되는 시험이 없습니다 — verified_by 결속 누락.</div>}
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>조건에 따른 경로와 근거 (S05-A03)</h3>
                <div className="tpa-lane">
                  {REL_VOCAB.map(v => {
                    const n = walked.filter(w => w.type === v.id).length;
                    if (n === 0) return null;
                    return (
                      <div key={v.id} className="tpa-lane-row">
                        <span className="k">{v.id}</span>
                        <span className="tpa-bar-wrap"><span className="tpa-bar" style={{ width: `${Math.max(6, (n / Math.max(1, walked.length)) * 100)}%` }} /></span>
                        <span className="num" style={{ width: 32, textAlign: 'right' }}>{n}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="tpa-chain mt">
                  {walked.filter(w => w.depth <= 2).slice(0, 8).map((w, i) => (
                    <span key={i} style={{ display: 'contents' }}>
                      <span className="node">{w.via}</span>
                      <span className="arrow">—{w.type}→</span>
                      <span className="node">{w.id}</span>
                    </span>
                  ))}
                </div>
                {walked.length === 0 && <div className="tpa-empty">경로가 없습니다.</div>}
              </div>
            </div>
          </>
        )}

        {tab === 'UI05-S06' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>정확 참조 · 객체 · 원천 · 책임 · Profile (S06-A03) — 정본 표시 열 7종</h3>
              <div className="tpa-scroll">
                <table className="tpa-table">
                  <thead>
                    <tr><th>정확 참조</th><th>객체·서비스</th><th>ECU 또는 원천</th><th>책임 주체</th><th>SDK·계약 Profile</th><th>버전</th><th className="wrap">유효성</th></tr>
                  </thead>
                  <tbody>
                    {CONTROL_POINTS.map(cp => {
                      const fb = FLAG_BINDINGS.filter(f => f.controlPointRef === cp.id);
                      const dupKey = new Map<string, number>();
                      FLAG_BINDINGS.forEach(f => { const k = `${f.controlPointRef}|${f.applicabilityRef}`; dupKey.set(k, (dupKey.get(k) ?? 0) + 1); });
                      const conflict = fb.some(f => (dupKey.get(`${cp.id}|${f.applicabilityRef}`) ?? 0) > 1);
                      const bound = graph.nodes.has(baseId(cp.bindingRef));
                      const state = conflict ? 'BD-06 조건 충돌' : !bound ? 'binding 미해석' : fb.length === 0 ? 'Binding 없음' : '유효';
                      return (
                        <tr key={cp.id}>
                          <td className="mono">{cp.id}@{cp.featureVersionRef}</td>
                          <td>{kindLabel[cp.kind]} · {roleLabel[cp.role]}<div className="small muted">{cp.valueType}{cp.unit ? ` (${cp.unit})` : ''}</div></td>
                          <td className="mono">{cp.bindingRef}<div className="small muted">accessMode {cp.accessMode}</div></td>
                          <td className="mono">{cp.flagClass?.ownerRef ?? cp.guardRef ?? '—'}</td>
                          <td className="mono">{fb.map(f => f.toolBindingRef).join(', ') || '—'}<div className="small muted">flag {fb.map(f => f.flagVersionRef).join(', ') || '—'}</div></td>
                          <td className="mono">{cp.featureVersionRef}</td>
                          <td className="wrap">
                            <span className={`tpa-tag ${conflict || !bound ? 'blocking' : fb.length === 0 ? 'warning' : 'info'}`}>{state}</span>
                            <div className="small muted">
                              적용 조건 {fb.map(f => f.applicabilityRef).join(', ') || '—'} · lifetime {cp.flagClass ? `${cp.flagClass.lifetimeDays}일` : '—'}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tpa-2col">
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>FlagBinding · RuntimeBinding 결속 (S06-A01 · A02)</h3>
                <table className="tpa-table">
                  <thead><tr><th>Binding</th><th>제어점</th><th>적용 조건</th><th className="wrap">결속</th></tr></thead>
                  <tbody>
                    {RUNTIME_BINDINGS.map(rb => (
                      <tr key={rb.id}>
                        <td className="mono">{rb.id}</td>
                        <td className="mono">{rb.controlPointRef}</td>
                        <td className="mono">{rb.applicabilityRef}</td>
                        <td className="wrap mono">
                          {rb.flagBindingRef} → {rb.bomRef} → {rb.topologyRef}
                          <div className="small muted">
                            BOM {graph.nodes.has(baseId(rb.bomRef)) ? '해석' : 'Registry 밖'} · Topology {rb.topologyRef}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tpa-note">
                  SD3-5 · UNLEASH 부모 의존성은 도구 metadata 에서 온 값을 승격하지 않는다 —
                  lifetime 이 <b>0</b> 인 kill-switch flag 는 만료 대상이 아니며 해제 시 Safe Default 로 복귀한다.
                </p>
              </div>
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>차량 실행 경로 (S06-A03)</h3>
                <div className="tpa-strip">
                  <span className="tpa-chip pass"><b>{snapshot.rollout.activatedVins.length}</b>Policy 적용</span>
                  <span className="tpa-chip pending"><b>{snapshot.rollout.binaryOtaVins.length}</b>Binary OTA</span>
                  <span className="tpa-chip"><b>{snapshot.verdicts.length}</b>판정</span>
                  <span className="tpa-chip"><b>{snapshot.convergence.counts.CONVERGED}</b>수렴</span>
                  <span className="tpa-chip"><b>{snapshot.incidents.length}</b>Incident</span>
                </div>
                <div className="tpa-chain mt">
                  <span className="node">CP(kill-switch)</span><span className="arrow">→</span>
                  <span className="node">FlagBinding</span><span className="arrow">→</span>
                  <span className="node">RuntimeBinding</span><span className="arrow">→</span>
                  <span className="node">ECU 실행</span><span className="arrow">→</span>
                  <span className="node">Reported 상태</span>
                </div>
                <p className="tpa-note">
                  다중 ECU 는 같은 제어점을 각자 실행하고 Twin 이 Reported 를 모아 수렴 여부를 판정한다 —
                  하단 런타임 토폴로지의 <b>command / report</b> 패킷이 이 경로다.
                </p>
              </div>
            </div>

            <div className="card" data-testid="tp-unleash-boundary">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>
                Unleash 도구 경계 (S06-A02 · TD §4.8) — 개정 <span className="mono">{ULOSS_REVISION}</span> · {ULOSS_REVISION_DATE}
              </h3>
              <p className="tpa-sub">
                <b>{UNLEASH_TOOL_RELATION.tool}</b> 의 <span className="mono">{UNLEASH_TOOL_RELATION.wireType}</span> 는
                <b> {UNLEASH_TOOL_RELATION.nature}</b> 다. {UNLEASH_TOOL_RELATION.rule}{' '}
                형상 기준 <span className="mono">{ULOSS_BASELINE}</span> 위에 버전 번호를 올리지 않고 개정 ID 로만 얹는다(QC-UL-01).
              </p>
              <div className="tpa-strip">
                <span className="tpa-chip"><b>{UL_SUMMARY.contracts}</b>계약 UL-OSS</span>
                <span className="tpa-chip"><b>{UL_SUMMARY.interfaces}</b>인터페이스</span>
                <span className={`tpa-chip ${UL_SUMMARY.unusedInterfaces > 0 ? 'pending' : 'pass'}`}>
                  <b>{UL_SUMMARY.unusedInterfaces}</b>미사용 인터페이스
                </span>
                <span className="tpa-chip"><b>{UL_SUMMARY.usageRows}</b>사용 판정</span>
                <span className={`tpa-chip ${UL_SUMMARY.unusedUsage > 0 ? 'pending' : 'pass'}`}>
                  <b>{UL_SUMMARY.unusedUsage}</b>미사용 · 대체 Core 결속
                </span>
                <span className="tpa-chip"><b>{UL_SUMMARY.limits}</b>무료 에디션 한계</span>
                <span className="tpa-chip pending"><b>{UL_SUMMARY.notRun}</b>NOT_RUN</span>
                <span className="tpa-chip pending"><b>{UL_SUMMARY.notRecorded}</b>NOT_RECORDED</span>
              </div>
              <table className="tpa-table mt">
                <thead><tr><th>parent payload 후보</th><th>Flag</th><th className="wrap">도구 값</th><th>판정</th><th className="wrap">FP 조치</th></tr></thead>
                <tbody>
                  {TOOL_EDGE_CANDIDATES.map(c => (
                    <tr key={c.id} data-testid={`tp-tool-candidate-${c.id}`}>
                      <td className="mono">{c.id}</td>
                      <td className="mono">{c.flag}</td>
                      <td className="wrap mono">{c.payload}<div className="small muted">{c.reason}</div></td>
                      <td><span className="tpa-tag warning">{TOOL_EDGE_VERDICT_KO[c.verdict]}</span></td>
                      <td className="wrap">{c.fpAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tpa-note">
                {UNLEASH_TOOL_RELATION.evidence} · 근거 {UNLEASH_TOOL_RELATION.refs}
              </p>
              <div className="mt" data-testid="tp-ul-contracts">
                <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                  계약 {UL_CONTRACTS.length}건 (UL-OSS-01~14) ↔ 요구사항 FR-ULOSS-001~014 1:1 (QC-UL-04)
                </h4>
                <div className="tpa-scroll">
                  <table className="tpa-table">
                    <thead>
                      <tr>
                        <th>ID</th><th className="wrap">계약</th><th className="wrap">정본 문장</th>
                        <th className="wrap">책임 Core</th><th className="wrap">요구사항 · 검증</th>
                      </tr>
                    </thead>
                    <tbody>
                      {UL_CONTRACTS.map(c => (
                        <tr key={c.id} data-fr={c.fr}>
                          <td className="mono">{c.id}</td>
                          <td className="wrap">{c.title}</td>
                          <td className="wrap small">{c.requirement}</td>
                          <td className="wrap mono small">{c.core}<div className="muted">{c.coreName}</div></td>
                          <td className="wrap small">
                            <span className="mono">{c.fr}</span>
                            <div className="muted">{c.verify}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="tpa-2col mt">
                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>외부 인터페이스 {UL_INTERFACES.length}종 (IF-FF-01~07)</h4>
                  <div className="tpa-scroll">
                    <table className="tpa-table">
                      <thead><tr><th>ID</th><th className="wrap">이름 · 방향</th><th>Core</th><th>단계</th><th className="wrap">인증 · 신선도</th></tr></thead>
                      <tbody>
                        {UL_INTERFACES.map(i => (
                          <tr key={i.id} data-unused={Boolean(i.unused)}>
                            <td className="mono">{i.id}</td>
                            <td className="wrap">{i.name}<div className="small muted">{i.mode} · {i.direction}</div></td>
                            <td className="mono">{i.core} {i.coreName}</td>
                            <td>{i.stage}</td>
                            <td className="wrap small">
                              {i.auth}<div className="muted">신선도 {i.freshness} · {i.errorIdem}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                    미실행 경계 — {UL_GAP_REF} · 결정 {UL_DECISIONS.join(' · ')}{' '}
                    <span className={`tpa-tag ${ulVerificationComplete() ? 'info' : 'warning'}`} data-testid="tp-ul-verify-state">
                      검증 완료 {String(ulVerificationComplete())}
                    </span>
                  </h4>
                  <table className="tpa-table">
                    <thead><tr><th>항목</th><th>상태</th><th className="wrap">비고</th></tr></thead>
                    <tbody>
                      {UL_VERIFICATION.map(v => (
                        <tr key={v.item}>
                          <td>{v.ko}</td>
                          <td><span className="tpa-tag warning mono">{v.state}</span></td>
                          <td className="wrap small">{v.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="tpa-note">{UL_UNRUN_NOTICE}</p>
                </div>
              </div>
              <div className="mt">
                <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>무료 에디션 한계 {UL_LIMITS.length}건과 FP 보상 책임 — 의존 판정 정본은 도구가 아니라 FP 다</h4>
                <div className="tpa-scroll">
                  <table className="tpa-table">
                    <thead><tr><th className="wrap">한계</th><th className="wrap">영향</th><th className="wrap">보상 책임 Core</th><th className="wrap">검증 증적</th></tr></thead>
                    <tbody>
                      {UL_LIMITS.map(l => (
                        <tr key={l.limit}>
                          <td className="wrap">{l.limit}</td>
                          <td className="wrap">{l.impact}</td>
                          <td className="wrap mono">{l.compensates}</td>
                          <td className="wrap">{l.evidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tpa-note">{DEPENDENCY_SOT_COMPENSATION}</p>
                <ul className="tpa-list">
                  {UL_FORBIDDEN_IN_UI.map(t => <li key={t}>{t}</li>)}
                </ul>
              </div>

              <div className="mt" data-testid="tp-ul-usage">
                <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                  사용 · 미사용 판정 {UL_USAGE.length}건 — 미사용 {UL_SUMMARY.unusedUsage}건은 대체 소유 Core 로 보상한다
                </h4>
                <div className="tpa-scroll">
                  <table className="tpa-table">
                    <thead>
                      <tr>
                        <th className="wrap">기능</th><th className="wrap">무료 에디션</th><th>판정</th>
                        <th className="wrap">근거</th><th className="wrap">대체 소유 Core</th>
                      </tr>
                    </thead>
                    <tbody>
                      {UL_USAGE.map(u => (
                        <tr key={u.feature} data-verdict={u.verdict}>
                          <td className="wrap">{u.feature}</td>
                          <td className="wrap small">{u.edition}</td>
                          <td><span className={`tpa-tag ${UL_USAGE_TONE[u.verdict]}`}>{u.verdict}</span></td>
                          <td className="wrap small">{u.reason}</td>
                          <td className="wrap mono small">{u.replacedBy ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tpa-note">
                  무료·Enterprise 기능 차이 주장의 근거 — <span className="mono">{OSS_COMPARISON_URL}</span> (QC-UL-03)
                </p>
              </div>

              <div className="tpa-2col mt">
                <div data-testid="tp-ul-role">
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>역할 경계 — 도구는 보관소 · 평가값 제공자, 정본은 FP 다</h4>
                  <table className="tpa-table">
                    <thead><tr><th className="wrap">구분</th><th className="wrap">경계</th></tr></thead>
                    <tbody>
                      <tr>
                        <td className="wrap">도구</td>
                        <td className="wrap">{ULOSS_ROLE.tool}<div className="small muted">{ULOSS_ROLE.toolNote}</div></td>
                      </tr>
                      <tr>
                        <td className="wrap">플랫폼</td>
                        <td className="wrap">{ULOSS_ROLE.platform}<div className="small muted">{ULOSS_ROLE.platformNote}</div></td>
                      </tr>
                      <tr>
                        <td className="wrap">평가 정본</td>
                        <td className="wrap">{ULOSS_ROLE.evaluationSoT}</td>
                      </tr>
                      <tr>
                        <td className="wrap">표시값 규칙</td>
                        <td className="wrap">{ULOSS_ROLE.displayValueRule}</td>
                      </tr>
                      <tr>
                        <td className="wrap">정의 수집</td>
                        <td className="wrap">
                          {UL_COLLECTION_OWNER}
                          <div className="small muted">
                            Webhook 사용 {String(UL_WEBHOOK_USED)} — 변경 통보 경로가 도구에서 오지 않는다
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div data-testid="tp-ul-boundaries">
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                    화면 경계 {UL_SCREEN_BOUNDARIES.length}건 (QC-UL-07)
                  </h4>
                  <table className="tpa-table">
                    <thead><tr><th className="wrap">화면</th><th className="wrap">이 화면이 보는 범위</th></tr></thead>
                    <tbody>
                      {UL_SCREEN_BOUNDARIES.map(b => (
                        <tr key={b.screenId}>
                          <td className="wrap">
                            <span className="mono">{b.screenId}</span> {b.ko}
                            <div className="small muted">{b.group}</div>
                          </td>
                          <td className="wrap small">{b.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="tpa-2col mt">
                <div data-testid="tp-ul-source">
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>출처 정본 — 수집한 정의의 실측 식별자 (QC-UL-02)</h4>
                  <table className="tpa-table">
                    <thead><tr><th className="wrap">항목</th><th className="wrap">값</th></tr></thead>
                    <tbody>
                      {SOURCE_PROVENANCE.map(r => (
                        <tr key={r.ko}>
                          <td>{r.ko}</td>
                          <td className="wrap mono">
                            {r.value}
                            {r.value === 'NOT_RUN' || r.value === 'NOT_RECORDED'
                              ? <span className="tpa-tag warning" style={{ marginLeft: 6 }}>{r.value}</span>
                              : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div data-testid="tp-ul-criteria">
                  <h4 style={{ fontSize: 13, margin: '0 0 6px' }}>
                    품질 기준 {UL_CRITERIA.length}건 · 감사 항목 {UL_AUDIT_CHECK_COUNT}건 (QC-UL-01~07)
                  </h4>
                  <ul className="tpa-list">
                    {UL_CRITERIA.map(c => (
                      <li key={c.id}>
                        <span className="mono">{c.id}</span> <b>{c.ko}</b> — {c.condition}
                        <span className="small muted"> 적용 {c.applies}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="tpa-note">
                    감사 항목 {UL_AUDIT_CHECK_COUNT}건 원본 <span className="mono">{UL_AUDIT_JSON}</span><br />
                    연결 문서·도면 — {UL_LINKED_DOCS.map(d => `${d.ko} ${d.value}`).join(' · ')}
                    {UL_DIAGRAMS.length > 0 ? ` · 도면 ${UL_DIAGRAMS.map(d => d.file.split('/').pop()).join(', ')}` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="card" data-testid="tp-segment-impact">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>SegmentVersion 변경 영향역탐색 (TD §4.8) — FlagBinding → Policy → Offering → Release</h3>
              <p className="tpa-sub">
                SegmentVersion 이 바뀌면 그 값을 읽는 단계를 <b>역방향으로</b> 따라가 전체 영향 목록을 확보한다.
                확보하지 못한 단계는 0건으로 지어내지 않고 <b>frontier</b> 로 남기며, 목록이 완전하지 않으면 새 검토를 제출하지 않는다.
                승인 Snapshot 은 live Segment 를 읽지 않는다 —{' '}
                <span className="mono">APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT={String(APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT)}</span>.
              </p>
              <div className="tpa-strip">
                <span className="tpa-chip"><b className="mono">{contract.impact.segmentRef}</b>SegmentVersion</span>
                <span className={`tpa-chip ${contract.impact.complete ? 'pass' : 'pending'}`}>
                  <b>{String(contract.impact.complete)}</b>complete
                </span>
                <span className={`tpa-chip ${contract.impact.frontier.length > 0 ? 'pending' : 'pass'}`}>
                  <b>{contract.impact.frontier.length}</b>frontier
                </span>
                {contract.impact.frontier.map(f => (
                  <span key={f} className="tpa-chip pending"><b className="mono">{f}</b>{SEGMENT_STAGE_KO[f].ko} 미확보</span>
                ))}
              </div>
              <div className="tpa-impact">
                {contract.impact.rows.map(r => (
                  <div key={r.stage} className={`tpa-impact-row ${r.linked ? 'linked' : 'open'}`} data-testid={`tp-segment-${r.stage}`}>
                    <div className="head">
                      <span className="stage mono">{r.stage}</span>
                      <span className="ko">{SEGMENT_STAGE_KO[r.stage].ko}</span>
                      <span className={`tpa-tag ${r.linked ? 'info' : 'warning'}`}>
                        {r.linked ? `사용처 ${r.found.length}건` : '원천 미연결'}
                      </span>
                    </div>
                    <div className="body">
                      <div className="mono small">{r.found.length > 0 ? r.found.join(', ') : '—'}</div>
                      <div className="small muted">책임 {SEGMENT_STAGE_KO[r.stage].owner}</div>
                      <div className="small">{r.note}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="tpa-note">{contract.impact.notice}</p>
            </div>
          </>
        )}

        {tab === 'UI05-S07' && (
          <>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>Import 후보를 관계 그래프로 검토 (S07-A01)</h3>
              <form className="tpa-form" onSubmit={e => { e.preventDefault(); toast(`검증 완료 — 통과 ${imports.filter(r => r.applyable).length}건 / 차단 ${imports.filter(r => !r.applyable).length}건`, 'ok'); }}>
                <label className="full">원천 CSV (source,type,target — 정확 버전은 target@version)
                  <textarea value={importText} onChange={e => setImportText(e.target.value)} spellCheck={false} />
                </label>
                <div className="tpa-actions full">
                  <button className="btn" type="submit">검증 실행</button>
                  <button className="btn primary" type="button" onClick={applyImports}>통과 행만 관계로 반영</button>
                  <span className="tpa-note">
                    통과 {imports.filter(r => r.applyable).length}건 · 차단 {imports.filter(r => !r.applyable).length}건
                    (미해석·중복·자기 참조·사전 외는 반영하지 않는다)
                  </span>
                </div>
              </form>
              <div className="tpa-scroll mt">
                <table className="tpa-table">
                  <thead><tr>{IMPORT_COLUMNS.map((c, i) => <th key={c} className={i === 5 ? 'wrap' : ''}>{c}</th>)}</tr></thead>
                  <tbody>
                    {imports.map(r => (
                      <tr key={r.line}>
                        <td className="num">{r.line}</td>
                        <td className="mono">source,type,target</td>
                        <td className="mono">{r.source} · {r.type} · {r.target}</td>
                        <td className="mono">{r.version ? `${r.target}@${r.version}` : r.target}</td>
                        <td>
                          <span className={`tpa-tag ${r.applyable ? 'info' : r.check === 'DANGLING_TARGET' || r.check === 'DANGLING_SOURCE' ? 'blocking' : 'warning'}`}>
                            {IMPORT_CHECK_KO[r.check]}
                          </span>
                        </td>
                        <td className="wrap">{r.remedy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {imports.length === 0 && <div className="tpa-empty">검증할 행이 없습니다 — CSV 를 붙여넣으세요.</div>}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>의미가 다른 관계의 자동 변환 금지 (S07-A03)</h3>
              <p className="tpa-sub">
                아래 원천 타입은 정본 15종과 <b>이름이 다르다</b>. 시스템은 후보만 제시하고 실제 변환은 사람이 확인해
                재입력한다 — 자동 매핑하면 의미가 다른 관계가 조용히 섞이기 때문이다(TD 4.4 · GAP GAP-03).
              </p>
              <table className="tpa-table">
                <thead><tr><th>원천 타입</th><th>건수</th><th>의미상 후보</th><th className="wrap">처리</th></tr></thead>
                <tbody>
                  {[...usage.unmapped.entries()].map(([t, n]) => (
                    <tr key={t}>
                      <td className="mono">{t}</td>
                      <td className="num">{n}</td>
                      <td className="mono">{REL_UNMAPPED_HINT[t] ?? '없음'}</td>
                      <td className="wrap">{REL_UNMAPPED_HINT[t] ? '사람 확인 후 재입력 — 자동 반영 차단' : '대응 후보 없음 — 관계 정의 검토 요청'}</td>
                    </tr>
                  ))}
                  {[...usage.counts.entries()].filter(([, n]) => n === 0).map(([t]) => (
                    <tr key={t}>
                      <td className="mono">{t}</td>
                      <td className="num">0</td>
                      <td className="mono">—</td>
                      <td className="wrap">사전에는 있으나 이 그래프에서 사용 0건 — 미구현 관계</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------- 하단: Twin 런타임 */}
      <ArchitectureFlow snapshot={snapshot} lang={l10n} />

      <section className="tpa-panel">
        <header>
          <h3>두 계층이 같은 클럭을 쓰는 이유</h3>
          <span className="tpa-ref">revision {snapshot.revision}</span>
        </header>
        <p className="tpa-sub">
          상단 엔진은 <b>Feature Topology 스냅샷</b>을 만들고, 하단 런타임은 그 스냅샷의 제어점·관계를 차량에서 실행한다.
          두 계층이 다른 시각을 쓰면 “관계를 바꾼 시점”과 “차량이 보고한 시점”을 비교할 수 없으므로
          <b> 하나의 시뮬레이터 클럭</b>(현재 {clock.text}, tick {snapshot.clock.simTick}, rate ×{snapshot.clock.rate})을 공유한다.
          위 클럭 버튼을 ×0 으로 두면 파이프라인 패킷과 런타임 패킷이 <b>동시에</b> 멈추고, ×5 로 올리면 함께 빨라진다.
        </p>
        <div className="tpa-strip">
          <span className="tpa-chip"><b>{TP_STAGE_ORDER.length}</b>엔진 단계</span>
          <span className="tpa-chip pass"><b>{model.stages.filter(s => s.tone === 'pass').length}</b>PASS</span>
          <span className="tpa-chip pending"><b>{model.stages.filter(s => s.tone === 'pending').length}</b>REVIEW</span>
          <span className={`tpa-chip ${model.stages.some(s => s.tone === 'fail') ? 'fail' : 'pass'}`}><b>{model.stages.filter(s => s.tone === 'fail').length}</b>BLOCK</span>
          <span className="tpa-chip"><b>{snapshot.clock.rate === 0 ? 'PAUSED' : 'LIVE'}</b>두 계층 동기</span>
        </div>
      </section>
    </div>
  );
}

/** 영역 → 강조할 엔진 단계 (탭 선택 시 파이프라인에서 해당 단계를 강조한다). */
export function stageOfArea(areaId: string): TpStageId {
  switch (areaId) {
    case 'UI05-S01': return 'snapshot';
    case 'UI05-S02': return 'graph';
    case 'UI05-S03': return 'validate';
    case 'UI05-S04': return 'capability';
    case 'UI05-S05': return 'impact';
    case 'UI05-S06': return 'impact';
    case 'UI05-S07': return 'graph';
    default: return 'registry';
  }
}

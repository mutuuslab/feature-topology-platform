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
import type { CSSProperties, JSX } from 'react';
import { useMemo, useState } from 'react';
import { Bars, Donut } from '../components/charts';
import { simClockLabel } from '../components/liveMonitor';
import { SpecAreaFacts } from '../components/SpecAreaFacts';
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
  { ko: '구현 산출물 결속', dir: 'Feature → 산출물', stage: 'REQUIRED', from: ['implemented_by'], gate: 'R06' },
  { ko: '시험·증적 결속', dir: 'Feature → 시험', stage: 'REQUIRED', from: ['verified_by'], gate: 'R07' },
  { ko: '운행 관측 결속', dir: 'Feature → 관측점', stage: 'ADVISORY', from: [], gate: 'R07' },
  { ko: '배포 대상 결속', dir: 'Feature → ECU/배포 단위', stage: 'REQUIRED', from: ['deployed_as'], aliasOf: 'deployed_as', gate: 'R08' },
  { ko: '정책·제어점 통제', dir: 'Feature → 제어점', stage: 'REQUIRED', from: ['controlled_by'], aliasOf: 'controlled_by', gate: 'R09' },
  { ko: '신호·이벤트 방출', dir: 'Feature → 신호', stage: 'CONDITIONAL', from: ['emits_event'], aliasOf: 'emits_event', gate: 'R10' },
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
  realized_by: 'implemented_by',
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
  source: string;
  target: string;
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
    if (!n) { n = { id, kind: 'External', label: id }; nodes.set(id, n); }
    return n;
  };

  const links: TpLink[] = [];
  const add = (p: { id: string; source: string; target: string; type: string; origin: 'edge' | 'relation'; criticality?: string; safeDefault?: string }) => {
    links.push({
      ...p,
      key: `${p.source}|${p.type}|${p.target}`,
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

/** 구현·배포·시험·통제 역할 — 값이 아니라 **역할의 존재**를 본다(DD-03-5). */
export const CAPABILITY_ROLES: { id: string; ko: string; types: string[] }[] = [
  { id: 'impl', ko: '구현', types: ['implemented_by', 'realized_by'] },
  { id: 'deploy', ko: '배포', types: ['deployed_as', 'deployed_on'] },
  { id: 'verify', ko: '시험', types: ['verified_by'] },
  { id: 'control', ko: '통제', types: ['controlled_by', 'governed_by'] },
];

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

export function evaluateCapability(graph: TopologyGraph, g: TopologyInput): CapabilityRow[] {
  return g.features.map(f => {
    const from = capabilityRoots(graph, f.id);
    const byRole: Record<string, string[]> = {};
    for (const name of CAPABILITY_ROLES) byRole[name.id] = [];
    for (const root of from) {
      for (const l of graph.out.get(root) ?? []) {
        for (const name of CAPABILITY_ROLES) {
          if (name.types.includes(l.type) && !byRole[name.id].includes(l.target)) byRole[name.id].push(l.target);
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
      ? `역할 ${CAPABILITY_ROLES.length}종 모두 결속 · 구현 참조 ${targets.length}건`
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
  stage: 'graph' | 'validate' | 'snapshot' | 'capability';
}

const FINDING_META: Record<string, { severity: Severity; remedy: string; refs: string; stage: TpFinding['stage'] }> = {
  DANGLING_REFERENCE: { severity: 'BLOCKING', remedy: '원천 객체를 Registry 에 등록하거나 참조를 제거한 뒤 재적재', refs: 'TD 4.2 · IA-R06', stage: 'graph' },
  SELF_REFERENCE: { severity: 'BLOCKING', remedy: '자기 참조 관계 삭제', refs: 'TD 4.4', stage: 'validate' },
  DUPLICATE_RELATION: { severity: 'BLOCKING', remedy: '중복 선언 제거 — 같은 방향·같은 종류는 1건만', refs: 'TD 4.5', stage: 'validate' },
  RELATION_CONFLICT: { severity: 'BLOCKING', remedy: 'requires/excludes 를 조건 Profile 로 분리', refs: 'TD 4.6', stage: 'validate' },
  CYCLE: { severity: 'BLOCKING', remedy: '순환 참조 해소 — 계층 관계는 DAG 여야 함', refs: 'TD 4.6 · SW DD-03-4', stage: 'validate' },
  UNMAPPED_RELATION_TYPE: { severity: 'WARNING', remedy: '사전 항목으로 사람이 확인 후 재입력(자동 변환 금지)', refs: 'TD 4.4 · GAP-03', stage: 'validate' },
  UNPINNED_VERSION: { severity: 'WARNING', remedy: '정확 버전 pin 지정 — latest·범위 표현 금지', refs: 'TD 4.5', stage: 'validate' },
  MISSING_REQUIRED_RELATION: { severity: 'BLOCKING', remedy: '누락 관계 등록 후 단계 전환', refs: 'TD 4.2 · C14', stage: 'capability' },
  ORPHAN_NODE: { severity: 'WARNING', remedy: '관계 미연결 노드 — 등록 취소 또는 결속 추가', refs: 'TD 4.3', stage: 'graph' },
  RETIRED_REFERENCED: { severity: 'WARNING', remedy: 'Retired 노드 참조는 replaces/fallback_to 로만 허용', refs: 'TD 4.2', stage: 'validate' },
  SNAPSHOT_NODE_MISSING: { severity: 'BLOCKING', remedy: '기준선 BOM_Topology_MISMATCH 해소 후 동결', refs: 'TD 4.5 · C03', stage: 'snapshot' },
  BINDING_CONFLICT: { severity: 'BLOCKING', remedy: '동일 제어점·동일 적용 조건의 두 번째 Binding 제거', refs: 'DD-03-4 · BD-06', stage: 'capability' },
};

const mkFinding = (code: string, subject: string, detail: string): TpFinding => {
  const meta = FINDING_META[code];
  return { code, subject, detail, ...meta };
};

/** 사전에 있는 계층 관계 — 순환 판정 대상. */
const LAYER_REL_TYPES = ['parent_of', 'composed_of', 'child_of', 'derives', 'requires'];

export function validateTopology(graph: TopologyGraph, g: TopologyInput, baselines: BomBaseline[]): TpFinding[] {
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
    if (refVersion(l.target) === '' && graph.nodes.get(l.target)?.kind === 'Feature') {
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

  // (7) Binding 충돌 — 같은 제어점·같은 적용 조건에 두 번째 Binding
  const fbKey = new Map<string, string>();
  for (const fb of FLAG_BINDINGS) {
    const k = `${fb.controlPointRef}|${fb.applicabilityRef}`;
    if (fbKey.has(k)) {
      out.push(mkFinding('BINDING_CONFLICT', k, `${fbKey.get(k)} 와 ${fb.id} 가 같은 제어점·같은 적용 조건을 점유`));
    } else fbKey.set(k, fb.id);
  }

  // (8) Capability 필수 역할 누락
  for (const row of evaluateCapability(graph, g)) {
    if (row.missing.length > 0) {
      out.push(mkFinding('MISSING_REQUIRED_RELATION', row.root, `역할 누락 ${row.missing.join(', ')} — ${row.outcome}`));
    }
  }
  return out;
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

export function walkGraph(graph: TopologyGraph, root: string, maxDepth = 3): WalkRow[] {
  const seen = new Set<string>([root]);
  const rows: WalkRow[] = [];
  const dedupe = new Set<string>();
  let frontier = [root];
  for (let d = 1; d <= maxDepth && frontier.length > 0 && rows.length < 400; d++) {
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
        rows.push({ id: s.id, depth: d, via: cur, type: s.type, direction: s.direction, kind: graph.nodes.get(s.id)?.kind ?? 'External' });
        if (!seen.has(s.id) && (graph.nodes.get(s.id)?.kind === 'Feature' || graph.nodes.get(s.id)?.kind === 'Artifact')) {
          seen.add(s.id);
          next.push(s.id);
        }
      }
    }
    frontier = next;
  }
  return rows;
}

/** 시험 선택 — 영향 노드에서 `verified_by` 로 도달하는 시험·증적 산출물. */
export function selectTests(graph: TopologyGraph, roots: string[]): string[] {
  const hits = new Set<string>();
  for (const root of roots) {
    for (const l of graph.out.get(root) ?? []) if (l.type === 'verified_by') hits.add(l.target);
    for (const row of walkGraph(graph, root, 3)) {
      if (row.type === 'verified_by') hits.add(row.id);
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
  title: string;
  core: string;
  refs: string;
  rows: TpStageRow[];
  total: number;
  tone: Tone;
  blockedBy?: string;
  blockedReason?: string;
}
export interface TpModel { stages: TpStage[]; width: number; height: number }

export const TP_COL_W = 168;
export const TP_COL_GAP = 34;
export const TP_PAD = 20;
export const TP_HEAD_H = 46;
export const TP_ROW_H = 30;
export const TP_BOTTOM_H = 18;
export const TP_MAX_ROWS = 5;
export const TP_VIEW_W = TP_PAD * 2 + 6 * TP_COL_W + 5 * TP_COL_GAP;
export const TP_VIEW_H = TP_HEAD_H + TP_MAX_ROWS * TP_ROW_H + TP_BOTTOM_H;
export const tpColX = (i: number): number => TP_PAD + i * (TP_COL_W + TP_COL_GAP);
export const TP_ROW_Y = TP_HEAD_H + 14;

export function buildTopologyModel(args: {
  g: TopologyInput;
  graph: TopologyGraph;
  baselines: BomBaseline[];
  snapshots: TpSnapshot[];
  findings: TpFinding[];
  capability: CapabilityRow[];
  root: string;
  tests: string[];
}): TpModel {
  const { graph, g, snapshots, findings, capability, root, tests } = args;

  const blocking = countSeverity(findings, 'BLOCKING');
  const warning = countSeverity(findings, 'WARNING');
  const dangling = findings.filter(f => f.code === 'DANGLING_REFERENCE').length;
  const cycles = findings.filter(f => f.code === 'CYCLE').length;
  const dups = findings.filter(f => f.code === 'DUPLICATE_RELATION').length;
  const unmapped = findings.filter(f => f.code === 'UNMAPPED_RELATION_TYPE').length;
  const orphan = findings.filter(f => f.code === 'ORPHAN_NODE').length;
  const missingPins = snapshots.reduce((n, s) => n + s.missing.length, 0);
  const frozen = snapshots.filter(s => s.kind === 'BASELINE' && s.state === 'APPROVED').length;
  const byOutcome = (o: ProfileOutcome) => capability.filter(c => c.outcome === o).length;
  const capRoot = capability.find(c => c.root === root);
  const impactRows = walkGraph(graph, root, 3);
  const impactFeatures = [...new Set(impactRows.filter(r => r.kind === 'Feature').map(r => r.id))];

  const stageSeed: Array<Omit<TpStage, 'title' | 'core' | 'refs'>> = [
    {
      id: 'registry', index: 0, tone: g.features.length > 0 ? 'pass' : 'fail', total: g.features.length,
      rows: [
        { label: 'Feature 정의', value: `${g.features.length}건`, tone: g.features.length > 0 ? 'pass' : 'fail' },
        { label: 'Lifecycle', value: [...new Set(g.features.map(f => f.lifecycle))].length + '종', tone: 'info' },
        { label: '정확 버전 pin', value: `${g.features.filter(f => f.baselineVer).length}건`, tone: 'info' },
        { label: 'Retired', value: `${g.features.filter(f => f.lifecycle === 'Retired').length}건`, tone: 'pending' },
        { label: 'Registry 계약', value: 'SW 4.2', tone: 'muted' },
      ],
    },
    {
      id: 'graph', index: 1, tone: dangling > 0 ? 'fail' : 'pass', total: graph.nodes.size,
      rows: [
        { label: '노드', value: `${graph.nodes.size}개`, tone: 'pass' },
        { label: '관계', value: `${graph.links.length}건`, tone: 'pass' },
        { label: '해석 불가 참조', value: `${dangling}건`, tone: dangling > 0 ? 'fail' : 'pass' },
        { label: '미연결 노드', value: `${orphan}건`, tone: orphan > 0 ? 'pending' : 'pass' },
        { label: 'Artifact', value: `${[...graph.nodes.values()].filter(n => n.kind === 'Artifact').length}개`, tone: 'info' },
      ],
    },
    {
      id: 'validate', index: 2,
      tone: blocking > 0 ? 'fail' : warning > 0 ? 'pending' : 'pass',
      total: blocking + warning,
      rows: [
        { label: 'BLOCKING', value: `${blocking}건`, tone: blocking > 0 ? 'fail' : 'pass' },
        { label: 'WARNING', value: `${warning}건`, tone: warning > 0 ? 'pending' : 'pass' },
        { label: '순환', value: `${cycles}건`, tone: cycles > 0 ? 'fail' : 'pass' },
        { label: '중복 선언', value: `${dups}건`, tone: dups > 0 ? 'fail' : 'pass' },
        { label: '사전 외 타입', value: `${unmapped}건`, tone: unmapped > 0 ? 'pending' : 'pass' },
      ],
    },
    {
      id: 'snapshot', index: 3, tone: missingPins > 0 ? 'fail' : 'pass', total: snapshots.length,
      rows: [
        { label: 'Snapshot', value: `${snapshots.length}건`, tone: 'pass' },
        { label: '동결(APPROVED)', value: `${frozen}건`, tone: 'info' },
        { label: '작업본 노드', value: `${snapshots[0]?.nodes.length ?? 0}개`, tone: 'info' },
        { label: '미해석 pin', value: `${missingPins}건`, tone: missingPins > 0 ? 'fail' : 'pass' },
        { label: 'LIVE hash', value: shortDigest(snapshots[0]?.hash ?? '', 10), tone: 'muted' },
      ],
    },
    {
      id: 'capability', index: 4,
      tone: byOutcome('CONFIG_CONFLICT') > 0 ? 'fail' : byOutcome('UNVERIFIED') > 0 ? 'pending' : 'pass',
      total: capability.length,
      rows: [
        { label: 'SELECTED', value: `${byOutcome('SELECTED')}건`, tone: 'pass' },
        { label: 'UNVERIFIED', value: `${byOutcome('UNVERIFIED')}건`, tone: byOutcome('UNVERIFIED') > 0 ? 'pending' : 'pass' },
        { label: 'CONFIG_CONFLICT', value: `${byOutcome('CONFIG_CONFLICT')}건`, tone: byOutcome('CONFIG_CONFLICT') > 0 ? 'fail' : 'pass' },
        { label: 'NOT_SUPPORTED', value: `${byOutcome('NOT_SUPPORTED')}건`, tone: byOutcome('NOT_SUPPORTED') > 0 ? 'pending' : 'pass' },
        { label: '평가 대상', value: root, tone: capRoot?.outcome === 'SELECTED' ? 'pass' : 'pending' },
      ],
    },
    {
      id: 'impact', index: 5, tone: tests.length > 0 ? 'pass' : 'pending', total: impactRows.length,
      rows: [
        { label: '영향 노드', value: `${impactRows.length}개`, tone: 'info' },
        { label: '영향 Feature', value: `${impactFeatures.length}개`, tone: 'info' },
        { label: '선택 시험', value: `${tests.length}건`, tone: tests.length > 0 ? 'pass' : 'pending' },
        { label: '경로 깊이', value: '≤3', tone: 'muted' },
        { label: '근거', value: 'TD 4.7', tone: 'muted' },
      ],
    },
  ];

  const stages: TpStage[] = stageSeed.map((s) => ({
    ...s,
    title: TP_STAGE_META[s.id].ko,
    core: TP_STAGE_META[s.id].core,
    refs: TP_STAGE_META[s.id].refs,
  }));

  // 실패 단계 뒤의 단계는 진행하지 않는다 — 앞 단계 산출물을 입력으로 쓰기 때문이다.
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    if (prev.tone === 'fail') {
      stages[i].blockedBy = prev.id;
      stages[i].blockedReason = `${TP_STAGE_META[prev.id].ko} 실패 — 입력 미확정`;
      stages[i].tone = 'fail';
    }
  }

  return { stages, width: TP_VIEW_W, height: TP_VIEW_H };
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
  const usage = useMemo(() => relationUsage(graph), [graph]);
  const snapshots = useMemo(() => buildSnapshots(graph, state.bomBaselines, state.audit[0]?.ts ?? '—'), [graph, state.bomBaselines, state.audit]);
  const findings = useMemo(() => validateTopology(graph, input, state.bomBaselines), [graph, input, state.bomBaselines]);
  const capability = useMemo(() => evaluateCapability(graph, input), [graph, input]);
  const tests = useMemo(() => selectTests(graph, capabilityRoots(graph, root)), [graph, root]);
  const walked = useMemo(() => walkGraph(graph, root, 3), [graph, root]);
  const model = useMemo(
    () => buildTopologyModel({ g: input, graph, baselines: state.bomBaselines, snapshots, findings, capability, root, tests }),
    [input, graph, state.bomBaselines, snapshots, findings, capability, root, tests],
  );
  const imports = useMemo(() => parseImport(importText, graph), [importText, graph]);
  const dupConditions = useMemo(() => duplicateConditionPairs(), []);
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
      {/* -------------------------------------------------------------- 헤더 */}
      <div className="tpa-head">
        <div className="tpa-head-title">
          <h2>Topology 동작 메커니즘</h2>
          <span className="tpa-head-sub">
            UI05 · 구성과 PLM · C14 Feature Topology · 정본 Feature_Topology_Definition v0.8 / SW DD-03-5
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
          <span className="tpa-ref">{TP_STAGE_ORDER.map(s => SPEC_CORE_LABEL[TP_STAGE_META[s].core]).filter(Boolean).join(' · ')}</span>
        </header>
        <div className="tpa-scroll">
          <svg className="tpa-svg" viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-label="Feature Topology 엔진 파이프라인">
            {model.stages.map((st, i) => {
              const x = tpColX(i);
              const active = tab.startsWith('UI05-') && TP_STAGE_ORDER[i] === stageOfArea(tab);
              return (
                <g key={st.id} data-testid={`tp-stage-${st.id}`} data-tone={st.tone} data-blocked={Boolean(st.blockedBy)} transform={`translate(${x},0)`}>
                  <rect className={`tpa-band-bg ${st.tone === 'fail' ? 'blocked' : ''} ${active ? 'active' : ''}`} x={0} y={0} width={TP_COL_W} height={TP_VIEW_H} rx={10} />
                  <text className="tpa-stage-title" x={12} y={20}>{st.title}</text>
                  <text className="tpa-stage-core" x={12} y={34}>{SPEC_CORE_LABEL[st.core] ?? st.core} · {st.refs}</text>
                  {st.rows.map((r, ri) => (
                    <g key={r.label} transform={`translate(12,${TP_ROW_Y + ri * TP_ROW_H})`}>
                      <circle className={`tpa-tone-${r.tone}`} cx={4} cy={-4} r={3.4} />
                      <text className="tpa-row-label" x={14} y={0}>{r.label}</text>
                      <text className="tpa-row-value" x={14} y={12}>{r.value}</text>
                    </g>
                  ))}
                  <text className={`tpa-stage-count tpa-tone-${st.tone}`} x={12} y={TP_VIEW_H - 6}>
                    {st.total}건 · {st.tone === 'pass' ? 'PASS' : st.tone === 'pending' ? 'REVIEW' : 'BLOCK'}
                  </text>
                  {st.blockedBy && (
                    <text className="tpa-stage-blocked" x={12} y={TP_VIEW_H - 18}>⛔ {st.blockedReason}</text>
                  )}
                </g>
              );
            })}
            {model.stages.slice(0, -1).map((st, i) => {
              const x1 = tpColX(i) + TP_COL_W;
              const x2 = tpColX(i + 1);
              const next = model.stages[i + 1];
              const blocked = Boolean(next.blockedBy);
              return (
                <g key={`link-${st.id}`} data-testid={`tp-link-${st.id}-${next.id}`} data-blocked={blocked}>
                  <line className={`tpa-flow-line ${blocked ? 'blocked' : ''}`} x1={x1} y1={TP_ROW_Y + 6} x2={x2} y2={TP_ROW_Y + 6} />
                  <circle
                    className={`tpa-packet tpa-tone-${next.tone}`}
                    cx={x1} cy={TP_ROW_Y + 6} r={3.6}
                    data-paused={paused} data-blocked={blocked}
                    style={{
                      '--tpa-dx': `${x2 - x1}px`,
                      animationDuration: `${paused ? 0 : 900 / Math.max(1, snapshot.clock.rate)}ms`,
                      animationDelay: `${i * 120}ms`,
                      animationPlayState: blocked ? 'paused' : paused ? 'paused' : 'running',
                    } as CSSProperties}
                  />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="tpa-strip">
          <span className="tpa-chip"><b>{graph.nodes.size}</b>노드</span>
          <span className="tpa-chip"><b>{graph.links.length}</b>관계</span>
          <span className={`tpa-chip ${blocking > 0 ? 'fail' : 'pass'}`}><b>{blocking}</b>BLOCKING</span>
          <span className={`tpa-chip ${warning > 0 ? 'pending' : 'pass'}`}><b>{warning}</b>WARNING</span>
          <span className="tpa-chip"><b>{capability.filter(c => c.outcome === 'SELECTED').length}</b>Capability SELECTED</span>
          <span className="tpa-chip"><b>{tests.length}</b>선택 시험</span>
          <span className="tpa-chip"><b>{shortDigest(snapshots[0]?.hash ?? '', 10)}</b>LIVE snapshot hash</span>
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S01" />
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S02" />
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
                  return (
                    <div key={v.id} className={`tpa-vocab-card ${n === 0 ? 'zero' : ''}`} data-testid={`vocab-${v.id}`}>
                      <div className="id">{v.id}</div>
                      <div className="ko">{v.ko}</div>
                      <div className="meta">{v.dir} · {STAGE_KO[v.stage]} · 판정 {v.gate}</div>
                      <div className="meta">원천 {src}{v.aliasOf ? ` (별칭 ${v.aliasOf})` : ''} · 사용 {n}건</div>
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S03" />
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
                <Bars data={findings.reduce<Record<string, number>>((acc, f) => { acc[f.code] = (acc[f.code] ?? 0) + 1; return acc; }, {})} />
                <p className="tpa-note mt">
                  BLOCKING <b>{blocking}</b>건 / WARNING <b>{warning}</b>건 — BLOCKING 이 남아 있으면 상단 파이프라인의
                  Snapshot 동결·Capability 평가 단계가 진행되지 않는다.
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
                </div>
              </div>
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
                  <thead><tr><th>단계</th><th>코드</th><th>대상</th><th className="wrap">상세</th><th className="wrap">보완 안내</th><th>근거</th></tr></thead>
                  <tbody>
                    {findings.slice(0, 60).map((f, i) => (
                      <tr key={`${f.code}-${i}`}>
                        <td className="mono">{f.stage}</td>
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S04" />
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S05" />
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S06" />
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

            <SpecAreaFacts uiId="UI05" areaId="UI05-S07" />
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

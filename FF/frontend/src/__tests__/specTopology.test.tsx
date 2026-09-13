/**
 * UI05 Topology 와 변경 영향 — 엔진 순수 함수 + 화면 계약.
 *
 * 이 화면의 계약은 "보기 좋게 그려진다"가 아니라 **실측 데이터 위에서 계산이 돈다**는 것이다.
 * 그래서 순수 함수는 `model.ts` 의 실제 Feature/Edge/Relation 과 store 초기 상태(BOM 기준선)로 검증하고,
 * 화면은 실제 Provider 스택(MemoryRouter + AppProvider + TwinProvider) 위에서 검증한다.
 *
 * 렌더러가 판정하지 않는다는 원칙도 여기서 고정한다 — 6단계의 톤/차단은 전부 순수 함수 결과와 일치해야 한다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, initial, useApp } from '../store';
import { TwinProvider } from '../state/twinStore';
import * as M from '../data/model';
import { SPEC_TOPOLOGY_RELATIONS } from '../data/specNav';
import { BOM_CONDITION_PROFILES, type ConditionRow } from '../data/featureBom';
import {
  IMPORT_COLUMNS,
  REL_BY_ID,
  REL_UNMAPPED_HINT,
  REL_VOCAB,
  TP_MAX_ROWS,
  TP_STAGE_INPUTS,
  TP_STAGE_META,
  TP_STAGE_ORDER,
  TP_STAGE_SHORT,
  CORE_LEGEND,
  TopologyArch,
  baseId,
  bindingConflicts,
  bomScopeFeatureIds,
  buildSnapshots,
  buildTopologyGraph,
  buildTopologyModel,
  capabilityRoots,
  countSeverity,
  diffSnapshots,
  duplicateConditionPairs,
  evaluateCapability,
  parseImport,
  relationUsage,
  selectTests,
  snapshotHash,
  stageOfArea,
  validateTopology,
  walkGraph,
  walkImpact,
  type TopologyGraph,
  type TopologyInput,
} from '../pages/topologyArch';

afterEach(() => cleanup());

// ── 실측 입력 ───────────────────────────────────────────────────────────────
const REAL_INPUT: TopologyInput = { features: M.features, edges: M.edges, relations: M.relations };
const REAL_GRAPH = buildTopologyGraph(REAL_INPUT);

/** 조건 축 8종 — 중복 조건 판정에 쓰는 축과 같은 목록. */
const AXES: (keyof ConditionRow)[] = ['market', 'model', 'modelYear', 'trim', 'option', 'hw', 'sw', 'upgvc'];

function feat(id: string, extra: Partial<M.Feature> = {}): M.Feature {
  return {
    id, level: 'L2', displayName: id, domain: 'Test', ownerOrg: 'QA',
    lifecycle: 'Approved', safety: 'QM', security: 'Low', deployType: 'Policy-only', ...extra,
  };
}

/** 순환 · 자기참조 · 중복 · requires↔excludes 충돌을 모두 담은 합성 입력. */
function synth(): { g: TopologyInput; graph: TopologyGraph } {
  const g: TopologyInput = {
    features: [feat('A'), feat('B'), feat('C')],
    edges: [
      { id: 'x1', source: 'A', target: 'B', type: 'parent_of' },
      { id: 'x2', source: 'B', target: 'A', type: 'parent_of' },   // 순환
      { id: 'x3', source: 'A', target: 'C', type: 'requires' },
      { id: 'x4', source: 'A', target: 'C', type: 'excludes' },    // 충돌
      { id: 'x5', source: 'A', target: 'B', type: 'parent_of' },   // 중복
      { id: 'x6', source: 'C', target: 'C', type: 'parent_of' },   // 자기 참조
    ],
    relations: [{ id: 'y1', source: 'A', target: 'T-HIL-1', type: 'verified_by' }],
  };
  return { g, graph: buildTopologyGraph(g, []) };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 관계 사전 — 정본 15종
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 관계 사전', () => {
  it('정본 15종의 id·순서를 그대로 쓰고 각 항목에 한국어명·판정 게이트가 있다', () => {
    expect(REL_VOCAB.map(v => v.id)).toEqual([...SPEC_TOPOLOGY_RELATIONS]);
    expect(REL_VOCAB).toHaveLength(15);
    expect(REL_BY_ID.size).toBe(15);
    for (const v of REL_VOCAB) {
      expect(v.ko, `${v.id} 한국어명`).toBeTruthy();
      expect(v.dir, `${v.id} 방향`).toBeTruthy();
      expect(v.gate, `${v.id} 판정 게이트`).toMatch(/^R\d{2}$/);
      expect(['REQUIRED', 'CONDITIONAL', 'ADVISORY']).toContain(v.stage);
    }
  });

  it('엔진 단계는 6개이고 순서·근거 Core·입력 의존이 고정되어 있다', () => {
    expect(TP_STAGE_ORDER).toEqual(['registry', 'graph', 'validate', 'snapshot', 'capability', 'impact']);
    for (const id of TP_STAGE_ORDER) {
      expect(TP_STAGE_META[id].ko).toBeTruthy();
      expect(TP_STAGE_META[id].core).toMatch(/^C\d{2}$/);
      expect(TP_STAGE_META[id].refs).toBeTruthy();
    }
    expect(TP_STAGE_INPUTS.graph).toEqual(['registry']);
    expect(TP_STAGE_INPUTS.validate).toEqual(['graph']);
    expect(TP_STAGE_INPUTS.snapshot).toEqual(['graph']);
    expect(TP_STAGE_INPUTS.capability).toEqual(['graph']);
    expect(TP_STAGE_INPUTS.impact).toEqual(['capability']);
    expect(TP_STAGE_INPUTS.registry).toEqual([]);
  });

  it('범례는 Core 기준으로 묶는다 — 6단계 · 4 Core, 중복 없음', () => {
    expect(CORE_LEGEND.map(g => g.core)).toEqual(['C01', 'C03', 'C14', 'C43']);
    // 축약명은 전 단계를 한 번씩만 덮는다 — 헤더·범례가 같은 Core 를 반복하지 않는다.
    const covered = CORE_LEGEND.flatMap(g => g.stages);
    expect(covered).toHaveLength(TP_STAGE_ORDER.length);
    expect(new Set(covered).size).toBe(TP_STAGE_ORDER.length);
    for (const g of CORE_LEGEND) {
      expect(g.name, `${g.core} 이름`).toBeTruthy();
      expect(g.stages.length).toBeGreaterThan(0);
    }
    // C14 는 검증 · 동결 · Capability 3단계가 공유한다.
    expect(CORE_LEGEND.find(g => g.core === 'C14')?.stages).toEqual(['관계 검증', 'Snapshot 동결', 'Capability']);
  });

  it('영역 → 강조 단계 매핑', () => {
    expect(stageOfArea('UI05-S01')).toBe('snapshot');
    expect(stageOfArea('UI05-S02')).toBe('graph');
    expect(stageOfArea('UI05-S03')).toBe('validate');
    expect(stageOfArea('UI05-S04')).toBe('capability');
    expect(stageOfArea('UI05-S05')).toBe('impact');
    expect(stageOfArea('UI05-S06')).toBe('impact');
    expect(stageOfArea('UI05-S07')).toBe('graph');
    expect(stageOfArea('UI05-UNKNOWN')).toBe('registry');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. 그래프 적재
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 그래프 적재', () => {
  it('실측 Edge·Relation 을 링크로 적재하고 모든 끝점을 노드로 만든다', () => {
    expect(REAL_GRAPH.links).toHaveLength(M.edges.length + M.relations.length);
    for (const l of REAL_GRAPH.links) {
      expect(REAL_GRAPH.nodes.has(l.source), `source ${l.source}`).toBe(true);
      expect(REAL_GRAPH.nodes.has(l.target), `target ${l.target}`).toBe(true);
    }
    expect(REAL_GRAPH.nodes.get('FEAT-BDC-001')?.kind).toBe('Feature');
    expect(REAL_GRAPH.nodes.get('SWC-BDC-ADAPTER')?.kind).toBe('Artifact');
    // 버전이 붙은 참조는 기준 ID 로 정규화하므로 유령 노드를 만들지 않는다.
    expect(REAL_GRAPH.links.every(l => !l.source.includes('@') && !l.target.includes('@'))).toBe(true);
    expect(REAL_GRAPH.links.find(l => l.id === 'K1')?.pin).toBe('3.2.1');
    // 실측 정본 데이터에는 어디에도 없는 참조가 없다 — External 노드 0건.
    expect([...REAL_GRAPH.nodes.values()].filter(n => n.kind === 'External')).toHaveLength(0);
    expect(REAL_GRAPH.nodes.get('SYS-BODY-001')?.kind).toBe('Artifact');
  });

  it('정본 사전 밖 원천 타입은 매핑하지 않고 별칭 후보만 남긴다', () => {
    expect(REAL_GRAPH.links.find(l => l.id === 'E2')?.mapped).toBe(true);   // requires
    const r3 = REAL_GRAPH.links.find(l => l.id === 'R3');                    // uses_api
    expect(r3?.mapped).toBe(false);
    expect(r3?.hint).toBe('implemented_by');
  });

  it('사용 수 집계 — 사전 15종 + 별도 버킷 합이 전체 링크 수와 같다', () => {
    const u = relationUsage(REAL_GRAPH);
    expect(u.total).toBe(REAL_GRAPH.links.length);
    expect(u.counts.size).toBe(15);
    expect([...u.unmapped.keys()].sort()).toEqual(
      ['applies_to', 'controlled_by', 'deployed_as', 'derives', 'realized_by', 'uses_api'],
    );
    const mapped = [...u.counts.values()].reduce((a, b) => a + b, 0);
    const unmapped = [...u.unmapped.values()].reduce((a, b) => a + b, 0);
    expect(mapped + unmapped).toBe(u.total);
    // 사전 밖 타입마다 후보는 제시하되 자동 변환하지 않는다(후보는 반드시 사전 항목이어야 한다).
    for (const t of u.unmapped.keys()) {
      const hint = REL_UNMAPPED_HINT[t];
      expect(hint, `${t} 후보 안내`).toBeTruthy();
      expect(REL_BY_ID.has(hint)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 규칙 검증
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 규칙 검증', () => {
  it('해석되지 않는 참조는 External 노드로 남기고 적재 차단으로 낸다', () => {
    const { g, graph } = synth();
    expect(graph.nodes.get('T-HIL-1')?.kind).toBe('External');
    const findings = validateTopology(graph, g, []);
    const hit = findings.find(f => f.code === 'DANGLING_REFERENCE');
    expect(hit).toBeDefined();
    expect(hit!.subject).toBe('T-HIL-1');
    expect(hit!.severity).toBe('BLOCKING');
    // 실측 정본 데이터에는 해석 불가 참조·고아 노드가 0건이어야 한다.
    const real = validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines);
    expect(real.filter(f => f.code === 'DANGLING_REFERENCE')).toHaveLength(0);
    expect(real.filter(f => f.code === 'ORPHAN_NODE')).toHaveLength(0);
  });

  it('실측 데이터의 위반을 숨기지 않고 코드·대상·보완 안내로 낸다', () => {
    const findings = validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines);
    const codes = new Set(findings.map(f => f.code));
    expect(codes.has('UNMAPPED_RELATION_TYPE')).toBe(true);
    expect(findings.some(f => f.subject === 'FEAT-CONN-001 → API-BDC-POLICY-CONTROL')).toBe(true);
    expect(findings.every(f => f.remedy && f.refs && f.stage && f.detail)).toBe(true);
    // 사전 매핑 누락은 경고로만 남는다 — 정본 15종이 아니라고 해서 적재를 막지는 않는다.
    expect(countSeverity(findings.filter(f => f.code === 'UNMAPPED_RELATION_TYPE'), 'WARNING'))
      .toBe(M.relations.filter(r => !REL_BY_ID.has(r.type)).length);
    expect(countSeverity(findings, 'BLOCKING') + countSeverity(findings, 'WARNING') + countSeverity(findings, 'INFO'))
      .toBe(findings.length);
  });

  it('기준선 밖 node 는 하나로 묶어 경고하고 판정 근거를 남긴다', () => {
    const scope = bomScopeFeatureIds(initial.bomBaselines);
    const findings = validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines, scope);
    const drift = findings.filter(f => f.code === 'NODE_SET_SCOPE_DRIFT');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('WARNING');
    expect(drift[0].stage).toBe('graph');
    const outside = M.features.filter(f => !scope.includes(f.id)).map(f => f.id);
    for (const id of outside) expect(drift[0].detail).toContain(id);
    // 범위를 주지 않으면 판정하지 않는다 — 없는 범위를 지어내지 않는다.
    expect(validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines).some(f => f.code === 'NODE_SET_SCOPE_DRIFT')).toBe(false);
  });

  it('정확 버전 pin 은 구현·시험·관측·통제 결속에만 요구한다', () => {
    const unpinned = REAL_INPUT.relations
      .filter(r => ['implemented_by', 'verified_by', 'observed_by', 'governed_by'].includes(r.type))
      .map(r => ({ ...r, target: baseId(r.target) }));
    const g: TopologyInput = { ...REAL_INPUT, relations: unpinned };
    const graph = buildTopologyGraph(g);
    const hits = validateTopology(graph, g, initial.bomBaselines).filter(f => f.code === 'UNPINNED_VERSION');
    expect(hits).toHaveLength(unpinned.length);
    // 실측 정본 데이터는 전부 pin 이 붙어 있다.
    expect(validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines).some(f => f.code === 'UNPINNED_VERSION')).toBe(false);
  });

  it('제어점 결속 중복은 그래프가 판정하지 않고 UI03 정본 검사로 넘긴다', () => {
    const dup = bindingConflicts();
    expect(dup.length).toBeGreaterThan(0);
    for (const d of dup) {
      expect(d.key).toContain('|');
      expect(d.first).not.toBe(d.second);
    }
    const findings = validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines);
    expect(findings.some(f => (f.code as string) === 'BINDING_CONFLICT')).toBe(false);
  });

  it('순환·자기참조·중복·requires↔excludes 충돌을 찾아낸다', () => {
    const { g, graph } = synth();
    const codes = new Set(validateTopology(graph, g, []).map(f => f.code));
    expect(codes.has('CYCLE')).toBe(true);
    expect(codes.has('SELF_REFERENCE')).toBe(true);
    expect(codes.has('DUPLICATE_RELATION')).toBe(true);
    expect(codes.has('RELATION_CONFLICT')).toBe(true);
  });

  it('기준선이 선언한 Topology node 가 그래프에 없으면 동결을 막는다', () => {
    const broken = { ...initial.bomBaselines[0], topologyNodes: ['NOPE-999'] };
    const findings = validateTopology(REAL_GRAPH, REAL_INPUT, [broken]);
    const hit = findings.find(f => f.code === 'SNAPSHOT_NODE_MISSING');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('BLOCKING');
    expect(hit!.detail).toContain('NOPE-999');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Snapshot 동결 · hash · 변경 비교
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 Snapshot 동결', () => {
  const snaps = buildSnapshots(REAL_GRAPH, initial.bomBaselines, '2026-09-13T10:00:00Z');

  it('작업본 + 기준선마다 하나씩 만들고 작업본은 LIVE 다', () => {
    expect(snaps[0].id).toBe('LIVE');
    expect(snaps[0].state).toBe('WORKING');
    expect(snaps).toHaveLength(1 + initial.bomBaselines.length);
    expect(snaps.every(s => /^[0-9a-f]{64}$/.test(s.hash))).toBe(true);
    expect(new Set(snaps.map(s => s.hash)).size).toBe(snaps.length);
  });

  it('hash 는 행 순서와 무관하고 내용이 바뀌면 바뀐다', () => {
    const { hash, ...rest } = snaps[0];
    expect(snapshotHash({ ...rest, nodes: [...rest.nodes].reverse(), linkKeys: [...rest.linkKeys].reverse() })).toBe(hash);
    expect(snapshotHash({ ...rest, nodes: [...rest.nodes, 'EXTRA-1'] })).not.toBe(hash);
    expect(buildSnapshots(REAL_GRAPH, initial.bomBaselines, '2026-09-13T10:00:00Z')[0].hash).toBe(hash);
  });

  it('기준선의 미해석 pin 은 Registry 에 없는 참조만 담는다', () => {
    for (const s of snaps.slice(1)) {
      expect(s.missing.every(ref => !REAL_GRAPH.nodes.has(baseId(ref)))).toBe(true);
      expect(s.nodes).toEqual(initial.bomBaselines.find(b => b.id === s.id)!.topologyNodes);
    }
  });

  it('변경 비교는 값이 다른 행만 내고 hash 불일치는 BLOCKING 이다', () => {
    const diff = diffSnapshots(snaps[0], snaps[1], REAL_GRAPH);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every(r => String(r.before) !== String(r.after))).toBe(true);
    expect(diff.some(r => r.item === '내용 hash' && r.severity === 'BLOCKING')).toBe(true);
    expect(diffSnapshots(snaps[0], snaps[0], REAL_GRAPH)).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. 영향 경로 · Capability · 시험 선택
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 영향 경로와 Capability', () => {
  it('BFS 탐색은 깊이 오름차순이고 maxDepth 를 넘지 않는다', () => {
    const rows = walkGraph(REAL_GRAPH, 'FEAT-BDC-001', 3);
    expect(rows.length).toBeGreaterThan(0);
    const depths = rows.map(r => r.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(depths.every(d => d >= 1 && d <= 3)).toBe(true);
    expect(walkGraph(REAL_GRAPH, 'FEAT-BDC-001', 1).every(r => r.depth === 1)).toBe(true);
  });

  it('순환 그래프에서도 종료한다', () => {
    const { graph } = synth();
    const rows = walkGraph(graph, 'A', 5);
    expect(rows.length).toBeLessThan(400);
    expect(rows.every(r => r.depth <= 5)).toBe(true);
  });

  it('탐색은 방문 한계에서 멈추면 숨기지 않고 frontier 로 남긴다', () => {
    const { graph } = synth();
    const done = walkImpact(graph, 'A', 5);
    expect(done.complete).toBe(true);
    expect(done.frontier).toEqual([]);
    expect(done.maxHops).toBeGreaterThanOrEqual(1);

    const capped = walkImpact(REAL_GRAPH, 'FEAT-BDC-001', 1);
    expect(capped.maxHops).toBe(1);
    expect(capped.rows.every(r => r.depth === 1)).toBe(true);
    expect(capped.complete).toBe(false);
    expect(capped.frontier.length).toBeGreaterThan(0);
    // 재개 지점은 실제 그래프 노드여야 한다 — 없는 노드를 지어내지 않는다.
    for (const id of capped.frontier) expect(REAL_GRAPH.nodes.has(id)).toBe(true);
    // 행 반환 계약은 완전 탐색과 동일하다.
    expect(walkGraph(REAL_GRAPH, 'FEAT-BDC-001', 1)).toEqual(capped.rows);
  });

  it('Capability 는 범위 밖 Feature 를 SELECTED 로 세지 않는다', () => {
    const scope = bomScopeFeatureIds(initial.bomBaselines);
    expect(scope).toEqual(['FEAT-ADAS-001', 'FEAT-BDC-001', 'FEAT-LIGHT-001']);
    const scoped = evaluateCapability(REAL_GRAPH, REAL_INPUT, scope);
    expect([...scoped.map(c => c.root)].sort()).toEqual(scope);
    expect(scoped.every(c => c.missing.length === 0)).toBe(true);
    expect(scoped.every(c => c.outcome === 'SELECTED')).toBe(true);
    // 범위 밖 Feature 는 평가 자체를 하지 않는다.
    expect(new Set(evaluateCapability(REAL_GRAPH, REAL_INPUT).map(c => c.root)).size).toBe(M.features.length);
  });

  it('Capability 는 역할의 존재를 보고 누락을 남긴다', () => {
    const cap = evaluateCapability(REAL_GRAPH, REAL_INPUT);
    expect(cap).toHaveLength(M.features.length);
    const bdc = cap.find(c => c.root === 'FEAT-BDC-001')!;
    expect(bdc.from).toEqual(['FEAT-BDC-001', 'SYS-BODY-001']);   // derives 결속 요구 노드 포함
    expect(bdc.roles.impl).toContain('SWC-BDC-ADAPTER');
    expect(bdc.roles.impl).toContain('SUP-BDC-A');
    expect(bdc.roles.verify).toContain('HIL-BDC-001');
    // 통제 대상은 Rule 이다 — DD-03-5 `governed_by` = 대상 → Rule.
    expect(bdc.roles.control).toEqual(['RULE-BDC-VARIANT']);
    expect(bdc.roles.observe).toEqual(['OBS-BDC-FLEET']);
    expect(bdc.missing).toHaveLength(0);
    expect(bdc.outcome).toBe('SELECTED');
    expect(capabilityRoots(REAL_GRAPH, 'FEAT-BDC-001')).toEqual(bdc.from);
  });

  it('시험 선택은 verified_by 결속만 골라 정렬하고 피검증 Feature 는 넣지 않는다', () => {
    const roots = capabilityRoots(REAL_GRAPH, 'FEAT-BDC-001');
    const tests = selectTests(REAL_GRAPH, roots);
    expect(tests).toEqual([...tests].sort());
    expect(tests).toEqual(expect.arrayContaining(['HIL-BDC-001', 'OTA-RB-002', 'TEL-BDC-001']));
    // 고른 대상은 전부 verified_by 의 대상이다 — 후보를 지어내지 않는다.
    const verified = new Set(REAL_GRAPH.links.filter(l => l.type === 'verified_by').map(l => l.target));
    for (const t of tests) expect(verified.has(t), `${t} 검증 근거`).toBe(true);
    // 영향 노드로 되돌아오는 `in` 행(verified_by)의 주체는 Feature 이므로 시험 후보가 아니다.
    expect(tests.some(t => roots.includes(t))).toBe(false);
    // 영향 경로를 거쳐 도달하는 시험도 포함한다(전이 결속).
    expect(selectTests(REAL_GRAPH, ['FEAT-RUNTIME-001']))
      .toEqual(expect.arrayContaining(['HIL-BDC-001', 'OTA-RB-002', 'TEL-BDC-001']));
    // 근거가 없으면 빈 목록 — 후보를 지어내지 않는다.
    expect(selectTests(REAL_GRAPH, [])).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. 파이프라인 모델 — 렌더러는 판정하지 않는다
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 파이프라인 모델', () => {
  const scope = bomScopeFeatureIds(initial.bomBaselines);
  const findings = validateTopology(REAL_GRAPH, REAL_INPUT, initial.bomBaselines, scope);
  const capability = evaluateCapability(REAL_GRAPH, REAL_INPUT, scope);
  const snapshots = buildSnapshots(REAL_GRAPH, initial.bomBaselines, '2026-09-13T10:00:00Z');
  const tests = selectTests(REAL_GRAPH, capabilityRoots(REAL_GRAPH, 'FEAT-BDC-001'));
  const model = buildTopologyModel({
    g: REAL_INPUT, graph: REAL_GRAPH, baselines: initial.bomBaselines,
    snapshots, findings, capability, root: 'FEAT-BDC-001', tests, scope,
  });

  it('6단계를 정본 순서·제목으로 만들고 단계마다 5개 실측 행을 낸다', () => {
    expect(model.stages.map(s => s.id)).toEqual(TP_STAGE_ORDER);
    for (const s of model.stages) {
      expect(s.rows).toHaveLength(5);
      expect(s.rows.length).toBeLessThanOrEqual(TP_MAX_ROWS);
      expect(s.title).toBe(TP_STAGE_META[s.id].ko);
      expect(s.short).toBe(TP_STAGE_SHORT[s.id]);
      // 흐름 상자 폭에 맞는 축약명이어야 한다 — 6열 파이프라인에서 잘리면 안 된다.
      expect([...s.short].length, `${s.id} 축약명 길이`).toBeLessThanOrEqual(14);
      expect(s.core).toBe(TP_STAGE_META[s.id].core);
      expect(s.summary, `${s.id} 요약`).toBeTruthy();
      expect(s.inputs).toEqual(TP_STAGE_INPUTS[s.id]);
      expect(['pass', 'pending', 'fail', 'info', 'muted']).toContain(s.tone);
      for (const r of s.rows) {
        expect(r.label).toBeTruthy();
        expect(r.value).toBeTruthy();
        expect(['pass', 'pending', 'fail', 'info', 'muted']).toContain(r.tone);
      }
    }
    // 판정 근거는 단계 메타가 아니라 계산 결과에서 온다.
    expect(model.stages[0].summary).toContain(String(M.features.length));
    expect(model.stages[1].summary).toContain(String(REAL_GRAPH.nodes.size));
  });

  it('차단은 앞 단계가 아니라 실제 입력 의존을 따라 전파된다', () => {
    for (const s of model.stages) {
      if (s.blockedBy) {
        // 막는 단계는 반드시 이 단계의 입력이어야 한다 — 이웃 단계 전체가 아니다.
        expect(TP_STAGE_INPUTS[s.id], `${s.id} 입력`).toContain(s.blockedBy);
        expect(s.tone).toBe('fail');
        expect(s.blockedReason).toContain(TP_STAGE_SHORT[s.blockedBy]);
      } else {
        expect(s.blockedReason).toBeUndefined();
      }
    }
    // 그래프 적재가 성공했으면 검증이 경고만 남겨도 동결·Capability 는 진행된다.
    const stage = (id: string) => model.stages.find(s => s.id === id)!;
    expect(stage('graph').tone).not.toBe('fail');
    expect(stage('validate').blockedBy).toBeUndefined();
    expect(stage('snapshot').blockedBy).toBeUndefined();
    expect(stage('capability').blockedBy).toBeUndefined();
    expect(stage('impact').blockedBy).toBeUndefined();
    expect(stage('validate').tone).toBe('pending');   // 경고만 남은 상태
    // BLOCKING 이 남으면 동결은 진행하되 '보류' 로 표시한다 — 지어내지 않는다.
    expect(stage('snapshot').heldBy).toBe(stage('snapshot').heldReason ? 'validate' : undefined);
  });

  it('registry 단계는 Feature 가 없으면 실패한다', () => {
    const empty = buildTopologyModel({
      g: { features: [], edges: [], relations: [] }, graph: buildTopologyGraph({ features: [], edges: [], relations: [] }, []),
      baselines: [], snapshots: [], findings: [], capability: [], root: 'X', tests: [], scope: [],
    });
    expect(empty.stages[0].tone).toBe('fail');
    expect(empty.stages[1].blockedBy).toBe('registry');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. Import 검증 — UI05-S07
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 Import 검증', () => {
  it('표시 열 6종은 정본 열 이름 그대로다', () => {
    expect(IMPORT_COLUMNS).toEqual(['행', '원천 열', '매핑 속성', '입력값', '검사', '보완 안내']);
  });

  it('행별로 사전 외·중복·자기참조·미해석·열 수 오류를 구분한다', () => {
    const text = [
      '# 원천 CSV — source,type,target',
      'FEAT-BDC-001,parent_of,FEAT-BDC-002',
      'FEAT-BDC-001,uses_api,API-BDC-POLICY-CONTROL',
      'FEAT-BDC-001,parent_of,FEAT-BDC-002',
      'FEAT-BDC-001,parent_of,FEAT-BDC-001',
      'NOPE-001,parent_of,FEAT-BDC-001',
      'FEAT-BDC-001,parent_of,NOPE-002',
      'SYS-BODY-001,implemented_by,SWC-BDC-ADAPTER@1.0.0',
      'FEAT-BDC-001,parent_of',
    ].join('\n');
    const rows = parseImport(text, REAL_GRAPH);
    expect(rows.map(r => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows.map(r => r.check)).toEqual([
      'OK', 'UNKNOWN_RELATION', 'DUPLICATE', 'SELF_REFERENCE',
      'DANGLING_SOURCE', 'DANGLING_TARGET', 'OK', 'COLUMN_COUNT',
    ]);
    expect(rows[0].applyable).toBe(true);
    expect(rows[1].applyable).toBe(false);
    expect(rows[1].remedy).toContain('implemented_by');       // 별칭 후보 안내(자동 변환 아님)
    expect(rows.every(r => r.remedy)).toBe(true);
  });

  it('정확 버전 pin 을 분리해 보존한다', () => {
    const [row] = parseImport('SYS-BODY-001,implemented_by,SWC-BDC-ADAPTER@1.0.0', REAL_GRAPH);
    expect(row.target).toBe('SWC-BDC-ADAPTER@1.0.0');
    expect(row.version).toBe('1.0.0');
    expect(baseId(row.target)).toBe('SWC-BDC-ADAPTER');
    expect(row.check).toBe('OK');
  });

  it('주석·빈 줄은 건너뛰되 실제 줄 번호를 유지한다', () => {
    const rows = parseImport('\n# 주석\n\nFEAT-BDC-001,parent_of,FEAT-BDC-002\n', REAL_GRAPH);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. 조건행 중복 — 같은 조건, 다른 구현
// ════════════════════════════════════════════════════════════════════════════

describe('UI05 조건행 중복 판정', () => {
  it('찾아낸 쌍은 조건 축 8종이 모두 같고 구현 참조만 다르다', () => {
    const dup = duplicateConditionPairs();
    expect(dup.size).toBeGreaterThan(0);
    for (const [key, others] of dup) {
      const [id, version] = key.split('@');
      const a = BOM_CONDITION_PROFILES.find(r => r.id === id && r.version === version)!;
      expect(a).toBeDefined();
      for (const other of others) {
        const [oid, over] = other.split('@');
        const b = BOM_CONDITION_PROFILES.find(r => r.id === oid && r.version === over)!;
        expect(b).toBeDefined();
        expect(b.implementationRef).not.toBe(a.implementationRef);
        for (const ax of AXES) expect(b[ax], `${other} ${ax}`).toBe(a[ax]);
      }
    }
  });

  it('축이 하나라도 다르면 중복으로 보지 않는다', () => {
    const base = BOM_CONDITION_PROFILES[0];
    const clone: ConditionRow = { ...base, id: 'FB-TEST-DUP', implementationRef: `${base.implementationRef}-X` };
    const other: ConditionRow = { ...clone, id: 'FB-TEST-OTHER', market: `${base.market}-XX`, implementationRef: `${base.implementationRef}-Y` };
    const dup = duplicateConditionPairs([base, clone, other]);
    expect(dup.get(`${base.id}@${base.version}`)).toEqual([`${clone.id}@${clone.version}`]);
    expect(dup.has(`${other.id}@${other.version}`)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. 화면 계약 — 실제 Provider 스택
// ════════════════════════════════════════════════════════════════════════════

function RoleSetter({ role }: { role: string }) {
  const { dispatch } = useApp();
  useEffect(() => { dispatch({ t: 'ROLE', role }); }, [role, dispatch]);
  return null;
}

function renderArch(role = 'author') {
  return render(
    <MemoryRouter initialEntries={['/arch/topology']}>
      <AppProvider>
        <RoleSetter role={role} />
        <TwinProvider>
          <TopologyArch />
        </TwinProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('UI05 화면 계약', () => {
  it('상단 6단계 엔진과 5개 연결을 순수 모델 그대로 그린다', () => {
    const { container } = renderArch();
    const root = screen.getByTestId('topology-arch');
    const engine = screen.getByTestId('topology-engine');
    expect(engine).toBeTruthy();

    const stages = [...root.querySelectorAll('[data-testid^="tp-stage-"]')];
    expect(stages.map(el => el.getAttribute('data-testid'))).toEqual(TP_STAGE_ORDER.map(s => `tp-stage-${s}`));
    for (const el of stages) {
      expect(['pass', 'pending', 'fail', 'info', 'muted']).toContain(el.getAttribute('data-tone'));
      expect(['true', 'false']).toContain(el.getAttribute('data-blocked'));
    }
    expect(root.querySelectorAll('[data-testid^="tp-link-"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-testid^="tp-link-"]').length)
      .toBe(TP_STAGE_ORDER.length - 1);
  });

  it('하단 Twin 런타임 토폴로지를 같은 화면에 함께 그린다', () => {
    renderArch();
    expect(screen.getByTestId('architecture-flow')).toBeTruthy();
  });

  it('7개 영역 탭이 있고 S03 은 사전 15종 카드를 모두 그린다', () => {
    const { container } = renderArch();
    const tabs = [...container.querySelectorAll('.tabs button')];
    expect(tabs).toHaveLength(7);
    expect(tabs.map(b => b.textContent)).toEqual([
      'S01 Topology 목록과 Snapshot', 'S02 연결관계 탐색', 'S03 관계 편집과 15종 사전',
      'S04 조건과 제약 검증', 'S05 변경 영향과 경로 비교', 'S06 외부 도구와 차량 실행 연결',
      'S07 가져오기와 정합성 이슈',
    ]);

    fireEvent.click(tabs[2]);
    expect(container.querySelectorAll('[data-testid^="vocab-"]')).toHaveLength(15);
  });

  it('클럭 ×0 이면 두 계층이 함께 멈춘다', () => {
    const { container } = renderArch();
    const root = () => screen.getByTestId('topology-arch');
    const badge = () => container.querySelector('.tpa-badge')!.textContent ?? '';
    const rates = [...container.querySelectorAll('.tpa-rates button')];
    expect(root().getAttribute('data-paused')).toBe('false');
    expect(badge()).toContain('LIVE');

    fireEvent.click(rates[0]);
    expect(root().getAttribute('data-paused')).toBe('true');
    expect(badge()).toContain('PAUSED');

    fireEvent.click(rates[2]);
    expect(root().getAttribute('data-paused')).toBe('false');
    expect(badge()).toContain('LIVE');
  });

  it('관계 저장은 author 역할에만 열리고 같은 관계는 409 로 막는다', () => {
    const { container } = renderArch('integrator');
    fireEvent.click([...container.querySelectorAll('.tabs button')][2]);
    expect(screen.getByRole('button', { name: '관계 저장' })).toBeDisabled();
    expect(container.textContent).toContain('rolePolicy.edit = author');
    cleanup();

    const author = renderArch('author');
    fireEvent.click([...author.container.querySelectorAll('.tabs button')][2]);
    const save = screen.getByRole('button', { name: '관계 저장' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    // 기본 입력은 시드 Edge E2(FEAT-BDC-001 requires FEAT-RUNTIME-001) 와 같은 키 → 중복 판정.
    const codes = [...author.container.querySelectorAll('.tpa-result .code')].map(el => el.textContent);
    expect(codes).toContain('409');
  });
});

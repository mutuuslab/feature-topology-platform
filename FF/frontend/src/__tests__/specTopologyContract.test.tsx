/**
 * TD v0.8 §4.4~§4.8 계약 계층 + UL-OSS-R1 경계 — 데이터 모듈 · 엔진 · 화면 계약.
 *
 * 이 파일이 고정하는 것은 "요구사항을 썼다"가 아니라 **실측 데이터 위에서 계약이 실제로 판정된다**는 사실이다.
 *   · 관계 레코드 15속성 · 정확 참조(contentHash) · 승인 보류 판정
 *   · requires 전체 경로와 요구 상태별 판정 시점
 *   · 배타 제약 수준 — 동시 활성 배타를 BOM 공존 금지로 확대하지 않는다
 *   · Unleash `parent` 는 도구 관계다 — 보존하고 거절하며 requires 로 승격하지 않는다
 *   · SegmentVersion 역탐색은 미확보 단계를 frontier 로 남기고 live Segment 를 읽지 않는다
 *
 * 기대값은 모두 `model.ts` / `implementation.ts` / BOM 기준선 실측에서 나온 값이며 지어낸 수치가 아니다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from '../store';
import { TwinProvider } from '../state/twinStore';
import * as M from '../data/model';
import { FLAG_BINDINGS } from '../data/implementation';
import { BOM_BASELINES, type BomBaseline } from '../data/featureBom';
import { SPEC_TOPOLOGY_RELATIONS } from '../data/specNav';
import {
  ALWAYS_CONDITION,
  APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT,
  CONTRACT_BY_TYPE,
  DICTIONARY_VERSION,
  FINDING_PHASE,
  LEGACY_RELATION_MAP,
  RECORD_BY_EDGE,
  RECORD_SCOPE_TYPES,
  RELATION_CONTRACTS,
  RELATION_RECORDS,
  RELATION_RECORD_FIELDS,
  SCOPE_VERDICT_KO,
  TOOL_EDGE_CANDIDATES,
  UNRECORDED_EDGE_IDS,
  VERIFY_PHASES,
  approvalHeldRecords,
  assertSnapshotSegment,
  auditRelationRecords,
  evaluateScopeConflicts,
  executionHoldsApproval,
  formatRef,
  missingRecordFields,
  phaseCounts,
  phaseOf,
  refContentHash,
  requiresPaths,
  segmentImpact,
  SEGMENT_STAGE_KO,
  type ContractInput,
} from '../data/topologyContract';
import {
  TopologyArch,
  SEGMENT_REF,
  bomScopeFeatureIds,
  buildContractView,
  buildTopologyGraph,
  buildTopologyModel,
  countSeverity,
  validateTopology,
  type TopologyInput,
} from '../pages/topologyArch';

afterEach(() => cleanup());

const REAL_INPUT: TopologyInput = { features: M.features, edges: M.edges, relations: M.relations };
const REAL_GRAPH = buildTopologyGraph(REAL_INPUT);
// 화면과 같은 범위를 쓴다 — 범위는 BOM 기준선 멤버가 정한다.
const REAL_SCOPE = bomScopeFeatureIds(BOM_BASELINES);
const CONTRACT_INPUT: ContractInput = { edges: M.edges, relations: M.relations };

const FINDINGS = validateTopology(REAL_GRAPH, REAL_INPUT, BOM_BASELINES, REAL_SCOPE);
const VIEW = buildContractView(REAL_INPUT, BOM_BASELINES);
const codes = (fs: { code: string }[]) => fs.map(f => f.code);
const count = (code: string) => FINDINGS.filter(f => f.code === code).length;

function baselineWith(id: string, members: string[]): BomBaseline {
  const seed = BOM_BASELINES[0];
  return { ...seed, id, members: members.map((m, i) => ({ ...seed.members[i % seed.members.length], featureVersionRef: m })) };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. §4.4 관계 유형 계약 15종
// ════════════════════════════════════════════════════════════════════════════

describe('TD §4.4 관계 유형 계약', () => {
  it('정본 15종과 같은 집합·순서이고 각 항목에 실행 지원·순환 정책·판정 책임이 있다', () => {
    expect(RELATION_CONTRACTS.map(c => c.type)).toEqual([...SPEC_TOPOLOGY_RELATIONS]);
    expect(CONTRACT_BY_TYPE.size).toBe(15);
    for (const c of RELATION_CONTRACTS) {
      expect(['DIRECTED', 'SYMMETRIC'], `${c.type} 대칭성`).toContain(c.symmetry);
      expect(['DAG', 'RESTRICTED', 'ALLOWED'], `${c.type} 순환 정책`).toContain(c.cycle);
      expect(['1:1', '1:N', 'N:M'], `${c.type} 기수`).toContain(c.cardinality);
      expect(c.judge, `${c.type} 판정 책임`).toBeTruthy();
      expect(c.refs, `${c.type} 근거`).toBeTruthy();
      // 제약 수준을 요구하면 허용 목록이 반드시 있어야 한다 — 빈 목록은 「선언 불가」와 같다.
      if (c.scopeRequired) expect(c.scopes.length, `${c.type} 허용 제약 수준`).toBeGreaterThan(0);
      else expect(c.scopes, `${c.type} 허용 제약 수준`).toHaveLength(0);
    }
  });

  it('일괄 DAG 금지 — 대칭·관측 관계는 순환을 제한적 허용으로 둔다', () => {
    expect(CONTRACT_BY_TYPE.get('excludes')!.cycle).toBe('ALLOWED');
    expect(CONTRACT_BY_TYPE.get('duplicates')!.cycle).toBe('ALLOWED');
    expect(CONTRACT_BY_TYPE.get('emits')!.cycle).toBe('ALLOWED');
    expect(CONTRACT_BY_TYPE.get('overrides')!.cycle).toBe('RESTRICTED');
    expect(CONTRACT_BY_TYPE.get('requires')!.cycle).toBe('DAG');
  });

  it('저장 전용 관계는 승인·발행을 보류한다 — duplicates(중복 기능)', () => {
    expect(CONTRACT_BY_TYPE.get('duplicates')!.execution).toBe('STORAGE_ONLY');
    expect(executionHoldsApproval('duplicates')).toBe(true);
    expect(executionHoldsApproval('requires')).toBe(false);
    expect(RECORD_SCOPE_TYPES).toHaveLength(9);
    expect(RECORD_SCOPE_TYPES).toContain('degrades_to');
    expect(RECORD_SCOPE_TYPES).not.toContain('implemented_by');
  });

  it('emits 는 UIAsset 출발을 금지한다 — 근거에 그 계약이 남아 있다', () => {
    expect(CONTRACT_BY_TYPE.get('emits')!.refs).toContain('UIAsset 출발 금지');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. §4.4 관계 레코드 — 정확 참조와 contentHash
// ════════════════════════════════════════════════════════════════════════════

describe('TD §4.4 관계 레코드', () => {
  it('레코드 필수 속성 카탈로그 15종에 한국어명·요구 여부·설명이 있다', () => {
    expect(RELATION_RECORD_FIELDS).toHaveLength(15);
    for (const f of RELATION_RECORD_FIELDS) {
      expect(f.ko, `${String(f.id)} 한국어명`).toBeTruthy();
      expect(f.note, `${String(f.id)} 설명`).toBeTruthy();
    }
    expect(RELATION_RECORD_FIELDS.filter(f => f.required)).toHaveLength(12);
  });

  it('모든 레코드가 정확 버전 + 64자리 contentHash 를 가진 참조를 쓴다', () => {
    expect(RELATION_RECORDS).toHaveLength(15 - UNRECORDED_EDGE_IDS.length);
    for (const r of RELATION_RECORDS) {
      expect(missingRecordFields(r), `${r.edgeId} 필수 속성`).toEqual([]);
      for (const ref of [r.sourceRef, r.targetRef]) {
        expect(ref.version, `${r.edgeId} ${ref.id} 버전`).toMatch(/^\d+\.\d+\.\d+$/);
        expect(ref.contentHash, `${r.edgeId} ${ref.id} contentHash`).toMatch(/^[0-9a-f]{64}$/);
        expect(ref.id).toBe(ref.id.trim());
      }
      expect(r.dictionaryVersion).toBe(DICTIONARY_VERSION);
      expect(r.sourceRefs.length, `${r.edgeId} 근거 참조`).toBeGreaterThan(0);
      expect(r.rationale, `${r.edgeId} 근거`).toBeTruthy();
      expect(['out', 'symmetric']).toContain(r.direction);
      expect(['DRAFT', 'ACTIVE', 'RETIRED']).toContain(r.status);
    }
  });

  it('contentHash 는 정확 참조의 일부다 — 같은 입력은 같은 값, 버전이 다르면 다른 값', () => {
    const a = refContentHash('FEAT-BODY-001', '1.0.0');
    expect(refContentHash('FEAT-BODY-001', '1.0.0')).toBe(a);
    expect(refContentHash('FEAT-BODY-001', '1.0.1')).not.toBe(a);
    const rec = RECORD_BY_EDGE.get('E1')!;
    expect(formatRef(rec.sourceRef)).toBe(`p:Feature:FEAT-BODY-001@1.0.0#${rec.sourceRef.contentHash.slice(0, 8)}`);
  });

  it('무조건 관계도 ALWAYS 로 항상 참임을 명시한다', () => {
    for (const r of RELATION_RECORDS) expect(r.conditionRef, `${r.edgeId} 조건`).toBeTruthy();
    const always = RELATION_RECORDS.filter(r => r.conditionRef === ALWAYS_CONDITION);
    expect(always.length).toBeGreaterThan(0);
  });

  it('사전 밖 원천 타입은 레코드를 요구하지 않는다 — 이관 대상이기 때문이다', () => {
    const rows = auditRelationRecords(CONTRACT_INPUT);
    const outOfDictionary = rows.filter(r => !r.inDictionary);
    expect(outOfDictionary.map(r => r.type)).toEqual(['derives', 'applies_to', 'uses_api', 'controlled_by', 'deployed_as', 'realized_by']);
    for (const r of outOfDictionary) expect(r.issues, `${r.edgeId} 사전 밖 결함`).toEqual([]);
  });

  it('§4.5 이관 표는 자동 변환 금지 항목을 MAP 으로 두지 않는다', () => {
    const bySource = new Map(LEGACY_RELATION_MAP.map(r => [r.source, r]));
    expect(bySource.get('REQUIRES')!.handling).toBe('MAP');
    expect(bySource.get('PRECEDES')!.handling).toBe('KEEP_SEPARATE');
    expect(bySource.get('COMBI')!.handling).toBe('MANUAL_REVIEW');
    expect(bySource.get('COMBI')!.target).toBeUndefined();
    expect(bySource.get('CONFLICTS')!.handling).toBe('SPLIT_BY_CONTEXT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 관계 감사 결과 — 실측 데이터의 결함은 4건뿐이다
// ════════════════════════════════════════════════════════════════════════════

describe('관계 레코드 감사', () => {
  it('실측 레코드에 필수 속성 누락이 없다 — 일괄 경고를 만들지 않는다', () => {
    expect(count('RECORD_FIELD_MISSING')).toBe(0);
    expect(count('RECORD_ENDPOINT_MISMATCH')).toBe(0);
    expect(count('CONDITION_UNDECLARED')).toBe(0);
    expect(count('SCOPE_NOT_ALLOWED')).toBe(0);
  });

  it('실측 결함은 제약 수준 미선언 · 레코드 없음 · 저장 전용 · 요구 상태 미선언 4건이다', () => {
    expect(VIEW.holdsApproval.map(r => r.edgeId)).toEqual(['E3', 'E10', 'E11', 'E15']);
    expect(VIEW.holdsApproval.map(r => r.issues.map(i => i.code).flat()))
      .toEqual([['SCOPE_UNDECLARED'], ['RECORD_MISSING'], ['EXECUTION_UNSUPPORTED'], ['REQUIRED_STATE_MISSING']]);
    expect(VIEW.holdsApproval.every(r => r.issues.every(i => i.blocksApproval))).toBe(true);
  });

  it('E10 은 degrades_to 레코드가 없고 그 사실이 승인 보류로 남는다', () => {
    expect(UNRECORDED_EDGE_IDS).toEqual(['E10']);
    expect(RECORD_BY_EDGE.has('E10')).toBe(false);
    const row = VIEW.audit.find(r => r.edgeId === 'E10')!;
    expect(row.inDictionary).toBe(true);
    expect(row.contract!.type).toBe('degrades_to');
  });

  it('레코드 endpoint 가 그래프와 어긋나면 BLOCKING 으로 잡는다', () => {
    const tampered: ContractInput = { edges: [{ id: 'E1', source: 'FEAT-X', target: 'FEAT-Y', type: 'parent_of' }], relations: [] };
    const issues = auditRelationRecords(tampered)[0].issues;
    expect(issues.map(i => i.code)).toContain('RECORD_ENDPOINT_MISMATCH');
    expect(issues.find(i => i.code === 'RECORD_ENDPOINT_MISMATCH')!.blocksApproval).toBe(true);
  });

  it('승인 보류 항목은 감사 결과에서만 나온다 — 문자열 비교로 만들지 않는다', () => {
    expect(approvalHeldRecords(VIEW.audit)).toHaveLength(VIEW.holdsApproval.length);
    expect(VIEW.audit.filter(r => r.issues.length === 0)).toHaveLength(VIEW.audit.length - 4);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. §4.4 · §4.8 requires 전체 경로 + 요구 상태
// ════════════════════════════════════════════════════════════════════════════

describe('requires 전체 경로와 요구 상태 판정', () => {
  it('실측 requires 4건의 판정 결과가 상태·경로와 함께 고정된다', () => {
    expect(VIEW.requires.map(r => r.edgeId)).toEqual(['E2', 'E13', 'E14', 'E15']);
    expect(VIEW.requires.map(r => r.outcome)).toEqual(['AWAITING', 'AWAITING', 'UNSATISFIED', 'COMPLETE']);
    expect(VIEW.requires.every(r => r.path.length === r.hops + 1)).toBe(true);
  });

  it('INSTALLED 는 차량 탑재 시점 전이라 성립으로 세지 않는다', () => {
    const e2 = VIEW.requires.find(r => r.edgeId === 'E2')!;
    expect(e2.requiredState).toBe('INSTALLED');
    expect(e2.detail).toContain('판정 시점');
    expect(e2.detail).toContain('차량 로컬 캐시');
    expect(e2.unresolved).toHaveLength(0);
  });

  it('INCLUDED 요구는 같은 승인 기준선의 멤버 목록으로만 판정하고 미충족 기준선을 밝힌다', () => {
    const e14 = VIEW.requires.find(r => r.edgeId === 'E14')!;
    expect(e14.requiredState).toBe('INCLUDED');
    expect(e14.baselines).toEqual(['BL-LIGHT-ADAS-2027.1@1.0.0', 'BL-LIGHT-2027.1@1.0.0']);
    expect(e14.detail).toContain('FEAT-RUNTIME-001');
  });

  it('요구 상태를 선언하지 않은 경로는 판정 시점을 알 수 없어 COMPLETE 로만 남는다', () => {
    const e15 = VIEW.requires.find(r => r.edgeId === 'E15')!;
    expect(e15.requiredState).toBeUndefined();
    expect(e15.outcome).toBe('COMPLETE');
  });

  it('A requires B, B requires D 이면 D 너머까지 경로를 잇는다', () => {
    const baselines = [baselineWith('BL-T', ['FEAT-A@1.0.0', 'FEAT-B@1.0.0', 'FEAT-D@1.0.0'])];
    const g: ContractInput = {
      edges: [
        { id: 'TA', source: 'FEAT-A', target: 'FEAT-B', type: 'requires' },
        { id: 'TB', source: 'FEAT-B', target: 'FEAT-D', type: 'requires' },
      ],
      relations: [],
    };
    const paths = requiresPaths(g, baselines, new Set(['FEAT-A', 'FEAT-B', 'FEAT-D']));
    const a = paths.find(p => p.edgeId === 'TA')!;
    expect(a.path).toEqual(['FEAT-A', 'FEAT-B', 'FEAT-D']);
    expect(a.hops).toBe(2);
    expect(a.unresolved).toEqual([]);
    expect(a.outcome).toBe('COMPLETE');

    // 경로 위 참조가 Registry 에 없으면 완료로 세지 않는다.
    const broken = requiresPaths(g, baselines, new Set(['FEAT-A', 'FEAT-B']))[0];
    expect(broken.outcome).toBe('INCOMPLETE');
    expect(broken.unresolved).toEqual(['FEAT-D']);
  });

  it('요구 상태를 선언하지 않으면 REQUIRED_STATE_MISSING 경고가 남는다', () => {
    expect(count('REQUIRED_STATE_MISSING')).toBe(1);
    expect(count('REQUIRES_PATH_INCOMPLETE')).toBe(0);
    expect(count('REQUIRED_STATE_UNSATISFIED')).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. §4.8 제약 수준 — 동시 활성 배타를 BOM 공존 금지로 확대하지 않는다
// ════════════════════════════════════════════════════════════════════════════

describe('배타 제약 수준 판정', () => {
  it('대칭 관계만 제약 수준을 평가한다 — excludes · duplicates', () => {
    expect(VIEW.scopes.map(s => s.edgeId)).toEqual(['E3', 'E11']);
    expect(VIEW.scopes.every(s => CONTRACT_BY_TYPE.get(s.edgeId === 'E3' ? 'excludes' : 'duplicates')!.symmetry === 'SYMMETRIC')).toBe(true);
  });

  it('실측 데이터에서 승인 기준선 차단은 일어나지 않는다', () => {
    expect(VIEW.scopes.map(s => s.verdict)).toEqual(['SCOPE_UNKNOWN', 'NOT_COEXISTING']);
    expect(VIEW.scopes.every(s => s.coexisting.length === 0)).toBe(true);
    expect(count('COEXISTENCE_CONFLICT')).toBe(0);
  });

  it('같은 기준선에 함께 담긴 쌍도 제약 수준을 넘어 차단되지 않는다', () => {
    const baselines = [baselineWith('BL-X', ['FEAT-CONN-001@1.0.0', 'FEAT-BDC-001@1.1.0'])];
    const g: ContractInput = { edges: [], relations: [{ id: 'E11', source: 'FEAT-CONN-001', target: 'FEAT-BDC-001', type: 'duplicates' }] };
    const out = evaluateScopeConflicts(g, baselines);
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe('CATALOG_SELECTION');
    expect(out[0].coexisting).toEqual([`BL-X@${baselines[0].version}`]);
    expect(out[0].verdict).toBe('ONLY_AT_ACTIVATION');
    expect(out[0].detail).toContain('BOM 공존 금지로 확대하지 않는다');
  });

  it('네 제약 수준의 판정 어휘가 서로 구분된다', () => {
    expect(Object.keys(SCOPE_VERDICT_KO).sort()).toEqual(
      ['ALLOWED_ALTERNATIVES', 'BLOCKING', 'NOT_COEXISTING', 'ONLY_AT_ACTIVATION', 'SCOPE_UNKNOWN'],
    );
    expect(SCOPE_VERDICT_KO.BLOCKING).toContain('차단');
    expect(SCOPE_VERDICT_KO.ALLOWED_ALTERNATIVES).toContain('BOM 공존 허용');
    expect(SCOPE_VERDICT_KO.ONLY_AT_ACTIVATION).toContain('동시 활성만 배타');
    expect(SCOPE_VERDICT_KO.SCOPE_UNKNOWN).toContain('미선언');
  });

  it('대칭 관계는 한 방향 선언으로 한 번만 평가한다', () => {
    const g: ContractInput = {
      edges: [],
      relations: [
        { id: 'S1', source: 'A', target: 'B', type: 'excludes' },
        { id: 'S2', source: 'B', target: 'A', type: 'excludes' },
      ],
    };
    expect(evaluateScopeConflicts(g, [])).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. §4.6 검증 4단계 — 결함 코드마다 단계가 지정되어야 한다
// ════════════════════════════════════════════════════════════════════════════

describe('검증 4단계', () => {
  it('네 단계 정의가 순서대로 있고 25개 결함 코드에 단계가 모두 지정되어 있다', () => {
    expect(VERIFY_PHASES.map(p => p.id)).toEqual(['STRUCTURE', 'COMPOSITION', 'SEMANTIC', 'RUNTIME_SUPPORT']);
    expect(Object.keys(FINDING_PHASE)).toHaveLength(25);
    for (const [code, phase] of Object.entries(FINDING_PHASE)) {
      expect(VERIFY_PHASES.map(p => p.id), code).toContain(phase);
      expect(phaseOf(code)).toBe(phase);
    }
  });

  it('엔진이 내는 모든 결함에 단계가 붙는다 — 화면이 단계를 지어내지 않는다', () => {
    expect(FINDINGS.length).toBeGreaterThan(0);
    for (const f of FINDINGS) {
      expect(f.phase, `${f.code} 단계`).toBe(FINDING_PHASE[f.code]);
      expect(f.blocksApproval === undefined || typeof f.blocksApproval === 'boolean').toBe(true);
    }
    const counts = phaseCounts(FINDINGS);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(FINDINGS.length);
  });

  it('미해결 결함이 남아 있으면 complete 는 false 다 — 전체 통과로 표시하지 않는다', () => {
    const model = buildTopologyModel({
      g: REAL_INPUT, graph: REAL_GRAPH, baselines: BOM_BASELINES,
      snapshots: [], findings: FINDINGS, capability: [], root: 'FEAT-BDC-001', tests: [], scope: REAL_SCOPE,
    });
    expect(countSeverity(FINDINGS, 'BLOCKING')).toBe(0);
    expect(FINDINGS.length).toBeGreaterThan(0);
    expect(model.stages.find(s => s.id === 'validate')!.tone).toBe('pending');
  });

  it('실측 결함 코드 분포가 고정된다 — 구조 7 · 구성 4 · 의미 0 · 실행 계약 3', () => {
    expect(codes(FINDINGS).sort()).toEqual([
      'EXECUTION_UNSUPPORTED', 'NODE_SET_SCOPE_DRIFT', 'RECORD_MISSING',
      'REQUIRED_STATE_MISSING', 'REQUIRED_STATE_UNSATISFIED', 'SCOPE_UNDECLARED',
      'SEGMENT_IMPACT_INCOMPLETE', 'TOOL_RELATION_NOT_TOPOLOGY',
      'UNMAPPED_RELATION_TYPE', 'UNMAPPED_RELATION_TYPE', 'UNMAPPED_RELATION_TYPE',
      'UNMAPPED_RELATION_TYPE', 'UNMAPPED_RELATION_TYPE', 'UNMAPPED_RELATION_TYPE',
    ].sort());
    const counts = phaseCounts(FINDINGS);
    expect(counts.STRUCTURE).toBe(7);
    expect(counts.COMPOSITION).toBe(4);
    expect(counts.SEMANTIC).toBe(0);
    expect(counts.RUNTIME_SUPPORT).toBe(3);
  });

  it('승인을 보류시키는 결함은 저장 전용 · 레코드 결함 계열뿐이다', () => {
    const held = FINDINGS.filter(f => f.blocksApproval);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(f => f.stage === 'validate' || f.stage === 'impact')).toBe(true);
    for (const f of held) expect(FINDING_PHASE[f.code], `${f.code} 단계`).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. §4.8 도구 의존성 경계 — Unleash parent 는 Topology 가 아니다
// ════════════════════════════════════════════════════════════════════════════

describe('Unleash 도구 경계', () => {
  it('parent payload 후보는 전부 미지원으로 보존하고 거절한다', () => {
    // 실측 FlagBinding 의 서로 다른 Flag 마다 후보 1건 + §4.8 이 지목한 FP-VEHICLE-BOOL-1 사례 1건.
    expect(TOOL_EDGE_CANDIDATES.length).toBe(new Set(FLAG_BINDINGS.map(f => f.flagVersionRef)).size + 1);
    expect(TOOL_EDGE_CANDIDATES.every(c => c.verdict === 'REJECT_UNSUPPORTED')).toBe(true);
    expect(TOOL_EDGE_CANDIDATES.every(c => c.fpAction && c.reason)).toBe(true);
    expect(TOOL_EDGE_CANDIDATES.some(c => c.flag === 'FP-VEHICLE-BOOL-1')).toBe(true);
  });

  it('도구 후보를 사전 15종의 requires 로 승격하지 않는다', () => {
    for (const c of TOOL_EDGE_CANDIDATES) {
      expect(c.payload).toContain('parent:');
      expect(c.reason).not.toContain('requires:');
      expect(CONTRACT_BY_TYPE.has('parent')).toBe(false);
    }
    // 도구 관계는 결함으로만 남고 그래프 관계가 되지 않는다.
    const toolFindings = FINDINGS.filter(f => f.code === 'TOOL_RELATION_NOT_TOPOLOGY');
    expect(toolFindings).toHaveLength(1);
    expect(toolFindings[0].severity).toBe('INFO');
    expect(toolFindings[0].stage).toBe('capability');
    expect(REAL_GRAPH.links.some(l => l.type === 'parent')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. §4.8 SegmentVersion 역탐색과 승인 Snapshot 경계
// ════════════════════════════════════════════════════════════════════════════

describe('SegmentVersion 역탐색', () => {
  it('FlagBinding → Policy 까지 실측으로 잇고 Offering · Release 는 frontier 로 남긴다', () => {
    expect(VIEW.impact.segmentRef).toBe(SEGMENT_REF);
    expect(VIEW.impact.rows.map(r => r.stage)).toEqual(['FLAG_BINDING', 'POLICY', 'OFFERING', 'RELEASE']);
    expect(VIEW.impact.rows.filter(r => r.linked).map(r => r.stage)).toEqual(['FLAG_BINDING', 'POLICY']);
    expect(VIEW.impact.complete).toBe(false);
    expect(VIEW.impact.frontier).toEqual(['OFFERING', 'RELEASE']);
    expect(VIEW.impact.liveRead).toBe(false);
  });

  it('미확보 단계의 사용처를 0건으로 지어내지 않는다 — notice 가 그 사실을 밝힌다', () => {
    const open = VIEW.impact.rows.filter(r => !r.linked);
    expect(open.every(r => r.found.length === 0)).toBe(true);
    expect(VIEW.impact.notice).toContain('미확보');
    expect(VIEW.impact.notice).toContain('제출할 수 없다');
    for (const stage of VIEW.impact.frontier) {
      expect(VIEW.impact.notice, `${stage} 미확보 명시`).toContain(SEGMENT_STAGE_KO[stage].ko);
    }
  });

  it('승인 Snapshot 은 live Segment 를 읽지 않는다', () => {
    expect(APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT).toBe(false);
    expect(assertSnapshotSegment('SEG-KR-PREMIUM').ok).toBe(false);
    expect(assertSnapshotSegment('SEG-KR-PREMIUM@2026.4').ok).toBe(true);
  });

  it('확보하지 못한 영향 목록이 남아 있으면 검증도 그 사실을 결함으로 남긴다', () => {
    expect(count('SEGMENT_IMPACT_INCOMPLETE')).toBe(1);
    const f = FINDINGS.find(x => x.code === 'SEGMENT_IMPACT_INCOMPLETE')!;
    expect(f.blocksApproval).toBe(true);
    expect(f.stage).toBe('impact');
  });

  it('임의 SegmentVersion 도 같은 규칙으로 판정한다 — 하드코딩된 결과가 아니다', () => {
    const other = segmentImpact('SEG-EU-BASE@2027.1');
    expect(other.rows).toHaveLength(4);
    expect(other.frontier.length).toBeGreaterThan(0);
    expect(other.complete).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. 화면 — 계약 계층이 실제로 그려진다
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

const tabButton = (container: HTMLElement, i: number) => [...container.querySelectorAll('.tabs button')][i];

describe('UI05 계약 계층 화면', () => {
  it('S03 이 관계 레코드 계약 표와 §4.5 이관 표를 그린다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 2));

    const card = screen.getByTestId('tp-record-contract');
    const rows = [...card.querySelectorAll('[data-testid^="tp-record-"]')];
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(
      VIEW.audit.filter(r => RECORD_SCOPE_TYPES.includes(r.type)).map(r => `tp-record-${r.edgeId}`),
    );
    // 사전 밖 유형(R1~R6)은 계약 표에 오지 않는다 — 이관 표가 담당한다.
    expect(rows.some(r => r.getAttribute('data-testid') === 'tp-record-R1')).toBe(false);

    const legacy = screen.getByTestId('tp-legacy-map');
    expect(legacy.textContent).toContain('독립 관계로 보존');
    expect(legacy.textContent).toContain('사람이 의미 확인');
    expect(legacy.textContent).toContain('requires 로 바꾸지 않는다');
  });

  it('S03 사전 카드가 유형별 실행 지원 · 순환 정책을 함께 보여 준다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 2));
    const dup = container.querySelector('[data-testid="vocab-duplicates"]')!.textContent ?? '';
    expect(dup).toContain('저장 전용');
    expect(dup).toContain('제약 수준 필수');
    const req = container.querySelector('[data-testid="vocab-requires"]')!.textContent ?? '';
    expect(req).toContain('의미 평가');
    expect(req).toContain('INCLUDED · INSTALLED · EFFECTIVE');
    expect(container.querySelectorAll('[data-testid^="vocab-"]')).toHaveLength(15);
  });

  it('S04 가 검증 4단계 rail 을 결함 수와 complete=false 로 그린다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 3));

    const card = screen.getByTestId('tp-verify-phases');
    const phases = [...card.querySelectorAll('[data-testid^="tp-phase-"]')];
    expect(phases.map(p => p.getAttribute('data-testid'))).toEqual([
      'tp-phase-STRUCTURE', 'tp-phase-COMPOSITION', 'tp-phase-SEMANTIC', 'tp-phase-RUNTIME_SUPPORT', 'tp-phase-frontier',
    ]);
    // 미해결 결함이 남으면 complete=false — 「전체 통과」로 표시하지 않는다.
    expect(card.querySelector('.tpa-phases')!.getAttribute('data-complete')).toBe('false');
    expect(screen.getByTestId('tp-phase-frontier').textContent).toContain('전체 통과 아님');
    const counts = phaseCounts(FINDINGS);
    for (const p of phases.slice(0, 4)) {
      const id = p.getAttribute('data-testid')!.replace('tp-phase-', '') as keyof typeof counts;
      expect(p.textContent, `${id} 결함 수`).toContain(`${counts[id]}건`);
    }
    expect(counts.STRUCTURE + counts.COMPOSITION + counts.SEMANTIC + counts.RUNTIME_SUPPORT).toBe(FINDINGS.length);
  });

  it('S04 가 requires 전체 경로와 요구 상태 판정 시점을 그린다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 3));

    const card = screen.getByTestId('tp-requires-paths');
    const rows = [...card.querySelectorAll('[data-testid^="tp-requires-"]')];
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['tp-requires-E2', 'tp-requires-E13', 'tp-requires-E14', 'tp-requires-E15']);
    expect(card.textContent).toContain('판정 시점 미도달');
    expect(card.textContent).toContain('미충족 — 승인 보류');
    expect(card.textContent).toContain('차량 탑재 확인 시');
    expect(card.textContent).toContain('구성 포함');
  });

  it('S04 가 배타 제약 수준 판정과 근거를 그린다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 3));

    const card = screen.getByTestId('tp-scope-verdicts');
    const rows = [...card.querySelectorAll('[data-testid^="tp-scope-"]')];
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['tp-scope-E3', 'tp-scope-E11']);
    expect(card.textContent).toContain('제약 수준 미선언');
    expect(card.textContent).toContain('공존 없음');
    expect(card.textContent).toContain('동시 활성 배타를 BOM 공존 금지로 확대하지 않는다');
  });

  it('S04 결함 표가 검증 단계와 승인 보류 여부를 함께 표시한다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 3));
    const held = [...container.querySelectorAll('tr[data-hold="true"]')];
    expect(held.length).toBe(FINDINGS.filter(f => f.blocksApproval).length);
    expect(held.every(r => r.textContent!.includes('승인 보류'))).toBe(true);
  });

  it('S06 이 Unleash 도구 경계와 Segment 역탐색을 그린다', () => {
    const { container } = renderArch();
    fireEvent.click(tabButton(container, 5));

    const boundary = screen.getByTestId('tp-unleash-boundary');
    expect(boundary.textContent).toContain('미지원 후보 — 보존 후 거절');
    expect(boundary.textContent).toContain('FP-VEHICLE-BOOL-1');
    expect(boundary.textContent).toContain('IF-FF-07');
    expect(boundary.textContent).toContain('NOT_RUN');
    expect(boundary.textContent).toContain('의존 판정 정본은 도구가 아니라 FP 다');
    expect([...boundary.querySelectorAll('[data-testid^="tp-tool-candidate-"]')]).toHaveLength(TOOL_EDGE_CANDIDATES.length);

    const impact = screen.getByTestId('tp-segment-impact');
    const rows = [...impact.querySelectorAll('[data-testid^="tp-segment-"]')];
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual([
      'tp-segment-FLAG_BINDING', 'tp-segment-POLICY', 'tp-segment-OFFERING', 'tp-segment-RELEASE',
    ]);
    expect(impact.textContent).toContain('APPROVAL_SNAPSHOT_READS_LIVE_SEGMENT=false');
    expect(impact.textContent).toContain('frontier');
  });

  it('새 블록이 늘어나도 상단 엔진은 6단계 5행 그대로다', () => {
    const { container } = renderArch();
    expect(container.querySelectorAll('[data-testid^="tp-stage-"]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-testid^="tp-link-"]')).toHaveLength(5);
    expect(container.querySelectorAll('.tabs button')).toHaveLength(7);
  });
});

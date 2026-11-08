// 분류 계층 L0~L5(B7 (b), FR-CAT-001·004, FR-REG-001-008) — Level 정합성·상위 존재·ID 재사용 금지·삭제 제한·경로·Feature 배치
import { describe, expect, it } from 'vitest';
import { CreateTaxonomyNodeBody, TAXONOMY_LEVELS, type TaxonomyTreeNode } from '../schemas/taxonomy-tree';
import { checkDeleteNode, checkNewNode, checkPlacement, classifyByLevel, levelOfRefdb, nodesBelow, taxonomyPath, toTree } from './taxonomy-tree';

const node = (o: Partial<TaxonomyTreeNode> & Pick<TaxonomyTreeNode, 'nodeId' | 'level' | 'parentId'>): TaxonomyTreeNode => ({
  name: o.nodeId, description: null, source: 'PLATFORM', status: 'ACTIVE', createdBy: 'usr-refdb', createdAt: '2026-11-07T00:00:00Z', updatedBy: null, updatedAt: null, ...o,
});
const BC = node({ nodeId: 'BC', level: 'L0', parentId: null, source: 'FEATURE_DB' });
const CL = node({ nodeId: 'BC:Access', level: 'L1', parentId: 'BC', source: 'FEATURE_DB' });
const L2 = node({ nodeId: 'BC-RDL', level: 'L2', parentId: 'BC:Access' });
const L3 = node({ nodeId: 'BC-RDL-SW', level: 'L3', parentId: 'BC-RDL' });
const L4 = node({ nodeId: 'BC-RDL-FLAG', level: 'L4', parentId: 'BC-RDL-SW' });
const L5 = node({ nodeId: 'BC-RDL-SIG', level: 'L5', parentId: 'BC-RDL-FLAG' });
const ALL = [BC, CL, L2, L3, L4, L5];
const map = new Map(ALL.map((n) => [n.nodeId, n]));

describe('Feature DB 분류 표 수준 → L 코드', () => {
  it('도메인 L0, 클러스터·컴포넌트 L1', () => {
    expect(levelOfRefdb('DOMAIN')).toBe('L0');
    expect(levelOfRefdb('CLUSTER')).toBe('L1');
    expect(levelOfRefdb('COMPONENT')).toBe('L1');
    expect(TAXONOMY_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
  });
});

describe('노드 등록 검증 @req FR-CAT-004-001 FR-CAT-004-002 FR-CAT-004-003 FR-CAT-004-004', () => {
  const used = new Set(['OLD-NODE']);
  const body = (o: Record<string, unknown>) => CreateTaxonomyNodeBody.parse({ nodeId: 'BC-RDL-2', name: '원격 도어 잠금 2', level: 'L2', parentId: 'BC:Access', ...o });
  it('정확히 한 단계 아래면 통과', () => {
    expect(checkNewNode(body({}), map, used)).toEqual({ ok: true });
  });
  it('상위 Node가 없으면 거부', () => {
    expect(checkNewNode(body({ parentId: 'NOPE' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_PARENT_NOT_FOUND' });
  });
  it('두 단계 건너뛰거나 같은 수준이면 거부(Level 정합성)', () => {
    expect(checkNewNode(body({ level: 'L3' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_LEVEL_MISMATCH' });
    expect(checkNewNode(body({ level: 'L1' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_LEVEL_MISMATCH' });
  });
  it('L0은 상위가 없어야 하고, L1~L5는 상위가 있어야 한다', () => {
    expect(checkNewNode(body({ nodeId: 'NEWDOM', level: 'L0', parentId: null }), map, used)).toEqual({ ok: true });
    expect(checkNewNode(body({ nodeId: 'NEWDOM', level: 'L0', parentId: 'BC' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_LEVEL_MISMATCH' });
    expect(checkNewNode(body({ parentId: null }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_PARENT_NOT_FOUND' });
  });
  it('쓴 적 있는 ID(삭제된 것 포함)는 다시 쓰지 않는다', () => {
    expect(checkNewNode(body({ nodeId: 'BC-RDL' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_ID_USED' });
    expect(checkNewNode(body({ nodeId: 'OLD-NODE' }), map, used)).toMatchObject({ ok: false, code: 'TAXONOMY_ID_USED' });
  });
  it('폐기된 상위에는 붙이지 않는다', () => {
    const retired = new Map(map).set('BC:Access', { ...CL, status: 'RETIRED' });
    expect(checkNewNode(body({}), retired, used)).toMatchObject({ ok: false, code: 'TAXONOMY_PARENT_RETIRED' });
  });
  it('Node ID 형식·L0~L5 밖 수준은 본문에서 거부', () => {
    expect(CreateTaxonomyNodeBody.safeParse({ nodeId: 'a b', name: '이름', level: 'L2', parentId: 'X' }).success).toBe(false);
    expect(CreateTaxonomyNodeBody.safeParse({ nodeId: 'AB', name: '이름', level: 'L6', parentId: 'X' }).success).toBe(false);
  });
});

describe('노드 삭제 제한 @req FR-CAT-004-007 FR-CAT-004-008', () => {
  it('하위 Node가 있으면 거부', () => {
    expect(checkDeleteNode(L4, { children: 1, features: 0 })).toMatchObject({ ok: false, code: 'TAXONOMY_HAS_CHILDREN' });
  });
  it('배치된 Feature가 있으면 거부(참조 있음 — 삭제 대신 폐기 안내)', () => {
    expect(checkDeleteNode(L5, { children: 0, features: 2 })).toMatchObject({ ok: false, code: 'TAXONOMY_HAS_FEATURES' });
  });
  it('Feature DB 발행 분류(L0·L1)는 이 화면에서 지우지 않는다', () => {
    expect(checkDeleteNode(BC, { children: 0, features: 0 })).toMatchObject({ ok: false, code: 'TAXONOMY_REFDB_MANAGED' });
  });
  it('참조 없는 플랫폼 노드는 삭제', () => {
    expect(checkDeleteNode(L5, { children: 0, features: 0 })).toEqual({ ok: true });
  });
});

describe('경로·트리·수준별 분류 @req FR-CAT-001-001 FR-CAT-001-006 FR-CAT-004-005 FR-CAT-004-010', () => {
  it('L0에서 노드까지 경로', () => {
    expect(taxonomyPath('BC-RDL-SIG', map).map((n) => n.level)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
    expect(taxonomyPath('NOPE', map)).toEqual([]);
  });
  it('노드 아래 전부(깊이 순)', () => {
    expect(nodesBelow('BC-RDL', ALL).map((n) => n.nodeId)).toEqual(['BC-RDL-SW', 'BC-RDL-FLAG', 'BC-RDL-SIG']);
  });
  it('계층 트리 — 하위 수·배치 수', () => {
    const tree = toTree(ALL, new Map([['BC-RDL', ['FEAT-00001']]]));
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0]).toMatchObject({ nodeId: 'BC-RDL', featureCount: 1, childCount: 1 });
  });
  it('수준별 분류 — 노드 위·아래 한 경로에 배치된 Feature를 모은다', () => {
    const placed = new Map([['FEAT-00001', 'BC-RDL-FLAG'], ['FEAT-00002', 'BC-RDL']]);
    const l2 = classifyByLevel('L2', ALL, placed);
    expect(l2).toEqual([{ node: L2, featureIds: ['FEAT-00001', 'FEAT-00002'] }]);
    expect(classifyByLevel('L4', ALL, placed)).toEqual([{ node: L4, featureIds: ['FEAT-00001', 'FEAT-00002'] }]); // FEAT-00002는 L2에 배치 — 그 아래 Flag 노드로 분류
    expect(classifyByLevel('L0', ALL, placed)[0].featureIds).toEqual(['FEAT-00001', 'FEAT-00002']);
  });
});

describe('Feature 배치 @req FR-CAT-004-009 FR-REG-001-008', () => {
  it('Feature 분류 수준과 노드 수준이 같아야 한다', () => {
    expect(checkPlacement('L2', L2)).toEqual({ ok: true });
    expect(checkPlacement('L2', L3)).toMatchObject({ ok: false, code: 'TAXONOMY_PLACEMENT_LEVEL' });
  });
  it('폐기 노드에는 배치하지 않는다', () => {
    expect(checkPlacement('L2', { ...L2, status: 'RETIRED' })).toMatchObject({ ok: false, code: 'TAXONOMY_PARENT_RETIRED' });
  });
});

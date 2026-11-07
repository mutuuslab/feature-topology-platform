// 분류 계층 L0~L5 규칙(B7 (b)) — 노드 등록(상위 존재·한 단계 아래·ID 재사용 금지)·삭제 제한(하위·배치·Feature DB 관리)·경로·트리·수준별 분류·Feature 배치.
// 백엔드(taxonomy-tree.service)·화면(분류 계층·Feature 상세 분류 경로)이 같은 판정을 쓴다.
import type { Role } from '../enums';
import { TAXONOMY_LEVELS, type CreateTaxonomyNodeBody, type TaxonomyLevelCode, type TaxonomyTreeNode, type TaxonomyTreeView } from '../schemas/taxonomy-tree';

/** 노드 등록·수정·삭제 — Feature DB 관리자(분류·출처 관리, 30-95 §8.1) */
export const TAXONOMY_EDITOR_ROLES: Role[] = ['REFDB_ADMIN'];
/** Feature 배치 — Feature 작성자·Feature DB 관리자 */
export const TAXONOMY_PLACEMENT_ROLES: Role[] = ['FEATURE_AUTHOR', 'REFDB_ADMIN'];

export type TaxonomyCode =
  | 'TAXONOMY_ID_USED'
  | 'TAXONOMY_PARENT_NOT_FOUND'
  | 'TAXONOMY_PARENT_RETIRED'
  | 'TAXONOMY_LEVEL_MISMATCH'
  | 'TAXONOMY_HAS_CHILDREN'
  | 'TAXONOMY_HAS_FEATURES'
  | 'TAXONOMY_REFDB_MANAGED'
  | 'TAXONOMY_PLACEMENT_LEVEL';
export type TaxonomyCheck = { ok: true } | { ok: false; code: TaxonomyCode; message: string };
const fail = (code: TaxonomyCode, message: string): TaxonomyCheck => ({ ok: false, code, message });

export const levelIndex = (l: TaxonomyLevelCode) => TAXONOMY_LEVELS.indexOf(l);
/** Feature DB 분류 표 수준(30-95 §4) → L 코드. 컴포넌트는 클러스터와 같은 L1(도메인 바로 아래 — 엑셀 D열) */
export const levelOfRefdb = (level: 'DOMAIN' | 'CLUSTER' | 'COMPONENT'): TaxonomyLevelCode => (level === 'DOMAIN' ? 'L0' : 'L1');

/** 등록 검증 — usedIds는 지금까지 쓴 모든 ID(삭제 묘비 포함) @req FR-CAT-004-002 FR-CAT-004-003 FR-CAT-004-004 */
export function checkNewNode(b: Pick<CreateTaxonomyNodeBody, 'nodeId' | 'level' | 'parentId'>, nodes: ReadonlyMap<string, TaxonomyTreeNode>, usedIds: ReadonlySet<string>): TaxonomyCheck {
  if (nodes.has(b.nodeId) || usedIds.has(b.nodeId)) return fail('TAXONOMY_ID_USED', `Node ID ${b.nodeId}은(는) 이미 쓴 적이 있습니다 — 삭제된 ID도 다시 쓰지 않습니다.`);
  if (b.level === 'L0') return b.parentId ? fail('TAXONOMY_LEVEL_MISMATCH', 'L0 노드는 상위 Node가 없습니다.') : { ok: true };
  if (!b.parentId) return fail('TAXONOMY_PARENT_NOT_FOUND', `${b.level} 노드는 상위 Node ID가 필요합니다.`);
  const parent = nodes.get(b.parentId);
  if (!parent) return fail('TAXONOMY_PARENT_NOT_FOUND', `상위 Node ${b.parentId}이(가) 등록되어 있지 않습니다.`);
  if (parent.status !== 'ACTIVE') return fail('TAXONOMY_PARENT_RETIRED', `상위 Node ${b.parentId}은(는) 폐기되었습니다.`);
  if (levelIndex(b.level) !== levelIndex(parent.level) + 1)
    return fail('TAXONOMY_LEVEL_MISMATCH', `상위 Node ${b.parentId}이(가) ${parent.level}이므로 ${TAXONOMY_LEVELS[levelIndex(parent.level) + 1] ?? '하위 없음'}만 등록할 수 있습니다(요청 ${b.level}).`);
  return { ok: true };
}

/** 삭제 검증 — 공용 초안 삭제 규칙(B2)과 같은 뜻: 참조(하위 노드·배치된 Feature)가 없을 때만 지우고, 지운 ID는 다시 쓰지 않는다 @req FR-CAT-004-007 FR-CAT-004-008 */
export function checkDeleteNode(n: TaxonomyTreeNode, refs: { children: number; features: number }): TaxonomyCheck {
  if (n.source === 'FEATURE_DB') return fail('TAXONOMY_REFDB_MANAGED', `${n.nodeId}은(는) Feature DB 발행 분류입니다 — Feature DB 변경 요청으로 폐기합니다.`);
  if (refs.children > 0) return fail('TAXONOMY_HAS_CHILDREN', `하위 Node ${refs.children}개가 있어 ${n.nodeId}을(를) 삭제할 수 없습니다 — 하위부터 정리하세요.`);
  if (refs.features > 0) return fail('TAXONOMY_HAS_FEATURES', `Feature ${refs.features}개가 배치되어 있어 삭제할 수 없습니다 — 배치를 옮기세요.`);
  return { ok: true };
}

/** Feature 배치 — Feature 분류 수준의 노드에만 @req FR-CAT-004-009 */
export function checkPlacement(featureLevel: TaxonomyLevelCode, node: TaxonomyTreeNode): TaxonomyCheck {
  if (node.status !== 'ACTIVE') return fail('TAXONOMY_PARENT_RETIRED', `${node.nodeId}은(는) 폐기된 노드입니다.`);
  if (node.level !== featureLevel) return fail('TAXONOMY_PLACEMENT_LEVEL', `Feature 분류 수준은 ${featureLevel}인데 ${node.nodeId}은(는) ${node.level}입니다 — 같은 수준의 노드에 배치하세요.`);
  return { ok: true };
}

/** L0에서 노드까지(없으면 빈 배열) @req FR-CAT-004-010 */
export function taxonomyPath(nodeId: string, nodes: ReadonlyMap<string, TaxonomyTreeNode>): TaxonomyTreeNode[] {
  const out: TaxonomyTreeNode[] = [];
  const seen = new Set<string>();
  let cur = nodes.get(nodeId);
  while (cur && !seen.has(cur.nodeId)) {
    seen.add(cur.nodeId);
    out.unshift(cur);
    cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
  }
  return out;
}

const childrenIndex = (all: readonly TaxonomyTreeNode[]) => {
  const m = new Map<string, TaxonomyTreeNode[]>();
  for (const n of all) if (n.parentId) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n]);
  for (const v of m.values()) v.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return m;
};

/** 노드 아래 전부 — 깊이 우선(부모 다음 자식) */
export function nodesBelow(nodeId: string, all: readonly TaxonomyTreeNode[]): TaxonomyTreeNode[] {
  const kids = childrenIndex(all);
  const out: TaxonomyTreeNode[] = [];
  const walk = (id: string) => {
    for (const c of kids.get(id) ?? []) {
      out.push(c);
      walk(c.nodeId);
    }
  };
  walk(nodeId);
  return out;
}

/** 계층 트리 — placedByNode: 노드 ID → 바로 배치된 Feature ID @req FR-CAT-004-005 */
export function toTree(all: readonly TaxonomyTreeNode[], placedByNode: ReadonlyMap<string, readonly string[]>): TaxonomyTreeView[] {
  const kids = childrenIndex(all);
  const build = (n: TaxonomyTreeNode): TaxonomyTreeView => {
    const children = (kids.get(n.nodeId) ?? []).map(build);
    return { ...n, childCount: children.length, featureCount: placedByNode.get(n.nodeId)?.length ?? 0, children };
  };
  const ids = new Set(all.map((n) => n.nodeId));
  return all.filter((n) => !n.parentId || !ids.has(n.parentId)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)).map(build);
}

/** 수준별 분류 — 그 수준의 노드마다 자기와 아래에 배치된 Feature(placed: Feature ID → 노드 ID) @req FR-CAT-001-001 FR-CAT-001-002 FR-CAT-001-003 FR-CAT-001-004 FR-CAT-001-005 FR-CAT-001-006 */
export function classifyByLevel(level: TaxonomyLevelCode, all: readonly TaxonomyTreeNode[], placed: ReadonlyMap<string, string>): { node: TaxonomyTreeNode; featureIds: string[] }[] {
  const byId = new Map(all.map((n) => [n.nodeId, n]));
  const out = new Map<string, Set<string>>();
  for (const [featureId, nodeId] of placed) {
    const hit = taxonomyPath(nodeId, byId).find((n) => n.level === level);
    if (hit) out.set(hit.nodeId, (out.get(hit.nodeId) ?? new Set()).add(featureId));
  }
  return all
    .filter((n) => n.level === level && out.has(n.nodeId))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    .map((node) => ({ node, featureIds: [...out.get(node.nodeId)!].sort() }));
}

// 분류 계층·정책 글로벌 적용 조건 저장소(TX, 261_taxonomy_global_scope) — 플랫폼 노드·삭제 묘비(추가만)·Feature 배치, 정책의 브랜드·지역 코드·룰 조건과 조회 색인.
import { Inject, Injectable } from '@nestjs/common';
import type { FeaturePlacement, PolicyGlobalScope, TaxonomyTreeNode } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

const parse = <T>(rows: { doc: string }[]): T[] => rows.map((r) => JSON.parse(r.doc) as T);

@Injectable()
export class TaxonomyRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ── 플랫폼 노드 ──
  nodes(): TaxonomyTreeNode[] {
    return parse<TaxonomyTreeNode>(this.db.all('SELECT doc FROM taxonomy_level_node ORDER BY node_id'));
  }
  node(nodeId: string): TaxonomyTreeNode | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM taxonomy_level_node WHERE node_id = ?', nodeId);
    return r ? (JSON.parse(r.doc) as TaxonomyTreeNode) : undefined;
  }
  countNodes(): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM taxonomy_level_node')!.n);
  }
  insertNode(n: TaxonomyTreeNode) {
    this.db.run('INSERT INTO taxonomy_level_node (node_id, level, parent_id, status, doc) VALUES (?, ?, ?, ?, ?)', n.nodeId, n.level, n.parentId, n.status, JSON.stringify(n));
  }
  updateNode(n: TaxonomyTreeNode) {
    this.db.run('UPDATE taxonomy_level_node SET status = ?, doc = ? WHERE node_id = ?', n.status, JSON.stringify(n), n.nodeId);
  }
  /** 삭제 — 같은 트랜잭션에서 묘비를 남긴다(ID 재사용 금지) */
  deleteNode(n: TaxonomyTreeNode, by: string, at: string, reason: string) {
    this.db.run('DELETE FROM taxonomy_level_node WHERE node_id = ?', n.nodeId);
    this.db.run('INSERT INTO taxonomy_node_tombstone (node_id, deleted_by, deleted_at, doc) VALUES (?, ?, ?, ?)', n.nodeId, by, at, JSON.stringify({ ...n, reason }));
  }
  tombstoneIds(): string[] {
    return this.db.all<{ id: string }>('SELECT node_id AS id FROM taxonomy_node_tombstone').map((r) => r.id);
  }
  childCount(nodeId: string): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM taxonomy_level_node WHERE parent_id = ?', nodeId)!.n);
  }

  // ── Feature 배치 ──
  placements(): FeaturePlacement[] {
    return parse<FeaturePlacement>(this.db.all('SELECT doc FROM feature_taxonomy_placement ORDER BY feature_id'));
  }
  placement(featureId: string): FeaturePlacement | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_taxonomy_placement WHERE feature_id = ?', featureId);
    return r ? (JSON.parse(r.doc) as FeaturePlacement) : undefined;
  }
  placedCount(nodeId: string): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM feature_taxonomy_placement WHERE node_id = ?', nodeId)!.n);
  }
  upsertPlacement(p: FeaturePlacement) {
    this.db.run('DELETE FROM feature_taxonomy_placement WHERE feature_id = ?', p.featureId);
    this.db.run('INSERT INTO feature_taxonomy_placement (feature_id, node_id, doc) VALUES (?, ?, ?)', p.featureId, p.nodeId, JSON.stringify(p));
  }

  // ── 정책 글로벌 적용 조건 ──
  scopes(): PolicyGlobalScope[] {
    return parse<PolicyGlobalScope>(this.db.all('SELECT doc FROM policy_global_scope ORDER BY policy_id'));
  }
  scope(policyId: string): PolicyGlobalScope | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM policy_global_scope WHERE policy_id = ?', policyId);
    return r ? (JSON.parse(r.doc) as PolicyGlobalScope) : undefined;
  }
  /** 조건 값으로 정책 ID — 색인 표에서 */
  policiesWith(kind: 'BRAND' | 'REGION' | 'RULE', value: string): string[] {
    return this.db.all<{ id: string }>('SELECT policy_id AS id FROM policy_global_link WHERE kind = ? AND value = ? ORDER BY policy_id', kind, value).map((r) => r.id);
  }
  countScopes(): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM policy_global_scope')!.n);
  }
  /** 저장(등록·수정) — 본문과 색인을 같이 바꾼다. 호출자가 트랜잭션을 연다 */
  saveScope(s: PolicyGlobalScope) {
    this.db.run('DELETE FROM policy_global_scope WHERE policy_id = ?', s.policyId);
    this.db.run('INSERT INTO policy_global_scope (policy_id, feature_id, revision, doc) VALUES (?, ?, ?, ?)', s.policyId, s.featureId, s.revision, JSON.stringify(s));
    this.db.run('DELETE FROM policy_global_link WHERE policy_id = ?', s.policyId);
    const links: [string, string][] = [...s.brands.map((v) => ['BRAND', v] as [string, string]), ...s.regionCodes.map((v) => ['REGION', v] as [string, string]), ...s.complianceRuleIds.map((v) => ['RULE', v] as [string, string])];
    for (const [kind, value] of links) this.db.run('INSERT INTO policy_global_link (policy_id, kind, value) VALUES (?, ?, ?)', s.policyId, kind, value);
  }
}

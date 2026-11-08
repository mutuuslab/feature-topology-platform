// 분류 계층 L0~L5(TX, B7 (b), D01-01) — Feature DB 발행 분류(도메인 L0·클러스터/컴포넌트 L1, 읽기 전용)와 플랫폼 노드(L0~L5)를 한 트리로 보여 주고,
// 노드 등록·수정·삭제(하위·배치가 있으면 거부, 지운 ID는 묘비로 재사용 금지)와 Feature 배치(Feature 분류 수준의 노드 하나)·L0~L5 경로를 맡는다.
// 판정은 contracts rules/taxonomy-tree 한 곳. 데모 시드는 시드 Feature의 대표 기준 행으로 L2 노드를 만들고 배포 정책이 있는 Feature에 L3~L5를 붙인다.
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  checkDeleteNode,
  checkNewNode,
  checkPlacement,
  classifyByLevel,
  FEATURE_BASE_LEVEL,
  levelOfRefdb,
  nodesBelow,
  TAXONOMY_LEVEL_LABEL,
  TAXONOMY_LEVELS,
  TaxonomyLevelCode,
  taxonomyPath,
  toTree,
  type CreateTaxonomyNodeBody,
  type DeleteTaxonomyNodeBody,
  type FeaturePlacement,
  type FeatureVersionRow,
  type PlaceFeatureBody,
  type TaxonomyCheck,
  type TaxonomyTreeNode,
  type UpdateTaxonomyNodeBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError, type ErrorCode } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { PolicyRepo } from '../policy-repos';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo } from '../repos';
import { TaxonomyRepo } from './taxonomy.repo';

const COMPONENT = 'D01-01';
const ACTION = { create: 'TAXONOMY_NODE_CREATE', update: 'TAXONOMY_NODE_UPDATE', remove: 'TAXONOMY_NODE_DELETE', place: 'FEATURE_TAXONOMY_PLACE' } as const;
/** 거부 코드 → HTTP 오류 분류 */
const HTTP: Record<Exclude<TaxonomyCheck, { ok: true }>['code'], ErrorCode> = {
  TAXONOMY_ID_USED: 'CONFLICT',
  TAXONOMY_PARENT_NOT_FOUND: 'VALIDATION',
  TAXONOMY_PARENT_RETIRED: 'VALIDATION',
  TAXONOMY_LEVEL_MISMATCH: 'VALIDATION',
  TAXONOMY_HAS_CHILDREN: 'CONFLICT',
  TAXONOMY_HAS_FEATURES: 'CONFLICT',
  TAXONOMY_REFDB_MANAGED: 'IMMUTABLE',
  TAXONOMY_PLACEMENT_LEVEL: 'VALIDATION',
};
/** 데모 시드 등록자 — 실제 계정이 아니라 시드 표시 */
const SEED_ACTOR = 'seed-taxonomy';
const FEATURE_DB_ACTOR = 'Feature DB';

export const levelOf = (v: string | undefined): TaxonomyLevelCode | undefined => {
  if (!v) return undefined;
  const r = TaxonomyLevelCode.safeParse(v);
  if (!r.success) throw new DomainError('VALIDATION', `분류 수준은 ${TAXONOMY_LEVELS.join('·')} 중 하나입니다.`, { field: 'level' });
  return r.data;
};

@Injectable()
@PlatformComponent(COMPONENT)
export class TaxonomyService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: TaxonomyRepo,
    private readonly refdb: RefdbRepository,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (isProduction() || seedOf() === 'none' || this.repo.countNodes() > 0) return;
    this.seed();
  }

  // ── 조회 ──
  /** Feature DB 분류(읽기 전용)를 L 코드로 + 플랫폼 노드 */
  allNodes(): TaxonomyTreeNode[] {
    const release = this.refdb.latestRelease();
    const fromRefdb = this.refdb.taxonomy().map(
      (n): TaxonomyTreeNode => ({
        nodeId: n.nodeId,
        name: n.nameKo || n.nameEn,
        level: levelOfRefdb(n.level),
        parentId: n.parentId,
        description: n.nameKo && n.nameKo !== n.nameEn ? n.nameEn : null,
        source: 'FEATURE_DB',
        status: n.status,
        createdBy: FEATURE_DB_ACTOR,
        createdAt: release?.publishedAt ?? '',
        updatedBy: null,
        updatedAt: null,
      }),
    );
    return [...fromRefdb, ...this.repo.nodes()];
  }
  private nodeMap() {
    return new Map(this.allNodes().map((n) => [n.nodeId, n]));
  }
  private latest(featureId: string): FeatureVersionRow | undefined {
    return this.features.versions(featureId).at(-1);
  }
  private placedMap() {
    return new Map(this.repo.placements().map((p) => [p.featureId, p.nodeId]));
  }

  /** 수준별 개요 — 노드 수·분류된 Feature 수 @req FR-CAT-001-001 FR-CAT-001-002 FR-CAT-001-003 FR-CAT-001-004 FR-CAT-001-005 FR-CAT-001-006 */
  levels() {
    const all = this.allNodes();
    const placed = this.placedMap();
    return {
      items: TAXONOMY_LEVELS.map((level) => {
        const groups = classifyByLevel(level, all, placed);
        return { level, label: TAXONOMY_LEVEL_LABEL[level], nodes: all.filter((n) => n.level === level).length, classifiedNodes: groups.length, features: new Set(groups.flatMap((g) => g.featureIds)).size };
      }),
      placements: placed.size,
    };
  }

  /** 계층 트리(기본) 또는 수준·상위로 거른 평면 목록 @req FR-CAT-004-005 */
  nodes(q: { level?: string; parentId?: string } = {}) {
    const all = this.allNodes();
    const byNode = new Map<string, string[]>();
    for (const p of this.repo.placements()) byNode.set(p.nodeId, [...(byNode.get(p.nodeId) ?? []), p.featureId]);
    const level = levelOf(q.level);
    if (level || q.parentId) {
      const items = all.filter((n) => (!level || n.level === level) && (!q.parentId || n.parentId === q.parentId)).map((n) => ({ ...n, featureCount: byNode.get(n.nodeId)?.length ?? 0, childCount: all.filter((c) => c.parentId === n.nodeId).length }));
      return { total: items.length, items, tree: [] };
    }
    const tree = toTree(all, byNode);
    return { total: all.length, items: [], tree };
  }

  /** 수준 하나의 분류 — 노드마다 L0부터의 경로와 연결된 Feature */
  classify(levelText: string) {
    const level = levelOf(levelText)!;
    const all = this.allNodes();
    const byId = new Map(all.map((n) => [n.nodeId, n]));
    const groups = classifyByLevel(level, all, this.placedMap());
    return {
      level,
      label: TAXONOMY_LEVEL_LABEL[level],
      items: groups.map((g) => ({
        node: g.node,
        path: taxonomyPath(g.node.nodeId, byId).map((n) => ({ nodeId: n.nodeId, name: n.name, level: n.level })),
        features: g.featureIds.map((id) => {
          const f = this.latest(id);
          return { featureId: id, version: f?.version ?? null, name: f?.name ?? id, lifecycle: f?.lifecycle ?? null, taxonomyLevel: f?.taxonomyLevel ?? FEATURE_BASE_LEVEL };
        }),
      })),
    };
  }

  /** Feature의 분류 수준·배치·L0부터 배치 노드까지 경로·배치 노드 아래(SW·Flag·신호 구성) @req FR-CAT-004-010 */
  featureView(featureId: string) {
    const f = this.latest(featureId);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const all = this.allNodes();
    const byId = new Map(all.map((n) => [n.nodeId, n]));
    const placement = this.repo.placement(featureId) ?? null;
    const level = f.taxonomyLevel ?? FEATURE_BASE_LEVEL;
    return {
      featureId,
      version: f.version,
      name: f.name,
      ownerId: f.ownerId,
      taxonomyLevel: level,
      placement,
      path: placement ? taxonomyPath(placement.nodeId, byId) : [],
      below: placement ? nodesBelow(placement.nodeId, all) : [],
      /** 배치할 수 있는 노드 — Feature 분류 수준의 사용 중 노드 */
      candidates: all.filter((n) => n.level === level && n.status === 'ACTIVE').map((n) => ({ nodeId: n.nodeId, name: n.name, path: taxonomyPath(n.nodeId, byId).map((p) => p.name).join(' › ') })),
    };
  }

  // ── 변경 ──
  private reject(actor: Actor, action: string, target: string, r: Exclude<TaxonomyCheck, { ok: true }>): never {
    this.audit.failed(actor, action, target, r.message, COMPONENT);
    throw new DomainError(HTTP[r.code], r.message, { code: r.code });
  }

  /** 노드 등록 — 상위 존재·한 단계 아래·ID 재사용 금지 @req FR-CAT-004-001 FR-CAT-004-002 FR-CAT-004-003 FR-CAT-004-004 */
  create(actor: Actor, body: CreateTaxonomyNodeBody): TaxonomyTreeNode {
    const r = checkNewNode(body, this.nodeMap(), new Set(this.repo.tombstoneIds()));
    if ('code' in r) this.reject(actor, ACTION.create, body.nodeId, r);
    return this.db.tx(() => {
      const n: TaxonomyTreeNode = { nodeId: body.nodeId, name: body.name, level: body.level, parentId: body.parentId, description: body.description, source: 'PLATFORM', status: 'ACTIVE', createdBy: actor.id, createdAt: this.clock.iso(), updatedBy: null, updatedAt: null };
      this.repo.insertNode(n);
      this.audit.record(actor, ACTION.create, n.nodeId, { after: n, reason: body.reason, componentId: COMPONENT });
      this.events.publish('taxonomy.node.created', n.nodeId, { nodeId: n.nodeId, level: n.level, parentId: n.parentId }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return n;
    });
  }

  /** 노드 수정 — 명칭·설명(수준·상위는 그대로) @req FR-CAT-004-006 */
  update(actor: Actor, nodeId: string, body: UpdateTaxonomyNodeBody): TaxonomyTreeNode {
    const cur = this.repo.node(nodeId);
    if (!cur) {
      if (this.nodeMap().get(nodeId)?.source === 'FEATURE_DB') this.reject(actor, ACTION.update, nodeId, { ok: false, code: 'TAXONOMY_REFDB_MANAGED', message: `${nodeId}은(는) Feature DB 발행 분류입니다 — Feature DB 변경 요청으로 고칩니다.` });
      throw new DomainError('NOT_FOUND', `분류 노드 ${nodeId}이(가) 없습니다.`);
    }
    return this.db.tx(() => {
      const next: TaxonomyTreeNode = { ...cur, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), updatedBy: actor.id, updatedAt: this.clock.iso() };
      this.repo.updateNode(next);
      this.audit.record(actor, ACTION.update, nodeId, { before: { name: cur.name, description: cur.description }, after: { name: next.name, description: next.description }, reason: body.reason, componentId: COMPONENT });
      this.events.publish('taxonomy.node.updated', nodeId, { nodeId }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return next;
    });
  }

  /** 노드 삭제 — 하위·배치가 있으면 거부, Feature DB 분류는 거부, 지운 ID는 묘비 @req FR-CAT-004-007 FR-CAT-004-008 */
  remove(actor: Actor, nodeId: string, body: DeleteTaxonomyNodeBody) {
    const n = this.nodeMap().get(nodeId);
    if (!n) throw new DomainError('NOT_FOUND', `분류 노드 ${nodeId}이(가) 없습니다.`);
    const r = checkDeleteNode(n, { children: this.allNodes().filter((c) => c.parentId === nodeId).length, features: this.repo.placedCount(nodeId) });
    if ('code' in r) this.reject(actor, ACTION.remove, nodeId, r);
    return this.db.tx(() => {
      const at = this.clock.iso();
      this.repo.deleteNode(n, actor.id, at, body.reason);
      this.audit.record(actor, ACTION.remove, nodeId, { before: n, reason: body.reason, componentId: COMPONENT });
      this.events.publish('taxonomy.node.deleted', nodeId, { nodeId, level: n.level }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return { nodeId, deleted: true, deletedAt: at };
    });
  }

  /** Feature 배치 — Feature 분류 수준의 노드 하나, 다시 배치하면 바꾼다 @req FR-CAT-004-009 */
  place(actor: Actor, featureId: string, body: PlaceFeatureBody): FeaturePlacement {
    const f = this.latest(featureId);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const node = this.nodeMap().get(body.nodeId);
    if (!node) this.reject(actor, ACTION.place, featureId, { ok: false, code: 'TAXONOMY_PARENT_NOT_FOUND', message: `분류 노드 ${body.nodeId}이(가) 없습니다.` });
    const r = checkPlacement(f.taxonomyLevel ?? FEATURE_BASE_LEVEL, node!);
    if ('code' in r) this.reject(actor, ACTION.place, featureId, r);
    const before = this.repo.placement(featureId) ?? null;
    return this.db.tx(() => {
      const p: FeaturePlacement = { featureId, nodeId: body.nodeId, placedBy: actor.id, placedAt: this.clock.iso() };
      this.repo.upsertPlacement(p);
      this.audit.record(actor, ACTION.place, featureId, { before: before ? { nodeId: before.nodeId } : null, after: { nodeId: p.nodeId }, reason: body.reason, componentId: COMPONENT });
      this.events.publish('feature.taxonomy.placed', featureId, { featureId, nodeId: p.nodeId, from: before?.nodeId ?? null }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return p;
    });
  }

  // ── 데모 시드 ──
  /** 시드 Feature의 대표 기준 행 → L2 노드(상위: 그 행의 클러스터), 배포 정책이 있는 Feature는 SW(L3)·Flag(L4)·신호(L5)까지 */
  private seed() {
    const nodes = this.nodeMap();
    const latest = new Map<string, FeatureVersionRow>();
    for (const f of this.features.all()) latest.set(f.featureId, f);
    const out: TaxonomyTreeNode[] = [];
    const placements: FeaturePlacement[] = [];
    const at = this.clock.iso();
    const mk = (nodeId: string, level: TaxonomyLevelCode, parentId: string, name: string, description: string | null) => {
      if (nodes.has(nodeId)) return;
      const n: TaxonomyTreeNode = { nodeId, name, level, parentId, description, source: 'PLATFORM', status: 'ACTIVE', createdBy: SEED_ACTOR, createdAt: at, updatedBy: null, updatedAt: null };
      nodes.set(nodeId, n);
      out.push(n);
    };
    let deep = 0;
    for (const f of latest.values()) {
      if (f.lifecycle === 'RETIRED') continue;
      const refId = f.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;
      const ref = refId ? this.refdb.getRef(refId) : undefined;
      if (!refId || !ref) continue;
      const abbr = refId.split('-')[0];
      const parent = [`${abbr}:${ref.cluster}`, `${abbr}/${ref.component}`, abbr].find((id) => nodes.get(id)?.source === 'FEATURE_DB');
      if (!parent) continue;
      mk(refId, 'L2', parent, ref.nameKo || ref.nameEn, `기준 기능 ${refId}`);
      placements.push({ featureId: f.featureId, nodeId: refId, placedBy: SEED_ACTOR, placedAt: at });
      const pol = this.policies.forFeature(f.featureId, f.version).find((p) => p.status !== 'RETIRED');
      if (!pol || !f.swIds[0] || deep >= 24) continue;
      deep++;
      const sw = `${refId}.SW1`;
      const flag = `${sw}.F1`;
      mk(sw, 'L3', refId, `${f.swIds[0]}${f.swVersions[0] ? ` ${f.swVersions[0]}` : ''}`, f.functions[0]?.label ?? null);
      mk(flag, 'L4', sw, pol.flagKey, `${pol.controlPoint} 제어점 정책 ${pol.policyId}`);
      mk(`${flag}.C1`, 'L5', flag, `${pol.flagKey} 판정 신호`, f.ecuPnos[0] ? `제어기 ${f.ecuPnos[0]}` : null);
    }
    if (!out.length) return;
    this.db.tx(() => {
      for (const n of out) this.repo.insertNode(n);
      for (const p of placements) this.repo.upsertPlacement(p);
    });
  }
}

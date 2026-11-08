// Browser-local TX uses the same domain rules as native. Missing snapshots are source failures, not empty successes.
import { compareVersion } from '@ff/contracts';
import { CreateTaxonomyNodeBody, DeleteTaxonomyNodeBody, FEATURE_BASE_LEVEL, PlaceFeatureBody, TAXONOMY_LEVEL_LABEL, TaxonomyLevelCode, TAXONOMY_LEVELS, UpdateTaxonomyNodeBody, type FeaturePlacement, type TaxonomyTreeNode, type TaxonomyTreeView } from '../../../../../contracts/src/schemas/taxonomy-tree';
import { BRAND_LABEL, BRANDS, isBrand, PolicyGlobalScopeBody, type PolicyGlobalScope } from '../../../../../contracts/src/schemas/global-scope';
import { canEditGlobalScope, matchGlobalScopes } from '../../../../../contracts/src/rules/global-scope';
import { checkDeleteNode, checkNewNode, checkPlacement, classifyByLevel, nodesBelow, taxonomyPath, toTree, type TaxonomyCheck } from '../../../../../contracts/src/rules/taxonomy-tree';
import { isRegionCode, REGION_CODE_TABLE, regionCodeFormatIssues, variantRuleCandidates } from '../../../../../contracts/src/rules/region-code';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

const NODE = 'txNode', TOMBSTONE = 'txTombstone', PLACEMENT = 'txPlacement', SCOPE = 'txGlobalScope';
const COMPONENT = 'D01-01';
const sourceFailure = (name: string): never => { throw new SimError('INTERNAL', `분류·적용 조건 원천 스냅샷을 읽을 수 없습니다: ${name}`, { source: name }); };
async function snapshot<T>(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): Promise<T> {
  const value = await ctx.snapshot<T>(name, params, query);
  return value ?? sourceFailure(name);
}
const levelOf = (value: string) => {
  const parsed = TaxonomyLevelCode.safeParse(value);
  if (!parsed.success) throw new SimError('VALIDATION', `분류 수준은 ${TAXONOMY_LEVELS.join('·')} 중 하나입니다.`, { field: 'level' });
  return parsed.data;
};
async function allNodes(ctx: SimReadContext): Promise<TaxonomyTreeNode[]> {
  const base = await snapshot<{ tree: TaxonomyTreeView[]; items: TaxonomyTreeNode[]; total: number }>(ctx, 'taxonomyNodes');
  if (!Array.isArray(base.tree) || !Array.isArray(base.items)) return sourceFailure('taxonomyNodes');
  const map = new Map<string, TaxonomyTreeNode>();
  const add = (node: TaxonomyTreeNode & { children?: TaxonomyTreeView[] }) => {
    const { children, ...rest } = node;
    // Drop computed tree counters; a subsequent placement must recompute them.
    const { childCount: _children, featureCount: _features, ...data } = rest as TaxonomyTreeNode & { childCount?: number; featureCount?: number };
    map.set(node.nodeId, data);
    for (const child of children ?? []) add(child);
  };
  base.tree.forEach(add); base.items.forEach(add);
  for (const node of ctx.list<TaxonomyTreeNode>(NODE)) map.set(node.nodeId, node);
  for (const tombstone of ctx.list<{ nodeId: string }>(TOMBSTONE)) map.delete(tombstone.nodeId);
  return [...map.values()];
}
async function placements(ctx: SimReadContext): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const fs = await snapshot<{ items: { featureId: string }[] }>(ctx, 'listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(fs.items)) return sourceFailure('listFeatures');
  // Level classifications contain ancestors AND descendants. Read each captured native placement instead of guessing a direct node.
  const ids = [...new Set(fs.items.map(f => f.featureId))];
  for (let start = 0; start < ids.length; start += 12) {
    const views = await Promise.all(ids.slice(start, start + 12).map(id => snapshot<{ placement: FeaturePlacement | null }>(ctx, 'featureTaxonomy', { id })));
    for (const view of views) {
      if (view.placement === undefined) return sourceFailure('featureTaxonomy');
      if (view.placement) map.set(view.placement.featureId, view.placement.nodeId);
    }
  }
  for (const placed of ctx.list<FeaturePlacement>(PLACEMENT)) map.set(placed.featureId, placed.nodeId);
  return map;
}
async function features(ctx: SimReadContext): Promise<any[]> {
  const base = await snapshot<{ items: unknown[] }>(ctx, 'listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(base.items)) return sourceFailure('listFeatures');
  const result = await ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(result.items)) return sourceFailure('listFeatures');
  return result.items.map(f => ({ ...f, ...(ctx.get<{ row: any }>('regFeature', `${f.featureId}@${f.version}`)?.row ?? {}) }));
}
async function latestFeatures(ctx: SimReadContext) {
  const map = new Map<string, any>();
  for (const f of await features(ctx)) if (!map.has(f.featureId) || compareVersion(f.version, map.get(f.featureId).version) > 0) map.set(f.featureId, f);
  return map;
}
const byNode = (placed: Map<string, string>) => {
  const map = new Map<string, string[]>();
  for (const [id, nodeId] of placed) map.set(nodeId, [...(map.get(nodeId) ?? []), id]);
  return map;
};
const HTTP = { TAXONOMY_ID_USED: 'CONFLICT', TAXONOMY_PARENT_NOT_FOUND: 'VALIDATION', TAXONOMY_PARENT_RETIRED: 'VALIDATION', TAXONOMY_LEVEL_MISMATCH: 'VALIDATION', TAXONOMY_HAS_CHILDREN: 'CONFLICT', TAXONOMY_HAS_FEATURES: 'CONFLICT', TAXONOMY_REFDB_MANAGED: 'IMMUTABLE', TAXONOMY_PLACEMENT_LEVEL: 'VALIDATION' };
function check(ctx: SimWriteContext, action: string, target: string, result: TaxonomyCheck) {
  if ('code' in result) ctx.fail(HTTP[result.code], result.message, { code: result.code }, { action, target, reason: result.message, componentId: COMPONENT });
}
registerSimReader('taxonomyNodes', async ctx => {
  const all = await allNodes(ctx), placed = byNode(await placements(ctx)), q = ctx.req.query;
  const level = q.level ? levelOf(q.level) : undefined;
  if (level || q.parentId) {
    const items = all.filter(n => (!level || n.level === level) && (!q.parentId || n.parentId === q.parentId)).map(n => ({ ...n, featureCount: placed.get(n.nodeId)?.length ?? 0, childCount: all.filter(c => c.parentId === n.nodeId).length }));
    return { total: items.length, items, tree: [] };
  }
  return { total: all.length, items: [], tree: toTree(all, placed) };
});
registerSimReader('taxonomyLevels', async ctx => {
  const all = await allNodes(ctx), placed = await placements(ctx);
  return { items: TAXONOMY_LEVELS.map(level => {
    const groups = classifyByLevel(level, all, placed);
    return { level, label: TAXONOMY_LEVEL_LABEL[level], nodes: all.filter(n => n.level === level).length, classifiedNodes: groups.length, features: new Set(groups.flatMap(g => g.featureIds)).size };
  }), placements: placed.size };
});
registerSimReader('taxonomyLevel', async ctx => {
  const level = levelOf(ctx.req.params.level), all = await allNodes(ctx), map = new Map(all.map(n => [n.nodeId, n])), latest = await latestFeatures(ctx);
  return { level, label: TAXONOMY_LEVEL_LABEL[level], items: classifyByLevel(level, all, await placements(ctx)).map(g => ({ node: g.node, path: taxonomyPath(g.node.nodeId, map).map(n => ({ nodeId: n.nodeId, name: n.name, level: n.level })), features: g.featureIds.map(id => {
    const f = latest.get(id);
    return { featureId: id, version: f?.version ?? null, name: f?.name ?? id, lifecycle: f?.lifecycle ?? null, taxonomyLevel: f?.taxonomyLevel ?? FEATURE_BASE_LEVEL };
  }) })) };
});
registerSimReader('featureTaxonomy', async ctx => {
  const id = ctx.req.params.id, f = (await latestFeatures(ctx)).get(id);
  if (!f) throw new SimError('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
  const all = await allNodes(ctx), map = new Map(all.map(n => [n.nodeId, n])), level = f.taxonomyLevel ?? FEATURE_BASE_LEVEL;
  const initial = await ctx.snapshot<{ placement: FeaturePlacement | null }>('featureTaxonomy', { id });
  const initialFeatures = await snapshot<{ items: { featureId: string }[] }>(ctx, 'listFeatures', {}, { latestOnly: false });
  if (!initial && initialFeatures.items.some(f => f.featureId === id)) return sourceFailure('featureTaxonomy');
  const placed = ctx.get<FeaturePlacement>(PLACEMENT, id) ?? initial?.placement ?? null;
  return { featureId: id, version: f.version, name: f.name, ownerId: f.ownerId, taxonomyLevel: level, placement: placed, path: placed ? taxonomyPath(placed.nodeId, map) : [], below: placed ? nodesBelow(placed.nodeId, all) : [], candidates: all.filter(n => n.level === level && n.status === 'ACTIVE').map(n => ({ nodeId: n.nodeId, name: n.name, path: taxonomyPath(n.nodeId, map).map(p => p.name).join(' › ') })) };
});
registerSimHandler('createTaxonomyNode', async ctx => {
  const b = ctx.req.body, all = await allNodes(ctx);
  check(ctx, 'TAXONOMY_NODE_CREATE', b.nodeId, checkNewNode(b, new Map(all.map(n => [n.nodeId, n])), new Set(ctx.list<{ nodeId: string }>(TOMBSTONE).map(n => n.nodeId))));
  const node: TaxonomyTreeNode = { nodeId: b.nodeId, name: b.name, level: b.level, parentId: b.parentId, description: b.description, source: 'PLATFORM', status: 'ACTIVE', createdBy: ctx.actor.id, createdAt: ctx.iso(), updatedBy: null, updatedAt: null };
  ctx.put(NODE, node.nodeId, node, { created: true });
  ctx.audit({ action: 'TAXONOMY_NODE_CREATE', target: node.nodeId, after: node, reason: b.reason, componentId: COMPONENT });
  ctx.emit('taxonomy.node.created', node.nodeId, { nodeId: node.nodeId, level: node.level, parentId: node.parentId }, { componentId: COMPONENT });
  return node;
}, { body: CreateTaxonomyNodeBody });
registerSimHandler('updateTaxonomyNode', async ctx => {
  const id = ctx.req.params.id, cur = (await allNodes(ctx)).find(n => n.nodeId === id), b = ctx.req.body;
  if (!cur) ctx.fail('NOT_FOUND', `분류 노드 ${id}이(가) 없습니다.`);
  if (cur.source === 'FEATURE_DB') check(ctx, 'TAXONOMY_NODE_UPDATE', id, { ok: false, code: 'TAXONOMY_REFDB_MANAGED', message: `${id}은(는) Feature DB 발행 분류입니다 — Feature DB 변경 요청으로 고칩니다.` });
  const next = { ...cur, ...(b.name !== undefined ? { name: b.name } : {}), ...(b.description !== undefined ? { description: b.description } : {}), updatedBy: ctx.actor.id, updatedAt: ctx.iso() };
  ctx.put(NODE, id, next);
  ctx.audit({ action: 'TAXONOMY_NODE_UPDATE', target: id, before: { name: cur.name, description: cur.description }, after: { name: next.name, description: next.description }, reason: b.reason, componentId: COMPONENT });
  ctx.emit('taxonomy.node.updated', id, { nodeId: id }, { componentId: COMPONENT });
  return next;
}, { body: UpdateTaxonomyNodeBody });
registerSimHandler('deleteTaxonomyNode', async ctx => {
  const id = ctx.req.params.id, all = await allNodes(ctx), node = all.find(n => n.nodeId === id);
  if (!node) ctx.fail('NOT_FOUND', `분류 노드 ${id}이(가) 없습니다.`);
  check(ctx, 'TAXONOMY_NODE_DELETE', id, checkDeleteNode(node, { children: all.filter(n => n.parentId === id).length, features: [...(await placements(ctx)).values()].filter(n => n === id).length }));
  const deletedAt = ctx.iso();
  ctx.put(TOMBSTONE, id, { nodeId: id, deletedBy: ctx.actor.id, deletedAt, reason: ctx.req.body.reason });
  ctx.audit({ action: 'TAXONOMY_NODE_DELETE', target: id, before: node, reason: ctx.req.body.reason, componentId: COMPONENT });
  ctx.emit('taxonomy.node.deleted', id, { nodeId: id, level: node.level }, { componentId: COMPONENT });
  return { nodeId: id, deleted: true, deletedAt };
}, { body: DeleteTaxonomyNodeBody });
registerSimHandler('placeFeatureTaxonomy', async ctx => {
  const id = ctx.req.params.id, f = (await latestFeatures(ctx)).get(id), b = ctx.req.body;
  if (!f) ctx.fail('NOT_FOUND', `${id}을(를) 찾을 수 없습니다.`);
  const node = (await allNodes(ctx)).find(n => n.nodeId === b.nodeId);
  if (!node) check(ctx, 'FEATURE_TAXONOMY_PLACE', id, { ok: false, code: 'TAXONOMY_PARENT_NOT_FOUND', message: `분류 노드 ${b.nodeId}이(가) 없습니다.` });
  check(ctx, 'FEATURE_TAXONOMY_PLACE', id, checkPlacement(f.taxonomyLevel ?? FEATURE_BASE_LEVEL, node!));
  const before = (await placements(ctx)).get(id), placed: FeaturePlacement = { featureId: id, nodeId: b.nodeId, placedBy: ctx.actor.id, placedAt: ctx.iso() };
  ctx.put(PLACEMENT, id, placed);
  ctx.audit({ action: 'FEATURE_TAXONOMY_PLACE', target: id, before: before ? { nodeId: before } : null, after: { nodeId: placed.nodeId }, reason: b.reason, componentId: COMPONENT });
  ctx.emit('feature.taxonomy.placed', id, { featureId: id, nodeId: placed.nodeId, from: before ?? null }, { componentId: COMPONENT });
  return placed;
}, { body: PlaceFeatureBody });

async function scopes(ctx: SimReadContext): Promise<PolicyGlobalScope[]> {
  const base = await snapshot<{ items: PolicyGlobalScope[] }>(ctx, 'globalScopes');
  if (!Array.isArray(base.items)) return sourceFailure('globalScopes');
  const map = new Map(base.items.map(s => [s.policyId, s]));
  for (const s of ctx.list<PolicyGlobalScope>(SCOPE)) map.set(s.policyId, s);
  return [...map.values()].sort((a, b) => a.policyId.localeCompare(b.policyId));
}
async function policy(ctx: SimReadContext, id: string) {
  // Existing policy readers merge edits and newly registered policies, preserving the actual body.
  const d = await ctx.read<{ policy: any }>('policyDetail', { id });
  if (!d?.policy) throw new SimError('NOT_FOUND', `정책 ${id}이(가) 없습니다.`);
  return d.policy;
}
async function scopeView(ctx: SimReadContext, s: PolicyGlobalScope) {
  const p = await policy(ctx, s.policyId), f = (await latestFeatures(ctx)).get(s.featureId);
  return { ...s, policy: { flagKey: p.flagKey, status: p.status, featureVersion: p.featureVersion, controlPoint: p.controlPoint }, feature: f ? { name: f.name, ownerId: f.ownerId, country: f.country } : null };
}
async function rules(ctx: SimReadContext): Promise<any[]> {
  const base = await snapshot<{ items: any[] }>(ctx, 'complianceRules');
  if (!Array.isArray(base.items)) return sourceFailure('complianceRules');
  const current = await ctx.read<{ items: any[] }>('complianceRules');
  if (!Array.isArray(current.items)) return sourceFailure('complianceRules');
  return current.items;
}
registerSimReader('brands', async ctx => {
  const all = await scopes(ctx);
  return { items: BRANDS.map(brand => ({ brand, label: BRAND_LABEL[brand], policies: all.filter(s => s.brands.includes(brand)).length })) };
});
registerSimReader('brandPolicies', async ctx => {
  const brand = ctx.req.params.brand;
  if (!isBrand(brand)) throw new SimError('VALIDATION', `브랜드 식별자는 ${BRANDS.join('·')} 중 하나입니다.`, { field: 'brand' });
  return { brand, label: BRAND_LABEL[brand], items: await Promise.all((await scopes(ctx)).filter(s => s.brands.includes(brand)).map(s => scopeView(ctx, s))) };
});
registerSimReader('globalScopes', async ctx => {
  const q = ctx.req.query;
  if (q.brand && !isBrand(q.brand)) throw new SimError('VALIDATION', `브랜드 식별자는 ${BRANDS.join('·')} 중 하나입니다.`, { field: 'brand' });
  if (q.regionCode && !isRegionCode(q.regionCode)) throw new SimError('VALIDATION', regionCodeFormatIssues([q.regionCode])[0], { field: 'regionCode' });
  const found = matchGlobalScopes(await scopes(ctx), q).filter(s => !q.featureId || s.featureId === q.featureId);
  return { total: found.length, items: await Promise.all(found.map(s => scopeView(ctx, s))) };
});
registerSimReader('policyGlobalScope', async ctx => {
  const id = ctx.req.params.id, p = await policy(ctx, id), f = (await latestFeatures(ctx)).get(p.featureId), s = (await scopes(ctx)).find(s => s.policyId === id);
  return { policyId: id, featureId: p.featureId, ownerId: f?.ownerId ?? null, scope: s ? await scopeView(ctx, s) : null };
});
async function saveScope(ctx: SimWriteContext, update: boolean) {
  const id = ctx.req.params.id, b: PolicyGlobalScopeBody = ctx.req.body, action = update ? 'POLICY_GLOBAL_SCOPE_UPDATE' : 'POLICY_GLOBAL_SCOPE_CREATE';
  const p = await policy(ctx, id), known = new Set((await rules(ctx)).map(r => r.ruleId)), missing = b.complianceRuleIds.filter(r => !known.has(r));
  if (missing.length) ctx.fail('VALIDATION', `법규 조건(컴플라이언스 룰) ${missing.join(', ')}이(가) 등록되어 있지 않습니다.`, { field: 'complianceRuleIds', missing }, { action, target: id, reason: '등록되지 않은 컴플라이언스 룰', componentId: COMPONENT });
  const cur = (await scopes(ctx)).find(s => s.policyId === id);
  if (update) {
    if (!cur) ctx.fail('NOT_FOUND', `${id}에 등록된 브랜드·권역 조건이 없습니다 — 먼저 등록하세요.`);
    // Engine applies route roles too; retain this boundary for direct-domain calls and future adapters.
    if (ctx.actor.role === 'SYSTEM' || ctx.actor.role === 'VEHICLE') ctx.fail('FORBIDDEN', '브랜드·권역 조건은 사람 역할만 수정합니다.');
    const ownerId = (await latestFeatures(ctx)).get(p.featureId)?.ownerId ?? '';
    const can = canEditGlobalScope({ id: ctx.actor.id, roles: [ctx.actor.role] }, { ownerId });
    if ('reason' in can) ctx.fail('FORBIDDEN', can.reason, { ownerId }, { action, target: id, reason: can.reason, componentId: COMPONENT, result: 'DENIED' });
  } else if (cur) ctx.fail('CONFLICT', `${id}에는 이미 브랜드·권역 조건이 있습니다 — 수정으로 바꾸세요.`, undefined, { action, target: id, reason: '이미 등록된 적용 조건', componentId: COMPONENT });
  const next: PolicyGlobalScope = { policyId: id, featureId: p.featureId, brands: [...b.brands] as PolicyGlobalScope['brands'], regionCodes: [...b.regionCodes], complianceRuleIds: [...b.complianceRuleIds], revision: update ? cur!.revision + 1 : 1, updatedBy: ctx.actor.id, updatedAt: ctx.iso(), reason: b.reason };
  ctx.put(SCOPE, id, next, { created: !update });
  const content = (s: PolicyGlobalScope) => ({ brands: s.brands, regionCodes: s.regionCodes, complianceRuleIds: s.complianceRuleIds, revision: s.revision });
  ctx.audit({ action, target: id, before: cur ? content(cur) : undefined, after: content(next), reason: b.reason, componentId: COMPONENT });
  ctx.emit('policy.global-scope.saved', id, { policyId: id, featureId: next.featureId, brands: next.brands, regionCodes: next.regionCodes, revision: next.revision }, { componentId: COMPONENT });
  return scopeView(ctx, next);
}
registerSimHandler('createPolicyGlobalScope', ctx => saveScope(ctx, false), { body: PolicyGlobalScopeBody });
registerSimHandler('updatePolicyGlobalScope', ctx => saveScope(ctx, true), { body: PolicyGlobalScopeBody });
registerSimReader('regionCodes', async ctx => {
  const latest = await latestFeatures(ctx), rs = await rules(ctx), all = await scopes(ctx);
  return { items: REGION_CODE_TABLE.map(r => ({ ...r, features: [...latest.values()].filter(f => r.countries.includes(f.country)).length, rules: rs.filter(x => (x.scope?.regionCodes ?? []).includes(r.code)).map(x => x.ruleId), policies: all.filter(s => s.regionCodes.includes(r.code)).length })) };
});
registerSimReader('regionVariantCandidates', async ctx => {
  const codes = (ctx.req.query.codes ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean), issues = regionCodeFormatIssues(codes);
  if (!codes.length || issues.length) throw new SimError('VALIDATION', issues[0] ?? '적용 지역 코드(codes)를 하나 이상 주세요(예: 1,4).', { field: 'codes', issues });
  const fs = await Promise.all((await features(ctx)).map(async f => {
    const overlay = ctx.get<{ row: any }>('regFeature', `${f.featureId}@${f.version}`);
    const detail = overlay ?? await snapshot<{ feature: any }>(ctx, 'featureDetail', { id: f.featureId, ver: f.version });
    const row = 'row' in detail ? detail.row : detail.feature;
    if (!row || !Array.isArray(row.upgVc)) return sourceFailure('variantFeature');
    return row;
  }));
  const baseProducts = await snapshot<{ items: any[] }>(ctx, 'listProducts'), baseBaselines = await snapshot<{ items: any[] }>(ctx, 'baselines');
  if (!Array.isArray(baseProducts.items) || !Array.isArray(baseBaselines.items)) return sourceFailure('variantProducts');
  const ps = await ctx.read<{ items: any[] }>('listProducts'), bs = await ctx.read<{ items: any[] }>('baselines');
  const baselines = new Map(bs.items.map(b => [b.baselineId, b]));
  return variantRuleCandidates(codes, fs.map(f => ({ ...f, upgVc: f.upgVc ?? [] })), ps.items.map(p => ({ ...p, features: [...new Set<string>((p.baselineIds ?? []).map((id: string) => baselines.get(id)?.featureId).filter(Boolean))].sort() })));
});

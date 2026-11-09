import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile } from '@ff/contracts';
import * as actor from '../api/actor';
import type { TaxonomyTreeNode } from '../../../contracts/src/schemas/taxonomy-tree';

let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine'), sequence = 0;
let sources: Map<string, unknown>;
const F1 = 'FEAT-00001', F2 = 'FEAT-00002', P1 = 'POL-00001';
const f1 = { featureId: F1, version: '1.0.0', name: 'Existing Feature', taxonomyLevel: 'L2', ownerId: 'usr-author', lifecycle: 'APPROVED', country: 'KR', vehicleModel: 'NX', trim: 'Base', upgVc: ['VC-EXISTING'], tags: [], controlPoints: [] };
const f2 = { ...f1, featureId: F2, taxonomyLevel: 'L3', name: 'SW Feature', country: 'EU' };
const policy = { policyId: P1, featureId: F1, featureVersion: f1.version, flagKey: 'light', revision: 3, contentHash: 'immutable-policy-body', status: 'APPROVED', controlPoint: 'DIRECT', enabled: true };
const node = (nodeId: string, level: TaxonomyTreeNode['level'], parentId: string | null, extra = {}): TaxonomyTreeNode => ({ nodeId, name: nodeId, level, parentId, description: null, source: 'PLATFORM', status: 'ACTIVE', createdBy: 'seed', createdAt: '2026-11-01T00:00:00Z', updatedBy: null, updatedAt: null, ...extra });
const root = node('ROOT', 'L0', null, { source: 'FEATURE_DB' }), cluster = node('CLUSTER', 'L1', root.nodeId), base = node('BASE', 'L2', cluster.nodeId), sw = node('SOFTWARE', 'L3', base.nodeId), flag = node('FLAG', 'L4', sw.nodeId), signal = node('SIGNAL', 'L5', flag.nodeId), retired = node('RETIRED', 'L2', cluster.nodeId, { status: 'RETIRED' });
const key = (name: string, params = {}, query = {}) => snapshotFile(routeUrl(name, params, query));
const set = (name: string, value: unknown, params = {}, query = {}) => sources.set(key(name, params, query), value);
const run = (name: string, role = 'steward', body?: unknown, params: Record<string, string> = {}, query: Record<string, string> = {}) => sim.simCall<any>(ROUTES.find(r => r.name === name)!, routeUrl(name, params, query), { role, body, params, query });
const create = (nodeId = 'NEW-L2', level = 'L2', parentId: string | null = cluster.nodeId) => run('createTaxonomyNode', 'steward', { nodeId, level, parentId, name: `New ${nodeId}`, reason: 'Create a taxonomy node' });
const scope = { brands: ['HYUNDAI'], regionCodes: ['1'], complianceRuleIds: ['RULE-01'], reason: 'Metadata only' };
beforeEach(async () => {
  localStorage.clear(); vi.stubEnv('VITE_DATA_MODE', 'static'); sources = new Map();
  set('auditChain', { head: `tx-tests-${++sequence}`, verified: 0 });
  set('audit', { items: [] }); set('events', { items: [] });
  set('listFeatures', { items: [f1, f2] }, {}, { latestOnly: false });
  set('featureDetail', { feature: f1 }, { id: F1, ver: f1.version });
  set('featureDetail', { feature: f2 }, { id: F2, ver: f2.version });
  set('policyDetail', { policy }, { id: P1 });
  // Policy reads run the independent exception-expiry preflight; this fixture has no exceptions.
  set('exceptionPolicies', {items:[]});
  set('globalScopes', { total: 0, items: [] });
  set('policyGlobalScope', { policyId: P1, featureId: F1, ownerId: f1.ownerId, scope: null }, { id: P1 });
  set('complianceRules', { items: [{ ruleId: 'RULE-01', name: 'Example rule', scope: { markets: ['KR'], regionCodes: ['1'] }, status: 'APPROVED' }] });
  set('listProducts', { items: [{ catalogId: 'CAT-00001', version: '1.0.0', name: 'Product', country: 'KR', vehicleModel: 'NX', trim: 'Base', lifecycle: 'APPROVED', type: 'PACKAGE', baselineIds: ['BL-00001'] }] });
  set('baselines', { items: [{ baselineId: 'BL-00001', featureId: F1 }] });
  const tree = { ...root, children: [{ ...cluster, children: [{ ...base, children: [{ ...sw, children: [{ ...flag, children: [{ ...signal, children: [] }] }] }] }, { ...retired, children: [] }] }] };
  set('taxonomyNodes', { total: 7, items: [], tree: [tree] });
  for (const n of [root, cluster, base, sw, flag, signal]) set('taxonomyLevel', { level: n.level, items: [{ node: n, path: [], features: [f1, f2] }] }, { level: n.level });
  for (const [f, n] of [[f1, base], [f2, sw]] as const) set('featureTaxonomy', { featureId: f.featureId, placement: { featureId: f.featureId, nodeId: n.nodeId, placedBy: 'seed', placedAt: '2026-11-01T00:00:00Z' } }, { id: f.featureId });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const matched = [...sources].find(([file]) => String(input).endsWith(file));
    return matched ? new Response(JSON.stringify(matched[1]), { headers: { 'Content-Type': 'application/json' } }) : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }));
  sim = await import('../api/sim'); engine = await import('../api/sim/engine');
});
afterEach(() => { engine.__resetSimForTest(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

it('creates, renames and deletes a leaf, keeps its tombstone after rehydration, and records native audit/events', async () => {
  const created = await create(); expect(created).toMatchObject({ nodeId: 'NEW-L2', level: 'L2', source: 'PLATFORM' });
  expect((await run('taxonomyNodes', 'viewer', undefined, {}, { level: 'L2', parentId: cluster.nodeId })).items).toHaveLength(3);
  await run('updateTaxonomyNode', 'steward', { name: 'Renamed node', description: 'Actual user description', reason: 'Rename leaf' }, { id: created.nodeId });
  expect((await run('featureTaxonomy', 'viewer', undefined, { id: F1 })).candidates.find((n: any) => n.nodeId === created.nodeId).path).toBe('ROOT › CLUSTER › Renamed node');
  expect(await run('deleteTaxonomyNode', 'steward', { reason: 'Remove unused leaf' }, { id: created.nodeId })).toMatchObject({ nodeId: created.nodeId, deleted: true });
  engine.__resetSimForTest();
  await expect(create()).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  const audit = await run('audit', 'viewer');
  expect(audit.items.some((a: any) => a.action === 'TAXONOMY_NODE_DELETE')).toBe(true);
  expect((await run('events', 'viewer')).items.some((e: any) => e.type === 'taxonomy.node.deleted')).toBe(true);
});
it.each([
  ['MISSING', 'L2', 'NO-PARENT', 400], ['SKIPPED', 'L3', cluster.nodeId, 400], ['RETIRED-CHILD', 'L3', retired.nodeId, 400], ['INVALID-ROOT', 'L0', cluster.nodeId, 400], ['BASE', 'L2', cluster.nodeId, 409],
])('rejects invalid node %s without adding it', async (id, level, parent, status) => {
  await expect(create(id, level, parent)).rejects.toMatchObject({ status });
  expect((await run('taxonomyNodes', 'viewer')).total).toBe(7);
});
it.each(['updateTaxonomyNode', 'deleteTaxonomyNode'])('preserves published Feature DB nodes for %s', async name => {
  await expect(run(name, 'steward', { ...(name === 'updateTaxonomyNode' ? { name: 'Cannot overwrite' } : {}), reason: 'Readonly source' }, { id: root.nodeId })).rejects.toMatchObject({ status: 409, code: 'IMMUTABLE' });
});
it('blocks referenced-node deletion, validates placement levels, and recomputes old/new classifications and paths', async () => {
  await expect(run('deleteTaxonomyNode', 'steward', { reason: 'Has children' }, { id: cluster.nodeId })).rejects.toMatchObject({ status: 409 });
  // SOFTWARE has a placement and descendants. Move the leaf Feature into a fresh branch to isolate the placement-only guard.
  await create('NEW-BRANCH');
  await expect(run('placeFeatureTaxonomy', 'author', { nodeId: sw.nodeId }, { id: F1 })).rejects.toMatchObject({ status: 400 });
  await run('placeFeatureTaxonomy', 'author', { nodeId: 'NEW-BRANCH', reason: 'Move within L2' }, { id: F1 });
  await expect(run('deleteTaxonomyNode', 'steward', { reason: 'Still referenced' }, { id: 'NEW-BRANCH' })).rejects.toMatchObject({ status: 409 });
  await run('updateTaxonomyNode', 'steward', { name: 'Renamed branch', reason: 'Clearer path' }, { id: 'NEW-BRANCH' });
  engine.__resetSimForTest();
  const fv = await run('featureTaxonomy', 'viewer', undefined, { id: F1 });
  expect(fv.path.map((n: any) => n.name)).toEqual(['ROOT', 'CLUSTER', 'Renamed branch']);
  const groups = (await run('taxonomyLevel', 'viewer', undefined, { level: 'L2' })).items;
  expect(groups.find((g: any) => g.node.nodeId === 'NEW-BRANCH').features.map((f: any) => f.featureId)).toEqual([F1]);
  expect(groups.find((g: any) => g.node.nodeId === base.nodeId).features.map((f: any) => f.featureId)).toEqual([F2]);
  const nodes = await run('taxonomyNodes', 'viewer', undefined, {}, { level: 'L2' });
  expect(nodes.items.find((n: any) => n.nodeId === base.nodeId).featureCount).toBe(0);
  expect((await run('taxonomyLevels', 'viewer')).placements).toBe(2);
});
it('rejects unauthorized taxonomy edits, invalid bodies and unknown Features', async () => {
  await expect(run('createTaxonomyNode', 'author', { nodeId: 'NO-AUTH', name: 'Not permitted', level: 'L0', parentId: null })).rejects.toMatchObject({ status: 403 });
  await expect(run('createTaxonomyNode', 'steward', { nodeId: 'bad id', name: '', level: 'L7' })).rejects.toMatchObject({ status: 400 });
  await expect(run('placeFeatureTaxonomy', 'author', { nodeId: base.nodeId }, { id: 'FEAT-99999' })).rejects.toMatchObject({ status: 404 });
});
it('creates/updates scope metadata and filters all dependent views without changing policy body or approval', async () => {
  const before = structuredClone(await run('policyDetail', 'viewer', undefined, { id: P1 }));
  expect(await run('createPolicyGlobalScope', 'author', scope, { id: P1 })).toMatchObject({ revision: 1, featureId: F1 });
  await expect(run('createPolicyGlobalScope', 'author', scope, { id: P1 })).rejects.toMatchObject({ status: 409 });
  await expect(run('updatePolicyGlobalScope', 'integrator', scope, { id: P1 })).rejects.toMatchObject({ status: 403 });
  await run('updatePolicyGlobalScope', 'author', { ...scope, brands: ['KIA'], regionCodes: ['4'] }, { id: P1 });
  const detail = await run('policyGlobalScope', 'viewer', undefined, { id: P1 });
  expect(detail).toMatchObject({ ownerId: f1.ownerId, scope: { revision: 2, brands: ['KIA'], regionCodes: ['4'] } });
  expect((await run('globalScopes', 'viewer', undefined, {}, { brand: 'HYUNDAI' })).total).toBe(0);
  expect((await run('globalScopes', 'viewer', undefined, {}, { brand: 'KIA', regionCode: '4', ruleId: 'RULE-01', featureId: F1 })).total).toBe(1);
  expect((await run('brands', 'viewer')).items.find((b: any) => b.brand === 'KIA').policies).toBe(1);
  expect((await run('brandPolicies', 'viewer', undefined, { brand: 'KIA' })).items).toHaveLength(1);
  expect((await run('regionCodes', 'viewer')).items.find((r: any) => r.code === '4').policies).toBe(1);
  expect(await run('policyDetail', 'viewer', undefined, { id: P1 })).toEqual(before);
});
it('permits the actual human owner in another role and system admin, but rejects machine ownership and role spoofing', async () => {
  await run('createPolicyGlobalScope', 'author', scope, { id: P1 });
  const spy = vi.spyOn(actor, 'actorFor').mockReturnValue({ id: f1.ownerId, role: 'AUDITOR' });
  expect(await run('updatePolicyGlobalScope', 'viewer', scope, { id: P1 })).toMatchObject({ revision: 2 });
  for (const role of ['SYSTEM', 'VEHICLE'] as const) {
    spy.mockReturnValue({ id: f1.ownerId, role });
    await expect(run('updatePolicyGlobalScope', 'viewer', scope, { id: P1 })).rejects.toMatchObject({ status: 403 });
  }
  spy.mockRestore();
  expect(await run('updatePolicyGlobalScope', 'sysadmin', scope, { id: P1 })).toMatchObject({ revision: 3 });
  await expect(run('createPolicyGlobalScope', 'sysadmin', scope, { id: P1 })).rejects.toMatchObject({ status: 403 });
});
it.each([
  { brands: ['UNKNOWN'] }, { brands: [] }, { regionCodes: ['Z'] }, { complianceRuleIds: ['MISSING-RULE'] },
])('rejects invalid global scope %j', async patch => {
  await expect(run('createPolicyGlobalScope', 'author', { ...scope, ...patch }, { id: P1 })).rejects.toMatchObject({ status: 400 });
  expect((await run('globalScopes', 'viewer')).total).toBe(0);
});
it('derives regional candidates from actual Feature UPG-VC and baseline composition, and validates query codes', async () => {
  const result = await run('regionVariantCandidates', 'viewer', undefined, {}, { codes: '1,4' });
  expect(result.variantConditions.find((v: any) => v.country === 'KR')).toMatchObject({ upgVc: ['VC-EXISTING'], featureIds: [F1] });
  expect(result.compositions).toHaveLength(1); expect(result.compositions[0].features).toEqual([F1]);
  await expect(run('regionVariantCandidates', 'viewer', undefined, {}, { codes: '1,1' })).rejects.toMatchObject({ status: 400 });
  await expect(run('globalScopes', 'viewer', undefined, {}, { regionCode: 'Z' })).rejects.toMatchObject({ status: 400 });
});
it('preserves the taxonomy-level registry filter after browser-local writes', async () => {
  await create();
  expect((await run('listFeatures', 'viewer', undefined, {}, { taxonomyLevel: 'L3' })).items.map((f: any) => f.featureId)).toEqual([F2]);
});
it('uses captured direct placements rather than inferring one from a changed Feature level', async () => {
  set('listFeatures', { items: [{ ...f1, taxonomyLevel: 'L3' }, f2] }, {}, { latestOnly: false });
  const result = await run('taxonomyNodes', 'viewer', undefined, {}, { level: 'L2' });
  expect(result.items.find((n: any) => n.nodeId === base.nodeId).featureCount).toBe(1);
});
it.each(['taxonomyNodes', 'globalScopes', 'listFeatures'])('fails closed when required source %s is missing', async name => {
  sources.delete(key(name, {}, name === 'listFeatures' ? { latestOnly: false } : {}));
  const operation = name === 'taxonomyNodes' ? create() : name === 'globalScopes' ? run('createPolicyGlobalScope', 'author', scope, { id: P1 }) : run('featureTaxonomy', 'viewer', undefined, { id: F1 });
  await expect(operation).rejects.toMatchObject({ status: 500, code: 'INTERNAL' });
});

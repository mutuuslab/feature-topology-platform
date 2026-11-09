// Supplier records are browser-local transactions. Original captured records and native decisions remain immutable.
import { compareVersion } from '@ff/contracts';
import { acceptanceCheck, contractGaps, latestArtifacts, missingArtifacts, semverGreater, supplierScope, type SupplierArtifactRow, type SupplierCriteriaRow, type SupplierMappingRow, type SupplierPackageRow, type SupplierReviewRow } from '../../../../../contracts/src/rules/supplier';
import { AddSupplierSwcBody, CreateSupplierCriteriaBody, CreateSupplierMappingBody, CreateSupplierPackageBody, ReviewSupplierPackageBody, SubmitSupplierArtifactBody, SubmitSupplierPackageBody, SUPPLIER_ARTIFACT_TYPES } from '../../../../../contracts/src/schemas/supplier';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { publicArtifactUri, verifyArtifact } from './supplier-proof';

const PKG = 'supplierPackage', MAP = 'supplierMapping', ART = 'supplierArtifact', CRITERIA = 'supplierCriteria', REVIEW = 'supplierReview';
const COMPONENT = 'D05-01', LOCAL = 'LOCAL_SIMULATION';
const error = (code: string, message: string): never => { throw new SimError(code, message); };
const missing = (name: string): never => error('INTERNAL', `Supplier source is unavailable: ${name}`);
async function source<T = any>(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): Promise<T> {
  return await ctx.snapshot<T>(name, params, query) ?? missing(name);
}
function merge<T>(base: T[], local: T[], key: keyof T): T[] { return [...new Map([...base, ...local].map(row => [row[key], row])).values()]; }
async function features(ctx: SimReadContext): Promise<any[]> {
  const result = await ctx.read<any>('listFeatures', {}, { latestOnly: false });
  return Array.isArray(result?.items) ? result.items : missing('listFeatures');
}
async function feature(ctx: SimReadContext, id: string, version?: string): Promise<any> {
  const versions = (await features(ctx)).filter(f => f.featureId === id).sort((a, b) => compareVersion(a.version, b.version));
  const chosen = version ? versions.find(f => f.version === version) : versions.at(-1);
  if (!chosen) return error('NOT_FOUND', `Feature ${id}${version ? '@' + version : ''} is missing.`);
  const result = await ctx.read<any>('featureDetail', { id, ver: chosen.version });
  return result?.feature ?? missing('featureDetail');
}
async function packages(ctx: SimReadContext): Promise<SupplierPackageRow[]> {
  const result = await source(ctx, 'supplierPackages');
  if (!Array.isArray(result.items)) return missing('supplierPackages');
  return merge(result.items as SupplierPackageRow[], ctx.list<SupplierPackageRow>(PKG), 'packageId');
}
async function pkg(ctx: SimReadContext, id: string) { return (await packages(ctx)).find(p => p.packageId === id) ?? error('NOT_FOUND', `Supplier package ${id} is missing.`); }
async function mappings(ctx: SimReadContext, id?: string): Promise<SupplierMappingRow[]> {
  if (id) await feature(ctx, id);
  const ids = id ? [id] : [...new Set((await features(ctx)).map(f => f.featureId as string))];
  const base: SupplierMappingRow[] = [];
  for (const featureId of ids) {
    // A newly created local Feature has no native supplier history. Existing Feature sources must be present.
    const fresh = ctx.list<any>('regFeature').some(f => f.row?.featureId === featureId && f.meta?.createdBy);
    const result = await ctx.snapshot<any>('supplierMappings', {}, { featureId });
    if (!Array.isArray(result?.items) && !fresh) return missing('supplierMappings:' + featureId);
    base.push(...(result?.items ?? []));
  }
  return merge(base, ctx.list<SupplierMappingRow>(MAP), 'mapId').filter(m => !id || m.featureId === id);
}
async function criteria(ctx: SimReadContext, id: string): Promise<SupplierCriteriaRow[]> {
  await feature(ctx, id);
  const result = await ctx.snapshot<any>('supplierCriteria', {}, { featureId: id });
  const fresh = ctx.list<any>('regFeature').some(f => f.row?.featureId === id && f.meta?.createdBy);
  if (!Array.isArray(result?.items) && !fresh) return missing('supplierCriteria:' + id);
  return merge((result?.items ?? []) as SupplierCriteriaRow[], ctx.list<SupplierCriteriaRow>(CRITERIA), 'criteriaId').filter(c => c.featureId === id).sort((a, b) => a.revision - b.revision);
}
async function baseDetail(ctx: SimReadContext, p: SupplierPackageRow) {
  const base = await source(ctx, 'supplierPackages');
  if (!Array.isArray(base.items)) return missing('supplierPackages');
  // Changing a captured package must keep its original append-only artifact and review history.
  if (!base.items.some((item: SupplierPackageRow) => item.packageId === p.packageId)) return null;
  const result = await source(ctx, 'supplierPackage', { id: p.packageId });
  if (result.package?.packageId !== p.packageId || !Array.isArray(result.artifacts) || !Array.isArray(result.reviews)) return missing('supplierPackage:' + p.packageId);
  return result;
}
async function artifacts(ctx: SimReadContext, p: SupplierPackageRow): Promise<SupplierArtifactRow[]> {
  const detail = await baseDetail(ctx, p), base: SupplierArtifactRow[] = [];
  for (const row of detail?.artifacts ?? []) {
    let text: string | null = null;
    if (row.contentUrl) {
      const body = await source(ctx, 'supplierArtifactContent', { id: row.recordId });
      if (body.recordId !== row.recordId || typeof body.text !== 'string') return missing('supplierArtifactContent:' + row.recordId);
      text = body.text;
    }
    base.push({ ...row, text });
  }
  const result = merge(base, ctx.list<SupplierArtifactRow>(ART), 'recordId').filter(a => a.packageId === p.packageId);
  return Promise.all(result.map(async a => {
    const { recordId: _id, packageId: _pkg, submittedBy: _by, submittedAt: _at, integrity: _integrity, carriedFrom: _carried, contentUrl: _url, provenance: _source, ...body } = a as any;
    const parsed = SubmitSupplierArtifactBody.safeParse(body);
    return { ...a, integrity: parsed.success ? (await verifyArtifact(p, parsed.data)).integrity : 'MISMATCH' };
  }));
}
async function reviews(ctx: SimReadContext, p: SupplierPackageRow): Promise<SupplierReviewRow[]> {
  const detail = await baseDetail(ctx, p);
  return merge((detail?.reviews ?? []) as SupplierReviewRow[], ctx.list<SupplierReviewRow>(REVIEW), 'reviewId').filter(r => r.packageId === p.packageId).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.reviewId.localeCompare(b.reviewId));
}
async function check(ctx: SimReadContext, p: SupplierPackageRow, rows?: SupplierArtifactRow[]) {
  return acceptanceCheck({ pkg: p, latest: latestArtifacts(rows ?? await artifacts(ctx, p)), criteria: (await criteria(ctx, p.featureId)).at(-1) ?? null, feature: await feature(ctx, p.featureId, p.featureVersion), featureVersions: (await features(ctx)).filter(f => f.featureId === p.featureId).map(f => f.version), activeMappingIds: (await mappings(ctx, p.featureId)).filter(m => m.supplier === p.supplier && m.status === 'ACTIVE').map(m => m.mapId) });
}
async function detail(ctx: SimReadContext, id: string) {
  const p = await pkg(ctx, id), rows = await artifacts(ctx, p), strip = (a: SupplierArtifactRow) => ({ ...a, text: null, contentUrl: a.text === null ? null : `/api/supplier-artifacts/${a.recordId}/content` });
  return { package: p, artifacts: rows.map(strip), latest: Object.fromEntries(Object.entries(latestArtifacts(rows)).map(([k, a]) => [k, strip(a!)])), criteria: (await criteria(ctx, p.featureId)).at(-1) ?? null, check: await check(ctx, p, rows), reviews: await reviews(ctx, p) };
}
function write(name: string, action: string, body: any, fn: (ctx: SimWriteContext) => Promise<unknown>) {
  registerSimHandler(name, async ctx => {
    const target = ctx.req.params.id ?? ctx.req.body.featureId;
    try {
      const value = await fn(ctx);
      ctx.audit({ action, target, after: { saved: true, provenance: LOCAL }, componentId: COMPONENT });
      ctx.emit(action.toLowerCase().replaceAll('_', '.'), target, { by: ctx.actor.id, provenance: LOCAL }, { componentId: COMPONENT });
      return value;
    } catch (e) {
      if (e instanceof SimError) ctx.fail(e.code, e.message, e.details, { action, target, reason: e.message, componentId: COMPONENT, result: e.code === 'SEPARATION_OF_DUTY' || e.code === 'FORBIDDEN' ? 'DENIED' : 'FAILED' });
      throw e;
    }
  }, { body });
}
registerSimReader('supplierPackages', async ctx => {
  const q = ctx.req.query;
  if (q.featureId) await feature(ctx, q.featureId, q.featureVersion);
  return { items: (await packages(ctx)).filter(p => (!q.featureId || p.featureId === q.featureId) && (!q.featureVersion || p.featureVersion === q.featureVersion) && (!q.supplier || p.supplier === q.supplier)) };
});
registerSimReader('supplierMappings', async ctx => ({ items: await mappings(ctx, ctx.req.query.featureId) }));
registerSimReader('supplierCriteria', async ctx => ({ items: await criteria(ctx, ctx.req.query.featureId) }));
registerSimReader('supplierPackage', ctx => detail(ctx, ctx.req.params.id));
registerSimReader('supplierArtifactContent', async ctx => {
  const id = ctx.req.params.id, own = ctx.get<SupplierArtifactRow>(ART, id);
  let a = own;
  if (!a) for (const p of await packages(ctx)) { a = (await artifacts(ctx, p)).find(a => a.recordId === id); if (a) break; }
  if (!a || a.text === null) return error('NOT_FOUND', 'Supplier artifact body is not retained.');
  const proof = await verifyArtifact(await pkg(ctx, a.packageId), a);
  return { recordId: id, text: a.text, checksum: proof.bodyChecksum, declaredChecksum: a.checksum, verified: proof.integrity === 'VERIFIED', verification: proof };
});
write('createSupplierMapping', 'SUPPLIER_MAPPING_CREATE', CreateSupplierMappingBody, async ctx => {
  const b = ctx.req.body;
  await feature(ctx, b.featureId);
  const all = await mappings(ctx);
  if (all.some(m => m.featureId === b.featureId && m.supplier === b.supplier && m.supplierFunctionId === b.supplierFunctionId)) error('CONFLICT', 'The Feature and supplier function mapping already exists.');
  if (b.oemFunctionId) {
    const f = await feature(ctx, b.featureId), d = await ctx.read<any>('featureDetail', { id: b.featureId, ver: f.version });
    if (!d.functions?.some((f: any) => f.functionId === b.oemFunctionId)) error('GUARD_FAILED', 'OEM function does not belong to this Feature.');
  }
  const m = { ...b, mapId: ctx.nextId('SFM', all.map(m => m.mapId)), swcs: [], status: 'ACTIVE', createdBy: ctx.actor.id, createdAt: ctx.iso(), provenance: LOCAL };
  ctx.put(MAP, m.mapId, m, { created: true }); return m;
});
write('addSupplierSwc', 'SUPPLIER_SWC_ADD', AddSupplierSwcBody, async ctx => {
  const m = (await mappings(ctx)).find(m => m.mapId === ctx.req.params.id) ?? error('NOT_FOUND', 'Supplier mapping is missing.'), b = ctx.req.body;
  if (m.swcs.some(s => s.swcId === b.swcId)) error('CONFLICT', 'SW Component already mapped.');
  const swSource = await source(ctx, 'masterSw'), ecuSource = await source(ctx, 'masterEcu');
  if (!Array.isArray(swSource.items) || !Array.isArray(ecuSource.items)) return missing('SW/ECU master');
  const sw = b.swId ? swSource.items.filter((s: any) => s.swId === b.swId) : [];
  if (b.swId && (!sw.length || sw.some((s: any) => s.supplier !== m.supplier))) error('GUARD_FAILED', 'OEM SW must belong to the same supplier.');
  if (b.swId) {
    const fs = await Promise.all((await features(ctx)).filter(f => f.featureId === m.featureId).map(f => feature(ctx, f.featureId, f.version)));
    if (!fs.some(f => f.swIds.includes(b.swId))) error('GUARD_FAILED', 'OEM SW is not used by this Feature.');
  }
  if (b.ecuPno && (!ecuSource.items.some((e: any) => e.ecuPno === b.ecuPno) || (b.swId && !sw.some((s: any) => s.ecuPno === b.ecuPno)))) error('GUARD_FAILED', 'ECU does not execute the selected OEM SW.');
  const next = { ...m, swcs: [...m.swcs, { ...b, addedBy: ctx.actor.id, addedAt: ctx.iso() }], provenance: LOCAL };
  ctx.put(MAP, m.mapId, next); return next;
});
write('createSupplierPackage', 'SUPPLIER_PACKAGE_CREATE', CreateSupplierPackageBody, async ctx => {
  const b = ctx.req.body; await feature(ctx, b.featureId, b.featureVersion); const all = await packages(ctx);
  if (all.some(p => p.featureId === b.featureId && p.supplier === b.supplier && !semverGreater(b.version, p.version))) error('CONFLICT', 'Package version must exceed all existing versions for this Feature and supplier.');
  const base = b.basedOn ? await pkg(ctx, b.basedOn) : null;
  if (base && (base.featureId !== b.featureId || base.featureVersion !== b.featureVersion || base.supplier !== b.supplier)) error('GUARD_FAILED', 'Only the same Feature Version and supplier can be carried forward.');
  const p = { ...b, packageId: ctx.nextId('SPK', all.map(p => p.packageId)), status: 'DRAFT', createdBy: ctx.actor.id, createdAt: ctx.iso(), submittedBy: null, submittedAt: null, submitNote: null, decidedBy: null, decidedAt: null, provenance: LOCAL } as SupplierPackageRow;
  ctx.put(PKG, p.packageId, p, { created: true });
  if (base) {
    const rows = await artifacts(ctx, base);
    const allRows = (await Promise.all(all.map(p => artifacts(ctx, p)))).flat();
    for (const a of Object.values(latestArtifacts(rows))) {
      const carried = { ...a!, recordId: ctx.nextId('SPA', allRows.map(a => a.recordId)), packageId: p.packageId, carriedFrom: a!.recordId, submittedBy: ctx.actor.id, submittedAt: ctx.iso(), integrity: (await verifyArtifact(p, a!)).integrity, provenance: LOCAL };
      ctx.put(ART, carried.recordId, carried, { created: true });
    }
  }
  return p;
});
write('submitSupplierArtifact', 'SUPPLIER_ARTIFACT_ADD', SubmitSupplierArtifactBody, async ctx => {
  const p = await pkg(ctx, ctx.req.params.id), b = ctx.req.body;
  if (!['DRAFT', 'REJECTED'].includes(p.status)) error('IMMUTABLE', 'Artifacts can only be added to draft or rejected packages.');
  if (!publicArtifactUri(b.uri)) error('VALIDATION', 'Artifact URI must be a public HTTPS reference. It is never fetched.');
  const proof = await verifyArtifact(p, b), all = (await Promise.all((await packages(ctx)).map(p => artifacts(ctx, p)))).flat();
  const a = { ...b, recordId: ctx.nextId('SPA', all.map(a => a.recordId)), packageId: p.packageId, submittedBy: ctx.actor.id, submittedAt: ctx.iso(), integrity: proof.integrity, carriedFrom: null, provenance: LOCAL };
  ctx.put(ART, a.recordId, a, { created: true });
  return { ...a, text: null, contentUrl: a.text === null ? null : `/api/supplier-artifacts/${a.recordId}/content`, verification: proof };
});
write('createSupplierCriteria', 'SUPPLIER_CRITERIA_CREATE', CreateSupplierCriteriaBody, async ctx => {
  const b = ctx.req.body, all = await criteria(ctx, b.featureId);
  const ids = [...new Set((await features(ctx)).map(f => f.featureId as string))], history = (await Promise.all(ids.map(id => criteria(ctx, id)))).flat();
  const c = { ...b, criteriaId: ctx.nextId('SAC', history.map(c => c.criteriaId)), revision: (all.at(-1)?.revision ?? 0) + 1, createdBy: ctx.actor.id, createdAt: ctx.iso(), provenance: LOCAL };
  ctx.put(CRITERIA, c.criteriaId, c, { created: true }); return c;
});
write('submitSupplierPackage', 'SUPPLIER_PACKAGE_SUBMIT', SubmitSupplierPackageBody, async ctx => {
  const p = await pkg(ctx, ctx.req.params.id);
  if (!['DRAFT', 'REJECTED'].includes(p.status)) error('CONFLICT', 'Only draft or rejected packages can be submitted.');
  const rows = await artifacts(ctx, p), result = await check(ctx, p, rows);
  if (missingArtifacts(latestArtifacts(rows)).length) error('GUARD_FAILED', 'All ten required work products must be registered.');
  const next = { ...p, status: 'SUBMITTED', submittedBy: ctx.actor.id, submittedAt: ctx.iso(), submitNote: ctx.req.body.note, decidedBy: null, decidedAt: null, provenance: LOCAL };
  ctx.put(PKG, p.packageId, next); return { package: next, check: result, hold: result.verdict !== 'MET' };
});
write('reviewSupplierPackage', 'SUPPLIER_PACKAGE_REVIEW', ReviewSupplierPackageBody, async ctx => {
  const p = await pkg(ctx, ctx.req.params.id), b = ctx.req.body, rows = await artifacts(ctx, p);
  if (p.status !== 'SUBMITTED') error('CONFLICT', 'Only a submitted package can be reviewed.');
  if ([p.createdBy, p.submittedBy, ...rows.map(a => a.submittedBy)].includes(ctx.actor.id)) error('SEPARATION_OF_DUTY', 'An independent reviewer must decide; package and artifact participants cannot review.');
  const result = await check(ctx, p, rows);
  if (b.decision === 'ACCEPT' && (result.verdict !== 'MET' || !SUPPLIER_ARTIFACT_TYPES.every(t => b.items.some((i: any) => i.type === t && i.result === 'PASS')))) error('GUARD_FAILED', 'Verified bodies, current criteria and ten independent PASS decisions are required.');
  const previous = (await Promise.all((await packages(ctx)).map(p => reviews(ctx, p)))).flat(), r = { ...b, reviewId: ctx.nextId('SRV', previous.map(r => r.reviewId)), packageId: p.packageId, criteriaRevision: result.criteriaRevision, checkVerdict: result.verdict, reviewedBy: ctx.actor.id, reviewedAt: ctx.iso(), provenance: LOCAL };
  ctx.put(REVIEW, r.reviewId, r, { created: true });
  const next = { ...p, status: b.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', decidedBy: ctx.actor.id, decidedAt: r.reviewedAt, provenance: LOCAL };
  ctx.put(PKG, p.packageId, next); return { package: next, review: r, check: result };
});
registerSimReader('supplierGate', async ctx => {
  const f = await feature(ctx, ctx.req.params.id, ctx.req.params.ver), sw = await source(ctx, 'masterSw');
  if (!Array.isArray(sw.items)) return missing('masterSw');
  const suppliers = new Set<string>(), accepted: string[] = [], blockers: string[] = [];
  f.swIds.forEach((id: string, i: number) => {
    const rows = sw.items.filter((s: any) => s.swId === id && s.version === f.swVersions[i]);
    if (!rows.length) suppliers.add(`공급사 미확인(${id}@${f.swVersions[i] ?? '?'})`);
    for (const s of rows) if (!['Internal', 'OEM'].includes(s.supplier)) suppliers.add(s.supplier || `공급사 미확인(${id})`);
  });
  const ps = (await packages(ctx)).filter(p => p.featureId === f.featureId && p.featureVersion === f.version);
  ps.forEach(p => suppliers.add(p.supplier));
  for (const supplier of suppliers) {
    let valid: SupplierPackageRow | undefined;
    for (const p of ps.filter(p => p.supplier === supplier && p.status === 'ACCEPTED')) {
      const result = await check(ctx, p), r = (await reviews(ctx, p)).at(-1);
      if (result.verdict === 'MET' && r?.decision === 'ACCEPT' && r.criteriaRevision === result.criteriaRevision && r.reviewedBy !== p.submittedBy && SUPPLIER_ARTIFACT_TYPES.every(t => r.items.some(i => i.type === t && i.result === 'PASS'))) { valid = p; break; }
    }
    if (valid) accepted.push(valid.packageId); else blockers.push(`${supplier}: 이 Feature Version의 검증된 10항목·현재 기준·분리 검수 합격 패키지가 없습니다`);
  }
  return { applicable: suppliers.size > 0, suppliers: [...suppliers], accepted, blockers };
});

registerSimReader('supplierScope', async ctx => {
  const id = ctx.req.params.id, ver = ctx.req.params.ver, f = await feature(ctx, id, ver);
  // Contacts and version-unbound trace coverage remain captured read evidence, never an invented completion.
  const baseline = await source(ctx, 'supplierScope', { id, ver }), sw = await source(ctx, 'masterSw'), deps = await source(ctx, 'dependencies');
  if (!Array.isArray(baseline.suppliers) || !baseline.traceEvidence || !Array.isArray(sw.items) || !Array.isArray(deps.items)) return missing('supplierScope facts');
  const versions = (await features(ctx)).filter(f => f.featureId === id).sort((a, b) => compareVersion(a.version, b.version)), index = versions.findIndex(f => f.version === ver);
  const previous = index > 0 ? await feature(ctx, id, versions[index - 1].version) : null;
  const incoming = deps.items.filter((d: any) => d.type === 'REQUIRES' && d.targetFeatureId === id);
  const dependents = await Promise.all(incoming.filter((d: any) => d.targetVersion === ver).map((d: any) => feature(ctx, d.sourceFeatureId, d.sourceVersion)));
  const ps = (await packages(ctx)).filter(p => p.featureId === id && p.featureVersion === ver), latestByPackage: any = {};
  for (const p of ps) {
    const latest = latestArtifacts(await artifacts(ctx, p));
    if (latest.TEST_EVIDENCE?.integrity !== 'VERIFIED') delete latest.TEST_EVIDENCE;
    latestByPackage[p.packageId] = latest;
  }
  const trace = baseline.traceEvidence;
  const scope = supplierScope({ feature: f, previous, dependents, sw: sw.items, mappings: await mappings(ctx, id), packages: ps, latestByPackage, hasCriteria: (await criteria(ctx, id)).length > 0, directory: baseline.suppliers.map((s: any) => ({ supplier: s.supplier, displayName: s.supplier, contacts: s.contacts ?? [] })), traceEvidence: { required: trace.required, withEvidence: trace.withEvidence } });
  const suppliers = scope.map(s => {
    const report = s.latestPackage ? latestByPackage[s.latestPackage.packageId]?.TEST_EVIDENCE : undefined;
    return { ...s, evidence: { ...s.evidence, status: trace.required > 0 && s.evidence.status === 'COMPLETE' ? 'PARTIAL' : s.evidence.status, detail: s.evidence.detail + (trace.required > 0 ? ' · 추적 근거는 Feature 공통이며 Version 결속 미확인' : ''), featureVersion: ver, verification: report ? 'VERIFIED' : 'MISSING', source: report ? 'SUPPLIER_PACKAGE_BODY' : 'UNCONFIRMED' } };
  });
  return { ...baseline, feature: { featureId: id, version: ver, name: f.name }, suppliers, contractGaps: contractGaps(id, ver, suppliers), unresolvedDependencies: incoming.filter((d: any) => !d.targetVersion).map((d: any) => ({ dependencyId: d.dependencyId, sourceFeatureId: d.sourceFeatureId, sourceVersion: d.sourceVersion })) };
});

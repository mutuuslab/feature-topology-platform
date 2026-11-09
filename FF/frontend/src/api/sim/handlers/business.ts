// 시연 흐름 — 업무 묶음(business). 서버 서비스와 같은 규칙(contracts 순수 규칙)·같은 오류·감사·이벤트로 브라우저 안에서 처리한다(설계 20-60).
//  · D01-03 상품(catalog.service) — 등록·초안 수정·새 Catalog Version·구성 검증·전이(구성 승인 ≠ 고객 출시 승인, 작성자 승인 불가)
//  · D01-05 체험권(entitlement.service) + D05-04 구매 전환(billing) — 제안·수락·거절·구매
//  · D04-04 협의 의견(consult.service) · D07-01 개발비 산정(cost.service) · KERNEL 개인정보 요청(privacy.service)
//  · D05-01 외부 연계 충돌 처리·CR 연결 · D01-07 실험 · D04-05 사고·VOC · D04-06 품질 피드백 · D05-02/03/05/07 · D06-10/11 · D02-01 · D04-02/03
// 날짜 규칙(유효기간·체험 기간)은 스냅샷이 찍힌 날의 '오늘'을 쓴다 — 화면에 보이는 값과 같은 기준(서버만 아는 시계는 결정적으로).
import { costInputMissing,
  AddCostFeatureBody,
  AddCostReferenceBody,
  UpdateCostReferenceBody,
  canonicalCostSource,
  costFeatureSourceOf,
  costRefFactsOf,
  costReferenceMissing,
  costReferencePublic,
  addDays,
  AnswerConsultationBody,
  asSourceFilter,
  bumpVersion,
  canSeeCost,
  classifyVoc,
  ConcludeExperimentBody,
  consultOrder,
  ContractBasisBody,
  COST_TRANSITIONS,
  costAsilFactor,
  costApprovalDutyBlocker,
  CostBasis,
  CostBasisDraftBody,
  costCheckRate,
  costEngineSettings,
  costEstimateView,
  costMre,
  costSettingsView,
  CostTransitionBody,
  CreateCostProjectBody,
  CreateExperimentBody,
  CreateIncidentBody,
  CreateProductBody,
  CreateProductVersionBody,
  DataAccessRequestBody,
  dataActDecision,
  DeclineTrialBody,
  departmentName,
  effectEstimate,
  effectVerdict,
  evaluateFlag,
  EpochBumpBody,
  ErasureExecuteBody,
  ErasureRejectBody,
  ErasureRequestBody,
  estimate,
  evaluateProductGuards,
  examplePlan,
  EXPERIMENT_METRICS,
  experimentAllowed,
  FEATURE_TRANSITIONS,
  FeedbackAcceptBody,
  FieldCaseBody,
  grantState,
  ImportOrdersBody,
  incidentVehicleScope,
  isPseudonym,
  JIRA_CR_STATUS,
  KeyRotateBody,
  legacyPlan,
  lifecycleOfEpicStatus,
  LinkChangeRequestBody,
  mentionsIdentifier,
  MetricPlanBody,
  OfferTrialsBody,
  personalStores,
  PrivacyExportBody,
  PRODUCT_TRANSITIONS,
  productRuleFor,
  ProductTransitionBody,
  PurchaseTrialBody,
  PutCostActualBody,
  PutCostCheckBody,
  PutCostMbdBody,
  RATE_BASES,
  reconcile,
  ReferenceRetireBody,
  ReferenceValueBody,
  referenceValueProblems,
  refStatusPolicy,
  ResolveConflictBody,
  resolveOrder,
  ROLE_LABEL,
  RunSyncBody,
  sotifTrigger,
  shadowVerdict,
  sourceMatches,
  syncGate,
  TranslateLegacyBody,
  TRIAL_DAYS,
  UpdateCostLineBody,
  UpdateCostProjectBody,
  UpdateProductDraftBody,
  validateComposition,
  ValidateCompositionBody,
  variantRow,
  VehicleSchema,
  vexImpact,
  VexStatement,
  type BaselineRef,
  type CompositionResult,
  type LegacyMapping,
  type Lifecycle,
  type PlantOrder,
} from '@ff/contracts';
import { z } from 'zod';
import { registerSimHandler, registerSimReader, SimError, simInvoke } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { needsTrialTable, TRIAL_TABLE_PAGE, trialListOf, trialTableQuery, type TrialRow } from '../trial-list';
import PLANT_ORDERS from '../../../../../data/fixtures/ext/plantOrders.json';
import VOC_FEED_JSON from '../../../../../data/fixtures/ext/voc.json';

/** 모의 고객센터 VOC 원천(서버 adapters/if-mocks vocFeed와 같은 파일) */
const VOC_FEED = VOC_FEED_JSON as { ref: string; vin: string; featureName: string | null; severity: 'INFO' | 'WARNING' | 'CRITICAL'; text: string }[];

const EmptyBody = z.object({}).strict();
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const byVersion = (a: { version: string }, b: { version: string }) => a.version.localeCompare(b.version, undefined, { numeric: true });

/** 스냅샷 목록 + 오버레이 엔터티 — 키가 같으면 교체, 새것(created)은 앞에, 질의에 안 맞으면 뺀다 */
function overlayList<T>(ctx: SimReadContext, collection: string, base: T[], key: (t: T) => string, pass: (t: T) => boolean = () => true, show: (t: T) => T = (t) => t): T[] {
  const mine = ctx.overlay.entities[collection] ?? {};
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of base) {
    const k = key(it);
    seen.add(k);
    const e = mine[k] as T | undefined;
    if (!e) out.push(it);
    else if (pass(e)) out.push(show({ ...it, ...e }));
  }
  const created = (ctx.overlay.created[collection] ?? []).filter((k) => !seen.has(k) && mine[k] && pass(mine[k]));
  const moved = Object.keys(mine).filter((k) => !seen.has(k) && !created.includes(k) && pass(mine[k]));
  return [...[...created, ...moved].map((k) => show(mine[k])), ...out];
}
const touched = (ctx: SimReadContext, collection: string) => Object.keys(ctx.overlay.entities[collection] ?? {}).length > 0;

// ═══ D01-03 상품 ═══════════════════════════════════════════
type Product = Record<string, any> & { catalogId: string; version: string; lifecycle: Lifecycle; country: string; vehicleModel: string; trim: string; type: any; baselineIds: string[]; validFrom: string | null; validTo: string | null };
type ProductMeta = { createdBy: string | null; configApprovedBy: string | null; releaseApprovedBy: string | null };
type ProductEntity = Product & { _meta?: ProductMeta };
const PROD = 'product';
const pkey = (p: { catalogId: string; version: string }) => `${p.catalogId}@${p.version}`;
const strip = ({ _meta, featureCount: _f, ...p }: ProductEntity): Product => p as Product;

/** 확정 Baseline → 구성 검증 입력(Feature의 현재 Lifecycle — 화면이 보는 Feature 목록 기준) */
async function baselineRefs(ctx: SimReadContext): Promise<Map<string, BaselineRef>> {
  const [bl, fs] = await Promise.all([ctx.read<{ items: any[] }>('baselines').catch(() => ({ items: [] })), ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: 'false' }).catch(() => ({ items: [] }))]);
  const life = new Map(fs.items.map((f) => [`${f.featureId}@${f.version}`, f.lifecycle as Lifecycle]));
  const m = new Map<string, BaselineRef>();
  for (const b of bl.items) {
    const s = b.snapshot ?? {};
    m.set(b.baselineId, { baselineId: b.baselineId, featureId: b.featureId, version: b.version, name: s.name ?? b.featureId, lifecycle: life.get(`${b.featureId}@${b.version}`) ?? s.lifecycle, country: s.country, vehicleModel: s.vehicleModel, trim: s.trim });
  }
  return m;
}
async function dependencies(ctx: SimReadContext) {
  return (await ctx.read<{ items: any[] }>('dependencies').catch(() => ({ items: [] }))).items;
}
async function compose(ctx: SimReadContext, p: any, carriedOver: string[] = []): Promise<CompositionResult> {
  return validateComposition({ product: p as any, baselines: await baselineRefs(ctx), dependencies: await dependencies(ctx), carriedOver });
}
/** 이미 구성 승인을 받은 Version은 기존 구성 유지 허용(서버 compositionOf) */
const compositionOf = (ctx: SimReadContext, p: Product) => compose(ctx, p, p.lifecycle === 'PROPOSED' ? [] : p.baselineIds);
const guardsFor = (p: Product, to: Lifecycle, composition: CompositionResult) => {
  const rule = productRuleFor(p.lifecycle, to);
  if (!rule) return [`${p.lifecycle} → ${to} 전이는 정의되어 있지 않습니다.`];
  return evaluateProductGuards(rule, { composition, today: kstToday(), validFrom: p.validFrom, validTo: p.validTo });
};

/** 상품 Version 하나 — 시연에서 바뀐 것, 아니면 스냅샷 상세 */
async function productOf(ctx: SimReadContext, catalogId: string, version: string): Promise<{ product: Product; meta: ProductMeta } | null> {
  const e = ctx.get<ProductEntity>(PROD, `${catalogId}@${version}`);
  if (e) return { product: strip(e), meta: e._meta ?? { createdBy: null, configApprovedBy: null, releaseApprovedBy: null } };
  const d = await ctx.snapshot<any>('productDetail', { id: catalogId, ver: version });
  return d?.product ? { product: d.product, meta: d.meta ?? { createdBy: null, configApprovedBy: null, releaseApprovedBy: null } } : null;
}
async function productRows(ctx: SimReadContext): Promise<Product[]> {
  const base = (await ctx.snapshot<{ items: Product[] }>('listProducts'))?.items ?? [];
  return overlayList<Product>(ctx, PROD, base, pkey, () => true, (p) => strip(p as ProductEntity)).sort((a, b) => a.catalogId.localeCompare(b.catalogId) || byVersion(a, b));
}
async function productVersions(ctx: SimReadContext, catalogId: string) {
  return (await productRows(ctx)).filter((p) => p.catalogId === catalogId).sort(byVersion);
}

registerSimReader('listProducts', async (ctx) => {
  if (!touched(ctx, PROD)) return undefined;
  const q = ctx.req.query;
  const needle = q.q?.trim().toLowerCase();
  const items = (await productRows(ctx))
    .filter((p) => (!q.lifecycle || p.lifecycle === q.lifecycle) && (!q.saleType || p.saleType === q.saleType) && (!q.country || p.country === q.country))
    .filter((p) => !needle || [p.catalogId, p.name, p.ownerId, ...(p.tags ?? [])].some((s: string) => String(s).toLowerCase().includes(needle)))
    .map((p) => ({ ...p, featureCount: p.baselineIds.length }));
  return { items };
});

registerSimReader('productDetail', async (ctx) => {
  const { id, ver } = ctx.req.params;
  if (!ctx.get(PROD, `${id}@${ver}`) && !ctx.list<Product>(PROD).some((p) => p.catalogId === id)) return undefined;
  const got = await productOf(ctx, id, ver);
  if (!got) return undefined;
  const { product: p, meta } = got;
  const composition = await compositionOf(ctx, p);
  const reasons = evaluateProductGuards(productRuleFor('VERIFIED', 'RELEASED')!, { composition, today: kstToday(), validFrom: p.validFrom, validTo: p.validTo });
  return {
    product: p,
    meta,
    composition,
    eligibility: { eligible: reasons.length === 0, reasons },
    transitions: PRODUCT_TRANSITIONS.filter((r) => r.from === p.lifecycle && !r.auto).map((r) => ({ to: r.to, ko: r.ko, approval: r.approval ?? null, blockers: guardsFor(p, r.to, composition) })),
    versions: (await productVersions(ctx, id)).map((v) => ({ version: v.version, lifecycle: v.lifecycle })),
  };
});

registerSimHandler('validateComposition', async (ctx) => compose(ctx, ctx.req.body, ctx.req.body.carriedOver ?? []), { body: ValidateCompositionBody });

registerSimHandler(
  'createProduct',
  async (ctx) => {
    const body = ctx.req.body;
    const rows = await productRows(ctx);
    const dup = rows.find((x) => x.name === body.name && x.country === body.country && x.vehicleModel === body.vehicleModel && x.trim === body.trim);
    if (dup) ctx.fail('CONFLICT', `같은 범위에 같은 상품 ${dup.catalogId}이(가) 있습니다 — 구성 변경은 새 Catalog Version으로 하세요.`, { catalogId: dup.catalogId });
    const p: Product = { catalogId: ctx.nextId('CAT', rows.map((r) => r.catalogId)), version: '1.0.0', lifecycle: 'PROPOSED', ...body, _missing: {} };
    const comp = await compose(ctx, p);
    const target = pkey(p);
    ctx.put(PROD, target, { ...p, _meta: { createdBy: ctx.actor.id, configApprovedBy: null, releaseApprovedBy: null } }, { created: true });
    ctx.audit({ action: 'PRODUCT_CREATE', target, after: p, componentId: 'D01-03' });
    ctx.emit('product.created', target, { catalogId: p.catalogId, version: p.version, composition: comp.result }, { componentId: 'D01-03' });
    return { product: p, composition: comp };
  },
  { body: CreateProductBody },
);

registerSimHandler(
  'updateProductDraft',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const got = await productOf(ctx, id, ver);
    if (!got) return ctx.fail('NOT_FOUND', `${id} ${ver}을(를) 찾을 수 없습니다.`);
    const p = got.product;
    if (p.lifecycle !== 'PROPOSED') ctx.fail('IMMUTABLE', `${p.lifecycle} 상품은 직접 수정할 수 없습니다. 새 Catalog Version을 만드세요.`, undefined, { action: 'PRODUCT_UPDATE', target: `${id}@${ver}`, reason: `${p.lifecycle} 상품 수정 시도`, componentId: 'D01-03' });
    const next = { ...p, ...Object.fromEntries(Object.entries(ctx.req.body).filter(([, v]) => v !== undefined)) } as Product;
    ctx.put(PROD, `${id}@${ver}`, { ...next, _meta: got.meta });
    ctx.audit({ action: 'PRODUCT_UPDATE', target: `${id}@${ver}`, before: p, after: next, componentId: 'D01-03' });
    return { product: next, composition: await compositionOf(ctx, next) };
  },
  { body: UpdateProductDraftBody },
);

registerSimHandler(
  'createProductVersion',
  async (ctx) => {
    const { id } = ctx.req.params;
    const body = ctx.req.body;
    const got = await productOf(ctx, id, body.baseVersion);
    if (!got) return ctx.fail('NOT_FOUND', `${id} ${body.baseVersion}을(를) 찾을 수 없습니다.`);
    const latest = (await productVersions(ctx, id)).at(-1)?.version ?? body.baseVersion;
    const p = { ...got.product, ...Object.fromEntries(Object.entries(body.changes ?? {}).filter(([, v]) => v !== undefined)), version: bumpVersion(latest, body.bump), lifecycle: 'PROPOSED' } as Product;
    const target = pkey(p);
    ctx.put(PROD, target, { ...p, _meta: { createdBy: ctx.actor.id, configApprovedBy: null, releaseApprovedBy: null } }, { created: true });
    ctx.audit({ action: 'PRODUCT_VERSION_CREATE', target, before: { baseVersion: got.product.version }, after: p, reason: body.reason, componentId: 'D01-03' });
    ctx.emit('product.version.created', target, { catalogId: id, version: p.version, baseVersion: got.product.version }, { componentId: 'D01-03' });
    return { product: p, composition: await compose(ctx, p) };
  },
  { body: CreateProductVersionBody },
);

registerSimHandler(
  'productTransition',
  async (ctx) => {
    const { id, ver } = ctx.req.params;
    const { to, reason } = ctx.req.body as { to: Lifecycle; reason: string };
    const got = await productOf(ctx, id, ver);
    if (!got) return ctx.fail('NOT_FOUND', `${id} ${ver}을(를) 찾을 수 없습니다.`);
    const { product: p, meta } = got;
    const target = `${id}@${ver}`;
    const action = `PRODUCT_TRANSITION ${p.lifecycle}→${to}`;
    const fail = (code: string, msg: string, details?: unknown): never => ctx.fail(code, msg, details, { action, target, reason: msg, componentId: 'D01-03' });
    const rule = productRuleFor(p.lifecycle, to);
    if (!rule) fail('GUARD_FAILED', `${p.lifecycle} → ${to} 전이는 정의되어 있지 않습니다.`);
    if (!rule!.roles.includes(ctx.actor.role)) fail('FORBIDDEN', `이 전이는 ${rule!.roles.map((r) => ROLE_LABEL[r]).join(' · ')} 역할만 할 수 있습니다.`);
    if (!reason.trim()) fail('VALIDATION', '전이 사유를 입력하세요.');
    if (rule!.approval && meta.createdBy === ctx.actor.id) fail('SEPARATION_OF_DUTY', '상품 작성자는 자기 상품을 승인할 수 없습니다.');
    if (rule!.approval === 'RELEASE' && meta.configApprovedBy === ctx.actor.id) fail('SEPARATION_OF_DUTY', '구성 승인자와 고객 출시 승인자는 달라야 합니다.');
    const composition = await compositionOf(ctx, p);
    const blockers = guardsFor(p, to, composition);
    if (blockers.length) fail('GUARD_FAILED', `전이할 수 없습니다: ${blockers.join(' / ')}`, { blockers, composition });

    const nextMeta: ProductMeta = { ...meta, ...(rule!.approval === 'CONFIG' ? { configApprovedBy: ctx.actor.id } : rule!.approval === 'RELEASE' ? { releaseApprovedBy: ctx.actor.id } : {}) };
    const apply = (cur: Product, nextTo: Lifecycle, why: string, by: { id: string; role: string } | null): Product => {
      const next = { ...cur, lifecycle: nextTo };
      ctx.put(PROD, target, { ...next, _meta: nextMeta });
      // 자동 전이는 시스템 행위자(서버 system:catalog) — 감사에는 사유로 남긴다
      ctx.audit({ action: `PRODUCT_TRANSITION ${cur.lifecycle}→${nextTo}`, target, before: { lifecycle: cur.lifecycle }, after: { lifecycle: nextTo }, reason: by ? why : `${why} (system:catalog)`, componentId: 'D01-03' });
      ctx.emit('product.lifecycle.changed', target, { catalogId: id, version: ver, from: cur.lifecycle, to: nextTo, by: by?.id ?? 'system:catalog' }, { componentId: 'D01-03' });
      return next;
    };
    let cur = apply(p, to, reason, ctx.actor);
    // 구성 승인 직후: 아직 RELEASED가 아닌 Feature가 있으면 시스템이 DEVELOPING(출시 대기)로 옮긴다
    const auto = PRODUCT_TRANSITIONS.find((r) => r.from === cur.lifecycle && r.auto);
    if (auto && !evaluateProductGuards(auto, { composition, today: kstToday(), validFrom: cur.validFrom, validTo: cur.validTo }).length) cur = apply(cur, auto.to, `자동 전이: ${auto.ko}`, null);
    return { product: cur, composition };
  },
  { body: ProductTransitionBody },
);

// ═══ D01-05 체험권 · D05-04 구매 전환 ═══════════════════════
type Grant = Record<string, any> & { grantId: string; vin: string; catalogId: string; kind: string; status: string; validFrom: string; validTo: string; source: string; _baseState?: string | null };
const GRANT = 'grant';

/** 스냅샷이 찍힌 날(체험 목록의 today) — 기간 판단을 화면에 보이는 값과 같은 기준으로 */
async function trialToday(ctx: SimReadContext): Promise<string> {
  if (ctx.overlay.data.trialToday) return ctx.overlay.data.trialToday;
  const cats = ((await ctx.snapshot<{ items: Grant[] }>('entitlements'))?.items ?? []).map((g) => g.catalogId);
  for (const catalogId of [...new Set(cats)]) {
    const t = await ctx.snapshot<{ today?: string }>('trials', {}, { catalogId, source: 'ALL', pageSize: 50 });
    if (t?.today) return t.today;
  }
  return kstToday();
}
const viewOf = (g: Grant, today: string) => {
  const s = grantState(g as any, today);
  const { _baseState, ...rest } = g;
  return { ...rest, state: s.state, effective: s.effective && (g.usesLeft == null || g.usesLeft > 0), daysLeft: s.daysLeft };
};
/** 체험권 하나 — 시연에서 바뀐 것, 아니면 스냅샷(등록 차량 목록·체험 목록) */
async function grantOf(ctx: SimReadContext, grantId: string): Promise<Grant | null> {
  const e = ctx.get<Grant>(GRANT, grantId);
  if (e) return e;
  const all = (await ctx.snapshot<{ items: Grant[] }>('entitlements'))?.items ?? [];
  const hit = all.find((g) => g.grantId === grantId);
  if (hit) return { ...hit, _baseState: hit.state };
  for (const g of all) {
    const t = await ctx.snapshot<{ items: Grant[] }>('trials', {}, { catalogId: g.catalogId, source: 'FLEET', pageSize: 50 });
    const x = t?.items.find((i) => i.grantId === grantId);
    if (x) return { ...x, _baseState: x.state };
  }
  return null;
}
const stripView = ({ state: _s, effective: _e, daysLeft: _d, profile: _p, ...g }: Grant) => g as Grant;

/** 지원하지 않는 차량(FFG-VEH-006) — 이 상품을 권리로 켜는 배포 정책의 Feature를 이 차량이 지원하지 않는가(서버 unsupported) */
async function unsupported(ctx: SimReadContext, vin: string, catalogId: string): Promise<string | null> {
  const v = ((await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? []).find((x) => x.vin === vin);
  if (!v) return null;
  const pols = ((await ctx.read<{ items: any[] }>('listPolicies').catch(() => ({ items: [] }))).items ?? []).filter((p) => p.status === 'DEPLOYED' && p.entitlementCatalogId === catalogId);
  for (const p of pols) {
    const f = (await ctx.snapshot<any>('featureDetail', { id: p.featureId, ver: p.featureVersion }))?.feature;
    if (!f) continue;
    const row = variantRow({ ...f, featureId: p.featureId, version: p.featureVersion }, v);
    if (row.verdict === 'NOT_SUPPORTED') return `NOT_SUPPORTED: ${p.featureId} ${p.featureVersion} — ${row.reason}`;
  }
  return null;
}
function refuse(ctx: SimWriteContext, action: string, g: Grant, message: string): never {
  return ctx.fail('GUARD_FAILED', message, { grantId: g.grantId, status: g.status }, { action, target: g.grantId, reason: message, componentId: 'D01-05' });
}
async function mustTrial(ctx: SimWriteContext, grantId: string, action: string): Promise<Grant> {
  const g = await grantOf(ctx, grantId);
  if (!g) return ctx.fail('NOT_FOUND', `${grantId}을(를) 찾을 수 없습니다.`);
  if (g.kind !== '체험') refuse(ctx, action, g, `${grantId}은(는) 체험권이 아닙니다 (${g.kind}).`);
  return stripView(g);
}
const putGrant = (ctx: SimWriteContext, g: Grant, created = false) => ctx.put(GRANT, g.grantId, g, { created });

/** 체험 목록 전체 표(출처 ALL, 서버 정렬) — 성향·검색·다음 쪽용. 스냅샷이 없는 상품이면 null */
async function trialTable(ctx: SimReadContext, catalogId: string): Promise<{ today: string; rows: TrialRow[] } | null> {
  const first = await ctx.snapshot<{ today: string; total: number; items: TrialRow[] }>('trials', {}, trialTableQuery(catalogId, 1));
  if (!first) return null;
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / TRIAL_TABLE_PAGE) - 1) }, (_, i) => ctx.snapshot<{ items: TrialRow[] }>('trials', {}, trialTableQuery(catalogId, i + 2))));
  if (rest.some((x) => !x)) return null;
  const rows = [...first.items, ...rest.flatMap((x) => x!.items)];
  // 이 브라우저에서 바뀐·새로 생긴 체험권(제안·수락·구매 전환)
  const profiles = new Map(rows.map((r) => [r.vin, r.profile]));
  const mine = new Map(ctx.list<Grant>(GRANT).filter((g) => g.kind === '체험' && g.catalogId === catalogId).map((g) => [g.grantId, { ...viewOf(g, first.today), profile: g.profile ?? profiles.get(g.vin) ?? null } as TrialRow]));
  const merged = rows.map((r) => mine.get(r.grantId) ?? r);
  const seen = new Set(rows.map((r) => r.grantId));
  return { today: first.today, rows: [...merged, ...[...mine.values()].filter((r) => !seen.has(r.grantId))] };
}

registerSimReader('trials', async (ctx) => {
  const q = ctx.req.query;
  // 성향·검색어·다음 쪽 — 전체 표에서 서버 규칙(trial-list.ts)으로
  if (needsTrialTable(q) && q.catalogId) {
    const t = await trialTable(ctx, q.catalogId);
    return t ? trialListOf(t.rows, t.today, q) : undefined;
  }
  if (!touched(ctx, GRANT)) return undefined;
  const today = await trialToday(ctx);
  const source = asSourceFilter(q.source ?? 'ALL');
  const segments = ['country', 'region', 'vehicleModel', 'trim', 'ageBand', 'drivingStyle', 'adasUsage'].filter((k) => q[k]);
  // 스냅샷이 있는 질의(상품·출처·상태)만 — 성향·검색·다음 쪽은 서버 전체 표가 필요하다
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const inScope = (g: Grant) => g.kind === '체험' && (!q.catalogId || g.catalogId === q.catalogId) && sourceMatches(source, g.source as any) && !segments.length && !q.q;
  const mine = ctx.list<Grant>(GRANT).filter(inScope);
  const byState: Record<string, number> = { ...(base.byState ?? {}) };
  for (const g of mine) {
    if (g._baseState) byState[g._baseState] = Math.max(0, (byState[g._baseState] ?? 0) - 1);
    const s = viewOf(g, today).state;
    byState[s] = (byState[s] ?? 0) + 1;
  }
  const profiles = new Map<string, any>();
  for (const it of base.items ?? []) if (it.profile) profiles.set(it.vin, it.profile);
  const show = (g: Grant) => ({ ...viewOf(g, today), profile: g.profile ?? profiles.get(g.vin) ?? null });
  const items = overlayList(ctx, GRANT, base.items ?? [], (g: Grant) => g.grantId, (g) => inScope(g) && (!q.state || viewOf(g, today).state === q.state), show);
  const total = q.state ? (byState[q.state] ?? 0) : Object.values(byState).reduce((a, b) => a + Number(b), 0);
  const pageSize = Number(q.pageSize) || 50;
  return { ...base, today, byState, total, items: items.slice(0, pageSize) };
});

registerSimReader('entitlements', async (ctx) => {
  if (!touched(ctx, GRANT)) return undefined;
  const base = await ctx.snapshot<{ items: Grant[] }>();
  if (!base) return undefined;
  const today = await trialToday(ctx);
  const q = ctx.req.query;
  const source = asSourceFilter(q.source);
  const items = overlayList(ctx, GRANT, base.items, (g) => g.grantId, (g) => (!q.vin || g.vin === q.vin) && sourceMatches(source, g.source as any), (g) => viewOf(g, today) as Grant);
  return { ...base, items };
});

registerSimHandler(
  'offerTrials',
  async (ctx) => {
    const body = ctx.req.body as { catalogId: string; vins: string[]; note?: string };
    if (!(await productRows(ctx)).some((p) => p.catalogId === body.catalogId)) ctx.fail('NOT_FOUND', `${body.catalogId} 상품을 찾을 수 없습니다.`);
    const today = await trialToday(ctx);
    ctx.state('trialToday', () => today);
    const vehicles = (await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? [];
    const known = ((await ctx.read<{ items: Grant[] }>('entitlements').catch(() => ({ items: [] }))).items ?? []).map((g) => stripView(g));
    const fleet = (await ctx.read<{ items: Grant[] }>('trials', {}, { catalogId: body.catalogId, source: 'FLEET', pageSize: 50 }).catch(() => ({ items: [] }))).items ?? [];
    const all = new Map<string, Grant>([...[...known, ...fleet].map((g) => [g.grantId, stripView(g)] as const), ...ctx.list<Grant>(GRANT).map((g) => [g.grantId, g] as const)]);
    const offered: unknown[] = [];
    const skipped: { vin: string; reason: string }[] = [];
    for (const vin of [...new Set(body.vins)]) {
      const v = vehicles.find((x) => x.vin === vin);
      if (!v) {
        skipped.push({ vin, reason: 'Fleet에 없는 차량' });
        continue;
      }
      if (v.gleo) {
        skipped.push({ vin, reason: '시뮬레이터 차량은 고객 체험 대상이 아닙니다' });
        continue;
      }
      const why = await unsupported(ctx, vin, body.catalogId);
      if (why) {
        skipped.push({ vin, reason: why });
        continue;
      }
      const mine = [...all.values()].filter((g) => g.vin === vin && g.catalogId === body.catalogId).map((g) => ({ ...g, ...viewOf(g, today) }));
      const blocking = mine.find((g) => (g.kind === '체험' && ['OFFERED', 'ACTIVE', 'CONVERTED'].includes(g.state)) || (g.kind !== '체험' && g.effective));
      if (blocking) {
        skipped.push({ vin, reason: `${blocking.grantId} ${blocking.kind} ${blocking.state}` });
        continue;
      }
      const g: Grant = {
        grantId: ctx.nextId('ENT', [...all.keys()]),
        vin,
        catalogId: body.catalogId,
        kind: '체험',
        validFrom: today,
        validTo: addDays(today, 13),
        usesLeft: null,
        status: 'OFFERED',
        offeredAt: today,
        acceptedAt: null,
        trialDays: null,
        convertedAt: null,
        convertedPlan: null,
        fromTrial: null,
        source: v.fleet === 'PRODUCTION' ? 'PRODUCTION' : 'DEMO',
        note: body.note ?? null,
        noticeId: null,
        noticeAt: null,
        noticeFor: null,
        expiredAt: null,
        _baseState: null,
      };
      all.set(g.grantId, g);
      putGrant(ctx, g, true);
      ctx.audit({ action: 'TRIAL_OFFER', target: g.grantId, after: { vin, catalogId: g.catalogId, validTo: g.validTo }, componentId: 'D01-05' });
      ctx.emit('entitlement.offered', vin, { grantId: g.grantId, catalogId: g.catalogId, offerUntil: g.validTo }, { componentId: 'D01-05' });
      offered.push(viewOf(g, today));
    }
    return { offered, skipped };
  },
  { body: OfferTrialsBody },
);

registerSimHandler(
  'acceptTrial',
  async (ctx) => {
    const g = await mustTrial(ctx, ctx.req.params.grantId, 'TRIAL_ACCEPT');
    const today = await trialToday(ctx);
    ctx.state('trialToday', () => today);
    const s = grantState(g as any, today).state;
    if (s !== 'OFFERED') refuse(ctx, 'TRIAL_ACCEPT', g, `수락할 수 없는 체험권입니다 (${s}${g.acceptedAt ? `, ${g.acceptedAt} 수락` : ''}).`);
    const why = await unsupported(ctx, g.vin, g.catalogId);
    if (why) refuse(ctx, 'TRIAL_ACCEPT', g, `수락할 수 없는 체험권입니다 — ${why}`);
    const next: Grant = { ...g, status: 'ACTIVE', acceptedAt: today, validFrom: today, validTo: addDays(today, TRIAL_DAYS - 1), trialDays: TRIAL_DAYS };
    putGrant(ctx, next);
    ctx.audit({ action: 'TRIAL_ACCEPT', target: g.grantId, before: { status: g.status }, after: { status: next.status, validFrom: next.validFrom, validTo: next.validTo }, componentId: 'D01-05' });
    ctx.emit('entitlement.accepted', g.vin, { grantId: g.grantId, catalogId: g.catalogId, validFrom: next.validFrom, validTo: next.validTo }, { componentId: 'D01-05' });
    return viewOf(next, today);
  },
  { body: EmptyBody },
);

registerSimHandler(
  'declineTrial',
  async (ctx) => {
    const g = await mustTrial(ctx, ctx.req.params.grantId, 'TRIAL_DECLINE');
    const today = await trialToday(ctx);
    ctx.state('trialToday', () => today);
    const s = grantState(g as any, today).state;
    if (s !== 'OFFERED') refuse(ctx, 'TRIAL_DECLINE', g, `거절할 수 없는 체험권입니다 (${s}).`);
    const reason = ctx.req.body?.reason as string | undefined;
    const next: Grant = { ...g, status: 'DECLINED', note: reason ?? g.note };
    putGrant(ctx, next);
    ctx.audit({ action: 'TRIAL_DECLINE', target: g.grantId, before: { status: g.status }, after: { status: 'DECLINED', reason: reason ?? null }, componentId: 'D01-05' });
    ctx.emit('entitlement.declined', g.vin, { grantId: g.grantId, catalogId: g.catalogId }, { componentId: 'D01-05' });
    return viewOf(next, today);
  },
  { body: DeclineTrialBody },
);

registerSimHandler(
  'purchaseTrial',
  async (ctx) => {
    const plan = ctx.req.body.plan as '구독' | '구매';
    const trial = await mustTrial(ctx, ctx.req.params.grantId, 'TRIAL_PURCHASE');
    const today = await trialToday(ctx);
    ctx.state('trialToday', () => today);
    const s = grantState(trial as any, today).state;
    if (!trial.acceptedAt || (s !== 'ACTIVE' && s !== 'EXPIRED')) refuse(ctx, 'TRIAL_PURCHASE', trial, `구매로 전환할 수 없는 체험권입니다 (${s}${trial.acceptedAt ? '' : ', 수락 전'}).`);
    const why = await unsupported(ctx, trial.vin, trial.catalogId);
    if (why) refuse(ctx, 'TRIAL_PURCHASE', trial, `구매로 전환할 수 없는 체험권입니다 — ${why}`);
    // 모의 과금 시스템 주문(멱등 키 = 체험권:요금제) — 같은 요청이면 같은 주문
    const orders = ctx.state<Record<string, string>>('billingOrders', () => ({}));
    const idem = `${trial.grantId}:${plan}`;
    const orderId = (orders[idem] ??= ctx.nextId('ORD', Object.values(orders)));
    const order = { orderId, vin: trial.vin, catalogId: trial.catalogId, plan, status: 'PAID' as const };
    const known = ((await ctx.read<{ items: Grant[] }>('entitlements').catch(() => ({ items: [] }))).items ?? []).map((g) => g.grantId);
    const done: Grant = { ...trial, status: 'CONVERTED', convertedAt: today, convertedPlan: plan };
    const grant: Grant = {
      grantId: ctx.nextId('ENT', [...known, ...ctx.list<Grant>(GRANT).map((g) => g.grantId)]),
      vin: trial.vin,
      catalogId: trial.catalogId,
      kind: plan,
      validFrom: today,
      validTo: plan === '구독' ? addDays(today, 364) : '9999-12-31',
      usesLeft: null,
      status: 'ACTIVE',
      offeredAt: null,
      acceptedAt: null,
      trialDays: null,
      convertedAt: null,
      convertedPlan: null,
      fromTrial: trial.grantId,
      source: trial.source,
      note: `주문 ${orderId}`,
      noticeId: null,
      noticeAt: null,
      noticeFor: null,
      expiredAt: null,
      _baseState: null,
    };
    putGrant(ctx, done);
    putGrant(ctx, grant, true);
    ctx.audit({ action: 'TRIAL_PURCHASE', target: trial.grantId, before: { status: trial.status }, after: { status: 'CONVERTED', plan, grantId: grant.grantId, orderId }, componentId: 'D05-04' });
    ctx.emit('entitlement.converted', trial.vin, { grantId: trial.grantId, newGrantId: grant.grantId, catalogId: trial.catalogId, plan, orderId }, { componentId: 'D05-04' });
    return { order, trial: viewOf(done, today), grant: viewOf(grant, today) };
  },
  { body: PurchaseTrialBody },
);

// ═══ D04-04 협의 의견 ═══════════════════════════════════════
const CONSULT = 'consult';
async function consultOf(ctx: SimReadContext, id: string): Promise<any | null> {
  return ctx.get(CONSULT, id) ?? (await ctx.snapshot<any>('consultationDetail', { id }))?.consultation ?? null;
}
registerSimReader('listConsultations', async (ctx) => {
  if (!touched(ctx, CONSULT)) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const q = ctx.req.query;
  const items = overlayList(ctx, CONSULT, base.items ?? [], (c: any) => c.consultId, (c) => (!q.to || c.toDept === q.to) && (!q.from || c.fromDept === q.from) && (!q.status || c.status === q.status)).sort(consultOrder);
  return { ...base, items, total: items.length, open: items.filter((c) => c.status === 'OPEN').length, overdue: items.filter((c) => c.status === 'OPEN' && c.daysLeft < 0).length };
});
registerSimReader('consultationDetail', async (ctx) => {
  const c = ctx.get(CONSULT, ctx.req.params.id);
  return c ? { consultation: c } : undefined;
});

registerSimHandler(
  'answerConsultation',
  async (ctx) => {
    const id = ctx.req.params.id;
    const body = ctx.req.body as { department: string; opinion: string; memo: string };
    const c = await consultOf(ctx, id);
    if (!c) return ctx.fail('NOT_FOUND', `협의 요청 ${id}을(를) 찾을 수 없습니다.`);
    if (body.department !== c.toDept) {
      const message = `이 협의 요청은 ${departmentName(c.toDept)}에 온 건입니다 — ${departmentName(body.department)}은(는) 의견을 낼 수 없습니다.`;
      ctx.fail('FORBIDDEN', message, { toDept: c.toDept }, { action: 'CONSULT_OPINION', target: id, reason: message, componentId: 'D04-04' });
    }
    if (ctx.actor.id === c.requestedBy) {
      const message = '협의를 요청한 사람은 자기 요청에 의견을 낼 수 없습니다.';
      ctx.fail('SEPARATION_OF_DUTY', message, { consultId: id }, { action: 'CONSULT_OPINION', target: id, reason: message, componentId: 'D04-04' });
    }
    const entry = { opinion: body.opinion, memo: body.memo, by: ctx.actor.id, department: body.department, at: ctx.iso() };
    const next = { ...c, status: 'ANSWERED', opinions: [...(c.opinions ?? []), entry] };
    ctx.put(CONSULT, id, next);
    ctx.audit({ action: 'CONSULT_OPINION', target: id, before: { status: c.status, opinions: (c.opinions ?? []).length }, after: entry, reason: body.memo, componentId: 'D04-04' });
    ctx.emit('consult.answered', id, { consultId: id, opinion: body.opinion, toDept: c.toDept, fromDept: c.fromDept, requestedBy: c.requestedBy, by: ctx.actor.id }, { componentId: 'D04-04' });
    return next;
  },
  { body: AnswerConsultationBody },
);


// ═══ D07-01 개발비 산정 ═══════════════════════════════════════
// 계산은 서버와 같은 contracts 엔진(estimate)이 한다 — 계수 표(costBasis)·Feature DB 기준 행(refDetail)은 화면이 보는 값에서.
type CostLine = { lineNo: number; featureId: string|null; version: string|null; refId: string; role: 'PRIMARY' | 'INCLUDED'|'REFERENCE'; sourceRevision?:number; featureAsil: string; inputs: Record<string, any> };
type CostCheckRow = { status: string; memo: string; updatedBy: string; updatedAt: string };
interface CostProj {
  estId: string;
  doc: Record<string, any> & { estId: string; basisVersion: string; settings: any; currency: string; rev: number; refRelease: string | null };
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lines: CostLine[];
  sourceRevisions?:Record<string,any[]>;
  mbd: { refId: string; seq: number; counts: (number | null)[] }[];
  checks: Record<string, CostCheckRow>;
  actuals: Record<string, number>;
  approvals: { rev: number; approvedBy: string; approvedAt: string; reason: string; basisVersion: string; resultSha256: string; sources?:{lineNo:number;revision:number}[] }[];
  /** 승인 때 고정한 결과(rev → 계산 결과) */
  results: Record<string, any>;
}
const COST = 'costProject';
const COST_BASIS = 'costBasis';
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
class CostRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function basisList(ctx: SimReadContext): Promise<{ items: any[]; latest: string | null }> {
  const base = (await ctx.snapshot<{ items: any[]; latest: string | null }>('costBasisList')) ?? { items: [], latest: null };
  const items = overlayList(ctx, COST_BASIS, base.items, (b: any) => b.version, () => true, ({ basis: _b, ...m }: any) => m);
  const published = items.filter((b) => b.status === 'PUBLISHED').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || String(b.version).localeCompare(String(a.version)));
  return { ...base, items, latest: published[0]?.version ?? base.latest };
}
async function basisOf(ctx: SimReadContext, version: string): Promise<any> {
  const mine = ctx.get<any>(COST_BASIS, version);
  if (mine) return mine.basis;
  const d = await ctx.snapshot<any>('costBasis', { version });
  if (!d?.basis) throw new CostRuleError('NOT_FOUND', `계수 표 ${version}이(가) 없습니다.`);
  return d.basis;
}
async function latestBasis(ctx: SimReadContext): Promise<string> {
  const l = (await basisList(ctx)).latest;
  if (!l) throw new CostRuleError('CONFLICT', '발행된 계수 표가 없습니다 — 원가 기준 관리자가 먼저 발행합니다.');
  return l;
}
async function latestRefRelease(ctx: SimReadContext): Promise<string | null> {
  const r = await ctx.read<{ items: { release: string; publishedAt: string }[] }>('refReleases').catch(() => ({ items: [] }));
  return [...(r.items ?? [])].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0]?.release ?? null;
}
async function refRow(ctx: SimReadContext, refId: string): Promise<any | null> {
  const d = await ctx.read<any>('refDetail', { refId }).catch(() => null);
  return d?.ref ?? null;
}
/**
 * 공개 스냅샷의 기준 행은 금액 칸(벤치마크 €)을 가린다 — 서버가 계산해 둔 산정 과제의 명목 포인트(nominal = € ÷ 앵커 ÷ 대표 ASIL 계수)에서
 * 같은 값을 되살린다(이미 공개된 계산 결과에서만, 새 금액을 만들지 않는다). 없으면 T-shirt 포인트(엑셀 N(O) = 0과 같음)
 */
async function snapshotNominals(ctx: SimReadContext): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const p of (await ctx.snapshot<{ items: { estId: string }[] }>('costProjects'))?.items ?? []) {
    const d = await ctx.snapshot<any>('costProject', { estId: p.estId });
    for (const l of d?.result?.lines ?? []) if (typeof l.nominal === 'number' && !m.has(l.refId)) m.set(l.refId, l.nominal);
  }
  return m;
}
/** 엔진 사실 — 줄의 기준 행과 그 중복 대상. 순서(ord)는 기준 ID 순 — 합계 순서만 바뀌고 값은 같다(서버 refFacts) */
async function refFacts(ctx: SimReadContext, refIds: string[], basis: any) {
  const rows = new Map<string, any>();
  const want = [...new Set(refIds)];
  for (let i = 0; i < want.length; i++) {
    const r = await refRow(ctx, want[i]);
    if (!r) continue;
    rows.set(r.refId, r);
    if (r.duplicateOf && !want.includes(r.duplicateOf)) want.push(r.duplicateOf);
  }
  const nominal = await snapshotNominals(ctx);
  const bench = (r: any) => (typeof r.benchmarkEur === 'number' ? r.benchmarkEur : nominal.has(r.refId) ? nominal.get(r.refId)! * basis.benchmark.anchorEur * costAsilFactor(basis, r.asilRep) : null);
  const ids = [...rows.keys()].sort();
  return new Map(
    ids.map((id, ord) => {
      const r = rows.get(id);
      return [id, { refId: id, ord, tshirt: r.tshirt, asilRep: r.asilRep, lifecycle: r.lifecycle, autoQuality: r.autoQuality, benchmarkEur: bench(r), bundleId: r.bundleId || null, bundleRep: !!r.bundleRep, sizeEvidenceGrade: r.sizeEvidenceGrade || null, duplicateOf: r.duplicateOf || null, requires: r.requires ?? [] }] as const;
    }),
  );
}
async function costReferencePreview(ctx:SimReadContext,refId:string,basisVersion?:string):Promise<any>{
 if(!canSeeCost(ctx.actor.role))throw new SimError('FORBIDDEN','산정 원천의 금액 정보는 산정 역할만 조회할 수 있습니다.');
 const base=await ctx.snapshot<any>('costReference',{refId});const current=await refRow(ctx,refId);
 if(!current)throw new SimError('NOT_FOUND','기준 행이 없습니다.');
 if(!base?.ref || !Object.hasOwn(base.ref,'benchmarkEur'))throw new SimError('CONFLICT','산정 원천의 공개 데모 스냅샷이 없습니다. 원천을 다시 수집한 뒤 산정하세요.');
 const relatedReferences=[];for(const related of base.relatedReferences ?? []){const latest=await refRow(ctx,related.refId);relatedReferences.push(latest?{...related,...latest}:related);}
 const ref={...base.ref,...current};const version=basisVersion ?? await latestBasis(ctx);const basis=await basisOf(ctx,version);const refRelease=await latestRefRelease(ctx);
 const missing=costReferenceMissing(ref,basis);const candidates=new Map<string,any>();
 for(const f of base.features ?? [])candidates.set(`${f.featureId}@${f.version}`,f);
 for(const e of ctx.list<any>('regFeature'))candidates.set(`${e.row.featureId}@${e.row.version}`,e.row);
 const features=[];for(const c of candidates.values()){const f=await featureRow(ctx,c.featureId,c.version);if(f && (f.featureRefs ?? []).some((l:any)=>l.refId===refId))features.push({featureId:f.featureId,version:f.version,name:f.name,asil:f.asil,lifecycle:f.lifecycle,sha256:await sha256(canonicalCostSource(costFeatureSourceOf(f)))});}
 return {...base,ref,relatedReferences,basisVersion:version,refRelease,referenceSha256:await sha256(canonicalCostSource(ref)),features,usable:!!refRelease && refStatusPolicy(ref.status).costUsable && !missing.length,missing:[...(!refRelease?['REFERENCE_RELEASE']:[]),...missing]};
}
async function costValidateReference(ctx:SimWriteContext,p:CostProj,selection:any){
 const preview=await costReferencePreview(ctx,selection.refId,p.doc.basisVersion);
 if(selection.refRelease!==preview.refRelease || selection.refRelease!==p.doc.refRelease)ctx.fail('CONFLICT','Feature DB 발행 버전이 달라졌습니다. 과제의 최신 기준을 확인하세요.');
 if(selection.referenceSha256!==preview.referenceSha256)ctx.fail('CONFLICT','선택한 기준 행의 내용이 변경됐습니다.');
 if(!preview.usable)ctx.fail('VALIDATION','산정할 수 없는 기준 행이거나 필수 계수가 없습니다.',{missing:preview.missing});
 let feature:any=null;if(selection.feature){feature=await featureRow(ctx,selection.feature.featureId,selection.feature.version);if(!feature)ctx.fail('NOT_FOUND','연결할 Feature 버전이 없습니다.');if(!(feature.featureRefs ?? []).some((l:any)=>l.refId===selection.refId))ctx.fail('VALIDATION','선택한 기준 행을 참조하는 실제 Feature만 연결할 수 있습니다.');if(await sha256(canonicalCostSource(costFeatureSourceOf(feature)))!==selection.feature.sha256)ctx.fail('CONFLICT','연결할 Feature 내용이 변경됐습니다.');}
 return {preview,feature};
}
function costNextLine(p:CostProj){return Math.max(0,...p.lines.map(l=>l.lineNo),...Object.keys(p.sourceRevisions ?? {}).map(Number))+1;}
async function costCaptureReference(ctx:SimWriteContext,p:CostProj,line:CostLine,value:any,reason:string){
 const {preview,feature}=value;const revisions=(p.sourceRevisions ??= {})[String(line.lineNo)] ??= [];const revision=Math.max(0,...revisions.map((s:any)=>s.revision))+1;
 const snapshot={reference:preview.ref,relatedReferences:preview.relatedReferences ?? [],facts:costRefFactsOf(preview.ref,preview.ord ?? 0),feature:feature?costFeatureSourceOf(feature):null,sources:preview.sources ?? []};
 revisions.push({revision,provenance:preview.provenance??null,release:preview.refRelease,referenceSha256:preview.referenceSha256,featureSha256:feature?await sha256(canonicalCostSource(snapshot.feature)):null,capturedBy:ctx.actor.id,capturedAt:ctx.iso(),reason,snapshot});
 line.sourceRevision=revision;line.featureId=feature?.featureId ?? null;line.version=feature?.version ?? null;line.role=feature?(feature.featureRefs ?? []).find((l:any)=>l.refId===line.refId).role:'REFERENCE';line.featureAsil=feature?.asil ?? preview.ref.asilRep;
}
async function costAppendReference(ctx:SimWriteContext,p:CostProj,selection:any,reason:string){
 if(p.lines.some(l=>l.refId===selection.refId))ctx.fail('CONFLICT','이 기준 행은 이미 과제에 있습니다. 기존 줄의 연결·원천을 변경하세요.');
 const value=await costValidateReference(ctx,p,selection);const line:CostLine={lineNo:costNextLine(p),refId:selection.refId,featureId:null,version:null,role:'REFERENCE',featureAsil:value.preview.ref.asilRep,inputs:{qty:1}};await costCaptureReference(ctx,p,line,value,reason);p.lines.push(line);
 ctx.audit({action:'COST_REFERENCE_ADD',target:`${p.estId}#${line.lineNo}`,after:{refId:line.refId,featureId:line.featureId,revision:line.sourceRevision,release:value.preview.refRelease,referenceSha256:value.preview.referenceSha256},reason,componentId:'D07-01'});
}
async function costSourceView(ctx:SimReadContext,p:CostProj,lineNo:number,revision:number,withSnapshot=false):Promise<any>{
 const history=p.sourceRevisions?.[String(lineNo)] ?? [];const source=history.find((s:any)=>s.revision===revision);if(!source?.snapshot)throw new SimError('CONFLICT','고정한 원천 스냅샷이 없습니다. 최신 기준을 명시 적용하세요.');
 const {snapshot,...metadata}=source;const base=await ctx.snapshot<any>('costReference',{refId:snapshot.reference.refId});const current=await refRow(ctx,snapshot.reference.refId);const currentReferenceSha256=current && base?.ref?await sha256(canonicalCostSource({...base.ref,...current})):null;
 const feature=snapshot.feature?await featureRow(ctx,snapshot.feature.featureId,snapshot.feature.version):null;const featureSha=feature?await sha256(canonicalCostSource(costFeatureSourceOf(feature))):null;
 let relatedStale=false;for(const related of snapshot.relatedReferences ?? []){const latest=await refRow(ctx,related.refId);if(!latest || canonicalCostSource({...related,...latest})!==canonicalCostSource(related))relatedStale=true;}
 return {...metadata,kind:snapshot.feature?'REGISTERED_FEATURE':'FEATURE_DB',stale:relatedStale || source.referenceSha256!==currentReferenceSha256 || source.featureSha256!==featureSha,latestRelease:await latestRefRelease(ctx),currentReferenceSha256,reference:costReferencePublic(snapshot.reference),feature:snapshot.feature,sources:snapshot.sources,history:history.map(({snapshot:_s,...m}:any)=>({revision:m.revision,release:m.release,referenceSha256:m.referenceSha256,featureSha256:m.featureSha256,capturedBy:m.capturedBy,capturedAt:m.capturedAt,reason:m.reason})),...(withSnapshot && canSeeCost(ctx.actor.role)?{snapshot}:{})};
}
registerSimReader('costReference',ctx=>costReferencePreview(ctx,ctx.req.params.refId,ctx.req.query.basisVersion));
registerSimReader('costReferenceHistory',async ctx=>{const p=await costOf(ctx,ctx.req.params.estId);if(!p)throw new SimError('NOT_FOUND','산정 과제가 없습니다.');return costSourceView(ctx,p,Number(ctx.req.params.lineNo),Number(ctx.req.params.revision),true);});
registerSimHandler('costReferenceAdd',async ctx=>{const p=await costDraft(ctx,ctx.req.params.estId,'COST_REFERENCE_ADD');await costAppendReference(ctx,p,ctx.req.body,'Feature DB 기준 행 추가');saveCost(ctx,p);return costDetail(ctx,p);},{body:AddCostReferenceBody});
registerSimHandler('costReferenceUpdate',async ctx=>{const p=await costDraft(ctx,ctx.req.params.estId,'COST_REFERENCE_UPDATE');const line=p.lines.find(l=>l.lineNo===Number(ctx.req.params.lineNo));if(!line)return ctx.fail('NOT_FOUND','산정 기준 행이 없습니다.');const body=ctx.req.body;if((line.sourceRevision ?? 0)!==body.revision)ctx.fail('CONFLICT','다른 담당자가 원천을 변경했습니다.');if(body.selection.refId!==line.refId)ctx.fail('VALIDATION','같은 기준 행의 원천만 변경할 수 있습니다.');await costCaptureReference(ctx,p,line,await costValidateReference(ctx,p,body.selection),body.reason);saveCost(ctx,p);ctx.audit({action:'COST_REFERENCE_UPDATE',target:`${p.estId}#${line.lineNo}`,after:{revision:line.sourceRevision},reason:body.reason,componentId:'D07-01'});return costDetail(ctx,p);},{body:UpdateCostReferenceBody});
registerSimHandler('costLineRemove',async ctx=>{const p=await costDraft(ctx,ctx.req.params.estId,'COST_LINE_REMOVE');const line=p.lines.find(l=>l.lineNo===Number(ctx.req.params.lineNo));if(!line)return ctx.fail('NOT_FOUND','산정 기준 행이 없습니다.');p.lines=p.lines.filter(l=>l.lineNo!==line.lineNo);if(!p.lines.some(l=>l.refId===line.refId))p.mbd=p.mbd.filter(m=>m.refId!==line.refId);saveCost(ctx,p);ctx.audit({action:'COST_LINE_REMOVE',target:`${p.estId}#${line.lineNo}`,before:{refId:line.refId,sourceRevision:line.sourceRevision},componentId:'D07-01'});return costDetail(ctx,p);},{body:EmptyBody});

async function computeCost(ctx: SimReadContext, p: CostProj) {
  const missing=costInputMissing(p.lines,p.doc.settings.directExpenses);if(missing.length)throw new SimError('VALIDATION','미확정 입력을 0으로 계산할 수 없습니다. 수량과 별도 비용의 수량·단가를 확인하세요.',{missing});
  const basis = await basisOf(ctx, p.doc.basisVersion);
  const lines = p.lines.map((l) => ({ refId: l.refId, ...l.inputs, asil: l.inputs.asil ?? l.featureAsil }));
  const facts=await refFacts(ctx,p.lines.map(l=>l.refId),basis);const hashes=new Map<string,string>();
  for(const line of p.lines) if(line.sourceRevision) for(const reference of (p.sourceRevisions?.[String(line.lineNo)] ?? []).find(source=>source.revision===line.sourceRevision)?.snapshot?.relatedReferences ?? []) facts.set(reference.refId,costRefFactsOf(reference,0));
  for(const l of p.lines) if(l.sourceRevision){const source=(p.sourceRevisions?.[String(l.lineNo)] ?? []).find(r=>r.revision===l.sourceRevision);if(!source?.snapshot)throw new CostRuleError('CONFLICT','고정한 원천 스냅샷이 없습니다. 최신 기준을 명시 적용하세요.');if(hashes.has(l.refId) && hashes.get(l.refId)!==source.referenceSha256)throw new CostRuleError('CONFLICT','같은 기준 행의 원천 개정이 다릅니다.');hashes.set(l.refId,source.referenceSha256);facts.set(l.refId,source.snapshot.facts);}
  return estimate({basis,settings:costEngineSettings(p.doc.settings),lines:lines as any,mbd:p.mbd as any,refs:facts as any});
}
const resultOf = async (ctx: SimReadContext, p: CostProj): Promise<any> => (p.status === 'APPROVED' && p.results[String(p.doc.rev)] ? p.results[String(p.doc.rev)] : computeCost(ctx, p));

/** 스냅샷 상세 → 시연 상태(처음 바꿀 때 한 번) */
async function costOf(ctx: SimReadContext, estId: string): Promise<CostProj | null> {
  const mine = ctx.get<CostProj>(COST, estId);
  if (mine) return mine;
  const d = await ctx.snapshot<any>('costProject', { estId });
  if (!d?.project) return null;
  const { status, createdBy, createdAt, updatedAt, latestBasisVersion: _l, latestRefRelease: _r, ...doc } = d.project;
  const { view: _v, ...result } = d.result ?? {};
  const sourceRevisions:Record<string,any[]>={};
  for(const line of d.lines ?? []) for(const revision of line.source?.history ?? []){const source=await ctx.snapshot<any>('costReferenceHistory',{estId,lineNo:String(line.lineNo),revision:String(revision.revision)});if(source)(sourceRevisions[String(line.lineNo)] ??= []).push(source);}
  return {
    estId,
    doc,
    status,
    createdBy,
    createdAt,
    updatedAt,
    lines: (d.lines ?? []).map(({ refStatus: _s, refKnown: _k, ref: _f,source:_source, ...l }: any) => l),
    sourceRevisions,
    mbd: d.mbd ?? [],
    checks: Object.fromEntries((d.checks?.items ?? []).filter((c: any) => c.updatedBy).map((c: any) => [String(c.no), { status: c.status, memo: c.memo, updatedBy: c.updatedBy, updatedAt: c.updatedAt }])),
    actuals: Object.fromEntries((d.actuals ?? []).filter((a: any) => a.override).map((a: any) => [a.refId, a.actual])),
    approvals: d.approvals ?? [],
    results: status === 'APPROVED' && d.result ? { [String(doc.rev)]: result } : {},
  };
}
async function mustCost(ctx: SimWriteContext, estId: string): Promise<CostProj> {
  const p = await costOf(ctx, estId);
  if (!p) return ctx.fail('NOT_FOUND', `산정 과제 ${estId}이(가) 없습니다.`);
  return structuredClone(p);
}
/** DRAFT만 고친다(서버 draft) */
async function costDraft(ctx: SimWriteContext, estId: string, action: string) {
  const p = await mustCost(ctx, estId);
  if (p.status !== 'DRAFT') ctx.fail('IMMUTABLE', `${p.status === 'SUBMITTED' ? '제출된' : '승인된'} 과제는 고칠 수 없습니다 — ${p.status === 'SUBMITTED' ? '반려된 뒤' : '개정한 뒤'} 고칩니다.`, undefined, { action, target: estId, reason: `${p.status} 과제 수정 시도`, componentId: 'D07-01' });
  return p;
}
/** 계수 표 규칙 오류(없는 표·발행 없음) → 서버와 같은 오류 */
async function costRule<T>(ctx: SimWriteContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CostRuleError) return ctx.fail(e.code, e.message);
    throw e;
  }
}
async function checkSettings(ctx: SimWriteContext, basisVersion: string, s: any, currency: string) {
  const b = await costRule(ctx, () => basisOf(ctx, basisVersion));
  const bad: [string, boolean][] = [
    [`AACE 등급 '${s.aace}'`, !b.aace[s.aace]],
    [`신뢰수준 '${s.confidence}'`, b.confidence[s.confidence] === undefined],
    [`대가 산정 방식 '${s.method}'`, !b.methods[s.method]],
    [`프리셋 '${s.preset}'`, s.preset !== '직접 설정' && !b.presets[s.preset]],
    [`통화 '${currency}'`, !b.currencies[currency]],
    ...Object.keys(s.drivers ?? {}).map((d): [string, boolean] => [`드라이버 '${d}'`, !b.cocomo[d]]),
  ];
  const hit = bad.filter(([, x]) => x).map(([w]) => w);
  if (hit.length) ctx.fail('VALIDATION', `계수 표 ${basisVersion}에 없는 값입니다: ${hit.join(', ')}`, { field: 'settings' });
}
const featureRow = async (ctx: SimReadContext, featureId: string, version: string) => (await ctx.read<any>('featureDetail', { id: featureId, ver: version }).catch(() => null))?.feature ?? null;

async function costChecks(ctx: SimReadContext, p: CostProj) {
  const list: any[] = (await basisOf(ctx, p.doc.basisVersion)).checklist ?? [];
  const items = list.map((c) => ({ ...c, status: p.checks[String(c.no)]?.status ?? '미확인', memo: p.checks[String(c.no)]?.memo ?? '', updatedBy: p.checks[String(c.no)]?.updatedBy ?? null, updatedAt: p.checks[String(c.no)]?.updatedAt ?? null }));
  return { items, rate: costCheckRate(items.map((i) => i.status)), open: items.filter((i) => i.status === '보완 필요').length, unchecked: items.filter((i) => i.status === '미확인').length };
}
function costActualRows(p: CostProj) {
  const rows = new Map<string, { refId: string; actual: number; override: boolean }>();
  for (const l of p.lines) if ((l.inputs.actual ?? 0) > 0) rows.set(l.refId, { refId: l.refId, actual: (rows.get(l.refId)?.actual ?? 0) + l.inputs.actual, override: false });
  if (p.status === 'APPROVED') for (const [refId, actual] of Object.entries(p.actuals)) rows.set(refId, { refId, actual, override: true });
  return [...rows.values()].sort((a, b) => (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));
}

/** 상세(서버 fullDetail과 같은 모양) — 금액은 산정 역할만 */
async function costDetail(ctx: SimReadContext, p: CostProj) {
  const role = ctx.actor.role;
  const actuals = costActualRows(p);
  let result: any = null;
  let error: string | null = null;
  try {
    result = costEstimateView(await resultOf(ctx, p), role);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const basis = await basisOf(ctx, p.doc.basisVersion);
  const refs = new Map<string, any>();
  for (const id of new Set(p.lines.map((l) => l.refId))) refs.set(id, await refRow(ctx, id));
  const keys = [...new Map(p.lines.filter(l=>l.featureId && l.version).map((l) => [`${l.featureId}@${l.version}`, l])).values()];
  const features = [];
  for (const l of keys) {
    const f = await featureRow(ctx, l.featureId, l.version);
    features.push({ featureId: l.featureId, version: l.version, name: f?.name ?? null, asil: l.featureAsil, lifecycle: f?.lifecycle ?? null });
  }
  return {
    project: { ...p.doc, settings: costSettingsView(p.doc.settings, role), status: p.status, createdBy: p.createdBy, createdAt: p.createdAt, updatedAt: p.updatedAt, latestBasisVersion: (await basisList(ctx)).latest, latestRefRelease: await latestRefRelease(ctx) },
    lines: await Promise.all(p.lines.map(async (l) => {
      const source=l.sourceRevision?await costSourceView(ctx,p,l.lineNo,l.sourceRevision):null;
      const r = source?.reference ?? refs.get(l.refId);
      return { ...l,source, refStatus: r?.status ?? null, refKnown: !!r, ref: r ? { nameKo: r.nameKo, component: r.component, tshirt: r.tshirt, asilRep: r.asilRep } : null };
    })),
    features,
    options: {
      aace: Object.keys(basis.aace),
      confidence: Object.keys(basis.confidence),
      presets: Object.keys(basis.presets),
      methods: Object.keys(basis.methods),
      rateBases: [...RATE_BASES],
      drivers: Object.entries(basis.cocomo as Record<string, any>).map(([key, d]) => ({ key, label: d.label, ratings: (['VL', 'L', 'N', 'H', 'VH', 'XH'] as const).filter((r) => d[r] != null) })),
      changeTypes: basis.reuse.map((r: any) => r.changeType),
      asil: Object.keys(basis.asil),
      currencies: Object.keys(basis.currencies),
      directExpenseItems: basis.directExpenseItems,
    },
    ...(canSeeCost(role) ? { fx: basis.currencies[p.doc.currency] ?? null } : {}),
    mbd: p.mbd,
    checks: await costChecks(ctx, p),
    actuals,
    mre: result ? costMre(result.lines, new Map(actuals.map((r) => [r.refId, r.actual]))) : null,
    result,
    error,
    approvals: p.approvals,
    view: canSeeCost(role) ? ('FULL' as const) : ('MM_ONLY' as const),
  };
}
async function costListRow(ctx: SimReadContext, p: CostProj, latest: string | null) {
  let totals: { totalMm: number; totalCost?: number } | null = null;
  try {
    const r = await resultOf(ctx, p);
    totals = canSeeCost(ctx.actor.role) ? { totalMm: r.totals.totalMm, totalCost: r.totals.totalCost } : { totalMm: r.totals.totalMm };
  } catch {
    // 계산 실패는 목록에서 비워 두고 상세에서 이유를 보인다(서버와 같음)
    totals = null;
  }
  const sets = { countries: new Set<string>(), vehicleModels: new Set<string>(), asils: new Set<string>(), tshirts: new Set<string>(), domains: new Set<string>(), components: new Set<string>() };
  for (const l of p.lines) {
    const f = await featureRow(ctx, l.featureId, l.version);
    const r = await refRow(ctx, l.refId);
    if (f?.country) sets.countries.add(f.country);
    if (f?.vehicleModel) sets.vehicleModels.add(f.vehicleModel);
    const asil = l.inputs.asil ?? l.featureAsil;
    if (asil) sets.asils.add(asil);
    if (r?.tshirt) sets.tshirts.add(r.tshirt);
    if (r?.domain) sets.domains.add(r.domain);
    if (r?.domain && r.component) sets.components.add(`${r.domain}\t${r.component}`);
  }
  return {
    estId: p.estId,
    name: p.doc.name,
    target: p.doc.target,
    status: p.status,
    currency: p.doc.currency,
    basisVersion: p.doc.basisVersion,
    basisStale: p.doc.basisVersion !== latest,
    featureCount: new Set(p.lines.filter(l=>l.featureId && l.version).map((l) => `${l.featureId}@${l.version}`)).size,
    referenceCount:new Set(p.lines.map(l=>l.refId)).size,
    totals,
    scope: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].sort()])),
    createdBy: p.createdBy,
    updatedAt: p.updatedAt,
  };
}

registerSimReader('costProjects', async (ctx) => {
  if (!touched(ctx, COST) && !touched(ctx, COST_BASIS)) return undefined;
  const base = (await ctx.snapshot<{ items: any[]; view: string }>()) ?? { items: [], view: canSeeCost(ctx.actor.role) ? 'FULL' : 'MM_ONLY' };
  const latest = (await basisList(ctx)).latest;
  const mine = ctx.list<CostProj>(COST);
  const rows = new Map<string, any>();
  for (const p of mine) rows.set(p.estId, await costListRow(ctx, p, latest));
  const items = base.items.map((it) => rows.get(it.estId) ?? { ...it, basisStale: it.basisVersion !== latest });
  const fresh = mine.filter((p) => !base.items.some((it) => it.estId === p.estId)).map((p) => rows.get(p.estId));
  return { ...base, items: [...fresh, ...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.estId).localeCompare(String(a.estId))) };
});
registerSimReader('costProject', async (ctx) => {
  const p = ctx.get<CostProj>(COST, ctx.req.params.estId);
  return p ? costDetail(ctx, p) : undefined;
});
registerSimReader('costBasisList', async (ctx) => (touched(ctx, COST_BASIS) ? basisList(ctx) : undefined));
registerSimReader('costBasis', async (ctx) => {
  const b = ctx.get<any>(COST_BASIS, ctx.req.params.version);
  return b ? { version: b.version, status: b.status, note: b.note, publishedAt: b.publishedAt, basis: b.basis } : undefined;
});

/** 쓰기 공통 — 바꾼 과제를 넣는다(서버는 쓰기마다 updated_at) */
function saveCost(ctx: SimWriteContext, p: CostProj, touch = true) {
  if (touch) p.updatedAt = ctx.iso();
  ctx.put(COST, p.estId, p);
}

registerSimHandler(
  'costProjectCreate',
  async (ctx) => {
    const body = ctx.req.body;
    const basisVersion = await costRule(ctx, () => latestBasis(ctx));
    const basis = await costRule(ctx, () => basisOf(ctx, basisVersion));
    const settings = { ...body.settings, drivers: { ...Object.fromEntries(Object.keys(basis.cocomo).map((d) => [d, 'N'])), ...body.settings.drivers } };
    await checkSettings(ctx, basisVersion, settings, body.currency);
    const at = ctx.iso();
    const known = ((await ctx.snapshot<{ items: { estId: string }[] }>('costProjects'))?.items ?? []).map((x) => x.estId).concat(ctx.list<CostProj>(COST).map((p) => p.estId));
    const estId = ctx.nextId('EST', known, 4);
    const doc = { estId, name: body.name, target: body.target, currency: body.currency, settings, basisVersion, refRelease: await latestRefRelease(ctx), rev: 0, lastReason: null };
    const p: CostProj = { estId, doc, status: 'DRAFT', createdBy: ctx.actor.id, createdAt: at, updatedAt: at, lines: [], mbd: [], checks: {}, actuals: {}, approvals: [], results: {} };
    for(const selection of body.references ?? []) await costAppendReference(ctx,p,selection,'Feature DB 기준으로 산정 시작');
    ctx.put(COST, estId, p, { created: true });
    ctx.audit({ action: 'COST_PROJECT_CREATE', target: estId, after: { name: doc.name, basisVersion, refRelease: doc.refRelease }, componentId: 'D07-01' });
    return { ...doc, status: 'DRAFT' as const };
  },
  { body: CreateCostProjectBody },
);

registerSimHandler(
  'costProjectUpdate',
  async (ctx) => {
    const { estId } = ctx.req.params;
    const body = ctx.req.body;
    const p = await costDraft(ctx, estId, 'COST_PROJECT_UPDATE');
    const before = p.doc.basisVersion;
    p.doc = {
      ...p.doc,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.target !== undefined ? { target: body.target } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.settings ? { settings: { ...body.settings, drivers: { ...p.doc.settings.drivers, ...body.settings.drivers } } } : {}),
      ...(body.useLatestBasis ? { basisVersion: await costRule(ctx, () => latestBasis(ctx)), refRelease: await latestRefRelease(ctx) } : {}),
    };
    await checkSettings(ctx, p.doc.basisVersion, p.doc.settings, p.doc.currency);
    if(body.useLatestBasis) for(const line of p.lines) {
      const preview=await costReferencePreview(ctx,line.refId,p.doc.basisVersion);
      const f=line.featureId?preview.features.find((f:any)=>f.featureId===line.featureId && f.version===line.version):null;
      if(line.featureId && !f)ctx.fail('CONFLICT','기존 Feature가 기준 행을 더 이상 참조하지 않습니다.');
      const selection={refId:line.refId,refRelease:preview.refRelease,referenceSha256:preview.referenceSha256,feature:f?{featureId:f.featureId,version:f.version,sha256:f.sha256}:null};
      await costCaptureReference(ctx,p,line,await costValidateReference(ctx,p,selection),'최신 산정 기준 명시 적용');
    }
    saveCost(ctx, p);
    ctx.audit({ action: 'COST_PROJECT_UPDATE', target: estId, before: { basisVersion: before }, after: { basisVersion: p.doc.basisVersion, changed: Object.keys(body) }, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: UpdateCostProjectBody },
);

registerSimHandler(
  'costFeatureAdd',
  async (ctx) => {
    const { estId } = ctx.req.params;
    const { featureId, version } = ctx.req.body as { featureId: string; version: string };
    const p = await costDraft(ctx, estId, 'COST_FEATURE_ADD');
    const f = await featureRow(ctx, featureId, version);
    if (!f) return ctx.fail('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const links: { refId: string; role: 'PRIMARY' | 'INCLUDED' }[] = f.featureRefs ?? [];
    if (!links.length) ctx.fail('VALIDATION', `${featureId} ${version}에 Feature DB 연결이 없습니다 — Feature에 기준 행을 먼저 연결하세요.`, { field: 'featureId' });
    if (p.lines.some((l) => l.featureId === featureId && l.version === version)) ctx.fail('CONFLICT', `${featureId} ${version}은(는) 이미 담겨 있습니다.`);
    const blocked: string[] = [];
    for (const l of links) {
      const r = await refRow(ctx, l.refId);
      if (!r || !refStatusPolicy(r.status).costUsable) blocked.push(l.refId);
    }
    if (blocked.length) ctx.fail('VALIDATION', `산정에 쓸 수 없는 기준 행이 있습니다(요청 중·폐기): ${blocked.join(', ')}`, { field: 'featureId', refs: blocked });
    let no = costNextLine(p)-1;
    // 대표 먼저, 그다음 포함 — 화면에서 Feature 아래 대표 줄이 위에 온다
    for(const link of [...links].sort((a,b)=>a.role===b.role?0:a.role==='PRIMARY'?-1:1)){const preview=await costReferencePreview(ctx,link.refId,p.doc.basisVersion);const value=await costValidateReference(ctx,p,{refId:link.refId,refRelease:preview.refRelease,referenceSha256:preview.referenceSha256,feature:{featureId:f.featureId,version:f.version,sha256:await sha256(canonicalCostSource(costFeatureSourceOf(f)))}});const line:CostLine={lineNo:++no,featureId:f.featureId,version:f.version,refId:link.refId,role:link.role,featureAsil:f.asil,inputs:{qty:1}};await costCaptureReference(ctx,p,line,value,'등록 Feature의 기준 행 연결');p.lines.push(line);}
    saveCost(ctx, p);
    ctx.audit({ action: 'COST_FEATURE_ADD', target: estId, after: { featureId: f.featureId, version: f.version, refs: links.map((l) => l.refId) }, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: AddCostFeatureBody },
);

registerSimHandler(
  'costFeatureRemove',
  async (ctx) => {
    const { estId, featureId, version } = ctx.req.params;
    const p = await costDraft(ctx, estId, 'COST_FEATURE_REMOVE');
    const refIds = p.lines.filter((l) => l.featureId === featureId && l.version === version).map((l) => l.refId);
    if (!refIds.length) return ctx.fail('NOT_FOUND', `${featureId} ${version}은(는) 이 과제에 없습니다.`);
    p.lines = p.lines.filter((l) => !(l.featureId === featureId && l.version === version));
    // 다른 Feature가 쓰지 않는 기준 행의 MBD 작업도 지운다
    p.mbd = p.mbd.filter((m) => !refIds.includes(m.refId) || p.lines.some((l) => l.refId === m.refId));
    saveCost(ctx, p);
    ctx.audit({ action: 'COST_FEATURE_REMOVE', target: estId, before: { featureId, version, refs: refIds }, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: EmptyBody },
);

registerSimHandler(
  'costLineUpdate',
  async (ctx) => {
    const { estId } = ctx.req.params;
    const lineNo = Number(ctx.req.params.lineNo);
    const body = ctx.req.body;
    const p = await costDraft(ctx, estId, 'COST_LINE_UPDATE');
    const line = p.lines.find((l) => l.lineNo === lineNo);
    if (!line) return ctx.fail('NOT_FOUND', `${estId}에 ${lineNo}번 줄이 없습니다.`);
    if (body.changeType && !(await basisOf(ctx, p.doc.basisVersion)).reuse.some((x: any) => x.changeType === body.changeType)) ctx.fail('VALIDATION', `계수 표 ${p.doc.basisVersion}에 변경 유형 '${body.changeType}'이 없습니다.`, { field: 'changeType' });
    const before = line.inputs;
    line.inputs = { ...line.inputs, ...body };
    saveCost(ctx, p);
    ctx.audit({ action: 'COST_LINE_UPDATE', target: `${estId}#${lineNo}`, before, after: line.inputs, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: UpdateCostLineBody },
);

registerSimHandler(
  'costMbdPut',
  async (ctx) => {
    const { estId, refId } = ctx.req.params;
    const p = await costDraft(ctx, estId, 'COST_MBD_PUT');
    if (!p.lines.some((l) => l.refId === refId)) return ctx.fail('NOT_FOUND', `${refId}은(는) 이 과제의 줄이 아닙니다.`);
    const items = ctx.req.body.items as { counts: (number | null)[] }[];
    p.mbd = [...p.mbd.filter((m) => m.refId !== refId), ...items.map((it, i) => ({ refId, seq: i + 1, counts: it.counts }))].sort((a, b) => a.refId.localeCompare(b.refId) || a.seq - b.seq);
    saveCost(ctx, p);
    ctx.audit({ action: 'COST_MBD_PUT', target: `${estId}:${refId}`, after: { items: items.length }, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: PutCostMbdBody },
);

registerSimHandler(
  'costTransition',
  async (ctx) => {
    const { estId } = ctx.req.params;
    const body = ctx.req.body as { action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REVISE'; reason: string };
    const p = await mustCost(ctx, estId);
    const rule = COST_TRANSITIONS.find((t) => t.action === body.action && t.from === p.status);
    const action = `COST_PROJECT_${body.action}`;
    const fail = (code: string, message: string): never => ctx.fail(code, message, undefined, { action, target: estId, reason: message, componentId: 'D07-01' });
    if (!rule) return fail('CONFLICT', `${p.status} 과제에는 '${body.action}'을(를) 할 수 없습니다.`);
    if (!(rule.roles as readonly string[]).includes(ctx.actor.role)) fail('FORBIDDEN', `${body.action}은(는) ${rule.roles.join('·')} 역할만 할 수 있습니다.`);
    if (body.action === 'APPROVE' || body.action === 'REJECT') {
      const why = costApprovalDutyBlocker({ createdBy: p.createdBy }, ctx.actor.id);
      if (why) fail('SEPARATION_OF_DUTY', why);
    }
    let result: any = null;
    if (body.action === 'SUBMIT' || body.action === 'APPROVE') {
      if(!p.lines.length)fail('GUARD_FAILED','산정 기준 행이 없습니다.');
      for(const line of p.lines){if(!line.sourceRevision)fail('GUARD_FAILED','원천 기록이 없는 이전 산정 줄입니다. 최신 기준을 명시 적용하세요.');if((await costSourceView(ctx,p,line.lineNo,line.sourceRevision!)).stale)fail('GUARD_FAILED','선택한 산정 원천이 변경됐습니다. 최신 기준을 확인하세요.');}
      const blocked: string[] = [];
      for (const l of p.lines) {
        const r = await refRow(ctx, l.refId);
        if (!r || !refStatusPolicy(r.status).costUsable) blocked.push(l.refId);
      }
      if (blocked.length) fail('GUARD_FAILED', `산정에 쓸 수 없게 된 기준 행이 있습니다: ${[...new Set(blocked)].join(', ')}`);
      try {
        result = await computeCost(ctx, p);
      } catch (e) {
        fail('GUARD_FAILED', `계산할 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const at = ctx.iso();
    p.doc = { ...p.doc, lastReason: body.reason };
    if (body.action === 'REVISE') {
      // 승인 후 실적은 개정할 때 한 번만 첫 줄로 옮긴다(서버 foldActuals)
      for (const [refId, actual] of Object.entries(p.actuals)) p.lines.filter((l) => l.refId === refId).forEach((l, i) => (l.inputs = { ...l.inputs, actual: i === 0 ? actual : null }));
      p.actuals = {};
    }
    if (body.action === 'APPROVE') {
      const rev = p.doc.rev + 1;
      p.results[String(rev)] = result;
      p.approvals = [...p.approvals, { rev, approvedBy: ctx.actor.id, approvedAt: at, reason: body.reason, basisVersion: p.doc.basisVersion, resultSha256: await sha256(JSON.stringify(result)),sources:p.lines.map(l=>({lineNo:l.lineNo,revision:l.sourceRevision!})) }];
      p.doc = { ...p.doc, rev };
    }
    const from = p.status;
    p.status = rule.to;
    p.updatedAt = at;
    saveCost(ctx, p, false);
    ctx.audit({ action, target: estId, before: { status: from }, after: { status: rule.to, rev: p.doc.rev }, reason: body.reason, componentId: 'D07-01' });
    return { estId, status: rule.to, rev: p.doc.rev };
  },
  { body: CostTransitionBody },
);

registerSimHandler(
  'costCheckPut',
  async (ctx) => {
    const { estId } = ctx.req.params;
    const no = Number(ctx.req.params.no);
    const body = ctx.req.body as { status: string; memo: string };
    const p = await mustCost(ctx, estId);
    if (p.status === 'APPROVED') ctx.fail('CONFLICT', `${estId}은(는) 승인된 과제라 검토 상태를 바꿀 수 없습니다 — 개정한 뒤 바꿉니다.`);
    if (!((await basisOf(ctx, p.doc.basisVersion)).checklist ?? []).some((c: any) => c.no === no)) ctx.fail('NOT_FOUND', `검토 항목 ${no}번이 계수 표 ${p.doc.basisVersion}에 없습니다.`);
    const before = p.checks[String(no)] ?? null;
    p.checks[String(no)] = { status: body.status, memo: body.memo, updatedBy: ctx.actor.id, updatedAt: ctx.iso() };
    saveCost(ctx, p, false);
    ctx.audit({ action: 'COST_CHECK_PUT', target: `${estId}:${no}`, before: before && { status: before.status }, after: { status: body.status }, componentId: 'D07-01' });
    return costChecks(ctx, p);
  },
  { body: PutCostCheckBody },
);

registerSimHandler(
  'costActualPut',
  async (ctx) => {
    const { estId, refId } = ctx.req.params;
    if (ctx.actor.role !== 'COST_ESTIMATOR') ctx.fail('FORBIDDEN', '실적 공수는 산정 작성 역할만 기록할 수 있습니다.');
    const body = ctx.req.body as { actual: number | null };
    const p = await mustCost(ctx, estId);
    if (p.status !== 'APPROVED') ctx.fail('CONFLICT', '승인된 과제에만 후속 실적을 기록합니다. 작성 중에는 줄 입력을 사용하세요.');
    if (!p.lines.some((l) => l.refId === refId)) ctx.fail('NOT_FOUND', '이 과제에 해당 기준 행이 없습니다.');
    const before = p.actuals[refId] ?? null;
    if (body.actual === null) delete p.actuals[refId];
    else p.actuals[refId] = body.actual;
    saveCost(ctx, p, false);
    ctx.audit({ action: 'COST_ACTUAL_PUT', target: `${estId}:${refId}`, before: { actual: before }, after: { actual: body.actual }, componentId: 'D07-01' });
    return costDetail(ctx, p);
  },
  { body: PutCostActualBody },
);

registerSimHandler(
  'costBasisDraft',
  async (ctx) => {
    const body = ctx.req.body as { basis: unknown; note: string };
    const parsed = CostBasis.safeParse(body.basis);
    if (!parsed.success) return ctx.fail('VALIDATION', `계수 표 형식이 맞지 않습니다: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`, { field: 'basis' });
    const basis = parsed.data;
    if (!(basis.benchmark.anchorEur > 0)) ctx.fail('VALIDATION', '포인트당 벤치마크는 양수여야 합니다.', { field: 'basis' });
    if ((await basisList(ctx)).items.some((b) => b.version === basis.version)) ctx.fail('CONFLICT', `계수 표 ${basis.version}이(가) 이미 있습니다 — 새 버전 이름을 쓰세요.`, { field: 'basis' });
    const contentSha256 = await sha256(JSON.stringify(basis));
    ctx.put(COST_BASIS, basis.version, { version: basis.version, status: 'DRAFT', note: body.note, createdBy: ctx.actor.id, createdAt: ctx.iso(), publishedBy: null, publishedAt: null, contentSha256, basis }, { created: true });
    ctx.audit({ action: 'COST_BASIS_DRAFT', target: `basis:${basis.version}`, after: { version: basis.version, contentSha256 }, reason: body.note, componentId: 'D07-01' });
    return { version: basis.version, status: 'DRAFT' as const };
  },
  { body: CostBasisDraftBody },
);

registerSimHandler(
  'costBasisPublish',
  async (ctx) => {
    const { version } = ctx.req.params;
    const b = ctx.get<any>(COST_BASIS, version) ?? (await basisList(ctx)).items.find((x) => x.version === version);
    if (!b) return ctx.fail('NOT_FOUND', `계수 표 ${version}이(가) 없습니다.`);
    if (b.status === 'PUBLISHED') ctx.fail('CONFLICT', `계수 표 ${version}은(는) 이미 발행됐습니다.`);
    const at = ctx.iso();
    ctx.put(COST_BASIS, version, { ...b, status: 'PUBLISHED', publishedBy: ctx.actor.id, publishedAt: at });
    ctx.audit({ action: 'COST_BASIS_PUBLISH', target: `basis:${version}`, before: { status: 'DRAFT' }, after: { status: 'PUBLISHED' }, reason: ctx.req.body.reason, componentId: 'D07-01' });
    return { version, status: 'PUBLISHED' as const, publishedAt: at };
  },
  { body: z.object({ reason: z.string().trim().min(2).max(500) }).strict() },
);

// ═══ KERNEL 개인정보 — 내보내기·삭제 요청·실행(4안 원칙)·거절 ═══════════
// 저장소별 행은 이 브라우저가 가진 기록(감사·이벤트·차량·권한·회신·접근 요청)에서 센다 — 서버 DB 전체를 훑지 않는다(설계 20-60 §한계).
const PRV = 'privacyRequest';
type PrivacyView = Record<string, any> & { requestId: string; status: string; requestedBy: string; subjectKind: 'USER' | 'VEHICLE'; subjectId: string | null; pseudonym: string };

/** 가명 — 같은 대상은 같은 가명(서버 privacy_subject 대응표), 이 브라우저의 시연 비밀로 결정적 */
async function pseudonymFor(ctx: SimWriteContext, kind: string, id: string): Promise<string> {
  const map = ctx.state<Record<string, string>>('privacySubject', () => ({}));
  return (map[`${kind}:${id}`] ??= `psn-${(await sha256(`ff-sim-privacy\n${kind}\n${id}`)).slice(0, 16)}`);
}
async function subjectRows(ctx: SimReadContext, kind: 'USER' | 'VEHICLE', id: string): Promise<Record<string, Record<string, unknown>[]>> {
  const mention = (v: unknown) => mentionsIdentifier(typeof v === 'string' ? v : JSON.stringify(v ?? null), [id]);
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const s of personalStores(kind)) out[s.store] = [];
  if (kind === 'USER') {
    const audit = (await ctx.read<{ items: any[] }>('audit', {}, { limit: 500 }).catch(() => ({ items: [] }))).items ?? [];
    out.audit = audit.filter((a) => a.actorId === id || a.target === id || mention(a.reason) || mention(a.before) || mention(a.after));
    const events = (await ctx.read<{ items: any[] }>('events', {}, { limit: 500, recent: '1' }).catch(() => ({ items: [] }))).items ?? [];
    if (out.events) out.events = events.filter((e) => mention(e.payload));
    if (out.product) out.product = (ctx.list<ProductEntity>(PROD) ?? []).filter((p) => p._meta && Object.values(p._meta).includes(id)).map((p) => strip(p));
    return out;
  }
  const vehicles = (await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? [];
  if (out.vehicle) out.vehicle = vehicles.filter((v) => v.vin === id);
  const grants = (await ctx.read<{ items: any[] }>('entitlements').catch(() => ({ items: [] }))).items ?? [];
  if (out.entitlement) out.entitlement = grants.filter((g) => g.vin === id);
  const readbacks = (await ctx.read<{ items: any[] }>('readbacks').catch(() => ({ items: [] }))).items ?? [];
  if (out.readback) out.readback = readbacks.filter((r) => r.vin === id);
  const dar = (await ctx.read<{ requests: any[] }>('dataAccessRequests').catch(() => ({ requests: [] }))).requests ?? [];
  if (out.data_access_request) out.data_access_request = dar.filter((r) => r.vin === id);
  const status = await ctx.read<any>('vehicleStatusView', { vin: id }).catch(() => null);
  if (out.status_report && status) out.status_report = status.recent ?? [];
  return out;
}

registerSimReader('privacyRequests', async (ctx) => {
  if (!touched(ctx, PRV)) return undefined;
  const base = (await ctx.snapshot<{ items: PrivacyView[] }>()) ?? { items: [] };
  return { ...base, items: overlayList(ctx, PRV, base.items, (r) => r.requestId).sort((a, b) => b.requestId.localeCompare(a.requestId)) };
});
async function privacyRequestOf(ctx: SimReadContext, id: string): Promise<PrivacyView | null> {
  return ctx.get<PrivacyView>(PRV, id) ?? ((await ctx.snapshot<{ items: PrivacyView[] }>('privacyRequests'))?.items ?? []).find((r) => r.requestId === id) ?? null;
}

registerSimHandler(
  'privacyExport',
  async (ctx) => {
    const body = ctx.req.body as { subjectKind: 'USER' | 'VEHICLE'; subjectId: string; reason: string };
    const rows = await subjectRows(ctx, body.subjectKind, body.subjectId);
    const sections = personalStores(body.subjectKind).map((s) => ({ store: s.store, category: s.category, treatment: s.treatment, retention: s.retention, basis: s.basis, rows: rows[s.store] ?? [] }));
    const counts = Object.fromEntries(sections.map((s) => [s.store, s.rows.length]));
    const pseudonym = await pseudonymFor(ctx, body.subjectKind, body.subjectId);
    ctx.audit({ action: 'PRIVACY_EXPORT', target: pseudonym, after: { subjectKind: body.subjectKind, counts }, reason: body.reason, componentId: 'KERNEL' });
    return { schema: 'ff.privacy.export/v1', instance: null, generatedAt: ctx.iso(), subject: { kind: body.subjectKind, id: body.subjectId, pseudonym }, sections, counts };
  },
  { body: PrivacyExportBody },
);

registerSimHandler(
  'createPrivacyRequest',
  async (ctx) => {
    const body = ctx.req.body as { subjectKind: 'USER' | 'VEHICLE'; subjectId: string; basis: string; reason: string };
    if (body.subjectKind === 'USER' && isPseudonym(body.subjectId)) ctx.fail('VALIDATION', '이미 가명 처리된 식별자입니다.');
    if (body.subjectKind === 'VEHICLE' && body.basis === 'EMPLOYMENT_END') ctx.fail('VALIDATION', '퇴직(EMPLOYMENT_END)은 사용자 요청에만 쓰는 근거입니다.');
    if (body.subjectKind === 'USER' && body.subjectId === ctx.actor.id) ctx.fail('SEPARATION_OF_DUTY', '자기 자신의 삭제 요청은 다른 담당자가 내야 합니다.');
    const all = (await ctx.read<{ items: PrivacyView[] }>('privacyRequests').catch(() => ({ items: [] }))).items ?? [];
    if (all.some((r) => r.status === 'REQUESTED' && r.subjectKind === body.subjectKind && r.subjectId === body.subjectId)) ctx.fail('CONFLICT', '같은 대상의 처리 대기 요청이 이미 있습니다.');
    const rows = await subjectRows(ctx, body.subjectKind, body.subjectId);
    const preview = Object.fromEntries(personalStores(body.subjectKind).map((s) => [s.store, (rows[s.store] ?? []).length]));
    const pseudonym = await pseudonymFor(ctx, body.subjectKind, body.subjectId);
    const view: PrivacyView = {
      requestId: ctx.nextId('PRV', all.map((r) => r.requestId)),
      subjectKind: body.subjectKind,
      subjectId: body.subjectId,
      pseudonym,
      basis: body.basis,
      reason: body.reason,
      status: 'REQUESTED',
      requestedBy: ctx.actor.id,
      requestedAt: ctx.iso(),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      preview,
      result: null,
    };
    ctx.put(PRV, view.requestId, view, { created: true });
    // 감사에는 식별자 대신 가명만 — 요청 기록이 다시 개인정보를 남기지 않게
    ctx.audit({ action: 'PRIVACY_REQUEST', target: view.requestId, after: { subjectKind: view.subjectKind, pseudonym, basis: view.basis, preview }, reason: body.reason, componentId: 'KERNEL' });
    return view;
  },
  { body: ErasureRequestBody },
);

async function privacyDecide(ctx: SimWriteContext, id: string, action: string): Promise<PrivacyView> {
  const view = await privacyRequestOf(ctx, id);
  if (!view) return ctx.fail('NOT_FOUND', `${id} 요청을 찾을 수 없습니다.`);
  if (view.status !== 'REQUESTED') ctx.fail('CONFLICT', `${id}은(는) 이미 처리됐습니다(${view.status}).`);
  if (view.requestedBy === ctx.actor.id) {
    // 서버 audit.denied — 거부도 감사에 남는다
    ctx.fail('SEPARATION_OF_DUTY', '요청자와 다른 보안 담당자가 처리해야 합니다.', undefined, { action, target: id, reason: '요청자와 다른 보안 담당자가 처리해야 합니다(4안 원칙)', componentId: 'KERNEL' });
  }
  return view;
}

registerSimHandler(
  'executePrivacyRequest',
  async (ctx) => {
    const id = ctx.req.params.id;
    const view = await privacyDecide(ctx, id, 'PRIVACY_ERASE');
    const kind = view.subjectKind;
    const counts: Record<string, number> = view.preview ?? {};
    const result = { deleted: {} as Record<string, number>, pseudonymised: {} as Record<string, number>, retained: {} as Record<string, number>, auditRows: 0, lake: { status: 'NOT_APPLICABLE', lakeRequestId: null as string | null, detail: null as string | null } };
    for (const s of personalStores(kind)) {
      if (s.store === 'audit') continue;
      const n = counts[s.store] ?? 0;
      if (s.treatment === 'RETAIN_LEGAL') result.retained[s.store] = n;
      else if (s.treatment === 'DELETE') result.deleted[s.store] = n;
      else result.pseudonymised[s.store] = n;
    }
    // 감사 이력 — 지우지 않고 식별자만 가명(사용자만). 차량 기록은 법정 보존이라 감사의 VIN도 그대로
    if (kind === 'USER') {
      result.auditRows = counts.audit ?? 0;
      result.pseudonymised.audit = result.auditRows;
    }
    // Data Lake 삭제 요청 — 이 설치는 Data Lake 연결이 없다(lakeErasureConfig 없음)
    if (kind === 'VEHICLE') result.lake = { status: 'NOT_CONNECTED', lakeRequestId: null, detail: 'Data Lake 삭제 연결이 설정되지 않았습니다' };
    const next: PrivacyView = { ...view, subjectId: null, status: 'DONE', decidedBy: ctx.actor.id, decidedAt: ctx.iso(), result };
    ctx.put(PRV, id, next);
    ctx.audit({ action: 'PRIVACY_ERASE', target: id, after: { pseudonym: view.pseudonym, subjectKind: kind, deleted: result.deleted, pseudonymised: result.pseudonymised, retained: result.retained }, componentId: 'KERNEL' });
    if (kind === 'VEHICLE') ctx.audit({ action: 'PRIVACY_LAKE_ERASURE', target: id, after: { pseudonym: view.pseudonym, lake: result.lake }, componentId: 'KERNEL' });
    return next;
  },
  { body: ErasureExecuteBody },
);

registerSimHandler(
  'rejectPrivacyRequest',
  async (ctx) => {
    const id = ctx.req.params.id;
    const reason = ctx.req.body.reason as string;
    const view = await privacyDecide(ctx, id, 'PRIVACY_REJECT');
    const next: PrivacyView = { ...view, subjectId: null, status: 'REJECTED', decidedBy: ctx.actor.id, decidedAt: ctx.iso(), decisionReason: reason };
    ctx.put(PRV, id, next);
    ctx.audit({ action: 'PRIVACY_REJECT', target: id, after: { pseudonym: view.pseudonym }, reason, componentId: 'KERNEL' });
    return next;
  },
  { body: ErasureRejectBody },
);

// ═══ D05-01 외부 연계 — 충돌 처리·CR 연결 ═══════════════════════
const CONFLICT = 'extConflict';
const CR_OF_POLICY: Record<string, keyof typeof JIRA_CR_STATUS> = { DRAFT: 'OPEN', VALIDATED: 'IN_REVIEW', APPROVED: 'APPROVED', DEPLOYED: 'DEPLOYED', REJECTED: 'REJECTED', RETIRED: 'CLOSED' };
const crOfPolicy = (status: string): string | undefined => (CR_OF_POLICY[status] ? JIRA_CR_STATUS[CR_OF_POLICY[status]] : undefined);

registerSimReader('extConflicts', async (ctx) => {
  if (!touched(ctx, CONFLICT)) return undefined;
  const status = ctx.req.query.status;
  const open = (await ctx.snapshot<{ items: any[] }>('extConflicts', {}, { status: 'OPEN' }))?.items ?? [];
  const base = {items:open};
  return { ...base, items: overlayList(ctx, CONFLICT, base.items ?? [], (c: any) => String(c.conflictId), (c) => !status || c.status === status) };
});
registerSimReader('extSync', async (ctx) => {
  const done = ctx.list<any>(CONFLICT).filter((c) => c.status === 'RESOLVED');
  const local=ctx.list<any>('localAlmOutbox'),conflicts=ctx.list<any>(CONFLICT).filter(c=>c.localOnly&&c.status==='OPEN');
  if (!done.length&&!local.length&&!conflicts.length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  return { ...base, items: base.items.map((s: any) => ({ ...s, conflicts: Math.max(0, s.conflicts - done.filter((c) => !c.localOnly&&c.system === s.system).length)+conflicts.filter(c=>c.system===s.system).length,pending:s.pending+local.filter(j=>j.system===s.system&&j.status==='PENDING').length,failed:s.failed+local.filter(j=>j.system===s.system&&j.status==='FAILED').length,localReplay:{pending:local.filter(j=>j.system===s.system&&j.status==='PENDING').length,done:local.filter(j=>j.system===s.system&&j.status==='DONE').length,remoteWrites:0},capturedSummary:s,localOnly:true })) };
});

registerSimHandler(
  'resolveExtConflict',
  async (ctx) => {
    const id = ctx.req.params.id;
    const { choose, reason } = ctx.req.body as { choose: 'PLATFORM' | 'EXTERNAL'; reason: string };
    const c = ctx.get<any>(CONFLICT, id) ?? ((await ctx.snapshot<{ items: any[] }>('extConflicts', {}, { status: 'OPEN' }))?.items ?? []).find((x) => String(x.conflictId) === id);
    if (!c) return ctx.fail('NOT_FOUND', `충돌 ${id}을(를) 찾을 수 없습니다.`);
    if (c.status !== 'OPEN') ctx.fail('CONFLICT', `충돌 ${id}은(는) 이미 처리되었습니다.`);
    let result: { outcome: string; summary: string };
    if (choose === 'PLATFORM') result = { outcome: 'APPLIED', summary: `플랫폼 값 '${c.platformValue}'을(를) 다시 보냄` };
    else if (c.system === 'JIRA' && c.field === 'status') {
      // 외부 값을 이 사람의 요청으로 다시 시도 — Epic 상태는 Lifecycle 전이 요청(주인은 플랫폼). 허용되지 않으면 Epic을 되돌린다(서버 onEpic)
      const epic = ((await ctx.read<{ items: any[] }>('extFeatureEpics').catch(() => ({ items: [] }))).items ?? []).find((e) => e.key === c.key || e.epicKey === c.key);
      // 목록 행은 feature = 'FEAT-…@x.y.z'(서버 featureEpics)
      const [featureId, version] = String(epic?.feature ?? '').split('@');
      const f = featureId && version ? await featureRow(ctx, featureId, version) : null;
      const to = lifecycleOfEpicStatus(c.externalValue);
      const revert = (why: string) => ({ outcome: 'REJECTED', summary: `${c.key} '${c.externalValue}' 거부 — ${why}` });
      if (!f) result = { outcome: 'IGNORED', summary: `${c.key} 연결 Feature 없음` };
      else if (!to) result = revert(`'${c.externalValue}'은(는) 플랫폼 Lifecycle 상태가 아닙니다.`);
      else {
        const rule = FEATURE_TRANSITIONS.find((r) => r.from === f.lifecycle && r.to === to);
        if (!rule) result = revert(`${f.lifecycle} → ${to}는 허용된 전이가 아닙니다.`);
        else {
          // 이 사람의 요청으로 Lifecycle 전이(게이트·직무 분리 판정은 Feature 전이와 같은 핸들러) — 같은 반영 안에서
          try {
            await simInvoke(ctx, 'transition', { params: { id: featureId, ver: version }, body: { to, reason: `JIRA ${c.key}: ${c.platformValue} → ${c.externalValue} (${ctx.actor.id})` }, actor: ctx.actor });
            result = { outcome: 'APPLIED', summary: `${featureId}@${version} ${f.lifecycle} → ${to} (JIRA ${c.key})` };
          } catch (e) {
            result = revert(e instanceof Error ? e.message : String(e));
          }
        }
      }
    } else result = { outcome: 'APPLIED', summary: `외부 값 '${c.externalValue}'을(를) 반영` };
    const done = { ...c, status: 'RESOLVED', resolution: { choose, by: ctx.actor.id, at: ctx.iso(), reason } };
    ctx.put(CONFLICT, String(c.conflictId), done);
    ctx.audit({ action: 'EXT_SYNC_CONFLICT_RESOLVE', target: `${c.system}:${c.key}`, before: { platform: c.platformValue, external: c.externalValue }, after: { choose, outcome: result.outcome }, reason, componentId: 'D05-01' });
    return { conflict: done, result };
  },
  { body: ResolveConflictBody },
);

// IF-01 ALM 요구사항(Feature Version별) — 스냅샷은 시드 Feature마다 있다. 이 브라우저에서 만든 Feature는 서버 모의 ALM과 같은 규칙으로, 없는 Feature는 서버와 같은 404
registerSimReader('almRequirements', async (ctx) => {
  const { featureId, version } = ctx.req.query;
  if (!featureId || !version) throw new SimError('VALIDATION', 'featureId와 version이 필요합니다.');
  const snap = await ctx.snapshot<any>();
  if (snap) return snap;
  const f = await featureRow(ctx, featureId, version);
  if (!f) throw new SimError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
  return { featureId, version, system: 'ALM (모의)', items: ((f.requirementIds ?? []) as string[]).map((reqId, i) => ({ reqId, title: `${f.name} — 요구사항 ${i + 1}`, status: 'APPROVED', tracedGate: 'G2', baseline: f.baselineId ?? null })) };
});

const EXT_LINK = 'extLink';
registerSimReader('policyExtLinks', async (ctx) => {
  const mine = ctx.list<any>(EXT_LINK).filter((l) => l.entity === 'POLICY' && l.entityId === ctx.req.params.id);
  // 시연에서 새로 만든 정책(handlers/policy-ops) — 스냅샷이 없으니 연결 없음으로 시작한다
  const fresh = (ctx.overlay.created.policy ?? []).includes(ctx.req.params.id);
  if (!mine.length && !fresh) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const seen = new Set(base.items.map((l) => `${l.system}:${l.key}`));
  return { ...base, items: [...base.items, ...mine.filter((l) => !seen.has(`${l.system}:${l.key}`))].sort((a, b) => `${a.system}${a.key}`.localeCompare(`${b.system}${b.key}`)) };
});
registerSimReader('extChangeRequests', async (ctx) => {
  const mine = ctx.list<any>(EXT_LINK);
  if (!mine.length) return undefined;
  const base = await ctx.snapshot<{ items: any[] }>();
  if (!base) return undefined;
  const policies = (await ctx.read<{ items: any[] }>('listPolicies').catch(() => ({ items: [] }))).items ?? [];
  return {
    ...base,
    items: base.items.map((cr) => {
      const links = mine.filter((l) => l.key === cr.key);
      if (!links.length) return cr;
      const extra = links.filter((l) => l.entity === 'POLICY' && !cr.policies.some((p: any) => p.policyId === l.entityId)).map((l) => {
        const p = policies.find((x) => x.policyId === l.entityId);
        return { policyId: l.entityId, flagKey: p?.flagKey ?? null, status: p?.status ?? null, stage: p?.stageBasisPoints ?? null, expectedCrStatus: p ? (crOfPolicy(p.status) ?? null) : null };
      });
      const feats = links.filter((l) => l.entity === 'FEATURE' && !cr.features.includes(l.entityId)).map((l) => l.entityId);
      return { ...cr, status: links.at(-1)!.crStatus ?? cr.status, policies: [...cr.policies, ...extra], features: [...cr.features, ...feats] };
    }),
  };
});

registerSimHandler(
  'linkPolicyChangeRequest',
  async (ctx) => {
    const policyId = ctx.req.params.id;
    const crKey = ctx.req.body.crKey as string;
    const p = (await ctx.read<any>('policyDetail', { id: policyId }).catch(() => null))?.policy ?? ((await ctx.read<{ items: any[] }>('listPolicies').catch(() => ({ items: [] }))).items ?? []).find((x) => x.policyId === policyId);
    if (!p) return ctx.fail('NOT_FOUND', `정책 ${policyId}을(를) 찾을 수 없습니다.`);
    const crs = (await ctx.read<{ items: any[] }>('extChangeRequests').catch(() => ({ items: [] }))).items ?? [];
    const items = (await ctx.snapshot<{ items: any[] }>('mockExtItems', { system: 'jira' }))?.items ?? [];
    const remote = crs.find((x) => x.key === crKey) ?? items.find((x) => x.key === crKey);
    if (!remote || remote.kind !== 'CHANGE_REQUEST') return ctx.fail('GUARD_FAILED', `JIRA에 변경요청 ${crKey}이(가) 없습니다.`);
    // 연결하면 플랫폼이 CR 상태를 정책 상태의 거울로 쓴다(서버 enqueue CR_STATUS → drain)
    const crStatus = crOfPolicy(p.status) ?? JIRA_CR_STATUS.OPEN;
    const at = ctx.iso();
    const base = { system: 'JIRA', kind: 'CHANGE_REQUEST', key: crKey, url: remote.url ?? null, title: remote.title, status: crStatus, revision: remote.revision ?? 1, syncState: 'SYNCED', syncedAt: at, stale: false, extra: remote.extra ?? {}, crStatus, createdAt: at };
    ctx.put(EXT_LINK, `JIRA:${crKey}:POLICY:${policyId}`, { ...base, linkId: `${crKey}:${policyId}`, entity: 'POLICY', entityId: policyId }, { created: true });
    ctx.put(EXT_LINK, `JIRA:${crKey}:FEATURE:${p.featureId}@${p.featureVersion}`, { ...base, linkId: `${crKey}:${p.featureId}@${p.featureVersion}`, entity: 'FEATURE', entityId: `${p.featureId}@${p.featureVersion}` }, { created: true });
    ctx.audit({ action: 'EXT_CR_LINK', target: policyId, after: { crKey }, componentId: 'D05-01' });
    return ctx.list<any>(EXT_LINK).filter((l) => l.entity === 'POLICY' && l.entityId === policyId);
  },
  { body: LinkChangeRequestBody },
);

// ═══ D01-07 실험 ═══════════════════════════════════════════
const EXP = 'experiment';
/** 모의 운영 데이터의 기준 비율·하루 표본(서버 experiment.service와 같은 값) — 실험 ID로 결정적 */
const EXP_BASE: Record<string, number> = { FAULT_RATE: 0.012, HARSH_DECEL_RATE: 0.04, ENGAGEMENT: 0.55, DECISION_AGREEMENT: 0.985 };
const SAMPLES_PER_DAY = 900;
async function experimentResults(ctx: SimReadContext, e: any) {
  if (!e.startedAt) return null;
  const end = e.concludedAt ?? new Date().toISOString();
  const days = Math.max(0, (Date.parse(end) - Date.parse(e.startedAt)) / 86400_000);
  const total = Math.floor(days * SAMPLES_PER_DAY);
  const treatN = Math.floor((total * e.treatmentBp) / 10000);
  const controlN = total - treatN;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e.experimentId + e.policyId));
  const seed = new DataView(h).getUint32(0);
  const effect = (((seed % 7) - 3) / 3) * EXP_BASE[e.metric] * 0.25;
  const rate = (p: number, salt: number) => (n: number) => Math.round(n * Math.min(0.999, Math.max(0.001, p + (((seed >> salt) % 5) - 2) * 0.0005)));
  const control = { n: controlN, events: rate(EXP_BASE[e.metric], 3)(controlN) };
  const treatment = { n: treatN, events: rate(EXP_BASE[e.metric] + effect, 7)(treatN) };
  const est = effectEstimate(control, treatment, e.minSamples);
  const provenance = { source: 'SIMULATED', sampleCounts: { control: controlN, treatment: treatN } };
  const head = { days: Math.round(days * 10) / 10, metric: e.metric, metricKo: EXPERIMENT_METRICS[e.metric as keyof typeof EXPERIMENT_METRICS].ko };
  if (e.type === 'AB') return { ...head, ...provenance, ...est, verdict: effectVerdict(e.metric, est), fleet: null };
  // Evaluate the current browser records; a missing comparison is never synthetic agreement.
  const fleet = await shadowFleet(ctx, e);
  const agreement = treatN ? treatment.events / treatN : 0;
  const verdict = shadowVerdict(agreement, est.enough, fleet);
  return { ...head, ...provenance, ...est, agreement: Math.round(agreement * 10000) / 10000, verdict, fleet };
}
async function shadowFleet(ctx: SimReadContext, e: any) {
  let vehicles: any[] = [], deployed: any = null;
  const unavailable = (comparisonStatus = 'SOURCE_UNAVAILABLE') => ({ deployedPolicyId: deployed?.policyId ?? null, vehicles: vehicles.length, comparableVehicles: 0, comparisonStatus, agreement: 0, diverged: [] as {vin:string;shadow:boolean|null;current:boolean|null}[] });
  try {
    const [policies, fleet] = await Promise.all([ctx.read<{items:any[]}>('listPolicies'),ctx.read<{items:any[]}>('vehicles')]);
    if (!Array.isArray(policies.items) || !Array.isArray(fleet.items)) return unavailable();
    vehicles=fleet.items;
    const candidate=(await ctx.read<any>('policyDetail',{id:e.policyId}))?.policy;
    if (!candidate) return unavailable();
    const current=policies.items.filter(p=>p.flagKey===candidate.flagKey&&p.status==='DEPLOYED').sort((a,b)=>(b.revision??0)-(a.revision??0))[0];
    if (current) deployed=(await ctx.read<any>('policyDetail',{id:current.policyId}))?.policy??null;
    if (!deployed) return unavailable('NO_BASELINE');
    if (!vehicles.length) return unavailable('NO_VEHICLES');
    const [target,baseline,kills]=await Promise.all([
      ctx.read<any>('featureDetail',{id:candidate.featureId,ver:candidate.featureVersion}),
      ctx.read<any>('featureDetail',{id:deployed.featureId,ver:deployed.featureVersion}),
      ctx.read<{items:any[]}>('killRequests'),
    ]);
    if (!target?.feature || !baseline?.feature || !Array.isArray(kills.items)) return unavailable();
    const active=new Set<string>();
    if(candidate.entitlementCatalogId||deployed.entitlementCatalogId){
      const [baselines,products,grants]=await Promise.all([ctx.read<{items:any[]}>('baselines'),ctx.read<{items:any[]}>('listProducts'),ctx.read<{items:any[]}>('entitlements')]);
      if(!Array.isArray(baselines.items)||!Array.isArray(products.items)||!Array.isArray(grants.items))return unavailable();
      const today=grants.items.some(g=>typeof g.effective!=='boolean')?await trialToday(ctx):'';
      for(const featureId of new Set([candidate.featureId,deployed.featureId])){
        const ids=new Set(baselines.items.filter(b=>b.featureId===featureId).map(b=>b.baselineId));
        const cats=new Set(products.items.filter(p=>p.baselineIds?.some((id:string)=>ids.has(id))).map(p=>p.catalogId));
        for(const g of grants.items)if(cats.has(g.catalogId)&&(typeof g.effective==='boolean'?g.effective:grantState(g,today).effective))active.add(`${featureId}|${g.vin}`);
      }
    }
    const rows=[];
    for(const raw of vehicles){
      const parsed=VehicleSchema.safeParse(raw);if(!parsed.success)continue;const vehicle=parsed.data;
      const evaluate=(policy:any,feature:any)=>evaluateFlag({policy:{...policy,status:'DEPLOYED'},scope:{country:feature.country,vehicleModel:feature.vehicleModel,trim:feature.trim},vehicle,killed:kills.items.some(k=>k.status==='ACTIVE'&&(k.featureIds??[k.featureId]).includes(policy.featureId)&&k.vins?.includes(vehicle.vin)),entitlementActive:policy.entitlementCatalogId?active.has(`${policy.featureId}|${vehicle.vin}`):null});
      const shadow=await evaluate(candidate,target.feature),current=await evaluate(deployed,baseline.feature);
      rows.push({vin:vehicle.vin,shadow:shadow.value,current:current.value,same:shadow.value===current.value});
    }
    const same=rows.filter(r=>r.same).length;
    return {deployedPolicyId:deployed.policyId,vehicles:vehicles.length,comparableVehicles:rows.length,comparisonStatus:rows.length===vehicles.length?'AVAILABLE':'PARTIAL',agreement:rows.length?same/rows.length:0,diverged:rows.filter(r=>!r.same)};
  } catch { return unavailable(); }
}
async function experimentOf(ctx: SimReadContext, id: string) {
  return ctx.get<any>(EXP, id) ?? (await ctx.snapshot<any>('experiment', { id }));
}
registerSimReader('experiments', async (ctx) => {
  if (!touched(ctx, EXP)) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const q = ctx.req.query;
  return { ...base, items: overlayList(ctx, EXP, base.items, (e: any) => e.experimentId, (e) => (!q.policyId || e.policyId === q.policyId) && (!q.status || e.status === q.status), ({ results: _r, ...e }: any) => e) };
});
registerSimReader('experiment', async (ctx) => {
  const e = ctx.get<any>(EXP, ctx.req.params.id);
  return e ? { ...e, results: await experimentResults(ctx, e) } : undefined;
});

registerSimHandler(
  'createExperiment',
  async (ctx) => {
    const body = ctx.req.body;
    const p = ((await ctx.read<{ items: any[] }>('listPolicies').catch(() => ({ items: [] }))).items ?? []).find((x) => x.policyId === body.policyId);
    if (!p) return ctx.fail('NOT_FOUND', `${body.policyId} 정책을 찾을 수 없습니다.`);
    const profile = (await ctx.read<any>('safetyProfile', { id: p.featureId, ver: p.featureVersion }).catch(() => null))?.profile;
    const fClass = profile?.fClass ?? 'F0';
    const allowed = experimentAllowed(body.type, fClass, body.metric);
    if ('rule' in allowed) ctx.fail('GUARD_FAILED', allowed.message, { rule: allowed.rule, fClass }, { action: 'EXPERIMENT_CREATE', target: body.policyId, reason: `${allowed.rule}: ${allowed.message}`, componentId: 'D01-07' });
    const list = (await ctx.read<{ items: any[] }>('experiments').catch(() => ({ items: [] }))).items ?? [];
    if (list.some((e) => e.policyId === p.policyId && (e.status === 'RUNNING' || e.status === 'DRAFT'))) ctx.fail('CONFLICT', `${p.policyId}에 진행 중인 실험이 있습니다.`);
    const e = {
      experimentId: `EXP-${String(list.length + 1).padStart(5, '0')}`,
      policyId: p.policyId,
      flagKey: p.flagKey,
      featureId: p.featureId,
      featureVersion: p.featureVersion,
      fClass,
      type: body.type,
      hypothesis: body.hypothesis,
      metric: body.metric,
      treatmentBp: body.treatmentBp,
      minSamples: body.minSamples,
      status: 'DRAFT',
      createdBy: ctx.actor.id,
      createdAt: ctx.iso(),
      startedAt: null,
      concludedAt: null,
      decision: null,
      reason: null,
    };
    ctx.put(EXP, e.experimentId, e, { created: true });
    ctx.audit({ action: 'EXPERIMENT_CREATE', target: e.experimentId, after: { policyId: e.policyId, type: e.type, fClass: e.fClass, metric: e.metric }, componentId: 'D01-07' });
    ctx.emit('experiment.created', e.experimentId, { policyId: e.policyId, type: e.type, featureId: e.featureId }, { componentId: 'D01-07' });
    return e;
  },
  { body: CreateExperimentBody },
);

async function experimentStep(ctx: SimWriteContext, next: any, action: string, event: string) {
  const { results: _r, ...doc } = next;
  ctx.put(EXP, doc.experimentId, doc);
  ctx.audit({ action, target: doc.experimentId, after: { status: doc.status, decision: doc.decision }, componentId: 'D01-07' });
  ctx.emit(event, doc.experimentId, { policyId: doc.policyId, status: doc.status, decision: doc.decision }, { componentId: 'D01-07' });
  return { ...doc, results: await experimentResults(ctx, doc) };
}
registerSimHandler(
  'startExperiment',
  async (ctx) => {
    const id = ctx.req.params.id;
    const e = await experimentOf(ctx, id);
    if (!e) return ctx.fail('NOT_FOUND', `${id} 실험을 찾을 수 없습니다.`);
    if (e.status !== 'DRAFT') ctx.fail('GUARD_FAILED', `${id}은(는) ${e.status} — 초안만 시작할 수 있습니다.`);
    return experimentStep(ctx, { ...e, status: 'RUNNING', startedAt: ctx.iso() }, 'EXPERIMENT_START', 'experiment.started');
  },
  { body: EmptyBody },
);
registerSimHandler(
  'concludeExperiment',
  async (ctx) => {
    const id = ctx.req.params.id;
    const body = ctx.req.body as { decision: 'ADOPT' | 'REJECT' | 'EXTEND'; reason: string };
    const e = await experimentOf(ctx, id);
    if (!e) return ctx.fail('NOT_FOUND', `${id} 실험을 찾을 수 없습니다.`);
    if (e.status !== 'RUNNING') ctx.fail('GUARD_FAILED', `${id}은(는) ${e.status} — 실행 중인 실험만 종료할 수 있습니다.`);
    const r = await experimentResults(ctx, e);
    if (body.decision === 'ADOPT' && r && r.verdict !== 'BETTER' && r.verdict !== 'CONSISTENT') ctx.fail('GUARD_FAILED', `효과가 확인되지 않아 채택할 수 없습니다 (${r.verdict}).`, { verdict: r.verdict });
    return experimentStep(ctx, { ...e, status: 'CONCLUDED', concludedAt: ctx.iso(), decision: body.decision, reason: body.reason }, 'EXPERIMENT_CONCLUDE', 'experiment.concluded');
  },
  { body: ConcludeExperimentBody },
);

// ═══ D04-05 사고·VOC · D05-05 현장 접수 ═══════════════════════
const INC = 'incident';
async function incidentList(ctx: SimReadContext): Promise<any[]> {
  const base = (await ctx.snapshot<{ items: any[] }>('incidents'))?.items ?? [];
  return overlayList(ctx, INC, base, (i: any) => i.incidentId);
}
registerSimReader('incidents', async (ctx) => {
  if (!touched(ctx, INC)) return undefined;
  const q = ctx.req.query;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  return { ...base, items: (await incidentList(ctx)).filter((i) => (!q.status || i.status === q.status) && (!q.featureId || i.featureId === q.featureId) && (!q.source || i.source === q.source)) };
});
registerSimReader('fieldVehicle', async (ctx) => {
  const vin = ctx.req.params.vin;
  const mine = ctx.list<any>(INC).filter((i) => i.vin === vin);
  if (!mine.length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const seen = new Set((base.incidents ?? []).map((i: any) => i.incidentId));
  return { ...base, incidents: [...mine.filter((i) => !seen.has(i.incidentId)).map((i) => ({ incidentId: i.incidentId, source: i.source, category: i.category, severity: i.severity, status: i.status, summary: i.summary, receivedAt: i.receivedAt })), ...(base.incidents ?? [])] };
});

/** 접수 — SOTIF 트리거면 이상 징후로 넘긴다(이벤트, @rule FFG-SOT-003) */
async function receiveIncident(ctx: SimWriteContext, body: any, externalRef: string | null, taken: string[]) {
  let versions: any[] = [];
  if (body.featureId) {
    versions = ((await ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: 'false' }).catch(() => ({ items: [] }))).items ?? []).filter((f) => f.featureId === body.featureId);
    if (!versions.length) ctx.fail('NOT_FOUND', `${body.featureId}을(를) 찾을 수 없습니다.`);
  }
  const sotif = sotifTrigger(body);
  const vehicle = body.vin ? ((await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? []).find((v) => v.vin === body.vin) : undefined;
  const vehicleScope = body.vin && body.featureId ? incidentVehicleScope(body.vin, body.featureId, vehicle, versions.map((v) => ({ version: v.version, country: v.country, vehicleModel: v.vehicleModel, trim: v.trim }))) : null;
  const i = {
    incidentId: `INC-${String(taken.length + 1).padStart(5, '0')}`,
    source: body.source,
    externalRef,
    vin: body.vin,
    featureId: body.featureId,
    category: body.category,
    severity: body.severity,
    summary: body.summary,
    occurredAt: body.occurredAt ?? null,
    receivedAt: ctx.iso(),
    receivedBy: ctx.actor.id,
    sotif,
    anomalyId: null,
    status: 'OPEN',
    vehicleScope,
    anomaly: null,
  };
  taken.push(i.incidentId);
  ctx.put(INC, i.incidentId, i, { created: true });
  ctx.audit({ action: 'INCIDENT_RECEIVE', target: i.incidentId, after: { source: i.source, featureId: i.featureId, category: i.category, severity: i.severity, sotif: sotif.trigger, vehicleScope: vehicleScope?.fit ?? null }, componentId: 'D04-05' });
  ctx.emit('incident.received', i.incidentId, { source: i.source, vin: i.vin, featureId: i.featureId, category: i.category, severity: i.severity }, { componentId: 'D04-05' });
  if (sotif.trigger) ctx.emit('incident.sotif.triggered', i.incidentId, { incidentId: i.incidentId, featureId: i.featureId, vin: i.vin, category: i.category, severity: i.severity, reason: sotif.reason }, { componentId: 'D04-05' });
  return i;
}
const incidentIds = async (ctx: SimReadContext) => (await incidentList(ctx)).map((i) => i.incidentId);

registerSimHandler('createIncident', async (ctx) => receiveIncident(ctx, ctx.req.body, null, await incidentIds(ctx)), { body: CreateIncidentBody });

registerSimHandler(
  'importVoc',
  async (ctx) => {
    const taken = await incidentIds(ctx);
    const known = new Set((await incidentList(ctx)).filter((i) => i.source === 'VOC').map((i) => i.externalRef));
    const features = ((await ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: 'false' }).catch(() => ({ items: [] }))).items ?? []);
    const created: unknown[] = [];
    let skipped = 0;
    for (const v of VOC_FEED) {
      if (known.has(v.ref)) {
        skipped++;
        continue;
      }
      const featureId = v.featureName ? (features.find((f) => f.name.includes(v.featureName!) && f.country === 'KR')?.featureId ?? null) : null;
      created.push(await receiveIncident(ctx, { source: 'VOC', vin: v.vin, featureId, category: classifyVoc(v.text), severity: v.severity, summary: v.text, occurredAt: null }, v.ref, taken));
    }
    return { created, skipped };
  },
  { body: EmptyBody },
);

registerSimHandler(
  'createFieldCase',
  async (ctx) => {
    const body = ctx.req.body;
    const vehicles = (await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? [];
    if (!vehicles.some((v) => v.vin === body.vin)) ctx.fail('NOT_FOUND', `${body.vin}은(는) 등록된 차량이 아닙니다.`);
    return receiveIncident(ctx, { source: 'DEALER', vin: body.vin, featureId: body.featureId, category: body.category, severity: body.severity, summary: `[${body.dealer}] ${body.summary}`, occurredAt: null }, null, await incidentIds(ctx));
  },
  { body: FieldCaseBody },
);

// ═══ D04-06 품질 피드백 ═════════════════════════════════════
const FB = 'qualityFeedback';
registerSimReader('qualityFeedback', async (ctx) => {
  if (!touched(ctx, FB)) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const q = ctx.req.query;
  return { ...base, items: overlayList(ctx, FB, base.items, (f: any) => f.feedbackId, (f) => (!q.featureId || f.featureId === q.featureId) && (!q.status || f.status === q.status)) };
});
registerSimReader('qualityFeedbackDetail', (ctx) => ctx.get(FB, ctx.req.params.id));
registerSimHandler(
  'acceptFeedback',
  async (ctx) => {
    const id = ctx.req.params.id;
    const fb = ctx.get<any>(FB, id) ?? (await ctx.snapshot<any>('qualityFeedbackDetail', { id })) ?? ((await ctx.snapshot<{ items: any[] }>('qualityFeedback'))?.items ?? []).find((f) => f.feedbackId === id);
    if (!fb) return ctx.fail('NOT_FOUND', `품질 피드백 ${id}을(를) 찾을 수 없습니다.`);
    if (fb.status !== 'OPEN') ctx.fail('GUARD_FAILED', `열린(OPEN) 피드백만 수용할 수 있습니다 (현재 ${fb.status}).`);
    const reason = ctx.req.body.reason as string;
    const next = { ...fb, status: 'ACCEPTED', acceptedBy: ctx.actor.id, acceptedAt: ctx.iso(), note: reason };
    ctx.put(FB, id, next);
    ctx.audit({ action: 'QUALITY_FEEDBACK_ACCEPT', target: id, before: { status: fb.status }, after: { status: 'ACCEPTED' }, reason, componentId: 'D04-06' });
    ctx.emit('quality.feedback.accepted', id, { feedbackId: id, featureId: fb.featureId }, { componentId: 'D04-06' });
    return next;
  },
  { body: FeedbackAcceptBody },
);

// ═══ D05-02 동기화·대사 · D05-03 해외공장 주문 · D05-07 레거시 코딩 계획 ═══════
// 외부 원천은 모의 시스템(서버 adapters/if-mocks)과 같은 변형을 플랫폼 데이터에 적용한다 — 원천을 덮어쓰지 않고 차이만 기록
const SYNC_RUN = 'syncRun';
async function syncSides(ctx: SimReadContext, t: any): Promise<{ platform: Record<string, unknown>[]; external: Record<string, unknown>[] }> {
  const vehicles = (await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? [];
  switch (t.targetId) {
    case 'SYNC-IF02-ECU': {
      const platform = ((await ctx.read<{ items: any[] }>('masterEcu').catch(() => ({ items: [] }))).items ?? []).map(({ sw: _s, features: _f, ...e }) => e);
      const external = platform.map((e) => ({ ...e }));
      if (external[0]) external[0] = { ...external[0], hwRevision: `${external[0].hwRevision ?? 'A'}-R2` };
      external.pop(); // PLM에서 폐기된 ECU
      external.push({ ecuPno: '99999-NX400', name: '통합 존 제어기(신규)', hwRevision: 'A', supplier: 'Mutuus Lab', asil: 'B' });
      return { platform, external };
    }
    case 'SYNC-IF02-VEH': {
      const rows = vehicles.filter((v) => !v.vin.startsWith('ego-') && !v.vin.startsWith('lead-')).map((v) => ({ vin: v.vin, vehicleModel: v.vehicleModel, trim: v.trim, upgVc: v.upgVc }));
      // 사양 변경이 PLM에만 반영됨(모의 원천)
      return { platform: rows, external: rows.map((r) => (r.vin === 'KMH-NX4-0003' ? { ...r, trim: 'Inspiration' } : r)) };
    }
    case 'SYNC-IF03-DW': {
      const fs = (await ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: 'false' }).catch(() => ({ items: [] }))).items ?? [];
      const platform = fs.map((f) => ({ key: `${f.featureId}@${f.version}`, lifecycle: f.lifecycle, baselineId: f.baselineId }));
      return { platform, external: platform.map((f, i) => ({ ...f, lifecycle: i % 17 === 3 ? 'VERIFIED' : f.lifecycle })) };
    }
    default: {
      const plant = t.targetId.split('-')[2];
      return { platform: vehicles.filter((v) => v.vin.startsWith(`${plant}-`)).map((v) => ({ vin: v.vin, vehicleModel: v.vehicleModel })), external: (PLANT_ORDERS as PlantOrder[]).filter((o) => o.plant === plant).map((o) => ({ vin: o.vin, vehicleModel: o.vehicleModel })) };
    }
  }
}
registerSimReader('syncRuns', async (ctx) => {
  if (!touched(ctx, SYNC_RUN)) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const t = ctx.req.query.targetId;
  return { ...base, items: overlayList(ctx, SYNC_RUN, base.items, (r: any) => r.runId, (r) => !t || r.targetId === t).sort((a, b) => b.runId.localeCompare(a.runId)) };
});
registerSimReader('syncTargets', async (ctx) => {
  if (!touched(ctx, SYNC_RUN)) return undefined;
  const base = await ctx.snapshot<{ items: any[] }>();
  if (!base) return undefined;
  const runs = ctx.list<any>(SYNC_RUN).sort((a, b) => b.runId.localeCompare(a.runId));
  return { ...base, items: base.items.map((t) => {
    const last = runs.find((r) => r.targetId === t.targetId);
    return last ? { ...t, last: { runId: last.runId, status: last.status, at: last.at, diffs: last.diffs.length } } : t;
  }) };
});
registerSimHandler(
  'runSync',
  async (ctx) => {
    const targetId = ctx.req.body.targetId as string;
    const t = ((await ctx.snapshot<{ items: any[] }>('syncTargets'))?.items ?? []).find((x) => x.targetId === targetId);
    if (!t) return ctx.fail('NOT_FOUND', `${targetId} 동기화 대상을 찾을 수 없습니다.`);
    const n = ctx.state<{ n: number }>('syncRunSeq', () => ({ n: 0 }));
    n.n += 1;
    const runId = `SYNC-RUN-${String(n.n).padStart(5, '0')}`;
    const base = { runId, targetId, ifId: t.ifId, market: t.market, at: ctx.iso(), by: ctx.actor.id };
    const gate = syncGate(t);
    let run: any;
    if (!gate.allowed) run = { ...base, status: 'HELD', records: { platform: 0, external: 0 }, diffs: [], reason: gate.reason };
    else {
      const { platform, external } = await syncSides(ctx, t);
      run = { ...base, status: 'SUCCEEDED', records: { platform: platform.length, external: external.length }, diffs: reconcile(platform, external, t.key, t.fields), reason: null };
    }
    ctx.put(SYNC_RUN, runId, run, { created: true });
    ctx.audit({ action: 'SYNC_RUN', target: runId, after: { targetId, status: run.status, diffs: run.diffs.length, market: t.market }, componentId: 'D05-02' });
    ctx.emit('sync.completed', runId, { targetId, ifId: t.ifId, status: run.status, diffs: run.diffs.length, market: t.market, reason: run.reason }, { componentId: 'D05-02' });
    return run;
  },
  { body: RunSyncBody },
);

const ORDER = 'plantOrder';
registerSimReader('legacyOrders', async (ctx) => {
  if (!touched(ctx, ORDER)) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const plant = ctx.req.query.plant;
  return { ...base, items: overlayList(ctx, ORDER, base.items, (o: any) => o.orderId, (o) => !plant || o.plant === plant).sort((a, b) => a.orderId.localeCompare(b.orderId)) };
});
export async function importLocalPlantOrders(ctx: SimWriteContext, plant: string) {
    const mappings = ((await ctx.read<{ items: any[] }>('legacyMappings').catch(() => ({ items: [] }))).items ?? []) as LegacyMapping[];
    const at = ctx.iso();
    const out = (PLANT_ORDERS as PlantOrder[]).filter((o) => o.plant === plant).map((o) => ({ ...resolveOrder(o, mappings), importedAt: at }));
    // 같은 주문은 다시 넣지 않고 해석만 갱신(서버 ON CONFLICT)
    for (const r of out) ctx.put(ORDER, r.orderId, r);
    const unresolved = [...new Set(out.flatMap((r) => r.unresolved))];
    ctx.audit({ action: 'PLANT_ORDER_IMPORT', target: plant, after: { orders: out.length, unresolved }, componentId: 'D05-03' });
    ctx.emit('legacy.orders.imported', plant, { plant, orders: out.length, unresolved }, { componentId: 'D05-03' });
    return { plant, orders: out, unresolved };
}
registerSimHandler('importPlantOrders',ctx=>importLocalPlantOrders(ctx,ctx.req.body.plant),{body:ImportOrdersBody});

registerSimHandler(
  'translateLegacy',
  async (ctx) => {
    const body = ctx.req.body as { vin: string; featureId: string; enable: boolean };
    const v = ((await ctx.read<{ items: any[] }>('legacyVehicles').catch(() => ({ items: [] }))).items ?? []).find((x) => x.vin === body.vin);
    if (!v) return ctx.fail('NOT_FOUND', `${body.vin}은(는) 레거시 차량 목록에 없습니다 — SDV 차량은 서명 정책·OTA로 전달합니다.`);
    const versions = ((await ctx.read<{ items: any[] }>('listFeatures', {}, { latestOnly: 'false' }).catch(() => ({ items: [] }))).items ?? []).filter((f) => f.featureId === body.featureId).sort(byVersion);
    const f = versions.at(-1);
    if (!f) return ctx.fail('NOT_FOUND', `${body.featureId}을(를) 찾을 수 없습니다.`);
    const fClass = (await ctx.read<any>('safetyProfile', { id: f.featureId, ver: f.version }).catch(() => null))?.profile?.fClass ?? 'F0';
    const plan = legacyPlan(v, { featureId: f.featureId, fClass, controlPoints: f.controlPoints ?? [] }, body.enable);
    const target = `${v.vin}:${f.featureId}`;
    // 거부는 오류가 아니라 계획 결과(supported false)로 돌려주고 실패 감사만 남긴다(서버와 같음)
    if (!plan.supported) ctx.audit({ action: 'LEGACY_CODING_PLAN', target, reason: plan.reason, result: 'FAILED', componentId: 'D05-07' });
    else ctx.audit({ action: 'LEGACY_CODING_PLAN', target, after: { enable: body.enable, commands: plan.commands }, componentId: 'D05-07' });
    return { vin: v.vin, featureId: f.featureId, version: f.version, fClass, enable: body.enable, ...plan };
  },
  { body: TranslateLegacyBody },
);

// ═══ D06-10 PKI — 서명 키 교체·차량 키 epoch · D06-11 VEX ═══════════════
// 새 키는 시연 공개키(결정적, Ed25519 SPKI 모양) — 실제 HSM 키가 아니다(설계 20-60 §한계)
const PKI = 'pkiKey';
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
async function demoPublicKey(keyId: string, purpose: string) {
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ff-sim-pki\n${keyId}\n${purpose}`)));
  const der = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00, ...raw]);
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64(der)}\n-----END PUBLIC KEY-----\n`;
  const fp = [...new Uint8Array(await crypto.subtle.digest('SHA-256', der))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
  return { pem, fingerprint: `sha256:${fp}` };
}
async function pkiKeys(ctx: SimReadContext): Promise<any[]> {
  const base = (await ctx.snapshot<{ items: any[] }>('pkiKeys'))?.items ?? [];
  return overlayList(ctx, PKI, base, (k: any) => k.keyId).sort((a, b) => a.keyId.localeCompare(b.keyId));
}
registerSimReader('pkiKeys', async (ctx) => (touched(ctx, PKI) ? { ...((await ctx.snapshot<any>()) ?? {}), items: await pkiKeys(ctx) } : undefined));
registerSimHandler(
  'rotateKey',
  async (ctx) => {
    const { reason, purpose } = ctx.req.body as { reason: string; purpose: string };
    const keys = await pkiKeys(ctx);
    const prev = keys.find((k) => k.status === 'ACTIVE' && k.purpose === purpose);
    const at = ctx.iso();
    if (prev) ctx.put(PKI, prev.keyId, { ...prev, status: 'RETIRED', retiredAt: at });
    const keyId = `KEY-${String(keys.length + 1).padStart(4, '0')}`;
    const { pem, fingerprint } = await demoPublicKey(keyId, purpose);
    const epoch = (await ctx.read<{ epoch: number }>('hsmStatus').catch(() => ({ epoch: 1 }))).epoch ?? 1;
    const key = { keyId, alg: 'Ed25519', purpose, epoch, status: 'ACTIVE', createdAt: at, notAfter: new Date(Date.now() + 365 * 86400_000).toISOString(), retiredAt: null, publicKeyPem: pem, fingerprint };
    ctx.put(PKI, keyId, key, { created: true });
    ctx.audit({ action: 'PKI_ROTATE', target: keyId, before: { active: prev?.keyId ?? null }, after: { active: keyId, purpose }, reason, componentId: 'D06-10' });
    // 품질·운영 담당 알림(교체자 본인 제외) — NOTIFICATION_RULES 'pki.key.rotated'
    ctx.emit('pki.key.rotated', keyId, { keyId, purpose, retired: prev?.keyId ?? null, by: ctx.actor.id, reason }, { componentId: 'D06-10' });
    return key;
  },
  { body: KeyRotateBody },
);
registerSimReader('hsmStatus', async (ctx) => {
  const e = (ctx.overlay.data.hsmEpoch as { epoch: number } | undefined)?.epoch;
  if (!e) return undefined;
  return { ...((await ctx.snapshot<any>()) ?? {}), epoch: e };
});
registerSimHandler(
  'bumpEpoch',
  async (ctx) => {
    const reason = ctx.req.body.reason as string;
    const base = (await ctx.snapshot<{ epoch: number }>('hsmStatus'))?.epoch ?? 1;
    const box = ctx.state<{ epoch: number }>('hsmEpoch', () => ({ epoch: base }));
    const prev = box.epoch;
    box.epoch = prev + 1;
    ctx.audit({ action: 'HSM_EPOCH_BUMP', target: 'vehicle_root', before: { epoch: prev }, after: { epoch: prev + 1 }, reason, componentId: 'D06-10' });
    ctx.emit('pki.epoch.bumped', 'vehicle_root', { epoch: prev + 1 }, { componentId: 'D06-10' });
    return { epoch: prev + 1 };
  },
  { body: EpochBumpBody },
);

registerSimReader('vexList', async (ctx) => {
  const mine = (ctx.overlay.data.vexRows ?? []) as any[];
  if (!mine.length) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  return { ...base, items: [...base.items, ...mine] };
});
registerSimHandler(
  'recordVex',
  async (ctx) => {
    const body = ctx.req.body;
    const list = (await ctx.read<{ items: any[] }>('sbomList').catch(() => ({ items: [] }))).items ?? [];
    const latest = new Map<string, { featureId: string; featureVersion: string; bom: any }>();
    for (const r of [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.serial).localeCompare(String(b.serial)))) {
      const bom = await ctx.read<any>('sbomDetail', { serial: r.serial }).catch(() => null);
      if (bom?.components) latest.set(`${r.featureId}@${r.featureVersion}`, { featureId: r.featureId, featureVersion: r.featureVersion, bom });
    }
    const impact = vexImpact(body, [...latest.values()]);
    const row = { statement: body, impact, by: ctx.actor.id, at: ctx.iso() };
    ctx.state<any[]>('vexRows', () => []).push(row);
    ctx.audit({ action: 'VEX_RECORD', target: body.vulnId, after: { state: body.state, affects: body.affects, features: impact.features.map((f: any) => `${f.featureId}@${f.featureVersion}`), action: impact.action }, componentId: 'D06-11' });
    ctx.emit('vex.recorded', body.vulnId, { ...impact }, { componentId: 'D06-11' });
    return { statement: body, impact };
  },
  { body: VexStatement },
);

// ═══ D02-01 기준 값 ═════════════════════════════════════════
const REFV = 'referenceValue';
const refvKey = (r: { kind: string; parent?: string | null; code: string }) => `${r.kind}|${r.parent ?? ''}|${r.code}`;
async function referenceValues(ctx: SimReadContext): Promise<any[]> {
  const base = (await ctx.snapshot<{ items: any[] }>('referenceValues'))?.items ?? [];
  return overlayList(ctx, REFV, base, refvKey).sort((a, b) => a.kind.localeCompare(b.kind) || String(a.parent ?? '').localeCompare(String(b.parent ?? '')) || a.code.localeCompare(b.code));
}
registerSimReader('referenceValues', async (ctx) => {
  if (!touched(ctx, REFV)) return undefined;
  const kind = ctx.req.query.kind;
  const base = (await ctx.snapshot<any>('referenceValues')) ?? {};
  return { ...base, items: (await referenceValues(ctx)).filter((r) => !kind || r.kind === kind) };
});
registerSimHandler(
  'createReferenceValue',
  async (ctx) => {
    const body = ctx.req.body;
    const all = await referenceValues(ctx);
    const problems = referenceValueProblems(body, all);
    if (problems.length) ctx.fail('VALIDATION', problems.join(' · '), { problems });
    if (all.some((r) => r.kind === body.kind && (r.parent ?? '') === (body.parent ?? '') && r.code === body.code)) ctx.fail('CONFLICT', `${body.kind} ${body.code}은(는) 이미 등록돼 있습니다.`);
    const row = { kind: body.kind, code: body.code, label: body.label, parent: body.parent ?? null, origin: 'CUSTOMER', status: 'ACTIVE', createdAt: ctx.iso(), createdBy: ctx.actor.id };
    ctx.put(REFV, refvKey(row), row, { created: true });
    ctx.audit({ action: 'REFERENCE_VALUE_CREATE', target: `${row.kind}:${row.parent ? row.parent + '/' : ''}${row.code}`, after: row, componentId: 'D02-01' });
    return row;
  },
  { body: ReferenceValueBody },
);
registerSimHandler(
  'retireReferenceValue',
  async (ctx) => {
    const { kind, code } = ctx.req.params;
    const { reason, parent } = ctx.req.body as { reason: string; parent?: string };
    const hits = (await referenceValues(ctx)).filter((r) => r.kind === kind && r.code === code && (parent === undefined || (r.parent ?? '') === parent));
    if (!hits.length) return ctx.fail('NOT_FOUND', `${kind} ${code} 기준 값을 찾을 수 없습니다.`);
    if (hits.length > 1) ctx.fail('VALIDATION', `${kind} ${code}이(가) 여러 부모 아래 있습니다 — parent를 지정하세요.`, { parents: hits.map((h) => h.parent ?? '') });
    const r = hits[0];
    if (r.status === 'RETIRED') ctx.fail('CONFLICT', `${kind} ${code}은(는) 이미 사용 중지됐습니다.`);
    const next = { ...r, status: 'RETIRED' };
    ctx.put(REFV, refvKey(r), next);
    ctx.audit({ action: 'REFERENCE_VALUE_RETIRE', target: `${r.kind}:${r.parent ? r.parent + '/' : ''}${r.code}`, before: { status: r.status }, after: { status: 'RETIRED' }, reason, componentId: 'D02-01' });
    return next;
  },
  { body: ReferenceRetireBody },
);

// ═══ D04-03 보존 기한 정리 · Safety Case 경보 기준 · D05-01 Data Act · D04-02 TMS ═══
registerSimReader('retention', async (ctx) => {
  const done = ctx.overlay.data.retentionSweeps as any[] | undefined;
  if (!done?.length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  // 정리 뒤에는 열린 건이 묶은 행(HOLD)만 기간 초과로 남는다
  const policies = base.policies.map((p: any) => (done.some((d) => d.stores.some((s: any) => s.store === p.store)) ? { ...p, expired: p.held, deletable: 0 } : p));
  const deletions = done.flatMap((d) => d.rows).concat(base.deletions ?? []);
  return { ...base, policies, deletions };
});
registerSimHandler(
  'retentionSweep',
  async (ctx) => {
    const base = (await ctx.read<any>('retention').catch(() => null)) ?? { policies: [] };
    const at = ctx.iso();
    const out: { store: string; cutoff: string; deleted: number; held: number }[] = [];
    const rows: any[] = [];
    for (const p of base.policies ?? []) {
      if (!p.cutoff || !p.expired) continue;
      out.push({ store: p.store, cutoff: p.cutoff, deleted: p.deletable, held: p.held });
      rows.push({ at, store: p.store, cutoff: p.cutoff, deleted: p.deletable, held: p.held, heldBy: [] });
    }
    if (out.length) {
      ctx.state<any[]>('retentionSweeps', () => []).unshift({ at, stores: out, rows });
      ctx.audit({ action: 'RETENTION_SWEEP', target: 'retention', after: { stores: out }, componentId: 'D04-03' });
      ctx.emit('retention.swept', 'retention', { at, stores: out }, { componentId: 'D04-03' });
    }
    return { at, stores: out };
  },
  { body: EmptyBody },
);

registerSimReader('safetyKpi', async (ctx) => {
  const plans = ctx.overlay.data.safetyPlans as Record<string, any> | undefined;
  if (!plans || !Object.keys(plans).length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  return { ...base, items: (base.items ?? []).map((it: any) => plans[`${it.featureId}@${it.version}`] ? { ...it, plan: plans[`${it.featureId}@${it.version}`] } : it) };
});
registerSimHandler(
  'recordSafetyKpiPlan',
  async (ctx) => {
    const { featureId, version } = ctx.req.params;
    if (!(await featureRow(ctx, featureId, version))) return ctx.fail('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const plans = ctx.state<Record<string, any>>('safetyPlans', () => ({}));
    const prev = plans[`${featureId}@${version}`] ?? ((await ctx.snapshot<any>('safetyKpi'))?.items ?? []).find((x: any) => x.featureId === featureId && x.version === version)?.plan ?? examplePlan(featureId, version);
    const plan = { featureId, version, source: 'SAFETY_CASE', thresholds: { ...prev.thresholds, ...ctx.req.body.thresholds }, recordedBy: ctx.actor.id, recordedAt: ctx.iso() };
    plans[`${featureId}@${version}`] = plan;
    ctx.audit({ action: 'SAFETY_METRIC_PLAN', target: `${featureId}@${version}`, before: prev, after: plan, componentId: 'D04-03' });
    ctx.emit('safety.metric.plan', featureId, { featureId, version, thresholds: plan.thresholds }, { componentId: 'D04-03' });
    return plan;
  },
  { body: MetricPlanBody },
);

registerSimReader('dataAccessRequests', async (ctx) => {
  const reqs = (ctx.overlay.data.dataAccess ?? []) as any[];
  const basis = (ctx.overlay.data.contractBasis ?? []) as any[];
  if (!reqs.length && !basis.length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const requests = [...reqs, ...(base.requests ?? [])];
  const contractBasis = [...basis, ...(base.contractBasis ?? [])];
  const findings = (base.findings ?? []).filter((f: string) => !(contractBasis.length && f.startsWith('OEM의 비개인 데이터')) && !(requests.some((r) => r.status === 'FULFILLED') && f.startsWith('표본 요청 처리 기록')));
  return { ...base, requests, contractBasis, findings };
});
registerSimHandler(
  'createDataAccessRequest',
  async (ctx) => {
    const body = ctx.req.body;
    const vehicle = ((await ctx.read<{ items: any[] }>('vehicles').catch(() => ({ items: [] }))).items ?? []).find((v) => v.vin === body.vin) ?? null;
    const rejections = dataActDecision(vehicle, body);
    const prior = ((await ctx.read<{ requests: any[] }>('dataAccessRequests').catch(() => ({ requests: [] }))).requests ?? []).length;
    const requestId = `DAR-${String(prior + 1).padStart(5, '0')}`;
    if (rejections.length) {
      const message = rejections.map((r) => r.message).join(' · ');
      ctx.fail('GUARD_FAILED', message, { rule: 'FFG-TEL-006', requestId, rejections }, { action: 'DATA_ACCESS_REQUEST', target: requestId, reason: message, componentId: 'D05-01' });
    }
    // 그 차량의 Feature 상태·이력 — 요청 범위만(화면이 보는 차량 상태 보고)
    const status = await ctx.read<any>('vehicleStatusView', { vin: body.vin }).catch(() => null);
    const data: Record<string, unknown> = { vin: body.vin, generatedAt: ctx.iso() };
    if (body.scope.includes('FEATURE_STATE')) data.featureState = (status?.features ?? []).map((f: any) => ({ featureId: f.featureId, state: f.state, reportSeq: f.reportSeq, updatedAt: f.updatedAt }));
    if (body.scope.includes('FEATURE_HISTORY')) {
      data.statusHistory = (status?.recent ?? []).filter((r: any) => r.accepted !== false).map((r: any) => ({ featureId: r.featureId, state: r.state, requestResult: null, reason: null, observedAt: null, receivedAt: r.at }));
      data.commands = [];
    }
    const exportHash = 'sha256:' + (await sha256(JSON.stringify(data)));
    const counts = { featureState: (data.featureState as unknown[] | undefined)?.length ?? 0, statusHistory: (data.statusHistory as unknown[] | undefined)?.length ?? 0, commands: (data.commands as unknown[] | undefined)?.length ?? 0 };
    const at = ctx.iso();
    ctx.state<any[]>('dataAccess', () => []).unshift({ requestId, vin: body.vin, status: 'FULFILLED', at, requester: body.requester, thirdParty: body.thirdParty, userAuthorizationRef: body.userAuthorizationRef, scope: body.scope, handledBy: ctx.actor.id, exportHash, counts });
    ctx.audit({ action: 'DATA_ACCESS_REQUEST', target: requestId, after: { vin: body.vin, requester: body.requester, thirdParty: body.thirdParty?.id ?? null, scope: body.scope, exportHash, counts }, componentId: 'D05-01' });
    ctx.emit('data.access.fulfilled', requestId, { requestId, requester: body.requester, scope: body.scope }, { componentId: 'D05-01' });
    return { requestId, status: 'FULFILLED' as const, exportHash, data };
  },
  { body: DataAccessRequestBody },
);
registerSimHandler(
  'recordDataActContractBasis',
  async (ctx) => {
    const body = ctx.req.body as { ref: string; note: string };
    const row = { ...body, recordedBy: ctx.actor.id, recordedAt: ctx.iso() };
    ctx.state<any[]>('contractBasis', () => []).unshift(row);
    ctx.audit({ action: 'DATA_ACT_CONTRACT_BASIS', target: body.ref, after: body, componentId: 'D05-01' });
    return row;
  },
  { body: ContractBasisBody },
);

registerSimHandler(
  'submitTms',
  async (ctx) => {
    const id = ctx.req.params.id;
    const r = await ctx.read<any>('virtualRunDetail', { id }).catch(() => null);
    if (!r) return ctx.fail('NOT_FOUND', `가상검증 ${id}을(를) 찾을 수 없습니다.`);
    if (r.source !== 'carla') ctx.fail('GUARD_FAILED', 'CARLA 실행기가 실제로 실행한 결과만 TMS에 제출할 수 있습니다.', undefined, { action: 'TMS_SUBMIT', target: id, reason: r.source === 'vecu' ? '이전 실행기 기록 제출 시도' : '실행기 미연결 결과 제출 시도', componentId: 'D04-02' });
    if (r.role === 'BASELINE_REMOTE') ctx.fail('GUARD_FAILED', '비교 기준선 실행은 TMS 제출 대상이 아닙니다 — 기록·비교 표시만 합니다.', undefined, { action: 'TMS_SUBMIT', target: id, reason: '비교 기준선 제출 시도', componentId: 'D04-02' });
    if (r.tms) return r;
    // IF-09 모의 TMS — 같은 실행이면 같은 제출 번호(멱등 키 = 실행 ID)
    const seq = ctx.state<Record<string, string>>('tmsIds', () => ({}));
    const tmsId = (seq[id] ??= `TMS-${String(Object.keys(seq).length + 1).padStart(5, '0')}`);
    const next = { ...r, tms: { tmsId, submittedAt: ctx.iso(), by: ctx.actor.id } };
    ctx.put('virtualRun', id, next);
    ctx.audit({ action: 'TMS_SUBMIT', target: id, after: { tmsId, testId: r.testId, gateResult: r.gateResult }, componentId: 'D04-02' });
    ctx.emit('tms.evidence.submitted', id, { runId: id, tmsId, testId: r.testId, featureId: r.featureId, featureVersion: r.featureVersion, gateResult: r.gateResult }, { componentId: 'D04-02' });
    return next;
  },
  { body: EmptyBody },
);

// 26580 feature catalogue 트리·bill-of-features·제품 구성기·공유 자산 추적(docs/20-architecture/20-60 §4 G1·G3~G9).
// member product = Catalog 상품(CAT, D-26580-3). bill-of-features = 상품이 고른 확정 Baseline의 Feature → 대표 기준 행(카탈로그 feature).
// 카탈로그 제약 위반은 이 판정의 FAIL이지만 상품 승인(productTransition)을 막지 않는다(D-26580-2) — 상품 승인은 validateComposition 그대로.
import type { FeatureVariability } from '../../schemas/ple';
import { validateComposition, type BaselineRef, type CompositionInput, type CompositionIssue, type CompositionResult } from '../catalog';
import { catalogueParentOf, latestByFeature, proposeVariability, type PleFeature, type PleRef } from './autofill';

export type CatalogueCode = 'REF_REQUIRES_MISSING' | 'REF_EXCLUDES_CONFLICT' | 'SUB_WITHOUT_PRIMARY' | 'ALTERNATIVE_MULTI' | 'NO_CATALOGUE_LINK';

export interface BofIssue {
  code: CatalogueCode | CompositionIssue['code'];
  severity: 'FAIL' | 'WARN';
  message: string;
  refs: string[];
  /** 카탈로그 제약(26580 3.6)인지, 기존 상품 구성 규칙인지 */
  origin: 'CATALOGUE' | 'COMPOSITION';
  suggest?: string[];
}

export interface BofSelection {
  baselineId: string;
  featureId: string;
  version: string;
  name: string;
  lifecycle: string;
  primaryRefId: string | null;
  refName: string | null;
  includedRefIds: string[];
  catalogueRole: 'PRIMARY' | 'SUB';
  parentRefId: string | null;
  variability: FeatureVariability['variability'];
  featureType: FeatureVariability['featureType'];
}

export interface BillOfFeatures {
  product: { catalogId?: string; version?: string; name?: string; country: string; vehicleModel: string; trim: string };
  result: 'PASS' | 'FAIL';
  selections: BofSelection[];
  /** 고른 기준 행(대표 + 포함) — 26580 bill-of-features의 feature 집합 */
  selectedRefIds: string[];
  issues: BofIssue[];
  composition: CompositionResult;
}

const key = (id: string, ver: string) => `${id}@${ver}`;
const primaryOf = (f: Pick<PleFeature, 'featureRefs'> | undefined) => f?.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId ?? null;

export interface BofInput {
  product: CompositionInput['product'] & { catalogId?: string; version?: string; name?: string };
  baselines: Map<string, BaselineRef> | Record<string, BaselineRef>;
  dependencies: CompositionInput['dependencies'];
  carriedOver?: string[];
  /** `${featureId}@${version}` → Feature(기준 행 연결) */
  features: ReadonlyMap<string, PleFeature>;
  refsById: ReadonlyMap<string, PleRef>;
  /** 저장된 변이 프로필 — 없으면 대표 기준 행에서 제안 */
  variabilities?: ReadonlyMap<string, FeatureVariability>;
}

/** 묶음 대표 행 찾기 — 카탈로그 상위 계산용 */
export function bundleRepFinder(refsById: ReadonlyMap<string, PleRef>): (bundleId: string) => string | undefined {
  const reps = new Map<string, string>();
  for (const r of refsById.values()) if (r.bundleId && r.bundleRep && !reps.has(r.bundleId)) reps.set(r.bundleId, r.refId);
  return (b) => reps.get(b);
}

/** Feature 변이 프로필 — 저장값이 있으면 그것, 없으면 대표 기준 행 제안 */
export function variabilityOf(f: PleFeature, refsById: ReadonlyMap<string, PleRef>, stored?: ReadonlyMap<string, FeatureVariability>, repOf = bundleRepFinder(refsById)): FeatureVariability | null {
  const s = stored?.get(key(f.featureId, f.version));
  if (s) return s;
  const ref = refsById.get(primaryOf(f) ?? '');
  return ref ? proposeVariability(ref, { controlPoints: f.controlPoints, swIds: f.swIds, bundleRepOf: repOf }) : null;
}

/** 상품 하나의 bill-of-features + 카탈로그 제약 + 기존 구성 규칙(validateComposition) */
export function billOfFeatures(input: BofInput): BillOfFeatures {
  const composition = validateComposition(input);
  const repOf = bundleRepFinder(input.refsById);
  const selections: BofSelection[] = composition.features.map((b) => {
    const f = input.features.get(key(b.featureId, b.version));
    const pr = primaryOf(f);
    const ref = pr ? input.refsById.get(pr) : undefined;
    const v = f ? variabilityOf(f, input.refsById, input.variabilities, repOf) : null;
    return {
      baselineId: b.baselineId,
      featureId: b.featureId,
      version: b.version,
      name: b.name,
      lifecycle: b.lifecycle,
      primaryRefId: pr,
      refName: ref?.nameKo ?? null,
      includedRefIds: (f?.featureRefs ?? []).filter((l) => l.role !== 'PRIMARY').map((l) => l.refId),
      catalogueRole: v?.catalogueRole ?? 'PRIMARY',
      parentRefId: v?.parentRefId ?? null,
      variability: v?.variability ?? 'OPTIONAL',
      featureType: v?.featureType ?? 'BOOLEAN',
    };
  });
  const issues: BofIssue[] = [...composition.issues.map((i): BofIssue => ({ ...i, origin: 'COMPOSITION' }))];
  issues.push(...checkCatalogueConstraints(selections, input.refsById));
  const selectedRefIds = [...new Set(selections.flatMap((s) => [s.primaryRefId, ...s.includedRefIds].filter((x): x is string => !!x)))].sort();
  return {
    product: { catalogId: input.product.catalogId, version: input.product.version, name: input.product.name, country: input.product.country, vehicleModel: input.product.vehicleModel, trim: input.product.trim },
    result: issues.some((i) => i.severity === 'FAIL') ? 'FAIL' : 'PASS',
    selections,
    selectedRefIds,
    issues,
    composition,
  };
}

/** 카탈로그 제약(26580 3.6) — 기준 행 선행·배타, 하위 feature의 상위, 대안(배타) 둘 이상 */
export function checkCatalogueConstraints(selections: readonly BofSelection[], refsById: ReadonlyMap<string, PleRef>): BofIssue[] {
  const out: BofIssue[] = [];
  const chosen = new Set(selections.flatMap((s) => [s.primaryRefId, ...s.includedRefIds].filter((x): x is string => !!x)));
  for (const s of selections) {
    if (!s.primaryRefId) {
      out.push({ code: 'NO_CATALOGUE_LINK', severity: 'WARN', origin: 'CATALOGUE', message: `${s.featureId}는 기준 행(카탈로그 feature)에 연결되지 않아 카탈로그 제약을 볼 수 없습니다.`, refs: [s.baselineId] });
      continue;
    }
    const ref = refsById.get(s.primaryRefId);
    for (const req of ref?.requires ?? [])
      if (!chosen.has(req)) out.push({ code: 'REF_REQUIRES_MISSING', severity: 'FAIL', origin: 'CATALOGUE', message: `${s.featureId}(${s.primaryRefId})는 기준 행 ${req}${refsById.get(req) ? `(${refsById.get(req)!.nameKo})` : ''}를 선행으로 필요로 하는데 상품에 없습니다.`, refs: [s.baselineId, req] });
    for (const ex of ref?.excludes ?? [])
      if (chosen.has(ex)) out.push({ code: 'REF_EXCLUDES_CONFLICT', severity: 'FAIL', origin: 'CATALOGUE', message: `${s.featureId}(${s.primaryRefId})와 기준 행 ${ex}는 함께 고를 수 없습니다.`, refs: [s.baselineId, ex] });
    if (s.catalogueRole === 'SUB' && s.parentRefId && !chosen.has(s.parentRefId))
      out.push({ code: 'SUB_WITHOUT_PRIMARY', severity: 'WARN', origin: 'CATALOGUE', message: `하위 feature ${s.featureId}의 상위 feature(${s.parentRefId}${refsById.get(s.parentRefId) ? ` ${refsById.get(s.parentRefId)!.nameKo}` : ''})가 상품에 없습니다.`, refs: [s.baselineId, s.parentRefId] });
  }
  const alt = new Map<string, BofSelection[]>();
  for (const s of selections) if (s.variability === 'ALTERNATIVE' && s.parentRefId) alt.set(s.parentRefId, [...(alt.get(s.parentRefId) ?? []), s]);
  for (const [parent, xs] of alt)
    if (xs.length > 1) out.push({ code: 'ALTERNATIVE_MULTI', severity: 'FAIL', origin: 'CATALOGUE', message: `${parent} 아래 대안(배타) feature를 둘 이상 골랐습니다: ${xs.map((x) => x.featureId).join(', ')}.`, refs: xs.map((x) => x.baselineId) });
  return out;
}

// ───────── feature catalogue 트리 ─────────

export interface CatalogueRealization {
  featureId: string;
  version: string;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  lifecycle: string;
  role: 'PRIMARY' | 'INCLUDED';
}

export interface CatalogueFeatureNode {
  refId: string;
  nameKo: string;
  nameEn: string;
  status: string;
  asilRep: string;
  catalogueRole: 'PRIMARY' | 'SUB';
  parentRefId: string | null;
  requires: string[];
  excludes: string[];
  variationPoints: number;
  realizations: CatalogueRealization[];
  children: CatalogueFeatureNode[];
}

export interface CatalogueComponentNode {
  component: string;
  features: CatalogueFeatureNode[];
}

export interface CatalogueDomainNode {
  domain: string;
  components: CatalogueComponentNode[];
  counts: { features: number; subFeatures: number; realizations: number };
}

export interface CatalogueTree {
  domains: CatalogueDomainNode[];
  counts: { domains: number; primary: number; sub: number; realizations: number; constraints: number; variationPoints: number };
}

/** 카탈로그 트리 — Feature가 연결한 기준 행(+ 그 상위 행)만. 도메인 → 컴포넌트 → 주요 feature → 하위 feature, 실현 Feature·제약·변이점 수 */
export function catalogueTree(input: { features: readonly PleFeature[]; refsById: ReadonlyMap<string, PleRef>; variabilities?: ReadonlyMap<string, FeatureVariability> }): CatalogueTree {
  const repOf = bundleRepFinder(input.refsById);
  const latest = latestByFeature(input.features).filter((f) => f.lifecycle !== 'RETIRED');
  const real = new Map<string, CatalogueRealization[]>();
  const vpCount = new Map<string, number>();
  const roleFromFeature = new Map<string, FeatureVariability>();
  for (const f of latest)
    for (const l of f.featureRefs ?? []) {
      real.set(l.refId, [...(real.get(l.refId) ?? []), { featureId: f.featureId, version: f.version, name: f.name, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, lifecycle: f.lifecycle, role: l.role === 'PRIMARY' ? 'PRIMARY' : 'INCLUDED' }]);
      if (l.role === 'PRIMARY') {
        const v = variabilityOf(f, input.refsById, input.variabilities, repOf);
        if (v) {
          vpCount.set(l.refId, (vpCount.get(l.refId) ?? 0) + v.variationPoints.length);
          if (!roleFromFeature.has(l.refId) && input.variabilities?.has(key(f.featureId, f.version))) roleFromFeature.set(l.refId, v);
        }
      }
    }
  // 대표로는 한 번도 쓰이지 않고 포함(INCLUDED)으로만 쓰인 행 = 그 Feature 대표 행의 하위 feature(대표 1 + 포함 N, 30-95 §5.3)
  const asPrimary = new Set(latest.map((f) => primaryOf(f)).filter((x): x is string => !!x));
  const includedUnder = new Map<string, string>();
  for (const f of latest) {
    const p = primaryOf(f);
    if (!p) continue;
    for (const l of f.featureRefs ?? []) if (l.role !== 'PRIMARY' && !asPrimary.has(l.refId) && !includedUnder.has(l.refId) && l.refId !== p) includedUnder.set(l.refId, p);
  }
  // 연결 행 + 상위 행(실현 없이도 트리에 둔다)
  const ids = new Set(real.keys());
  const parentOf = (id: string): string | null => {
    const stored = roleFromFeature.get(id);
    if (stored) return stored.catalogueRole === 'SUB' ? stored.parentRefId : null;
    if (includedUnder.has(id)) return includedUnder.get(id)!;
    const r = input.refsById.get(id);
    return r ? catalogueParentOf(r, repOf) : null;
  };
  for (const id of [...ids]) {
    const p = parentOf(id);
    if (p && input.refsById.has(p)) ids.add(p);
  }
  const nodes = new Map<string, CatalogueFeatureNode>();
  for (const id of ids) {
    const r = input.refsById.get(id);
    if (!r) continue;
    const p = parentOf(id);
    nodes.set(id, {
      refId: id,
      nameKo: r.nameKo,
      nameEn: r.nameEn,
      status: r.status,
      asilRep: r.asilRep,
      catalogueRole: p && ids.has(p) ? 'SUB' : 'PRIMARY',
      parentRefId: p && ids.has(p) ? p : null,
      requires: [...(r.requires ?? [])],
      excludes: [...(r.excludes ?? [])],
      variationPoints: vpCount.get(id) ?? 0,
      realizations: (real.get(id) ?? []).sort((a, b) => a.featureId.localeCompare(b.featureId)),
      children: [],
    });
  }
  for (const n of nodes.values()) if (n.parentRefId) nodes.get(n.parentRefId)?.children.push(n);
  const domains = new Map<string, Map<string, CatalogueFeatureNode[]>>();
  for (const n of nodes.values()) {
    if (n.parentRefId) continue;
    const r = input.refsById.get(n.refId)!;
    const comps = domains.get(r.domain) ?? new Map<string, CatalogueFeatureNode[]>();
    comps.set(r.component, [...(comps.get(r.component) ?? []), n]);
    domains.set(r.domain, comps);
  }
  const sortNodes = (xs: CatalogueFeatureNode[]): CatalogueFeatureNode[] => xs.sort((a, b) => a.refId.localeCompare(b.refId)).map((x): CatalogueFeatureNode => ({ ...x, children: sortNodes(x.children) }));
  const all = [...nodes.values()];
  const tree: CatalogueDomainNode[] = [...domains.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, comps]) => {
      const components = [...comps.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([component, features]) => ({ component, features: sortNodes(features) }));
      const flat = (xs: CatalogueFeatureNode[]): CatalogueFeatureNode[] => xs.flatMap((x) => [x, ...flat(x.children)]);
      const fs = components.flatMap((c) => flat(c.features));
      return { domain, components, counts: { features: fs.filter((x) => x.catalogueRole === 'PRIMARY').length, subFeatures: fs.filter((x) => x.catalogueRole === 'SUB').length, realizations: fs.reduce((n, x) => n + x.realizations.length, 0) } };
    });
  return {
    domains: tree,
    counts: {
      domains: tree.length,
      primary: all.filter((x) => x.catalogueRole === 'PRIMARY').length,
      sub: all.filter((x) => x.catalogueRole === 'SUB').length,
      realizations: all.reduce((n, x) => n + x.realizations.length, 0),
      constraints: all.reduce((n, x) => n + x.requires.length + x.excludes.length, 0),
      variationPoints: all.reduce((n, x) => n + x.variationPoints, 0),
    },
  };
}

// ───────── 공유 자산 추적·제품 구성기 ─────────

export type SharedAssetKind = 'SW_COMPONENT' | 'ECU' | 'FLAG' | 'POLICY';

export interface SharedAsset {
  kind: SharedAssetKind;
  asset: string;
  features: { featureId: string; version: string; name: string }[];
  products: string[];
}

export interface PlePolicy {
  policyId: string;
  featureId: string;
  flagKey?: string;
  status: string;
}

/** 공유 자산(superset) ↔ feature — 자산마다 쓰는 Feature(최신 Version)와 그 Feature를 담은 상품 */
export function sharedAssets(input: { features: readonly (PleFeature & { catalogIds?: readonly string[] })[]; policies?: readonly PlePolicy[]; productsByFeature?: ReadonlyMap<string, string[]> }): SharedAsset[] {
  const m = new Map<string, SharedAsset>();
  const add = (kind: SharedAssetKind, asset: string, f: PleFeature) => {
    const k = `${kind}|${asset}`;
    const a = m.get(k) ?? { kind, asset, features: [], products: [] };
    if (!a.features.some((x) => x.featureId === f.featureId)) a.features.push({ featureId: f.featureId, version: f.version, name: f.name });
    for (const p of input.productsByFeature?.get(f.featureId) ?? []) if (!a.products.includes(p)) a.products.push(p);
    m.set(k, a);
  };
  const latest = latestByFeature(input.features).filter((f) => f.lifecycle !== 'RETIRED');
  const byId = new Map(latest.map((f) => [f.featureId, f]));
  for (const f of latest) {
    for (const s of f.swIds ?? []) add('SW_COMPONENT', s, f);
    for (const e of f.ecuPnos ?? []) add('ECU', e, f);
  }
  for (const p of input.policies ?? []) {
    const f = byId.get(p.featureId);
    if (!f) continue;
    add('POLICY', p.policyId, f);
    if (p.flagKey) add('FLAG', p.flagKey, f);
  }
  const rank: Record<SharedAssetKind, number> = { SW_COMPONENT: 0, ECU: 1, FLAG: 2, POLICY: 3 };
  return [...m.values()]
    .map((a) => ({ ...a, features: a.features.sort((x, y) => x.featureId.localeCompare(y.featureId)), products: a.products.sort() }))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.features.length - a.features.length || a.asset.localeCompare(b.asset));
}

export interface ProductConfiguration {
  bill: BillOfFeatures;
  /** product asset instance(3.14) 미리 보기 */
  instances: {
    swComponents: { swId: string; versions: string[]; ecuPnos: string[]; features: string[] }[];
    flags: { flagKey: string; featureId: string; value: 'ON' | 'OFF'; source: 'POLICY' | 'VARIATION_POINT' }[];
    policies: { policyId: string; featureId: string; status: string }[];
    variationPoints: { featureId: string; vpId: string; assetKind: string; asset: string; resolved: string }[];
  };
}

/** 제품 구성기(3.12) 미리 보기 — bill-of-features로 같은 범위 공유 자산의 변이점을 행사한다. 선택한 Feature는 켬, 같은 범위의 고르지 않은 Feature는 끔. 저장하지 않는다 */
export function configureProduct(input: BofInput & { policies?: readonly PlePolicy[]; allFeatures?: readonly (PleFeature & { swVersions?: readonly string[] })[] }): ProductConfiguration {
  const bill = billOfFeatures(input);
  const repOf = bundleRepFinder(input.refsById);
  const selected = new Set(bill.selections.map((s) => s.featureId));
  const p = input.product;
  const sameScope = latestByFeature(input.allFeatures ?? [...input.features.values()]).filter((f) => f.country === p.country && f.vehicleModel === p.vehicleModel && f.trim === p.trim && f.lifecycle !== 'RETIRED');
  const sw = new Map<string, { swId: string; versions: Set<string>; ecuPnos: Set<string>; features: Set<string> }>();
  const vps: ProductConfiguration['instances']['variationPoints'] = [];
  const flags: ProductConfiguration['instances']['flags'] = [];
  for (const s of bill.selections) {
    const f = input.features.get(key(s.featureId, s.version)) as (PleFeature & { swVersions?: readonly string[] }) | undefined;
    if (!f) continue;
    (f.swIds ?? []).forEach((id, i) => {
      const e = sw.get(id) ?? { swId: id, versions: new Set<string>(), ecuPnos: new Set<string>(), features: new Set<string>() };
      if (f.swVersions?.[i]) e.versions.add(f.swVersions[i]);
      for (const ecu of f.ecuPnos ?? []) e.ecuPnos.add(ecu);
      e.features.add(f.featureId);
      sw.set(id, e);
    });
  }
  for (const f of sameScope) {
    const on = selected.has(f.featureId);
    const chosen = bill.selections.find((s) => s.featureId === f.featureId);
    const ff = chosen ? input.features.get(key(chosen.featureId, chosen.version)) ?? f : f;
    const v = variabilityOf(ff, input.refsById, input.variabilities, repOf);
    for (const vp of v?.variationPoints ?? []) vps.push({ featureId: f.featureId, vpId: vp.vpId, assetKind: vp.assetKind, asset: vp.asset, resolved: on ? `선택 — ${vp.mapping.split('·')[0].trim()}` : '미선택 — 기본(끔·제외)' });
    const policy = (input.policies ?? []).find((x) => x.featureId === f.featureId && x.flagKey);
    if (policy?.flagKey) flags.push({ flagKey: policy.flagKey, featureId: f.featureId, value: on ? 'ON' : 'OFF', source: 'POLICY' });
    else { const fv = v?.variationPoints.find((x) => x.assetKind === 'FLAG'); if (fv) flags.push({ flagKey: fv.asset.replace(/^flag:/, ''), featureId: f.featureId, value: on ? 'ON' : 'OFF', source: 'VARIATION_POINT' }); }
  }
  return {
    bill,
    instances: {
      swComponents: [...sw.values()].map((e) => ({ swId: e.swId, versions: [...e.versions].sort(), ecuPnos: [...e.ecuPnos].sort(), features: [...e.features].sort() })).sort((a, b) => a.swId.localeCompare(b.swId)),
      flags: flags.sort((a, b) => (a.value === b.value ? a.featureId.localeCompare(b.featureId) : a.value === 'ON' ? -1 : 1)),
      policies: (input.policies ?? []).filter((x) => selected.has(x.featureId)).map((x) => ({ policyId: x.policyId, featureId: x.featureId, status: x.status })).sort((a, b) => a.policyId.localeCompare(b.policyId)),
      variationPoints: vps,
    },
  };
}

// ISO/IEC 26580 feature 기반 PLE(docs/20-architecture/20-60) — 등록 자동 채움·기준 행 추천·등록 현황·카탈로그 트리·bill-of-features·제품 구성기·공유 자산.
// 규칙은 모두 contracts(rules/ple)의 순수 함수 — 여기서는 저장소에서 입력을 모으고 결과를 돌려준다. 저장은 등록·초안 수정(record*)만 한다.
import { Inject, Injectable } from '@nestjs/common';
import {
  autofillDecisions,
  autofillFromRef,
  billOfFeatures,
  bundleRepFinder,
  catalogueTree,
  configureProduct,
  FeatureVariability,
  latestByFeature,
  proposeVariability,
  ruleFor,
  sharedAssets,
  suggestRefsFromText,
  variabilityOf,
  type AutofillResult,
  type BofInput,
  type CreateFeatureBody,
  type FeatureRefRow,
  type FeatureVersionRow,
  type PleRef,
  type PleScope,
  type ProductRow,
  type UpdateDraftBody,
  type ValidateCompositionBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { CatalogService } from '../catalog/catalog.service';
import { PolicyRepo } from '../policy-repos';
import { RefdbRepository } from '../refdb/refdb.repository';
import { FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from '../repos';
import { PleRepo, type VariabilitySource } from './ple.repo';

const key = (id: string, ver: string) => `${id}@${ver}`;
/** 정의 승인(PROPOSED → APPROVED) 필수 칸 — contracts 수명주기 규칙 그대로 */
const PROPOSAL_INPUTS_KEYS = ruleFor('PROPOSED', 'APPROVED')?.inputs ?? [];
const primaryOf = (f: Pick<FeatureVersionRow, 'featureRefs'>) => f.featureRefs?.find((l) => l.role === 'PRIMARY')?.refId;
/** 등록 진행 단계 — 화면 단계 표시와 같은 순서(① 고르기 ② 자동 채움 확인 ③ 제출 ④ 검토 ⑤ 정의 승인) */
export const REGISTRATION_STAGES = ['PICK', 'CONFIRM', 'SUBMITTED', 'REVIEW', 'APPROVAL'] as const;

@Injectable()
@PlatformComponent('D01-01')
export class PleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: PleRepo,
    private readonly refdb: RefdbRepository,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly products: ProductRepo,
    private readonly topology: TopologyRepo,
    private readonly policies: PolicyRepo,
    private readonly catalog: CatalogService,
    private readonly clock: Clock,
  ) {}

  private refsById(): Map<string, PleRef> {
    return new Map(this.refdb.listRefs().map((r) => [r.refId, r as PleRef]));
  }

  private scopes(): PleScope[] {
    return this.products.all().map((p) => ({ country: p.country, vehicleModel: p.vehicleModel, trim: p.trim }));
  }

  // ───────── 등록 보조 ─────────

  suggestions(q: string) {
    const text = (q ?? '').trim().slice(0, 500);
    return { q: text, items: text.length < 2 ? [] : suggestRefsFromText(text, this.refdb.listRefs() as PleRef[]) };
  }

  autofill(q: { refId?: string; name?: string; country?: string; vehicleModel?: string; trim?: string }): AutofillResult {
    if (!q.refId) throw new DomainError('VALIDATION', '대표 기준 행(refId)을 지정하세요.');
    const refs = this.refsById();
    const r = refs.get(q.refId);
    if (!r) throw new DomainError('NOT_FOUND', `기준 행 ${q.refId}이(가) Feature DB에 없습니다.`);
    const scope = q.country && q.vehicleModel && q.trim ? { country: q.country, vehicleModel: q.vehicleModel, trim: q.trim } : undefined;
    return autofillFromRef(r, { features: this.features.all(), refsById: refs, scopes: this.scopes(), scope, name: q.name });
  }

  /** 등록 트랜잭션 안에서 — 서버가 대표 행으로 자동 채움을 다시 계산하고(클라이언트 출처 주장을 믿지 않는다) 칸별 결정·변이 프로필을 남긴다 */
  recordCreate(actor: Actor, f: FeatureVersionRow, body: CreateFeatureBody, primary: FeatureRefRow, features: readonly FeatureVersionRow[]) {
    const refs = this.refsById();
    const result = autofillFromRef(primary as PleRef, { features, refsById: refs, scopes: this.scopes(), scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, name: f.name });
    const variability = this.checkVariability(body.variability ?? null, refs, primary.refId);
    const rows = autofillDecisions(result, { ...f, refRegulations: f.refRegulations ?? [], variability });
    const at = this.clock.iso();
    this.repo.addDecisions(f.featureId, f.version, rows, actor.id, at);
    const vrow = rows.find((x) => x.field === 'variability')!;
    // 변이점은 등록한 제어점·SW에서 다시 만든다 — 빠진 제어점의 변이점이 남지 않는다(프로필 칸만 사람 값)
    const derived = this.derive(f, refs);
    const stored = { ...(variability ?? derived ?? result.variability), variationPoints: (derived ?? result.variability).variationPoints };
    this.repo.putVariability(f.featureId, f.version, stored, vrow.decision === 'EDITED' ? 'EDITED' : 'AUTO', actor.id, at);
    return { decisions: rows };
  }

  /** 대표 행 제안 프로필 — 지금 제어점·SW로(없으면 null) */
  private derive(f: Pick<FeatureVersionRow, 'featureRefs' | 'controlPoints' | 'swIds'>, refs = this.refsById()): FeatureVariability | null {
    const ref = refs.get(primaryOf(f) ?? '');
    return ref ? proposeVariability(ref, { controlPoints: f.controlPoints, swIds: f.swIds, bundleRepOf: bundleRepFinder(refs) }) : null;
  }

  /**
   * 제어점·SW·대표 행이 바뀐 Version의 프로필 — 자동(AUTO·SEED)이면 다시 제안, 사람이 고친(EDITED) 칸은 그대로 두고 변이점만 제어점을 따른다.
   * 바뀐 것이 없으면 prev 그대로(null = 쓰지 않음).
   */
  private follow(prev: { variability: FeatureVariability; source: VariabilitySource } | undefined, before: FeatureVersionRow, next: FeatureVersionRow) {
    const same = (k: 'controlPoints' | 'swIds') => JSON.stringify(before[k] ?? []) === JSON.stringify(next[k] ?? []);
    if (same('controlPoints') && same('swIds') && primaryOf(before) === primaryOf(next)) return null;
    const derived = this.derive(next);
    if (!derived) return null;
    if (prev?.source === 'EDITED') return { variability: { ...prev.variability, variationPoints: derived.variationPoints }, source: 'EDITED' as const };
    return { variability: derived, source: 'AUTO' as const };
  }

  /** 초안 수정 — 바꾼 칸(이름·설명·ASIL·태그·제어점·변이 프로필·대표 행)만 이력에 더한다 */
  recordUpdate(actor: Actor, before: FeatureVersionRow, next: FeatureVersionRow, body: UpdateDraftBody) {
    const touched = (['name', 'description', 'asil', 'tags', 'controlPoints'] as const).filter((k) => body[k] !== undefined && JSON.stringify(before[k]) !== JSON.stringify(next[k]));
    const at = this.clock.iso();
    const rows = touched.map((field) => ({ field, sourceKind: null, sourceRef: null, suggested: before[field], final: next[field], decision: 'EDITED' as const }));
    if (body.featureRefs !== undefined && primaryOf(before) !== primaryOf(next)) rows.push({ field: 'primaryRef', sourceKind: null, sourceRef: null, suggested: primaryOf(before) ?? null, final: primaryOf(next) ?? null, decision: 'EDITED' as const } as never);
    const stored = this.repo.variability(next.featureId, next.version);
    if (body.variability) {
      const v = this.checkVariability(body.variability, this.refsById(), primaryOf(next) ?? '')!;
      // 변이점은 제어점에서 — 화면이 보낸 변이점 대신 지금 제어점으로 만든 것
      const withVps = { ...v, variationPoints: this.derive(next)?.variationPoints ?? v.variationPoints };
      const prev = stored?.variability ?? null;
      if (JSON.stringify(prev) !== JSON.stringify(withVps)) {
        rows.push({ field: 'variability', sourceKind: null, sourceRef: null, suggested: prev, final: withVps, decision: 'EDITED' } as never);
        this.repo.putVariability(next.featureId, next.version, withVps, 'EDITED', actor.id, at);
      }
    } else {
      const f = this.follow(stored, before, next);
      if (f) this.repo.putVariability(next.featureId, next.version, f.variability, f.source, actor.id, at);
    }
    if (rows.length) this.repo.addDecisions(next.featureId, next.version, rows, actor.id, at);
  }

  /** 새 Version은 기준 Version의 변이 프로필을 잇는다(바꾸면 EDITED, 제어점이 바뀌면 recordUpdate와 같은 규칙) */
  recordVersion(actor: Actor, base: FeatureVersionRow, next: FeatureVersionRow, variability?: FeatureVariability) {
    const prev = this.repo.variability(base.featureId, base.version);
    const at = this.clock.iso();
    if (variability) {
      const v = this.checkVariability(variability, this.refsById(), primaryOf(next) ?? '')!;
      this.repo.putVariability(next.featureId, next.version, { ...v, variationPoints: this.derive(next)?.variationPoints ?? v.variationPoints }, 'EDITED', actor.id, at);
      return;
    }
    const f = this.follow(prev, base, next);
    if (f) this.repo.putVariability(next.featureId, next.version, f.variability, f.source, actor.id, at);
    else if (prev) this.repo.putVariability(next.featureId, next.version, prev.variability, prev.source, actor.id, at);
  }

  /** 상위 feature는 Feature DB에 있는 다른 행이어야 한다 */
  private checkVariability(v: FeatureVariability | null, refs: Map<string, PleRef>, ownRef: string): FeatureVariability | null {
    if (!v) return null;
    const p = FeatureVariability.safeParse(v);
    if (!p.success) throw new DomainError('VALIDATION', p.error.issues[0]?.message ?? '변이 프로필이 올바르지 않습니다.', { field: 'variability' });
    if (p.data.parentRefId && (!refs.has(p.data.parentRefId) || p.data.parentRefId === ownRef))
      throw new DomainError('VALIDATION', `상위 feature ${p.data.parentRefId}은(는) Feature DB의 다른 기준 행이어야 합니다.`, { field: 'variability.parentRefId' });
    return p.data;
  }

  variabilityView(featureId: string, version: string) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId}@${version}이(가) 없습니다.`);
    const stored = this.repo.variability(featureId, version);
    const refs = this.refsById();
    const proposed = variabilityOf(f, refs);
    return { featureId, version, variability: stored?.variability ?? proposed, source: stored?.source ?? (proposed ? 'PROPOSED' : null), updatedBy: stored?.updatedBy ?? null, updatedAt: stored?.updatedAt ?? null, history: this.repo.history(featureId, version) };
  }

  /** 진행 중인 등록(PROPOSED, Feature마다 최신) — 단계·Gate·정의 승인 필수 칸·자동 채움 수. 내 등록 먼저 */
  registrations(actor: Actor) {
    const latest = latestByFeature(this.features.all()).filter((f) => f.lifecycle === 'PROPOSED');
    const statuses = this.gates.latestStatuses(latest.map((f) => ({ featureId: f.featureId, version: f.version })));
    const counts = this.repo.decisionCounts();
    const refs = this.refsById();
    const items = latest.map((f) => {
      const g = statuses.get(key(f.featureId, f.version)) ?? {};
      const gates = { G1: g.G1 ?? null, G2: g.G2 ?? null, G3: g.G3 ?? null };
      const missing = PROPOSAL_INPUTS_KEYS.filter((k) => { const v = f[k]; return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length); });
      const allPass = Object.values(gates).every((x) => x === 'PASS');
      const judged = Object.values(gates).some((x) => !!x);
      const stage = allPass && !missing.length ? 'APPROVAL' : judged ? 'REVIEW' : 'SUBMITTED';
      const meta = this.features.meta(f.featureId, f.version);
      const p = primaryOf(f);
      return {
        featureId: f.featureId,
        version: f.version,
        name: f.name,
        country: f.country,
        vehicleModel: f.vehicleModel,
        trim: f.trim,
        asil: f.asil,
        createdBy: meta.createdBy,
        createdAt: meta.createdAt,
        primaryRef: p ? { refId: p, nameKo: refs.get(p)?.nameKo ?? null } : null,
        gates,
        missing,
        stage,
        stageIndex: REGISTRATION_STAGES.indexOf(stage),
        autofill: counts.get(key(f.featureId, f.version)) ?? null,
        mine: meta.createdBy === actor.id,
      };
    });
    items.sort((a, b) => Number(b.mine) - Number(a.mine) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.featureId.localeCompare(a.featureId));
    return { stages: REGISTRATION_STAGES, items, mine: items.filter((x) => x.mine).length };
  }

  // ───────── 카탈로그·bill-of-features·구성기·공유 자산 ─────────

  catalogue() {
    return catalogueTree({ features: this.features.all(), refsById: this.refsById(), variabilities: this.repo.allVariabilities() });
  }

  private bofInput(product: Pick<ProductRow, 'country' | 'vehicleModel' | 'trim' | 'type' | 'baselineIds' | 'validFrom' | 'validTo'> & { catalogId?: string; version?: string; name?: string; lifecycle?: string }, ctx = this.ctx()): BofInput {
    const carriedOver = product.lifecycle && product.lifecycle !== 'PROPOSED' ? product.baselineIds : [];
    return { product, baselines: ctx.baselines, dependencies: ctx.dependencies, carriedOver, features: ctx.featureMap, refsById: ctx.refs, variabilities: ctx.variabilities };
  }

  private ctx() {
    const all = this.features.all();
    return { all, featureMap: new Map(all.map((f) => [key(f.featureId, f.version), f])), refs: this.refsById(), variabilities: this.repo.allVariabilities(), baselines: this.catalog.baselineRefs(), dependencies: this.topology.all() };
  }

  portfolio() {
    const ctx = this.ctx();
    // 상품마다 최신 Version
    const latest = new Map<string, ProductRow>();
    for (const p of this.products.all()) { const cur = latest.get(p.catalogId); if (!cur || cmpVer(p.version, cur.version) > 0) latest.set(p.catalogId, p); }
    const items = [...latest.values()]
      .sort((a, b) => a.catalogId.localeCompare(b.catalogId))
      .map((p) => {
        const b = billOfFeatures(this.bofInput(p, ctx));
        return { catalogId: p.catalogId, version: p.version, name: p.name, lifecycle: p.lifecycle, type: p.type, country: p.country, vehicleModel: p.vehicleModel, trim: p.trim, result: b.result, features: b.selections.length, refs: b.selectedRefIds, primaryRefs: b.selections.map((s) => s.primaryRefId).filter((x): x is string => !!x), fails: b.issues.filter((i) => i.severity === 'FAIL').length, warns: b.issues.filter((i) => i.severity === 'WARN').length, catalogueIssues: b.issues.filter((i) => i.origin === 'CATALOGUE').length };
      });
    const refIds = [...new Set(items.flatMap((i) => i.primaryRefs))].sort();
    const names = Object.fromEntries(refIds.map((id) => [id, ctx.refs.get(id)?.nameKo ?? id]));
    return { items, refIds, refNames: names, counts: { products: items.length, fail: items.filter((i) => i.result === 'FAIL').length, features: refIds.length } };
  }

  bill(catalogId: string, version: string) {
    const p = this.products.get(catalogId, version);
    if (!p) throw new DomainError('NOT_FOUND', `상품 ${catalogId}@${version}이(가) 없습니다.`);
    return billOfFeatures(this.bofInput(p));
  }

  check(body: ValidateCompositionBody) {
    return billOfFeatures({ ...this.bofInput(body), carriedOver: body.carriedOver });
  }

  configure(catalogId: string, version: string) {
    const p = this.products.get(catalogId, version);
    if (!p) throw new DomainError('NOT_FOUND', `상품 ${catalogId}@${version}이(가) 없습니다.`);
    const ctx = this.ctx();
    return configureProduct({ ...this.bofInput(p, ctx), policies: this.policyRows(), allFeatures: ctx.all });
  }

  private policyRows() {
    return this.policies.all().filter((x) => x.status !== 'RETIRED' && x.status !== 'REJECTED').map((x) => ({ policyId: x.policyId, featureId: x.featureId, flagKey: x.flagKey, status: x.status }));
  }

  assets() {
    const productsByFeature = new Map<string, string[]>();
    const baselines = this.catalog.baselineRefs();
    for (const p of this.products.all())
      for (const b of p.baselineIds) {
        const fid = baselines.get(b)?.featureId;
        if (fid && !(productsByFeature.get(fid) ?? []).includes(p.catalogId)) productsByFeature.set(fid, [...(productsByFeature.get(fid) ?? []), p.catalogId]);
      }
    const items = sharedAssets({ features: this.features.all(), policies: this.policyRows(), productsByFeature });
    const by = (k: string) => items.filter((i) => i.kind === k).length;
    return { items, counts: { total: items.length, swComponents: by('SW_COMPONENT'), ecus: by('ECU'), flags: by('FLAG'), policies: by('POLICY'), shared: items.filter((i) => i.features.length > 1).length } };
  }
}

function cmpVer(a: string, b: string) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

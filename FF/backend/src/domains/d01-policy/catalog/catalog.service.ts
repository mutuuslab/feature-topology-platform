// Feature Catalog (D01-03) — 상품 마스터·상품 Version·구성 Baseline (상세설계서 §4, 표 21·22).
// Feature 정의·BOM 스냅샷은 참조만. Feature 상태 변화는 상품 상태를 자동으로 바꾸지 않는다(다음 상품 전이 때 확인).
import { Inject, Injectable } from '@nestjs/common';
import {
  BASELINE_ELIGIBLE,
  bumpVersion,
  evaluateProductGuards,
  PRODUCT_TRANSITIONS,
  productRuleFor,
  validateComposition,
  type BaselineRef,
  type CompositionResult,
  type CreateProductBody,
  type CreateProductVersionBody,
  type Lifecycle,
  type ProductRow,
  type UpdateProductDraftBody,
  type ValidateCompositionBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { BaselineRepo, FeatureRepo, ProductRepo, TopologyRepo } from '../repos';

@Injectable()
@PlatformComponent('D01-03')
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductRepo,
    private readonly baselines: BaselineRepo,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  /** 확정 Baseline → 구성 검증 입력 (Feature의 현재 Lifecycle 포함) */
  private refs(): Map<string, BaselineRef> {
    const m = new Map<string, BaselineRef>();
    for (const b of this.baselines.all()) {
      const f = this.features.get(b.featureId, b.version);
      m.set(b.baselineId, { baselineId: b.baselineId, featureId: b.featureId, version: b.version, name: b.snapshot.name, lifecycle: f?.lifecycle ?? b.snapshot.lifecycle, country: b.snapshot.country, vehicleModel: b.snapshot.vehicleModel, trim: b.snapshot.trim });
    }
    return m;
  }

  validate(body: ValidateCompositionBody): CompositionResult {
    return validateComposition({ product: body, baselines: this.refs(), dependencies: this.topology.all(), carriedOver: body.carriedOver });
  }

  private compositionOf(p: ProductRow): CompositionResult {
    // 이미 구성 승인을 받은 Version은 기존 구성 유지 허용 (DEPRECATED Feature 포함 가능 — 신규 선택만 금지)
    const carriedOver = p.lifecycle === 'PROPOSED' ? [] : p.baselineIds;
    return validateComposition({ product: p, baselines: this.refs(), dependencies: this.topology.all(), carriedOver });
  }

  list(q: { q?: string; lifecycle?: string; saleType?: string; country?: string } = {}) {
    const needle = q.q?.trim().toLowerCase();
    return this.products
      .all()
      .filter((p) => !q.lifecycle || p.lifecycle === q.lifecycle)
      .filter((p) => !q.saleType || p.saleType === q.saleType)
      .filter((p) => !q.country || p.country === q.country)
      .filter((p) => !needle || [p.catalogId, p.name, p.ownerId, ...p.tags].some((s) => s.toLowerCase().includes(needle)))
      .map((p) => ({ ...p, featureCount: p.baselineIds.length }));
  }

  /** BOM 후보 — 범위가 같고 확정 Baseline이 있는 APPROVED~RELEASED Feature Version만 */
  candidates(q: { country: string; vehicleModel: string; trim: string; q?: string }) {
    const needle = q.q?.trim().toLowerCase();
    const latestBl = new Map<string, string>();
    const refs = [...this.refs().values()].filter((r) => r.country === q.country && r.vehicleModel === q.vehicleModel && r.trim === q.trim);
    for (const r of refs) latestBl.set(r.featureId, r.baselineId); // refs는 BL ID 오름차순 → 마지막이 최신
    return refs
      .filter((r) => BASELINE_ELIGIBLE.includes(r.lifecycle))
      .filter((r) => !needle || `${r.featureId} ${r.name}`.toLowerCase().includes(needle))
      .map((r) => ({ ...r, latest: latestBl.get(r.featureId) === r.baselineId, requires: this.topology.outgoing(r.featureId, r.version).filter((d) => d.type === 'REQUIRES').map((d) => `${d.targetFeatureId}@${d.targetVersion}`) }));
  }

  detail(catalogId: string, version: string) {
    const p = this.products.get(catalogId, version);
    if (!p) throw new DomainError('NOT_FOUND', `${catalogId} ${version}을(를) 찾을 수 없습니다.`);
    const composition = this.compositionOf(p);
    return {
      product: p,
      meta: this.products.meta(catalogId, version),
      composition,
      eligibility: this.eligibility(p, composition),
      transitions: PRODUCT_TRANSITIONS.filter((r) => r.from === p.lifecycle && !r.auto).map((r) => ({ to: r.to, ko: r.ko, approval: r.approval ?? null, blockers: this.guardsFor(p, r.to, composition) })),
      versions: this.products.versions(catalogId).map((v) => ({ version: v.version, lifecycle: v.lifecycle })),
    };
  }

  /** 출시 적격성 (표 22) — RELEASED 가능/불가와 사유 */
  eligibility(p: ProductRow, composition = this.compositionOf(p)) {
    const rule = productRuleFor('VERIFIED', 'RELEASED')!;
    const reasons = evaluateProductGuards(rule, { composition, today: this.today(), validFrom: p.validFrom, validTo: p.validTo });
    return { eligible: reasons.length === 0, reasons };
  }

  private today() {
    return this.clock.kst().slice(0, 10);
  }

  private guardsFor(p: ProductRow, to: Lifecycle, composition: CompositionResult): string[] {
    const rule = productRuleFor(p.lifecycle, to);
    if (!rule) return [`${p.lifecycle} → ${to} 전이는 정의되어 있지 않습니다.`];
    return evaluateProductGuards(rule, { composition, today: this.today(), validFrom: p.validFrom, validTo: p.validTo });
  }

  create(actor: Actor, body: CreateProductBody) {
    const dup = this.products.all().find((x) => x.name === body.name && x.country === body.country && x.vehicleModel === body.vehicleModel && x.trim === body.trim);
    if (dup) throw new DomainError('CONFLICT', `같은 범위에 같은 상품 ${dup.catalogId}이(가) 있습니다 — 구성 변경은 새 Catalog Version으로 하세요.`, { catalogId: dup.catalogId });
    const p: ProductRow = { catalogId: this.products.nextCatalogId(), version: '1.0.0', lifecycle: 'PROPOSED', ...body, _missing: {} };
    const comp = validateComposition({ product: p, baselines: this.refs(), dependencies: this.topology.all() });
    return this.db.tx(() => {
      this.products.insert(p, actor.id, this.clock.iso());
      const target = `${p.catalogId}@${p.version}`;
      this.audit.record(actor, 'PRODUCT_CREATE', target, { after: p, componentId: 'D01-03' });
      this.events.publish('product.created', target, { catalogId: p.catalogId, version: p.version, composition: comp.result }, { componentId: 'D01-03', correlationId: actor.correlationId });
      return { product: p, composition: comp };
    });
  }

  updateDraft(actor: Actor, catalogId: string, version: string, body: UpdateProductDraftBody) {
    const p = this.products.get(catalogId, version);
    if (!p) throw new DomainError('NOT_FOUND', `${catalogId} ${version}을(를) 찾을 수 없습니다.`);
    if (p.lifecycle !== 'PROPOSED') {
      this.audit.failed(actor, 'PRODUCT_UPDATE', `${catalogId}@${version}`, `${p.lifecycle} 상품 수정 시도`, 'D01-03');
      throw new DomainError('IMMUTABLE', `${p.lifecycle} 상품은 직접 수정할 수 없습니다. 새 Catalog Version을 만드세요.`);
    }
    return this.db.tx(() => {
      const next = { ...p, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) } as ProductRow;
      this.products.update(next);
      this.audit.record(actor, 'PRODUCT_UPDATE', `${catalogId}@${version}`, { before: p, after: next, componentId: 'D01-03' });
      return { product: next, composition: this.compositionOf(next) };
    });
  }

  createVersion(actor: Actor, catalogId: string, body: CreateProductVersionBody) {
    const base = this.products.get(catalogId, body.baseVersion);
    if (!base) throw new DomainError('NOT_FOUND', `${catalogId} ${body.baseVersion}을(를) 찾을 수 없습니다.`);
    const latest = this.products.versions(catalogId).at(-1)!.version;
    const p: ProductRow = { ...base, ...Object.fromEntries(Object.entries(body.changes).filter(([, v]) => v !== undefined)), version: bumpVersion(latest, body.bump), lifecycle: 'PROPOSED' } as ProductRow;
    return this.db.tx(() => {
      this.products.insert(p, actor.id, this.clock.iso());
      const target = `${catalogId}@${p.version}`;
      this.audit.record(actor, 'PRODUCT_VERSION_CREATE', target, { before: { baseVersion: base.version }, after: p, reason: body.reason, componentId: 'D01-03' });
      this.events.publish('product.version.created', target, { catalogId, version: p.version, baseVersion: base.version }, { componentId: 'D01-03', correlationId: actor.correlationId });
      return { product: p, composition: validateComposition({ product: p, baselines: this.refs(), dependencies: this.topology.all() }) };
    });
  }

  transition(actor: Actor, catalogId: string, version: string, to: Lifecycle, reason: string) {
    const p = this.products.get(catalogId, version);
    if (!p) throw new DomainError('NOT_FOUND', `${catalogId} ${version}을(를) 찾을 수 없습니다.`);
    const target = `${catalogId}@${version}`;
    const action = `PRODUCT_TRANSITION ${p.lifecycle}→${to}`;
    const rule = productRuleFor(p.lifecycle, to);
    const meta = this.products.meta(catalogId, version);
    const fail = (code: 'GUARD_FAILED' | 'FORBIDDEN' | 'SEPARATION_OF_DUTY' | 'VALIDATION', msg: string, details?: unknown): never => {
      this.audit.failed(actor, action, target, msg, 'D01-03');
      throw new DomainError(code, msg, details);
    };
    if (!rule) fail('GUARD_FAILED', `${p.lifecycle} → ${to} 전이는 정의되어 있지 않습니다.`);
    if (!rule!.roles.includes(actor.role)) fail('FORBIDDEN', `이 전이는 ${rule!.roles.join(', ')} 역할만 할 수 있습니다.`);
    if (!reason.trim()) fail('VALIDATION', '전이 사유를 입력하세요.');
    if (rule!.approval && meta.createdBy === actor.id) fail('SEPARATION_OF_DUTY', '상품 작성자는 자기 상품을 승인할 수 없습니다.');
    if (rule!.approval === 'RELEASE' && meta.configApprovedBy === actor.id) fail('SEPARATION_OF_DUTY', '구성 승인자와 고객 출시 승인자는 달라야 합니다.');
    const composition = this.compositionOf(p);
    const blockers = this.guardsFor(p, to, composition);
    if (blockers.length) fail('GUARD_FAILED', `전이할 수 없습니다: ${blockers.join(' / ')}`, { blockers, composition });

    return this.db.tx(() => {
      let cur = this.apply(actor, p, to, reason);
      if (rule!.approval) this.products.setApprover(catalogId, version, rule!.approval, actor.id);
      // 구성 승인 직후: 아직 RELEASED가 아닌 Feature가 있으면 시스템이 DEVELOPING(출시 대기)로 옮긴다
      const auto = PRODUCT_TRANSITIONS.find((r) => r.from === cur.lifecycle && r.auto);
      if (auto && !evaluateProductGuards(auto, { composition, today: this.today(), validFrom: cur.validFrom, validTo: cur.validTo }).length)
        cur = this.apply({ id: 'system:catalog', role: 'SYSTEM', correlationId: actor.correlationId }, cur, auto.to, `자동 전이: ${auto.ko}`);
      return { product: cur, composition };
    });
  }

  private apply(actor: Actor, p: ProductRow, to: Lifecycle, reason: string): ProductRow {
    const next = { ...p, lifecycle: to };
    this.products.update(next);
    const target = `${p.catalogId}@${p.version}`;
    this.audit.record(actor, `PRODUCT_TRANSITION ${p.lifecycle}→${to}`, target, { before: { lifecycle: p.lifecycle }, after: { lifecycle: to }, reason, componentId: 'D01-03' });
    this.events.publish('product.lifecycle.changed', target, { catalogId: p.catalogId, version: p.version, from: p.lifecycle, to, by: actor.id }, { componentId: 'D01-03', correlationId: actor.correlationId });
    return next;
  }
}

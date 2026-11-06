// Feature Catalog (D01-03) — 상품 마스터·상품 Version·구성 Baseline (상세설계서 §4, 표 21·22).
// Feature 정의·BOM 스냅샷은 참조만. Feature 상태 변화는 상품 상태를 자동으로 바꾸지 않는다(다음 상품 전이 때 확인).
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BASELINE_ELIGIBLE,
  bumpVersion,
  evaluateProductGuards,
  PRODUCT_TRANSITIONS,
  productRuleFor,
  ROLE_LABEL,
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
import { DEMO_FIXTURES } from '../../../kernel/seed';

/** 데이터셋 상품의 승인 이력(data/fixtures/demo/product-approvals.json) — 원천 xlsx에 없는 작성자·구성 승인·고객 출시 승인과 그 시각 */
const ProductApprovalHistory = z
  .object({
    catalogId: z.string().regex(/^CAT-\d{5}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    lifecycle: z.string(),
    createdBy: z.string().min(1),
    createdAt: z.string().datetime(),
    config: z.object({ by: z.string().min(1), at: z.string().datetime() }).strict().nullable(),
    release: z.object({ by: z.string().min(1), at: z.string().datetime() }).strict().nullable(),
  })
  .strict()
  .array();
export type ProductApprovalHistory = z.infer<typeof ProductApprovalHistory>;
export const PRODUCT_APPROVALS_META = 'seed:product-approvals';
const IMPORTER = { id: 'system:dataset', role: 'SYSTEM', correlationId: 'seed-product-approvals' } as Actor;

@Injectable()
@PlatformComponent('D01-03')
export class CatalogService implements OnApplicationBootstrap {
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

  /** 데이터셋 시드면 상품 승인 이력을 한 번 가져온다(FF_SEED=none·5년 운영 데이터셋은 빼고, DB마다 한 번) */
  onApplicationBootstrap() {
    if (process.env.FF_SEED === 'none' || process.env.FF_DATASET === 'ops5y') return;
    const file = join(process.env.FF_DEMO_FIXTURES ?? DEMO_FIXTURES, 'product-approvals.json');
    if (!existsSync(file) || this.db.get('SELECT 1 FROM meta WHERE key = ?', PRODUCT_APPROVALS_META)) return;
    this.importApprovalHistory(ProductApprovalHistory.parse(JSON.parse(readFileSync(file, 'utf8'))));
  }

  /**
   * 데이터셋 상품의 승인 이력 — 상품 상세 '승인과 다음 담당'이 비던 것(원천 xlsx에 승인자가 없다). 작성자·구성 승인자·고객 출시 승인자를 적고,
   * 감사에는 그 시각으로 가져온 기록(PRODUCT_APPROVAL_IMPORT)을 남긴다. 상태 순서(작성 < 구성 승인 < 고객 출시 승인)와 직무 분리(두 승인자가 다름)를 확인하고,
   * 이미 이력이 있는 행(앱에서 승인한 상품)은 건드리지 않는다
   */
  importApprovalHistory(rows: ProductApprovalHistory) {
    let done = 0;
    this.db.tx(() => {
      for (const r of rows) {
        const p = this.products.get(r.catalogId, r.version);
        if (!p || p.lifecycle !== r.lifecycle) continue;
        const m = this.products.meta(r.catalogId, r.version);
        if (m.createdBy || m.configApprovedBy || m.releaseApprovedBy) continue;
        if (r.config && r.config.at <= r.createdAt) throw new Error(`${r.catalogId}@${r.version}: 구성 승인 시각이 작성보다 앞섭니다`);
        if (r.release && (!r.config || r.release.at <= r.config.at)) throw new Error(`${r.catalogId}@${r.version}: 고객 출시 승인은 구성 승인 뒤여야 합니다`);
        if (r.release && r.config && r.release.by === r.config.by) throw new Error(`${r.catalogId}@${r.version}: 구성 승인자와 고객 출시 승인자는 달라야 합니다`);
        const target = `${r.catalogId}@${r.version}`;
        this.products.setOrigin(r.catalogId, r.version, r.createdBy, r.createdAt);
        for (const [kind, a] of [['CONFIG', r.config], ['RELEASE', r.release]] as const) {
          if (!a) continue;
          this.products.setApprover(r.catalogId, r.version, kind, a.by);
          this.clock.at(a.at, () => this.audit.record(IMPORTER, 'PRODUCT_APPROVAL_IMPORT', target, { after: { kind, approvedBy: a.by, approvedAt: a.at, createdBy: r.createdBy }, reason: '데이터셋 상품의 승인 이력 가져옴', componentId: 'D01-03' }));
        }
        done++;
      }
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', PRODUCT_APPROVALS_META, JSON.stringify({ at: this.clock.iso(), products: done }));
    });
    return done;
  }

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
    if (!rule!.roles.includes(actor.role)) fail('FORBIDDEN', `이 전이는 ${rule!.roles.map((r) => ROLE_LABEL[r]).join(' · ')} 역할만 할 수 있습니다.`);
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

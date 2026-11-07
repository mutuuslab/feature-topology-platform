// 정책 글로벌 적용 조건(TX, B7 (b), FR-GLB-001-001~004) — 정책 하나에 브랜드(현대·기아·제네시스)·적용 지역 코드(권역)·컴플라이언스 룰(법규 조건)을 잇고
// 조건으로 정책을 찾는다. 수정은 해당 Feature의 Owner·시스템 관리자만. 적용 지역 코드 표와 지역 코드 기준 Variant Rule 후보(FR-CRC-001-003)도 여기서 읽는다.
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  BRAND_LABEL,
  BRANDS,
  canEditGlobalScope,
  isBrand,
  isRegionCode,
  matchGlobalScopes,
  REGION_CODE_TABLE,
  regionCodeFormatIssues,
  variantRuleCandidates,
  type Brand,
  type PolicyGlobalScope,
  type PolicyGlobalScopeBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';
import { TaxonomyRepo } from './taxonomy.repo';

const COMPONENT = 'D01-01';
const ACTION = { create: 'POLICY_GLOBAL_SCOPE_CREATE', update: 'POLICY_GLOBAL_SCOPE_UPDATE' } as const;
const SEED_ACTOR = 'seed-global-scope';
/** 법규 조건으로 고를 수 있는 룰(compliance_rule 표 — 151) */
type RuleRow = { rule_id: string; doc: string };

const rolesOf = (a: Actor): string[] => (a.roles?.length ? a.roles : [a.role]);

@Injectable()
@PlatformComponent(COMPONENT)
export class GlobalScopeService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: TaxonomyRepo,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly products: ProductRepo,
    private readonly baselines: BaselineRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (isProduction() || seedOf() === 'none' || this.repo.countScopes() > 0) return;
    this.seed();
  }

  private rules(): { ruleId: string; name: string; markets: string[]; regionCodes: string[]; status: string }[] {
    return this.db.all<RuleRow>('SELECT rule_id, doc FROM compliance_rule ORDER BY rule_id').map((r) => {
      const d = JSON.parse(r.doc) as { name: string; status: string; scope: { markets: string[]; regionCodes?: string[] } };
      return { ruleId: r.rule_id, name: d.name, status: d.status, markets: d.scope.markets, regionCodes: d.scope.regionCodes ?? [] };
    });
  }

  /** 정책 요약 + 조건 */
  private view(s: PolicyGlobalScope) {
    const p = this.policies.get(s.policyId);
    const f = this.features.versions(s.featureId).at(-1);
    return { ...s, policy: p ? { flagKey: p.flagKey, status: p.status, featureVersion: p.featureVersion, controlPoint: p.controlPoint } : null, feature: f ? { name: f.name, ownerId: f.ownerId, country: f.country } : null };
  }

  /** 브랜드 목록 — 상수 3종과 등록된 정책 수 */
  brands() {
    return { items: BRANDS.map((b) => ({ brand: b, label: BRAND_LABEL[b], policies: this.repo.policiesWith('BRAND', b).length })) };
  }

  /** 브랜드별 정책 — 없으면 빈 목록, 목록 밖 브랜드는 400 @req FR-GLB-001-003 */
  byBrand(brand: string) {
    if (!isBrand(brand)) throw new DomainError('VALIDATION', `브랜드 식별자는 ${BRANDS.join('·')} 중 하나입니다.`, { field: 'brand' });
    const items = this.repo
      .policiesWith('BRAND', brand)
      .map((id) => this.repo.scope(id))
      .filter((s): s is PolicyGlobalScope => !!s)
      .map((s) => this.view(s));
    return { brand, label: BRAND_LABEL[brand as Brand], items };
  }

  /** 조건(브랜드·적용 지역 코드·룰)으로 연계 정책 찾기 @req FR-GLB-001-001 */
  search(q: { brand?: string; regionCode?: string; ruleId?: string; featureId?: string }) {
    if (q.brand && !isBrand(q.brand)) throw new DomainError('VALIDATION', `브랜드 식별자는 ${BRANDS.join('·')} 중 하나입니다.`, { field: 'brand' });
    if (q.regionCode && !isRegionCode(q.regionCode)) throw new DomainError('VALIDATION', regionCodeFormatIssues([q.regionCode])[0], { field: 'regionCode' });
    const items = matchGlobalScopes(this.repo.scopes(), q).filter((s) => !q.featureId || s.featureId === q.featureId);
    return { total: items.length, items: items.map((s) => this.view(s)) };
  }

  get(policyId: string) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${policyId}이(가) 없습니다.`);
    const s = this.repo.scope(policyId);
    const f = this.features.versions(p.featureId).at(-1);
    return { policyId, featureId: p.featureId, ownerId: f?.ownerId ?? null, scope: s ? this.view(s) : null };
  }

  /** 등록 — 정책 하나에 한 번(있으면 수정으로) @req FR-GLB-001-001 FR-GLB-001-002 */
  create(actor: Actor, policyId: string, body: PolicyGlobalScopeBody) {
    const { featureId } = this.target(actor, ACTION.create, policyId, body);
    if (this.repo.scope(policyId)) {
      const msg = `${policyId}에는 이미 브랜드·권역 조건이 있습니다 — 수정으로 바꾸세요.`;
      this.audit.failed(actor, ACTION.create, policyId, msg, COMPONENT);
      throw new DomainError('CONFLICT', msg);
    }
    return this.save(actor, ACTION.create, { policyId, featureId, ...this.content(body), revision: 1, updatedBy: actor.id, updatedAt: this.clock.iso(), reason: body.reason }, null);
  }

  /** 수정 — 해당 Feature의 Owner 또는 시스템 관리자만(그 밖은 403·수정 불가 메시지) @req FR-GLB-001-004 */
  update(actor: Actor, policyId: string, body: PolicyGlobalScopeBody) {
    const { featureId, ownerId } = this.target(actor, ACTION.update, policyId, body);
    const cur = this.repo.scope(policyId);
    if (!cur) throw new DomainError('NOT_FOUND', `${policyId}에 등록된 브랜드·권역 조건이 없습니다 — 먼저 등록하세요.`);
    const can = canEditGlobalScope({ id: actor.id, roles: rolesOf(actor) }, { ownerId });
    if ('reason' in can) {
      this.audit.denied(actor, ACTION.update, policyId, can.reason, COMPONENT);
      throw new DomainError('FORBIDDEN', can.reason, { ownerId });
    }
    return this.save(actor, ACTION.update, { ...cur, ...this.content(body), featureId, revision: cur.revision + 1, updatedBy: actor.id, updatedAt: this.clock.iso(), reason: body.reason }, cur);
  }

  private content(body: PolicyGlobalScopeBody) {
    return { brands: [...body.brands] as Brand[], regionCodes: [...body.regionCodes], complianceRuleIds: [...body.complianceRuleIds] };
  }

  /** 정책 존재·룰 존재 확인 */
  private target(actor: Actor, action: string, policyId: string, body: PolicyGlobalScopeBody) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${policyId}이(가) 없습니다.`);
    const known = new Set(this.rules().map((r) => r.ruleId));
    const missing = body.complianceRuleIds.filter((id) => !known.has(id));
    if (missing.length) {
      const msg = `법규 조건(컴플라이언스 룰) ${missing.join(', ')}이(가) 등록되어 있지 않습니다.`;
      this.audit.failed(actor, action, policyId, msg, COMPONENT);
      throw new DomainError('VALIDATION', msg, { field: 'complianceRuleIds', missing });
    }
    const f = this.features.versions(p.featureId).at(-1);
    return { featureId: p.featureId, ownerId: f?.ownerId ?? '' };
  }

  private save(actor: Actor, action: string, s: PolicyGlobalScope, before: PolicyGlobalScope | null) {
    return this.db.tx(() => {
      this.repo.saveScope(s);
      this.audit.record(actor, action, s.policyId, { before: before ? { brands: before.brands, regionCodes: before.regionCodes, complianceRuleIds: before.complianceRuleIds, revision: before.revision } : undefined, after: { brands: s.brands, regionCodes: s.regionCodes, complianceRuleIds: s.complianceRuleIds, revision: s.revision }, reason: s.reason, componentId: COMPONENT });
      this.events.publish('policy.global-scope.saved', s.policyId, { policyId: s.policyId, featureId: s.featureId, brands: s.brands, regionCodes: s.regionCodes, revision: s.revision }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return this.view(s);
    });
  }

  // ── 적용 지역 코드 ──
  /** 대응 표 — 코드마다 시장·국가, 그 국가의 Feature 수와 그 코드를 쓰는 룰·정책 수 @req FR-CRC-001-002 */
  regionCodes() {
    const latest = new Map<string, { country: string }>();
    for (const f of this.features.all()) latest.set(f.featureId, f);
    const rules = this.rules();
    return {
      items: REGION_CODE_TABLE.map((r) => ({
        ...r,
        features: [...latest.values()].filter((f) => r.countries.includes(f.country)).length,
        rules: rules.filter((x) => x.regionCodes.includes(r.code)).map((x) => x.ruleId),
        policies: this.repo.policiesWith('REGION', r.code).length,
      })),
    };
  }

  /** 지역 코드 기준 Variant Rule 후보 — 기존 Variant 조건 + 26580 구성 규칙(상품) @req FR-CRC-001-003 */
  variantCandidates(codesText: string | undefined) {
    const codes = (codesText ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) throw new DomainError('VALIDATION', '적용 지역 코드(codes)를 하나 이상 주세요(예: 1,4).', { field: 'codes' });
    const issues = regionCodeFormatIssues(codes);
    if (issues.length) throw new DomainError('VALIDATION', issues[0], { field: 'codes', issues });
    const features = this.features.all().map((f) => ({ featureId: f.featureId, version: f.version, name: f.name, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, upgVc: f.upgVc, lifecycle: f.lifecycle }));
    const products = this.products.all().map((p) => ({
      catalogId: p.catalogId,
      version: p.version,
      name: p.name,
      country: p.country,
      vehicleModel: p.vehicleModel,
      trim: p.trim,
      type: p.type,
      lifecycle: p.lifecycle,
      features: [...new Set(p.baselineIds.map((b) => this.baselines.get(b)?.featureId).filter((x): x is string => !!x))].sort(),
    }));
    return variantRuleCandidates(codes, features, products);
  }

  // ── 데모 시드 ──
  /** 배포·승인된 정책 일부에 브랜드·지역 코드(Feature 국가에서) — 화면이 브랜드별 목록·조건 조회를 바로 보인다 */
  private seed() {
    const ps = this.policies
      .all()
      .filter((p) => p.status === 'DEPLOYED' || p.status === 'APPROVED')
      .sort((a, b) => a.policyId.localeCompare(b.policyId));
    const rules = this.rules().filter((r) => r.status === 'APPROVED');
    const rows: PolicyGlobalScope[] = [];
    const at = this.clock.iso();
    ps.forEach((p, i) => {
      const f = this.features.get(p.featureId, p.featureVersion) ?? this.features.versions(p.featureId).at(-1);
      if (!f) return;
      const regionCodes = REGION_CODE_TABLE.filter((r) => r.countries.includes(f.country)).map((r) => r.code);
      // 제네시스는 고급 트림, 현대·기아는 번갈아 — 시연용 분포(가정)
      const brands: Brand[] = /premium|prestige|signature/i.test(f.trim) ? ['GENESIS'] : i % 3 === 0 ? ['HYUNDAI', 'KIA'] : i % 3 === 1 ? ['HYUNDAI'] : ['KIA'];
      const market = REGION_CODE_TABLE.find((r) => r.countries.includes(f.country))?.market;
      const complianceRuleIds = rules.filter((r) => market && r.markets.includes(market)).slice(0, 2).map((r) => r.ruleId);
      rows.push({ policyId: p.policyId, featureId: p.featureId, brands, regionCodes, complianceRuleIds, revision: 1, updatedBy: SEED_ACTOR, updatedAt: at, reason: '시연 데이터 — 브랜드·권역 조건' });
    });
    if (!rows.length) return;
    this.db.tx(() => {
      for (const s of rows) this.repo.saveScope(s);
    });
  }
}

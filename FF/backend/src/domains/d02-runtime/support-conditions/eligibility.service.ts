// VIN 지원 판정 (D02-02, ORC-BE02) — VIN × 상품을 시장 승인·SW·HW·권리 네 칸으로 보고 4상태로 판정한다(규칙 contracts rules/ads-config.ts decideEligibility).
// 1단계: 법적 승인 = 시장 Compliance Profile 확인(ADS Feature는 ADS Profile도), 내부 상품 승인 = product_market_approval(시드 승인 시장만 — 결정 전 기본값),
// HW = 출고 구성 기록(ORC-UI08 전에는 없음) 또는 차량 보고 구성, SW = 차량 보고 구성의 기능 앱 SW와 지원 조건 필요 버전.
// OTA 설치 기록 연동(ADS-OTA01) 전에는 '업데이트 후 가능'을 내지 않고 차량 확인 필요 — 미확인(설치 기록 연동 전). 판단 불가·미확인은 구매 가능으로 세지 않는다.
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import { CONFIG_REPORT_STALE_MS, decideEligibility, ELIGIBILITY_LABEL, ELIGIBILITY_STATES, OTA_INSTALL_LINKED, profileOf, requiredSw } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, ProductRepo } from '../../d01-policy/repos';
import { AdsConfigService } from '../variant-conditions/ads-config.service';

/** ADS Profile이 표에 없을 때 — 확인 전으로 본다(판단 불가) */
const COMPLIANCE_ADS_FALLBACK = { profileId: 'ADS', status: 'VERIFY_REQUIRED' } as const;

@Injectable()
@PlatformComponent('D02-02')
export class EligibilityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly products: ProductRepo,
    private readonly ads: AdsConfigService,
  ) {}

  /** 상품 구성의 대표 Feature — 승인 조합이 있는 Feature를 먼저, 없으면 Feature ID 순 첫째 */
  private featureFor(catalogId: string) {
    const fs = this.features.all().filter((f) => (f.catalogIds ?? []).includes(catalogId));
    const withSet = new Set(this.ads.sets().map((s) => `${s.featureId}@${s.featureVersion}`));
    return fs.sort((a, b) => Number(withSet.has(`${b.featureId}@${b.version}`)) - Number(withSet.has(`${a.featureId}@${a.version}`)) || a.featureId.localeCompare(b.featureId))[0] ?? null;
  }

  private adsFeature(featureId: string, version: string): boolean {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? !!(JSON.parse(r.doc) as { adsFeature?: boolean }).adsFeature : false;
  }

  private asBuiltEcus(vin: string): string[] | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM as_built_config WHERE vin = ?', vin);
    return r ? (JSON.parse(r.doc) as { builtEcus: { ecuPno: string }[] }).builtEcus.map((e) => e.ecuPno) : null;
  }
  private otaLinked(vin: string): boolean {
    return OTA_INSTALL_LINKED || !!this.db.get('SELECT 1 FROM ota_install_record WHERE vin = ? LIMIT 1', vin);
  }

  decide(vin: string, catalogId: string | undefined) {
    if (!catalogId) throw new DomainError('VALIDATION', '상품(catalogId)을 고르세요.');
    const v = this.fleet.vehicle(vin);
    if (!v) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const product = this.products.versions(catalogId).at(-1);
    if (!product) throw new DomainError('NOT_FOUND', `상품 ${catalogId}을(를) 찾을 수 없습니다.`);
    const f = this.featureFor(catalogId);
    const now = this.clock.now().getTime();
    const report = this.ads.report(vin);
    // 법적 승인 — 시장 Profile, ADS Feature면 ADS Profile도 확인이어야 한다
    const market = profileOf(v.country);
    const adsProfile = f && this.adsFeature(f.featureId, f.version) ? profileOf('ADS') ?? COMPLIANCE_ADS_FALLBACK : null;
    const legal = market ? (adsProfile && adsProfile.status !== 'CONFIRMED' ? { profileId: adsProfile.profileId, status: adsProfile.status } : { profileId: market.profileId, status: market.status }) : null;
    const approval = this.ads.productApproval(catalogId, v.country);
    const d = decideEligibility({
      vehicle: { vin: v.vin, country: v.country },
      catalog: { catalogId, country: product.country, saleType: product.saleType },
      legalProfile: legal,
      productApproval: approval,
      feature: f ? { featureId: f.featureId, version: f.version, swId: f.swIds?.[0] ?? null, requiredSw: requiredSw(f), ecuPnos: f.ecuPnos ?? [] } : null,
      // ORC-UI08 — 출고 구성 기록(IF-12 VIN 스캔)이 있으면 HW 칸은 그것을 본다(부품 누락을 정책 ON으로 덮지 않는다)
      asBuiltEcus: this.asBuiltEcus(vin),
      report,
      grants: this.fleet.grants(vin).filter((g) => g.catalogId === catalogId).map((g) => ({ grantId: g.grantId, kind: g.kind, status: g.status, validTo: g.validTo })),
      now,
      // ADS-OTA01 — 이 차량에 OTA 설치 기록이 있으면 설치 기록 연동(SW만 미충족 → 업데이트 후 가능)
      otaLinked: this.otaLinked(vin),
    });
    return {
      vin: v.vin,
      vehicle: { vin: v.vin, label: v.label, country: v.country, vehicleModel: v.vehicleModel, trim: v.trim },
      catalog: { catalogId, name: product.name, version: product.version, country: product.country, saleType: product.saleType },
      feature: f ? { featureId: f.featureId, version: f.version, name: f.name } : null,
      state: d.state,
      label: ELIGIBILITY_LABEL[d.state],
      headline: d.headline,
      reasons: d.reasons,
      states: ELIGIBILITY_STATES,
      otaLinked: this.otaLinked(vin),
      configSet: f ? this.ads.vehicleVerdict(vin, f.featureId, f.version) : null,
      checkedAt: this.clock.iso(),
      observedAt: report?.reportedAt ?? null,
      staleAfterMs: CONFIG_REPORT_STALE_MS,
    };
  }
}

@Controller('api/vehicles')
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Get(':vin/eligibility')
  decide(@Param('vin') vin: string, @Query('catalogId') catalogId?: string) {
    return this.eligibility.decide(vin, catalogId);
  }
}

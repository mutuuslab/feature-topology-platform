// Feature 분류 보강·시장 기준선(ADS-BE16) — ADS 여부·DDT 영향·안전 관련성·담당·상태별 책임자와 시장별 승인 유형·규정 series·승인 ODD 프로파일.
// 완결성은 확정(CONFIRMED) 여부만 본다 — 출처(INFERRED)는 판정에 쓰지 않는다(추정값은 미분류로 센다).
// 출시 전이 거부 규칙(CLS_UNREGISTERED)은 아직 켜지 않는다 — 기존 Feature 일괄 차단을 막으려 목록·사유만 먼저 보인다(설계 2단계 전환).
// 시드는 AdsChangeService(D06-05)가 data/fixtures/ads/change.json에서 싣는다.
import { Controller, Get, Inject, Injectable, Param, Query } from '@nestjs/common';
import { classificationCompleteness, compareVersion, type AdsClassification, type ClassificationView, type MarketBaseline, type UnclassifiedRow, type UnclassifiedView } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { FeatureRepo } from '../repos';

/** 출시 전이 거부 규칙 대상이 아닌 상태 — 이미 출시했거나 중단·폐기한 Version */
const OUT_OF_SCOPE = new Set(['RELEASED', 'DEPRECATED', 'RETIRED']);

@Injectable()
@PlatformComponent('D01-01')
export class AdsClassificationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
  ) {}

  get(featureId: string, version: string): AdsClassification | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ads_classification WHERE feature_id = ? AND version = ?', featureId, version);
    return r ? (JSON.parse(r.doc) as AdsClassification) : null;
  }

  baselines(q: { featureId?: string; version?: string } = {}): MarketBaseline[] {
    const where: string[] = [];
    const args: string[] = [];
    if (q.featureId) where.push('feature_id = ?'), args.push(q.featureId);
    if (q.version) where.push('version = ?'), args.push(q.version);
    return this.db.all<{ doc: string }>(`SELECT doc FROM ads_market_baseline${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY feature_id, version, market`, ...args).map((r) => JSON.parse(r.doc) as MarketBaseline);
  }

  view(featureId: string, version: string): ClassificationView {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}이(가) 없습니다.`);
    const c = this.get(featureId, version);
    const sp = this.db.get<{ status: string }>('SELECT status FROM safety_profile WHERE feature_id = ? AND version = ?', featureId, version);
    return { featureId, version, lifecycle: f.lifecycle, classification: c, completeness: classificationCompleteness(c), baselines: this.baselines({ featureId, version }), safetyProfileStatus: sp?.status ?? null, ruleEnabled: false };
  }

  /** 미분류 Feature — 출시 전 Feature(최신 Version)의 축별 빈칸. 행이 없으면 모든 축이 빈칸 */
  unclassified(): UnclassifiedView {
    const latest = new Map<string, ReturnType<FeatureRepo['all']>[number]>();
    for (const f of this.features.all()) {
      const have = latest.get(f.featureId);
      if (!have || compareVersion(f.version, have.version) > 0) latest.set(f.featureId, f);
    }
    const scope = [...latest.values()].filter((f) => !OUT_OF_SCOPE.has(f.lifecycle));
    const items: UnclassifiedRow[] = [];
    for (const f of scope) {
      const c = classificationCompleteness(this.get(f.featureId, f.version));
      if (!c.classified) items.push({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle, ownerId: f.ownerId, gaps: c.gaps, inferred: c.inferred });
    }
    items.sort((a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0));
    return { items, scope: scope.length, ruleEnabled: false };
  }
}

@Controller('api')
export class AdsClassificationController {
  constructor(private readonly svc: AdsClassificationService) {}

  @Get('features/:id/versions/:ver/classification')
  view(@Param('id') id: string, @Param('ver') ver: string) {
    return this.svc.view(id, ver);
  }

  @Get('classification/unclassified')
  unclassified() {
    return this.svc.unclassified();
  }

  @Get('market-baselines')
  baselines(@Query('featureId') featureId?: string, @Query('version') version?: string) {
    return { items: this.svc.baselines({ featureId, version }) };
  }
}

// OpenFeature 범위·내보내기 (D05-01) — 범위 화면이 읽는 OF-1~7·경계 표, flagd 내보내기(F0·F1만, defaultVariant=off),
// OF-7 flag 매니페스트(OpenFeature CLI 형식)와 기본값 규율 검사. 모두 등록 정보(정책·안전 분류)에서 만든다.
import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { flagCatalog, flagdExport, flagManifest, OPENFEATURE_PINS, OPENFEATURE_SCOPE, openFeatureAllowed } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { OfrepService } from './ofrep.controller';

@Injectable()
@PlatformComponent('D05-01')
export class OpenFeatureGovService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly safety: SafetyProfileService,
    private readonly ofrep: OfrepService,
  ) {}

  catalog() {
    return flagCatalog(this.policies.all(), (f, v) => this.safety.ensure(f, v).fClass);
  }

  scope() {
    const catalog = this.catalog().map((c) => ({ ...c, openFeature: openFeatureAllowed(c.fClass) }));
    const spans = this.db.get<{ n: number; at: string | null }>("SELECT count(*) AS n, max(at) AS at FROM otel_span WHERE name = 'feature_flag.evaluation'")!;
    return { items: OPENFEATURE_SCOPE, pins: OPENFEATURE_PINS, catalog, snapshotVersion: this.ofrep.snapshotVersion(), audit: { spans: spans.n, lastAt: spans.at } };
  }

  flagd() {
    return flagdExport(this.catalog());
  }

  manifest() {
    return flagManifest(this.catalog());
  }
}

@Controller('api/openfeature')
export class OpenFeatureController {
  constructor(private readonly svc: OpenFeatureGovService) {}

  @Get('scope')
  scope() {
    return this.svc.scope();
  }

  @Get('flagd')
  flagd() {
    return this.svc.flagd();
  }

  @Get('manifest')
  manifest() {
    return this.svc.manifest();
  }
}

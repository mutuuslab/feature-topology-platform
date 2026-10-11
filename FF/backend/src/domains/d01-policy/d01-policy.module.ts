// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { AuditHistoryController, AuditHistoryService } from './audit-history/audit-history.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { ActivationService } from './activation/activation.service';
import { KILL_STATE, NO_KILL } from './activation/kill-state';
import { EntitlementService } from './entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from './policy-repos';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from './repos';
import { StagedRolloutService } from './staged-rollout/staged-rollout.service';
import { TargetingService } from './targeting/targeting.service';
import { GateService } from './topology/gate.service';
import { TopologyController } from './topology/topology.controller';
import { TopologyService } from './topology/topology.service';

@Module({
  controllers: [AuditHistoryController, RegistryController, BaselineController, TopologyController, CatalogController],
  providers: [
    { provide: KILL_STATE, useValue: NO_KILL }, // 긴급 기능 차단(D03-03) 저장소가 생기면 교체
    PolicyRepo,
    FleetRepo,
    EntitlementService,
    TargetingService,
    ActivationService,
    StagedRolloutService,
    AuditHistoryService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
  exports: [KILL_STATE, PolicyRepo, FleetRepo, EntitlementService, TargetingService, ActivationService, StagedRolloutService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
})
export class D01PolicyModule {}

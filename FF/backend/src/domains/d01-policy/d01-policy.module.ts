// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { TrustModule } from '../d06-qsec/pki-kms/trust.module';
import { AuditHistoryController, AuditHistoryService } from './audit-history/audit-history.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { SafetyProfileController, SafetyProfileService } from './registry/safety-profile.service';
import { ActivationService } from './activation/activation.service';
import { KILL_STATE } from './activation/kill-state';
import { KillRepo } from '../d03-safety/kill-switch/kill.repo';
import { IfCallRepo } from '../../adapters/if-call/if-call.repo';
import { VirtualRunRepo } from '../d06-qsec/scenario-validation/virtual-run.repo';
import { EntitlementService } from './entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from './policy-repos';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from './repos';
import { StagedRolloutService } from './staged-rollout/staged-rollout.service';
import { TargetingService } from './targeting/targeting.service';
import { GateService } from './topology/gate.service';
import { TopologyController } from './topology/topology.controller';
import { TopologyService } from './topology/topology.service';

@Module({
  imports: [TrustModule],
  controllers: [AuditHistoryController, SafetyProfileController, RegistryController, BaselineController, TopologyController, CatalogController],
  providers: [
    KillRepo,
    VirtualRunRepo, // vECU 가상검증 기록 — 검증기·Gate 판정이 함께 읽는다
    IfCallRepo,
    { provide: KILL_STATE, useExisting: KillRepo }, // 긴급 기능 차단(D03-03) 저장소
    PolicyRepo,
    FleetRepo,
    EntitlementService,
    TargetingService,
    ActivationService,
    StagedRolloutService,
    SafetyProfileService,
    AuditHistoryService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
  exports: [SafetyProfileService, KILL_STATE, KillRepo, VirtualRunRepo, IfCallRepo, PolicyRepo, FleetRepo, EntitlementService, TargetingService, ActivationService, StagedRolloutService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
})
export class D01PolicyModule {}

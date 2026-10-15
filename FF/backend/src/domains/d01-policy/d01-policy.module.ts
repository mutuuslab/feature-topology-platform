// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { TrustModule } from '../d06-qsec/pki-kms/trust.module';
import { AuditHistoryController, AuditHistoryService } from './audit-history/audit-history.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { GateDecisionService } from './topology/gate-decision.service';
import { ReharaRepo } from './topology/rehara.repo';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { SafetyProfileController, SafetyProfileService } from './registry/safety-profile.service';
import { RetirementController, RetirementService } from './registry/retirement.service';
import { TrialExpiryService } from './entitlement/trial-expiry.service';
import { ActivationService } from './activation/activation.service';
import { KILL_STATE } from './activation/kill-state';
import { KillRepo } from '../d03-safety/kill-switch/kill.repo';
import { IfCallRepo } from '../../adapters/if-call/if-call.repo';
import { MasterDataController, MasterDataService } from './topology/master.controller';
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
  controllers: [MasterDataController, AuditHistoryController, SafetyProfileController, RetirementController, RegistryController, BaselineController, TopologyController, CatalogController],
  providers: [MasterDataService, RetirementService,
    KillRepo,
    VirtualRunRepo, // vECU 가상검증 기록 — 검증기·Gate 판정이 함께 읽는다
    IfCallRepo,
    { provide: KILL_STATE, useExisting: KillRepo }, // 긴급 기능 차단(D03-03) 저장소
    PolicyRepo,
    FleetRepo,
    EntitlementService,
    TrialExpiryService, // 체험권 만료 사전 고지·만료 확정 sweep (FFG-LCY-010)
    TargetingService,
    ActivationService,
    StagedRolloutService,
    SafetyProfileService,
    AuditHistoryService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, GateDecisionService, ReharaRepo, TopologyService, CatalogService],
  exports: [SafetyProfileService, KILL_STATE, KillRepo, VirtualRunRepo, IfCallRepo, PolicyRepo, FleetRepo, EntitlementService, TrialExpiryService, TargetingService, ActivationService, StagedRolloutService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, GateDecisionService, ReharaRepo, TopologyService, CatalogService],
})
export class D01PolicyModule {}

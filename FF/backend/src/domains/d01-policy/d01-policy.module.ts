// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { TrustModule } from '../d06-qsec/pki-kms/trust.module';
import { AuditHistoryController, AuditHistoryService } from './audit-history/audit-history.controller';
import { AuditExportController, HistoryExportService, ValidationExportController } from './audit-history/history-export.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { GateDecisionService } from './topology/gate-decision.service';
import { ReharaRepo } from './topology/rehara.repo';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { FeatureRefLinker } from './registry/feature-refs';
import { RefdbRepository } from './refdb/refdb.repository';
import { SafetyProfileController, SafetyProfileService } from './registry/safety-profile.service';
import { ReleaseSignoffController, ReleaseSignoffService } from './registry/release-signoff.service';
import { RetirementController, RetirementService } from './registry/retirement.service';
import { WorkQueueController, WorkQueueService } from './registry/work-queue.service';
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
import { CanaryController, CanaryService } from './staged-rollout/canary.service';
import { AdsExpansionService } from './staged-rollout/ads-expansion.service';
import { PolicyExpansionController, PolicyExpansionService } from './staged-rollout/expansion.service';
import { TargetingService } from './targeting/targeting.service';
import { GateService } from './topology/gate.service';
import { TopologyController } from './topology/topology.controller';
import { TopologyService } from './topology/topology.service';
import { AnalysisEvidenceController, AnalysisEvidenceService } from './topology/analysis-evidence.service';
import { FlagSourceController, FlagSourceService } from './policy-store/flag-source.service';
import { FlagCodeStore } from './flag-code/flag-code.store';
import { FlagCoverageService } from './flag-code/flag-coverage.service';

@Module({
  imports: [TrustModule],
  controllers: [MasterDataController, AuditHistoryController, AuditExportController, ValidationExportController, SafetyProfileController, ReleaseSignoffController, RetirementController, RegistryController, BaselineController, TopologyController, CatalogController, WorkQueueController, AnalysisEvidenceController, FlagSourceController, CanaryController, PolicyExpansionController],
  providers: [MasterDataService, RetirementService,
    KillRepo,
    VirtualRunRepo, // 가상검증(CARLA) 기록 — 검증기·Gate 판정이 함께 읽는다
    IfCallRepo,
    { provide: KILL_STATE, useExisting: KillRepo }, // 긴급 기능 차단(D03-03) 저장소
    PolicyRepo,
    FleetRepo,
    EntitlementService,
    TrialExpiryService, // 체험권 만료 사전 고지·만료 확정 sweep (FFG-LCY-010)
    TargetingService,
    ActivationService,
    StagedRolloutService,
    CanaryService, // Canary 관측·중단 기준(TL-B01·B02) — Lake 집계(IF-15)로 단계 확대를 보류·중단
    AdsExpansionService, // 확대 판정의 축별 근거(ADS-BE12)
    PolicyExpansionService, // 확대 판정 하나(통합 D-INT-4) — 단계 조정 거부와 정책 상세 패널이 같은 판정
    SafetyProfileService,
    ReleaseSignoffService,
    WorkQueueService, // 검토함 대기열(W2)
    // Feature DB 연결(30-95 §5.3) — 등록·수명주기가 기준 행 상태를 본다. 저장소는 상태 없는 DB 접근이라 여기서도 만든다(RefdbModule과 순환 import 없이)
    RefdbRepository,
    FeatureRefLinker,
    AuditHistoryService, HistoryExportService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, GateDecisionService, ReharaRepo, TopologyService, CatalogService,
    AnalysisEvidenceService, // 분석 근거(W3) — HARA·TARA·SOTIF·형식승인 영향, G7 서명
    FlagSourceService,
    // Flag 코드 연결 대사(20-97) — Lifecycle 출시 관문·정책 게시 관문·Feature Flag 탭이 함께 쓴다
    FlagCodeStore,
    FlagCoverageService,
  ],
  exports: [SafetyProfileService, KILL_STATE, KillRepo, VirtualRunRepo, IfCallRepo, PolicyRepo, FleetRepo, EntitlementService, TrialExpiryService, TargetingService, ActivationService, StagedRolloutService, CanaryService, FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, GateDecisionService, ReharaRepo, TopologyService, CatalogService, FlagCodeStore, FlagCoverageService],
})
export class D01PolicyModule {}

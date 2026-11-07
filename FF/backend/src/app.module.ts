import { Module } from '@nestjs/common';
import { D01PolicyModule } from './domains/d01-policy/d01-policy.module';
import { FlagCodeModule } from './domains/d01-policy/flag-code/flag-code.module';
import { PolicyModule } from './domains/d01-policy/policy-store/policy.module';
import { RefdbModule } from './domains/d01-policy/refdb/refdb.module';
import { CostModule } from './domains/d07-cost/estimation/cost.module';
import { D04OpsModule } from './domains/d04-ops/d04-ops.module';
import { D05ExtModule } from './domains/d05-ext/d05-ext.module';
import { ExtModule } from './domains/ext.module';
import { ExtSyncModule } from './domains/ext-sync.module';
import { D06QsecModule } from './domains/d06-qsec/d06-qsec.module';
import { DeliveryModule } from './domains/delivery.module';
import { OpsLoopModule } from './domains/ops-loop.module';
import { LakeLoopModule } from './domains/lake-loop.module';
import { ProcedureModule } from './workflows/procedure.module';
import { ConsultModule } from './workflows/consult.module';
import { DashboardModule } from './dashboards/dashboard.module';
import { KernelModule } from './kernel/kernel.module';
import { DemoActivitySeeder } from './demo-activity/demo-activity.seeder';
import { UnleashLiveModule } from './domains/unleash-live.module';
import { AdsConfigModule } from './domains/ads-config.module';
import { AdsEvidenceModule } from './domains/ads-evidence.module';
import { AdsStateModule } from './domains/ads-state.module';
import { AdsChangeModule } from './domains/ads-change.module';
import { AdsP5Module } from './domains/ads-p5.module';
import { VehicleRelayModule } from './domains/vehicle-relay.module';
import { ShowcaseScenariosSeeder } from './demo-activity/showcase-scenarios.seeder';
import { ShowcaseFillSeeder } from './demo-activity/showcase-fill.seeder';
import { ExtGatewayModule } from './domains/ext-gateway.module';

// 도메인 모듈(d01-policy … d06-qsec)은 단계별로 추가한다 — PROGRESS.md 참고.
@Module({
  imports: [KernelModule, D01PolicyModule, FlagCodeModule, RefdbModule, CostModule, D06QsecModule, PolicyModule, DeliveryModule, OpsLoopModule, LakeLoopModule, D04OpsModule, D05ExtModule, ExtModule, ExtSyncModule, ProcedureModule, DashboardModule, ConsultModule, UnleashLiveModule, AdsConfigModule, AdsEvidenceModule, AdsStateModule, AdsChangeModule, ExtGatewayModule, AdsP5Module, VehicleRelayModule],
  // 데모 활동 시드 — 루트 공급자라 도메인 모듈의 부팅 훅 뒤에 돈다(demo-activity.seeder.ts)
  providers: [DemoActivitySeeder, ShowcaseScenariosSeeder, ShowcaseFillSeeder],
})
export class AppModule {}

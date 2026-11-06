import { Module } from '@nestjs/common';
import { D01PolicyModule } from './domains/d01-policy/d01-policy.module';
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
import { ProcedureModule } from './workflows/procedure.module';
import { ConsultModule } from './workflows/consult.module';
import { DashboardModule } from './dashboards/dashboard.module';
import { KernelModule } from './kernel/kernel.module';
import { DemoActivitySeeder } from './demo-activity/demo-activity.seeder';
import { UnleashLiveModule } from './domains/unleash-live.module';
import { ShowcaseScenariosSeeder } from './demo-activity/showcase-scenarios.seeder';
import { ShowcaseFillSeeder } from './demo-activity/showcase-fill.seeder';

// 도메인 모듈(d01-policy … d06-qsec)은 단계별로 추가한다 — PROGRESS.md 참고.
@Module({
  imports: [KernelModule, D01PolicyModule, RefdbModule, CostModule, D06QsecModule, PolicyModule, DeliveryModule, OpsLoopModule, D04OpsModule, D05ExtModule, ExtModule, ExtSyncModule, ProcedureModule, DashboardModule, ConsultModule, UnleashLiveModule],
  // 데모 활동 시드 — 루트 공급자라 도메인 모듈의 부팅 훅 뒤에 돈다(demo-activity.seeder.ts)
  providers: [DemoActivitySeeder, ShowcaseScenariosSeeder, ShowcaseFillSeeder],
})
export class AppModule {}

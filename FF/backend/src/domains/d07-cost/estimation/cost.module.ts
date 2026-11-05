// SW 개발비 산정 모듈(D07-01) — 항상 켠다(2026-11-04 사용자 결정, D-COST-5의 모듈 스위치는 두지 않음).
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../../d01-policy/d01-policy.module';
import { RefdbModule } from '../../d01-policy/refdb/refdb.module';
import { CostController } from './cost.controller';
import { CostDemoSeed } from './cost-demo-seed';
import { CostService } from './cost.service';
import { CostShowcaseSeed } from './cost-showcase-seed';

@Module({
  imports: [D01PolicyModule, RefdbModule],
  controllers: [CostController],
  // 데모 시드는 계수 표 시드 뒤 — CostDemoSeed가 ensureBasis를 먼저 부른다
  providers: [CostService, CostDemoSeed, CostShowcaseSeed],
})
export class CostModule {}

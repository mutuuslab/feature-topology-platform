// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from './repos';
import { GateService } from './topology/gate.service';

@Module({
  controllers: [RegistryController, BaselineController],
  providers: [FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService],
  exports: [FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService],
})
export class D01PolicyModule {}

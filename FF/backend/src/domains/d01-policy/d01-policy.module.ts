// 01. Feature 정책 관리 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { BaselineService } from './registry/baseline.service';
import { LifecycleService } from './registry/lifecycle.service';
import { BaselineController, RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from './repos';
import { GateService } from './topology/gate.service';
import { TopologyController } from './topology/topology.controller';
import { TopologyService } from './topology/topology.service';

@Module({
  controllers: [RegistryController, BaselineController, TopologyController, CatalogController],
  providers: [FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
  exports: [FeatureRepo, GateRepo, TopologyRepo, BaselineRepo, ProductRepo, LifecycleService, RegistryService, BaselineService, GateService, TopologyService, CatalogService],
})
export class D01PolicyModule {}

// GitLab · JIRA · codeBeamer 양방향 연계(D05-01 · IF-01·IF-13·IF-14) — Lifecycle 전이·정책 승인 요청을 받으므로 Registry·정책 모듈을 쓴다.
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { PolicyModule } from './d01-policy/policy-store/policy.module';
import { ChangeRecordService } from './d04-ops/pipeline-link/change-record.service';
import { ExtAdapters } from './d05-ext/api-gateway/ext-sync/adapters';
import { ExtSyncController } from './d05-ext/api-gateway/ext-sync/ext-sync.controller';
import { ExtSyncRepo } from './d05-ext/api-gateway/ext-sync/ext-sync.repo';
import { ExtSyncService } from './d05-ext/api-gateway/ext-sync/ext-sync.service';
import { MockExtStore } from './d05-ext/api-gateway/ext-sync/mock-ext.store';
import { FeatureEpics } from './d05-ext/api-gateway/ext-sync/feature-epic';
import { AlmReconcileService } from './d05-ext/api-gateway/ext-sync/alm-reconcile.service';
import { AlmController } from './d05-ext/api-gateway/ext-sync/alm.controller';
import { AlmChildrenService } from './d05-ext/api-gateway/ext-sync/alm-children.service';
import { AlmWorkProductsService } from './d05-ext/api-gateway/ext-sync/alm-workproducts.service';
import { AlmGateService } from './d05-ext/api-gateway/ext-sync/alm-gate.service';
import { AlmAppService } from './d05-ext/api-gateway/ext-sync/alm-app.service';
import { AlmAppController } from './d05-ext/api-gateway/ext-sync/alm-app.controller';
import { RefdbModule } from './d01-policy/refdb/refdb.module';

@Module({
  imports: [D01PolicyModule, PolicyModule, RefdbModule],
  controllers: [ExtSyncController, AlmController, AlmAppController],
  providers: [ExtSyncRepo, MockExtStore, ExtAdapters, ExtSyncService, ChangeRecordService, FeatureEpics, AlmReconcileService, AlmChildrenService, AlmWorkProductsService, AlmGateService, AlmAppService],
  exports: [ExtSyncService, AlmChildrenService, AlmWorkProductsService],
})
export class ExtSyncModule {}

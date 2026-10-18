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

@Module({
  imports: [D01PolicyModule, PolicyModule],
  controllers: [ExtSyncController],
  providers: [ExtSyncRepo, MockExtStore, ExtAdapters, ExtSyncService, ChangeRecordService],
  exports: [ExtSyncService],
})
export class ExtSyncModule {}

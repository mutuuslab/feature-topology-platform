// P2 외부 연계 확장 — 외부 시스템 API 키·런타임 명세·버전 정책(D05-01), Legacy 연계 설정·브리지·변환 규칙(D05-03),
// Legacy↔SDV 메시지 변환(D05-07), Feature 사용량 정산 전송(D05-04). API 키 인증 자체는 커널 역할 가드(kernel/auth/api-key.ts).
import { Module } from '@nestjs/common';
import { SettlementSystem } from '../adapters/if-mocks/settlement.adapter';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { IntegrationErrorModule } from './d04-ops/event-history/integration-error.module';
import { ApiKeyController, ApiKeyService } from './d05-ext/api-gateway/api-keys/api-key.service';
import { ApiSpecController, ApiSpecService } from './d05-ext/api-gateway/api-spec.controller';
import { SettlementController, SettlementService } from './d05-ext/billing/settlement.service';
import { LegacyLinkController, LegacyLinkService, LegacyMessageController, LegacyMessageService, LegacyRuleService } from './d05-ext/legacy/legacy-config.service';
import { ExtGatewaySeeder } from './d05-ext/ext-gateway.seed';
import { ExtModule } from './ext.module';

@Module({
  imports: [D01PolicyModule, IntegrationErrorModule, ExtModule],
  controllers: [ApiKeyController, ApiSpecController, LegacyLinkController, LegacyMessageController, SettlementController],
  providers: [ApiKeyService, ApiSpecService, LegacyLinkService, LegacyRuleService, LegacyMessageService, SettlementSystem, SettlementService, ExtGatewaySeeder],
})
export class ExtGatewayModule {}

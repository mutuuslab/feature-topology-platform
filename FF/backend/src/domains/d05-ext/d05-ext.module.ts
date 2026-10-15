// 05. 시스템 연계·확장 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { OtelExporter } from '../../adapters/if-mocks/otel.exporter';
import { D01PolicyModule } from '../d01-policy/d01-policy.module';
import { OfrepController, OfrepService } from './api-gateway/ofrep.controller';
import { OpenFeatureController, OpenFeatureGovService } from './api-gateway/openfeature.controller';
import { BillingController, BillingService } from './billing/billing.controller';
import { BizMetricsController, BizMetricsService } from './biz-metrics/biz-metrics.controller';
import { DataActController, DataActService } from './api-gateway/data-act.service';

@Module({
  imports: [D01PolicyModule],
  controllers: [OfrepController, OpenFeatureController, BillingController, BizMetricsController, DataActController],
  providers: [OtelExporter, OfrepService, OpenFeatureGovService, BillingService, BizMetricsService, DataActService],
  exports: [OfrepService],
})
export class D05ExtModule {}

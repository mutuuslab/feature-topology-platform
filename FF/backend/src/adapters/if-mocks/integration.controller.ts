// 외부 연계 조회 API — IF-01~13 연결 현황, IF-01 ALM 요구사항, IF-08 협력사 SW 납품, IF-11 OTel 수집기(모의) span.
import { Controller, Get, Query } from '@nestjs/common';
import { DomainError } from '../../kernel/errors';
import { ExternalSystems } from './external-systems';

@Controller('api/integrations')
export class IntegrationController {
  constructor(private readonly ext: ExternalSystems) {}

  @Get('systems')
  systems() {
    return { items: this.ext.systems() };
  }

  @Get('alm/requirements')
  alm(@Query('featureId') featureId?: string, @Query('version') version?: string) {
    if (!featureId || !version) throw new DomainError('VALIDATION', 'featureId와 version이 필요합니다.');
    return this.ext.almRequirements(featureId, version);
  }

  @Get('supplier/deliveries')
  deliveries(@Query('supplier') supplier?: string) {
    return { items: this.ext.supplierDeliveries(supplier) };
  }

  @Get('otel/spans')
  spans(@Query('name') name?: string, @Query('limit') limit?: string) {
    return { items: this.ext.spans({ name, limit: limit ? Number(limit) : undefined }) };
  }
}

// Feature Catalog API (D01-03) — 상품·상품 Version·구성 검증·출시 적격성·BOM 후보
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateProductBody, CreateProductVersionBody, ProductTransitionBody, UpdateProductDraftBody, ValidateCompositionBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { CatalogService } from './catalog.service';

@Controller('api/products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@Query('q') q?: string, @Query('lifecycle') lifecycle?: string, @Query('saleType') saleType?: string, @Query('country') country?: string) {
    return { items: this.catalog.list({ q, lifecycle, saleType, country }) };
  }

  @Post()
  @Roles('PRODUCT_AUTHOR')
  @AuditAction('PRODUCT_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateProductBody)) body: CreateProductBody) {
    return this.catalog.create(actor, body);
  }

  // 고정 경로(candidates, validate)를 매개변수 경로보다 먼저 선언한다
  @Get('candidates')
  candidates(@Query('country') country?: string, @Query('vehicleModel') vehicleModel?: string, @Query('trim') trim?: string, @Query('q') q?: string) {
    if (!country || !vehicleModel || !trim) throw new DomainError('VALIDATION', '국가·차종·트림을 모두 지정하세요.');
    return { items: this.catalog.candidates({ country, vehicleModel, trim, q }) };
  }

  @Post('validate')
  @HttpCode(200)
  @Roles('PRODUCT_AUTHOR', 'PRODUCT_APPROVER')
  validate(@Body(new ZodPipe(ValidateCompositionBody)) body: ValidateCompositionBody) {
    return this.catalog.validate(body);
  }

  @Get(':id/versions/:ver')
  detail(@Param('id') id: string, @Param('ver') ver: string) {
    return this.catalog.detail(id, ver);
  }

  @Patch(':id/versions/:ver')
  @Roles('PRODUCT_AUTHOR')
  @AuditAction('PRODUCT_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(UpdateProductDraftBody)) body: UpdateProductDraftBody) {
    return this.catalog.updateDraft(actor, id, ver, body);
  }

  @Post(':id/versions')
  @Roles('PRODUCT_AUTHOR')
  @AuditAction('PRODUCT_VERSION_CREATE')
  createVersion(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(CreateProductVersionBody)) body: CreateProductVersionBody) {
    return this.catalog.createVersion(actor, id, body);
  }

  @Post(':id/versions/:ver/transitions')
  @HttpCode(200)
  @Roles('PRODUCT_APPROVER')
  @AuditAction('PRODUCT_TRANSITION')
  transition(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(ProductTransitionBody)) body: ProductTransitionBody) {
    return this.catalog.transition(actor, id, ver, body.to, body.reason);
  }
}

// 분류 계층 L0~L5·Feature 배치·적용 지역 코드·브랜드별 정책 API(TX, B7 (b), D01-01)
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  CreateTaxonomyNodeBody,
  DeleteTaxonomyNodeBody,
  GLOBAL_SCOPE_AUTHOR_ROLES,
  HUMAN_ROLES,
  PlaceFeatureBody,
  PolicyGlobalScopeBody,
  TAXONOMY_EDITOR_ROLES,
  TAXONOMY_PLACEMENT_ROLES,
  UpdateTaxonomyNodeBody,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { GlobalScopeService } from './global-scope.service';
import { TaxonomyService } from './taxonomy.service';

const featureId = (id: string) => {
  if (!/^FEAT-\d{5}$/.test(id)) throw new DomainError('VALIDATION', 'Feature ID 형식은 FEAT-NNNNN입니다.');
  return id;
};

@Controller('api')
export class TaxonomyController {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly global: GlobalScopeService,
  ) {}

  // ── 분류 계층 ──
  @Get('taxonomy/levels')
  levels() {
    return this.taxonomy.levels();
  }

  @Get('taxonomy/levels/:level')
  classify(@Param('level') level: string) {
    return this.taxonomy.classify(level);
  }

  @Get('taxonomy/nodes')
  nodes(@Query('level') level?: string, @Query('parentId') parentId?: string) {
    return this.taxonomy.nodes({ level, parentId });
  }

  @Post('taxonomy/nodes')
  @Roles(...TAXONOMY_EDITOR_ROLES)
  @AuditAction('TAXONOMY_NODE_CREATE')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateTaxonomyNodeBody)) body: CreateTaxonomyNodeBody) {
    return this.taxonomy.create(actor, body);
  }

  @Patch('taxonomy/nodes/:id')
  @Roles(...TAXONOMY_EDITOR_ROLES)
  @AuditAction('TAXONOMY_NODE_UPDATE')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UpdateTaxonomyNodeBody)) body: UpdateTaxonomyNodeBody) {
    return this.taxonomy.update(actor, id, body);
  }

  @Post('taxonomy/nodes/:id/delete')
  @Roles(...TAXONOMY_EDITOR_ROLES)
  @AuditAction('TAXONOMY_NODE_DELETE')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(DeleteTaxonomyNodeBody)) body: DeleteTaxonomyNodeBody) {
    return this.taxonomy.remove(actor, id, body);
  }

  @Get('features/:id/taxonomy')
  featureTaxonomy(@Param('id') id: string) {
    return this.taxonomy.featureView(featureId(id));
  }

  @Put('features/:id/taxonomy')
  @Roles(...TAXONOMY_PLACEMENT_ROLES)
  @AuditAction('FEATURE_TAXONOMY_PLACE')
  place(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PlaceFeatureBody)) body: PlaceFeatureBody) {
    return this.taxonomy.place(actor, featureId(id), body);
  }

  // ── 적용 지역 코드 ──
  @Get('region-codes')
  regionCodes() {
    return this.global.regionCodes();
  }

  @Get('region-codes/variant-candidates')
  variantCandidates(@Query('codes') codes?: string) {
    return this.global.variantCandidates(codes);
  }

  // ── 브랜드·권역별 정책 ──
  @Get('brands')
  brands() {
    return this.global.brands();
  }

  @Get('brands/:brand/policies')
  byBrand(@Param('brand') brand: string) {
    return this.global.byBrand(brand);
  }

  @Get('global-scopes')
  search(@Query('brand') brand?: string, @Query('regionCode') regionCode?: string, @Query('ruleId') ruleId?: string, @Query('featureId') featureId?: string) {
    return this.global.search({ brand, regionCode, ruleId, featureId });
  }

  @Get('policies/:id/global-scope')
  scope(@Param('id') id: string) {
    return this.global.get(id);
  }

  @Post('policies/:id/global-scope')
  @Roles(...GLOBAL_SCOPE_AUTHOR_ROLES)
  @AuditAction('POLICY_GLOBAL_SCOPE_CREATE')
  createScope(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PolicyGlobalScopeBody)) body: PolicyGlobalScopeBody) {
    return this.global.create(actor, id, body);
  }

  /** 사람 역할만 요청하며, 실제 수정은 Feature Owner·시스템 관리자만 허용한다(서비스가 403). */
  @Put('policies/:id/global-scope')
  @Roles(...HUMAN_ROLES)
  @AuditAction('POLICY_GLOBAL_SCOPE_UPDATE')
  updateScope(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PolicyGlobalScopeBody)) body: PolicyGlobalScopeBody) {
    return this.global.update(actor, id, body);
  }
}

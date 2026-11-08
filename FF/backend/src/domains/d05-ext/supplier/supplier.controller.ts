import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AddSupplierSwcBody, CreateSupplierCriteriaBody, CreateSupplierMappingBody, CreateSupplierPackageBody, HUMAN_ROLES, ReviewSupplierPackageBody, SubmitSupplierArtifactBody, SubmitSupplierPackageBody, SUPPLIER_CRITERIA_ROLES, SUPPLIER_MAPPING_ROLES, SUPPLIER_PACKAGE_ROLES, SUPPLIER_REVIEW_ROLES } from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { singleQuery } from '../../../kernel/paging';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { SupplierService } from './supplier.service';

@Controller('api')
export class SupplierController {
  constructor(private readonly supplier: SupplierService) {}
  @Get('supplier-mappings')
  mappings(@Query('featureId') featureId?: string) { return this.supplier.mappings(singleQuery(featureId, 'featureId')); }
  @Post('supplier-mappings')
  @Roles(...SUPPLIER_MAPPING_ROLES)
  createMapping(@CurrentActor() a: Actor, @Body(new ZodPipe(CreateSupplierMappingBody)) b: CreateSupplierMappingBody) { return this.supplier.createMapping(a, b); }
  @Post('supplier-mappings/:id/swcs')
  @Roles(...SUPPLIER_MAPPING_ROLES)
  addSwc(@CurrentActor() a: Actor, @Param('id') id: string, @Body(new ZodPipe(AddSupplierSwcBody)) b: AddSupplierSwcBody) { return this.supplier.addSwc(a, id, b); }
  @Get('supplier-packages')
  packages(@Query('featureId') featureId?: string, @Query('featureVersion') featureVersion?: string, @Query('supplier') supplier?: string) { return this.supplier.packages({ featureId: singleQuery(featureId, 'featureId'), featureVersion: singleQuery(featureVersion, 'featureVersion'), supplier: singleQuery(supplier, 'supplier') }); }
  @Get('supplier-packages/:id')
  detail(@Param('id') id: string) { return this.supplier.detail(id); }
  @Post('supplier-packages')
  @Roles(...SUPPLIER_PACKAGE_ROLES)
  createPackage(@CurrentActor() a: Actor, @Body(new ZodPipe(CreateSupplierPackageBody)) b: CreateSupplierPackageBody) { return this.supplier.createPackage(a, b); }
  @Post('supplier-packages/:id/artifacts')
  @Roles(...SUPPLIER_PACKAGE_ROLES)
  artifact(@CurrentActor() a: Actor, @Param('id') id: string, @Body(new ZodPipe(SubmitSupplierArtifactBody)) b: SubmitSupplierArtifactBody) { return this.supplier.artifact(a, id, b); }
  @Get('supplier-artifacts/:id/content')
  content(@Param('id') id: string) { return this.supplier.content(id); }
  @Post('supplier-packages/:id/submit')
  @HttpCode(200)
  @Roles(...SUPPLIER_PACKAGE_ROLES)
  submit(@CurrentActor() a: Actor, @Param('id') id: string, @Body(new ZodPipe(SubmitSupplierPackageBody)) b: SubmitSupplierPackageBody) { return this.supplier.submit(a, id, b); }
  @Post('supplier-packages/:id/reviews')
  @Roles(...SUPPLIER_REVIEW_ROLES)
  review(@CurrentActor() a: Actor, @Param('id') id: string, @Body(new ZodPipe(ReviewSupplierPackageBody)) b: ReviewSupplierPackageBody) { return this.supplier.review(a, id, b); }
  @Get('supplier-criteria')
  criteria(@Query('featureId') featureId: string) { return this.supplier.criteria(singleQuery(featureId, 'featureId') ?? ''); }
  @Post('supplier-criteria')
  @Roles(...SUPPLIER_CRITERIA_ROLES)
  createCriteria(@CurrentActor() a: Actor, @Body(new ZodPipe(CreateSupplierCriteriaBody)) b: CreateSupplierCriteriaBody) { return this.supplier.createCriteria(a, b); }
  @Get('features/:id/versions/:ver/supplier-gate')
  gate(@Param('id') id: string, @Param('ver') version: string) { return this.supplier.gate(id, version); }
  @Get('features/:id/versions/:ver/supplier-scope')
  @Header('Cache-Control', 'no-store')
  @Roles(...HUMAN_ROLES)
  scope(@Param('id') id: string, @Param('ver') version: string) { return this.supplier.scope(id, version); }
}

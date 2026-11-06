// ISO/IEC 26580 PLE API(20-60 §6) — 조회·점검만. 저장은 Feature 등록·초안 수정(Registry)이 한다.
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ValidateCompositionBody } from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PleService } from './ple.service';

@Controller('api/ple')
export class PleController {
  constructor(private readonly ple: PleService) {}

  @Get('ref-suggestions')
  suggestions(@Query('q') q?: string) {
    return this.ple.suggestions(q ?? '');
  }

  @Get('autofill/:refId')
  autofill(@Param('refId') refId: string, @Query('name') name?: string, @Query('country') country?: string, @Query('vehicleModel') vehicleModel?: string, @Query('trim') trim?: string) {
    return this.ple.autofill({ refId, name, country, vehicleModel, trim });
  }

  @Get('registrations')
  registrations(@CurrentActor() actor: Actor) {
    return this.ple.registrations(actor);
  }

  @Get('catalogue')
  catalogue() {
    return this.ple.catalogue();
  }

  @Get('bill-of-features')
  portfolio() {
    return this.ple.portfolio();
  }

  // 고정 경로(check)를 매개변수 경로보다 먼저
  @Post('bill-of-features/check')
  @HttpCode(200)
  @Roles('PRODUCT_AUTHOR', 'PRODUCT_APPROVER')
  // 입력은 상품 구성 검증과 같다(기존 조합 규칙 재사용)
  check(@Body(new ZodPipe(ValidateCompositionBody)) body: ValidateCompositionBody) {
    return this.ple.check(body);
  }

  @Get('bill-of-features/:id/:ver')
  bill(@Param('id') id: string, @Param('ver') ver: string) {
    return this.ple.bill(id, ver);
  }

  @Get('configure/:id/:ver')
  configure(@Param('id') id: string, @Param('ver') ver: string) {
    return this.ple.configure(id, ver);
  }

  @Get('assets')
  assets() {
    return this.ple.assets();
  }
}

/** Feature 상세의 26580 변이 프로필·자동 채움 이력 — Registry 경로 아래 */
@Controller('api/features')
export class PleFeatureController {
  constructor(private readonly ple: PleService) {}

  @Get(':id/versions/:ver/variability')
  variability(@Param('id') id: string, @Param('ver') ver: string) {
    return this.ple.variabilityView(id, ver);
  }
}

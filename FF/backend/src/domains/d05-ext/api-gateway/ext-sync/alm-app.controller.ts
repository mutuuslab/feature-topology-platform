// JIRA 안의 FF 앱 API(80-50 §4.7) — 사람 행위자 헤더 대신 앱 토큰 + JIRA 사용자 매핑으로 확인한다(alm-app.service).
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { AppTokenBody } from '@ff/contracts';
import type { Request } from 'express';
import { WebhookEndpoint } from '../../../../kernel/actor';
import { ZodPipe } from '../../../../kernel/zod.pipe';
import { AlmAppService } from './alm-app.service';

@Controller('api/alm/app')
export class AlmAppController {
  constructor(private readonly app: AlmAppService) {}

  @Post('token')
  @HttpCode(200)
  @WebhookEndpoint()
  token(@Body(new ZodPipe(AppTokenBody)) body: AppTokenBody) {
    return this.app.token(body);
  }

  @Get('refdb/refs')
  @WebhookEndpoint()
  refs(@Req() req: Request, @Query() q: Record<string, unknown>) {
    const who = this.app.who(req.headers);
    return this.app.refs(who.role, q);
  }

  @Get('reference-values')
  @WebhookEndpoint()
  referenceValues(@Req() req: Request) {
    this.app.who(req.headers);
    return this.app.referenceValues();
  }

  @Get('features/:id/summary')
  @WebhookEndpoint()
  summary(@Req() req: Request, @Param('id') id: string) {
    this.app.who(req.headers);
    return this.app.summary(id);
  }
}

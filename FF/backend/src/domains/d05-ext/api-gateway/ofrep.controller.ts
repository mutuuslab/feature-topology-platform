// API Gateway (D05-01) — OpenFeature Remote Evaluation Protocol(OFREP) 창구, IF-10 OpenFeature SDK.
// 평가는 활성화 제어(D01-09)의 단일 평가기. 차량은 targetingKey(=VIN)로 식별한다.
// 오류 계약: 404 FLAG_NOT_FOUND(SDK는 기본값=Safe Default), 400 TARGETING_KEY_MISSING·INVALID_CONTEXT. bulk는 ETag/304.
import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Headers, HttpCode, HttpException, Injectable, Param, Post, Res, UseFilters } from '@nestjs/common';
import { OfrepBody, type FlagResult } from '@ff/contracts';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { ReadOnlyEndpoint } from '../../../kernel/actor';
import { PlatformComponent } from '../../../kernel/components';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { ActivationService } from '../../d01-policy/activation/activation.service';
import { DomainError } from '../../../kernel/errors';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';

/** 평가기 사유 → OpenFeature 표준 사유 */
const REASON: Record<FlagResult['reason'], string> = {
  POLICY_MATCH: 'TARGETING_MATCH',
  KILL_SWITCH: 'DISABLED',
  NOT_DEPLOYED: 'DISABLED',
  NOT_APPLICABLE: 'DEFAULT',
  NO_ENTITLEMENT: 'DEFAULT',
  TARGETING_MISS: 'DEFAULT',
  COHORT_MISS: 'SPLIT',
  CONTEXT_UNKNOWN: 'UNKNOWN',
  ERROR_SAFE_DEFAULT: 'ERROR',
};

export const ofrep = (r: FlagResult) => ({
  key: r.flagKey,
  value: r.value,
  variant: r.variant,
  reason: REASON[r.reason],
  metadata: { policyId: r.policyId, revision: r.revision, decision: r.decision, platformReason: r.reason },
});

@Injectable()
@PlatformComponent('D05-01')
export class OfrepService {
  constructor(
    private readonly activation: ActivationService,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
  ) {}

  private vin(body: OfrepBody, key?: string): string {
    const vin = body.context?.targetingKey;
    if (!vin) throw new HttpException({ key, errorCode: 'TARGETING_KEY_MISSING', errorDetails: 'context.targetingKey(VIN)가 필요합니다.' }, 400);
    if (!this.fleet.vehicle(vin)) throw new HttpException({ key, errorCode: 'INVALID_CONTEXT', errorDetails: `등록되지 않은 차량 ${vin}` }, 400);
    return vin;
  }

  async one(key: string, body: OfrepBody) {
    const vin = this.vin(body, key);
    if (!this.policies.deployed(key)) throw new HttpException({ key, errorCode: 'FLAG_NOT_FOUND', errorDetails: `배포된 flag가 없습니다 — SDK는 기본값(Safe Default)을 쓰세요.` }, 404);
    return ofrep((await this.activation.decide(vin, key)).result);
  }

  async bulk(body: OfrepBody) {
    const vin = this.vin(body);
    return { flags: (await this.activation.decideAll(vin)).map(ofrep) };
  }
}

/** OFREP 오류 본문은 플랫폼 오류 봉투가 아니라 OFREP 규격({key, errorCode, errorDetails}) 그대로 */
@Catch()
class OfrepErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) return res.status(err.getStatus()).json(err.getResponse());
    if (err instanceof DomainError) return res.status(err.status === 404 ? 404 : 400).json({ errorCode: err.status === 404 ? 'FLAG_NOT_FOUND' : 'INVALID_CONTEXT', errorDetails: err.message });
    return res.status(500).json({ errorCode: 'GENERAL', errorDetails: '평가 오류 — SDK는 기본값(Safe Default)을 쓰세요.' });
  }
}

@Controller('ofrep/v1/evaluate')
@UseFilters(OfrepErrorFilter)
@ReadOnlyEndpoint() // 평가 요청은 상태를 바꾸지 않는다 — 차량 SDK는 행위자 헤더가 없다
export class OfrepController {
  constructor(private readonly svc: OfrepService) {}

  @Post('flags/:key')
  @HttpCode(200)
  one(@Param('key') key: string, @Body(new ZodPipe(OfrepBody)) body: OfrepBody) {
    return this.svc.one(key, body);
  }

  @Post('flags')
  @HttpCode(200)
  async bulk(@Body(new ZodPipe(OfrepBody)) body: OfrepBody, @Headers('if-none-match') inm: string | undefined, @Res({ passthrough: true }) res: Response) {
    const out = await this.svc.bulk(body);
    const etag = '"' + createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 32) + '"';
    res.setHeader('ETag', etag);
    if (inm === etag) {
      res.status(304);
      return undefined;
    }
    return out;
  }
}

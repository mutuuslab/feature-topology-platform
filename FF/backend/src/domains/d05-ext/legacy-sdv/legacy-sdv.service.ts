// Legacy-SDV Interface (D05-07) — 런타임 Flag 평가가 없는 비SDV(레거시) 차량에 Feature를 켜고 끌 때의 다리.
// 서명 정책·OTA 대신 딜러 진단기 코딩 계획을 만든다. 원격 긴급 차단·Safe Default가 없으므로 안전 관련(F2 이상) Feature는 거부한다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { legacyPlan, TranslateLegacyBody } from '@ff/contracts';
import { z } from 'zod';
import { ExternalSystems } from '../../../adapters/if-mocks/external-systems';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { FeatureRepo } from '../../d01-policy/repos';

@Injectable()
@PlatformComponent('D05-07')
export class LegacySdvService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ext: ExternalSystems,
    private readonly features: FeatureRepo,
    private readonly safety: SafetyProfileService,
    private readonly audit: AuditService,
  ) {}

  vehicles() {
    return this.ext.legacyVehicles();
  }

  translate(actor: Actor, body: z.infer<typeof TranslateLegacyBody>) {
    const v = this.ext.legacyVehicles().find((x) => x.vin === body.vin);
    if (!v) throw new DomainError('NOT_FOUND', `${body.vin}은(는) 레거시 차량 목록에 없습니다 — SDV 차량은 서명 정책·OTA로 전달합니다.`);
    const f = this.features.versions(body.featureId).at(-1);
    if (!f) throw new DomainError('NOT_FOUND', `${body.featureId}을(를) 찾을 수 없습니다.`);
    const profile = this.safety.ensure(f.featureId, f.version);
    const plan = legacyPlan(v, { featureId: f.featureId, fClass: profile.fClass, controlPoints: f.controlPoints }, body.enable);
    const out = { vin: v.vin, featureId: f.featureId, version: f.version, fClass: profile.fClass, enable: body.enable, ...plan };
    if (!plan.supported) this.audit.failed(actor, 'LEGACY_CODING_PLAN', `${v.vin}:${f.featureId}`, plan.reason!, 'D05-07');
    else this.db.tx(() => this.audit.record(actor, 'LEGACY_CODING_PLAN', `${v.vin}:${f.featureId}`, { after: { enable: body.enable, commands: plan.commands }, componentId: 'D05-07' }));
    return out;
  }
}

@Controller('api/legacy-sdv')
export class LegacySdvController {
  constructor(private readonly svc: LegacySdvService) {}

  @Get('vehicles')
  vehicles() {
    return { items: this.svc.vehicles() };
  }

  @Post('translate')
  @HttpCode(200)
  @Roles('OPERATOR', 'VARIANT_OWNER')
  @AuditAction('LEGACY_CODING_PLAN')
  translate(@CurrentActor() actor: Actor, @Body(new ZodPipe(TranslateLegacyBody)) body: z.infer<typeof TranslateLegacyBody>) {
    return this.svc.translate(actor, body);
  }
}

// 현장 지원 포털 (D05-05) — 딜러·정비 현장이 VIN 하나로 차량의 Feature 상태를 한 번에 본다:
// 등록 정보·차량 측 적용(런타임)·서버 판단·사용 권한·걸린 긴급 차단·관련 이상 건·장애 이력. 현장 접수는 장애·VOC(D04-05)로 넘어간다.
import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { FieldCaseBody } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { ActivationService } from '../../d01-policy/activation/activation.service';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { KillRepo } from '../../d03-safety/kill-switch/kill.repo';
import { IncidentService } from '../../d04-ops/incident-voc/incident.service';
import { AnomalyService } from '../../d06-qsec/anomaly-response/anomaly.service';

@Injectable()
@PlatformComponent('D05-05')
export class FieldPortalService {
  constructor(
    private readonly fleet: FleetRepo,
    private readonly policies: PolicyRepo,
    private readonly activation: ActivationService,
    private readonly entitlements: EntitlementService,
    private readonly kills: KillRepo,
    private readonly anomalies: AnomalyService,
    private readonly incidents: IncidentService,
  ) {}

  async vehicle(vin: string) {
    const v = this.fleet.vehicle(vin);
    if (!v) throw new DomainError('NOT_FOUND', `${vin}은(는) 등록된 차량이 아닙니다.`);
    const decisions = await this.activation.decideAll(vin);
    const flags = decisions.map((d) => ({ flagKey: d.flagKey, featureId: d.policyId ? this.policies.get(d.policyId)?.featureId ?? null : null, value: d.value, reason: d.reason, policyId: d.policyId }));
    const featureIds = new Set(flags.map((f) => f.featureId));
    return {
      vehicle: v,
      flags,
      entitlements: this.entitlements.grants(vin).map((g) => ({ grantId: g.grantId, catalogId: g.catalogId, kind: g.kind, state: g.state, validTo: g.validTo, effective: g.effective })),
      kills: this.kills.active().filter((k) => !k.vins?.length || k.vins.includes(vin)).map((k) => ({ killId: k.killId, featureIds: k.featureIds, status: k.status, reason: k.reason })),
      anomalies: this.anomalies.list({}).filter((a) => (a.status === 'OPEN' || a.status === 'ACKNOWLEDGED') && (a.vins.includes(vin) || featureIds.has(a.featureId as string))).map((a) => ({ anomalyId: a.anomalyId, kind: a.kind, featureId: a.featureId, severity: a.severity, advice: a.advice, mine: a.vins.includes(vin) })),
      incidents: this.incidents.list().filter((i) => i.vin === vin).map((i) => ({ incidentId: i.incidentId, source: i.source, category: i.category, severity: i.severity, status: i.status, summary: i.summary, receivedAt: i.receivedAt })),
    };
  }

  createCase(actor: Actor, body: FieldCaseBody) {
    if (!this.fleet.vehicle(body.vin)) throw new DomainError('NOT_FOUND', `${body.vin}은(는) 등록된 차량이 아닙니다.`);
    return this.incidents.create(actor, { source: 'DEALER', vin: body.vin, featureId: body.featureId, category: body.category, severity: body.severity, summary: `[${body.dealer}] ${body.summary}`, occurredAt: null });
  }
}

@Controller('api/field')
export class FieldPortalController {
  constructor(private readonly svc: FieldPortalService) {}

  @Get('vehicles/:vin')
  vehicle(@Param('vin') vin: string) {
    return this.svc.vehicle(vin);
  }

  @Post('cases')
  @HttpCode(201)
  @Roles('OPERATOR')
  @AuditAction('FIELD_CASE')
  createCase(@CurrentActor() actor: Actor, @Body(new ZodPipe(FieldCaseBody)) body: FieldCaseBody) {
    return this.svc.createCase(actor, body);
  }
}

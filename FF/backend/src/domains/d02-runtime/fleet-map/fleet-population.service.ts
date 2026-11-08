// 대상 차량 모집단 (D02-03) — "5년 운영"(사용자 결정 2026-10-17). 판매된 차가 모두 대상은 아니다:
// 판매 → 서비스 시장 → 플랫폼 탑재 → 커넥티드 → 운행 중 깔때기는 contracts/rules/population(가정값 모델)이 계산하고,
// 화면 목록·분석은 가중 표본 행이 맡는다. 신차 등록은 IF-06 Fleet 연계의 모의 — 판매월마다 표본·수신 표본을 들인다.
import { Body, Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import { FleetOnboardBody, inService, platformStart, populationAt, VehicleRegisterBody, vehicleReferenceProblems, VehicleSchema, weightOf, type DatasetInfo, type FleetOnboard } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { ReferenceValuesService } from '../variant-conditions/reference-values.service';

/** meta.dataset — 5년 운영 데이터셋이면 개시일을 담는다. 없으면 시연 데이터셋 */
export function datasetInfo(db: Db): DatasetInfo {
  const r = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'dataset'");
  if (!r) return { kind: 'demo', start: null };
  try {
    const v = JSON.parse(r.value) as DatasetInfo;
    return v.kind === 'ops5y' ? { kind: 'ops5y', start: v.start ?? null } : { kind: 'demo', start: null };
  } catch {
    return { kind: 'demo', start: null };
  }
}

@Injectable()
@PlatformComponent('D02-03')
export class FleetPopulationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly references: ReferenceValuesService,
  ) {}

  /**
   * 운영 차량 등록(IF-06 Fleet 연계, 출시 준비 RD-OPS-03) — Fleet 구분 PRODUCTION. 판매국·차종·트림은 이 설치에 등록된 기준 값이어야 한다
   * (데모 목록을 그대로 받지 않는다). 같은 VIN·같은 차량 가명은 다시 받지 않는다. 그 차량에 낸 권한은 PRODUCTION 출처로 기록된다.
   */
  register(actor: Actor, body: VehicleRegisterBody) {
    if (this.fleet.vehicle(body.vin) || this.fleet.profiles().has(body.vin)) throw new DomainError('CONFLICT', `이미 등록된 차량입니다: ${body.vin}`);
    const problems = vehicleReferenceProblems(body, this.references.all());
    if (problems.length) throw new DomainError('VALIDATION', `${problems.join(' · ')} — 차량 사양 담당자가 기준 값(/master/reference-values)을 먼저 등록합니다.`, { problems });
    const v = VehicleSchema.parse({ ...body, fleet: 'PRODUCTION' });
    this.db.tx(() => {
      this.fleet.insertVehicle(v);
      this.audit.record(actor, 'FLEET_VEHICLE_REGISTER', v.vin, { after: { fleet: v.fleet, country: v.country, vehicleModel: v.vehicleModel, trim: v.trim, modelYear: v.modelYear }, reason: '운영 차량 등록(IF-06)', componentId: 'D02-03' });
    });
    return v;
  }

  population() {
    const today = this.entitlements.today();
    const dataset = datasetInfo(this.db);
    const start = dataset.start ?? platformStart(today);
    const sample = [...this.fleet.profiles().values()].filter((p) => p.source === 'SYNTHETIC' && p.soldMonth);
    const live = sample.filter((p) => inService(p, today));
    return {
      dataset,
      ...populationAt(start, today),
      sample: {
        rows: live.length,
        represented: Math.round(live.reduce((s, p) => s + weightOf(p), 0)),
        // 판매월 전이거나 말소된 표본
        inactive: sample.length - live.length,
        receivers: this.fleet.vehicleCounts().sample,
      },
    };
  }

  /** 신차 커넥티드 등록 — 같은 VIN은 다시 받지 않는다. 한 번의 등록이 감사 한 건 */
  onboard(actor: Actor, body: FleetOnboard) {
    const known = this.fleet.profiles();
    const dup = body.profiles.find((p) => known.has(p.vin)) ?? body.receivers.find((v) => this.fleet.vehicle(v.vin));
    if (dup) throw new DomainError('CONFLICT', `이미 등록된 차량입니다: ${dup.vin}`);
    const ids = new Set(body.profiles.map((p) => p.vin));
    const stray = body.receivers.find((v) => !ids.has(v.vin) && !known.has(v.vin));
    if (stray) throw new DomainError('VALIDATION', `수신 표본 ${stray.vin}은(는) 표본 성향이 함께 등록돼야 합니다.`);
    const receivers = body.receivers.map((v) => VehicleSchema.parse({ ...v, fleet: 'SAMPLE' }));
    this.db.tx(() => {
      for (const p of body.profiles) this.fleet.insertProfile(p);
      for (const v of receivers) this.fleet.insertVehicle(v);
      this.audit.record(actor, 'FLEET_ONBOARD', '/api/fleet/onboard', {
        after: { profiles: body.profiles.length, receivers: receivers.length, represented: Math.round(body.profiles.reduce((s, p) => s + weightOf(p), 0)) },
        reason: '신차 커넥티드 등록(IF-06 모의)',
        componentId: 'D02-03',
      });
    });
    return { profiles: body.profiles.length, receivers: receivers.length };
  }
}

@Controller('api/fleet')
export class FleetPopulationController {
  constructor(private readonly s: FleetPopulationService) {}

  @Get('population')
  population() {
    return this.s.population();
  }

  @Post('vehicles')
  @Roles('SYSTEM', 'VARIANT_OWNER')
  @AuditAction('FLEET_VEHICLE_REGISTER')
  register(@CurrentActor() actor: Actor, @Body(new ZodPipe(VehicleRegisterBody)) body: VehicleRegisterBody) {
    return this.s.register(actor, body);
  }

  @Post('onboard')
  @Roles('SYSTEM')
  onboard(@CurrentActor() actor: Actor, @Body(new ZodPipe(FleetOnboardBody)) body: FleetOnboard) {
    return this.s.onboard(actor, body);
  }
}

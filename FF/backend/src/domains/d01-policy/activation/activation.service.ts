// 정책 기반 활성화 제어 (D01-09) — 서버 기준 활성화 판단(PoC ③), contracts 단일 평가기(evaluateFlag).
import { Inject, Injectable } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, evaluateFlag, variantRow, type Entitlement, type FlagResult, type Policy, type RolloutStageBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';

import { EntitlementService } from '../entitlement/entitlement.service';
import { KILL_STATE, type KillState } from './kill-state';

@Injectable()
@PlatformComponent('D01-09')
export class ActivationService {
  constructor(
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly entitlements: EntitlementService,
    @Inject(KILL_STATE) private readonly kill: KillState,
  ) {}

  /** 서버 기준 활성화 판단 — 차량 하나·flag 하나 (PoC ③) */
  async decide(vin: string, flagKey: string): Promise<{ vehicle: unknown; policy: Policy; result: FlagResult; entitlement: { active: boolean; grants: Entitlement[] } }> {
    const vehicle = this.fleet.vehicle(vin);
    if (!vehicle) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const policy = this.policies.deployed(flagKey);
    if (!policy) throw new DomainError('NOT_FOUND', `${flagKey}로 배포된 정책이 없습니다.`);
    const f = this.features.get(policy.featureId, policy.featureVersion);
    if (!f) throw new DomainError('NOT_FOUND', `정책 대상 ${policy.featureId} ${policy.featureVersion}이(가) 없습니다.`);
    const entitlement = this.entitlements.activeFor(vin, policy.featureId);
    // 활성화 전 차량 지원 조건(FFG-VEH-006) — 기능 지원 조건 관리(D02-02)와 같은 판정
    const sup = variantRow({ ...f, featureId: policy.featureId, version: policy.featureVersion }, vehicle);
    const result = await evaluateFlag({
      policy,
      scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim },
      killed: this.kill.killed(policy.featureId, vin),
      vehicle,
      entitlementActive: policy.entitlementCatalogId ? entitlement.active : null,
      support: { verdict: sup.verdict, reason: sup.reason },
    });
    return { vehicle, policy, result, entitlement };
  }

  /** 차량 하나에 대해 배포된 모든 flag 평가 (OFREP bulk·차량 런타임 번들) */
  async decideAll(vin: string) {
    const keys = [...new Set(this.policies.all().filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))].sort();
    const out: FlagResult[] = [];
    for (const k of keys) out.push((await this.decide(vin, k)).result);
    return out;
  }
}

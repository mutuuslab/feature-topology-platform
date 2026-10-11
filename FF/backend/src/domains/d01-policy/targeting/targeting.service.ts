// 적용 대상 선정 규칙 (D01-04) — Fleet 차량과 FP-COHORT-1 코호트 소속.
import { Inject, Injectable } from '@nestjs/common';
import { cohortBucket, effectiveBasisPoints, evaluateFlag, type Entitlement, type FlagResult, type Policy, type RolloutStageBody } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { BaselineRepo, FeatureRepo, ProductRepo } from '../repos';


@Injectable()
@PlatformComponent('D01-04')
export class TargetingService {
  constructor(
    private readonly fleet: FleetRepo,
    private readonly policies: PolicyRepo,
  ) {}

  vehicles() {
    return this.fleet.vehicles();
  }

  /** flagKey 배포 정책의 실효 코호트에 Fleet 차량이 들어가는지 (FP-COHORT-1) */
  async cohort(flagKey: string, basisPoints?: number) {
    const p = this.policies.deployed(flagKey);
    if (!p) throw new DomainError('NOT_FOUND', `${flagKey}로 배포된 정책이 없습니다.`);
    const bp = basisPoints ?? effectiveBasisPoints(p);
    const rows = [];
    for (const v of this.fleet.vehicles()) {
      const bucket = await cohortBucket('1', p.flagKey, p.rollout.salt, v.vin);
      rows.push({ vin: v.vin, label: v.label, bucket, inCohort: bucket < bp });
    }
    return { flagKey, policyId: p.policyId, basisPoints: bp, algorithm: 'FP-COHORT-1', vehicles: rows };
  }
}

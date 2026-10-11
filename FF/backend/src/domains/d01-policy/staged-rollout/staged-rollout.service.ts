// 단계적 기능 배포 (D01-08) — 승인 범위 안에서 코호트 단계 조정(해시·승인 유지).
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
@PlatformComponent('D01-08')
export class StagedRolloutService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 배포된 정책의 단계 조정 — 승인 범위(rollout) 안에서만, 해시·승인은 그대로 */
  stage(actor: Actor, policyId: string, body: RolloutStageBody) {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    if (p.status !== 'DEPLOYED') throw new DomainError('GUARD_FAILED', `배포된 정책만 단계를 바꿀 수 있습니다 (현재 ${p.status}).`);
    const ceiling = effectiveBasisPoints({ ...p, stageBasisPoints: null });
    if (body.basisPoints > ceiling) {
      this.audit.failed(actor, 'ROLLOUT_STAGE', policyId, `승인 범위 ${ceiling / 100}% 초과 요청 ${body.basisPoints / 100}%`, 'D01-08');
      throw new DomainError('GUARD_FAILED', `승인된 배포 범위(${ceiling / 100}%)를 넘을 수 없습니다 — 정책을 새로 승인받으세요.`);
    }
    return this.db.tx(() => {
      const next: Policy = { ...p, stageBasisPoints: body.basisPoints };
      this.policies.update(next);
      this.audit.record(actor, 'ROLLOUT_STAGE', policyId, { before: { stage: p.stageBasisPoints }, after: { stage: body.basisPoints }, reason: body.reason, componentId: 'D01-08' });
      this.events.publish('rollout.staged', policyId, { flagKey: p.flagKey, from: p.stageBasisPoints, to: body.basisPoints }, { componentId: 'D01-08', correlationId: actor.correlationId });
      return next;
    });
  }
}

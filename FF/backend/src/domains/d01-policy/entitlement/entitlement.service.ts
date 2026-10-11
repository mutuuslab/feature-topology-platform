// 사용 권한 관리 (D01-05) — 체험권·구독·구매 권한, PoC ⑤ 체험 수락 시 1회 체험권 사용 처리.
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
@PlatformComponent('D01-05')
export class EntitlementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fleet: FleetRepo,
    private readonly products: ProductRepo,
    private readonly baselines: BaselineRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  grants(vin?: string) {
    const today = this.today();
    return this.fleet.grants(vin).map((g) => ({ ...g, effective: this.isActive(g, today) }));
  }

  private today() {
    return this.clock.kst().slice(0, 10);
  }

  private isActive(g: Entitlement, today: string) {
    return g.status === 'ACTIVE' && g.validFrom <= today && today <= g.validTo && (g.usesLeft === null || g.usesLeft > 0);
  }

  /** 이 차량이 이 Feature를 쓸 수 있는 유효한 권한이 있나 — 그 Feature의 Baseline을 구성에 가진 상품의 권한 */
  activeFor(vin: string, featureId: string): { active: boolean; grants: Entitlement[] } {
    const bls = this.baselines.forFeature(featureId).map((b) => b.baselineId);
    const cats = new Set(this.products.all().filter((p) => p.baselineIds.some((b) => bls.includes(b))).map((p) => p.catalogId));
    const today = this.today();
    const grants = this.fleet.grants(vin).filter((g) => cats.has(g.catalogId));
    return { active: grants.some((g) => this.isActive(g, today)), grants };
  }

  /** PoC ⑤ IVI에서 체험 수락 → 1회 체험권 사용 처리 */
  consume(actor: Actor, grantId: string) {
    const g = this.fleet.grant(grantId);
    if (!g) throw new DomainError('NOT_FOUND', `${grantId}을(를) 찾을 수 없습니다.`);
    if (!this.isActive(g, this.today())) {
      this.audit.failed(actor, 'ENTITLEMENT_CONSUME', grantId, `${g.status} 권한 사용 시도`, 'D01-05');
      throw new DomainError('GUARD_FAILED', `사용할 수 없는 권한입니다 (${g.status}, ${g.validFrom}~${g.validTo}, 남은 횟수 ${g.usesLeft ?? '무제한'}).`);
    }
    return this.db.tx(() => {
      const usesLeft = g.usesLeft === null ? null : g.usesLeft - 1;
      const next: Entitlement = { ...g, usesLeft, status: usesLeft === 0 ? 'CONSUMED' : 'ACTIVE' };
      this.fleet.updateGrant(next);
      this.audit.record(actor, 'ENTITLEMENT_CONSUME', grantId, { before: { usesLeft: g.usesLeft, status: g.status }, after: { usesLeft, status: next.status }, componentId: 'D01-05' });
      this.events.publish('entitlement.consumed', g.vin, { grantId, catalogId: g.catalogId, usesLeft, status: next.status }, { componentId: 'D01-05', correlationId: actor.correlationId });
      return next;
    });
  }
}

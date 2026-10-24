// 과금 시스템 연계 (D05-04) — 체험 → 구독·구매 전환. 결제는 모의 과금 시스템(if_call 'BILLING', 멱등 키 = 체험권:요금제)이 맡고,
// 결제가 확인되면 같은 트랜잭션에서 체험을 CONVERTED로, 새 구독·구매 권한을 만든다(D01-05).
import { Body, Controller, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { PurchaseTrialBody } from '@ff/contracts';
import { connectionStatuses } from '../../../kernel/connections';
import { DomainError } from '../../../kernel/errors';
import { isProduction } from '../../../kernel/runtime-config';
import { IfCallRepo } from '../../../adapters/if-call/if-call.repo';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { EntitlementService } from '../../d01-policy/entitlement/entitlement.service';

export interface BillingOrder {
  orderId: string;
  vin: string;
  catalogId: string;
  plan: '구독' | '구매';
  status: 'PAID';
}

@Injectable()
@PlatformComponent('D05-04')
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ifCalls: IfCallRepo,
    private readonly entitlements: EntitlementService,
  ) {}

  purchase(actor: Actor, grantId: string, plan: '구독' | '구매') {
    // 운영 모드에서 과금 연결이 실제가 아니면 결제를 만들지 않는다 — 모의 결제가 실제 구독·구매처럼 남지 않게(출시 준비 RD-UX-04)
    const billing = connectionStatuses(process.env).find((c) => c.key === 'billing');
    if (isProduction() && billing?.mode !== 'live') throw new DomainError('GUARD_FAILED', '과금 시스템이 아직 연결되지 않아 구독·구매를 처리할 수 없습니다. 연결 설정 뒤 다시 시도하세요.', { connection: 'billing', mode: billing?.mode });
    const trial = this.entitlements.convertible(actor, grantId);
    return this.db.tx(() => {
      const order = this.ifCalls.call<BillingOrder>('BILLING', `${grantId}:${plan}`, { vin: trial.vin, catalogId: trial.catalogId, plan }, () => ({
        orderId: `ORD-${String(this.ifCalls.next('BILLING')).padStart(5, '0')}`,
        vin: trial.vin,
        catalogId: trial.catalogId,
        plan,
        status: 'PAID',
      }));
      return { order, ...this.entitlements.convert(actor, trial, plan, order.orderId) };
    });
  }
}

@Controller('api/trials')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post(':grantId/purchase')
  @HttpCode(200)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('TRIAL_PURCHASE')
  purchase(@CurrentActor() actor: Actor, @Param('grantId') grantId: string, @Body(new ZodPipe(PurchaseTrialBody)) b: PurchaseTrialBody) {
    return this.billing.purchase(actor, grantId, b.plan);
  }
}

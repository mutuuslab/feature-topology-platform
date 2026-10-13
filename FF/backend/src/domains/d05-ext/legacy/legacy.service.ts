// Legacy 시스템 연계 (D05-03) — 해외공장 ERP·딜러 DMS가 쓰는 레거시 옵션 코드를 FEAT ID로 해석한다.
// 해외공장 주문(IF-12)을 가져와 옵션 코드를 매핑하고, 매핑이 없는 코드는 미해석으로 남겨 담당자가 매핑을 추가하게 한다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { ImportOrdersBody, resolveOrder } from '@ff/contracts';
import { z } from 'zod';
import { ExternalSystems } from '../../../adapters/if-mocks/external-systems';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../../d01-policy/repos';

type Resolved = ReturnType<typeof resolveOrder> & { importedAt: string };

@Injectable()
@PlatformComponent('D05-03')
export class LegacyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ext: ExternalSystems,
    private readonly features: FeatureRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 매핑 + 대상 Feature 이름 (데이터셋에 없는 FEAT를 가리키면 표시) */
  mappings() {
    return this.ext.legacyMappings().map((m) => {
      const f = this.features.versions(m.featureId).at(-1);
      return { ...m, featureName: f?.name ?? null, known: !!f };
    });
  }

  orders(plant?: string): Resolved[] {
    const rows = plant ? this.db.all<{ doc: string }>('SELECT doc FROM plant_order WHERE plant = ? ORDER BY order_id', plant) : this.db.all<{ doc: string }>('SELECT doc FROM plant_order ORDER BY order_id');
    return rows.map((r) => JSON.parse(r.doc));
  }

  /** 해외공장 주문 가져오기(IF-12) — 같은 주문은 다시 넣지 않고 해석만 갱신 */
  importOrders(actor: Actor, plant: string) {
    const mappings = this.ext.legacyMappings();
    const at = this.ext.now();
    const out = this.ext.plantOrders(plant).map((o) => ({ ...resolveOrder(o, mappings), importedAt: at }));
    this.db.tx(() => {
      for (const r of out) this.db.run('INSERT INTO plant_order (order_id, plant, vin, doc) VALUES (?, ?, ?, ?) ON CONFLICT(order_id) DO UPDATE SET doc = excluded.doc', r.orderId, r.plant, r.vin, JSON.stringify(r));
      const unresolved = [...new Set(out.flatMap((r) => r.unresolved))];
      this.audit.record(actor, 'PLANT_ORDER_IMPORT', plant, { after: { orders: out.length, unresolved }, componentId: 'D05-03' });
      this.events.publish('legacy.orders.imported', plant, { plant, orders: out.length, unresolved }, { componentId: 'D05-03', correlationId: actor.correlationId });
    });
    return { plant, orders: out, unresolved: [...new Set(out.flatMap((r) => r.unresolved))] };
  }
}

@Controller('api/legacy')
export class LegacyController {
  constructor(private readonly svc: LegacyService) {}

  @Get('mappings')
  mappings() {
    return { items: this.svc.mappings() };
  }

  @Get('orders')
  orders(@Query('plant') plant?: string) {
    return { items: this.svc.orders(plant) };
  }

  @Post('orders/import')
  @HttpCode(200)
  @Roles('OPERATOR', 'SYSTEM')
  @AuditAction('PLANT_ORDER_IMPORT')
  importOrders(@CurrentActor() actor: Actor, @Body(new ZodPipe(ImportOrdersBody)) body: z.infer<typeof ImportOrdersBody>) {
    return this.svc.importOrders(actor, body.plant);
  }
}

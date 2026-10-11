// 플랫폼 공통 조회 API — 상태 점검, 42 컴포넌트 현황, 이벤트 이력(+SSE), 감사 이력.
import { Controller, Get, Inject, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { AuditService, type AuditResult } from './audit.service';
import { ComponentRegistry } from './components';
import { DB, type Db } from './db';
import { EventService } from './event.service';

@Controller('api')
export class KernelController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ComponentRegistry,
    private readonly events: EventService,
    private readonly audit: AuditService,
  ) {}

  @Get('health')
  health() {
    const count = (t: string) => (this.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)?.n ?? 0);
    return {
      status: 'ok',
      seed: this.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seed'")?.value ?? null,
      counts: {
        features: count('feature_version'),
        baselines: count('baseline'),
        products: count('product'),
        dependencies: count('dependency'),
        gateRecords: count('gate_record'),
        events: count('events'),
        audit: count('audit'),
      },
    };
  }

  @Get('components')
  components() {
    const items = this.registry.view();
    return {
      total: items.length,
      implemented: items.filter((c) => c.status === 'implemented').length,
      registered: items.filter((c) => c.registered).length,
      unknownIds: this.registry.unknownIds(),
      items,
    };
  }

  @Get('events')
  listEvents(@Query('after') after?: string, @Query('type') type?: string, @Query('aggregate') aggregate?: string, @Query('limit') limit?: string) {
    return { items: this.events.list({ after: after ? Number(after) : 0, type, aggregate, limit: limit ? Number(limit) : undefined }) };
  }

  /** 실시간 이벤트 — EventSource('/api/events/stream?types=a,b') */
  @Sse('events/stream')
  stream(@Query('types') types?: string): Observable<MessageEvent> {
    return this.events.stream(types ? types.split(',') : undefined).pipe(map((e) => ({ id: String(e.seq), type: 'platform', data: e })));
  }

  @Get('audit')
  listAudit(@Query('target') target?: string, @Query('actorId') actorId?: string, @Query('result') result?: AuditResult, @Query('limit') limit?: string) {
    return { items: this.audit.list({ target, actorId, result, limit: limit ? Number(limit) : undefined }) };
  }
}

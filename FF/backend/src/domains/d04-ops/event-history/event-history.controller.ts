// 이벤트 이력 추적 (D04-04) — 커밋된 플랫폼 이벤트(outbox) 조회와 실시간 스트림(SSE).
import { Controller, Get, Injectable, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { periodBounds } from '@ff/contracts';
import { DomainError } from '../../../kernel/errors';
import { singleQuery } from '../../../kernel/paging';
import { PlatformComponent } from '../../../kernel/components';
import { EventService } from '../../../kernel/event.service';

@Injectable()
@PlatformComponent('D04-04')
export class EventHistoryService {
  constructor(private readonly events: EventService) {}
  list(q: { after?: number; type?: string; aggregate?: string; limit?: number; recent?: boolean; from?: string; to?: string }) {
    return this.events.list(q);
  }
  stream(types?: string[]) {
    return this.events.stream(types);
  }
}

@Controller('api/events')
export class EventHistoryController {
  constructor(private readonly history: EventHistoryService) {}

  /** 이벤트 이력 조회 — 유형·집계·발생 기간 조건 @req FR-EVT-002-004 */
  @Get()
  list(@Query('after') after?: string, @Query('type') type?: string, @Query('aggregate') aggregate?: string, @Query('limit') limit?: string, @Query('recent') recent?: string, @Query('from') from?: unknown, @Query('to') to?: unknown) {
    // after(순번)가 커서 — 페이지가 꽉 차면 다음 after를 nextCursor로 알려 준다(출시 준비 RD-UX-03)
    const n = Math.min(limit ? Number(limit) || 200 : 200, 1000);
    const tail = recent === '1' || recent === 'true';
    const period = periodBounds(singleQuery(from, 'from'), singleQuery(to, 'to'));
    if (period.error) throw new DomainError('VALIDATION', period.error, { field: 'from' });
    const items = this.history.list({ after: after ? Number(after) : 0, type, aggregate, limit: n, recent: tail, from: period.from, to: period.to });
    const last = items[items.length - 1];
    return { items, nextCursor: !tail && items.length === n && last ? String(last.seq) : null };
  }

  /** 실시간 — EventSource('/api/events/stream?types=a,b') */
  @Sse('stream')
  stream(@Query('types') types?: string): Observable<MessageEvent> {
    return this.history.stream(types ? types.split(',') : undefined).pipe(map((e) => ({ id: String(e.seq), type: 'platform', data: e })));
  }
}

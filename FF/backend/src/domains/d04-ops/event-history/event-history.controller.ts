// 이벤트 이력 추적 (D04-04) — 커밋된 플랫폼 이벤트(outbox) 조회와 실시간 스트림(SSE).
import { Controller, Get, Injectable, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { PlatformComponent } from '../../../kernel/components';
import { EventService } from '../../../kernel/event.service';

@Injectable()
@PlatformComponent('D04-04')
export class EventHistoryService {
  constructor(private readonly events: EventService) {}
  list(q: { after?: number; type?: string; aggregate?: string; limit?: number }) {
    return this.events.list(q);
  }
  stream(types?: string[]) {
    return this.events.stream(types);
  }
}

@Controller('api/events')
export class EventHistoryController {
  constructor(private readonly history: EventHistoryService) {}

  @Get()
  list(@Query('after') after?: string, @Query('type') type?: string, @Query('aggregate') aggregate?: string, @Query('limit') limit?: string) {
    // after(순번)가 커서 — 페이지가 꽉 차면 다음 after를 nextCursor로 알려 준다(출시 준비 RD-UX-03)
    const n = Math.min(limit ? Number(limit) || 200 : 200, 1000);
    const items = this.history.list({ after: after ? Number(after) : 0, type, aggregate, limit: n });
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === n && last ? String(last.seq) : null };
  }

  /** 실시간 — EventSource('/api/events/stream?types=a,b') */
  @Sse('stream')
  stream(@Query('types') types?: string): Observable<MessageEvent> {
    return this.history.stream(types ? types.split(',') : undefined).pipe(map((e) => ({ id: String(e.seq), type: 'platform', data: e })));
  }
}

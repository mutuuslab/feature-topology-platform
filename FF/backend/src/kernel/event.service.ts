// 이벤트 이력(outbox) — 변경과 같은 tx에서 events 테이블에 쓰고, 커밋된 뒤에만 구독자(SSE)에게 흘린다.
// 공통 이벤트·메시지 전달 계층(PPT)의 플랫폼 내부 구현. seq는 단조 증가 — 클라이언트는 ?after=seq로 이어 받는다.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject, filter } from 'rxjs';
import { Clock } from './clock';
import { DB, type Db } from './db';

export interface PlatformEvent<T = unknown> {
  seq: number;
  id: string;
  type: string;
  at: string;
  aggregate: string;
  componentId: string | null;
  correlationId: string | null;
  payload: T;
}

/** 발행 훅 — 이벤트와 같은 트랜잭션에서 돈다(예: 수신자 알림). 훅 안에서 다시 발행하지 않는다 */
export type PublishHook = (ev: PlatformEvent) => void;

@Injectable()
export class EventService {
  private readonly bus = new Subject<PlatformEvent>();
  private readonly hooks: PublishHook[] = [];
  private inHook = false;

  /** 같은 트랜잭션 훅 등록 — 훅이 던지면 변경 전체가 롤백된다(알림 없이 상태만 바뀌는 일이 없다) */
  onPublish(hook: PublishHook) {
    this.hooks.push(hook);
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 변경 tx 안에서 호출. 커밋되면 구독자에게 전달, 롤백되면 사라진다. */
  publish<T>(type: string, aggregate: string, payload: T, meta: { componentId?: string; correlationId?: string } = {}): PlatformEvent<T> {
    if (!this.db.inTransaction) throw new Error('EventService.publish는 변경과 같은 트랜잭션 안에서 호출해야 합니다');
    const ev = {
      id: randomUUID(),
      type,
      at: this.clock.iso(),
      aggregate,
      componentId: meta.componentId ?? null,
      correlationId: meta.correlationId ?? null,
      payload,
    };
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO events (id, type, at, aggregate, component_id, correlation_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ev.id,
      ev.type,
      ev.at,
      ev.aggregate,
      ev.componentId,
      ev.correlationId,
      JSON.stringify(payload),
    );
    const full = { seq: lastInsertRowid, ...ev };
    if (this.inHook) throw new Error('EventService 발행 훅 안에서는 이벤트를 다시 발행하지 않습니다');
    this.inHook = true;
    try {
      for (const h of this.hooks) h(full);
    } finally {
      this.inHook = false;
    }
    this.db.afterCommit(() => this.bus.next(full));
    return full;
  }

  list(q: { after?: number; type?: string; aggregate?: string; limit?: number } = {}): PlatformEvent[] {
    const where = ['seq > ?'];
    const params: (string | number)[] = [q.after ?? 0];
    if (q.type) (where.push('type = ?'), params.push(q.type));
    if (q.aggregate) (where.push('aggregate = ?'), params.push(q.aggregate));
    return this.db
      .all<any>(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ${Math.min(q.limit ?? 200, 1000)}`, ...params)
      .map((r) => ({
        seq: r.seq,
        id: r.id,
        type: r.type,
        at: r.at,
        aggregate: r.aggregate,
        componentId: r.component_id,
        correlationId: r.correlation_id,
        payload: JSON.parse(r.payload),
      }));
  }

  /** 커밋된 이벤트 실시간 스트림 */
  stream(types?: string[]): Observable<PlatformEvent> {
    return this.bus.asObservable().pipe(filter((e) => !types?.length || types.includes(e.type)));
  }
}

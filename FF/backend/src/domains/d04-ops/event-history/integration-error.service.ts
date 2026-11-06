// 연계·과금·서명·파이프라인 오류 이력 (D04-04 이벤트 이력 추적, 기능명세서 B6) — 실패한 변경은 롤백되므로 오류는 롤백 뒤 독립 트랜잭션으로
// 남긴다(감사 failed와 같은 자리). 한 건마다 오류 이벤트를 같은 트랜잭션에 발행해 수신자 규칙대로 알림이 나간다(B1).
import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { INTEGRATION_ERROR_EVENT, INTEGRATION_ERROR_SYSTEM_LABEL, INTEGRATION_ERROR_SYSTEMS, periodBounds, type IntegrationError, type IntegrationErrorSystem, type IntegrationErrorType } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { singleQuery } from '../../../kernel/paging';

export interface IntegrationErrorInput {
  system: IntegrationErrorSystem;
  errorType: IntegrationErrorType;
  target: string;
  message: string;
  featureId?: string | null;
  /** 오류가 난 시각(외부 시스템이 알려 준 시각) — 없으면 지금 */
  at?: string;
  /** 알림에 실을 원래 맥락(파이프라인 실행 ID·단계 등) — 이벤트 payload에만 더한다 */
  detail?: Record<string, unknown>;
}

@Injectable()
@PlatformComponent('D04-04')
export class IntegrationErrorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
  ) {}

  /**
   * 오류 한 건 — 롤백된 변경 밖(독립 트랜잭션)에서 부른다. 알림 이벤트를 같은 트랜잭션에 발행한다.
   * @req FR-LGCY-001-007, FR-BIL-001-003, FR-SDM-001-001
   */
  record(actor: Actor, e: IntegrationErrorInput): IntegrationError {
    if (this.db.inTransaction) throw new Error('오류 이력은 실패한 변경의 트랜잭션 밖에서 기록해야 합니다');
    return this.db.tx(() => {
      const n = this.db.get<{ n: number | null }>('SELECT max(id) AS n FROM integration_error')!.n ?? 0;
      const err: IntegrationError = {
        errorId: `ERR-${String(n + 1).padStart(5, '0')}`,
        at: e.at ?? this.clock.iso(),
        system: e.system,
        systemName: INTEGRATION_ERROR_SYSTEM_LABEL[e.system],
        errorType: e.errorType,
        target: e.target,
        message: e.message.slice(0, 1000),
        actorId: actor.id,
        featureId: e.featureId ?? null,
        correlationId: actor.correlationId ?? null,
      };
      this.db.run('INSERT INTO integration_error (error_id, at, system, error_type, target, doc) VALUES (?, ?, ?, ?, ?, ?)', err.errorId, err.at, err.system, err.errorType, err.target, JSON.stringify(err));
      this.events.publish(INTEGRATION_ERROR_EVENT[e.system], err.errorId, { ...(e.detail ?? {}), ...err }, { componentId: 'D04-04', correlationId: actor.correlationId });
      return err;
    });
  }

  /** 오류 이력 — 최신 순, 시스템·기간 조건 */
  list(q: { system?: IntegrationErrorSystem; from?: string; to?: string; limit?: number } = {}): IntegrationError[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.system) (where.push('system = ?'), params.push(q.system));
    if (q.from) (where.push('at >= ?'), params.push(q.from));
    if (q.to) (where.push('at < ?'), params.push(q.to));
    const limit = Math.min(Math.max(Math.floor(q.limit ?? 200), 1), 1000);
    return this.db
      .all<{ doc: string }>(`SELECT doc FROM integration_error ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`, ...params)
      .map((r) => JSON.parse(r.doc) as IntegrationError);
  }
}

@Controller('api/integrations/errors')
export class IntegrationErrorController {
  constructor(private readonly errors: IntegrationErrorService) {}

  @Get()
  list(@Query('system') system?: unknown, @Query('from') from?: unknown, @Query('to') to?: unknown, @Query('limit') limit?: unknown) {
    const s = singleQuery(system, 'system')?.trim() || undefined;
    if (s && !(INTEGRATION_ERROR_SYSTEMS as readonly string[]).includes(s)) throw new DomainError('VALIDATION', `알 수 없는 연계 시스템입니다: ${s}`, { field: 'system' });
    const p = periodBounds(singleQuery(from, 'from'), singleQuery(to, 'to'));
    if (p.error) throw new DomainError('VALIDATION', p.error, { field: 'from' });
    const lim = singleQuery(limit, 'limit');
    const items = this.errors.list({ system: s as IntegrationErrorSystem | undefined, from: p.from, to: p.to, limit: lim ? Number(lim) || 200 : 200 });
    const counts = Object.fromEntries(INTEGRATION_ERROR_SYSTEMS.map((k) => [k, items.filter((i) => i.system === k).length]));
    return { items, counts };
  }
}

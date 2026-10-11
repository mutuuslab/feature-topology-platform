// 감사 이력 관리(D01-10)의 저장 계층. 허용된 변경은 변경과 같은 tx 안에서, 거부·실패는 독립 tx로 남긴다.
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from './actor';
import { Clock } from './clock';
import { DB, type Db } from './db';

export type AuditResult = 'ALLOWED' | 'DENIED' | 'FAILED';

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  target: string;
  result: AuditResult;
  reason: string | null;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  componentId: string | null;
}

export interface AuditQuery {
  target?: string;
  actorId?: string;
  result?: AuditResult;
  limit?: number;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 허용된 변경 기록 — 반드시 변경과 같은 db.tx() 안에서 호출한다. */
  record(actor: Actor, action: string, target: string, change: { before?: unknown; after?: unknown; reason?: string; componentId?: string }) {
    if (!this.db.inTransaction) throw new Error('AuditService.record는 변경과 같은 트랜잭션 안에서 호출해야 합니다');
    this.insert(actor, action, target, 'ALLOWED', change);
  }

  /** 거부 기록 — 변경이 일어나지 않았으므로 독립 트랜잭션. */
  denied(actor: Actor, action: string, target: string, reason: string, componentId?: string) {
    this.write(() => this.insert(actor, action, target, 'DENIED', { reason, componentId }));
  }

  /** 실패 기록 — 변경 tx가 롤백된 뒤 남긴다. */
  failed(actor: Actor, action: string, target: string, reason: string, componentId?: string) {
    this.write(() => this.insert(actor, action, target, 'FAILED', { reason, componentId }));
  }

  list(q: AuditQuery = {}): AuditEntry[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.target) (where.push('target = ?'), params.push(q.target));
    if (q.actorId) (where.push('actor_id = ?'), params.push(q.actorId));
    if (q.result) (where.push('result = ?'), params.push(q.result));
    const sql = `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(q.limit ?? 200, 1000)}`;
    return this.db.all<any>(sql, ...params).map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      action: r.action,
      target: r.target,
      result: r.result,
      reason: r.reason,
      before: r.before_doc ? JSON.parse(r.before_doc) : null,
      after: r.after_doc ? JSON.parse(r.after_doc) : null,
      correlationId: r.correlation_id,
      componentId: r.component_id,
    }));
  }

  private write(fn: () => void) {
    // 진행 중인 tx 안에서 호출되면 그 tx가 롤백될 때 함께 사라지므로, 커밋/롤백 이후로 미룰 수 없는 경우를 막는다.
    if (this.db.inTransaction) throw new Error('거부·실패 감사는 트랜잭션 밖에서 기록해야 합니다');
    this.db.tx(fn);
  }

  private insert(actor: Actor, action: string, target: string, result: AuditResult, c: { before?: unknown; after?: unknown; reason?: string; componentId?: string }) {
    this.db.run(
      `INSERT INTO audit (at, actor_id, actor_role, action, target, result, reason, before_doc, after_doc, correlation_id, component_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.clock.iso(),
      actor.id,
      actor.role,
      action,
      target,
      result,
      c.reason ?? null,
      c.before === undefined ? null : JSON.stringify(c.before),
      c.after === undefined ? null : JSON.stringify(c.after),
      actor.correlationId,
      c.componentId ?? null,
    );
  }
}

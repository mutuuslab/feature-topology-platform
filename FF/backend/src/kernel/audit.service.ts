// 감사 이력 관리(D01-10)의 저장 계층. 허용된 변경은 변경과 같은 tx 안에서, 거부·실패는 독립 tx로 남긴다.
// 보고서 v1.1 FFG-PLT-015: 추가 전용 + 해시 체인 — 행마다 hash = sha256(prev_hash ‖ 정규화 내용), 삭제·수정은 DB 트리거가 막는다(012_trust).
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { canonicalJson } from '@ff/contracts';
import { sha256hex } from './crypto';
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

export const AUDIT_GENESIS = 'GENESIS';

export interface ChainReport {
  ok: boolean;
  verified: number;
  head: string | null;
  /** 처음 어긋난 행 — 내용이 바뀌었거나(hash) 앞 행과 끊겼다(prev) */
  broken: { id: number; kind: 'hash' | 'prev' } | null;
}

/** 해시 입력 — 저장된 열 그대로(JSON 문자열 포함), 키 정렬 */
function chainContent(r: any) {
  return canonicalJson({ at: r.at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, target: r.target, result: r.result, reason: r.reason, before: r.before_doc, after: r.after_doc, correlationId: r.correlation_id, componentId: r.component_id });
}
export const chainHash = (prev: string, row: unknown) => sha256hex(`${prev}\n${chainContent(row)}`);

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** 해시 체인 도입 전 행(hash 없음)을 id 순으로 채운다 — 트리거는 hash가 비어 있는 행의 갱신만 허용 */
  onModuleInit() {
    const todo = this.db.all<any>('SELECT * FROM audit WHERE hash IS NULL ORDER BY id');
    if (!todo.length) return;
    this.db.tx(() => {
      let prev = this.db.get<{ hash: string }>('SELECT hash FROM audit WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1')?.hash ?? AUDIT_GENESIS;
      for (const r of todo) {
        const hash = chainHash(prev, r);
        this.db.run('UPDATE audit SET prev_hash = ?, hash = ? WHERE id = ?', prev, hash, r.id);
        prev = hash;
      }
    });
  }

  /**
   * 체인 검증 — 모든 행의 내용 해시와 앞 행 연결을 다시 계산한다.
   * @rule FFG-PLT-015 — 추가 전용 저장소(트리거)·해시 체인 위변조 검출. 시장 Profile 보존 기간은 WP10에서
   */
  verifyChain(): ChainReport {
    const rows = this.db.all<any>('SELECT * FROM audit ORDER BY id');
    let prev = AUDIT_GENESIS;
    for (const r of rows) {
      if (r.prev_hash !== prev) return { ok: false, verified: rows.indexOf(r), head: prev, broken: { id: r.id, kind: 'prev' } };
      if (r.hash !== chainHash(prev, r)) return { ok: false, verified: rows.indexOf(r), head: prev, broken: { id: r.id, kind: 'hash' } };
      prev = r.hash;
    }
    return { ok: true, verified: rows.length, head: rows.length ? prev : null, broken: null };
  }

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
    const row = {
      at: this.clock.iso(),
      actor_id: actor.id,
      actor_role: actor.role,
      action,
      target,
      result,
      reason: c.reason ?? null,
      before_doc: c.before === undefined ? null : JSON.stringify(c.before),
      after_doc: c.after === undefined ? null : JSON.stringify(c.after),
      correlation_id: actor.correlationId ?? null,
      component_id: c.componentId ?? null,
    };
    // 같은 tx 안에서 직전 행의 해시를 이어 받는다(SQLite 쓰기는 직렬화되므로 체인이 갈라지지 않는다)
    const prev = this.db.get<{ hash: string | null }>('SELECT hash FROM audit ORDER BY id DESC LIMIT 1')?.hash ?? AUDIT_GENESIS;
    this.db.run(
      `INSERT INTO audit (at, actor_id, actor_role, action, target, result, reason, before_doc, after_doc, correlation_id, component_id, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.at,
      row.actor_id,
      row.actor_role,
      row.action,
      row.target,
      row.result,
      row.reason,
      row.before_doc,
      row.after_doc,
      row.correlation_id,
      row.component_id,
      prev,
      chainHash(prev, row),
    );
  }
}

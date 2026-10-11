// 긴급 차단 요청 저장소 — KILL_STATE 포트의 실제 구현. 서버 평가기(D01-09)의 KILL 단계가 여기서 결정된다.
import { Inject, Injectable } from '@nestjs/common';
import type { KillRequest } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';
import type { KillState } from '../../d01-policy/activation/kill-state';

@Injectable()
export class KillRepo implements KillState {
  constructor(@Inject(DB) private readonly db: Db) {}

  nextId(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM kill_request')!.n + 1;
    return `KILL-${String(n).padStart(5, '0')}`;
  }
  insert(k: KillRequest) {
    this.db.run('INSERT INTO kill_request (kill_id, feature_id, status, doc) VALUES (?, ?, ?, ?)', k.killId, k.featureId, k.status, JSON.stringify(k));
  }
  update(k: KillRequest) {
    this.db.run('UPDATE kill_request SET status = ?, doc = ? WHERE kill_id = ?', k.status, JSON.stringify(k), k.killId);
  }
  get(id: string): KillRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM kill_request WHERE kill_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(status?: string): KillRequest[] {
    const rows = status ? this.db.all<{ doc: string }>('SELECT doc FROM kill_request WHERE status = ? ORDER BY kill_id DESC', status) : this.db.all<{ doc: string }>('SELECT doc FROM kill_request ORDER BY kill_id DESC');
    return rows.map((r) => JSON.parse(r.doc));
  }
  active(): KillRequest[] {
    return this.list('ACTIVE');
  }

  /** 이 차량에서 이 Feature가 차단 중인가 — 차단 대상 Feature(의존 포함)·차량 범위 모두에 들어야 한다 */
  killed(featureId: string, vin: string): boolean {
    return this.active().some((k) => k.featureIds.includes(featureId) && k.vins.includes(vin));
  }
}

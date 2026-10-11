// 외부 연계 호출 기록 — IF별 멱등 키로 같은 요청을 두 번 보내지 않고, 처음 응답을 돌려준다(IF-05·IF-09·IF-13 모의 어댑터 공용).
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';

export interface IfCall {
  ifId: string;
  key: string;
  at: string;
  request: unknown;
  response: unknown;
}

@Injectable()
export class IfCallRepo {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  call<T>(ifId: string, key: string, request: unknown, respond: () => T): T {
    const prev = this.db.get<{ doc: string }>('SELECT doc FROM if_call WHERE if_id = ? AND idem_key = ?', ifId, key);
    if (prev) return (JSON.parse(prev.doc) as IfCall).response as T;
    const response = respond();
    const c: IfCall = { ifId, key, at: this.clock.iso(), request, response };
    this.db.run('INSERT INTO if_call (if_id, idem_key, at, doc) VALUES (?, ?, ?, ?)', ifId, key, c.at, JSON.stringify(c));
    return response;
  }

  /** IF별 다음 일련번호 (캠페인·TMS 접수 번호) */
  next(ifId: string): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM if_call WHERE if_id = ?', ifId)!.n + 1;
  }

  list(q: { ifId?: string; key?: string } = {}): IfCall[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.ifId) (where.push('if_id = ?'), params.push(q.ifId));
    if (q.key) (where.push('idem_key = ?'), params.push(q.key));
    return this.db.all<{ doc: string }>(`SELECT doc FROM if_call ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`, ...params).map((r) => JSON.parse(r.doc));
  }
}

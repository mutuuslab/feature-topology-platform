// Legacy↔SDV 메시지 변환 기록(FR-SDVI-001-002) — 방향·형식·결과, 실패면 사유와 발생 시점. 추가만(legacy_message_log, migration 162).
import type { LegacyMessageLogView } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

export function appendLegacyMessage(db: Db, e: Omit<LegacyMessageLogView, 'messageId'>): LegacyMessageLogView {
  const write = () => {
    const n = (db.get<{ n: number | null }>('SELECT max(id) AS n FROM legacy_message_log')?.n ?? 0) + 1;
    const row: LegacyMessageLogView = { messageId: `LMSG-${String(n).padStart(5, '0')}`, ...e };
    db.run('INSERT INTO legacy_message_log (message_id, at, direction, vin, status, doc) VALUES (?, ?, ?, ?, ?, ?)', row.messageId, row.at, row.direction, row.vin, row.status, JSON.stringify(row));
    return row;
  };
  return db.inTransaction ? write() : db.tx(write);
}

export function legacyMessages(db: Db, q: { vin?: string; status?: string; limit?: number } = {}): LegacyMessageLogView[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.vin) (where.push('vin = ?'), params.push(q.vin));
  if (q.status) (where.push('status = ?'), params.push(q.status));
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 200), 1), 1000);
  return db.all<{ doc: string }>(`SELECT doc FROM legacy_message_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`, ...params).map((r) => JSON.parse(r.doc));
}

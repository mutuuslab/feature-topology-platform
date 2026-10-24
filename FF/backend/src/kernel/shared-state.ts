// 공유 상태 — 프로세스 메모리에 두던 상태를 DB로(출시 준비 RD-OPS-14, docs/20-architecture/20-92 §3).
// 같은 DB를 쓰는 인스턴스(SQLite 파일·PostgreSQL)가 함께 본다. 1단계로 옮긴 것: 멱등 키 처리 중 예약·차량별 요청 빈도 창.
// 아직 메모리인 것(SSE 버스·예약 작업·출처별 요청 제한)은 20-92 §3 표 — 그래서 v1은 단일 인스턴스 임대(instance-lease.ts)를 건다.
// 만료 시각은 벽시계(Date.now) — 시험 시계(Clock)를 멈춰도 죽은 인스턴스의 예약은 풀린다. 창 카운터는 호출자가 준 시각을 쓴다.
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Db } from './db';

/** 앱 인스턴스 식별 — 예약·임대의 주인(한 프로세스에 앱이 둘이어도 다르다) */
export const newHolder = () => `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface Reservation {
  ok: boolean;
  /** 잡지 못했을 때 — 지금 주인의 값·주인 */
  value?: string;
  holder?: string;
}

export interface SharedStateStore {
  /** 처리 중 예약 — 비었거나 만료됐으면 잡는다. 남이 잡고 있으면 그 값(예: 본문 해시)과 주인 */
  reserve(slot: string, value: string, ttlMs: number): Reservation;
  /** 내가 잡은 예약만 푼다 */
  release(slot: string): void;
  /** 고정 창 카운터 — 이번 요청이 창 안 몇 번째인지(n)와 창 시작(ms) */
  hit(key: string, windowMs: number, nowMs: number): { n: number; start: number };
}

export const SHARED_STATE = Symbol('SHARED_STATE');

/** DB 구현 — 커널 모듈이 SHARED_STATE로 공급한다(useFactory) */
export class DbSharedState implements SharedStateStore {
  constructor(
    private readonly db: Db,
    readonly holder: string = newHolder(),
    private readonly wallNow: () => number = Date.now,
  ) {}

  reserve(slot: string, value: string, ttlMs: number): Reservation {
    const now = this.wallNow();
    // 만료된 예약 치우기 → 원자적 삽입(기본 키 충돌이면 남의 것). 두 인스턴스가 동시에 와도 한쪽만 들어간다
    this.db.run('DELETE FROM shared_reservation WHERE slot = ? AND expires_at <= ?', slot, now);
    const ins = this.db.run('INSERT OR IGNORE INTO shared_reservation (slot, value, holder, expires_at) VALUES (?, ?, ?, ?)', slot, value, this.holder, now + ttlMs);
    if (ins.changes === 1) return { ok: true };
    const cur = this.db.get<{ value: string; holder: string }>('SELECT value, holder FROM shared_reservation WHERE slot = ?', slot);
    // 사이에 풀렸으면 한 번 더
    if (!cur) return this.db.run('INSERT OR IGNORE INTO shared_reservation (slot, value, holder, expires_at) VALUES (?, ?, ?, ?)', slot, value, this.holder, now + ttlMs).changes === 1 ? { ok: true } : { ok: false, value: '', holder: '' };
    return { ok: false, value: cur.value, holder: cur.holder };
  }

  release(slot: string) {
    this.db.run('DELETE FROM shared_reservation WHERE slot = ? AND holder = ?', slot, this.holder);
  }

  hit(key: string, windowMs: number, nowMs: number) {
    // 창이 지났으면 새 창(1), 아니면 +1 — 갱신 식은 갱신 전 행을 본다(SQLite·PG 같다)
    const r = this.db.get<{ n: number; start_ms: number }>(
      `INSERT INTO shared_counter (key, start_ms, n) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         n = CASE WHEN ? - shared_counter.start_ms >= ? THEN 1 ELSE shared_counter.n + 1 END,
         start_ms = CASE WHEN ? - shared_counter.start_ms >= ? THEN ? ELSE shared_counter.start_ms END
       RETURNING n, start_ms`,
      key,
      nowMs,
      nowMs,
      windowMs,
      nowMs,
      windowMs,
      nowMs,
    );
    return { n: Number(r!.n), start: Number(r!.start_ms) };
  }
}

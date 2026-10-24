// 영속 계층 — node:sqlite(동기 API)를 얇은 Db 인터페이스 뒤에 둔다. Postgres로 바꿀 때 이 파일만 교체.
// 규칙: 상태 전이 + 감사 + 이벤트(outbox)는 반드시 같은 tx() 안에서 쓴다(상세설계서: 전이와 Audit 한 트랜잭션).
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

// vite/vitest가 'node:sqlite'의 접두사를 벗겨 해석에 실패하므로 런타임 내장 모듈 조회로 가져온다.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export type Row = Record<string, unknown>;
type Param = string | number | bigint | null | Uint8Array;

export const DB = Symbol('DB');

export interface Db {
  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number };
  get<T = Row>(sql: string, ...params: Param[]): T | undefined;
  all<T = Row>(sql: string, ...params: Param[]): T[];
  exec(sql: string): void;
  /** 트랜잭션. 중첩 호출은 SAVEPOINT로 처리한다. 예외가 나면 롤백 후 다시 던진다. */
  tx<T>(fn: () => T): T;
  /** 바깥 트랜잭션이 커밋된 뒤 실행 (롤백되면 버림). 트랜잭션 밖이면 즉시 실행. */
  afterCommit(fn: () => void): void;
  readonly inTransaction: boolean;
  close(): void;
}

export class SqliteDb implements Db {
  private readonly db: DatabaseSyncT;
  private depth = 0;
  private pending: (() => void)[] = [];

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    // secure_delete — 지운·덮어쓴 내용을 0으로 채운다(봉인 전 평문 비밀이 빈 페이지에 남지 않게, RD-SEC-06)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;');
    // 읽기 캐시 — 기본 2 MiB 페이지 캐시는 감사 100만·이벤트 50만 행 DB에서 흩어진 행 읽기(대상별 이벤트·감사)가 매번 디스크로 갔다.
    // 64 MiB 캐시 + 256 MiB 메모리 매핑(읽기만, 쓰기·내구성 설정은 그대로). 출시 준비 RD-P2-01 부하 시험
    this.db.exec('PRAGMA cache_size = -65536; PRAGMA mmap_size = 268435456;');
  }

  get inTransaction() {
    return this.depth > 0;
  }

  run(sql: string, ...params: Param[]) {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get<T = Row>(sql: string, ...params: Param[]) {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  exec(sql: string) {
    this.db.exec(sql);
  }

  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error('tx() 콜백은 동기 함수여야 합니다 (node:sqlite는 동기 API)');
      this.depth--;
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      if (this.depth === 0) this.flush();
      return out;
    } catch (e) {
      this.depth--;
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      if (this.depth === 0) this.pending = [];
      throw e;
    }
  }

  afterCommit(fn: () => void) {
    if (this.depth === 0) fn();
    else this.pending.push(fn);
  }

  private flush() {
    const list = this.pending;
    this.pending = [];
    for (const fn of list) fn();
  }

  close() {
    this.db.close();
  }
}

/** 마이그레이션을 이름 순으로 한 번씩 적용한다 (SQL은 migrations.ts에 문자열로 둔다 — 빌드 산출물에 자동 포함). */
export function migrate(db: Db, migrations: { name: string; sql: string }[]): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', m.name, new Date().toISOString());
    });
    applied.push(m.name);
  }
  return applied;
}

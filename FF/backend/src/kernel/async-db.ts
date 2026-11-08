// 비동기 Db 인터페이스 — PostgreSQL 이전 2단계의 목표 계약(D-RD-3, docs/20-architecture/20-92 §4.2).
// 지금 코드는 동기 Db(db.ts)를 쓰고, PG에서는 동기 다리(pg-sync-db.ts)로 돈다. 다리는 호환을 재는 발판이지 운영 처리량의 답이 아니다:
// 질의마다 주 스레드를 막는다. 그래서 호출부를 이 인터페이스로 하나씩 옮긴다 — 커널·어댑터(배경 작업·외부 연계) 먼저, 요청 경로는 그 뒤.
//   · PgPoolDb — pg.Pool, 트랜잭션은 연결 하나를 빌려 BEGIN … COMMIT (await 사이에 다른 요청이 끼지 않는다)
//   · SqliteAsyncDb — 동기 SQLite를 감싼다. 트랜잭션은 같은 연결에서 순서대로(뮤텍스) — 같은 연결을 쓰는 동기 호출과 섞이지 않게
//     파일 DB는 전용 연결을 따로 연다(asyncDbOf). :memory:는 연결을 나눌 수 없어 같은 연결을 쓴다(시험·데모 전용)
// SQL은 동기 Db와 같은 SQLite 방언으로 쓰고 PG 쪽이 번역한다(pg-dialect.ts) — 방언을 바꾸는 일은 이전이 끝난 뒤.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { SqliteDb, type Db, type Row } from './db';
import { MIGRATIONS } from './migrations';
import { dialectContextOf, translate, type DialectContext } from './pg-dialect';
import { PgSyncDb } from './pg-sync-db';

type Param = string | number | bigint | null | Uint8Array;

export interface AsyncQueries {
  run(sql: string, ...params: Param[]): Promise<{ changes: number; lastInsertRowid: number }>;
  get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T = Row>(sql: string, ...params: Param[]): Promise<T[]>;
}

export interface AsyncDb extends AsyncQueries {
  readonly dialect: 'sqlite' | 'postgres';
  /** 트랜잭션 — fn 안에서는 받은 t만 쓴다. 예외면 롤백 후 다시 던진다 */
  tx<T>(fn: (t: AsyncQueries) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---- PostgreSQL ----

interface PgQueryable {
  query(q: { text: string; values?: unknown[] }): Promise<{ rows: Row[]; rowCount: number | null }>;
}
interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgQueryable & { release(err?: unknown): void }>;
  end(): Promise<void>;
  on(ev: 'error', fn: (e: Error) => void): void;
}

const requireHere = () => createRequire(typeof __filename === 'string' ? __filename : join(process.cwd(), 'index.js'));
const toPg = (ps: Param[]) => ps.map((p) => (p instanceof Uint8Array ? Buffer.from(p) : typeof p === 'bigint' ? String(p) : p));

function pgQueries(q: () => PgQueryable, ctx: DialectContext): AsyncQueries {
  const exec = async (sql: string, params: Param[]) => {
    const t = translate(sql, ctx);
    if (t.noop) return { t, rows: [] as Row[], rowCount: 0 };
    const r = await q().query({ text: t.text, values: toPg(params) });
    if (!t.keepRowid) for (const row of r.rows) delete row.rowid;
    return { t, rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    async run(sql, ...params) {
      const { t, rows, rowCount } = await exec(sql, params);
      return { changes: rowCount, lastInsertRowid: Number((t.returnsId && rows[0] ? Object.values(rows[0])[0] : 0) ?? 0) };
    },
    async get<T>(sql: string, ...params: Param[]) {
      return (await exec(sql, params)).rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: Param[]) {
      return (await exec(sql, params)).rows as T[];
    },
  };
}

export class PgPoolDb implements AsyncDb {
  readonly dialect = 'postgres' as const;
  private readonly pool: PgPoolLike;
  private readonly q: AsyncQueries;

  constructor(opts: { url: string; schema?: string; max?: number; ctx?: DialectContext }) {
    const pg = requireHere()('pg');
    const int = (v: string) => Number(v);
    const types = { getTypeParser: (oid: number, fmt?: string) => (oid === 20 || oid === 1700 ? int : pg.types.getTypeParser(oid, fmt)) };
    const schema = opts.schema && opts.schema !== 'public' ? opts.schema : null;
    this.pool = new pg.Pool({ connectionString: opts.url, max: opts.max ?? 4, idleTimeoutMillis: 10_000, application_name: 'ff-backend-async', types, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
    this.pool.on('error', () => undefined); // 유휴 연결 끊김 — 다음 질의가 새 연결을 맺는다
    const ctx = opts.ctx ?? dialectContextOf(MIGRATIONS);
    this.ctx = ctx;
    this.q = pgQueries(() => this.pool, ctx);
  }
  private readonly ctx: DialectContext;

  run(sql: string, ...p: Param[]) {
    return this.q.run(sql, ...p);
  }
  get<T = Row>(sql: string, ...p: Param[]) {
    return this.q.get<T>(sql, ...p);
  }
  all<T = Row>(sql: string, ...p: Param[]) {
    return this.q.all<T>(sql, ...p);
  }

  async tx<T>(fn: (t: AsyncQueries) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query({ text: 'BEGIN' });
      const out = await fn(pgQueries(() => c, this.ctx));
      await c.query({ text: 'COMMIT' });
      return out;
    } catch (e) {
      await c.query({ text: 'ROLLBACK' }).catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  close() {
    return this.pool.end();
  }
}

// ---- SQLite ----

export class SqliteAsyncDb implements AsyncDb {
  readonly dialect = 'sqlite' as const;
  private chain: Promise<unknown> = Promise.resolve();

  /** owned — 이 객체가 연 전용 연결이면 close()에서 닫는다 */
  constructor(
    private readonly db: Db,
    private readonly owned = false,
  ) {}

  async run(sql: string, ...p: Param[]) {
    return this.db.run(sql, ...p);
  }
  async get<T = Row>(sql: string, ...p: Param[]) {
    return this.db.get<T>(sql, ...p);
  }
  async all<T = Row>(sql: string, ...p: Param[]) {
    return this.db.all<T>(sql, ...p);
  }

  tx<T>(fn: (t: AsyncQueries) => Promise<T>): Promise<T> {
    const go = async () => {
      if (this.db.inTransaction) throw new Error('동기 트랜잭션 안에서 비동기 트랜잭션을 열 수 없습니다');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this);
        this.db.exec('COMMIT');
        return out;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    };
    const p = this.chain.then(go, go);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async close() {
    await this.chain;
    if (this.owned) this.db.close();
  }
}

/** 동기 Db와 같은 저장소를 보는 비동기 Db — PG는 풀, SQLite 파일은 전용 연결, :memory:는 같은 연결 */
export function asyncDbOf(db: Db, sqliteFile?: string): AsyncDb {
  if (db instanceof PgSyncDb) return new PgPoolDb({ url: db.url, schema: db.schema, max: 2, ctx: db.ctx });
  if (sqliteFile && sqliteFile !== ':memory:') {
    const own = new SqliteDb(sqliteFile);
    own.exec('PRAGMA busy_timeout = 5000'); // 주 연결이 쓰는 중이면 잠깐 기다린다
    return new SqliteAsyncDb(own, true);
  }
  return new SqliteAsyncDb(db);
}

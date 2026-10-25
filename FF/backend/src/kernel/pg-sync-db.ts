// PostgreSQL 동기 다리(1단계) — 기존 동기 Db 인터페이스를 그대로 PG에서 돌린다(D-RD-3, docs/20-architecture/20-92 §4).
// 코드 전체(수백 곳)가 db.get()/run()/tx(() => …) 동기 호출이라 한 번에 비동기로 바꿀 수 없다. 1단계는
//   · 워커 스레드 하나가 pg 연결을 들고, 주 스레드는 Atomics.wait로 결과를 기다린다(동기 호출 유지)
//   · SQL은 실행 직전에 SQLite → PG 방언으로 번역한다(pg-dialect.ts)
// 그래서 같은 시험 묶음을 PG에서 그대로 돌려 호환률을 잰다(npm run test:pg). 주 스레드를 막는 점은 node:sqlite와 같고
// 왕복 지연만 더해진다 — 운영 처리량은 2단계(비동기 Db로 호출부 이전, async-db.ts) 뒤에 본다. 지금 PG는 미리보기.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import type { Db, Row } from './db';
import { dialectContextOf, splitStatements, translate, translateMigration, type DialectContext } from './pg-dialect';

type Param = string | number | bigint | null | Uint8Array;

/** 워커 본문(CommonJS eval) — pg 연결별로 질의를 순서대로 실행하고 결과를 돌려준 뒤 깃발을 올린다 */
const WORKER = `
const { workerData } = require('node:worker_threads');
const pg = require(workerData.pgPath);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
const flag = new Int32Array(workerData.flag);
const port = workerData.port;
const conns = new Map();
const admins = new Map();
const reply = (msg) => { port.postMessage(msg); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const fail = (e) => reply({ error: { message: String(e && e.message || e), code: e && e.code, detail: e && e.detail } });
const conv = (ps) => (ps || []).map((p) => (p instanceof Uint8Array ? Buffer.from(p) : typeof p === 'bigint' ? String(p) : p));
port.on('message', async (m) => {
  try {
    if (m.op === 'admin') {
      let a = admins.get(m.url);
      if (!a) {
        a = new pg.Client({ connectionString: m.url, application_name: 'ff-admin' });
        a.on('error', () => {});
        await a.connect();
        admins.set(m.url, a);
      }
      const r = await a.query({ text: m.text, values: m.params || [] });
      return reply({ rows: r.rows, rowCount: r.rowCount });
    }
    if (m.op === 'open') {
      const c = new pg.Client({ connectionString: m.url, application_name: 'ff-backend' });
      c.on('error', () => {});
      await c.connect();
      if (m.createSchema) await c.query('CREATE SCHEMA IF NOT EXISTS "' + m.schema + '"');
      await c.query('SET search_path TO "' + m.schema + '"');
      await c.query("SET lock_timeout = '15s'");
      await c.query("SET TIME ZONE 'UTC'");
      conns.set(m.id, { c, schema: m.schema, drop: m.dropOnClose });
      return reply({ ok: true });
    }
    const k = conns.get(m.id);
    if (!k) throw new Error('PG 연결이 닫혔습니다');
    if (m.op === 'query') {
      if (m.guard) await k.c.query('SAVEPOINT ff_stmt');
      try {
        const r = await k.c.query({ text: m.text, values: conv(m.params) });
        if (m.guard) await k.c.query('RELEASE SAVEPOINT ff_stmt');
        return reply({ rows: r.rows, rowCount: r.rowCount });
      } catch (e) {
        if (m.guard) await k.c.query('ROLLBACK TO SAVEPOINT ff_stmt; RELEASE SAVEPOINT ff_stmt').catch(() => {});
        throw e;
      }
    }
    if (m.op === 'exec') {
      await k.c.query(m.text);
      return reply({ ok: true });
    }
    if (m.op === 'close') {
      conns.delete(m.id);
      if (k.drop) await k.c.query('DROP SCHEMA IF EXISTS "' + k.schema + '" CASCADE').catch(() => {});
      await k.c.end().catch(() => {});
      return reply({ ok: true });
    }
    throw new Error('알 수 없는 연산 ' + m.op);
  } catch (e) { fail(e); }
});
`;

/** 이 파일 기준으로 패키지를 찾는다(빌드 산출물·vitest 양쪽) */
function localRequire() {
  const here = typeof __filename === 'string' ? __filename : join(process.cwd(), 'index.js');
  return createRequire(here);
}

let bridge: { port: MessagePort; flag: Int32Array; worker: Worker } | null = null;
let nextId = 1;
const TIMEOUT_MS = 120_000;

/** 다리 통계 — 왕복 수·누적 시간(ms). 호환 하네스가 PG 시험 시간의 원인을 보고한다 */
export const pgBridgeStats = { calls: 0, ms: 0, byText: new Map<string, { n: number; ms: number }>() };
const TRACE = !!process.env.FF_PG_TRACE;
/** 문장 보호 — SQLite는 트랜잭션 안 한 문이 실패해도 트랜잭션이 살아 있지만 PG는 통째로 중단된다. 켜면 문마다 SAVEPOINT로
 *  SQLite처럼 만든다(왕복 3배). 기본은 끔 — 실패를 잡아 계속하는 코드는 중첩 tx()(SAVEPOINT)를 쓴다(20-92 §5 위험 R4) */
const GUARD = process.env.FF_PG_STATEMENT_GUARD === '1';

function call(msg: Record<string, unknown>): any {
  const t0 = performance.now();
  try {
    return callRaw(msg);
  } finally {
    const dt = performance.now() - t0;
    pgBridgeStats.calls++;
    pgBridgeStats.ms += dt;
    if (TRACE) {
      const k = String(msg.text ?? msg.op).slice(0, 120);
      const e = pgBridgeStats.byText.get(k) ?? { n: 0, ms: 0 };
      e.n++;
      e.ms += dt;
      pgBridgeStats.byText.set(k, e);
    }
  }
}

function callRaw(msg: Record<string, unknown>): any {
  if (!bridge) {
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(WORKER, { eval: true, workerData: { pgPath: localRequire().resolve('pg'), flag: flag.buffer, port: port2 }, transferList: [port2] });
    worker.unref();
    port1.unref();
    bridge = { port: port1, flag, worker };
  }
  const b = bridge;
  Atomics.store(b.flag, 0, 0);
  b.port.postMessage(msg);
  if (Atomics.wait(b.flag, 0, 0, TIMEOUT_MS) === 'timed-out') throw new Error(`PostgreSQL 응답이 ${TIMEOUT_MS / 1000}초 동안 없습니다`);
  const got = receiveMessageOnPort(b.port);
  if (!got) throw new Error('PostgreSQL 다리에서 응답을 받지 못했습니다');
  const r = got.message;
  if (r.error) {
    const e = new Error(r.error.message) as Error & { code?: string; detail?: string };
    e.code = r.error.code;
    e.detail = r.error.detail;
    throw e;
  }
  return r;
}

export interface PgOptions {
  url: string;
  /** 기본 public. 'fresh'면 새 임시 스키마를 만들고 닫을 때 지운다(시험) */
  schema?: string;
  /** 방언 번역 문맥 — 보통 dialectContextOf(MIGRATIONS) */
  ctx?: DialectContext;
  /** 연결을 닫은 뒤 할 일(시험용 복제 DB 지우기) */
  onClose?: () => void;
}

/** 관리 연결로 한 문 — 데이터베이스 만들기·지우기·잠금(연결 URL마다 하나를 재사용한다) */
export function pgAdmin<T = Row>(url: string, text: string, ...params: Param[]): T[] {
  return call({ op: 'admin', url, text, params }).rows as T[];
}

export class PgSyncDb implements Db {
  readonly dialect = 'postgres' as const;
  private readonly id = nextId++;
  private depth = 0;
  private pending: (() => void)[] = [];
  private closed = false;
  readonly schema: string;
  readonly ctx: DialectContext;
  /** 연결 주소 — 같은 DB를 보는 비동기 풀(async-db.ts)을 열 때 */
  readonly url: string;
  private readonly cache = new Map<string, ReturnType<typeof translate>>();

  constructor(opts: PgOptions) {
    const fresh = opts.schema === 'fresh';
    this.schema = fresh ? `ff_t_${process.pid}_${this.id}_${Date.now().toString(36)}` : (opts.schema ?? 'public');
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new Error(`스키마 이름이 올바르지 않습니다: ${this.schema}`);
    this.ctx = opts.ctx ?? dialectContextOf([]);
    this.onClose = opts.onClose;
    this.url = opts.url;
    call({ op: 'open', id: this.id, url: opts.url, schema: this.schema, createSchema: fresh || this.schema !== 'public', dropOnClose: fresh });
  }

  private readonly onClose?: () => void;

  get inTransaction() {
    return this.depth > 0;
  }

  private t(sql: string) {
    let t = this.cache.get(sql);
    if (!t) {
      t = translate(sql, this.ctx);
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(sql, t);
    }
    return t;
  }

  private q(sql: string, params: Param[]) {
    const t = this.t(sql);
    if (t.noop) return { t, rows: [] as Row[], rowCount: 0 };
    let r;
    try {
      r = call({ op: 'query', id: this.id, text: t.text, params, guard: GUARD && this.depth > 0 });
    } catch (e) {
      if (e instanceof Error) e.message += ` — PG: ${t.text.slice(0, 300)}`;
      throw e;
    }
    const rows: Row[] = r.rows;
    if (!t.keepRowid) for (const row of rows) delete row.rowid;
    return { t, rows, rowCount: r.rowCount ?? 0 };
  }

  run(sql: string, ...params: Param[]) {
    const { t, rows, rowCount } = this.q(sql, params);
    const first = t.returnsId && rows[0] ? Object.values(rows[0])[0] : 0;
    return { changes: rowCount, lastInsertRowid: Number(first ?? 0) };
  }
  get<T = Row>(sql: string, ...params: Param[]) {
    return this.q(sql, params).rows[0] as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]) {
    return this.q(sql, params).rows as T[];
  }

  /** 여러 문 — DDL로 번역한다(CREATE TABLE에 rowid, 트리거 변환). 새 표·트리거는 번역 문맥에 더한다 */
  exec(sql: string) {
    const more = dialectContextOf([{ sql }]);
    for (const [k, v] of more.intKey) this.ctx.intKey.set(k, v);
    for (const [k, v] of more.triggerTable) this.ctx.triggerTable.set(k, v);
    this.execText(translateMigration({ sql }, this.ctx));
  }

  private execText(text: string) {
    if (!text.trim()) return;
    try {
      call({ op: 'exec', id: this.id, text });
    } catch (e) {
      if (e instanceof Error) e.message += ` — PG: ${text.slice(0, 300)}`;
      throw e;
    }
  }

  /** 마이그레이션 실행용 — pg 덮어쓰기가 있으면 그것을 쓴다 */
  execMigration(m: { sql: string; pg?: string }) {
    this.execText(translateMigration(m, this.ctx));
  }

  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    call({ op: 'exec', id: this.id, text: this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}` });
    this.depth++;
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error('tx() 콜백은 동기 함수여야 합니다 (동기 Db 계약)');
      this.depth--;
      call({ op: 'exec', id: this.id, text: this.depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${sp}` });
      if (this.depth === 0) this.flush();
      return out;
    } catch (e) {
      this.depth--;
      call({ op: 'exec', id: this.id, text: this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}` });
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
    if (this.closed) return;
    this.closed = true;
    call({ op: 'close', id: this.id });
    this.onClose?.();
  }
}

export { splitStatements };

// 단일 인스턴스 임대 + 공유 상태(출시 준비 RD-OPS-14, docs/20-architecture/20-92 §3).
// 같은 DB(SQLite 파일 — npm run test:pg에서는 PostgreSQL)를 쓰는 앱 인스턴스 둘을 한 프로세스에 띄워 본다.
//   · 기본(임대 켜짐): 두 번째 인스턴스는 부팅을 거부한다. 앞 인스턴스가 끝나면 뜬다. 죽은 인스턴스의 임대는 기한 뒤 풀린다
//   · 다중 인스턴스 경로(FF_INSTANCE_LOCK=off — 검증용, 운영 모드 거부): 멱등 키 처리 중 예약·차량 요청 빈도 창이 인스턴스 사이에 공유된다
// 고치기 전: 예약·빈도 창이 프로세스 메모리(Map)라 다른 인스턴스에 같은 키가 오면 두 번 실행됐고, 두 번째 인스턴스도 그냥 떴다.
// readiness: RD-OPS-14
import { Body, Controller, INestApplication, Post, type Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { Roles } from '../../src/kernel/actor';
import { migrate, SqliteDb, type Db } from '../../src/kernel/db';
import { acquireLease, InstanceLeaseHeld } from '../../src/kernel/instance-lease';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf } from '../../src/kernel/pg-dialect';
import { pgAdmin, PgSyncDb } from '../../src/kernel/pg-sync-db';
import { DbSharedState } from '../../src/kernel/shared-state';
import { actor } from '../helpers';

const PG = process.env.FF_TEST_PG_URL?.trim();
const ENV_KEYS = ['FF_DB', 'FF_DB_URL', 'FF_SEED', 'FF_INSTANCE_LOCK'] as const;
const root = mkdtempSync(join(tmpdir(), 'ff-multi-'));
const made: string[] = [];

/** 같은 저장소를 가리키는 설정 — SQLite 파일 또는(PG 하네스) 새 PG 데이터베이스 */
function sharedStore(name: string): { env: Record<string, string>; open: () => Db } {
  if (PG) {
    const db = `ff_t_multi_${process.pid}_${name}`;
    pgAdmin(PG, `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    pgAdmin(PG, `CREATE DATABASE "${db}"`);
    made.push(db);
    const u = new URL(PG);
    u.pathname = `/${db}`;
    const url = u.toString();
    return { env: { FF_DB_URL: url }, open: () => new PgSyncDb({ url, ctx: dialectContextOf(MIGRATIONS) }) };
  }
  const file = join(root, `${name}.db`);
  return { env: { FF_DB: file }, open: () => new SqliteDb(file) };
}

async function boot(env: Record<string, string>, controllers: Type<unknown>[] = []) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { FF_SEED: 'v0.81' }, env);
  try {
    const mod = await Test.createTestingModule({ imports: [AppModule], controllers }).compile();
    const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false, rawBody: true });
    await app.init();
    return { app, http: () => request(app.getHttpServer()) };
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
  }
}

afterAll(() => {
  if (PG) for (const d of made) pgAdmin(PG, `DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows가 닫히지 않은 DB 파일을 잠근다 */
  }
});

let runs = 0;
let release: () => void = () => undefined;

@Controller('api/_test-multi')
class SlowController {
  @Post('slow')
  @Roles('FEATURE_AUTHOR')
  async slow(@Body() body: { n: number }) {
    runs++;
    await new Promise<void>((r) => (release = r));
    return { ok: true, n: body.n, runs };
  }
}

describe('단일 인스턴스 임대 — 한 DB에 인스턴스 하나', () => {
  it('두 번째 인스턴스는 부팅을 거부하고, 앞 인스턴스가 끝나면 뜬다', async () => {
    const store = sharedStore('lease');
    const a = await boot(store.env);
    await expect(boot(store.env)).rejects.toThrow(/다른 인스턴스\(.+\)가 이 DB를 쓰고 있습니다/);
    await a.app.close();
    const b = await boot(store.env);
    await b.http().get('/api/health/live').expect(200);
    await b.app.close();
  });

  it('비정상 종료로 남은 임대는 기한이 지나면 새 인스턴스가 잡는다', () => {
    const store = sharedStore('expiry');
    const db = store.open();
    try {
      migrate(db, MIGRATIONS);
      const t0 = Date.parse('2026-10-25T00:00:00Z');
      acquireLease(db, 'dead-host:1', 20_000, t0);
      expect(() => acquireLease(db, 'new-host:2', 20_000, t0 + 19_000)).toThrow(InstanceLeaseHeld);
      expect(() => acquireLease(db, 'new-host:2', 20_000, t0 + 20_001)).not.toThrow();
      expect(db.get<{ holder: string }>("SELECT holder FROM instance_lease WHERE name = 'app'")?.holder).toBe('new-host:2');
      // 같은 호스트: 주인 프로세스가 살아 있으면 기다리고, 이미 없으면(재시작) 기한 전이라도 바로 잡는다
      const t1 = t0 + 30_000;
      db.run("DELETE FROM instance_lease WHERE name = 'app'");
      acquireLease(db, `${hostname()}:${process.ppid}:alive`, 20_000, t1);
      expect(() => acquireLease(db, `${hostname()}:${process.pid}:me`, 20_000, t1 + 1000)).toThrow(InstanceLeaseHeld);
      db.run("DELETE FROM instance_lease WHERE name = 'app'");
      acquireLease(db, `${hostname()}:999999999:gone`, 20_000, t1);
      expect(() => acquireLease(db, `${hostname()}:${process.pid}:me`, 20_000, t1 + 1000)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe('공유 상태 — 같은 DB의 두 인스턴스가 함께 본다', () => {
  it('처리 중 예약: 한쪽이 잡으면 다른 쪽은 그 값을 보고, 놓으면 잡는다. 주인이 죽으면 기한 뒤 풀린다', () => {
    const store = sharedStore('reserve');
    const dbA = store.open();
    const dbB = store.open();
    try {
      migrate(dbA, MIGRATIONS);
      let wall = 1_000_000;
      const a = new DbSharedState(dbA, 'A', () => wall);
      const b = new DbSharedState(dbB, 'B', () => wall);
      expect(a.reserve('idem:k1', 'hash-1', 60_000).ok).toBe(true);
      expect(b.reserve('idem:k1', 'hash-1', 60_000)).toMatchObject({ ok: false, value: 'hash-1', holder: 'A' });
      b.release('idem:k1'); // 남의 예약은 풀지 못한다
      expect(b.reserve('idem:k1', 'hash-1', 60_000).ok).toBe(false);
      a.release('idem:k1');
      expect(b.reserve('idem:k1', 'hash-1', 60_000).ok).toBe(true);
      wall += 60_001; // B가 죽었다 — 기한 뒤 A가 잡는다
      expect(a.reserve('idem:k1', 'hash-2', 60_000).ok).toBe(true);
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it('고정 창 카운터: 두 인스턴스의 요청을 함께 세고, 창이 지나면 새로 센다', () => {
    const store = sharedStore('counter');
    const dbA = store.open();
    const dbB = store.open();
    try {
      migrate(dbA, MIGRATIONS);
      const a = new DbSharedState(dbA, 'A');
      const b = new DbSharedState(dbB, 'B');
      expect(a.hit('vehicle-rate:VIN1', 60_000, 1000)).toEqual({ n: 1, start: 1000 });
      expect(b.hit('vehicle-rate:VIN1', 60_000, 2000)).toEqual({ n: 2, start: 1000 });
      expect(a.hit('vehicle-rate:VIN1', 60_000, 3000)).toEqual({ n: 3, start: 1000 });
      expect(b.hit('vehicle-rate:VIN2', 60_000, 3000)).toEqual({ n: 1, start: 3000 });
      expect(b.hit('vehicle-rate:VIN1', 60_000, 61_000)).toEqual({ n: 1, start: 61_000 });
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it('멱등 키: 인스턴스 A가 처리 중인 키가 인스턴스 B에 오면 409, 끝난 뒤 B는 처음 응답을 돌려준다(한 번만 실행)', async () => {
    const store = sharedStore('idem');
    const multi = { ...store.env, FF_INSTANCE_LOCK: 'off' };
    const A = await boot(multi, [SlowController]);
    const B = await boot(multi, [SlowController]);
    try {
      const h = { ...actor('u1', 'FEATURE_AUTHOR'), 'Idempotency-Key': 'multi-1' };
      runs = 0;
      const first = A.http().post('/api/_test-multi/slow').set(h).send({ n: 1 }).then((r) => r);
      for (let i = 0; i < 200 && runs === 0; i++) await new Promise((r) => setTimeout(r, 10));
      expect(runs).toBe(1);
      const second = await B.http().post('/api/_test-multi/slow').set(h).send({ n: 1 });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
      const other = await B.http().post('/api/_test-multi/slow').set(h).send({ n: 2 });
      expect(other.status).toBe(422);
      release();
      const a = await first;
      expect(a.status).toBe(201);
      const replay = await B.http().post('/api/_test-multi/slow').set(h).send({ n: 1 });
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(a.body);
      expect(runs).toBe(1);
    } finally {
      await A.app.close();
      await B.app.close();
    }
  });
});

// 데이터 이전 SQLite → PostgreSQL(D-RD-3, 20-92 §5) — 옮긴 뒤 감사 해시 체인을 대상에서 다시 계산해 원본 끝과 맞춘다.
// PG 부분은 npm run test:pg(FF_TEST_PG_URL)에서만 돈다. 체인 재계산 자체는 기본 verify에서도 본다.
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { AuditService, chainHash } from '../../src/kernel/audit.service';
import { DB, SqliteDb, type Db } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf } from '../../src/kernel/pg-dialect';
import { pgAdmin, PgSyncDb } from '../../src/kernel/pg-sync-db';
import { copySqliteToPg, recomputeChain } from '../../src/ops/sqlite-to-pg';
import { actor } from '../helpers';

const PG = process.env.FF_TEST_PG_URL?.trim();
const root = mkdtempSync(join(tmpdir(), 'ff-to-pg-'));
const KEY = 'k'.repeat(40);
const ENV_KEYS = ['FF_DB', 'FF_DB_URL', 'FF_SEED', 'FF_AUDIT_KEY', 'FF_AUDIT_ANCHOR_FILE', 'FF_INSTANCE_ID'] as const;
const made: string[] = [];
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const feature = (name: string) => ({ name, description: `${name} 설명`, country: 'KR', vehicleModel: 'NE1', trim: 'Base', ownerId: 'usr-author', asil: 'QM' });

function pgDb(name: string): { url: string; open: () => PgSyncDb } {
  const db = `ff_t_topg_${process.pid}_${name}`;
  pgAdmin(PG!, `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  pgAdmin(PG!, `CREATE DATABASE "${db}"`);
  made.push(db);
  const u = new URL(PG!);
  u.pathname = `/${db}`;
  return { url: u.toString(), open: () => new PgSyncDb({ url: u.toString(), ctx: dialectContextOf(MIGRATIONS) }) };
}

async function boot(env: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  // 감사 고정점 설정은 호출 때 읽힌다 — 다음 부팅·afterAll까지 남겨 둔다
  Object.assign(process.env, { FF_AUDIT_KEY: KEY, FF_INSTANCE_ID: 'oem-a' }, env);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  return { app, http: () => request(app.getHttpServer()), audit: app.get(AuditService), db: app.get<Db>(DB) };
}

afterAll(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  if (PG) for (const d of made) pgAdmin(PG, `DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 파일 잠금 */
  }
});

describe('감사 체인 다시 계산', () => {
  it('값이 하나라도 바뀐 행을 찾는다', () => {
    // 체인을 직접 만든다 — recomputeChain이 같은 규칙(chainHash)으로 다시 계산하는지
    const rows: Record<string, unknown>[] = [];
    let prev = 'GENESIS';
    for (let i = 1; i <= 3; i++) {
      const r = { id: i, at: `2026-10-25T00:00:0${i}Z`, actor_id: 'u', actor_role: 'R', action: 'A', target: `t${i}`, result: 'ALLOWED', reason: null, before_doc: null, after_doc: '{"x":1}', correlation_id: null, component_id: null, prev_hash: prev };
      prev = chainHash(prev, r);
      rows.push({ ...r, hash: prev });
    }
    expect(recomputeChain(rows)).toEqual({ head: prev, brokenAt: null });
    expect(recomputeChain(rows.map((r) => (r.id === 2 ? { ...r, after_doc: '{"x":2}' } : r))).brokenAt).toBe(2);
  });
});

describe.skipIf(!PG)('SQLite 파일 → PostgreSQL 데이터 이전', () => {
  it('옮긴 뒤 PG로 부팅하면 데이터가 같고 감사 체인·DB 밖 고정점 검증이 통과한다', async () => {
    const dir = join(root, 'live');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'ff.db');
    const anchor = join(dir, 'audit-anchor.jsonl');
    const live = await boot({ FF_DB: file, FF_SEED: 'v0.81', FF_AUDIT_ANCHOR_FILE: anchor });
    await live.http().post('/api/features').set(AUTHOR).send(feature('이전 전 기능')).expect(201);
    live.audit.anchor();
    const ids = (await live.http().get('/api/features').expect(200)).body.items.map((f: { featureId: string }) => f.featureId).sort();
    const chain = live.audit.verifyChain();
    expect(chain.ok).toBe(true);
    await live.app.close();

    const target = pgDb('copy');
    const dst = target.open();
    const r = copySqliteToPg({ from: file, to: dst });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.audit).toMatchObject({ rows: chain.verified, head: chain.head, sourceHead: chain.head, brokenAt: null });
    expect(r.tables.find((t) => t.name === 'feature_version')?.rows).toBe(ids.length);
    // 빈 DB에만 — 두 번째 이전은 거부
    expect(() => copySqliteToPg({ from: file, to: dst })).toThrow(/비어 있지 않습니다/);
    dst.close();

    const pg = await boot({ FF_DB_URL: target.url, FF_SEED: 'none', FF_AUDIT_ANCHOR_FILE: anchor });
    try {
      const after = pg.audit.verifyChain();
      expect(after, JSON.stringify(after.broken)).toMatchObject({ ok: true, broken: null, head: chain.head });
      expect(after.anchors.checked).toBeGreaterThan(0);
      expect((await pg.http().get('/api/features').expect(200)).body.items.map((f: { featureId: string }) => f.featureId).sort()).toEqual(ids);
      // PG에서 일을 이어 가도 체인이 이어지고, 새 감사 id는 옮긴 끝 다음이다(순번 맞춤)
      await pg.http().post('/api/features').set(AUTHOR).send(feature('이전 뒤 기능')).expect(201);
      expect(pg.audit.verifyChain().ok).toBe(true);
      expect(Number(pg.db.get<{ m: number }>('SELECT max(id) AS m FROM audit')?.m)).toBeGreaterThan(chain.verified);
    } finally {
      await pg.app.close();
    }
  });

  it('마이그레이션을 다 마치지 않은 원본은 거부한다', () => {
    const file = join(root, 'old.db');
    const old = new SqliteDb(file);
    old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    old.close();
    const dst = pgDb('old').open();
    try {
      expect(() => copySqliteToPg({ from: file, to: dst })).toThrow(/마이그레이션을 모두 마치지 않았습니다/);
    } finally {
      dst.close();
    }
  });
});

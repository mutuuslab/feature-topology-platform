// 백업·복원 연습(drill)과 보존 기한 — 출시 준비 RD-OPS-09 (설치 안내서 §8).
// 돌고 있는 앱의 파일 DB를 온라인 백업 → 백업 뒤에도 일을 더 한다 → 앱을 닫고 새 자리에 복원 → 복원본으로 앱을 띄운다 →
// 감사 체인 검증(verifyChain)이 고정점까지 통과하고 데이터는 백업 시점과 같다(백업 뒤의 일은 없다).
// readiness: RD-OPS-09
Object.assign(process.env, { FF_SCHEDULER: 'manual', FF_SYNTHETIC: '0' });
import { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/kernel/audit.service';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { HOUSEKEEPING, HousekeepingService, retentionDays } from '../../src/kernel/housekeeping.service';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { backup, listBackups, pruneBackups, restore, verifyBackup } from '../../src/ops/backup';
import { runCli } from '../../src/ops/backup-cli';
import { actor } from '../helpers';

const root = mkdtempSync(join(tmpdir(), 'ff-backup-'));
const LIVE = { db: join(root, 'live', 'ff.db'), anchor: join(root, 'live-anchor', 'audit-anchor.jsonl') };
const RESTORED = { db: join(root, 'restored', 'ff.db'), anchor: join(root, 'restored-anchor', 'audit-anchor.jsonl') };
const BACKUPS = join(root, 'backups');
mkdirSync(join(root, 'live'));
mkdirSync(join(root, 'live-anchor'));
const KEY = 'k'.repeat(40);
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const feature = (name: string) => ({ name, description: `${name} 설명`, country: 'KR', vehicleModel: 'NE1', trim: 'Base', ownerId: 'usr-author', asil: 'QM' });

async function boot(paths: { db: string; anchor: string }, seed: string) {
  Object.assign(process.env, { FF_DB: paths.db, FF_SEED: seed, FF_AUDIT_KEY: KEY, FF_AUDIT_ANCHOR_FILE: paths.anchor, FF_INSTANCE_ID: 'oem-a' });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  return { app, http: () => request(app.getHttpServer()), audit: app.get(AuditService), db: app.get<Db>(DB) };
}

afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'FF_SYNTHETIC', 'FF_DB', 'FF_SEED', 'FF_AUDIT_KEY', 'FF_AUDIT_ANCHOR_FILE', 'FF_INSTANCE_ID']) delete process.env[k];
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows가 실패한 시험의 DB 파일을 잠근다 */
  }
});

describe('백업·복원 연습', () => {
  let backupDir = '';
  let before: { features: number; audit: number; head: string | null; ids: string[] };

  it('돌고 있는 앱의 DB를 온라인 백업한다 — 감사 끝까지의 고정점만 담는다', async () => {
    const live = await boot(LIVE, 'v0.81');
    for (const n of ['백업 전 기능 A', '백업 전 기능 B']) await live.http().post('/api/features').set(AUTHOR).send(feature(n)).expect(201);
    live.audit.anchor();
    const ids = (await live.http().get('/api/features').expect(200)).body.items.map((f: { featureId: string }) => f.featureId).sort();
    const chain = live.audit.verifyChain();
    expect(chain.ok).toBe(true);
    before = { features: ids.length, audit: chain.verified, head: chain.head, ids };

    // 앱이 연 채로 백업(WAL 모드 — 앱의 쓰기와 함께 간다)
    const r = backup({ db: LIVE.db, outDir: BACKUPS, anchorFile: LIVE.anchor, instance: 'oem-a', now: new Date('2026-10-24T03:00:00Z') });
    backupDir = r.dir;
    expect(r.manifest.audit).toMatchObject({ count: before.audit, headHash: before.head });
    expect(r.manifest.counts.feature_version).toBe(before.features);
    expect(r.manifest.integrity).toBe('ok');
    expect(r.manifest.anchor?.lines).toBeGreaterThan(0);
    expect(r.manifest.migrations).toEqual(MIGRATIONS.map((m) => m.name).sort());

    // 백업 뒤의 일 — 복원본에는 없어야 한다. 고정점도 백업에 없는 행을 가리킨다
    await live.http().post('/api/features').set(AUTHOR).send(feature('백업 뒤 기능 C')).expect(201);
    live.audit.anchor();
    await live.app.close();
    const anchoredIds = readFileSync(LIVE.anchor, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id as number);
    expect(Math.max(...anchoredIds)).toBeGreaterThan(r.manifest.audit.headId!);
    // 백업의 고정점은 백업 끝 이하만
    const kept = readFileSync(join(backupDir, 'audit-anchor.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id as number);
    expect(Math.max(...kept)).toBeLessThanOrEqual(r.manifest.audit.headId!);
    expect(r.manifest.anchor?.skippedAfterHead).toBe(0);
  });

  it('새 자리에 복원 → 앱 부팅 → 감사 체인·고정점 검증 통과, 데이터는 백업 시점과 같다', async () => {
    const r = restore({ from: backupDir, db: RESTORED.db, anchorFile: RESTORED.anchor });
    expect(r.movedAside).toEqual([]);
    const app = await boot(RESTORED, 'none');
    const chain = app.audit.verifyChain();
    expect(chain, JSON.stringify(chain.broken)).toMatchObject({ ok: true, broken: null });
    expect(chain.anchors.configured).toBe(true);
    expect(chain.anchors.checked).toBeGreaterThan(0);
    const ids = (await app.http().get('/api/features').expect(200)).body.items.map((f: { featureId: string; name: string }) => f.featureId).sort();
    expect(ids).toEqual(before.ids);
    const names = (await app.http().get('/api/features').expect(200)).body.items.map((f: { name: string }) => f.name);
    expect(names).toContain('백업 전 기능 B');
    expect(names).not.toContain('백업 뒤 기능 C');
    // 복원본에서 일을 이어 가도 체인이 이어진다
    await app.http().post('/api/features').set(AUTHOR).send(feature('복원 뒤 기능 D')).expect(201);
    expect(app.audit.verifyChain().ok).toBe(true);
    await app.app.close();
  });

  it('살아 있던 고정점 파일을 그대로 쓰면 복원본은 위변조(고정점 어긋남)로 보인다 — 복원 때 고정점 파일도 백업 것으로 바꿔야 하는 이유', async () => {
    const wrong = { db: join(root, 'wrong', 'ff.db'), anchor: join(root, 'wrong-anchor.jsonl') };
    restore({ from: backupDir, db: wrong.db, anchorFile: join(root, 'unused-anchor.jsonl') });
    writeFileSync(wrong.anchor, readFileSync(LIVE.anchor));
    const app = await boot(wrong, 'none');
    const chain = app.audit.verifyChain();
    expect(chain.ok).toBe(false);
    expect(chain.broken?.kind).toBe('anchor');
    await app.app.close();
  });

  it('백업 파일이 바뀌면 복원을 거부한다(해시)', () => {
    const copy = join(root, 'tampered');
    mkdirSync(copy);
    for (const f of readdirSync(backupDir)) writeFileSync(join(copy, f), readFileSync(join(backupDir, f)));
    appendFileSync(join(copy, 'audit-anchor.jsonl'), '{"id":1,"hash":"x","mac":"y"}\n');
    expect(() => verifyBackup(copy)).toThrow(/해시/);
    expect(() => restore({ from: copy, db: join(root, 't', 'ff.db'), anchorFile: join(root, 't.jsonl') })).toThrow(/해시/);
  });

  it('자리에 파일이 있으면 거부, --replace면 지우지 않고 옆으로 옮긴다', () => {
    expect(() => restore({ from: backupDir, db: RESTORED.db, anchorFile: RESTORED.anchor })).toThrow(/--replace/);
    const r = restore({ from: backupDir, db: RESTORED.db, anchorFile: RESTORED.anchor, replace: true, now: new Date('2026-10-24T05:00:00Z') });
    expect(r.movedAside.some((p) => p.endsWith('ff.db.before-restore-20261024T050000Z'))).toBe(true);
    expect(r.movedAside.some((p) => p.endsWith('audit-anchor.jsonl.before-restore-20261024T050000Z'))).toBe(true);
    for (const p of r.movedAside) expect(existsSync(p)).toBe(true);
  });

  it('명령(backup-cli) — 같은 환경 변수로 백업·목록·검증, 다른 설치(고객)의 백업은 복원하지 않는다', () => {
    const env = { FF_DB: RESTORED.db, FF_AUDIT_ANCHOR_FILE: RESTORED.anchor, FF_INSTANCE_ID: 'oem-a', FF_BACKUP_DIR: join(root, 'cli-backups') };
    const b = runCli(['backup'], env) as { ok: boolean; dir: string };
    expect(b.ok).toBe(true);
    expect((runCli(['list'], env) as { backups: unknown[] }).backups).toHaveLength(1);
    expect((runCli(['verify', '--from', b.dir], env) as { ok: boolean }).ok).toBe(true);
    expect(() => runCli(['restore', '--from', b.dir, '--replace'], { ...env, FF_INSTANCE_ID: 'oem-b' })).toThrow(/한 설치 = 한 고객/);
    expect(() => runCli(['backup'], { ...env, FF_DB: ':memory:' })).toThrow(/파일 DB/);
    expect(() => runCli(['nope'], env)).toThrow(/사용법/);
  });

  it('보관 기한이 지난 백업은 지우고, 가장 새 백업은 남긴다', () => {
    const dir = join(root, 'prune');
    for (const at of ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-10-20T00:00:00Z']) backup({ db: RESTORED.db, outDir: dir, now: new Date(at) });
    expect(listBackups(dir)).toHaveLength(3);
    const gone = pruneBackups(dir, 35, new Date('2026-10-24T00:00:00Z'));
    expect(gone).toHaveLength(2);
    expect(listBackups(dir).map((b) => b.manifest.createdAt)).toEqual(['2026-10-20T00:00:00.000Z']);
    // 모두 기한이 지나도 가장 새 것은 남는다
    expect(pruneBackups(dir, 1, new Date('2027-01-01T00:00:00Z'))).toEqual([]);
    expect(listBackups(dir)).toHaveLength(1);
  });
});

describe('운영 보조 저장소 보존 기한', () => {
  it('기본 — 멱등 7일·스팬 30일·이벤트는 지우지 않는다, 잘못된 값은 기본값', () => {
    const days = Object.fromEntries(HOUSEKEEPING.map((p) => [p.table, retentionDays(p, {})]));
    expect(days).toEqual({ idempotency: 7, otel_span: 30, events: 0 });
    expect(retentionDays(HOUSEKEEPING[0], { FF_RETENTION_IDEMPOTENCY_DAYS: '-3' })).toBe(7);
    expect(retentionDays(HOUSEKEEPING[2], { FF_RETENTION_EVENT_DAYS: '400' })).toBe(400);
  });

  it('기한이 지난 멱등 키·스팬만 지우고 이벤트·감사는 그대로', async () => {
    const app = await boot({ db: join(root, 'hk.db'), anchor: join(root, 'hk-anchor.jsonl') }, 'none');
    const db = app.db;
    const now = app.app.get(Clock).now().getTime();
    const old = new Date(now - 40 * 24 * 3600_000).toISOString();
    const fresh = new Date(now - 3600_000).toISOString();
    db.tx(() => {
      db.run('INSERT INTO idempotency (key, route, req_hash, status, response, at) VALUES (?, ?, ?, ?, ?, ?)', 'old', 'POST /x', 'h', 201, '{}', old);
      db.run('INSERT INTO idempotency (key, route, req_hash, status, response, at) VALUES (?, ?, ?, ?, ?, ?)', 'new', 'POST /x', 'h', 201, '{}', fresh);
      db.run('INSERT INTO otel_span (trace_id, name, at, doc) VALUES (?, ?, ?, ?)', 't1', 'old', old, '{}');
      db.run('INSERT INTO otel_span (trace_id, name, at, doc) VALUES (?, ?, ?, ?)', 't2', 'new', fresh, '{}');
      db.run('INSERT INTO events (id, type, at, aggregate, payload) VALUES (?, ?, ?, ?, ?)', 'ev-old', 'TEST', old, 'x', '{}');
    });
    const n = app.app.get(HousekeepingService).sweep({});
    expect(n).toEqual({ idempotency: 1, otel_span: 1, events: 0 });
    expect(db.all<{ key: string }>('SELECT key FROM idempotency').map((r) => r.key)).toEqual(['new']);
    expect(db.get('SELECT 1 FROM events WHERE id = ?', 'ev-old')).toBeTruthy();
    expect(app.app.get(HousekeepingService).sweep({ FF_RETENTION_EVENT_DAYS: '30' }).events).toBe(1);
    await app.app.close();
  });
});

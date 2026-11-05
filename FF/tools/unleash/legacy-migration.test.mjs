import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { migrateLegacySqlite } from './legacy-migration.mjs';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

test('legacy SQLite is copied via an upgraded working copy; source bytes and audit chain survive; restart does not duplicate', { skip: process.env.FF_UNLEASH_PG_MIGRATION !== '1', timeout: 120000 }, async () => {
  const line = readFileSync(process.env.FF_UNLEASH_PG_ENV, 'utf8').trim();
  const url = new URL(line.slice(line.indexOf('=') + 1));
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/ff_test');
  const admin = new Client({ connectionString: url.toString() }); await admin.connect();
  const name = `ff_t_unleash_legacy_${process.pid}`, dir = mkdtempSync(join(tmpdir(), 'ff-ul-migration-'));
  let check;
  try {
    await admin.query(`CREATE DATABASE ${name}`); url.pathname = `/${name}`;
    const { SqliteDb, migrate } = require('../../backend/dist/kernel/db.js');
    const { MIGRATIONS } = require('../../backend/dist/kernel/migrations.js');
    const { AuditService } = require('../../backend/dist/kernel/audit.service.js');
    const { Clock } = require('../../backend/dist/kernel/clock.js');
    const source = join(dir, 'original.sqlite'), db = new SqliteDb(source);
    migrate(db, MIGRATIONS.slice(0, -1));
    const audit = new AuditService(db, new Clock(), { manual: true }); audit.onModuleInit();
    db.tx(() => audit.record({ id: 'legacy-owner', role: 'SYSTEM', correlationId: 'migration-test' }, 'LEGACY_UPGRADE', 'legacy-record', { after: { value: 7 } }));
    db.close();
    const digest = () => createHash('sha256').update(readFileSync(source)).digest('hex'); const before = digest();
    assert.equal((await migrateLegacySqlite(source, url.toString(), dir)).migrated, true);
    assert.equal(digest(), before, 'Original SQLite changed');
    check = new Client({ connectionString: url.toString() }); await check.connect();
    const rows = (await check.query('SELECT actor_id, action FROM audit')).rows;
    assert.deepEqual(rows, [{ actor_id: 'legacy-owner', action: 'LEGACY_UPGRADE' }]);
    assert.equal((await check.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, MIGRATIONS.length);
    const report = JSON.parse(readFileSync(join(dir, 'legacy-migration/report.json'), 'utf8'));
    assert.equal(report.ok, true); assert.equal(report.audit.rows, 1); assert.equal(report.audit.head, report.audit.sourceHead);
    assert.equal((await migrateLegacySqlite(source, url.toString(), dir)).migrated, false);
    assert.equal((await check.query('SELECT count(*)::int AS n FROM audit')).rows[0].n, 1);
  } finally {
    await check?.end(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); rmSync(dir, { recursive: true, force: true });
  }
});

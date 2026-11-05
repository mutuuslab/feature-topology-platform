// Desktop SQLite → private PostgreSQL upgrade. Original SQLite is opened read-only and is never removed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export async function migrateLegacySqlite(source, url, data) {
  if (!source || !existsSync(source)) return { migrated: false };
  const { PgSyncDb } = require('../../backend/dist/kernel/pg-sync-db.js');
  const { MIGRATIONS } = require('../../backend/dist/kernel/migrations.js');
  const { dialectContextOf } = require('../../backend/dist/kernel/pg-dialect.js');
  const { SqliteDb, migrate } = require('../../backend/dist/kernel/db.js');
  const { copySqliteToPg } = require('../../backend/dist/ops/sqlite-to-pg.js');
  const target = new PgSyncDb({ url, ctx: dialectContextOf(MIGRATIONS) });
  const folder = join(data, 'legacy-migration'), marker = join(folder, 'state.json');
  try {
    if (existsSync(marker)) {
      const state = JSON.parse(readFileSync(marker, 'utf8'));
      if (state.state !== 'DONE') throw new Error('A previous SQLite upgrade is incomplete. Original data is intact; repair or restore the private PostgreSQL destination before retrying.');
    }
    if (target.get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='schema_migrations'")) return { migrated: false };
    mkdirSync(folder, { recursive: true });
    writeFileSync(marker, JSON.stringify({ state: 'COPYING', source }), { mode: 0o600 });
    const working = join(folder, 'working.sqlite');
    const { DatabaseSync, backup } = process.getBuiltinModule('node:sqlite');
    const original = new DatabaseSync(source, { readOnly: true });
    try { await backup(original, working); } finally { original.close(); }
    const copy = new SqliteDb(working);
    try { migrate(copy, MIGRATIONS); } finally { copy.close(); }
    const report = copySqliteToPg({ from: working, to: target });
    if (!report.ok) throw new Error('SQLite upgrade verification failed; inspect the private migration report.');
    writeFileSync(join(folder, 'report.json'), JSON.stringify(report, null, 2));
    writeFileSync(marker, JSON.stringify({ state: 'DONE', source, tables: report.tables.length, auditRows: report.audit.rows }), { mode: 0o600 });
    return { migrated: true, tables: report.tables.length };
  } catch (error) {
    if (existsSync(marker)) writeFileSync(marker, JSON.stringify({ state: 'FAILED', source }), { mode: 0o600 });
    throw error;
  } finally { target.close(); }
}

// 데이터 이전 — SQLite 파일 DB → PostgreSQL(D-RD-3, docs/20-architecture/20-92 §5).
//   node backend/dist/ops/sqlite-to-pg.js --from /var/lib/ff/ff.db --to postgres://…   (앱을 멈춘 뒤)
// 순서: ① 원본이 이 판의 마이그레이션을 모두 마쳤는지 ② 대상이 빈 DB인지(다른 데이터 위에 덮지 않는다) ③ 대상에 같은 마이그레이션 적용
//       ④ 표마다 행을 그대로 옮긴다(감사 id·해시·JSON 문자열 그대로) ⑤ 정수 키 순번을 맞춘다 ⑥ 검증: 표마다 행 수,
//       감사 해시 체인을 대상에서 처음부터 다시 계산(원본 끝 해시와 같아야 한다) — 하나라도 어긋나면 실패(대상은 버리고 원본으로 계속 운영)
// 실행 중 상태(단일 인스턴스 임대·처리 중 예약)는 옮기지 않는다. 원본은 읽기만 한다 — 되돌리기는 FF_DB_URL을 지우고 원본 파일로 부팅.
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import { AUDIT_GENESIS, chainHash } from '../kernel/audit.service';
import { migrate, type Row } from '../kernel/db';
import { MIGRATIONS } from '../kernel/migrations';
import { dialectContextOf } from '../kernel/pg-dialect';
import { PgSyncDb } from '../kernel/pg-sync-db';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

/** 옮기지 않는 표 — 마이그레이션 기록(대상이 스스로 적용)·실행 중 상태 */
const SKIP = new Set(['schema_migrations', 'sqlite_sequence', 'instance_lease', 'shared_reservation']);

export interface MigrationReport {
  ok: boolean;
  tables: { name: string; rows: number }[];
  audit: { rows: number; head: string | null; sourceHead: string | null; brokenAt: number | null };
  problems: string[];
}

/** 감사 체인을 처음부터 다시 계산 — 어긋난 첫 id(없으면 null)와 끝 해시 */
export function recomputeChain(rows: Row[]): { head: string | null; brokenAt: number | null } {
  let prev = AUDIT_GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || r.hash !== chainHash(prev, r)) return { head: null, brokenAt: Number(r.id) };
    prev = String(r.hash);
  }
  return { head: rows.length ? prev : null, brokenAt: null };
}

export function copySqliteToPg(o: { from: string; to: PgSyncDb; batch?: number }): MigrationReport {
  const src: DatabaseSyncT = new DatabaseSync(o.from, { readOnly: true });
  const problems: string[] = [];
  try {
    const applied = new Set((src.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
    const missing = MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name);
    if (missing.length) throw new Error(`원본 DB가 이 판의 마이그레이션을 모두 마치지 않았습니다(${missing.join(', ')}) — 먼저 이 판으로 SQLite에서 한 번 부팅하세요`);
    const dst = o.to;
    if (dst.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")) {
      if (dst.get('SELECT 1 AS x FROM schema_migrations')) throw new Error('대상 PostgreSQL DB가 비어 있지 않습니다 — 빈 DB에만 옮깁니다(덮어쓰지 않는다)');
    }
    migrate(dst, MIGRATIONS);

    const tables = (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name).filter((t) => !SKIP.has(t));
    const counts: MigrationReport['tables'] = [];
    dst.tx(() => {
      for (const t of tables) {
        const cols = (src.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        const rows = src.prepare(`SELECT ${cols.join(', ')} FROM ${t} ORDER BY rowid`).all() as Row[];
        // 마이그레이션이 미리 넣은 행(예: retention_gate) — 원본 값으로 바꾼다
        if (rows.length && Number(dst.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)?.n ?? 0) > 0) dst.run(`DELETE FROM ${t}`);
        const per = Math.max(1, Math.min(o.batch ?? 500, Math.floor(30_000 / Math.max(1, cols.length))));
        for (let i = 0; i < rows.length; i += per) {
          const chunk = rows.slice(i, i + per);
          const values = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
          dst.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${values} RETURNING 1 AS ok`, ...chunk.flatMap((r) => cols.map((c) => r[c] as never)));
        }
        counts.push({ name: t, rows: rows.length });
      }
      // 정수 키 순번 — 옮긴 최대값 다음부터
      for (const [t, col] of dst.ctx.intKey) {
        if (!tables.includes(t)) continue;
        dst.get(`SELECT setval(pg_get_serial_sequence('${t}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${t}), 0) + 1, false) AS s`);
      }
    });

    // 검증 — 행 수, 감사 체인(대상에서 다시 계산)
    for (const c of counts) {
      const n = Number(dst.get<{ n: number }>(`SELECT count(*) AS n FROM ${c.name}`)?.n ?? -1);
      if (n !== c.rows) problems.push(`${c.name}: 원본 ${c.rows}행 · 대상 ${n}행`);
    }
    const srcAudit = src.prepare('SELECT * FROM audit ORDER BY id').all() as Row[];
    const dstAudit = dst.all('SELECT * FROM audit ORDER BY id');
    const before = recomputeChain(srcAudit);
    const after = recomputeChain(dstAudit);
    if (before.brokenAt !== null) problems.push(`원본 감사 체인이 이미 어긋나 있습니다(id ${before.brokenAt}) — 옮기기 전에 원인을 확인하세요`);
    if (after.brokenAt !== null) problems.push(`대상 감사 체인이 어긋납니다(id ${after.brokenAt}) — 값이 바뀌어 옮겨졌다`);
    if (after.head !== before.head) problems.push(`감사 체인 끝 해시가 다릅니다(원본 ${before.head} · 대상 ${after.head})`);
    return { ok: problems.length === 0, tables: counts, audit: { rows: dstAudit.length, head: after.head, sourceHead: before.head, brokenAt: after.brokenAt }, problems };
  } finally {
    src.close();
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
  const from = arg('--from') ?? process.env.FF_DB;
  const to = arg('--to') ?? process.env.FF_DB_URL;
  try {
    if (!from || from === ':memory:') throw new Error('--from SQLite 파일(또는 FF_DB)이 필요합니다');
    if (!to || !/^postgres(ql)?:\/\//i.test(to)) throw new Error('--to postgres://…(또는 FF_DB_URL)가 필요합니다');
    const dst = new PgSyncDb({ url: to, ctx: dialectContextOf(MIGRATIONS) });
    try {
      const r = copySqliteToPg({ from, to: dst });
      console.log(JSON.stringify({ command: 'sqlite-to-pg', ...r, next: r.ok ? 'FF_DB_URL을 설정하고 앱을 띄운 뒤 GET /api/audit/chain(ok: true)을 확인하세요' : '대상 DB를 지우고 원본으로 계속 운영하세요' }));
      process.exitCode = r.ok ? 0 : 1;
    } finally {
      dst.close();
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, command: 'sqlite-to-pg', error: (e as Error).message }));
    process.exitCode = 1;
  }
}

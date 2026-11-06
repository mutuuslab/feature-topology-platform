// 온라인 백업·복원 — 출시 준비 RD-OPS-09 (docs/20-architecture/20-91-install-guide.md §9).
// 백업: 돌고 있는 앱의 SQLite 파일 DB를 `VACUUM INTO`로 한순간의 일관된 사본으로 뜬다(앱을 멈추지 않는다 — WAL 모드라 읽기는 쓰기를 막지 않는다).
//       감사 체인 고정점 파일(FF_AUDIT_ANCHOR_FILE)도 함께 담는다 — 사본의 감사 끝(id)까지의 고정점만(그 뒤 고정점은 사본에 없는 행을 가리킨다).
//       manifest.json에 파일 SHA-256·감사 끝·마이그레이션·건수·설치 식별을 남긴다. 보관 기한(일)이 지난 백업은 지운다(가장 새 것은 남긴다).
// 복원: manifest의 해시를 확인한 뒤 DB 파일과 고정점 파일을 새 자리에 놓는다. 기존 파일은 지우지 않고 `.before-restore-<시각>`으로 옮긴다(--replace).
//       복원한 뒤 앱을 띄우면 마이그레이션이 이어서 적용되고(옛 판 백업 → 새 판 앱), 감사 체인 검증(GET /api/audit/chain)이 통과해야 한다.
// 앱 프로세스 안이 아니라 별도 명령(backup-cli.ts)으로 돈다 — 도메인 모듈을 띄우지 않는다.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

export const BACKUP_FORMAT = 'ff-backup/1';
const DB_NAME = 'ff.db';
const ANCHOR_NAME = 'audit-anchor.jsonl';
const DAY_MS = 24 * 3600_000;

export interface BackupFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  instance: string | null;
  source: { db: string; anchorFile: string | null };
  db: BackupFile;
  /** 고정점 파일이 설정되지 않았으면 null */
  anchor: (BackupFile & { lines: number; skippedAfterHead: number }) | null;
  audit: { count: number; headId: number | null; headHash: string | null };
  migrations: string[];
  counts: Record<string, number>;
  integrity: string;
}

export interface BackupOptions {
  /** 원본 DB 파일 */
  db: string;
  /** 백업들을 둘 폴더 — 그 안에 ff-backup-<시각> 폴더를 만든다 */
  outDir: string;
  anchorFile?: string | null;
  instance?: string | null;
  now?: Date;
  /** 이 일수보다 오래된 백업 폴더를 지운다(0·없음 = 지우지 않는다). 가장 새 백업은 늘 남긴다 */
  keepDays?: number;
}

export interface BackupResult {
  dir: string;
  manifest: BackupManifest;
  pruned: string[];
}

const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const fileInfo = (p: string): BackupFile => ({ name: basename(p), sha256: sha256File(p), bytes: statSync(p).size });
const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 업무 건수 — 백업·복원 비교용(표가 없으면 건너뛴다) */
const COUNT_TABLES = ['feature_version', 'baseline', 'product', 'policy', 'publication', 'vehicle', 'entitlement', 'audit', 'events', 'auth_session'];

function summarize(db: DatabaseSyncT) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const counts: Record<string, number> = {};
  for (const t of COUNT_TABLES) if (tables.has(t)) counts[t] = Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
  const head = tables.has('audit') ? (db.prepare('SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1').get() as { id: number; hash: string | null } | undefined) : undefined;
  const migrations = tables.has('schema_migrations') ? (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name) : [];
  const integrity = String((db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>)?.integrity_check ?? 'unknown');
  return { counts, migrations, integrity, audit: { count: counts.audit ?? 0, headId: head ? Number(head.id) : null, headHash: head?.hash ?? null } };
}

/** 고정점 줄 중 사본의 감사 끝 id 이하만 — 읽을 수 없는 줄은 그대로 둔다(위변조 흔적을 지우지 않는다) */
function anchorLinesUpTo(text: string, headId: number | null) {
  const keep: string[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let id: number | null = null;
    try {
      id = Number((JSON.parse(line) as { id?: unknown }).id);
    } catch {
      id = null;
    }
    if (id !== null && Number.isFinite(id) && (headId === null || id > headId)) skipped++;
    else keep.push(line);
  }
  return { keep, skipped };
}

/** 돌고 있는 DB의 온라인 백업 */
export function backup(o: BackupOptions): BackupResult {
  const src = resolve(o.db);
  if (!existsSync(src)) throw new Error(`백업할 DB 파일이 없습니다: ${src}`);
  const now = o.now ?? new Date();
  const root = resolve(o.outDir);
  mkdirSync(root, { recursive: true });
  const dir = join(root, `ff-backup-${stampOf(now)}`);
  if (existsSync(dir)) throw new Error(`같은 시각의 백업 폴더가 이미 있습니다: ${dir}`);
  const tmp = `${dir}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  const dbOut = join(tmp, DB_NAME);

  // 한순간의 일관된 사본 — 다른 연결(앱)이 쓰는 중이어도 된다. 쓰기 잠금이 길면 기다린다
  const live = new DatabaseSync(src);
  try {
    live.exec('PRAGMA busy_timeout = 15000');
    live.exec(`VACUUM INTO ${sqlString(dbOut)}`);
  } finally {
    live.close();
  }
  const copy = new DatabaseSync(dbOut);
  let sum: ReturnType<typeof summarize>;
  try {
    // 실행 중 상태는 데이터가 아니다 — 백업한 인스턴스의 단일 인스턴스 임대·처리 중 예약을 사본에서 뺀다(복원본이 부팅을 거부당하지 않게, RD-OPS-14)
    const has = (t: string) => !!copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    for (const t of ['instance_lease', 'shared_reservation']) if (has(t)) copy.exec(`DELETE FROM ${t}`);
    sum = summarize(copy);
  } finally {
    copy.close();
  }
  if (sum.integrity !== 'ok') throw new Error(`백업 사본의 무결성 검사 실패: ${sum.integrity}`);

  let anchor: BackupManifest['anchor'] = null;
  const anchorSrc = o.anchorFile?.trim() ? resolve(o.anchorFile) : null;
  if (anchorSrc) {
    const { keep, skipped } = anchorLinesUpTo(existsSync(anchorSrc) ? readFileSync(anchorSrc, 'utf8') : '', sum.audit.headId);
    const out = join(tmp, ANCHOR_NAME);
    writeFileSync(out, keep.length ? keep.join('\n') + '\n' : '');
    anchor = { ...fileInfo(out), lines: keep.length, skippedAfterHead: skipped };
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    instance: o.instance ?? null,
    source: { db: src, anchorFile: anchorSrc },
    db: fileInfo(dbOut),
    anchor,
    audit: sum.audit,
    migrations: sum.migrations,
    counts: sum.counts,
    integrity: sum.integrity,
  };
  writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // 다 쓴 뒤에만 이름을 바꾼다 — 중간에 멈춘 백업이 완성본처럼 보이지 않게
  renameSync(tmp, dir);
  const pruned = o.keepDays && o.keepDays > 0 ? pruneBackups(root, o.keepDays, now) : [];
  return { dir, manifest, pruned };
}

/** 백업 폴더 목록(새 것 먼저) — 이 도구가 만든 것(manifest 형식)만 */
export function listBackups(root: string): { dir: string; manifest: BackupManifest }[] {
  if (!existsSync(root)) return [];
  const out: { dir: string; manifest: BackupManifest }[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const mf = join(dir, 'manifest.json');
    if (!/^ff-backup-\d{8}T\d{6}Z$/.test(name) || !existsSync(mf)) continue;
    try {
      const manifest = JSON.parse(readFileSync(mf, 'utf8')) as BackupManifest;
      if (manifest.format === BACKUP_FORMAT) out.push({ dir, manifest });
    } catch {
      /* 이 도구의 백업이 아니다 */
    }
  }
  return out.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

/** 보관 기한이 지난 백업 지우기 — 가장 새 백업은 기한이 지나도 남긴다 */
export function pruneBackups(root: string, keepDays: number, now = new Date()): string[] {
  const all = listBackups(root);
  const cutoff = now.getTime() - keepDays * DAY_MS;
  const gone: string[] = [];
  for (const b of all.slice(1)) {
    if (Date.parse(b.manifest.createdAt) < cutoff) {
      rmSync(b.dir, { recursive: true, force: true });
      gone.push(b.dir);
    }
  }
  return gone;
}

/** 백업 폴더의 파일이 manifest와 같은가 */
export function verifyBackup(dir: string): BackupManifest {
  const mf = join(dir, 'manifest.json');
  if (!existsSync(mf)) throw new Error(`manifest.json이 없습니다 — 이 도구로 만든 백업 폴더가 아닙니다: ${dir}`);
  const manifest = JSON.parse(readFileSync(mf, 'utf8')) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) throw new Error(`모르는 백업 형식: ${String(manifest.format)}`);
  const check = (f: BackupFile) => {
    const p = join(dir, f.name);
    if (!existsSync(p)) throw new Error(`백업 파일이 없습니다: ${f.name}`);
    if (sha256File(p) !== f.sha256) throw new Error(`백업 파일 해시가 manifest와 다릅니다(손상·변조): ${f.name}`);
  };
  check(manifest.db);
  if (manifest.anchor) check(manifest.anchor);
  return manifest;
}

export interface RestoreOptions {
  /** 백업 폴더(ff-backup-…) */
  from: string;
  /** 복원할 DB 파일 자리 */
  db: string;
  /** 복원할 고정점 파일 자리 — 백업에 고정점이 있으면 필요 */
  anchorFile?: string | null;
  /** 자리에 파일이 있으면 지우지 않고 `.before-restore-<시각>`으로 옮긴다. 없으면 거부 */
  replace?: boolean;
  now?: Date;
}

export interface RestoreResult {
  manifest: BackupManifest;
  db: string;
  anchorFile: string | null;
  /** 옆으로 옮긴 기존 파일 */
  movedAside: string[];
}

/** 복원 — 앱을 멈춘 뒤에 돌린다(돌고 있는 앱 밑에서 파일을 바꾸면 안 된다) */
export function restore(o: RestoreOptions): RestoreResult {
  const from = resolve(o.from);
  const manifest = verifyBackup(from);
  const now = o.now ?? new Date();
  const suffix = `.before-restore-${stampOf(now)}`;
  const target = resolve(o.db);
  const anchorTarget = o.anchorFile?.trim() ? resolve(o.anchorFile) : null;
  if (manifest.anchor && !anchorTarget) throw new Error('백업에 감사 고정점이 들어 있습니다 — 복원할 고정점 파일 자리(FF_AUDIT_ANCHOR_FILE)를 주세요');

  const occupied = [target, `${target}-wal`, `${target}-shm`, ...(anchorTarget ? [anchorTarget] : [])].filter((p) => existsSync(p));
  if (occupied.length && !o.replace) throw new Error(`복원할 자리에 파일이 있습니다(${occupied.map((p) => basename(p)).join(', ')}) — 앱을 멈추고 --replace로 다시 실행하면 기존 파일을 지우지 않고 옆으로 옮깁니다`);
  const movedAside: string[] = [];
  for (const p of occupied) {
    renameSync(p, p + suffix);
    movedAside.push(p + suffix);
  }

  mkdirSync(dirname(target), { recursive: true });
  // 같은 폴더에 먼저 쓰고 이름을 바꾼다 — 복사 중에 멈춰도 반쯤 쓴 DB가 제자리에 놓이지 않게
  copyFileSync(join(from, manifest.db.name), `${target}.restoring`);
  renameSync(`${target}.restoring`, target);
  if (manifest.anchor && anchorTarget) {
    mkdirSync(dirname(anchorTarget), { recursive: true });
    copyFileSync(join(from, manifest.anchor.name), `${anchorTarget}.restoring`);
    renameSync(`${anchorTarget}.restoring`, anchorTarget);
  }
  // 놓은 DB가 백업과 같은가(복사 손상)
  const check = new DatabaseSync(target);
  try {
    const sum = summarize(check);
    if (sum.integrity !== 'ok' || sum.audit.headHash !== manifest.audit.headHash || sum.audit.count !== manifest.audit.count) throw new Error('복원한 DB가 백업 manifest와 다릅니다');
  } finally {
    check.close();
  }
  return { manifest, db: target, anchorFile: manifest.anchor ? anchorTarget : null, movedAside };
}

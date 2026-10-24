// 백업·복원 명령 — 출시 준비 RD-OPS-09. 사용법은 설치 안내서(docs/20-architecture/20-91-install-guide.md §8).
//   node backend/dist/ops/backup-cli.js backup  [--out 폴더] [--keep-days 일]     (앱이 돌고 있어도 된다)
//   node backend/dist/ops/backup-cli.js list    [--out 폴더]
//   node backend/dist/ops/backup-cli.js verify  --from 백업폴더
//   node backend/dist/ops/backup-cli.js restore --from 백업폴더 [--replace]         (앱을 멈춘 뒤)
// 기본값은 앱과 같은 환경 변수: FF_DB · FF_AUDIT_ANCHOR_FILE · FF_INSTANCE_ID · FF_BACKUP_DIR · FF_BACKUP_KEEP_DAYS
// 결과는 한 줄 JSON(로그 수집·cron 메일에 그대로) — 실패하면 종료 코드 1.
import { backup, listBackups, restore, verifyBackup } from './backup';

const USAGE = '사용법: backup-cli <backup|list|verify|restore> [--out 폴더] [--keep-days 일] [--from 백업폴더] [--replace] [--allow-other-instance]';

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function runCli(argv: string[], env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  const [cmd] = argv;
  const out = arg(argv, '--out') ?? env.FF_BACKUP_DIR;
  const db = env.FF_DB;
  const anchorFile = env.FF_AUDIT_ANCHOR_FILE ?? null;
  const needDb = () => {
    if (!db || db === ':memory:') throw new Error('FF_DB가 없거나 :memory:입니다 — 파일 DB만 백업·복원할 수 있습니다');
    return db;
  };
  switch (cmd) {
    case 'backup': {
      if (!out) throw new Error('백업 폴더가 없습니다 — --out 또는 FF_BACKUP_DIR');
      const keepDays = Number(arg(argv, '--keep-days') ?? env.FF_BACKUP_KEEP_DAYS ?? 0) || 0;
      const r = backup({ db: needDb(), outDir: out, anchorFile, instance: env.FF_INSTANCE_ID ?? null, keepDays });
      return { ok: true, command: 'backup', dir: r.dir, createdAt: r.manifest.createdAt, audit: r.manifest.audit, counts: r.manifest.counts, anchorLines: r.manifest.anchor?.lines ?? null, pruned: r.pruned };
    }
    case 'list': {
      if (!out) throw new Error('백업 폴더가 없습니다 — --out 또는 FF_BACKUP_DIR');
      return { ok: true, command: 'list', backups: listBackups(out).map((b) => ({ dir: b.dir, createdAt: b.manifest.createdAt, instance: b.manifest.instance, auditCount: b.manifest.audit.count, bytes: b.manifest.db.bytes })) };
    }
    case 'verify': {
      const from = arg(argv, '--from');
      if (!from) throw new Error('--from 백업폴더가 필요합니다');
      const m = verifyBackup(from);
      return { ok: true, command: 'verify', dir: from, createdAt: m.createdAt, instance: m.instance, audit: m.audit, migrations: m.migrations.length };
    }
    case 'restore': {
      const from = arg(argv, '--from');
      if (!from) throw new Error('--from 백업폴더가 필요합니다');
      // 한 설치 = 한 고객 — 다른 설치(고객)의 백업은 명시하지 않으면 받지 않는다(설치 이전은 --allow-other-instance)
      const m = verifyBackup(from);
      if (m.instance && env.FF_INSTANCE_ID && m.instance !== env.FF_INSTANCE_ID && !argv.includes('--allow-other-instance')) {
        throw new Error(`백업의 설치 식별(${m.instance})이 이 설치(${env.FF_INSTANCE_ID})와 다릅니다 — 한 설치 = 한 고객. 같은 고객의 설치를 옮기는 경우에만 --allow-other-instance`);
      }
      const r = restore({ from, db: needDb(), anchorFile, replace: argv.includes('--replace') });
      return { ok: true, command: 'restore', ...r, next: '앱을 띄운 뒤 GET /api/health/ready 와 GET /api/audit/chain(ok: true)을 확인하세요' };
    }
    default:
      throw new Error(USAGE);
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runCli(process.argv.slice(2))));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
    process.exit(1);
  }
}

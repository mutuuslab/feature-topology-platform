// npm run integration:status — 여러 세션이 함께 쓰는 저장소의 통합 상태 보고 (검사가 아니라 보고: 실패 코드는 --strict 일 때만).
// 이 저장소와 형제 저장소(harness/siblings.json)에서: 현재 브랜치에 아직 안 들어온 로컬 브랜치·worktree, 미커밋 변경, origin과의 차이.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FF, readJson } from './lib.ts';

const raw = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout ?? '';
const git = (cwd: string, ...args: string[]) => raw(cwd, ...args).trim();

function report(name: string, dir: string): number {
  if (!existsSync(dir) || !git(dir, 'rev-parse', '--git-dir')) {
    console.log(`· ${name}: git 저장소 아님/없음 (${dir})`);
    return 0;
  }
  let open = 0;
  const head = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  console.log(`■ ${name} — ${head} @ ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
  const dirty = raw(dir, 'status', '--porcelain').split('\n').filter(Boolean);
  if (dirty.length) (open++, console.log(`  ✕ 미커밋 ${dirty.length}건: ${dirty.slice(0, 6).map((l) => l.slice(3)).join(', ')}`));
  for (const b of git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean)) {
    const ahead = Number(git(dir, 'rev-list', '--count', `HEAD..${b}`));
    if (ahead > 0) (open++, console.log(`  ✕ 브랜치 ${b}: 현재 브랜치에 없는 커밋 ${ahead}개`));
  }
  for (const block of git(dir, 'worktree', 'list', '--porcelain').split('\n\n').slice(1)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && git(path, 'status', '--porcelain')) (open++, console.log(`  ✕ worktree ${path}: 미커밋 변경`));
  }
  const upstream = git(dir, 'rev-parse', '--abbrev-ref', '@{u}');
  if (upstream) {
    const [behind, ahead] = git(dir, 'rev-list', '--left-right', '--count', `${upstream}...HEAD`).split(/\s+/).map(Number);
    console.log(`  · ${upstream} 대비 앞 ${ahead} · 뒤 ${behind}`);
  }
  if (!open) console.log('  ✓ 통합됨 (남은 브랜치·미커밋 없음)');
  return open;
}

const sib = readJson<Record<string, { dir: string; env: string }>>(join(FF, 'harness', 'siblings.json'));
let open = report('Feature Platform', resolve(FF, '..'));
for (const [k, v] of Object.entries(sib)) open += report(k, process.env[v.env] ?? resolve(FF, v.dir));
process.exit(process.argv.includes('--strict') && open ? 1 : 0);

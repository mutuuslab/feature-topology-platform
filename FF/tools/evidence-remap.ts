// npm run evidence:remap -- <기준 커밋> — 하네스 JSON의 "경로:줄" 근거를, 기준 커밋의 그 줄 내용을 지금 파일에서 찾아 새 줄 번호로 옮긴다.
// 코드를 고쳐 줄이 밀리면 verify ads·req가 '근거 줄에 내용이 없음'으로 실패한다 — 손으로 고치지 말고 이것으로(같은 내용 줄이 여럿이면 옛 줄에서 가장 가까운 것).
// 못 찾은 근거는 그대로 두고 LOST로 보고한다(내용이 바뀐 줄 — 판정 근거를 사람이 다시 본다).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

const BASE = process.argv[2];
if (!BASE) {
  console.error('사용: npm run evidence:remap -- <기준 커밋>');
  process.exit(2);
}
const changed = execFileSync('git', ['diff', '--name-only', BASE, '--', '.'], { cwd: FF, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.startsWith('FF/') && /\.(ts|tsx)$/.test(f))
  .map((f) => f.slice(3));
const oldOf = new Map<string, string[]>();
const newOf = new Map<string, string[]>();
for (const f of changed) {
  try {
    oldOf.set(f, execFileSync('git', ['show', `${BASE}:FF/${f}`], { cwd: FF, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r/g, '').split('\n'));
  } catch {
    continue;
  }
  newOf.set(f, readFileSync(join(FF, f), 'utf8').replace(/\r/g, '').split('\n'));
}
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json') ? [join(d, n)] : []));
let moved = 0;
const lost: string[] = [];
for (const file of walk(join(FF, 'harness'))) {
  const raw = readFileSync(file, 'utf8');
  const next = raw.replace(/"([\w./-]+\.tsx?):(\d+)"/g, (all: string, p: string, n: string) => {
    const o = oldOf.get(p);
    const nw = newOf.get(p);
    if (!o || !nw) return all;
    const line = Number(n);
    const text = o[line - 1];
    if (text === undefined) return all;
    if (nw[line - 1] === text) return all;
    let best = -1;
    for (let i = 0; i < nw.length; i++) if (nw[i] === text && (best < 0 || Math.abs(i + 1 - line) < Math.abs(best + 1 - line))) best = i;
    if (best < 0) {
      lost.push(`${p}:${n} "${text.trim().slice(0, 60)}"`);
      return all;
    }
    moved++;
    return `"${p}:${best + 1}"`;
  });
  if (next !== raw) writeFileSync(file, next);
}
console.log(`moved ${moved}`);
for (const l of lost) console.log('LOST', l);

// npm run evidence:remap — 하네스 JSON의 "경로:줄" 판정 근거를 코드 줄이 밀린 만큼 옮긴다. 손으로 고치지 말고 이것으로.
//   npm run evidence:remap                    잠금(harness/anchors.lock.json)의 줄 내용 해시로 지금 파일에서 같은 줄을 찾아 줄 번호·잠금을 함께 옮긴다
//                                             (같은 내용 줄이 여럿이면 옛 줄에서 가장 가까운 것). 못 찾으면 LOST — 내용이 바뀐 줄이라 판정 근거를 사람이 다시 본다(종료 1)
//   npm run evidence:remap -- --lock          판정을 다시 본 뒤 지금 내용으로 잠근다(새 근거 추가·안 쓰는 잠금 삭제)
//   npm run evidence:remap -- <기준 커밋>      잠금이 없던 때의 방식 — 기준 커밋의 그 줄 내용을 지금 파일에서 찾는다(옮긴 근거는 잠금 키도 옮긴다)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { lockedAnchors, readLock, relock, remapByLock, writeLock } from './anchors.ts';

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json') && n !== 'anchors.lock.json' ? [join(d, n)] : []));
const relOf = (file: string) => file.slice(FF.length).replace(/\\/g, '/').replace(/^\//, '');

function lockMode() {
  const before = readLock().anchors;
  const next = relock(lockedAnchors());
  const added = Object.keys(next.anchors).filter((a) => !(a in before)).length;
  const removed = Object.keys(before).filter((a) => !(a in next.anchors)).length;
  const changed = Object.keys(next.anchors).filter((a) => a in before && before[a] !== next.anchors[a]).length;
  writeLock(next);
  console.log(`근거 줄 잠금 ${Object.keys(next.anchors).length}개 — 추가 ${added}·삭제 ${removed}·내용 바뀜 ${changed}`);
}

function hashMode() {
  const files = walk(join(FF, 'harness'));
  const texts = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const r = remapByLock(texts, readLock());
  for (const f of files) if (r.texts[f] !== texts[f]) writeFileSync(f, r.texts[f]);
  if (r.moved.length) writeLock(r.lock);
  console.log(`moved ${r.moved.length}`);
  for (const [a, b] of r.moved) console.log(`  ${a} → ${b.split(':').pop()}`);
  for (const l of r.lost) console.log('LOST', l);
  if (r.lost.length) {
    console.error('✕ 내용이 바뀐 근거 줄 — 판정을 다시 보고 근거를 고친 뒤 npm run evidence:remap -- --lock');
    process.exit(1);
  }
}

function baseMode(BASE: string) {
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
  let moved = 0;
  const lost: string[] = [];
  const pairs = new Map<string, string>();
  const REF = /"[\w./-]+\.tsx?:\d+"/g;
  for (const file of walk(join(FF, 'harness'))) {
    const raw = readFileSync(file, 'utf8');
    // 한 번만 적용한다 — 근거가 기준 커밋 뒤에 이미 바뀌었으면(옮겼으면) 다시 옮기지 않고 멈춘다. 같은 문자열 근거가 우연히 겹쳐 두 번 밀리는 것을 막는다
    const rel = relOf(file);
    let base = '';
    try {
      base = execFileSync('git', ['show', `${BASE}:FF/${rel}`], { cwd: FF, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      continue;
    }
    const refs = (t: string) => (t.match(REF) ?? []).join('\n');
    if (refs(base) !== refs(raw)) {
      console.error(`✕ ${rel}의 근거가 ${BASE} 뒤에 이미 바뀌었다 — 기준은 근거를 마지막으로 맞춘 커밋(코드를 고치기 전)으로 주세요`);
      process.exit(1);
    }
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
      pairs.set(`${p}:${n}`, `${p}:${best + 1}`);
      return `"${p}:${best + 1}"`;
    });
    if (next !== raw) writeFileSync(file, next);
  }
  // 옮긴 근거는 잠금 키도 옮긴다(내용이 같으니 해시는 그대로)
  if (pairs.size) {
    const lock = readLock();
    const anchors: Record<string, string> = {};
    for (const [a, h] of Object.entries(lock.anchors)) anchors[pairs.get(a) ?? a] = h;
    writeLock({ note: lock.note, anchors });
  }
  console.log(`moved ${moved}`);
  for (const l of lost) console.log('LOST', l);
}

const arg = process.argv[2];
if (arg === '--lock') lockMode();
else if (arg && !arg.startsWith('--')) baseMode(arg);
else if (!arg) hashMode();
else {
  console.error('사용: npm run evidence:remap [-- --lock | -- <기준 커밋>]');
  process.exit(2);
}

// 형제 저장소 버전 고정 검사 (verify `siblings`) — FF 시험이 실제로 띄우는 다른 저장소(FF_IMP GLEO, LearnCarla CARLA)가 FF가 맞춘 버전인지 본다.
// 배경(2026-10-14): FF_IMP가 다른 세션에서 GLEO v2 브랜치로 바뀐 채로 FF verify를 돌려 gleo.ws.spec이 엉뚱한 wire와 비교되어 실패했다.
// 규칙: 저장소가 없으면 SKIP(CI) · FF_IMP checkout은 harness/siblings.json의 pin 커밋을 포함해야 하고 · 시험이 쓰는 폴더(watch)에 미커밋 변경이 없어야 한다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FF, readJson } from './lib.ts';

export interface SiblingFacts {
  present: boolean;
  isGit: boolean;
  containsPin: boolean;
  dirty: string[];
  head?: string;
}
export type SiblingVerdict = { status: 'PASS' | 'SKIP'; note: string } | { status: 'FAIL'; note: string };

/** 판정만 — 사실 수집(git 호출)과 분리해 시험한다 */
export function judgeFfImp(f: SiblingFacts, pin: string): SiblingVerdict {
  if (!f.present) return { status: 'SKIP', note: '저장소 없음 — GLEO 실연동 시험도 건너뛴다' };
  if (!f.isGit) return { status: 'FAIL', note: 'git 저장소가 아니라 고정 커밋을 확인할 수 없다' };
  if (!f.containsPin) return { status: 'FAIL', note: `checkout(${f.head ?? '?'})이 고정 커밋 ${pin.slice(0, 7)}을 포함하지 않는다 — FF_IMP를 그 커밋 이후로 맞추거나 harness/siblings.json pin을 함께 올린다` };
  if (f.dirty.length) return { status: 'FAIL', note: `시험이 쓰는 폴더에 미커밋 변경 ${f.dirty.length}건 — ${f.dirty.slice(0, 5).join(', ')}` };
  return { status: 'PASS', note: `checkout ${f.head} ⊇ ${pin.slice(0, 7)}` };
}

function git(cwd: string, args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

export function factsOf(dir: string, pin: string, watch: string[]): SiblingFacts {
  if (!existsSync(dir)) return { present: false, isGit: false, containsPin: false, dirty: [] };
  if (git(dir, ['rev-parse', '--git-dir']).status !== 0) return { present: true, isGit: false, containsPin: false, dirty: [] };
  const head = git(dir, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const containsPin = git(dir, ['merge-base', '--is-ancestor', pin, 'HEAD']).status === 0;
  const dirty = git(dir, ['status', '--porcelain', '--', ...watch]).stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return { present: true, isGit: true, containsPin, dirty, head };
}

if (import.meta.main ?? process.argv[1]?.endsWith('siblings.ts')) {
  const cfg = readJson<{ ffImp: { dir: string; env: string; pin: string; watch: string[] }; carla: { dir: string; env: string; python: string; server: string } }>(join(FF, 'harness', 'siblings.json'));
  const ffImpDir = process.env[cfg.ffImp.env] ?? resolve(FF, cfg.ffImp.dir);
  const v = judgeFfImp(factsOf(ffImpDir, cfg.ffImp.pin, cfg.ffImp.watch), cfg.ffImp.pin);
  const carlaDir = process.env[cfg.carla.env] ?? resolve(FF, cfg.carla.dir);
  const carlaOk = existsSync(join(carlaDir, cfg.carla.python)) && existsSync(join(carlaDir, cfg.carla.server));
  console.log('siblings');
  console.log(`  ${v.status === 'FAIL' ? '✕' : v.status === 'SKIP' ? '·' : '✓'} FF_IMP (${ffImpDir}) — ${v.note}`);
  console.log(`  ${carlaOk ? '✓' : '·'} LearnCarla CARLA (${carlaDir}) — ${carlaOk ? 'venv·서버 있음 (검증 서버가 떠 있으면 실제 실행기 시험이 돈다: npm run carla:up)' : '없음 — 실제 CARLA 시험은 건너뛴다'}`);
  process.exit(v.status === 'FAIL' ? 1 : 0);
}

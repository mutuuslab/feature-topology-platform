// vECU 시뮬레이터 웹 실행본 동기화 — FF 사이트와 함께 /vecu/ 로 배포한다(사용자 결정 2026-10-13: FF repo에 웹 실행본 동기화, FF에서는 링크로 연다).
//   node tools/vecu-sync.ts           VECU_DIR(기본 C:/project/2026-10-11_vECU)에서 허용 목록만 frontend/public/vecu/ 로 복사 + VECU_SYNC.json(해시)
//   node tools/vecu-sync.ts --check   복사본이 매니페스트와 같은지(FF 쪽에서 고치지 않았는지)·금지 경로·금지어가 없는지 검사 (verify 단계)
//                                     + vECU 원본이 있으면 동기화 뒤 원본이 바뀌었는지(낡은 사본을 배포하지 않게, 2026-10-16 평가기 사본 회귀)
// vECU 원본은 읽기만 한다(vECU 세션 소유). 실사 스플랫(splat/ — NuRec 약관 4.6 호스팅 금지)·assets/user/(로컬 전용 모델)·도구·시험·문서는 제외.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { FF, readJson } from './lib.ts';

const SRC = process.env.VECU_DIR ?? 'C:/project/2026-10-11_vECU';
const OUT = join(FF, 'frontend', 'public', 'vecu');
const MANIFEST = join(OUT, 'VECU_SYNC.json');

/** 허용 목록 — 웹 실행에 필요한 것만 */
const ALLOW: RegExp[] = [/^index\.html$/, /^js\/(?:[\w-]+\/)*[\w.-]+\.js$/, /^ff\/[\w.-]+\.json$/, /^assets\/[\w.-]+\.b64\.txt$/];
/** 어떤 경우에도 배포하지 않는다 */
const FORBID: RegExp[] = [/^splat\//, /^assets\/user\//, /nurec/i, /\.(py|aspl|usdz|ckpt|glb)$/i];
/** vECU 절대 규칙 — UI·보고서에 쓰지 않는 이름 */
const BANNED_TERMS = /\b(Vector|DYNA4)\b/;
/** Cloudflare Pages 파일 한도(25 MiB)보다 넉넉히 아래 */
const MAX_BYTES = 20 * 1024 * 1024;

const posix = (p: string) => p.split(sep).join('/');
/** 줄끝은 정규화해서 해시 — Git 체크아웃(Windows CRLF ↔ CI LF)에 따라 달라지지 않게 */
export const sha = (p: string) => createHash('sha256').update(/\.(html|js|json|txt)$/.test(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : readFileSync(p)).digest('hex');

function list(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...list(p, base));
    else out.push(posix(relative(base, p)));
  }
  return out;
}

export function selectFiles(all: string[]): string[] {
  return all.filter((f) => ALLOW.some((r) => r.test(f)) && !FORBID.some((r) => r.test(f))).sort();
}

interface Manifest {
  source: string;
  syncedAt: string;
  note: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

function problems(root: string, files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (FORBID.some((r) => r.test(f))) out.push(`금지 경로: ${f}`);
    const p = join(root, f);
    const bytes = statSync(p).size;
    if (bytes > MAX_BYTES) out.push(`파일이 너무 큼(${(bytes / 1048576).toFixed(1)} MiB): ${f}`);
    if (/\.(html|js|json)$/.test(f) && BANNED_TERMS.test(readFileSync(p, 'utf8'))) out.push(`금지어(Vector/DYNA4): ${f}`);
  }
  return out;
}

/** 원본 대비 사본의 낡음 — 원본에서 바뀐 파일·새로 생긴 파일·없어진 파일(허용 목록 기준). 순수 함수: 해시 표 두 개만 본다 */
export function driftOf(source: Record<string, string>, synced: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [f, h] of Object.entries(source)) {
    if (!(f in synced)) out.push(`원본에 새 파일: ${f}`);
    else if (synced[f] !== h) out.push(`원본이 바뀜: ${f}`);
  }
  for (const f of Object.keys(synced)) if (!(f in source)) out.push(`원본에서 없어짐: ${f}`);
  return out.sort();
}

function sync() {
  if (!existsSync(join(SRC, 'index.html'))) throw new Error(`vECU 폴더가 없습니다: ${SRC} (VECU_DIR로 지정)`);
  const files = selectFiles(list(SRC));
  const bad = problems(SRC, files);
  if (bad.length) throw new Error(`동기화 중단 — ${bad.join(' / ')}`);
  rmSync(OUT, { recursive: true, force: true });
  const m: Manifest = { source: posix(SRC), syncedAt: new Date().toISOString(), note: 'tools/vecu-sync.ts가 만든 복사본 — 여기서 고치지 말고 vECU 원본을 고친 뒤 다시 동기화', files: {} };
  for (const f of files) {
    const to = join(OUT, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(SRC, f), to);
    m.files[f] = { sha256: sha(to), bytes: statSync(to).size };
  }
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  const total = Object.values(m.files).reduce((s, x) => s + x.bytes, 0);
  console.log(`vecu:sync  ${files.length}개 파일 · ${(total / 1048576).toFixed(1)} MiB → ${posix(relative(FF, OUT))}`);
}

function check(): number {
  if (!existsSync(MANIFEST)) {
    console.log('vecu:check  동기화본 없음 — 건너뜀');
    return 0;
  }
  const m = readJson<Manifest>(MANIFEST);
  const present = list(OUT).filter((f) => f !== 'VECU_SYNC.json');
  const errors = problems(OUT, present);
  for (const f of present) if (!m.files[f]) errors.push(`매니페스트에 없는 파일: ${f}`);
  for (const [f, e] of Object.entries(m.files)) {
    if (!existsSync(join(OUT, f))) errors.push(`빠진 파일: ${f}`);
    else if (sha(join(OUT, f)) !== e.sha256) errors.push(`복사본이 바뀜(원본에서 고친 뒤 다시 동기화): ${f}`);
  }
  // 원본이 있으면(로컬) 사본이 최신인지 — 없으면(CI) 사본만 본다
  if (existsSync(join(SRC, 'index.html'))) {
    const source = Object.fromEntries(selectFiles(list(SRC)).map((f) => [f, sha(join(SRC, f))]));
    const drift = driftOf(source, Object.fromEntries(Object.entries(m.files).map(([f, e]) => [f, e.sha256])));
    for (const d of drift) errors.push(`${d} — npm run vecu:sync 로 다시 동기화`);
  }
  if (errors.length) {
    console.error(`vecu:check  ✗ ${errors.length}건\n  ${errors.join('\n  ')}`);
    return 1;
  }
  console.log(`vecu:check  ✓ ${present.length}개 파일 · 원본 ${m.source} · 동기화 ${m.syncedAt}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/vecu-sync.ts')) {
  if (process.argv.includes('--check')) process.exit(check());
  sync();
}

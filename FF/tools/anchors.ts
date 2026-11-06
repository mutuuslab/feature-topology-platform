// 판정 근거 줄 잠금 — ADS·Orca 판정(review.json)의 "경로:줄" 근거가 가리키는 줄 내용의 해시를 harness/anchors.lock.json에 둔다.
// 배경(2026-11-04 하네스 리뷰 H8): 근거 검사는 줄이 있고 빈 줄이 아닌지만 봐서, 코드가 바뀌어 같은 줄 번호에 다른 내용이 와도 통과했다.
//   · ads-sync·orca-sync --check: 잠금에 없거나 해시가 다르면 실패
//   · 줄이 밀렸으면 npm run evidence:remap(같은 해시의 줄을 찾아 줄 번호·잠금을 함께 옮긴다)
//   · 내용이 바뀌었으면 판정을 다시 본 뒤 npm run evidence:remap -- --lock(지금 내용을 잠근다)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

export const ANCHORS_LOCK = join(FF, 'harness', 'anchors.lock.json');
export const LOCKED_REVIEWS = ['harness/ads/review.json', 'harness/orca/review.json'];
export interface AnchorLock {
  note: string;
  anchors: Record<string, string>;
}
/** 파일 읽기(FF 기준 상대 경로, 없으면 null) — 시험에서 가짜 파일 체계로 바꾼다 */
export type ReadText = (rel: string) => string | null;
export const repoText: ReadText = (rel) => (existsSync(join(FF, rel)) ? readFileSync(join(FF, rel), 'utf8') : null);

const LOCK_NOTE = '판정 근거 "경로:줄"이 가리키는 줄(앞뒤 공백 제거)의 sha1 앞 12자 — tools/anchors.ts. 손으로 고치지 않는다: 줄이 밀렸으면 npm run evidence:remap, 내용이 바뀌었으면 판정을 다시 본 뒤 npm run evidence:remap -- --lock';

export const lineHash = (line: string) => createHash('sha1').update(line.replace(/\r$/, '').trim()).digest('hex').slice(0, 12);
const lines = (text: string) => text.split('\n').map((l) => l.replace(/\r$/, ''));
const parse = (a: string) => {
  const m = /^(.+?):(\d+)$/.exec(a);
  return m ? { path: m[1], line: Number(m[2]) } : null;
};

/** review 객체 안의 모든 evidence 배열 값 중 "경로:줄" 형식 */
export function anchorsOf(review: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'evidence' && Array.isArray(x) ? x.forEach((e) => typeof e === 'string' && parse(e) && out.add(e)) : visit(x);
  };
  visit(review);
  return [...out].sort();
}

export function readLock(path = ANCHORS_LOCK): AnchorLock {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as AnchorLock) : { note: LOCK_NOTE, anchors: {} };
}
export function writeLock(lock: AnchorLock, path = ANCHORS_LOCK) {
  const eol = existsSync(path) && readFileSync(path, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  const sorted = Object.fromEntries(Object.entries(lock.anchors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(path, (JSON.stringify({ note: LOCK_NOTE, anchors: sorted }, null, 2) + '\n').replace(/\n/g, eol));
}

/** 지금 줄 내용 해시(파일·줄이 없으면 null — 그 경우는 evidenceProblem이 따로 낸다) */
export function currentHash(anchor: string, read: ReadText): string | null {
  const p = parse(anchor);
  const text = p && read(p.path);
  if (!p || text == null) return null;
  const l = lines(text)[p.line - 1];
  return l === undefined ? null : lineHash(l);
}

/** 잠금 검사 — 잠금에 없거나 같은 줄 번호에 다른 내용이 오면 실패 */
export function anchorProblems(anchors: Iterable<string>, lock: AnchorLock, read: ReadText = repoText): string[] {
  const out: string[] = [];
  for (const a of new Set(anchors)) {
    const now = currentHash(a, read);
    if (now === null) continue;
    const locked = lock.anchors[a];
    if (!locked) out.push(`근거 줄 잠금 없음: ${a} — 판정을 확인한 뒤 npm run evidence:remap -- --lock`);
    else if (locked !== now) out.push(`근거 줄 내용이 바뀜: ${a} (잠금 ${locked} ≠ 지금 ${now}) — 줄이 밀렸으면 npm run evidence:remap, 내용이 바뀌었으면 판정을 다시 본 뒤 --lock`);
  }
  return out;
}

/**
 * 잠금으로 옮기기 — 해시가 달라진 근거마다 같은 해시의 줄을 지금 파일에서 찾아(여럿이면 옛 줄에서 가장 가까운 것) 줄 번호를 옮긴다.
 * texts: 하네스 JSON(경로 → 본문). 같은 근거 문자열은 모든 파일에서 함께 바꾸고 잠금 키도 옮긴다. 못 찾으면 lost(사람이 판정을 다시 본다).
 */
export function remapByLock(texts: Record<string, string>, lock: AnchorLock, read: ReadText = repoText): { texts: Record<string, string>; lock: AnchorLock; moved: [string, string][]; lost: string[] } {
  const moved: [string, string][] = [];
  const lost: string[] = [];
  const anchors = { ...lock.anchors };
  for (const [a, h] of Object.entries(lock.anchors)) {
    const now = currentHash(a, read);
    if (now === h) continue;
    const p = parse(a)!;
    const text = read(p.path);
    if (text == null) { lost.push(`${a} (파일 없음)`); continue; }
    const hits = lines(text).map((l, i) => (lineHash(l) === h ? i + 1 : 0)).filter(Boolean);
    if (!hits.length) { lost.push(a); continue; }
    const best = hits.sort((x, y) => Math.abs(x - p.line) - Math.abs(y - p.line))[0];
    const to = `${p.path}:${best}`;
    moved.push([a, to]);
  }
  // 키도 한 번에 옮긴다 — 옛 키를 모두 지운 뒤 새 키를 넣어야 a→b로 넣은 키를 b→c가 지우지 않는다
  for (const [a] of moved) delete anchors[a];
  for (const [a, to] of moved) anchors[to] = lock.anchors[a];
  const out: Record<string, string> = {};
  // 한 번에 바꾼다 — a→b, b→c가 함께 있어도 두 번 밀리지 않게
  const map = new Map(moved.map(([a, b]) => [`"${a}"`, `"${b}"`]));
  const re = /"[^"\n]+:\d+"/g;
  for (const [f, t] of Object.entries(texts)) out[f] = map.size ? t.replace(re, (m) => map.get(m) ?? m) : t;
  return { texts: out, lock: { note: lock.note, anchors }, moved, lost };
}

/** 지금 내용으로 잠근다 — 판정 근거 전부(새 근거 추가·안 쓰는 잠금 삭제) */
export function relock(anchors: string[], read: ReadText = repoText): AnchorLock {
  const out: Record<string, string> = {};
  for (const a of anchors) {
    const h = currentHash(a, read);
    if (h) out[a] = h;
  }
  return { note: LOCK_NOTE, anchors: out };
}

/** 잠그는 판정 파일들의 근거 전부 */
export function lockedAnchors(read: ReadText = repoText): string[] {
  return [...new Set(LOCKED_REVIEWS.flatMap((f) => {
    const t = read(f);
    return t ? anchorsOf(JSON.parse(t)) : [];
  }))].sort();
}

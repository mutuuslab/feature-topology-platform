// 예산·래칫 완화는 사유를 남긴다 (verify `standards`) — main보다 느슨해진 값마다 history 항목(날짜·키·이전→이후·사유)이 있어야 한다.
// 배경(2026-11-04 하네스 리뷰 H12): 첫 화면 예산 290→295·업무 절차 묶음 45를 note 문장에만 적어, 누가 왜 올렸는지 검사로 확인할 수 없었다.
// 약속:
//   · harness/budgets.json·perf-budgets.json — 최상위 "history": [{ date, key, from, to, reason }] (key는 점 경로: initialGzipKiB · allow.workflows · p95Ms.features.page)
//   · harness/baselines.json — 지표마다 "history" 배열(direction max는 값이 커질 때, min은 작아질 때)
// main이 없는 checkout(CI 얕은 복제)이나 main에 없는 파일은 비교할 수 없어 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF } from './lib.ts';

export interface HistoryEntry { date: string; key: string; from: number | null; to: number; reason: string }
export interface Loosening { key: string; from: number | null; to: number }

/** 예산 파일의 숫자 잎(점 경로) — note·history·비교용 값(beforeFixP95)은 뺀다 */
export function numericLeaves(o: unknown, skip: string[] = ['note', 'history', 'beforeFixP95'], prefix = ''): Record<string, number> {
  const out: Record<string, number> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) {
      if (!prefix && skip.includes(k)) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number') out[key] = v;
      else Object.assign(out, numericLeaves(v, skip, key));
    }
  }
  return out;
}

/** 예산(클수록 느슨) — main보다 커졌거나 main에 없던 값. allow.<묶음>이 새로 생기면 main의 기본 묶음 예산(chunkGzipKiB)과 비교한다 */
export function budgetLoosenings(cur: unknown, main: unknown): Loosening[] {
  const c = numericLeaves(cur);
  const m = numericLeaves(main);
  const out: Loosening[] = [];
  for (const [key, to] of Object.entries(c)) {
    const from = key in m ? m[key] : key.startsWith('allow.') && 'chunkGzipKiB' in m ? m.chunkGzipKiB : null;
    if (from === null || to > from) out.push({ key, from, to });
  }
  return out;
}

/** 래칫 기준(baselines.json) — direction max는 커지면, min은 작아지면 느슨. main에 없던 지표는 새 래칫이라 대상 아님 */
export function baselineLoosenings(cur: Record<string, { value: number; direction: 'max' | 'min' }>, main: Record<string, { value: number }>): Loosening[] {
  const out: Loosening[] = [];
  for (const [key, b] of Object.entries(cur)) {
    const from = main[key]?.value;
    if (from === undefined) continue;
    if (b.direction === 'max' ? b.value > from : b.value < from) out.push({ key, from, to: b.value });
  }
  return out;
}

/** 사유 기록이 없는 완화 — 같은 키·지금 값(to)의 항목, 날짜 YYYY-MM-DD, 사유 5자 이상 */
export function missingHistory(loose: Loosening[], history: HistoryEntry[] | undefined): Loosening[] {
  const ok = (h: HistoryEntry, l: Loosening) => h.key === l.key && h.to === l.to && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && typeof h.reason === 'string' && h.reason.trim().length >= 5;
  return loose.filter((l) => !(history ?? []).some((h) => ok(h, l)));
}

const onMain = (rel: string): string | null => {
  try {
    return execFileSync('git', ['show', `main:FF/${rel}`], { cwd: FF, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
};
const now = (rel: string) => JSON.parse(readFileSync(join(FF, rel), 'utf8'));

for (const rel of ['harness/budgets.json', 'harness/perf-budgets.json']) {
  test(`${rel} — main보다 느슨해진 예산마다 history 사유가 있다`, (t) => {
    const main = onMain(rel);
    if (main === null) return t.skip(`main:FF/${rel} 없음(main이 없는 checkout이거나 main에 아직 없는 파일) — 비교할 기준이 없다`);
    const cur = now(rel);
    assert.deepEqual(missingHistory(budgetLoosenings(cur, JSON.parse(main)), cur.history), [], `${rel}의 "history"에 { date, key, from, to, reason }을 남긴다`);
  });
}

test('harness/baselines.json — main보다 느슨해진 래칫마다 지표의 history 사유가 있다', (t) => {
  const main = onMain('harness/baselines.json');
  if (main === null) return t.skip('main:FF/harness/baselines.json 없음 — 비교할 기준이 없다');
  const cur = now('harness/baselines.json') as Record<string, { value: number; direction: 'max' | 'min'; history?: HistoryEntry[] }>;
  const missing = baselineLoosenings(cur, JSON.parse(main)).filter((l) => missingHistory([l], (cur[l.key].history ?? []).map((h) => ({ ...h, key: l.key }))).length);
  assert.deepEqual(missing, []);
});

test('완화 검사는 사유 없이 올린 예산·새 허용 묶음·느슨해진 래칫을 잡는다', () => {
  const main = { note: 'x', initialGzipKiB: 290, chunkGzipKiB: 40, allow: { a: 300 }, beforeFixP95: { q: 1 } };
  const cur = { note: 'y', initialGzipKiB: 295, chunkGzipKiB: 40, allow: { a: 300, workflows: 45 }, beforeFixP95: { q: 9 } };
  const loose = budgetLoosenings(cur, main);
  assert.deepEqual(loose, [{ key: 'initialGzipKiB', from: 290, to: 295 }, { key: 'allow.workflows', from: 40, to: 45 }]);
  assert.deepEqual(missingHistory(loose, []), loose);
  const history: HistoryEntry[] = [{ date: '2026-11-04', key: 'initialGzipKiB', from: 290, to: 295, reason: 'Feature DB 경로 표' }];
  assert.deepEqual(missingHistory(loose, history), [{ key: 'allow.workflows', from: 40, to: 45 }]);
  // 옛 사유로 더 올리면 다시 잡는다(to가 다르다), 사유가 짧아도 잡는다
  assert.equal(missingHistory([{ key: 'initialGzipKiB', from: 290, to: 300 }], history).length, 1);
  assert.equal(missingHistory(loose.slice(0, 1), [{ ...history[0], reason: '올림' }]).length, 1);
  // 줄이면 사유가 필요 없다
  assert.deepEqual(budgetLoosenings({ initialGzipKiB: 280 }, { initialGzipKiB: 290 }), []);
  // 래칫: max는 커지면, min은 작아지면 느슨
  assert.deepEqual(baselineLoosenings({ a: { value: 5, direction: 'max' }, b: { value: 3, direction: 'min' }, c: { value: 9, direction: 'min' }, n: { value: 1, direction: 'max' } }, { a: { value: 4 }, b: { value: 4 }, c: { value: 4 } }), [{ key: 'a', from: 4, to: 5 }, { key: 'b', from: 4, to: 3 }]);
});

test('오늘 올린 첫 화면 예산(290→295)·업무 절차 묶음(45)은 history에 사유가 있다', () => {
  const b = now('harness/budgets.json');
  for (const [key, to] of [['initialGzipKiB', 295], ['allow.workflows', 45]] as const) assert.ok(b.history?.some((h: HistoryEntry) => h.key === key && h.to === to && h.reason.length > 10), key);
});

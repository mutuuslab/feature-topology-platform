// 결함 기록 점검 — 각 it.fails가 "요구 단언"에서 실패하는지 확인한다.
// it.fails는 어떤 오류로든 실패하면 통과한다. 부팅·재현 단계 오류(supertest 상태 불일치, 없는 경로 등)로 실패해도
// 결함이 "기록된" 것처럼 보이므로, 사본에서 it.fails → it로 바꿔 돌리고 실패 원인이 AssertionError(expect 단언)인지 본다.
// 대상: harness/ads·orca review.json의 defect.probe 파일(같은 파일의 다른 it.fails 기록도 함께 점검).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FF, readJson } from './lib.ts';

export interface ProbeResult {
  file: string;
  title: string;
  status: string;
  message: string;
}

/** it.fails('제목' …) 제목 목록 */
export const failsTitles = (text: string) => [...text.matchAll(/\b(?:it|test)\.fails\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]);

/** 기록마다 사본 실행 결과가 실패이고, 실패 원인이 단언(AssertionError)이어야 한다 */
export function probeProblems(expected: { file: string; titles: string[] }[], results: ProbeResult[]): string[] {
  const p: string[] = [];
  for (const { file, titles } of expected)
    for (const title of titles) {
      const r = results.find((x) => x.file === file && x.title === title);
      if (!r) p.push(`${file} '${title}' 실행 결과 없음`);
      else if (r.status !== 'failed') p.push(`${file} '${title}' — it로 바꿔도 통과함: 결함이 이미 고쳐졌다(it.fails → it, defect 기록·판정 갱신)`);
      else if (!/^AssertionError/.test(r.message)) p.push(`${file} '${title}' — 요구 단언이 아니라 재현 단계에서 실패함: ${r.message.split('\n')[0].slice(0, 160)}`);
    }
  return p;
}

/** review.json들의 defect.probe 파일 */
export function probeFiles(): string[] {
  const reviews = [join(FF, 'harness', 'ads', 'review.json'), join(FF, 'harness', 'orca', 'review.json')].filter(existsSync);
  const files = new Set<string>();
  for (const f of reviews) {
    const r = readJson<{ requirements?: Record<string, { defect?: { probe: string } }>; items?: Record<string, { defect?: { probe: string } }> }>(f);
    for (const v of [...Object.values(r.requirements ?? {}), ...Object.values(r.items ?? {})]) if (v.defect) files.add(v.defect.probe);
  }
  return [...files].sort();
}

function main() {
  const backend = join(FF, 'backend');
  const files = probeFiles();
  const expected = files.map((file) => ({ file, titles: failsTitles(readFileSync(join(FF, file), 'utf8')) }));
  const copies = files.map((f) => join(FF, f.replace(/\.spec\.ts$/, '.probe-check.spec.ts')));
  const out = mkdtempSync(join(tmpdir(), 'ff-probes-'));
  let results: ProbeResult[] = [];
  try {
    files.forEach((f, i) => writeFileSync(copies[i], readFileSync(join(FF, f), 'utf8').replace(/\b(it|test)\.fails\(/g, '$1(')));
    const report = join(out, 'vitest.json');
    spawnSync(process.execPath, [join(FF, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...copies.map((c) => relative(backend, c).replace(/\\/g, '/')), '--reporter=json', `--outputFile=${report}`], { cwd: backend, stdio: 'ignore' });
    if (!existsSync(report)) throw new Error('vitest 결과 파일이 없음 — 백엔드 시험 환경 확인');
    const json = readJson<{ testResults: { name: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] }>(report);
    results = json.testResults.flatMap((t) => {
      const file = relative(FF, t.name).replace(/\\/g, '/').replace(/\.probe-check\.spec\.ts$/, '.spec.ts');
      return t.assertionResults.map((a) => ({ file, title: a.title, status: a.status, message: a.failureMessages[0] ?? '' }));
    });
  } finally {
    for (const c of copies) rmSync(c, { force: true });
    rmSync(out, { recursive: true, force: true });
  }
  const problems = probeProblems(expected, results);
  if (problems.length) {
    console.error(problems.map((x) => `✗ ${x}`).join('\n'));
    process.exit(1);
  }
  console.log(`✓ 결함 기록 ${expected.reduce((n, e) => n + e.titles.length, 0)}건(${files.length}개 파일) — 모두 요구 단언에서 실패`);
}

if (process.argv[1]?.endsWith('defect-probes.ts')) main();

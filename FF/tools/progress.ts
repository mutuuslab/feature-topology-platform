// PROGRESS.md의 자동 생성 구역(<!-- AUTO:… -->)을 manifest·래칫 기준에서 다시 쓴다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF, loadBaselines } from './lib.ts';

const require = createRequire(import.meta.url);
const { COMPONENTS, DOMAINS } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const conf = existsSync(join(FF, 'harness', 'conformance.json'))
  ? JSON.parse(readFileSync(join(FF, 'harness', 'conformance.json'), 'utf8'))
  : { report: [] };
const issuesOf = (id: string) => (conf.report.find((r: any) => r.id === id)?.issues ?? []).length;

const rows = COMPONENTS.map((c) => {
  const st = c.status === 'implemented' ? (issuesOf(c.id) ? '⚠' : '✅') : '·';
  return `| ${c.id} | ${c.ko} | ${c.tier} | ${st} | ${c.screens.join(' ') || '—'} | ${c.tests.length} |`;
});
const byDomain = Object.keys(DOMAINS)
  .map((d) => {
    const all = COMPONENTS.filter((c) => c.domain === d);
    return `${d} ${all.filter((c) => c.status === 'implemented').length}/${all.length}`;
  })
  .join(' · ');
const done = COMPONENTS.filter((c) => c.status === 'implemented').length;

const base = loadBaselines();
const metrics = Object.entries(base)
  .map(([k, m]) => `| ${k} | ${m.value} | ${m.direction === 'max' ? '↓ 줄이기' : '↑ 늘리기'} | ${m.note} |`)
  .join('\n');

const block = [
  `**컴포넌트 ${done}/${COMPONENTS.length}** — ${byDomain}`,
  '',
  '| ID | 컴포넌트 | Tier | 상태 | 화면 | 테스트 |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  '**래칫 기준** (`harness/baselines.json`)',
  '',
  '| 지표 | 현재 기준 | 방향 | 설명 |',
  '|---|---|---|---|',
  metrics,
].join('\n');

const p = join(FF, 'PROGRESS.md');
const md = readFileSync(p, 'utf8');
const re = /<!-- AUTO:conformance -->[\s\S]*?<!-- \/AUTO:conformance -->/;
if (!re.test(md)) {
  console.error('PROGRESS.md에 <!-- AUTO:conformance --> 구역이 없습니다');
  process.exit(1);
}
writeFileSync(p, md.replace(re, `<!-- AUTO:conformance -->\n${block}\n<!-- /AUTO:conformance -->`));
console.log(`PROGRESS.md 갱신 — 컴포넌트 ${done}/${COMPONENTS.length}`);

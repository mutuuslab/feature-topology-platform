// ADS·UNECE 요구 추적(ADS-UI10·BE18 일부) — harness/ads catalog.json(요구 64·인수시험 24·시나리오 10)·review.json(판정·근거)과
// 결함 기록(it.fails)을 backend/src/generated/ads-trace.ts로 굳힌다. 서버는 런타임에 harness를 읽지 않는다(GET /api/ads/trace).
//   node tools/ads-trace.ts           생성
//   node tools/ads-trace.ts --check   생성 파일이 원천과 같은지 검사
// 열린 결함: review.json 요구의 defect.probe 파일과 backend/test/ads/defects.spec.ts에서 '<요구 ID> …' 제목의 it.fails를 정적으로 센다.
// 시나리오 실행 결과(정상·실패 수)는 정적으로 셀 수 없어 싣지 않는다 — 화면은 '결과 없음'(통과 아님)으로 보인다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { FF } from './lib.ts';

const CATALOG = join(FF, 'harness', 'ads', 'catalog.json');
const REVIEW = join(FF, 'harness', 'ads', 'review.json');
const DEFECTS = join(FF, 'backend', 'test', 'ads', 'defects.spec.ts');
export const GENERATED = join(FF, 'backend', 'src', 'generated', 'ads-trace.ts');

const posix = (p: string) => p.split(sep).join('/');

type Catalog = {
  source: { file: string; sha256: string; revision: string; date: string };
  requirements: { id: string; title: string; category: string; priority: string; owner: string; content: string; acceptance: string; basis: string; tests?: string[]; claims?: string[]; hazards?: string[] }[];
  tests: { id: string; name: string; expected: string; requirements?: string[] }[];
  scenarios: { id: string; title: string; situation: string; handling: string }[];
};
type Review = {
  source?: { sha256: string; reviewedAt: string; reviewedCommit: string };
  requirements?: Record<string, { verdict: string; evidence?: string[]; tests?: string[]; gap?: string; plan?: string[]; defect?: { probe: string } }>;
  tests?: Record<string, { status: string; evidence?: string[]; plan?: string[] }>;
  scenarios?: Record<string, { current: string; gap?: string; plan?: string[] }>;
};

/** it.fails('<요구 ID> …') — 파일:줄과 제목 */
export function failsOf(file: string, text: string): { reqId: string; probe: string; title: string }[] {
  const out: { reqId: string; probe: string; title: string }[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/\b(?:it|test)\.fails\(\s*(['"`])(.*?)\1/g)) {
      const id = /^(FFP-F\d{3})\b/.exec(m[2]);
      if (id) out.push({ reqId: id[1], probe: `${file}:${i + 1}`, title: m[2] });
    }
  });
  return out;
}

export function buildAdsTrace(cat: Catalog, rev: Review, probeFiles: { file: string; text: string }[]) {
  const fails = probeFiles.flatMap((f) => failsOf(f.file, f.text));
  return {
    source: { file: cat.source.file, sha256: cat.source.sha256, revision: cat.source.revision, date: cat.source.date },
    reviewed: rev.source ? { sha256: rev.source.sha256, reviewedAt: rev.source.reviewedAt, reviewedCommit: rev.source.reviewedCommit } : null,
    requirements: cat.requirements.map((r) => {
      const v = rev.requirements?.[r.id];
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        priority: r.priority,
        owner: r.owner,
        content: r.content,
        acceptance: r.acceptance,
        basis: r.basis,
        tests: r.tests ?? [],
        claims: r.claims ?? [],
        hazards: r.hazards ?? [],
        review: v ? { verdict: v.verdict, evidence: v.evidence ?? [], tests: v.tests ?? [], gap: v.gap ?? '', plan: v.plan ?? [] } : null,
        defects: fails.filter((f) => f.reqId === r.id).map((f) => ({ probe: f.probe, title: f.title })),
      };
    }),
    tests: cat.tests.map((t) => {
      const v = rev.tests?.[t.id];
      return { id: t.id, name: t.name, expected: t.expected, requirements: t.requirements ?? [], review: v ? { status: v.status, evidence: v.evidence ?? [], plan: v.plan ?? [] } : null };
    }),
    scenarios: cat.scenarios.map((s) => {
      const v = rev.scenarios?.[s.id];
      return { id: s.id, title: s.title, situation: s.situation, handling: s.handling, review: v ? { current: v.current, gap: v.gap ?? '', plan: v.plan ?? [] } : null };
    }),
  };
}

export function renderAdsTrace(doc: ReturnType<typeof buildAdsTrace>): string {
  return [
    '// 생성 파일 — tools/ads-trace.ts가 harness/ads catalog.json·review.json과 결함 기록(it.fails)에서 만든다. 손으로 고치지 않는다(node tools/ads-trace.ts --check가 잡는다).',
    "import type { AdsTraceDoc } from '@ff/contracts';",
    '',
    `export const ADS_TRACE: AdsTraceDoc = ${JSON.stringify(doc, null, 1)};`,
    '',
  ].join('\n');
}

function current(): string {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8')) as Catalog;
  const rev = JSON.parse(readFileSync(REVIEW, 'utf8')) as Review;
  const files = new Set<string>([DEFECTS]);
  for (const v of Object.values(rev.requirements ?? {})) if (v.defect) files.add(join(FF, v.defect.probe));
  const probeFiles = [...files].filter((f) => existsSync(f)).map((f) => ({ file: posix(relative(FF, f)), text: readFileSync(f, 'utf8') }));
  return renderAdsTrace(buildAdsTrace(cat, rev, probeFiles));
}

function main(): number {
  const want = current();
  const rel = posix(relative(FF, GENERATED));
  if (process.argv.includes('--check')) {
    if (!existsSync(GENERATED) || readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n') !== want) {
      console.error(`ads-trace:check  ✗ ${rel}가 harness/ads 원천과 다름(node tools/ads-trace.ts)`);
      return 1;
    }
    console.log(`ads-trace:check  ✓ ${rel}`);
    return 0;
  }
  mkdirSync(dirname(GENERATED), { recursive: true });
  writeFileSync(GENERATED, want);
  console.log(`ads-trace  → ${rel}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/ads-trace.ts')) process.exit(main());

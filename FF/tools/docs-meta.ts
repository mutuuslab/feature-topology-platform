// 문서 메타데이터 검사 — docs/**/*.md 프런트매터 ↔ docs/_templates/frontmatter-schema.yaml(필수 필드·enum·ID 형식),
// traces·related의 ID ↔ docs/_meta/id-registry.yaml, Feature DB 문서(30-95)의 수치 ↔ data/reference/feature-db/v1.3.
//   node tools/docs-meta.ts            검사 — 새 위반이면 실패
//   node tools/docs-meta.ts --update   사라진 기존 위반을 기준에서 뺀다(기준에 더하지는 않는다)
// 기존 위반(미등록 ID 40여 개, 프런트매터 없는 문서 등)은 docs/_meta/docs-meta-baseline.json 래칫으로 둔다.
// 최근 고친 문서(last_updated ≥ STRICT_SINCE)와 수치 대조는 기준을 쓰지 않는다 — 고친 문서는 바로 맞춘다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FF, walk } from './lib.ts';

export const DOCS = join(FF, '..', 'docs');
export const BASELINE_FILE = join(DOCS, '_meta', 'docs-meta-baseline.json');
const REFDB_DATA = join(FF, 'data', 'reference', 'feature-db', 'v1.3');
const REFDB_DOC = '30-data-model/30-95-feature-reference-db.md';
/** 이 날짜 이후 고친 문서는 기준(래칫) 없이 바로 맞아야 한다 */
export const STRICT_SINCE = '2026-11-01';
/** 생성기 견본(자리표시 ID)은 검사하지 않는다 */
const SKIP_DIRS = ['_templates'];

export type Fm = Record<string, string | string[] | Record<string, string[]>>;
export interface Violation {
  doc: string;
  kind: string;
  detail: string;
}
export const key = (v: Violation) => `${v.doc} | ${v.kind} | ${v.detail}`;

// ── 프런트매터 읽기(외부 의존성 없이 — 이 저장소 문서가 쓰는 꼴만) ──────────────
const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
const flowList = (v: string) =>
  v
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(unquote)
    .filter(Boolean);

/** 첫 줄이 '---'인 문서의 프런트매터. 없으면 null. 지원: `k: v`, `k: [a, b]`, `k:` + `  - a`, `k:` + `  sub: [a]`/`  sub:` + `    - a` */
export function parseFrontmatter(text: string): Fm | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const out: Fm = {};
  let top: string | null = null;
  let sub: string | null = null;
  for (const raw of lines.slice(1, end)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const ind = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const item = /^-\s*(.*)$/.exec(line);
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (ind === 0 && kv) {
      top = kv[1];
      sub = null;
      out[top] = kv[2] === '' ? [] : kv[2].trim().startsWith('[') ? flowList(kv[2]) : unquote(kv[2]);
    } else if (top && item) {
      const cur = out[top];
      if (sub && cur && !Array.isArray(cur) && typeof cur === 'object') cur[sub].push(unquote(item[1]));
      else if (Array.isArray(cur)) cur.push(unquote(item[1]));
    } else if (top && kv) {
      let cur = out[top];
      if (Array.isArray(cur) && cur.length === 0) cur = out[top] = {};
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
        sub = kv[1];
        cur[sub] = kv[2] === '' ? [] : kv[2].trim().startsWith('[') ? flowList(kv[2]) : [unquote(kv[2])];
      }
    }
  }
  return out;
}

// ── 스키마·레지스트리 ─────────────────────────────────────────
export interface Schema {
  required: string[];
  enums: Record<string, string[]>;
  idPattern: RegExp;
}

/** frontmatter-schema.yaml의 required_fields — 필드 이름, enum 값, id 형식 */
export function loadSchema(text: string): Schema {
  const block = /^required_fields:\n([\s\S]*?)^\S/m.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? '';
  const fields = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => ({ name: m[1], at: m.index! }));
  const enums: Record<string, string[]> = {};
  let idPattern = /^/;
  fields.forEach((f, i) => {
    const body = block.slice(f.at, fields[i + 1]?.at ?? block.length);
    const values = /values:\s*\[([\s\S]*?)\]/.exec(body);
    if (values) enums[f.name] = values[1].split(/[,\s]+/).filter(Boolean);
    const pat = /pattern:\s*"([^"]+)"/.exec(body);
    if (f.name === 'id' && pat) idPattern = new RegExp(pat[1]);
  });
  return { required: fields.map((f) => f.name), enums, idPattern };
}

const ID_PREFIX = /^(?:FR|NFR|ARC|ENT|EDG|REL|RULE|ENG|GATE|LCS|SCR|FLW|INT|DIAG|TC|FEAT|PAT|DS|WF)-[A-Za-z0-9][A-Za-z0-9-]*$/;
/** id-registry.yaml에 나오는 모든 ID(키·목록 항목) */
export function registeredIds(text: string): Set<string> {
  return new Set([...text.matchAll(/\b(?:FR|NFR|ARC|ENT|EDG|REL|RULE|ENG|GATE|LCS|SCR|FLW|INT|DIAG|TC|FEAT|PAT|DS|WF)-[A-Za-z0-9][A-Za-z0-9-]*\b/g)].map((m) => m[0]));
}

// ── 문서 하나 ────────────────────────────────────────────────
export interface Ctx {
  schema: Schema;
  registry: Set<string>;
}

/** 추적 대상 ID — traces 아래 모든 값과 최상위 related·diagrams. ID 접두가 아닌 값(RD-P2-04 등)은 보지 않는다 */
function traceIds(fm: Fm): string[] {
  const vals: string[] = [];
  const t = fm.traces;
  if (t && typeof t === 'object' && !Array.isArray(t)) for (const v of Object.values(t)) vals.push(...v);
  for (const k of ['related', 'diagrams']) if (Array.isArray(fm[k])) vals.push(...(fm[k] as string[]));
  return vals.filter((v) => ID_PREFIX.test(v));
}

export function checkDoc(doc: string, text: string, ctx: Ctx): Violation[] {
  const out: Violation[] = [];
  const v = (kind: string, detail: string) => out.push({ doc, kind, detail });
  const fm = parseFrontmatter(text);
  if (!fm) {
    v('no-frontmatter', '-');
    return out;
  }
  for (const f of ctx.schema.required) if (fm[f] === undefined || fm[f] === '') v('missing', f);
  for (const [f, values] of Object.entries(ctx.schema.enums)) {
    const val = fm[f];
    if (typeof val === 'string' && val && !values.includes(val)) v('enum', `${f}=${val}`);
  }
  const id = typeof fm.id === 'string' ? fm.id : '';
  if (id && !ctx.schema.idPattern.test(id)) v('id-pattern', id);
  else if (id && !ctx.registry.has(id)) v('id-unregistered', id);
  if (typeof fm.last_updated === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(fm.last_updated)) v('format', `last_updated=${fm.last_updated}`);
  if (typeof fm.cycle === 'string' && !/^\d+$/.test(fm.cycle)) v('format', `cycle=${fm.cycle}`);
  if (typeof fm.version === 'string' && !/^\d+\.\d+\.\d+$/.test(fm.version)) v('format', `version=${fm.version}`);
  for (const t of traceIds(fm)) if (!ctx.registry.has(t)) v('trace-unregistered', t);
  return out;
}

/** 최근 고친 문서 — 기준(래칫)을 쓰지 않는다 */
export function isStrict(text: string): boolean {
  const lu = parseFrontmatter(text)?.last_updated;
  return typeof lu === 'string' && lu >= STRICT_SINCE;
}

// ── Feature DB 문서 수치 ↔ 데이터 ─────────────────────────────
export interface RefdbData {
  manifest: any;
  refs: any[];
  taxonomy: { level: string }[];
}

export function loadRefdbData(dir = REFDB_DATA): RefdbData {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^﻿/, ''));
  return { manifest: read('manifest.json'), refs: read('refs.json'), taxonomy: read('taxonomy.json') };
}

const count = <T>(xs: T[], f: (x: T) => unknown, val: unknown) => xs.filter((x) => f(x) === val).length;
/** 문서 문장(정규식 캡처) → 데이터에서 계산한 값. 문장을 고치면 여기 식도 고친다 */
export const REFDB_CLAIMS: { what: string; re: RegExp; values: (d: RefdbData) => (number | string)[] }[] = [
  { what: '원본 기준 행 수', re: /`03_FeatureDB`\(([\d,]+)행/, values: (d) => [d.manifest.files.refs.rows] },
  { what: '분류 표 기준 행 수', re: /\| \(기준 행\) \| `FeatureRef` \| L2 정의 템플릿 \| ([\d,]+) \|/, values: (d) => [d.refs.length] },
  { what: '상태 수(이전 점검)', re: /상태 수 (\d+)\/(\d+)\/(\d+)/, values: (d) => ['ACTIVE', 'REVIEW', 'DEPRECATED'].map((s) => d.manifest.statusCounts[s]) },
  { what: '이전 점검 행 수', re: /\*\*이전 점검\*\*[^\n]*?: ([\d,]+)행/, values: (d) => [d.refs.length] },
  { what: '활성 행', re: /`ACTIVE` 활성 \| ([\d,]+)행/, values: (d) => [count(d.refs, (r) => r.status, 'ACTIVE')] },
  { what: '검토 필요 행', re: /`REVIEW` 검토 필요 \| ([\d,]+)행/, values: (d) => [count(d.refs, (r) => r.status, 'REVIEW')] },
  { what: '폐기 예정 행', re: /`DEPRECATED` 폐기 예정 \| ([\d,]+)행/, values: (d) => [count(d.refs, (r) => r.status, 'DEPRECATED')] },
  { what: '폐기 행', re: /`RETIRED` 폐기 \| ([\d,]+)행/, values: (d) => [count(d.refs, (r) => r.status, 'RETIRED')] },
  { what: '출처 행', re: /`09_출처` \(([\d,]+)행\)/, values: (d) => [d.manifest.files.sources.rows] },
  { what: '세부기능 후보 행', re: /`13_세부기능후보` \(([\d,]+)행\)/, values: (d) => [d.manifest.files.subfunctions.rows] },
  { what: '세부기능 후보 수(R-2)', re: /`13` 세부기능 후보 ([\d,]+)개/, values: (d) => [d.manifest.files.subfunctions.rows] },
  { what: '정의 작성 행', re: /([\d,]+)행\(파일럿 작성분\)/, values: (d) => [d.manifest.definitions.rows] },
  { what: '03b 작성 행(이전 점검)', re: /`03b` 작성 ([\d,]+)행/, values: (d) => [d.manifest.definitions.rows] },
  { what: '도메인·컴포넌트(이전 점검)', re: /도메인 (\d+)·컴포넌트 (\d+)/, values: (d) => [count(d.taxonomy, (t) => t.level, 'DOMAIN'), count(d.taxonomy, (t) => t.level, 'COMPONENT')] },
  { what: '도메인 수(분류 표)', re: /\| L0 Domain \| (\d+) \(/, values: (d) => [count(d.taxonomy, (t) => t.level, 'DOMAIN')] },
  { what: '컴포넌트 수(분류 표)', re: /\| L1 하위 \| (\d+) \|/, values: (d) => [count(d.taxonomy, (t) => t.level, 'COMPONENT')] },
  { what: 'SW 계층', re: /Application (\d+) · Platform (\d+) · Back-end (\d+)/, values: (d) => ['Application', 'Platform', 'Back-end'].map((s) => count(d.refs, (r) => r.swStack, s)) },
  { what: '수명주기', re: /Commodity (\d+) · Differentiating (\d+) · Innovation (\d+)/, values: (d) => ['Commodity', 'Differentiating', 'Innovation'].map((s) => count(d.refs, (r) => r.lifecycle, s)) },
  { what: '규모 근거 D 비중', re: /규모 근거 D 비중\(현재 ([\d.]+)%\)/, values: (d) => [((count(d.refs, (r) => r.sizeEvidenceGrade, 'D') / d.refs.length) * 100).toFixed(1)] },
];

export function refdbClaimViolations(text: string, data: RefdbData, doc = REFDB_DOC): Violation[] {
  const out: Violation[] = [];
  for (const c of REFDB_CLAIMS) {
    const m = c.re.exec(text);
    if (!m) {
      out.push({ doc, kind: 'number-claim-missing', detail: `${c.what} — 문장이 바뀌었다(tools/docs-meta.ts REFDB_CLAIMS를 함께 고친다)` });
      continue;
    }
    const got = m.slice(1).map((x) => x.replace(/,/g, ''));
    const want = c.values(data).map(String);
    if (got.join('/') !== want.join('/')) out.push({ doc, kind: 'number-mismatch', detail: `${c.what}: 문서 ${got.join('/')} ↔ 데이터 ${want.join('/')}` });
  }
  return out;
}

// ── 래칫 ─────────────────────────────────────────────────────
export interface Outcome {
  fresh: Violation[];
  known: number;
  stale: string[];
}

/** strictDocs의 위반과 기준에 없는 위반은 새 위반. 기준에 있는데 더 안 나는 것은 stale(개선). */
export function evaluate(all: Violation[], baseline: string[], strictDocs: Set<string>): Outcome {
  const base = new Set(baseline);
  const keys = new Set(all.map(key));
  const fresh = all.filter((v) => strictDocs.has(v.doc) || !base.has(key(v)));
  return { fresh, known: all.length - fresh.length, stale: baseline.filter((k) => !keys.has(k)) };
}

export function collect(docsDir = DOCS): { all: Violation[]; strict: Set<string> } {
  const ctx: Ctx = {
    schema: loadSchema(readFileSync(join(docsDir, '_templates', 'frontmatter-schema.yaml'), 'utf8')),
    registry: registeredIds(readFileSync(join(docsDir, '_meta', 'id-registry.yaml'), 'utf8')),
  };
  const all: Violation[] = [];
  const strict = new Set<string>();
  for (const p of walk(docsDir, ['.md'], ['node_modules', ...SKIP_DIRS])) {
    const doc = relative(docsDir, p).split(sep).join('/');
    const text = readFileSync(p, 'utf8');
    if (isStrict(text)) strict.add(doc);
    all.push(...checkDoc(doc, text, ctx));
    if (doc === REFDB_DOC) {
      strict.add(doc);
      all.push(...refdbClaimViolations(text, loadRefdbData()));
    }
  }
  return { all, strict };
}

function main() {
  const { all, strict } = collect();
  const update = process.argv.includes('--update');
  if (!existsSync(BASELINE_FILE)) {
    const seed = all.filter((v) => !strict.has(v.doc)).map(key).sort();
    writeFileSync(BASELINE_FILE, JSON.stringify({ note: '문서 메타데이터 기존 위반(래칫) — tools/docs-meta.ts. 줄이기만 한다(--update).', violations: seed }, null, 2) + '\n');
    console.log(`  · docs-meta 기준 신규 등록: 기존 위반 ${seed.length}건`);
  }
  const baseline: string[] = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).violations;
  const r = evaluate(all, baseline, strict);
  for (const v of r.fresh) console.error(`  ✕ ${key(v)}`);
  if (r.stale.length) {
    if (update) {
      const keep = baseline.filter((k) => !r.stale.includes(k));
      writeFileSync(BASELINE_FILE, JSON.stringify({ ...JSON.parse(readFileSync(BASELINE_FILE, 'utf8')), violations: keep }, null, 2) + '\n');
      console.log(`  ✓ docs-meta 기준 ${baseline.length} → ${keep.length} 잠금`);
    } else console.log(`  ✓ 기존 위반 ${r.stale.length}건이 사라졌다 — node tools/docs-meta.ts --update 로 기준에서 빼세요`);
  }
  console.log(`  ${r.fresh.length ? '✕' : '✓'} docs-meta: 새 위반 ${r.fresh.length}, 기존 위반 ${r.known}(기준 ${baseline.length}), 엄격 문서 ${strict.size}`);
  process.exit(r.fresh.length ? 1 : 0);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/docs-meta.ts')) main();

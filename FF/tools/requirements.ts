// 기능명세서 요구사항 추적 — node tools/requirements.ts (verify 단계 'req')
//   --sync [xlsx]          명세서(xlsx)를 읽어 harness/requirements/catalog.json을 만든다(원본 경로·SHA-256·시트별 행 기록).
//                          기본 경로는 catalog.json의 source.path, 없으면 FF_REQ_XLSX.
//   --import-review <dir>  (일회성) 검토 결과 표(gap-0N.md)를 review.json의 판정으로 옮긴다. 결함·결정·주제는 사람이 적는다.
//   (기본)                 검사 → harness/requirements/status.json·REPORT.md 생성 → 래칫.
// 검사
//   (1) 원본: 원본 xlsx가 이 컴퓨터에 있으면 SHA-256이 카탈로그와 같아야 한다(바뀌었으면 --sync 후 판정 재검토). 없으면 커밋된 카탈로그 기준.
//   (2) 판정: review.json이 같은 원본을 검토한 것이고, 말단 요구사항마다 판정이 정확히 하나(구현·부분·미구현·범위 밖).
//   (3) 추적: 코드의 `@req FR-…` 표식은 카탈로그에 있는 ID여야 하고, 미구현·범위 밖 판정인 요구사항에 달 수 없다(판정을 먼저 갱신).
//       표식은 요구사항을 실제로 집행하는 함수·화면에만 단다. 단순 언급은 추적으로 세지 않는다.
//   (4) 결함: review.json의 결함마다 실행되는 기록(시험 파일의 `it.fails(` 줄에 ID)이 있어야 한다. 결함을 고치면 그 시험이 실패하므로
//       `it(`으로 바꾸고 결함 목록에서 빼면서 판정을 갱신한다 — 결함 기록과 결함 목록이 어긋나면 실패.
//   (5) 결정·주제: 참조한 요구사항이 카탈로그에 있어야 한다(접두어 패턴은 1건 이상 맞아야 한다).
//   (6) 래칫: 구현 판정 수·추적된 요구사항 수는 줄 수 없고, 미구현 판정 수·추적 없는 구현 판정 수·미해결 결함 수는 늘 수 없다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ratchet, readJson, rel, walk } from './lib.ts';
import { readWorkbook, type Sheet } from './xlsx.ts';

export const REQ_DIR = join(FF, 'harness', 'requirements');
export const CATALOG = join(REQ_DIR, 'catalog.json');
export const REVIEW = join(REQ_DIR, 'review.json');
export const STATUS = join(REQ_DIR, 'status.json');
export const REPORT = join(REQ_DIR, 'REPORT.md');

export const VERDICTS = ['구현', '부분', '미구현', '범위 밖'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const LEAF_ID = /^FR-[A-Z]{2,5}-\d{3}-\d{3}$/;
export const GROUP_ID = /^FR-[A-Z]{2,5}-\d{3}$/;
const ANY_ID = /\bFR-[A-Z]{2,5}-\d{3}(?:-\d{3})?\b/g;
const TAG = /@req\s+((?:FR-[A-Z]{2,5}-\d{3}-\d{3}[\s,]*)+)/g;

export interface Requirement {
  /** 카탈로그 안에서 유일한 키 — 명세서에 같은 ID가 두 번 나오면 두 번째부터 `ID#2` */
  key: string;
  id: string;
  level: 'group' | 'leaf';
  sheet: string;
  row: number;
  component: string;
  category: string;
  name: string;
  description: string;
  input: string;
  output: string;
  area: string;
  note: string;
}
export interface SpecIssue {
  kind: 'DUPLICATE_ID' | 'DUPLICATE_TEXT' | 'BAD_ID' | 'EMPTY_DESCRIPTION';
  ids: string[];
  detail: string;
}
export interface Catalog {
  note: string;
  source: { path: string; file: string; sha256: string; bytes: number };
  sheets: { name: string; requirements: number; leaves: number }[];
  requirements: Requirement[];
  specIssues: SpecIssue[];
}
export interface Decision {
  id: string;
  title: string;
  spec: string;
  design: string;
  status: '결정 대기' | '결정됨';
  resolution?: string;
  requirements: string[];
}
export interface Theme {
  id: string;
  title: string;
  current: string;
  requirements: string[];
}
export interface Defect {
  id: string;
  summary: string;
  probe: string;
}
export interface Review {
  note: string;
  source: { sha256: string; reviewedAt: string; reviewedCommit: string };
  sheets: { sheet: string; notes: string[] }[];
  verdicts: Record<string, { verdict: Verdict; detail?: string; evidence: string; gap: string }>;
  defects: Defect[];
  decisions: Decision[];
  themes: Theme[];
  /** 검토자가 찾은 명세서 정정 필요 사항(카탈로그가 기계적으로 찾지 못하는 것 — 같은 뜻의 다른 문장 등) */
  specNotes: { ids: string[]; detail: string }[];
}

// ─── 명세서 읽기 ─────────────────────────────────────────────

const COLS = { component: '컴포넌트', category: '카테고리', input: '입력', id: '요구사항 ID', name: '요구사항 명', description: '상세 설명', output: '출력', area: '적용 영역', note: '비고' } as const;
const clean = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim();

/** 요구사항 시트(01_…~06_…) 한 장 → 행. 머리 행은 '요구사항 ID'가 원본 열(9번째 이후)에 있는 메타데이터 행이다 */
export function sheetRequirements(sheet: Sheet): Omit<Requirement, 'key' | 'level'>[] {
  const header = sheet.rows.find((r) => r.slice(8).includes(COLS.id));
  if (!header) throw new Error(`시트 '${sheet.name}'에 '요구사항 ID' 머리 행이 없습니다`);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, name]) => [k, header.findIndex((c, i) => i >= 8 && c === name)])) as Record<keyof typeof COLS, number>;
  const get = (r: string[], k: keyof typeof COLS) => (idx[k] >= 0 ? clean(r[idx[k]]) : '');
  let component = '';
  let category = '';
  const out: Omit<Requirement, 'key' | 'level'>[] = [];
  sheet.rows.forEach((r, i) => {
    if (clean(r[0]) !== '요구사항') return;
    component = get(r, 'component') || component;
    category = get(r, 'category') || category;
    out.push({
      id: get(r, 'id') || clean(r[1]),
      sheet: sheet.name,
      row: i + 1,
      component,
      category,
      name: get(r, 'name'),
      description: get(r, 'description'),
      input: get(r, 'input'),
      output: get(r, 'output'),
      area: get(r, 'area'),
      note: get(r, 'note'),
    });
  });
  return out;
}

export function buildCatalog(sheets: Sheet[], source: Catalog['source']): Catalog {
  const reqSheets = sheets.filter((s) => /^0[1-9]_/.test(s.name));
  const seen = new Map<string, number>();
  const requirements: Requirement[] = [];
  const issues: SpecIssue[] = [];
  for (const s of reqSheets) {
    for (const r of sheetRequirements(s)) {
      const n = (seen.get(r.id) ?? 0) + 1;
      seen.set(r.id, n);
      const level = LEAF_ID.test(r.id) ? 'leaf' : 'group';
      if (!LEAF_ID.test(r.id) && !GROUP_ID.test(r.id)) issues.push({ kind: 'BAD_ID', ids: [r.id], detail: `${r.sheet} ${r.row}행 — ID 형식(FR-XXX-NNN[-NNN])이 아님` });
      if (level === 'leaf' && !r.description) issues.push({ kind: 'EMPTY_DESCRIPTION', ids: [r.id], detail: `${r.sheet} ${r.row}행 — 상세 설명 없음` });
      requirements.push({ key: n === 1 ? r.id : `${r.id}#${n}`, level, ...r });
    }
  }
  for (const [id, n] of seen) {
    if (n > 1) {
      const rows = requirements.filter((r) => r.id === id).map((r) => `${r.sheet} ${r.row}행`);
      issues.push({ kind: 'DUPLICATE_ID', ids: [id], detail: `같은 ID가 ${n}번 나온다 — ${rows.join(', ')}` });
    }
  }
  const byText = new Map<string, Requirement[]>();
  for (const r of requirements) {
    if (r.level !== 'leaf' || !r.description) continue;
    const k = r.description.replace(/\s+/g, ' ');
    byText.set(k, [...(byText.get(k) ?? []), r]);
  }
  for (const rs of byText.values()) {
    const ids = [...new Set(rs.map((r) => r.id))];
    if (ids.length > 1) issues.push({ kind: 'DUPLICATE_TEXT', ids, detail: `상세 설명이 같다 — ${rs.map((r) => `${r.key}(${r.sheet} ${r.row}행)`).join(', ')}` });
  }
  return {
    note: 'tools/requirements.ts --sync가 만든다 — 손으로 고치지 않는다. 원본 명세서가 바뀌면 다시 만들고 review.json 판정을 재검토한다.',
    source,
    sheets: reqSheets.map((s) => {
      const rs = requirements.filter((r) => r.sheet === s.name);
      return { name: s.name, requirements: rs.length, leaves: rs.filter((r) => r.level === 'leaf').length };
    }),
    requirements,
    specIssues: issues,
  };
}

// ─── 검토 결과 가져오기(일회성) ──────────────────────────────

const normVerdict = (s: string): { verdict: Verdict; detail?: string } | null => {
  const t = s.replace(/\*/g, '').trim();
  const v = t.startsWith('미구현') ? '미구현' : t.startsWith('구현') ? '구현' : t.startsWith('부분') ? '부분' : t.startsWith('범위') ? '범위 밖' : null;
  if (!v) return null;
  const rest = t.slice(v.length).trim();
  return rest ? { verdict: v, detail: rest } : { verdict: v };
};

/** gap 표 한 줄 → [ID, 판정, 근거, 반영 필요] — 셀 안의 `\|`는 나누지 않는다 */
export function parseGapRow(line: string): { id: string; verdict: string; evidence: string; gap: string } | null {
  if (!/^\|\s*(FR-)?[A-Z]{2,5}-\d{3}-\d{3}\s*\|/.test(line)) return null;
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  if (cells.length < 5) return null;
  const id = cells[0].startsWith('FR-') ? cells[0] : `FR-${cells[0]}`;
  return { id, verdict: cells[2], evidence: cells.slice(3, -1).join(' | '), gap: cells[cells.length - 1] ?? '' };
}

export function importReview(cat: Catalog, dir: string, prev: Review | null): Review {
  const files = readdirSync(dir).filter((f) => /^gap-0\d\.md$/.test(f)).sort();
  const verdicts: Review['verdicts'] = {};
  const sheets: Review['sheets'] = [];
  const problems: string[] = [];
  const leafKeys = new Set(cat.requirements.filter((r) => r.level === 'leaf').map((r) => r.key));
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const firstTable = lines.findIndex((l) => l.startsWith('|'));
    const no = Number(f.slice(5, 6));
    const sheet = cat.sheets[no - 1]?.name ?? f;
    sheets.push({ sheet, notes: lines.slice(1, firstTable).filter((l) => /^(- |> |경로 약어)/.test(l)).map((l) => l.replace(/^- /, '')) });
    const count = new Map<string, number>();
    for (const l of lines) {
      const r = parseGapRow(l);
      if (!r) continue;
      const n = (count.get(r.id) ?? 0) + 1;
      count.set(r.id, n);
      const key = n === 1 ? r.id : `${r.id}#${n}`;
      const v = normVerdict(r.verdict);
      if (!v) problems.push(`${f}: ${key} 판정 '${r.verdict}'을 알 수 없음`);
      else if (!leafKeys.has(key)) problems.push(`${f}: ${key} — 카탈로그 말단 요구사항이 아님`);
      else verdicts[key] = { ...v, evidence: r.evidence, gap: r.gap };
    }
  }
  if (problems.length) throw new Error(`검토 결과 가져오기 실패:\n  ${problems.join('\n  ')}`);
  return {
    note: '판정은 사람이 검토해 적는다(구현 = 백엔드 강제 + 시험 근거, 부분 = 일부, 미구현 = 근거 없음, 범위 밖 = 외부 시스템 몫). 코드에 @req를 달거나 결함을 고치면 여기 판정도 함께 갱신한다.',
    source: { sha256: cat.source.sha256, reviewedAt: prev?.source.reviewedAt ?? new Date().toISOString().slice(0, 10), reviewedCommit: prev?.source.reviewedCommit ?? '' },
    sheets,
    verdicts,
    defects: prev?.defects ?? [],
    decisions: prev?.decisions ?? [],
    themes: prev?.themes ?? [],
    specNotes: prev?.specNotes ?? [],
  };
}

// ─── 추적·검사 ───────────────────────────────────────────────

const SCAN = ['contracts/src', 'backend/src', 'backend/test', 'frontend/src', 'e2e/tests', 'sim/carla'];
const isTest = (r: string) => /(\.test\.|\.spec\.|__tests__\/|backend\/test\/|e2e\/tests\/|sim\/carla\/tests\/)/.test(r);

/** 요구사항 ID의 영역 접두어 — 'FR-RTE-005-001' → 'FR-RTE' */
export const areaOf = (id: string) => id.split('-').slice(0, 2).join('-');

/** 한 파일 — 알 수 없는 ID, @req 표식, 시험 언급, 결함 기록(it.fails 줄의 ID).
 *  이 명세서가 쓰는 영역 접두어(FR-REG 등)의 ID만 본다 — 다른 명세의 ID 체계(FR-ULOSS-… 등)는 건드리지 않는다 */
export function scanText(r: string, text: string, known: Set<string>, areas: Set<string> = new Set([...known].map(areaOf))) {
  const unknown: string[] = [];
  const tags: string[] = [];
  const mentions: string[] = [];
  const probes: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ANY_ID)) {
      if (!areas.has(areaOf(m[0]))) continue;
      if (!known.has(m[0])) unknown.push(`${r}:${i + 1}  ${m[0]} — 기능명세서 카탈로그에 없는 요구사항 ID`);
      else mentions.push(m[0]);
    }
    for (const m of line.matchAll(TAG)) for (const id of m[1].match(ANY_ID) ?? []) tags.push(id);
    if (/\b(?:it|test)\.fails\(/.test(line)) for (const m of line.matchAll(ANY_ID)) if (known.has(m[0])) probes.push(m[0]);
  });
  return { unknown, tags, mentions, probes };
}

/** 'FR-RBK-' 처럼 '-'로 끝나면 접두어, 아니면 정확한 ID */
export function expand(patterns: string[], ids: string[]): { ids: string[]; empty: string[] } {
  const out = new Set<string>();
  const empty: string[] = [];
  for (const p of patterns) {
    const hit = p.endsWith('-') ? ids.filter((id) => id.startsWith(p)) : ids.filter((id) => id === p);
    if (!hit.length) empty.push(p);
    for (const h of hit) out.add(h);
  }
  return { ids: [...out], empty };
}

export interface Trace {
  implemented: string[];
  tested: string[];
}

export interface Check {
  problems: { name: string; errs: string[] }[];
  traces: Map<string, Trace>;
  probes: Map<string, string[]>;
}

export function check(cat: Catalog, review: Review, files: { rel: string; text: string }[]): Check {
  const leaves = cat.requirements.filter((r) => r.level === 'leaf');
  const leafIds = [...new Set(leaves.map((r) => r.id))];
  const known = new Set(cat.requirements.map((r) => r.id));
  const areas = new Set([...known].map(areaOf));
  const out: Check['problems'] = [];
  const push = (name: string, errs: string[]) => errs.length && out.push({ name, errs });

  push('검토 원본', review.source.sha256 === cat.source.sha256 ? [] : [`review.json은 다른 명세서(${review.source.sha256.slice(0, 12)}…)를 검토했다 — 카탈로그 ${cat.source.sha256.slice(0, 12)}… 기준으로 판정을 재검토`]);
  const keys = new Set(leaves.map((r) => r.key));
  push('판정 누락', [...keys].filter((k) => !review.verdicts[k]).map((k) => `${k} — 판정 없음`));
  push(
    '판정 오류',
    Object.entries(review.verdicts).flatMap(([k, v]) => [
      ...(keys.has(k) ? [] : [`${k} — 카탈로그 말단 요구사항이 아님`]),
      ...((VERDICTS as readonly string[]).includes(v.verdict) ? [] : [`${k} — 판정 '${v.verdict}'은 ${VERDICTS.join('·')} 중 하나여야 한다`]),
    ]),
  );
  const verdictOf = (id: string) => review.verdicts[id]?.verdict;

  const traces = new Map<string, Trace>(leafIds.map((id) => [id, { implemented: [], tested: [] }]));
  const probes = new Map<string, string[]>();
  const unknown: string[] = [];
  const badTags: string[] = [];
  for (const f of files) {
    const s = scanText(f.rel, f.text, known, areas);
    unknown.push(...s.unknown);
    for (const id of s.tags) {
      const t = traces.get(id);
      if (!t) {
        badTags.push(`${f.rel}  @req ${id} — 묶음(그룹) ID에는 달지 않는다. 말단 요구사항 ID를 쓴다`);
        continue;
      }
      const v = verdictOf(id);
      if (v === '미구현' || v === '범위 밖') badTags.push(`${f.rel}  @req ${id} — 판정이 '${v}'이다. 구현했다면 review.json 판정을 먼저 갱신`);
      if (!t.implemented.includes(f.rel)) t.implemented.push(f.rel);
    }
    if (isTest(f.rel)) {
      for (const id of s.mentions) {
        const t = traces.get(id);
        if (t && !t.tested.includes(f.rel)) t.tested.push(f.rel);
      }
      for (const id of s.probes) probes.set(id, [...new Set([...(probes.get(id) ?? []), f.rel])]);
    }
  }
  push('카탈로그에 없는 ID', unknown);
  push('@req 표식', badTags);

  const defectIds = new Set(review.defects.map((d) => d.id));
  push('결함 기록', [
    ...review.defects.flatMap((d) => [
      ...(known.has(d.id) ? [] : [`${d.id} — 카탈로그에 없는 결함 ID`]),
      ...(probes.get(d.id)?.includes(d.probe) ? [] : [`${d.id} — ${d.probe}에 실행되는 결함 기록(it.fails)이 없다. 고쳤다면 결함 목록에서 빼고 판정을 갱신`]),
    ]),
    ...[...probes.keys()].filter((id) => !defectIds.has(id)).map((id) => `${id} — it.fails 결함 기록이 있지만 review.json 결함 목록에 없다(${probes.get(id)!.join(', ')})`),
  ]);
  push(
    '결정·주제 참조',
    [...review.decisions, ...review.themes].flatMap((d) => [
      ...expand(d.requirements, leafIds).empty.map((p) => `${d.id} — '${p}'에 맞는 말단 요구사항이 없다`),
      ...('status' in d && !['결정 대기', '결정됨'].includes(d.status) ? [`${d.id} — 상태는 '결정 대기' 또는 '결정됨'`] : []),
      ...('status' in d && d.status === '결정됨' && !d.resolution ? [`${d.id} — 결정됨이면 resolution(결정 내용)을 적는다`] : []),
    ]),
  );
  push('명세서 정정 메모', review.specNotes.flatMap((n) => n.ids.filter((id) => !known.has(id)).map((id) => `${id} — 카탈로그에 없는 ID`)));
  const ids = [...review.decisions, ...review.themes].map((d) => d.id);
  push('결정·주제 ID 중복', [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]);
  return { problems: out, traces, probes };
}

// ─── 산출물 ──────────────────────────────────────────────────

/** 구현 판정인데 @req 표식이 없는 말단 요구사항 수(명세서의 중복 ID는 행마다 센다) */
export function untracedImplemented(cat: Catalog, review: Review, traces: Map<string, Trace>) {
  return cat.requirements.filter((r) => r.level === 'leaf' && review.verdicts[r.key]?.verdict === '구현' && !traces.get(r.id)?.implemented.length).length;
}

export function summarize(cat: Catalog, review: Review) {
  const leaves = cat.requirements.filter((r) => r.level === 'leaf');
  const count = (rs: Requirement[]) => Object.fromEntries(VERDICTS.map((v) => [v, rs.filter((r) => review.verdicts[r.key]?.verdict === v).length])) as Record<Verdict, number>;
  return {
    total: leaves.length,
    verdicts: count(leaves),
    sheets: cat.sheets.map((s) => ({ sheet: s.name, leaves: s.leaves, ...count(leaves.filter((r) => r.sheet === s.name)) })),
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderReport(cat: Catalog, review: Review, c: Check): string {
  const sum = summarize(cat, review);
  const leafIds = [...new Set(cat.requirements.filter((r) => r.level === 'leaf').map((r) => r.id))];
  const name = new Map(cat.requirements.map((r) => [r.id, r.name]));
  const traced = [...c.traces.values()].filter((t) => t.implemented.length).length;
  const L: string[] = [
    '# 기능명세서 요구사항 반영 현황',
    '',
    `> tools/requirements.ts가 만든다 — 손으로 고치지 않는다. 원본 \`${cat.source.file}\` (SHA-256 \`${cat.source.sha256.slice(0, 16)}…\`), 판정 검토 ${review.source.reviewedAt}${review.source.reviewedCommit ? ` @ ${review.source.reviewedCommit}` : ''}.`,
    '> 판정·결함·결정은 `harness/requirements/review.json`에서 고친다. 요구사항별 근거는 같은 파일의 `verdicts`에 있다.',
    '',
    `## 1. 판정 집계 (말단 ${sum.total}건)`,
    '',
    '| 시트 | 건수 | 구현 | 부분 | 미구현 | 범위 밖 |',
    '|---|---:|---:|---:|---:|---:|',
    ...sum.sheets.map((s) => `| ${s.sheet} | ${s.leaves} | ${s['구현']} | ${s['부분']} | ${s['미구현']} | ${s['범위 밖']} |`),
    `| **합계** | **${sum.total}** | **${sum.verdicts['구현']} (${pct(sum.verdicts['구현'], sum.total)})** | **${sum.verdicts['부분']} (${pct(sum.verdicts['부분'], sum.total)})** | **${sum.verdicts['미구현']} (${pct(sum.verdicts['미구현'], sum.total)})** | **${sum.verdicts['범위 밖']}** |`,
    '',
    `코드 추적(\`@req\` 표식): ${traced}건 · 구현 판정인데 추적 없음: ${untracedImplemented(cat, review, c.traces)}건`,
    '',
    `## 2. 결함 (${review.defects.length}건 — 실행되는 결함 기록 \`it.fails\`)`,
    '',
    '| ID | 요구사항 | 내용 | 결함 기록 |',
    '|---|---|---|---|',
    ...review.defects.map((d) => `| ${d.id} | ${cell(name.get(d.id) ?? '')} | ${cell(d.summary)} | \`${d.probe}\` |`),
    '',
    '## 3. 여러 시트에 걸친 공백',
    '',
    '| ID | 주제 | 현재 | 요구사항 수 | 미구현 |',
    '|---|---|---|---:|---:|',
    ...review.themes.map((t) => {
      const ids = expand(t.requirements, leafIds).ids;
      return `| ${t.id} | ${cell(t.title)} | ${cell(t.current)} | ${ids.length} | ${ids.filter((id) => review.verdicts[id]?.verdict === '미구현').length} |`;
    }),
    '',
    '## 4. 결정 필요 — 현재 설계 원칙과 충돌',
    '',
    '| ID | 주제 | 상태 | 명세 | 현재 설계 | 요구사항 |',
    '|---|---|---|---|---|---|',
    ...review.decisions.map((d) => `| ${d.id} | ${cell(d.title)} | ${d.status}${d.resolution ? ` — ${cell(d.resolution)}` : ''} | ${cell(d.spec)} | ${cell(d.design)} | ${cell(d.requirements.join(', '))} |`),
    '',
    `## 5. 명세서 정정 필요 (${cat.specIssues.length + review.specNotes.length}건)`,
    '',
    ...cat.specIssues.map((i) => `- **${i.kind}** ${i.ids.join(', ')} — ${i.detail}`),
    ...review.specNotes.map((n) => `- **검토** ${n.ids.join(', ')} — ${n.detail}`),
    '',
  ];
  return L.join('\n');
}

// ─── 실행 ────────────────────────────────────────────────────

function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

function sync(arg?: string) {
  const prev = existsSync(CATALOG) ? readJson<Catalog>(CATALOG) : null;
  const path = arg ?? process.env.FF_REQ_XLSX ?? prev?.source.path;
  if (!path || !existsSync(path)) {
    console.error(`req:sync ✕ 명세서 xlsx를 찾을 수 없습니다: ${path ?? '(경로 없음)'} — 인자나 FF_REQ_XLSX로 지정`);
    return 1;
  }
  const buf = readFileSync(path);
  const cat = buildCatalog(readWorkbook(buf), { path: path.replace(/\\/g, '/'), file: path.replace(/\\/g, '/').split('/').pop()!, sha256: sha256(buf), bytes: buf.length });
  mkdirSync(REQ_DIR, { recursive: true });
  writeFileSync(CATALOG, JSON.stringify(cat, null, 2) + '\n');
  const leaves = cat.requirements.filter((r) => r.level === 'leaf').length;
  console.log(`req:sync → ${rel(CATALOG)} — 요구사항 ${cat.requirements.length}건(말단 ${leaves}) · 명세서 정정 필요 ${cat.specIssues.length}건`);
  if (prev && prev.source.sha256 !== cat.source.sha256) console.log('  ! 원본이 바뀌었습니다 — review.json 판정을 재검토하세요(source.sha256 갱신 포함)');
  return 0;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === '--sync') return sync(args[1]);
  if (!existsSync(CATALOG)) {
    console.error('req ✕ harness/requirements/catalog.json 없음 — npm run req:sync');
    return 1;
  }
  const cat = readJson<Catalog>(CATALOG);
  if (args[0] === '--import-review') {
    const review = importReview(cat, args[1], existsSync(REVIEW) ? readJson<Review>(REVIEW) : null);
    writeFileSync(REVIEW, JSON.stringify(review, null, 2) + '\n');
    console.log(`req → ${rel(REVIEW)} — 판정 ${Object.keys(review.verdicts).length}건`);
    return 0;
  }
  if (!existsSync(REVIEW)) {
    console.error('req ✕ harness/requirements/review.json 없음 — 검토 결과를 먼저 적는다(--import-review)');
    return 1;
  }
  const review = readJson<Review>(REVIEW);
  const files = SCAN.flatMap((d) => walk(join(FF, d), ['.ts', '.tsx', '.mjs', '.py'], ['node_modules', 'dist', '__pycache__']))
    .map((f) => ({ rel: rel(f), text: readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }))
    .filter((f) => !f.rel.startsWith('tools/requirements')); // 형식 설명·시험용 예시 ID
  const c = check(cat, review, files);

  console.log('req (기능명세서 요구사항 반영 추적)');
  const src = cat.source.path;
  if (existsSync(src)) {
    const now = sha256(readFileSync(src));
    if (now !== cat.source.sha256) c.problems.unshift({ name: '원본 명세서 변경', errs: [`${cat.source.file}이 바뀌었다(${now.slice(0, 12)}…) — npm run req:sync 후 review.json 판정 재검토`] });
    else console.log(`  ✓ 원본 명세서 = 카탈로그 (${cat.source.sha256.slice(0, 12)}…)`);
  } else console.log(`  · 원본 명세서가 이 컴퓨터에 없다 — 커밋된 카탈로그(${cat.source.sha256.slice(0, 12)}…) 기준`);

  const sum = summarize(cat, review);
  const traced = [...c.traces.values()].filter((t) => t.implemented.length).length;
  const untraced = untracedImplemented(cat, review, c.traces);
  const status = {
    note: 'tools/requirements.ts가 만든다 — 손으로 고치지 않는다. implemented = 소스의 @req 표식, tested = 시험 파일의 ID 언급, probes = it.fails 결함 기록',
    source: cat.source.sha256,
    summary: { ...sum, traced, untracedImplemented: untraced, defects: review.defects.length, decisionsPending: review.decisions.filter((d) => d.status === '결정 대기').length, specIssues: cat.specIssues.length },
    traces: Object.fromEntries([...c.traces].filter(([, t]) => t.implemented.length || t.tested.length)),
    probes: Object.fromEntries(c.probes),
  };
  writeFileSync(STATUS, JSON.stringify(status, null, 2) + '\n');
  const report = renderReport(cat, review, c);
  const stale = !existsSync(REPORT) || readFileSync(REPORT, 'utf8').replace(/\r\n/g, '\n') !== report;
  if (stale) writeFileSync(REPORT, report);

  let ok = true;
  for (const p of c.problems) {
    ok = false;
    console.error(`  ✕ ${p.name} ${p.errs.length}건`);
    for (const e of p.errs.slice(0, 20)) console.error('    ' + e);
  }
  if (ok) console.log(`  ✓ 말단 요구사항 ${sum.total}건 모두 판정 · 결함 ${review.defects.length}건 모두 실행되는 기록 · 결정·주제 참조 정상`);
  console.log(`  · 구현 ${sum.verdicts['구현']} · 부분 ${sum.verdicts['부분']} · 미구현 ${sum.verdicts['미구현']} · 범위 밖 ${sum.verdicts['범위 밖']} — @req 추적 ${traced} · 결정 대기 ${status.summary.decisionsPending} · 명세서 정정 필요 ${cat.specIssues.length}`);
  if (stale) console.log(`  · ${rel(REPORT)} 갱신 — 커밋하세요`);
  ok = ratchet('req.verdict.implemented', sum.verdicts['구현'], 'min', '기능명세서 말단 요구사항 중 구현 판정 수 — 줄면 안 된다') && ok;
  ok = ratchet('req.verdict.missing', sum.verdicts['미구현'], 'max', '기능명세서 말단 요구사항 중 미구현 판정 수 — 늘면 안 된다') && ok;
  ok = ratchet('req.traced', traced, 'min', '@req 표식으로 코드에 추적된 요구사항 수') && ok;
  ok = ratchet('req.untracedImplemented', untraced, 'max', '구현 판정인데 @req 표식이 없는 요구사항 수 — 줄여 나간다') && ok;
  ok = ratchet('req.defects', review.defects.length, 'max', '미해결 결함(it.fails 결함 기록) 수 — 늘면 안 된다') && ok;
  return ok ? 0 : 1;
}

if (import.meta.main ?? process.argv[1]?.endsWith('requirements.ts')) process.exit(main());

// 국제표준 대응방안 보고서 v1.1(FFP-FS-STR-001) 코드 패키지 동기화 — 메시지 스키마 v2·정상/실패 예제·Registry 스냅샷·용어 규칙을 harness/guide/ 로 복사하고,
// 원고(guide_src/*.md)에서 규칙 카탈로그(### FFG-XXX-NNN 블록)와 시험 카탈로그(TC-FF-NN 표)를 뽑아 harness/guide/catalog.json 으로 만든다.
//   node tools/guide-sync.ts           GUIDE_DIR(기본 C:/project/2026-09-23_FF_IMP/FF_Safety_Guide_v2)에서 허용 목록만 복사 + catalog.json + GUIDE_SYNC.json(해시)
//   node tools/guide-sync.ts --check   복사본이 매니페스트와 같은지(FF 쪽에서 고치지 않았는지) 검사 (verify 단계). 원본이 있으면 원본 변경도 알린다.
// 원본은 FF repo 밖(FF_IMP)이라 CI에서도 같은 판정을 내도록 복사본을 쓴다. 원본은 읽기만 한다.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { FF, readJson } from './lib.ts';

const SRC = process.env.GUIDE_DIR ?? 'C:/project/2026-09-23_FF_IMP/FF_Safety_Guide_v2';
const OUT = join(FF, 'harness', 'guide');
const MANIFEST = join(OUT, 'GUIDE_SYNC.json');
const CATALOG = 'catalog.json';
/** 화면(따라하기·표준 설명 모드)이 쓰는 규칙·시험 원문 — contracts 생성 모듈(프론트·백엔드 공용). harness/guide/catalog.json에서 만든다 */
const GENERATED = join(FF, 'contracts', 'src', 'generated', 'report-catalog.ts');

/** 허용 목록 — 플랫폼 게이트·계약 시험에 쓰는 것만 (C/C++ 차량 코드·원고·문서·zip은 제외) */
const ALLOW: RegExp[] = [/^schema\/[\w.-]+\.schema\.json$/, /^schema\/examples\/[\w.-]+\.json$/, /^harness\/terms\.json$/];

const posix = (p: string) => p.split(sep).join('/');
/** 줄끝은 정규화해서 해시 — Git 체크아웃(Windows CRLF ↔ CI LF)에 따라 달라지지 않게 */
export const sha = (p: string) => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

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
  return all.filter((f) => ALLOW.some((r) => r.test(f))).sort();
}

export interface CatalogRule {
  id: string;
  title: string;
  level: string;
  scope: string[];
  rule: string;
  basis: string;
  verify: string;
  /** 보고서 코드 패키지의 예제 파일(있으면) */
  example: string;
  /** 원고 파일과 그 규칙이 속한 절 제목(예: "3.11 규칙") */
  file: string;
  section: string;
}
export interface CatalogTest {
  id: string;
  test: string;
  expected: string;
  impl: string;
}
export interface Catalog {
  source: string;
  rules: CatalogRule[];
  tests: CatalogTest[];
}

const RULE_HEAD = /^###\s+(FFG-[A-Z]{3,4}-\d{3})\s+(.+)$/;
const FIELD = /^-\s+(수준|적용|규칙|근거|검증|예제):\s*(.*)$/;
const TC_ROW = /^\|\s*(TC-FF-\d{2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/;
type Field = 'level' | 'scope' | 'rule' | 'basis' | 'verify' | 'example';
const KEY: Record<string, Field> = {
  수준: 'level',
  적용: 'scope',
  규칙: 'rule',
  근거: 'basis',
  검증: 'verify',
  예제: 'example',
};

/** 원고에서 규칙 블록과 TC-FF 시험 표를 뽑는다 — 보고서 하네스 H01과 같은 블록 형식(### FFG-XXX-NNN + 수준·적용·규칙·근거·검증) */
export function buildCatalog(docs: { file: string; text: string }[]): Catalog {
  const rules: CatalogRule[] = [];
  const tests: CatalogTest[] = [];
  for (const { file, text } of docs) {
    let section = '';
    let cur: CatalogRule | null = null;
    let last: Field | null = null;
    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
      const line = raw.trimEnd();
      const h2 = /^##\s+(.+)$/.exec(line);
      if (h2) {
        section = h2[1].trim();
        cur = null;
        continue;
      }
      const head = RULE_HEAD.exec(line);
      if (head) {
        cur = {
          id: head[1],
          title: head[2].trim(),
          level: '',
          scope: [],
          rule: '',
          basis: '',
          verify: '',
          example: '',
          file,
          section,
        };
        last = null;
        rules.push(cur);
        continue;
      }
      if (cur) {
        const f = FIELD.exec(line);
        if (f) {
          last = KEY[f[1]];
          if (last === 'scope')
            cur.scope = f[2]
              .split(/,\s*/)
              .map((x) => x.trim())
              .filter(Boolean);
          else cur[last] = f[2].trim();
          continue;
        }
        // 들여쓴 줄(하위 목록·이어지는 문단)과 빈 줄은 앞 항목에 이어 붙인다. 들여쓰지 않은 일반 줄·제목에서 블록이 끝난다.
        if (line === '' || /^\s/.test(line)) {
          if (last && last !== 'scope' && line.trim()) cur[last] += `\n${line.trim()}`;
          continue;
        }
        cur = null;
        last = null;
      }
      const tc = TC_ROW.exec(line);
      if (tc && !tests.some((t) => t.id === tc[1]))
        tests.push({
          id: tc[1],
          test: tc[2].trim(),
          expected: tc[3].trim(),
          impl: tc[4].trim(),
        });
    }
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  tests.sort((a, b) => a.id.localeCompare(b.id));
  return { source: 'guide_src/*.md (FFP-FS-STR-001 v1.1 원고)', rules, tests };
}

/** 규칙 ID 중복·필수 항목 누락 — 하나라도 있으면 동기화하지 않는다 */
export function catalogProblems(c: Catalog): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of c.rules) {
    if (seen.has(r.id)) out.push(`규칙 ID 중복: ${r.id}`);
    seen.add(r.id);
    for (const k of ['level', 'rule', 'basis', 'verify'] as const) if (!r[k]) out.push(`${r.id}: ${k} 없음`);
    if (!r.scope.length) out.push(`${r.id}: 적용 없음`);
  }
  return out;
}

/** catalog.json → contracts 생성 모듈 원문(결정적: 같은 카탈로그면 같은 바이트) */
export function renderCatalogModule(c: Catalog): string {
  const rules = c.rules.map(({ id, title, level, scope, rule, basis, verify, file, section }) => ({ id, title, level, scope, rule, basis, verify, section: `${file.replace(/\.md$/, '')} · ${section}` }));
  return [
    '// 생성 파일 — tools/guide-sync.ts가 harness/guide/catalog.json(보고서 v1.1 원고)에서 만든다. 손으로 고치지 않는다(guide:check가 잡는다).',
    "import type { ReportRule, ReportTest } from '../rules/standards';",
    '',
    `export const REPORT_RULES: readonly ReportRule[] = ${JSON.stringify(rules, null, 2)};`,
    '',
    `export const REPORT_TESTS: readonly ReportTest[] = ${JSON.stringify(c.tests, null, 2)};`,
    '',
  ].join('\n');
}

interface Manifest {
  source: string;
  syncedAt: string;
  note: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

function manuscripts(): { file: string; text: string }[] {
  const dir = join(SRC, 'guide_src');
  // 00_front.md는 규칙 형식 설명용 예시 블록이 있어 제외
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== '00_front.md')
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));
}

function sync() {
  if (!existsSync(join(SRC, 'schema', 'kill_command.v2.schema.json'))) throw new Error(`가이드 폴더가 없습니다: ${SRC} (GUIDE_DIR로 지정)`);
  const files = selectFiles(list(SRC));
  for (const f of files) JSON.parse(readFileSync(join(SRC, f), 'utf8').replace(/^﻿/, '')); // 깨진 JSON은 복사하지 않는다
  const catalog = buildCatalog(manuscripts());
  const bad = catalogProblems(catalog);
  if (bad.length) throw new Error(`원고 규칙 형식 오류 — ${bad.join(' / ')}`);
  rmSync(OUT, { recursive: true, force: true });
  const m: Manifest = {
    source: posix(SRC),
    syncedAt: new Date().toISOString(),
    note: 'tools/guide-sync.ts가 만든 복사본 — 여기서 고치지 말고 가이드 원본을 고친 뒤 다시 동기화',
    files: {},
  };
  for (const f of files) {
    const to = join(OUT, f);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(SRC, f), to);
    m.files[f] = { sha256: sha(to), bytes: statSync(to).size };
  }
  writeFileSync(join(OUT, CATALOG), JSON.stringify(catalog, null, 2) + '\n');
  m.files[CATALOG] = {
    sha256: sha(join(OUT, CATALOG)),
    bytes: statSync(join(OUT, CATALOG)).size,
  };
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
  mkdirSync(dirname(GENERATED), { recursive: true });
  writeFileSync(GENERATED, renderCatalogModule(catalog));
  console.log(`guide:sync  ${files.length}개 파일 + 규칙 ${catalog.rules.length}개·시험 ${catalog.tests.length}개 → ${posix(relative(FF, OUT))}`);
}

function check(): number {
  if (!existsSync(MANIFEST)) {
    console.error('guide:check  ✗ 동기화본 없음 — npm run guide:sync');
    return 1;
  }
  const m = readJson<Manifest>(MANIFEST);
  const present = list(OUT).filter((f) => f !== 'GUIDE_SYNC.json');
  const errors: string[] = [];
  for (const f of present) if (!m.files[f]) errors.push(`매니페스트에 없는 파일: ${f}`);
  for (const [f, e] of Object.entries(m.files)) {
    if (!existsSync(join(OUT, f))) errors.push(`빠진 파일: ${f}`);
    else if (sha(join(OUT, f)) !== e.sha256) errors.push(`복사본이 바뀜(가이드 원본에서 고친 뒤 다시 동기화): ${f}`);
  }
  // 생성 모듈이 카탈로그와 같은지 — 손으로 고쳤거나 다시 만들지 않았으면 실패
  const want = renderCatalogModule(readJson<Catalog>(join(OUT, CATALOG)));
  if (!existsSync(GENERATED) || readFileSync(GENERATED, 'utf8').replace(/\r\n/g, '\n') !== want) errors.push(`생성 모듈이 카탈로그와 다름(npm run guide:sync): ${posix(relative(FF, GENERATED))}`);
  if (errors.length) {
    console.error(`guide:check  ✗ ${errors.length}건\n  ${errors.join('\n  ')}`);
    return 1;
  }
  // 원본이 이 컴퓨터에 있으면 원본 쪽 변경을 알린다(실패는 아님 — 원본은 가이드 작업이 소유)
  if (existsSync(join(SRC, 'guide_src'))) {
    const drift = selectFiles(list(SRC)).filter((f) => !m.files[f] || sha(join(SRC, f)) !== m.files[f].sha256);
    const fresh = JSON.stringify(buildCatalog(manuscripts()), null, 2) + '\n';
    if (createHash('sha256').update(fresh).digest('hex') !== m.files[CATALOG]?.sha256) drift.push('guide_src/*.md(규칙·시험 카탈로그)');
    if (drift.length) console.warn(`guide:check  ! 가이드 원본이 바뀜 ${drift.length}건 — npm run guide:sync 후 시험 확인: ${drift.join(', ')}`);
  }
  console.log(`guide:check  ✓ ${present.length}개 파일 · 원본 ${m.source} · 동기화 ${m.syncedAt}`);
  return 0;
}

if (posix(process.argv[1] ?? '').endsWith('tools/guide-sync.ts')) {
  if (process.argv.includes('--check')) process.exit(check());
  sync();
}

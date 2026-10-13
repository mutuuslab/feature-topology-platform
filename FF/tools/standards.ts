// 보고서 v1.1 규칙 추적 — node tools/standards.ts (verify 단계 'standards')
//   (1) 실재: 코드·시험·문구에 쓴 FFG-XXX-NNN·TC-FF-NN이 보고서 카탈로그(harness/guide/catalog.json)에 있어야 한다(보고서 하네스 H04와 같은 검사).
//   (2) 추적: 플랫폼이 적용 대상인 규칙마다 구현(소스의 `@rule FFG-…` 표식)과 시험(시험 파일의 ID 언급) 위치를 harness/standards.json에 남긴다.
//       표식은 규칙을 실제로 집행하는 함수·화면에만 단다 — 부분 구현이면 표식 옆에 무엇이 남았는지 적는다. 단순 언급은 추적으로 세지 않는다.
//   (3) 래칫: 추적된 플랫폼 규칙 수·시험된 규칙 수·플랫폼 시험(TC-FF) 수는 줄어들 수 없다.
//   (4) 반영 위치: 플랫폼 규칙은 모두 기존 컴포넌트(contracts/src/rules/standards-map.ts)에 배치돼야 하고, 컴포넌트 ID는 manifest에 실재해야 한다.
//       규칙별 상태는 contracts/src/generated/standards-status.ts로 내보내 /arch/components 화면이 컴포넌트별 반영률로 보여 준다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF, ratchet, readJson, rel, walk } from './lib.ts';
import { STANDARDS_MAP, type RulePlacement } from '../contracts/src/rules/standards-map.ts';

interface CatalogRule {
  id: string;
  title: string;
  level: string;
  scope: string[];
  file: string;
  section: string;
}
interface Catalog {
  rules: CatalogRule[];
  tests: { id: string; test: string }[];
}

/** 보고서 1.5 적용 어휘 중 이 플랫폼(Control Plane)이 맡는 것 — 구성요소 이름 포함. CCS/OTA·LPC·Guard·차량 SW는 다른 시스템 */
export const PLATFORM_SCOPES = [
  '플랫폼',
  '플랫폼 게이트',
  'Registry',
  '이벤트 이력 추적',
  '보안 배포 관리',
  '정책 저장·버전 관리',
  '정책 검증',
  '감사 이력 관리',
  '검증 이력 관리',
  '플랫폼 인증·권한 관리(IAM)',
  '배포 파이프라인 연계',
  '인증서·키 관리(PKI/KMS)',
  '품질 피드백 반영',
  '이상 징후 대응',
  '운영 데이터 수집',
  '기능 지원 조건 관리',
];

const RULE_ID = /\bFFG-[A-Z]{3,4}-\d{3}\b/g;
const TC_ID = /\bTC-FF-\d{2}\b/g;
const TAG = /@rule\s+((?:FFG-[A-Z]{3,4}-\d{3}[\s,]*)+)/g;

const SCAN = ['contracts/src', 'backend/src', 'backend/test', 'frontend/src', 'e2e/tests', 'tools'];
const isTest = (r: string) => /(\.test\.|\.spec\.|__tests__\/|backend\/test\/|e2e\/tests\/)/.test(r);

export interface Trace {
  id: string;
  title: string;
  scope: string[];
  section: string;
  implemented: string[];
  tested: string[];
}

export function scanText(r: string, text: string, known: { rules: Set<string>; tests: Set<string> }) {
  const unknown: string[] = [];
  const tags: string[] = [];
  const mentions: string[] = [];
  const tcs: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(RULE_ID)) {
      if (!known.rules.has(m[0])) unknown.push(`${r}:${i + 1}  ${m[0]} — 보고서 v1.1 카탈로그에 없는 규칙 ID`);
      else mentions.push(m[0]);
    }
    for (const m of line.matchAll(TC_ID)) {
      if (!known.tests.has(m[0])) unknown.push(`${r}:${i + 1}  ${m[0]} — 보고서 시험 카탈로그(TC-FF-01~60)에 없는 ID`);
      else tcs.push(m[0]);
    }
    for (const m of line.matchAll(TAG)) for (const id of m[1].match(RULE_ID) ?? []) tags.push(id);
  });
  return { unknown, tags, mentions, tcs };
}

/** 배치 표 검사 — 빠진 플랫폼 규칙, 플랫폼 규칙이 아닌 항목, manifest에 없는 컴포넌트 */
export function placementProblems(platformIds: string[], map: Readonly<Record<string, RulePlacement>>, componentIds: string[]): string[] {
  const out: string[] = [];
  const comps = new Set(componentIds);
  const plat = new Set(platformIds);
  for (const id of platformIds) if (!map[id]) out.push(`${id} — 반영할 기존 컴포넌트가 정해지지 않음(standards-map.ts)`);
  for (const [id, p] of Object.entries(map)) {
    if (!plat.has(id)) out.push(`${id} — 플랫폼 적용 규칙이 아님(배치 표에서 뺀다)`);
    if (!p.components.length) out.push(`${id} — 컴포넌트 없음`);
    for (const c of p.components) if (!comps.has(c)) out.push(`${id} → ${c} — 42 컴포넌트 manifest에 없는 ID`);
  }
  return out;
}

/** 규칙별 구현·시험 상태 모듈 — 손으로 고치지 않는다 */
export function renderStatusModule(list: Pick<Trace, 'id' | 'implemented' | 'tested'>[]): string {
  const status = Object.fromEntries(list.map((t) => [t.id, { implemented: t.implemented.length > 0, tested: t.implemented.length > 0 && t.tested.length > 0 }]));
  return [
    '// tools/standards.ts가 만든다 — 손으로 고치지 않는다. 보고서 v1.1 플랫폼 규칙별 구현(@rule 표식)·시험 추적 상태.',
    'export interface RuleTraceStatus {',
    '  implemented: boolean;',
    '  tested: boolean;',
    '}',
    `export const RULE_STATUS: Readonly<Record<string, RuleTraceStatus>> = ${JSON.stringify(status, null, 2)};`,
    '',
  ].join('\n');
}

function main(): number {
  const catalogFile = join(FF, 'harness', 'guide', 'catalog.json');
  if (!existsSync(catalogFile)) {
    console.error('standards  ✕ harness/guide/catalog.json 없음 — npm run guide:sync');
    return 1;
  }
  const cat = readJson<Catalog>(catalogFile);
  const known = {
    rules: new Set(cat.rules.map((r) => r.id)),
    tests: new Set(cat.tests.map((t) => t.id)),
  };
  const platform = cat.rules.filter((r) => r.scope.some((s) => PLATFORM_SCOPES.includes(s)));
  const traces = new Map<string, Trace>(
    platform.map((r) => [
      r.id,
      {
        id: r.id,
        title: r.title,
        scope: r.scope,
        section: `${r.file} · ${r.section}`,
        implemented: [],
        tested: [],
      },
    ]),
  );
  const unknown: string[] = [];
  const offPlatformTags: string[] = [];
  const testedTc = new Set<string>();
  for (const dir of SCAN) {
    for (const f of walk(join(FF, dir), ['.ts', '.tsx', '.mjs'], ['node_modules', 'dist'])) {
      const r = rel(f);
      if (r.startsWith('tools/guide-sync') || r.startsWith('tools/standards')) continue; // 형식 설명·시험용 예시 ID
      const s = scanText(r, readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), known);
      unknown.push(...s.unknown);
      for (const id of s.tags) {
        const t = traces.get(id);
        if (t) t.implemented.includes(r) || t.implemented.push(r);
        else offPlatformTags.push(`${r}  @rule ${id} — 적용 대상에 플랫폼이 없는 규칙(플랫폼은 차량·협력사 규칙을 구현했다고 주장하지 않는다)`);
      }
      if (isTest(r)) {
        for (const id of s.mentions) {
          const t = traces.get(id);
          if (t && !t.tested.includes(r)) t.tested.push(r);
        }
        for (const tc of s.tcs) testedTc.add(tc);
      }
    }
  }
  const list = [...traces.values()];
  const implemented = list.filter((t) => t.implemented.length).length;
  // 시험 지표는 구현 추적과 함께 있을 때만 — 부품 시험에서 규칙 ID를 언급만 한 경우는 세지 않는다
  const tested = list.filter((t) => t.implemented.length && t.tested.length).length;
  const report = {
    note: 'tools/standards.ts가 만든다 — 손으로 고치지 않는다. implemented = 소스의 @rule 표식, tested = 시험 파일의 ID 언급(요약의 tested는 구현 추적도 있는 규칙만)',
    summary: {
      platformRules: list.length,
      implemented,
      tested,
      reportTestsReferenced: testedTc.size,
    },
    rules: list,
    reportTests: [...testedTc].sort(),
  };
  writeFileSync(join(FF, 'harness', 'standards.json'), JSON.stringify(report, null, 2) + '\n');
  const statusFile = join(FF, 'contracts', 'src', 'generated', 'standards-status.ts');
  const statusText = renderStatusModule(list);
  const statusStale = !existsSync(statusFile) || readFileSync(statusFile, 'utf8').replace(/\r\n/g, '\n') !== statusText;
  if (statusStale) writeFileSync(statusFile, statusText);
  const { COMPONENTS } = createRequire(import.meta.url)(join(FF, 'contracts', 'dist', 'index.js')) as { COMPONENTS: { id: string }[] };
  const placement = placementProblems(
    list.map((t) => t.id),
    STANDARDS_MAP,
    COMPONENTS.map((c) => c.id),
  );

  console.log('standards (보고서 v1.1 규칙 추적)');
  let ok = true;
  for (const [name, errs] of [
    ['카탈로그에 없는 ID', unknown],
    ['플랫폼 밖 규칙의 @rule 표식', offPlatformTags],
    ['반영 위치(기존 컴포넌트) 배치', placement],
  ] as const) {
    if (errs.length) {
      ok = false;
      console.error(`  ✕ ${name} ${errs.length}건`);
      for (const e of errs.slice(0, 20)) console.error('    ' + e);
    }
  }
  if (ok) console.log(`  ✓ 규칙·시험 ID ${known.rules.size}·${known.tests.size}개 카탈로그 대비 미등록 0건`);
  console.log(`  · 플랫폼 규칙 ${list.length}개 — 구현 추적 ${implemented} · 시험 ${tested} · 보고서 시험(TC-FF) 참조 ${testedTc.size}`);
  if (!placement.length) console.log(`  ✓ 플랫폼 규칙 ${list.length}개 모두 기존 컴포넌트에 배치(${new Set(Object.values(STANDARDS_MAP).flatMap((p) => p.components)).size}개 컴포넌트)`);
  if (statusStale) console.log('  · contracts/src/generated/standards-status.ts 갱신 — 함께 커밋하세요');
  ok = ratchet('platformRulesImplemented', implemented, 'min', '보고서 v1.1 플랫폼 규칙 중 @rule 표식으로 구현이 추적되는 규칙 수 — 늘려 나간다') && ok;
  ok = ratchet('platformRulesTested', tested, 'min', '보고서 v1.1 플랫폼 규칙 중 구현 추적과 시험이 함께 있는 규칙 수 — 늘려 나간다') && ok;
  ok = ratchet('reportTestsReferenced', testedTc.size, 'min', '시험이 참조하는 보고서 시험 카탈로그(TC-FF) 수 — 늘려 나간다') && ok;
  return ok ? 0 : 1;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/standards.ts')) process.exit(main());

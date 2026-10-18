// ADS·UNECE 팩트체크 보고서 Revision 3.0(FFP 기능요건 64·인수시험 24·시나리오 10) 동기화 — 원본 HTML에서 구조화 카탈로그를 뽑는다.
//   node tools/ads-sync.ts           ADS_REPORT_PATH(기본: 저장소 밖 sources 폴더)의 HTML → harness/ads/catalog.json
//   node tools/ads-sync.ts --check   카탈로그 무결성(개수·ID·상호 참조·review 판정 범위) 검사. 원본이 있으면 sha와 재추출 결과가 같은지도 본다(verify 단계).
// 원본은 공개 저장소에 두지 않는다(사용자 결정 2026-10-18). 영문 원문 발췌 42개는 싣지 않고, 보고서가 붙인 출처 ID만 남긴다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, readJson } from './lib.ts';

const SRC =
  process.env.ADS_REPORT_PATH ??
  'C:/project/2026-06-04_Feature_Platform_sources/ads-unece-v3.0/ADS_UNECE_Document_Comparison_Korean_Report_v3.0.html';
export const OUT = join(FF, 'harness', 'ads');
export const CATALOG = join(OUT, 'catalog.json');
export const REVIEW = join(OUT, 'review.json');

export interface AdsRequirement {
  id: string;
  title: string;
  category: string;
  priority: 'P0' | 'P1';
  owner: string;
  hazards: string[];
  claims: string[];
  content: string;
  acceptance: string;
  basis: string;
  tests: string[];
}
export interface AdsTest {
  id: string;
  name: string;
  input: string;
  expected: string;
  evidence: string;
  requirements: string[];
}
export interface AdsScenario {
  id: string;
  title: string;
  situation: string;
  handling: string;
  show: string;
  record: string;
  basis: string;
}
export interface Row {
  [k: string]: string;
}
export interface AdsCatalog {
  source: { file: string; sha256: string; bytes: number; revision: string; date: string };
  vision: { thesis: string; lead: string[] };
  requirements: AdsRequirement[];
  tests: AdsTest[];
  hazards: Row[];
  claims: Row[];
  scenarios: AdsScenario[];
  oddResults: Row[];
  safeStateContracts: Row[];
  modules: Row[];
  contracts: Row[];
  apis: Row[];
  peers: Row[];
  phases: Row[];
  vehicleDecisions: Row[];
  featureRules: Row[];
  transitions: Row[];
  rollbackKinds: Row[];
  rollbackProcess: Row[];
  exceptions: Row[];
  screenMustShow: string;
  evidenceManifest: string;
  verdictModel: { actions: { id: string; label: string }[]; inputs: { id: string; label: string; initial: boolean }[]; reasonCodes: string[] };
}

// ── HTML 조각 다루기(외부 의존 없음) ──
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
export const text = (h: string) =>
  h
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENT[e])
    .replace(/\s+/g, ' ')
    .trim();
const ids = (h: string, re: RegExp) => [...new Set([...h.matchAll(re)].map((m) => m[0]))];

/** id="..."로 시작하는 section 하나 */
function section(h: string, id: string): string {
  const i = h.indexOf(`<section id="${id}"`);
  if (i < 0) throw new Error(`section ${id} 없음`);
  const j = h.indexOf('</section>', i);
  return h.slice(i, j);
}
/** section 안 n번째 표 → 머리글 이름을 키로 한 행 목록(셀 HTML 보존본은 raw 접두어) */
function table(sec: string, n: number, keys: string[]): (Row & { _raw: string[] })[] {
  const tables = [...sec.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);
  const t = tables[n];
  if (!t) throw new Error(`표 ${n} 없음`);
  const body = t.includes('<tbody>') ? t.slice(t.indexOf('<tbody>')) : t;
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]))
    .filter((cells) => cells.length >= keys.length && !/<th/.test(cells.join('')))
    .map((cells) => Object.assign(Object.fromEntries(keys.map((k, i) => [k, text(cells[i])])), { _raw: cells }));
}
const plain = (rows: (Row & { _raw: string[] })[]): Row[] => rows.map(({ _raw, ...r }) => r as Row);

export function buildCatalog(html: string, meta: { file: string; sha256: string; bytes: number }): AdsCatalog {
  const h = strip(html);
  // 비전 — 두 번째 h2(검토 결론)와 overview 서두 문단
  const ov = section(h, 'overview');
  const thesis = text(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(ov.slice(ov.indexOf('</h2>') + 5))?.[1] ?? '');
  const lead = [...ov.matchAll(/<p class="lead">([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));

  // 기능요건 64 — req-card
  const reqSec = section(h, 'platform-requirements');
  const requirements: AdsRequirement[] = [...reqSec.matchAll(/<article class="req-card" id="(FFP-F\d{3})" data-priority="(P\d)" data-owner="([^"]+)" data-module="([^"]+)">([\s\S]*?)<\/article>/g)].map((m) => {
    const body = m[5];
    const top = text(/<div class="req-top"><b>([\s\S]*?)<\/b>/.exec(body)?.[1] ?? '');
    const meta = /<div class="req-meta">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '';
    const ps = [...body.matchAll(/<p(?: class="([^"]*)")?>([\s\S]*?)<\/p>/g)];
    const basis = ps.find((p) => p[1] === 'basis')?.[2] ?? '';
    return {
      id: m[1],
      title: top.replace(/^FFP-F\d{3}\s*·\s*/, ''),
      category: m[4],
      priority: m[2] as 'P0' | 'P1',
      owner: m[3],
      hazards: ids(meta, /\bH\d{2}\b/g),
      claims: ids(meta, /\bC\d{2}\b/g),
      content: text(ps.find((p) => !p[1])?.[2] ?? ''),
      acceptance: text(/<div class="acceptance">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '').replace(/^합격 조건\s*/, ''),
      basis: text(basis.split(/<br\s*\/?>/)[0]).replace(/^근거\/착안:\s*/, ''),
      tests: ids(basis, /\bTC\d{2}\b/g),
    };
  });

  // 인수시험 24 · 위험 H01~H08
  const val = section(h, 'platform-validation');
  const hazards = plain(table(val, 0, ['id', 'condition', 'outcome']));
  const tests: AdsTest[] = table(val, 1, ['head', 'input', 'expected', 'tail']).map((r) => {
    const [, id, name] = /^(TC\d{2})\s*·\s*(.+)$/.exec(r.head) ?? [];
    const tail = r._raw[3];
    return {
      id,
      name,
      input: r.input,
      expected: r.expected,
      evidence: text(tail.split(/<br\s*\/?>/)[0]),
      requirements: ids(tail, /FFP-F\d{3}/g),
    };
  });
  const mf = /증거 manifest의 최소 구조<\/h3><p>([\s\S]*?)<\/p>/.exec(val);

  // 주장 C01~C06
  const eng = section(h, 'engineering-review');
  const claims = table(eng, 1, ['head', 'basis', 'platform']).map((r) => {
    const [, id, claim] = /^(C\d{2})\s*·\s*(.+)$/.exec(r.head) ?? [];
    return { id, claim, basis: r.basis, platform: r.platform };
  });

  // 시나리오 01~10
  const cases = section(h, 'feature-cases');
  const scenarios: AdsScenario[] = [...cases.matchAll(/<article class="scenario"><h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/article>/g)].map((m) => {
    const head = text(m[1]);
    const body = text(m[2]);
    const pick = (label: string, next: string[]) => {
      const i = body.indexOf(`${label}:`);
      if (i < 0) return '';
      const rest = body.slice(i + label.length + 1);
      const ends = next.map((n) => rest.indexOf(`${n}:`)).filter((x) => x >= 0);
      return rest.slice(0, ends.length ? Math.min(...ends) : undefined).trim();
    };
    const [, id, title] = /^(\d{2})\s*·\s*(.+)$/.exec(head) ?? [];
    return {
      id: `S${id}`,
      title,
      situation: pick('상황', ['처리']),
      handling: pick('처리', ['보여 줄 결과', '보여줄 결과', '증거', '근거', '구분']),
      show: pick('보여 줄 결과', ['증거', '근거', '구분']),
      record: pick('증거', ['근거', '구분']),
      basis: pick('근거', []) || pick('구분', []),
    };
  });

  const odd = section(h, 'odd-primer');
  const safe = section(h, 'safe-state-engineering');
  const arch = section(h, 'platform-architecture');
  const road = section(h, 'implementation-roadmap');
  const rb = section(h, 'rollback');
  const rp = section(h, 'rollback-process');

  // 행위별 판정 예시 — 원본 스크립트의 행위·입력·사유 코드(교육용 모델)
  const lab = section(html.replace(/<style[\s\S]*?<\/style>/g, ''), 'readiness-lab');
  const actions = [...lab.matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => ({ id: m[1], label: m[2].trim() }));
  const inputs = [...lab.matchAll(/<label><input type="checkbox" id="lab-(\w+)"( checked)?>\s*([^<]+)<\/label>/g)].map((m) => ({ id: m[1], label: m[3].trim(), initial: !!m[2] }));
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const reasonCodes = [...new Set([...scripts.matchAll(/['"]([A-Z][A-Z_]{5,})['"]/g)].map((m) => m[1]))].filter((c) => /_/.test(c) && !/^(ADS|GTR|DDT|ODD)$/.test(c)).sort();

  return {
    source: { ...meta, revision: '3.0', date: '2026-10-18' },
    vision: { thesis, lead },
    requirements,
    tests,
    hazards,
    claims,
    scenarios,
    oddResults: plain(table(odd, 1, ['result', 'newActivation', 'whileActive'])),
    safeStateContracts: plain(table(safe, 0, ['contract', 'conditions', 'notCompletion'])),
    modules: plain(table(arch, 0, ['area', 'modules', 'responsibility'])),
    contracts: plain(table(arch, 1, ['contract', 'fields', 'invariant'])),
    apis: plain(table(arch, 2, ['api', 'role', 'boundary'])),
    peers: plain(table(section(h, 'competitor-evidence'), 0, ['who', 'observed', 'proposal', 'caveat'])),
    phases: plain(table(road, 0, ['phase', 'build', 'exit'])),
    vehicleDecisions: plain(table(road, 1, ['decision', 'owner'])),
    featureRules: plain(table(section(h, 'feature-rules'), 0, ['situation', 'regulation', 'design'])),
    transitions: plain(table(section(h, 'feature-state'), 0, ['transition', 'allowed', 'onFailure'])),
    rollbackKinds: plain(table(rb, 0, ['kind', 'target', 'recheck', 'misconception'])),
    rollbackProcess: plain(table(rp, 0, ['step', 'responsibility', 'exit'])),
    exceptions: plain(table(rp, 1, ['exception', 'design', 'verify'])),
    screenMustShow: text(/운영 화면에 반드시 보여줄 정보<\/h3><p>([\s\S]*?)<\/p>/.exec(road)?.[1] ?? ''),
    evidenceManifest: text(mf?.[1] ?? ''),
    verdictModel: { actions, inputs, reasonCodes },
  };
}

/** 카탈로그 무결성 — 개수·연속 ID·상호 참조 */
export function catalogProblems(c: AdsCatalog): string[] {
  const p: string[] = [];
  const expect = (name: string, n: number, want: number) => n !== want && p.push(`${name} ${n}개(기대 ${want})`);
  expect('기능요건', c.requirements.length, 64);
  expect('인수시험', c.tests.length, 24);
  expect('위험', c.hazards.length, 8);
  expect('주장', c.claims.length, 6);
  expect('시나리오', c.scenarios.length, 10);
  expect('계약', c.contracts.length, 4);
  expect('API', c.apis.length, 5);
  expect('단계', c.phases.length, 5);
  expect('차량 팀 결정', c.vehicleDecisions.length, 5);
  c.requirements.forEach((r, i) => {
    const want = `FFP-F${String(i + 1).padStart(3, '0')}`;
    if (r.id !== want) p.push(`요건 순서 ${r.id}(기대 ${want})`);
    if (!r.content || !r.acceptance || !r.tests.length) p.push(`${r.id} 내용·합격 조건·시험 누락`);
  });
  c.tests.forEach((t, i) => {
    const want = `TC${String(i + 1).padStart(2, '0')}`;
    if (t.id !== want) p.push(`시험 순서 ${t.id}(기대 ${want})`);
  });
  const reqIds = new Set(c.requirements.map((r) => r.id));
  const testIds = new Set(c.tests.map((t) => t.id));
  for (const t of c.tests) for (const r of t.requirements) if (!reqIds.has(r)) p.push(`${t.id}가 없는 요건 ${r}를 가리킴`);
  for (const r of c.requirements) for (const t of r.tests) if (!testIds.has(t)) p.push(`${r.id}가 없는 시험 ${t}를 가리킴`);
  // 양방향: 요건이 가리키는 시험은 그 요건을 되가리켜야 한다
  for (const r of c.requirements) for (const t of r.tests) if (!c.tests.find((x) => x.id === t)?.requirements.includes(r.id)) p.push(`${r.id} → ${t} 역참조 없음`);
  return p;
}

export const VERDICTS = ['구현', '부분', '미구현', '범위 밖'] as const;
export interface AdsReview {
  source: { sha256: string; reviewedAt: string; reviewedCommit: string; method?: string };
  requirements: Record<string, { verdict: (typeof VERDICTS)[number]; evidence: string[]; gap: string; plan: string[]; rules?: string[] }>;
  tests: Record<string, { status: '자동 시험 있음' | '일부' | '없음'; evidence: string[]; plan: string[] }>;
  scenarios: Record<string, { current: string; gap: string; plan: string[] }>;
}

/** review.json — 모든 요건·시험·시나리오에 판정이 있고, 근거 경로가 실제로 있는지 */
export function reviewProblems(c: AdsCatalog, r: AdsReview): string[] {
  const p: string[] = [];
  if (r.source.sha256 !== c.source.sha256) p.push('review가 다른 원본 판을 기준으로 함');
  for (const q of c.requirements) {
    const v = r.requirements[q.id];
    if (!v) p.push(`${q.id} 판정 없음`);
    else {
      if (!VERDICTS.includes(v.verdict)) p.push(`${q.id} 판정 값 ${v.verdict}`);
      if ((v.verdict === '구현' || v.verdict === '부분') && !v.evidence.length) p.push(`${q.id} 근거 경로 없음`);
      if (v.verdict !== '구현' && v.verdict !== '범위 밖' && !v.plan.length) p.push(`${q.id} 반영 계획(Backlog ID) 없음`);
    }
  }
  for (const t of c.tests) if (!r.tests[t.id]) p.push(`${t.id} 대응 없음`);
  for (const s of c.scenarios) if (!r.scenarios[s.id]) p.push(`${s.id} 대응 없음`);
  const paths = [...Object.values(r.requirements), ...Object.values(r.tests)].flatMap((v) => v.evidence);
  for (const e of new Set(paths)) if (!existsSync(join(FF, e.split(':')[0]))) p.push(`근거 경로 없음: ${e}`);
  return p;
}

export const fileSha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const stable = (c: AdsCatalog) => `${JSON.stringify(c, null, 2)}\n`;

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const c = readJson<AdsCatalog>(CATALOG);
    const problems = catalogProblems(c);
    if (existsSync(REVIEW)) problems.push(...reviewProblems(c, readJson<AdsReview>(REVIEW)));
    if (existsSync(SRC)) {
      const buf = readFileSync(SRC);
      if (fileSha(buf) !== c.source.sha256) problems.push(`원본이 바뀜(${fileSha(buf).slice(0, 12)}) — npm run ads:sync 후 review를 다시 검토`);
      else if (stable(buildCatalog(buf.toString('utf8'), c.source)) !== stable(c)) problems.push('재추출 결과가 catalog.json과 다름');
    } else console.log(`원본 없음(${SRC}) — 카탈로그 무결성만 검사`);
    if (problems.length) {
      console.error(problems.map((x) => `✗ ${x}`).join('\n'));
      process.exit(1);
    }
    console.log(`✓ ADS v3.0 카탈로그 — 요건 ${c.requirements.length}·시험 ${c.tests.length}·시나리오 ${c.scenarios.length}${existsSync(REVIEW) ? ' · 판정 완비' : ''}`);
    return;
  }
  if (!existsSync(SRC)) throw new Error(`원본 없음: ${SRC} (ADS_REPORT_PATH로 지정)`);
  const buf = readFileSync(SRC);
  const c = buildCatalog(buf.toString('utf8'), { file: SRC.split(/[\\/]/).pop()!, sha256: fileSha(buf), bytes: buf.length });
  const problems = catalogProblems(c);
  if (problems.length) throw new Error(problems.join('\n'));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CATALOG, stable(c));
  console.log(`✓ ${CATALOG} — 요건 ${c.requirements.length}·시험 ${c.tests.length}·시나리오 ${c.scenarios.length}·사유 코드 ${c.verdictModel.reasonCodes.length}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/ads-sync.ts')) main();

// Feature DB 1회 이전 — 엑셀 산정 도구 v1.3(03_FeatureDB·03b·09·13) → 정규화 JSON. 설계 docs/30-data-model/30-95 §9.
// 순수 함수: import.ts가 파일로 쓰고, data:check가 다시 돌려 저장본과 같은지 본다.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { FF } from '../lib.ts';

const require = createRequire(import.meta.url);
const contracts = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');
const { FeatureRefRow, RefSourceRow, RefGlossaryRow, RefSubfunctionRow, TaxonomyNodeRow, REF_STATUS_OF_EXCEL } = contracts;

export const REFDB_IMPORTER_VERSION = '1.0.0';
export const REFDB_RELEASE = 'v1.3';

type Cell = string | number | boolean | Date | null;
type Grid = Cell[][];
export type RefdbWarning = { sheet: string; row: number; key: string; message: string };

const text = (v: Cell): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
};
const list = (v: Cell): string[] =>
  (text(v) ?? '')
    .split(/;\s*|\n/)
    .map((x) => x.trim())
    .filter(Boolean);
const num = (v: Cell): number | null => (typeof v === 'number' ? v : text(v) != null && Number.isFinite(Number(text(v))) ? Number(text(v)) : null);

function grid(wb: XLSX.WorkBook, name: string): Grid {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`시트 '${name}'이 없습니다`);
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/** 머리글 행에서 열 위치를 찾는다 — 엑셀 열을 끼우거나 옮겨도 이름으로 따라간다 */
function columns(header: Cell[], wanted: Record<string, string>, sheet: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, label] of Object.entries(wanted)) {
    const exact = header.findIndex((h) => typeof h === 'string' && h.trim() === label);
    const i = exact >= 0 ? exact : header.findIndex((h) => typeof h === 'string' && h.trim().startsWith(label));
    if (i < 0) throw new Error(`${sheet}: 머리글 '${label}' 열이 없습니다`);
    out[key] = i;
  }
  return out;
}

const findHeader = (g: Grid, first: string) => g.findIndex((r) => r.some((c) => typeof c === 'string' && c.trim() === first));

// 03_FeatureDB — 엑셀 4행 머리글, 마스터 열만 옮긴다(과제 입력·자동 계산·견적 열은 산정 과제로 간다)
const FDB_COLS = {
  refId: 'ID',
  domain: '도메인',
  cluster: '컴포넌트 클러스터',
  component: '컴포넌트',
  swStack: 'SW 계층',
  nameEn: 'Feature (EN)',
  nameKo: '기능명',
  lifecycle: '수명주기',
  techStack: '기술 분야',
  autoQuality: '자동차 업체 구현 신뢰도',
  techQuality: 'IT 업체 구현 신뢰도',
  asilRep: 'QM / ASIL',
  method: '비용 산정 방법',
  benchmarkEur: 'Kearney 평균 업체 개발비',
  kearneyNote: 'Kearney 판독',
  bundleId: '번들 ID',
  bundleRep: '번들 대표',
  tshirt: 'T-shirt 등급',
  makeBuyVolume: '직접 개발·구매: 대량',
  makeBuyPremium: '직접 개발·구매: 고급',
  relevance: '양산 해당 정도',
  sourceIds: '출처 ID',
  sourceDetail: '출처 상세',
  remark: '비고',
  basisType: '근거 유형',
  vehicleType: '차량 유형',
  region: '적용 권역',
  duplicateOf: '중복 점검 기준 ID',
  sizeEvidenceGrade: '규모 근거 등급',
  requires: '선행 Feature ID',
  registeredIn: '등록 버전',
  evidenceCheckedAt: '최종 근거 확인일',
  status: '관리 상태',
  adminMemo: '관리 메모',
  procurement: '조달 형태',
  swPackage: 'SW 패키지 분류',
  licenseItem: '라이선스 비용 항목',
  billing: '과금 방식',
} as const;

// 03b 카탈로그 상세 정의 — 원문자 번호로 열을 찾는다
const CAT_COLS = {
  refId: 'Feature ID',
  level: '①',
  parentRefId: '②',
  summary: '③',
  trigger: '④',
  scopeIn: '⑤',
  scopeOut: '⑥',
  scopeOutRefs: '⑦',
  entry: '⑧',
  exit: '⑨',
  read: '⑩',
  write: '⑪',
  states: '⑫',
  dtcs: '⑬',
  calibrations: '⑭',
  variants: '⑮',
  regulations: '⑯',
  verification: '⑰',
  typicalChanges: '⑱',
  aliases: '⑲',
  sharedFunctions: '⑳',
  authoringStatus: '작성 상태',
} as const;

export interface RefdbImport {
  sourceSha256: string;
  files: { refs: unknown[]; sources: unknown[]; glossary: unknown[]; subfunctions: unknown[]; taxonomy: unknown[] };
  warnings: RefdbWarning[];
}

export function importFeatureDb(buf: Buffer): RefdbImport {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const warnings: RefdbWarning[] = [];

  // ── 03b: 상세 정의와 견적서 별칭, C절 사내 용어집
  const cat = grid(wb, '03b_Feature카탈로그');
  const catHead = cat.findIndex((r) => r.includes('Feature ID') && r.some((x) => typeof x === 'string' && x.startsWith('①')));
  if (catHead < 0) throw new Error('03b: 머리글(No·Feature ID) 행이 없습니다');
  const cc = columns(cat[catHead], CAT_COLS, '03b');
  const definitions = new Map<string, unknown>();
  const catAliases = new Map<string, string[]>();
  for (let i = catHead + 1; i < cat.length; i++) {
    const r = cat[i];
    const refId = text(r[cc.refId]);
    if (!refId) continue;
    definitions.set(refId, {
      level: text(r[cc.level]),
      parentRefId: text(r[cc.parentRefId]),
      summary: text(r[cc.summary]),
      trigger: text(r[cc.trigger]),
      scopeIn: list(r[cc.scopeIn]),
      scopeOut: list(r[cc.scopeOut]),
      scopeOutRefs: list(r[cc.scopeOutRefs]),
      io: { entry: list(r[cc.entry]), exit: list(r[cc.exit]), read: list(r[cc.read]), write: list(r[cc.write]) },
      drivers: { states: num(r[cc.states]), dtcs: num(r[cc.dtcs]), calibrations: num(r[cc.calibrations]), variants: num(r[cc.variants]) },
      regulations: text(r[cc.regulations]),
      verification: text(r[cc.verification]),
      typicalChanges: list(r[cc.typicalChanges]),
      sharedFunctions: list(r[cc.sharedFunctions]),
      authoringStatus: text(r[cc.authoringStatus]),
    });
    catAliases.set(refId, list(r[cc.aliases]));
  }

  const glossary: unknown[] = [];
  const glossHead = cat.findIndex((r) => r.includes('용어') && r.includes('의미'));
  if (glossHead >= 0) {
    const t = cat[glossHead].indexOf('용어');
    for (let i = glossHead + 1; i < cat.length; i++) {
      const r = cat[i];
      const term = text(r[t]);
      if (!term) {
        if (text(r[t - 1]) == null) break;
        continue;
      }
      const row = { term, meaning: text(r[t + 1]) ?? '', refIds: list(r[t + 2]), confirmed: text(r[t + 3]) === '사내 확인' };
      const ok = RefGlossaryRow.safeParse(row);
      if (ok.success) glossary.push(ok.data);
      else warnings.push({ sheet: '03b', row: i + 1, key: term, message: ok.error.issues.map((x) => x.message).join('; ') });
    }
  }

  // ── 03_FeatureDB
  const fdb = grid(wb, '03_FeatureDB');
  const head = findHeader(fdb, 'Feature (EN)');
  if (head < 0) throw new Error('03_FeatureDB: 머리글 행이 없습니다');
  const c = columns(fdb[head], FDB_COLS, '03_FeatureDB');
  const refs: unknown[] = [];
  for (let i = head + 1; i < fdb.length; i++) {
    const r = fdb[i];
    const refId = text(r[c.refId]);
    if (!refId) continue;
    const excelStatus = text(r[c.status]) ?? '';
    const aliases = [...(catAliases.get(refId) ?? []), ...glossary.filter((g: any) => g.refIds.includes(refId)).map((g: any) => g.term)];
    const row = {
      refId,
      status: REF_STATUS_OF_EXCEL[excelStatus] ?? excelStatus,
      replacedBy: null,
      registeredIn: text(r[c.registeredIn]),
      evidenceCheckedAt: text(r[c.evidenceCheckedAt]),
      domain: text(r[c.domain]),
      cluster: text(r[c.cluster]),
      component: text(r[c.component]),
      swStack: text(r[c.swStack]),
      nameEn: text(r[c.nameEn]),
      nameKo: text(r[c.nameKo]),
      aliases: [...new Set(aliases)],
      lifecycle: text(r[c.lifecycle]),
      techStack: text(r[c.techStack]),
      autoQuality: text(r[c.autoQuality]),
      techQuality: text(r[c.techQuality]),
      asilRep: text(r[c.asilRep]),
      method: text(r[c.method]),
      tshirt: text(r[c.tshirt]),
      bundleId: text(r[c.bundleId]),
      bundleRep: text(r[c.bundleRep]) === 'Y',
      sizeEvidenceGrade: text(r[c.sizeEvidenceGrade])?.charAt(0) ?? null,
      benchmarkEur: num(r[c.benchmarkEur]),
      kearneyNote: text(r[c.kearneyNote]),
      makeBuyVolume: text(r[c.makeBuyVolume]),
      makeBuyPremium: text(r[c.makeBuyPremium]),
      relevance: text(r[c.relevance]),
      sourceIds: list(r[c.sourceIds]).flatMap((x) => x.split(/[,\s]+/)).filter(Boolean),
      sourceDetail: text(r[c.sourceDetail]),
      remark: text(r[c.remark]),
      basisType: text(r[c.basisType]),
      vehicleType: text(r[c.vehicleType]),
      region: text(r[c.region]),
      duplicateOf: text(r[c.duplicateOf]),
      requires: list(r[c.requires]),
      excludes: [],
      procurement: text(r[c.procurement]),
      swPackage: text(r[c.swPackage]),
      licenseItem: text(r[c.licenseItem]),
      billing: text(r[c.billing]),
      adminMemo: text(r[c.adminMemo]),
      definition: definitions.get(refId) ?? null,
    };
    const ok = FeatureRefRow.safeParse(row);
    if (ok.success) refs.push(ok.data);
    else warnings.push({ sheet: '03_FeatureDB', row: i + 1, key: refId, message: ok.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
  }

  // ── 09_출처
  const src = grid(wb, '09_출처');
  const srcHead = src.findIndex((r) => r.includes('ID') && r.includes('자료'));
  const o = srcHead >= 0 ? src[srcHead].indexOf('ID') : 0;
  const sources: unknown[] = [];
  for (let i = srcHead + 1; srcHead >= 0 && i < src.length; i++) {
    const r = src[i];
    const sourceId = text(r[o]);
    // 첫 표(출처 목록)만 — 빈 행·'행 수' 아래는 '출처별 Feature 수' 집계표다
    if (!sourceId || !/^S\d+$/.test(sourceId)) break;
    const row = { sourceId, title: text(r[o + 1]) ?? '', publisher: text(r[o + 2]), edition: text(r[o + 3]), url: text(r[o + 4]), note: text(r[o + 5]) };
    const ok = RefSourceRow.safeParse(row);
    if (ok.success) sources.push(ok.data);
    else warnings.push({ sheet: '09_출처', row: i + 1, key: sourceId, message: ok.error.issues.map((x) => x.message).join('; ') });
  }

  // ── 13_세부기능후보 (읽기 전용 참고, D-REF-12)
  const sub = grid(wb, '13_세부기능후보');
  const subHead = findHeader(sub, '후보 ID');
  const subfunctions: unknown[] = [];
  if (subHead >= 0) {
    const s = columns(sub[subHead], { candidateId: '후보 ID', groupId: '기능군 ID', group: '기능군', nameEn: '세부기능 (EN)', nameKo: '세부기능 (KO)', component: '대응 컴포넌트', domain: '대응 도메인', anchor: '표준 앵커', scope: '기능 범위 설명', verificationFocus: '검증 초점' }, '13_세부기능후보');
    for (let i = subHead + 1; i < sub.length; i++) {
      const r = sub[i];
      const candidateId = text(r[s.candidateId]);
      if (!candidateId) continue;
      const row = { candidateId, groupId: text(r[s.groupId]), group: text(r[s.group]), nameEn: text(r[s.nameEn]) ?? '', nameKo: text(r[s.nameKo]) ?? '', component: text(r[s.component]) ?? '', domain: text(r[s.domain]) ?? '', anchor: text(r[s.anchor]), scope: text(r[s.scope]), verificationFocus: text(r[s.verificationFocus]) };
      const ok = RefSubfunctionRow.safeParse(row);
      if (ok.success) subfunctions.push(ok.data);
      else warnings.push({ sheet: '13_세부기능후보', row: i + 1, key: candidateId, message: ok.error.issues.map((x) => x.message).join('; ') });
    }
  }

  // ── 분류 — 행에서 도메인·클러스터·컴포넌트와 ID 약어를 모은다
  const taxonomy: unknown[] = [];
  const seen = new Set<string>();
  const push = (node: Record<string, unknown>) => {
    if (seen.has(node.nodeId as string)) return;
    seen.add(node.nodeId as string);
    taxonomy.push(TaxonomyNodeRow.parse(node));
  };
  const domainAbbr = new Map<string, Set<string>>();
  const componentAbbr = new Map<string, Map<string, number>>();
  for (const r of refs as { refId: string; domain: string; cluster: string; component: string }[]) {
    const [d, k] = r.refId.split('-');
    (domainAbbr.get(r.domain) ?? domainAbbr.set(r.domain, new Set()).get(r.domain)!).add(d);
    const ck = `${r.domain}|${r.component}`;
    const counts = componentAbbr.get(ck) ?? componentAbbr.set(ck, new Map()).get(ck)!;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [domain, abbrs] of domainAbbr) {
    if (abbrs.size > 1) warnings.push({ sheet: '03_FeatureDB', row: 0, key: domain, message: `도메인 약어가 여럿입니다: ${[...abbrs].join(', ')}` });
  }
  for (const r of refs as { refId: string; domain: string; cluster: string; component: string }[]) {
    const dAbbr = [...domainAbbr.get(r.domain)!][0];
    const dId = `D:${dAbbr}`;
    const cId = `C:${dAbbr}:${r.cluster}`;
    push({ nodeId: dId, level: 'DOMAIN', parentId: null, name: r.domain, abbr: dAbbr });
    push({ nodeId: cId, level: 'CLUSTER', parentId: dId, name: r.cluster, abbr: null });
    // 약어가 여럿이면(예: Body controller BCM·BDY) 가장 많이 쓰인 것을 새 ID 발급용 대표로 둔다
    const abbrs = [...componentAbbr.get(`${r.domain}|${r.component}`)!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    push({ nodeId: `K:${dAbbr}:${r.component}`, level: 'COMPONENT', parentId: cId, name: r.component, abbr: abbrs[0][0] });
  }

  return { sourceSha256: createHash('sha256').update(buf).digest('hex'), files: { refs, sources, glossary, subfunctions, taxonomy }, warnings };
}

/** 한 줄에 한 행 — 1,052행을 사람이 diff로 읽을 수 있게 */
export const serializeRows = (rows: unknown[]) => '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

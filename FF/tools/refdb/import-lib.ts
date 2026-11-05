// Feature DB 1회 이전 (30-95 §9, D-REF-5) — 엑셀 Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx → data/reference/feature-db/v1.3/*.json.
// 결정적 변환: 같은 xlsx → 바이트 단위로 같은 JSON(키 순서 고정, 기준 행은 refId 순, LF, 끝 줄바꿈). 시각·환경 값을 넣지 않는다.
// 엑셀은 계산값이 저장된 파일이어야 한다(Excel에서 저장). 수식은 다시 계산하지 않고, 파생 값(T·U·BW 등)은 검증용 곁 파일에만 둔다.
// 시트·열 대응(엑셀 4행 머리글 기준):
//   03_FeatureDB          A~AE·BJ~BL·BO~BV → refs.json (§5.1). AF~AQ 과제 입력·AR~BI·BM·BW 자동 계산·BN 견적 입력은 옮기지 않는다
//   03b_Feature카탈로그   C절 사내 용어집 → glossary.json + 기준 행 aliases · D절 카탈로그(①~⑳) → 기준 행 definition
//   09_출처               출처 목록(ID·자료·발행처·연도·URL) + 15_DB운영 5절 정기 점검(확인일·다음 점검) → sources.json
//   13_세부기능후보       → subfunctions.json (읽기 전용 참고)
//   도메인·클러스터·컴포넌트 값과 ID 약어 → taxonomy.json
import { createHash } from 'node:crypto';
import { readWorkbook, type Sheet } from '../xlsx.ts';
import { asilFactor, nominalPoints, sizePoints } from '../../contracts/src/rules/refdb/size.ts';

export const IMPORTER_VERSION = '1.0.0';
export const RELEASE = 'v1.3';
export const DATA_FILES = ['refs', 'taxonomy', 'sources', 'glossary', 'subfunctions'] as const;
export type DataFile = (typeof DATA_FILES)[number];
/** 검증 전용 곁 파일 — 엑셀이 저장한 파생 값(옮기지 않는 열). 기준 행 원천이 아니다 */
export const DERIVED_FILE = '_excel-derived';

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** 2칸 들여쓰기 + LF + 끝 줄바꿈 */
export const serialize = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

export type RefStatus = 'ACTIVE' | 'REVIEW' | 'DEPRECATED' | 'RETIRED' | 'PENDING';
const STATUS: Record<string, RefStatus> = {
  활성: 'ACTIVE',
  '검토 필요': 'REVIEW',
  '폐기 예정': 'DEPRECATED',
  폐기: 'RETIRED',
  '요청 중': 'PENDING',
  ACTIVE: 'ACTIVE',
  REVIEW: 'REVIEW',
  DEPRECATED: 'DEPRECATED',
  RETIRED: 'RETIRED',
  PENDING: 'PENDING',
};

/** 03_FeatureDB 열 → 0부터 시작하는 인덱스 */
const COL = {
  refId: 'A', domain: 'B', cluster: 'C', component: 'D', swStack: 'E', nameEn: 'F', nameKo: 'G', lifecycle: 'H', techStack: 'I',
  autoQuality: 'J', techQuality: 'K', asilRep: 'L', overall: 'M', method: 'N', benchmarkEur: 'O', kearneyNote: 'P', bundleId: 'Q',
  bundleRep: 'R', tshirt: 'S', points: 'T', nominalPoints: 'U', makeBuyVolume: 'V', makeBuyPremium: 'W', relevance: 'X', sourceIds: 'Y',
  sourceDetail: 'Z', remark: 'AA', basisType: 'AB', vehicleType: 'AC', region: 'AD', asilFactor: 'BH', duplicateOf: 'BJ',
  sizeEvidenceGrade: 'BK', requires: 'BL', registeredIn: 'BO', evidenceCheckedAt: 'BP', status: 'BQ', adminMemo: 'BR',
  procurement: 'BS', swPackage: 'BT', licenseItem: 'BU', billing: 'BV', baseEffortMm: 'BW',
} as const;
const ci = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** 머리글 검증 — 엑셀 열이 밀리면 조용히 엉뚱한 값을 옮기지 않도록 핵심 열 머리글을 대조한다 */
const HEADER_EXPECT: Partial<Record<keyof typeof COL, string>> = {
  refId: 'ID', domain: '도메인', cluster: '컴포넌트 클러스터', component: '컴포넌트', nameKo: '기능명', asilRep: 'QM / ASIL',
  tshirt: 'T-shirt 등급', points: '등급 포인트', nominalPoints: '명목 포인트', sourceIds: '출처 ID', duplicateOf: '중복 점검 기준 ID',
  requires: '선행 Feature ID', registeredIn: '등록 버전', status: '관리 상태', adminMemo: '관리 메모', billing: '과금 방식',
  baseEffortMm: '신규 개발 기준 공수',
};

const clean = (v: string | undefined) => (v ?? '').replace(/\r\n/g, '\n').trim();
const orNull = (v: string | undefined) => clean(v) || null;
/** '; '·';' 구분 목록 */
const list = (v: string | undefined) => clean(v).split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
const num = (v: string | undefined) => {
  const t = clean(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** 03b ⑫~⑮ — 0 이상 정수 글자만(엑셀 숫자 규칙). 다른 값이면 가져오기를 멈춘다 */
const intText = (v: string | undefined, id: string, label: string) => {
  const t = clean(v);
  if (!t) return null;
  if (!/^\d+$/.test(t)) throw new Error(`03b ${id} ${label} '${t}'는 0 이상 정수가 아닙니다`);
  return t;
};
/** 엑셀 날짜 일련번호(1900 체계) 또는 'YYYY-MM-DD' → ISO 날짜 */
export function excelDate(v: string | undefined): string | null {
  const t = clean(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t)) * 86_400_000).toISOString().slice(0, 10);
  return null;
}
/** '2026-12 (R26-11 공개 예상)' → '2026-12-01', '원문 입수 시' → null — 월 단위 점검일은 그 달 1일로 둔다 */
function reviewDate(v: string | undefined): string | null {
  const t = clean(v);
  const d = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(t);
  return d ? `${d[1]}-${d[2]}-${d[3] ?? '01'}` : null;
}

function sheet(wb: Sheet[], name: string): Sheet {
  const s = wb.find((x) => x.name === name);
  if (!s) throw new Error(`시트 '${name}'이 없습니다 — Feature DB v1.3 엑셀이 맞는지 확인하세요`);
  return s;
}
/** 머리글 행 찾기 — 지정한 열 값이 같은 첫 행(0부터) */
function findRow(s: Sheet, col: number, text: string, from = 0): number {
  for (let i = from; i < s.rows.length; i++) if (clean(s.rows[i]?.[col]) === text) return i;
  throw new Error(`시트 '${s.name}'에서 '${text}' 행을 찾지 못했습니다`);
}

export interface RefDefinition {
  level: string | null;
  /** ② 원문 그대로('; ' 구분, 기본 제어 Feature면 '없음') */
  parentRefId: string | null;
  /** ② 기준 ID 목록('없음' 제외) — 참조 점검용 */
  parentRefIds: string[];
  summary: string | null;
  trigger: string | null;
  scopeIn: string[];
  scopeOut: string[];
  scopeOutRefs: string[];
  /** ⑧~⑪ 원문('; ' 구분 데이터 그룹) */
  io: { entry: string | null; exit: string | null; read: string | null; write: string | null };
  /** ⑫~⑮ 원문(0 이상 정수 글자) */
  drivers: { states: string | null; dtcs: string | null; calibrations: string | null; variants: string | null };
  regulations: string | null;
  verification: string | null;
  typicalChanges: string | null;
  sharedFunctions: string | null;
  authoringStatus: string | null;
  author: string | null;
  note: string | null;
}

export interface ImportResult {
  sourceSha256: string;
  files: Record<DataFile, unknown[]>;
  /** refId → 엑셀 저장 파생 값(T·U·M·BH·BW) — 검증 전용 */
  derived: Record<string, { points: number | null; nominalPoints: number | null; overall: number | null; asilFactor: number | null; baseEffortMm: number | null }>;
  /** 엑셀 02_프로젝트설정의 과제 설정값 — BW 재계산 검증에만 쓴다 */
  excelSettings: { anchorEur: number | null; eurPerHour: number | null; hoursPerPm: number | null };
  statusCounts: Record<RefStatus, number>;
  /** 03b D절에서 definition이 붙은 Feature ID */
  definitionRefIds: string[];
  warnings: string[];
}

/** 03b C절 사내 용어집 */
function readGlossary(s: Sheet) {
  const head = findRow(s, 2, '용어');
  const out: { term: string; meaning: string; refIds: string[]; status: string | null }[] = [];
  for (let i = head + 1; i < s.rows.length; i++) {
    const r = s.rows[i] ?? [];
    if (/^D\./.test(clean(r[1]))) break;
    const term = clean(r[2]);
    if (!term) continue;
    // 관련 Feature ID 빈칸 = 모든 Feature → []
    out.push({ term, meaning: clean(r[3]), refIds: list(r[4]), status: orNull(r[5]) });
  }
  return out;
}

/** 03b D절 카탈로그 → refId별 definition·⑲ 별칭 */
function readCatalog(s: Sheet) {
  const head = findRow(s, 2, 'Feature ID');
  const h = s.rows[head].map(clean);
  const at = (label: string) => {
    const i = h.findIndex((x) => x.startsWith(label));
    if (i < 0) throw new Error(`03b D절 머리글 '${label}'이 없습니다`);
    return i;
  };
  const c = {
    id: at('Feature ID'), level: at('①'), parent: at('②'), summary: at('③'), trigger: at('④'), scopeIn: at('⑤'), scopeOut: at('⑥'),
    scopeOutRefs: at('⑦'), entry: at('⑧'), exit: at('⑨'), read: at('⑩'), write: at('⑪'), states: at('⑫'), dtcs: at('⑬'),
    calibrations: at('⑭'), variants: at('⑮'), regulations: at('⑯'), verification: at('⑰'), changes: at('⑱'), aliases: at('⑲'),
    shared: at('⑳'), status: at('작성 상태'), author: at('작성자'), note: at('근거·출처·메모'),
  };
  const out = new Map<string, { definition: RefDefinition; aliases: string[] }>();
  for (let i = head + 1; i < s.rows.length; i++) {
    const r = s.rows[i] ?? [];
    const id = clean(r[c.id]);
    if (!id) continue;
    if (out.has(id)) throw new Error(`03b D절에 Feature ID ${id}가 두 번 있습니다 (${i + 1}행)`);
    const parents = list(r[c.parent]).filter((p) => p !== '없음');
    const level = /^L[123]\b/.exec(clean(r[c.level]))?.[0] ?? orNull(r[c.level]);
    out.set(id, {
      aliases: list(r[c.aliases]),
      definition: {
        level,
        parentRefId: orNull(r[c.parent]),
        parentRefIds: parents,
        summary: orNull(r[c.summary]),
        trigger: orNull(r[c.trigger]),
        scopeIn: list(r[c.scopeIn]),
        scopeOut: list(r[c.scopeOut]),
        scopeOutRefs: list(r[c.scopeOutRefs]),
        io: { entry: orNull(r[c.entry]), exit: orNull(r[c.exit]), read: orNull(r[c.read]), write: orNull(r[c.write]) },
        drivers: { states: intText(r[c.states], id, '⑫'), dtcs: intText(r[c.dtcs], id, '⑬'), calibrations: intText(r[c.calibrations], id, '⑭'), variants: intText(r[c.variants], id, '⑮') },
        regulations: orNull(r[c.regulations]),
        verification: orNull(r[c.verification]),
        typicalChanges: orNull(r[c.changes]),
        sharedFunctions: orNull(r[c.shared]),
        authoringStatus: orNull(r[c.status]),
        author: orNull(r[c.author]),
        note: orNull(r[c.note]),
      },
    });
  }
  return out;
}

/** 15_DB운영 5절 정기 점검 — 출처 ID별 가장 늦은 확인일·가장 이른 다음 점검일 */
function readReviews(s: Sheet) {
  const sec = findRow(s, 1, '5. 정기 점검 (표준·규정 개정 감시)');
  const out = new Map<string, { checkedAt: string | null; nextReviewAt: string | null }>();
  for (let i = sec + 2; i < s.rows.length; i++) {
    const r = s.rows[i] ?? [];
    const label = clean(r[1]);
    if (!label || /^\d+\./.test(label)) break;
    const id = /^(S\d+)\b/.exec(label)?.[1];
    if (!id) continue;
    const prev = out.get(id) ?? { checkedAt: null, nextReviewAt: null };
    const checked = excelDate(r[3]);
    const next = reviewDate(r[4]);
    out.set(id, {
      checkedAt: [prev.checkedAt, checked].filter(Boolean).sort().pop() ?? null,
      nextReviewAt: [prev.nextReviewAt, next].filter(Boolean).sort()[0] ?? null,
    });
  }
  return out;
}

function readSources(s: Sheet, reviews: Map<string, { checkedAt: string | null; nextReviewAt: string | null }>) {
  const head = findRow(s, 1, 'ID');
  const out: Record<string, unknown>[] = [];
  for (let i = head + 1; i < s.rows.length; i++) {
    const r = s.rows[i] ?? [];
    const id = clean(r[1]);
    if (!id) break; // 목록 끝(빈 줄) — 그 아래는 '행 수'·'출처별 Feature 수' 집계
    if (!/^S\d+$/.test(id)) continue;
    const version = orNull(r[4]);
    const rv = reviews.get(id);
    // 확인일: 5절 정기 점검 확인일 > 연도·버전 칸의 'YYYY-MM-DD 확인' 표기 > 없음
    const noted = /(\d{4}-\d{2}-\d{2})\s*확인/.exec(version ?? '')?.[1] ?? null;
    out.push({
      sourceId: id,
      title: clean(r[2]),
      publisher: orNull(r[3]),
      version,
      url: orNull(r[5]),
      usage: orNull(r[6]),
      checkedAt: rv?.checkedAt ?? noted,
      nextReviewAt: rv?.nextReviewAt ?? null,
    });
  }
  return out.sort((a, b) => cmpId(String(a.sourceId), String(b.sourceId)));
}

function readSubfunctions(s: Sheet) {
  const head = findRow(s, 1, '후보 ID');
  const out: Record<string, unknown>[] = [];
  for (let i = head + 1; i < s.rows.length; i++) {
    const r = s.rows[i] ?? [];
    const id = clean(r[1]);
    if (!id) continue;
    out.push({
      subfunctionId: id,
      component: orNull(r[8]),
      domain: orNull(r[9]),
      name: clean(r[6]),
      nameEn: orNull(r[5]),
      groupId: orNull(r[2]),
      group: orNull(r[3]),
      anchor: orNull(r[10]),
      note: orNull(r[11]),
      verificationFocus: orNull(r[12]),
    });
  }
  return out.sort((a, b) => cmpId(String(a.subfunctionId), String(b.subfunctionId)));
}

/** 'S9' < 'S10', 'BC-BCM-002' < 'BC-BCM-010' — 숫자 부분은 수로 비교(코드 포인트 순 + 숫자 자릿수 보정) */
export function cmpId(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y) || (x < y ? -1 : 1);
    return x < y ? -1 : 1;
  }
  return 0;
}

export function importWorkbook(buf: Buffer): ImportResult {
  const wb = readWorkbook(buf);
  const warnings: string[] = [];
  const db = sheet(wb, '03_FeatureDB');
  const headIdx = findRow(db, 0, 'ID');
  const head = db.rows[headIdx].map(clean);
  for (const [k, label] of Object.entries(HEADER_EXPECT)) {
    const got = head[ci(COL[k as keyof typeof COL])] ?? '';
    if (!got.startsWith(label!)) throw new Error(`03_FeatureDB ${COL[k as keyof typeof COL]}열 머리글이 '${label}'이 아닙니다('${got}') — 열 배치가 바뀐 엑셀`);
  }
  const catSheet = sheet(wb, '03b_Feature카탈로그');
  const glossary = readGlossary(catSheet);
  const catalog = readCatalog(catSheet);
  const sources = readSources(sheet(wb, '09_출처'), readReviews(sheet(wb, '15_DB운영')));
  const subfunctions = readSubfunctions(sheet(wb, '13_세부기능후보'));

  // 02_프로젝트설정 — 포인트당 벤치마크 €(C23)·환산 단가 €/h(C24)·인월당 시간(C25)
  const ps = sheet(wb, '02_프로젝트설정');
  const setting = (label: string) => num(ps.rows.find((r) => clean(r?.[1]).startsWith(label))?.[2]);
  const excelSettings = { anchorEur: setting('포인트당 벤치마크 비용'), eurPerHour: setting('벤치마크 환산 단가'), hoursPerPm: setting('인월당 시간') };

  const get = (r: string[], k: keyof typeof COL) => r[ci(COL[k])];
  const refs: Record<string, unknown>[] = [];
  const derived: ImportResult['derived'] = {};
  const statusCounts: Record<RefStatus, number> = { ACTIVE: 0, REVIEW: 0, DEPRECATED: 0, RETIRED: 0, PENDING: 0 };
  const rows = db.rows.slice(headIdx + 1).filter((r) => clean(r?.[0]));
  const ids = new Set(rows.map((r) => clean(r[0])));
  for (const [id] of catalog) if (!ids.has(id)) throw new Error(`03b D절 Feature ID ${id}가 03_FeatureDB에 없습니다`);

  for (const r of rows) {
    const refId = clean(get(r, 'refId'));
    const rawStatus = clean(get(r, 'status'));
    const status = STATUS[rawStatus];
    if (!status) throw new Error(`${refId}: 관리 상태 '${rawStatus}'를 알 수 없습니다(활성·검토 필요·폐기 예정·폐기·요청 중)`);
    statusCounts[status]++;
    const bundleId = orNull(get(r, 'bundleId'));
    const cat = catalog.get(refId);
    // 별칭 = 03b ⑲ 견적서 별칭 + 이 행을 가리키는 사내 용어집 용어(빈칸 = 모든 Feature인 용어는 넣지 않는다)
    const aliases = [...new Set([...(cat?.aliases ?? []), ...glossary.filter((g) => g.refIds.includes(refId)).map((g) => g.term)])];
    const grade = /^([ABCD])\b/.exec(clean(get(r, 'sizeEvidenceGrade')))?.[1] ?? null;
    if (clean(get(r, 'sizeEvidenceGrade')) && !grade) warnings.push(`${refId}: 규모 근거 등급 '${clean(get(r, 'sizeEvidenceGrade'))}'를 A~D로 읽지 못함`);
    const row = {
      refId,
      status,
      replacedBy: null,
      registeredIn: clean(get(r, 'registeredIn')),
      evidenceCheckedAt: excelDate(get(r, 'evidenceCheckedAt')),
      domain: clean(get(r, 'domain')),
      cluster: clean(get(r, 'cluster')),
      component: clean(get(r, 'component')),
      swStack: clean(get(r, 'swStack')),
      lifecycle: clean(get(r, 'lifecycle')),
      techStack: clean(get(r, 'techStack')),
      vehicleType: clean(get(r, 'vehicleType')),
      region: clean(get(r, 'region')),
      nameEn: clean(get(r, 'nameEn')),
      nameKo: clean(get(r, 'nameKo')),
      aliases,
      autoQuality: clean(get(r, 'autoQuality')),
      techQuality: clean(get(r, 'techQuality')),
      asilRep: clean(get(r, 'asilRep')),
      method: clean(get(r, 'method')),
      tshirt: clean(get(r, 'tshirt')),
      bundleId,
      // 번들 대표: 번들 행이면 R열 'Y' 여부, 번들이 아니면 null
      bundleRep: bundleId ? clean(get(r, 'bundleRep')).toUpperCase() === 'Y' : null,
      sizeEvidenceGrade: grade,
      benchmarkEur: num(get(r, 'benchmarkEur')),
      kearneyNote: clean(get(r, 'kearneyNote')),
      makeBuyVolume: clean(get(r, 'makeBuyVolume')),
      makeBuyPremium: clean(get(r, 'makeBuyPremium')),
      relevance: clean(get(r, 'relevance')),
      sourceIds: list(get(r, 'sourceIds').replace(/,/g, ';')),
      sourceDetail: clean(get(r, 'sourceDetail')),
      remark: clean(get(r, 'remark')),
      basisType: clean(get(r, 'basisType')),
      // BJ 중복 점검 기준 ID(30-95 §5.1 관계) — 범위가 겹치는 기존 행
      duplicateOf: orNull(get(r, 'duplicateOf')),
      requires: list(get(r, 'requires')),
      excludes: [] as string[],
      procurement: clean(get(r, 'procurement')),
      swPackage: clean(get(r, 'swPackage')),
      licenseItem: clean(get(r, 'licenseItem')),
      billing: clean(get(r, 'billing')),
      definition: cat?.definition ?? null,
      adminMemo: clean(get(r, 'adminMemo')),
    };
    refs.push(row);
    derived[refId] = {
      points: num(get(r, 'points')),
      nominalPoints: num(get(r, 'nominalPoints')),
      overall: num(get(r, 'overall')),
      asilFactor: num(get(r, 'asilFactor')),
      baseEffortMm: num(get(r, 'baseEffortMm')),
    };
    // 가져오는 순간에도 파생 값 규칙과 대조해 둔다(점검은 check.ts가 다시 한다)
    if (sizePoints(row.tshirt) !== derived[refId].points) warnings.push(`${refId}: T 재계산 ${sizePoints(row.tshirt)} ≠ 엑셀 ${derived[refId].points}`);
    if (asilFactor(row.asilRep) !== derived[refId].asilFactor) warnings.push(`${refId}: BH 재계산 ${asilFactor(row.asilRep)} ≠ 엑셀 ${derived[refId].asilFactor}`);
    const u = nominalPoints(row, excelSettings.anchorEur ?? undefined);
    if (u !== derived[refId].nominalPoints) warnings.push(`${refId}: U 재계산 ${u} ≠ 엑셀 ${derived[refId].nominalPoints}`);
  }
  refs.sort((a, b) => cmpId(String(a.refId), String(b.refId)));

  const taxonomy = buildTaxonomy(refs as { refId: string; domain: string; cluster: string; component: string }[], warnings);
  const sortedDerived = Object.fromEntries(Object.keys(derived).sort(cmpId).map((k) => [k, derived[k]]));
  return {
    sourceSha256: sha256(buf),
    files: { refs, taxonomy, sources, glossary, subfunctions },
    derived: sortedDerived,
    excelSettings,
    statusCounts,
    definitionRefIds: [...catalog.keys()].sort(cmpId),
    warnings,
  };
}

/**
 * 분류 표 (30-95 §4) — 도메인 10 · 클러스터 · 컴포넌트 69.
 * 엑셀에서 한 컴포넌트가 여러 클러스터에 걸치므로(예: AUTOSAR Classic Platform → CP 6개 클러스터) 클러스터와 컴포넌트는 모두 도메인 아래에 두고,
 * 컴포넌트가 속한 클러스터는 clusterIds로 적는다. 약어는 기준 행 ID('도메인약어-컴포넌트약어-일련번호')에서 읽는다.
 * 노드 ID는 수준마다 구분자가 다르다 — 도메인 'BC' · 클러스터 'BC:Mirrors' · 컴포넌트 'BC/Mirrors'.
 * 클러스터와 컴포넌트 이름이 같은 4쌍(BC:Interior lighting·BC:Mirrors·IN:Instrument cluster·IN:Navigation)도 ID가 겹치지 않는다.
 * 약어는 컴포넌트마다 유일하지 않아(같은 도메인의 두 컴포넌트가 한 약어를 씀) ID에 쓰지 않는다.
 * 엑셀에 한글 분류명이 없어 nameKo는 null(DB 관리자가 채운다).
 */
function buildTaxonomy(refs: { refId: string; domain: string; cluster: string; component: string }[], warnings: string[]) {
  const domains = new Map<string, { abbr: string; count: number }>();
  const clusters = new Map<string, { domain: string; name: string }>();
  const comps = new Map<string, { domain: string; name: string; abbrs: Set<string>; clusters: Set<string> }>();
  for (const r of refs) {
    const [dAbbr, cAbbr] = r.refId.split('-');
    const d = domains.get(r.domain);
    if (d && d.abbr !== dAbbr) warnings.push(`${r.refId}: 도메인 '${r.domain}' 약어가 ${d.abbr}와 ${dAbbr} 두 가지`);
    domains.set(r.domain, { abbr: d?.abbr ?? dAbbr, count: (d?.count ?? 0) + 1 });
    const clusterId = `${dAbbr}:${r.cluster}`;
    clusters.set(clusterId, { domain: dAbbr, name: r.cluster });
    const compId = `${dAbbr}/${r.component}`;
    const c = comps.get(compId) ?? { domain: dAbbr, name: r.component, abbrs: new Set(), clusters: new Set() };
    c.abbrs.add(cAbbr); // refs는 refId 순이라 처음 넣은 약어가 가장 앞 ID의 약어
    c.clusters.add(clusterId);
    comps.set(compId, c);
  }
  const nodes: Record<string, unknown>[] = [];
  for (const [name, d] of domains) nodes.push({ nodeId: d.abbr, level: 'DOMAIN', parentId: null, nameEn: name, nameKo: '', abbr: d.abbr, status: 'ACTIVE' });
  for (const [id, c] of clusters) nodes.push({ nodeId: id, level: 'CLUSTER', parentId: c.domain, nameEn: c.name, nameKo: '', abbr: null, status: 'ACTIVE' });
  for (const [id, c] of comps) {
    // 대표 약어 = 가장 앞 ID(먼저 등록된 행)의 약어, 나중에 붙은 약어는 abbrs에 남긴다(예: Body controller BCM·BCX)
    const abbrs = [...c.abbrs.keys()];
    nodes.push({ nodeId: id, level: 'COMPONENT', parentId: c.domain, nameEn: c.name, nameKo: '', abbr: abbrs[0], abbrs, clusterIds: [...c.clusters].sort(), status: 'ACTIVE' });
  }
  const order = { DOMAIN: 0, CLUSTER: 1, COMPONENT: 2 } as Record<string, number>;
  return nodes.sort((a, b) => order[String(a.level)] - order[String(b.level)] || (String(a.nodeId) < String(b.nodeId) ? -1 : String(a.nodeId) > String(b.nodeId) ? 1 : 0));
}

/** 출력 파일 이름 → 직렬화 텍스트(manifest 포함). 쓰기·비교·점검이 모두 이 함수 결과를 쓴다 */
export function renderFiles(res: ImportResult, sourceFile: string): Record<string, string> {
  const out: Record<string, string> = {};
  const files: Record<string, { rows: number; sha256: string }> = {};
  for (const name of DATA_FILES) {
    const text = serialize(res.files[name]);
    out[`${name}.json`] = text;
    files[name] = { rows: res.files[name].length, sha256: sha256(text) };
  }
  const derivedText = serialize({
    _note: '검증 전용 — 엑셀 v1.3이 저장한 파생 값(T 등급 포인트·U 명목 포인트·M 난이도·BH 대표 ASIL 계수·BW 신규 개발 기준 공수). 기준 행 원천이 아니며 FF는 규칙으로 계산한다',
    excelSettings: res.excelSettings,
    rows: res.derived,
  });
  out[`${DERIVED_FILE}.json`] = derivedText;
  files[DERIVED_FILE] = { rows: Object.keys(res.derived).length, sha256: sha256(derivedText) };
  const manifest = {
    release: RELEASE,
    source: { file: sourceFile, sha256: res.sourceSha256 },
    generatedBy: { tool: 'tools/refdb/import.ts', version: IMPORTER_VERSION },
    files,
    statusCounts: res.statusCounts,
    definitions: { rows: res.definitionRefIds.length, refIds: res.definitionRefIds },
    warnings: res.warnings,
  };
  out['manifest.json'] = serialize(manifest);
  return out;
}

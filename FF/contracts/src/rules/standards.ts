// 보고서 v1.1 규칙·시험 카탈로그와 근거 표준 조항 — 따라하기 가이드 패널과 표준 설명 모드가 "왜"를 보여 줄 때 쓴다.
// 규칙 원문은 생성 모듈(generated/report-catalog.ts, tools/guide-sync.ts)에서 오고, 조항은 각 규칙의 '근거' 필드를 그대로 쓴다(원문에 없는 조항 요약을 지어내지 않는다).
// 카탈로그(원문)는 이 파일이 직접 가져오지 않는다 — contracts 입구(index.ts)는 report-catalog-installed.ts로 바로 설치하고,
// 화면(web.ts 입구)은 design/rule-catalog.ts가 처음 필요할 때 따로 읽어 설치한다(첫 화면 묶음 밖, harness/budgets.json).

export interface ReportRule {
  id: string;
  title: string;
  /** 필수 · 권장 */
  level: string;
  scope: string[];
  rule: string;
  basis: string;
  verify: string;
  /** 원고 파일 · 절 제목 */
  section: string;
}
export interface ReportTest {
  id: string;
  test: string;
  expected: string;
  impl: string;
}

let SOURCE: { rules: readonly ReportRule[]; tests: readonly ReportTest[] } = { rules: [], tests: [] };

/** 카탈로그 설치 — 색인을 다시 만든다. 설치 전 조회는 undefined(화면은 설치를 기다렸다 다시 그린다) */
export function installReportCatalog(rules: readonly ReportRule[], tests: readonly ReportTest[]): void {
  SOURCE = { rules, tests };
  RULES = undefined;
  TESTS = undefined;
}
export const reportCatalogInstalled = (): boolean => SOURCE.rules.length > 0;

// 색인은 처음 조회할 때 만든다
let RULES: Map<string, ReportRule> | undefined;
let TESTS: Map<string, ReportTest> | undefined;

export const reportRule = (id: string): ReportRule | undefined => (RULES ??= new Map(SOURCE.rules.map((r) => [r.id, r]))).get(id);
export const reportTest = (id: string): ReportTest | undefined => (TESTS ??= new Map(SOURCE.tests.map((t) => [t.id, t]))).get(id);

/** 표준·법규 계열 — 조항 문자열의 앞부분으로 고른다. 이름은 표준 제목의 우리말 표기 */
export const STANDARD_FAMILIES: { prefix: RegExp; name: string }[] = [
  { prefix: /^ISO 26262/, name: '도로 차량 기능안전' },
  { prefix: /^ISO 21448/, name: 'SOTIF(의도된 기능의 안전)' },
  { prefix: /^ISO\/SAE 21434/, name: '사이버보안 엔지니어링' },
  { prefix: /^ISO 24089/, name: 'SW 업데이트 엔지니어링' },
  { prefix: /^ISO 3450[23]/, name: '자동운전 시나리오·ODD' },
  { prefix: /^UN R155/, name: '사이버보안·CSMS 형식승인' },
  { prefix: /^UN R156/, name: 'SW 업데이트·SUMS 형식승인' },
  { prefix: /^UN R15[27]|^UN R160|^UN R171/, name: 'UN 차량 규정' },
  { prefix: /^UN ADS/, name: 'UN 자동운전시스템(ADS) 규정' },
  { prefix: /^(Automotive SPICE|ASPICE)/, name: 'Automotive SPICE' },
  { prefix: /^MISRA/, name: 'MISRA 코딩 표준' },
  { prefix: /^(EU|Regulation \(EU\)|GDPR)/, name: 'EU 법규' },
  { prefix: /^(GB|MIIT|SAMR)/, name: '중국 법규·표준' },
  { prefix: /^(49 CFR|NHTSA|FMVSS)/, name: '미국 법규' },
];

export function standardFamily(clause: string): string | null {
  return STANDARD_FAMILIES.find((f) => f.prefix.test(clause))?.name ?? null;
}

/** 규칙 '근거' 필드를 조항 목록으로 — "ISO 26262-4:2018 cl.6; UN R156 §7.2" → ['ISO 26262-4:2018 cl.6', 'UN R156 §7.2'] */
export function clausesOf(rule: Pick<ReportRule, 'basis'>): string[] {
  return rule.basis
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 여러 규칙의 근거 조항을 중복 없이 — 단계가 어떤 표준을 충족시키는지 한 줄로 */
export function clausesOfRules(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) for (const c of clausesOf(reportRule(id) ?? { basis: '' })) if (!out.includes(c)) out.push(c);
  return out;
}

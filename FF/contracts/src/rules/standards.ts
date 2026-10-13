// 보고서 v1.1 규칙·시험 카탈로그와 근거 표준 조항 — 따라하기 가이드 패널과 표준 설명 모드가 "왜"를 보여 줄 때 쓴다.
// 규칙 원문은 생성 모듈(generated/report-catalog.ts, tools/guide-sync.ts)에서 오고, 조항은 각 규칙의 '근거' 필드를 그대로 쓴다(원문에 없는 조항 요약을 지어내지 않는다).
import { REPORT_RULES, REPORT_TESTS } from '../generated/report-catalog';

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

export { REPORT_RULES, REPORT_TESTS };

const RULES = new Map(REPORT_RULES.map((r) => [r.id, r]));
const TESTS = new Map(REPORT_TESTS.map((t) => [t.id, t]));

export const reportRule = (id: string): ReportRule | undefined => RULES.get(id);
export const reportTest = (id: string): ReportTest | undefined => TESTS.get(id);

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
  for (const id of ids) for (const c of clausesOf(RULES.get(id) ?? { basis: '' })) if (!out.includes(c)) out.push(c);
  return out;
}

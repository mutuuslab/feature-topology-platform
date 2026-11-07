// 적용 지역 코드 ↔ 시장·국가 대응 표(B7 (b), FR-CRC-001-002·003, FR-GLB-001-001).
// 코드와 지역 이름은 HMG 제공 자료(생산 지역 K · 적용 지역 1 표기 그림, 2026-10-25 검토 자료 image-04)를 따른다. 시장(MARKETS)·국가 대응은 플랫폼이 정한 표다:
// 국가는 데이터셋 country 값(KR·EU·US·CA·ME·AU …)과 같은 표기, 플랫폼 시장 구분에 없는 지역(일반·중동·러시아·터키·인니)은 OTHER.
// Variant Rule은 독립 엔티티를 만들지 않는다(B7 (b)) — 기존 Variant 조건(국가·차종·트림·UPG-VC)과 26580 구성 규칙(상품 구성)으로 대응한다(30-95 §4.2, 확인 필요).
import { MARKETS, type Market } from '../schemas/wire';

export const REGION_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'G'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export interface RegionCodeRow {
  code: RegionCode;
  nameKo: string;
  /** 플랫폼 시장 구분 — 컴플라이언스 룰 적용 지역(markets)과 맞춘다 */
  market: Market;
  /** 이 코드가 덮는 국가(Feature country 표기). 일반 사양은 국가를 정하지 않는다 */
  countries: string[];
}

export const REGION_CODE_TABLE: readonly RegionCodeRow[] = [
  { code: '1', nameKo: '한국', market: 'KR', countries: ['KR'] },
  { code: '2', nameKo: '일반', market: 'OTHER', countries: [] },
  { code: '3', nameKo: '중동', market: 'OTHER', countries: ['ME'] },
  { code: '4', nameKo: '유럽', market: 'EU', countries: ['EU'] },
  { code: '5', nameKo: '호주', market: 'AU', countries: ['AU'] },
  { code: '6', nameKo: '캐나다', market: 'CA', countries: ['CA'] },
  { code: '7', nameKo: '미국', market: 'US', countries: ['US'] },
  { code: '8', nameKo: '중국', market: 'CN', countries: ['CN'] },
  { code: '9', nameKo: '러시아', market: 'OTHER', countries: ['RU'] },
  { code: 'A', nameKo: '인도', market: 'IN', countries: ['IN'] },
  { code: 'B', nameKo: '브라질', market: 'BR', countries: ['BR'] },
  { code: 'C', nameKo: '멕시코', market: 'MX', countries: ['MX'] },
  { code: 'D', nameKo: '터키', market: 'OTHER', countries: ['TR'] },
  { code: 'G', nameKo: '인니', market: 'OTHER', countries: ['ID'] },
];
const BY_CODE = new Map(REGION_CODE_TABLE.map((r) => [r.code as string, r]));
export const regionCodeRow = (code: string) => BY_CODE.get(code);
export const isRegionCode = (code: string): code is RegionCode => BY_CODE.has(code);
export const regionCodeLabel = (code: string) => (BY_CODE.get(code) ? `${code} · ${BY_CODE.get(code)!.nameKo}` : code);
const LIST = '1~9·A~D·G';

/** 코드 형식·중복 — 목록 밖이면 사유 */
export function regionCodeFormatIssues(codes: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    if (!isRegionCode(c)) out.push(`적용 지역 코드 '${c}'는 코드 체계에 없습니다 — ${LIST} 중 하나를 고르세요.`);
    else if (seen.has(c)) out.push(`적용 지역 코드 ${c}를 두 번 넣었습니다.`);
    seen.add(c);
  }
  return out;
}

/** 룰 등록 검증 — 코드 체계 + 코드의 시장이 적용 지역(시장)에 있어야 한다 @req FR-CRC-001-002 */
export function regionCodeIssues(codes: readonly string[], markets: readonly string[]): string[] {
  const format = regionCodeFormatIssues(codes);
  if (format.length) return format;
  return codes
    .map((c) => BY_CODE.get(c)!)
    .filter((r) => !markets.includes(r.market))
    .map((r) => `적용 지역 코드 ${r.code}(${r.nameKo})는 시장 ${r.market}에 해당합니다 — 적용 지역(시장)에 ${r.market}를 함께 고르세요.`);
}

/** 코드 묶음의 국가(정렬·중복 제거) */
export const regionCodeCountries = (codes: readonly string[]) => [...new Set(codes.flatMap((c) => BY_CODE.get(c)?.countries ?? []))].sort();
/** 국가 → 그 국가를 덮는 코드 */
export const regionCodesOfCountry = (country: string) => REGION_CODE_TABLE.filter((r) => r.countries.includes(country)).map((r) => r.code);
/** 시장 → 코드(시장 구분 화면 표시용) */
export const regionCodesOfMarket = (m: Market) => REGION_CODE_TABLE.filter((r) => r.market === m).map((r) => r.code);
export const REGION_MARKETS: readonly Market[] = MARKETS;

export interface VariantRuleFeatureInput {
  featureId: string;
  version: string;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string[];
  lifecycle: string;
}
export interface VariantRuleProductInput {
  catalogId: string;
  version: string;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  type: string;
  lifecycle: string;
  /** 구성에 든 Feature ID */
  features: string[];
}
/** 기존 Variant 조건 — 국가·차종·트림·UPG-VC 묶음과 그 조건을 쓰는 Feature */
export interface VariantConditionCandidate {
  key: string;
  source: 'VARIANT_CONDITION';
  country: string;
  vehicleModel: string;
  trim: string;
  upgVc: string[];
  regionCodes: string[];
  featureIds: string[];
}
/** 26580 구성 규칙 — 상품(bill-of-features) 구성의 시장 범위 */
export interface CompositionRuleCandidate extends VariantRuleProductInput {
  source: 'COMPOSITION_RULE';
  regionCodes: string[];
}

/**
 * 지역 코드 기준 Variant Rule 후보(FR-CRC-001-003) — 코드 국가를 조건에 포함하는 Variant 조건과 26580 구성 규칙.
 * 폐기(RETIRED) Feature·상품은 후보에서 뺀다. 일반(2)처럼 국가가 없는 코드는 후보가 없다.
 */
export function variantRuleCandidates(codes: readonly string[], features: readonly VariantRuleFeatureInput[], products: readonly VariantRuleProductInput[]) {
  const countries = regionCodeCountries(codes.filter(isRegionCode));
  const inScope = (country: string) => countries.includes(country);
  const codesOf = (country: string) => codes.filter((c) => BY_CODE.get(c)?.countries.includes(country));
  const groups = new Map<string, VariantConditionCandidate>();
  for (const f of features) {
    if (!inScope(f.country) || f.lifecycle === 'RETIRED') continue;
    const upg = [...f.upgVc].sort();
    const key = [f.country, f.vehicleModel, f.trim, upg.join('+')].join('/');
    const g = groups.get(key) ?? { key, source: 'VARIANT_CONDITION' as const, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, upgVc: upg, regionCodes: codesOf(f.country), featureIds: [] };
    if (!g.featureIds.includes(f.featureId)) g.featureIds.push(f.featureId);
    groups.set(key, g);
  }
  const variantConditions = [...groups.values()].map((g) => ({ ...g, featureIds: g.featureIds.sort() })).sort((a, b) => a.key.localeCompare(b.key));
  const compositions: CompositionRuleCandidate[] = products
    .filter((p) => inScope(p.country) && p.lifecycle !== 'RETIRED')
    .map((p) => ({ ...p, source: 'COMPOSITION_RULE' as const, regionCodes: codesOf(p.country) }))
    .sort((a, b) => a.catalogId.localeCompare(b.catalogId) || a.version.localeCompare(b.version));
  return { codes: codes.filter(isRegionCode), countries, variantConditions, compositions };
}

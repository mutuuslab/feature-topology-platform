import { localizedCopy } from '../locale/runtime';
// 분류 수준 L0~L5 이름 — Feature 목록·상세 탭 이름·등록 칸이 쓰는 작은 문구(첫 화면 묶음용). 나머지 분류 계층 문구는 taxonomy-levels.ts
import type { TaxonomyLevelCode } from '../../../contracts/src/schemas/taxonomy-level';
import { regionCodeRow } from '../../../contracts/src/rules/region-code';
import type { Brand } from '../../../contracts/src/schemas/global-scope';

export const LEVEL_KO: Record<TaxonomyLevelCode, string> = /* @__PURE__ */ localizedCopy('taxonomy-level-names.LEVEL_KO', {
  L0: '도메인·역량',
  L1: '고객·사업 기능',
  L2: '차량·시스템 기능',
  L3: '소프트웨어 기능',
  L4: '정책·Flag·파라미터',
  L5: '코드·신호·로직',
});

// Only declared contract captions pass through this display adapter; stored codes stay canonical.
export const taxonomyContractLabels = /* @__PURE__ */ localizedCopy('taxonomy-level-names.taxonomyContractLabels', {
  brands: { HYUNDAI: '현대', KIA: '기아', GENESIS: '제네시스' },
  regions: { '1': '한국', '2': '일반', '3': '중동', '4': '유럽', '5': '호주', '6': '캐나다', '7': '미국', '8': '중국', '9': '러시아', A: '인도', B: '브라질', C: '멕시코', D: '터키', G: '인니' },
});
export const brandDisplayName = (brand: Brand) => taxonomyContractLabels.brands[brand];
export const regionDisplayName = (code: string) => regionCodeRow(code) ? taxonomyContractLabels.regions[code as keyof typeof taxonomyContractLabels.regions] : code;
export const regionCodeDisplayLabel = (code: string) => regionCodeRow(code) ? `${code} · ${regionDisplayName(code)}` : code;

export const taxonomyLevelNames = /* @__PURE__ */ localizedCopy('taxonomy-level-names.taxonomyLevelNames', {
  levels: Object.keys(LEVEL_KO) as TaxonomyLevelCode[],
  levelName: (l: TaxonomyLevelCode) => `${l} ${LEVEL_KO[l]}`,
  tab: '분류 경로',
  list: { level: '분류 수준' },
  propose: { level: '분류 수준', levelHint: 'Feature Master는 보통 L2(차량·시스템 기능)입니다', levelWhy: '분류 수준을 고르세요', choose: '고르세요' },
});

// 분류 수준 L0~L5 이름 — Feature 목록·상세 탭 이름·등록 칸이 쓰는 작은 문구(첫 화면 묶음용). 나머지 분류 계층 문구는 taxonomy-levels.ts
import type { TaxonomyLevelCode } from '../../../contracts/src/schemas/taxonomy-level';

export const LEVEL_KO: Record<TaxonomyLevelCode, string> = {
  L0: '도메인·역량',
  L1: '고객·사업 기능',
  L2: '차량·시스템 기능',
  L3: '소프트웨어 기능',
  L4: '정책·Flag·파라미터',
  L5: '코드·신호·로직',
};

export const taxonomyLevelNames = {
  levels: Object.keys(LEVEL_KO) as TaxonomyLevelCode[],
  levelName: (l: TaxonomyLevelCode) => `${l} ${LEVEL_KO[l]}`,
  tab: '분류 경로',
  list: { level: '분류 수준' },
  propose: { level: '분류 수준', levelHint: 'Feature Master는 보통 L2(차량·시스템 기능)입니다', levelWhy: '분류 수준을 고르세요', choose: '고르세요' },
};

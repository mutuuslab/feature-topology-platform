import { localizedCopy } from '../locale/runtime';
// Feature DB 목록 탐색판 — 왼쪽 분류·출처 트리, 오른쪽 다중 선택 필터, 위 요약 수치
import type { RefExploreAxis } from '@ff/contracts';

export const refExplorer = /* @__PURE__ */ localizedCopy('ref-explorer.refExplorer', {
  title: 'Feature DB 기준 행 탐색',
  treeTaxonomy: '분류 — 도메인 › 컴포넌트',
  treeSources: '근거 출처',
  allRows: '전체 기준 행',
  axis: {
    asilRep: '대표 ASIL',
    lifecycle: '수명주기',
    swStack: 'SW 계층',
    tshirt: 'T-shirt 규모',
    vehicleType: '차종 구분',
    region: '적용 지역',
  } satisfies Record<RefExploreAxis, string>,
  value: {
    lifecycle: { Commodity: '공통 기능', Differentiating: '차별화', Innovation: '혁신' } as Record<string, string>,
    swStack: { Application: '응용', Platform: '플랫폼', 'Back-end': '백엔드' } as Record<string, string>,
  } as Partial<Record<RefExploreAxis, Record<string, string>>>,
  m: {
    rows: '조건에 맞는 기준 행',
    rowsHint: (all: number) => `전체 ${all.toLocaleString('ko-KR')}행 중`,
    scope: '도메인 · 컴포넌트',
    sources: '근거 출처',
    sourcesHint: '중복 없이 센 출처',
    asilCD: 'ASIL C·D',
    gradeD: '규모 근거 D 등급',
    review: '검토 중',
    share: (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : '—'),
  },
  loading: '전체 기준 행 확인 중',
});

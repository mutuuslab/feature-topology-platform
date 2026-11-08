import { localizedCopy } from '../locale/runtime';
// 목록 탐색판(왼쪽 트리 · 가운데 표 · 오른쪽 다중 선택 필터) 공통 문구
export const workbook = /* @__PURE__ */ localizedCopy('workbook.workbook', {
  tree: '분류·출처',
  treeToggle: (label: string, open: boolean) => `${label} ${open ? '닫기' : '열기'}`,
  all: '전체',
  filters: '조건 고르기',
  filtersToggle: (open: boolean, n: number) => `${open ? '조건 닫기' : '조건 고르기'}${n ? ` · ${n}개 적용` : ''}`,
  filtersHint: '같은 항목 안에서는 하나라도 맞으면, 항목끼리는 모두 맞는 행을 보입니다.',
  clearAxis: '해제',
  clearAll: '조건 모두 지우기',
  applied: '적용한 조건',
  removeChip: (axis: string, value: string) => `${axis} ${value} 조건 빼기`,
  chip: (axis: string, value: string, n: number | undefined) => `${axis} ${value}${n === undefined ? '' : ` ${n.toLocaleString('ko-KR')}건`}`,
  treeItem: (name: string, n: number | undefined) => `${name}${n === undefined ? '' : ` ${n.toLocaleString('ko-KR')}건`}`,
  metrics: '지금 조건의 요약',
  tableHint: '좁은 화면에서는 표 안을 좌우로 이동해 모든 열을 확인하세요.',
  more: (n: number) => `${n}개 더 보기`, less: '접기',
});

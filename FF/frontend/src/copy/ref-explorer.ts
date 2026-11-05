export const refExplorer = {
  title: '데이터 조건 탐색',
  asil: 'ASIL 다중 선택',
  status: '상태 다중 선택',
  all: '전체',
  clear: '다중 조건 지우기',
  hint: '같은 항목의 선택은 합집합, 서로 다른 항목은 교집합으로 조회합니다. 조건을 바꾸면 첫 페이지로 이동합니다.',
  count: (n: number) => `조건에 맞는 기준 행 ${n.toLocaleString('ko-KR')}건`,
  loading: '전체 기준 행 확인 중',
};

// 개발비 산정 목록 탐색판 — 왼쪽 분류·계수 표 트리, 오른쪽 다중 선택 필터, 위 요약 수치(과제에 담은 Feature·Feature DB 기준 행에서 모은 값)
export const costExplorer = {
  title: '산정 과제 탐색',
  tree: '분류·계수 표',
  treeTaxonomy: '담은 기능 분류 — 도메인 › 컴포넌트',
  treeBasis: '계수·단가 표 버전',
  allProjects: '전체 과제',
  axis: { status: '진행 상태', countries: '국가', vehicleModels: '차종', asils: 'ASIL', tshirts: 'T-shirt 규모' },
  m: {
    projects: '조건에 맞는 과제',
    projectsHint: (all: number) => `전체 ${all.toLocaleString('ko-KR')}건 중`,
    approved: '승인된 과제',
    approvedCost: '승인 과제 개발비 합계',
    approvedMm: '승인 과제 공수 합계',
    unitCost: '백만원',
    unitMm: 'M/M',
    allMm: '전체 산정 공수',
    features: '담은 Feature',
    featuresHint: '과제마다 센 수의 합',
    stale: '새 계수 표 있음',
  },
};

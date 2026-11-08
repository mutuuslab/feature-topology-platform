export const departmentNavigation = {
  dashboards: '대시보드', departmentBoard: '부서 공통 대시보드', roleBoard: '역할 기본 대시보드', work: '업무 건·산출물',
  categories: {
    feature: 'Feature 기획·정의', configuration: '구성·의존 관계', master: '기준정보 관리',
    cost: '개발비 산정', supplier: '협력사 납품·검수', verification: '검증·판정',
    release: '정책·배포', product: '상품·고객 권리', monitoring: '운영·안전 점검',
    analysis: '데이터 분석·개선', consultation: '검토·협의', integration: '외부 연계',
    assurance: '감사·근거', settings: '설정·접근 관리',
    trace: '요구·설계 추적', privacy: '개인정보 처리·보호', security: '키·인증서·보안 관리',
    production: '현장·출하 업무', data: '운영 데이터 수집',
  },
} as const;

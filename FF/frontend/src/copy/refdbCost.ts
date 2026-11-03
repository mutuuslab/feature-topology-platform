// Feature DB(기준정보)와 SW 개발비 산정(상품·출시) 문구 — 설계 docs/30-data-model/30-95 · docs/20-architecture/20-94.
// 지금은 메뉴와 준비 중 화면만 있다(2026-11-04 사용자 결정 "메뉴만").
export const featureDb = {
  title: 'Feature DB',
  lead: '기능 정의·규모·근거의 기준 행입니다. Feature를 등록할 때 골라 이름·ASIL·분류를 채웁니다.',
  status: '준비 중',
  statusText: '기능은 다음 단계에서 엽니다',
  planTitle: '열릴 기능',
  plan: [
    '엑셀 Feature DB v1.3의 1,052개 기준 행을 옮겨 검색·필터로 찾기',
    'Feature 등록 때 기준 행 연결(대표 1개 + 포함 행)과 값 미리 채우기',
    '기준 행 변경 요청 → 도메인 검토 → 관리자 승인 → 버전 발행',
    '도메인 10개 · 컴포넌트 69개 분류와 출처·사내 용어',
  ],
  docTitle: '설계 문서',
  doc: 'docs/30-data-model/30-95-feature-reference-db.md',
};

export const swCost = {
  title: 'SW 개발비 산정',
  lead: '산정 과제에 Feature를 담아 공수와 개발비를 계산합니다. 금액은 구매 담당 역할만 봅니다.',
  status: '준비 중',
  statusText: '기능은 다음 단계에서 엽니다',
  planTitle: '열릴 기능',
  plan: [
    '산정 과제 만들기와 Feature 담기',
    'T-shirt · MBD 복잡도 · 직접 입력 경로와 ASIL · 재사용 · 변형 · 프로젝트 계수',
    'PERT 3점 추정, P50 · P80 · P90, 공통 인력 · 제경비 · 기술료 · 예비비',
    '산정 승인, 검토 체크리스트, 엑셀 내보내기',
  ],
  docTitle: '설계 문서',
  doc: 'docs/20-architecture/20-94-cost-estimation.md',
};

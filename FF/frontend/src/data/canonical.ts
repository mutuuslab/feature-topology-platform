// 정본 상세 영역(UIxx-S0n) 표 — 기준 패키지의 화면·영역 정의에서 뽑은 **영역 이름과 성격**만 담는다.
// 화면 본문은 이 표를 탭 목록으로 쓰고, 각 영역의 실제 데이터·동작은 페이지가 소유한다.
// 제품에는 요구사양 문서를 두지 않으므로 여기에는 영역 이름·유형 외의 문서 서술을 넣지 않는다.
export interface CanonArea {
  id: string;
  name: string;
  /** 영역 성격 — 탭 툴팁에 쓴다 */
  type: string;
}

export const CANON_AREAS: Record<string, CanonArea[]> = {
  UI19: [
    { id: 'UI19-S01', name: '제안 목록과 단계', type: '목록 · 상세' },
    { id: 'UI19-S02', name: '고객 가치와 근거', type: '입력' },
    { id: 'UI19-S03', name: '기술 검토와 적용 후보', type: '판정' },
    { id: 'UI19-S04', name: '협의와 개발 이관', type: '연계 · ACK' },
    { id: 'UI19-S05', name: 'Feature 전환과 추적', type: '전환' },
    { id: 'UI19-S06', name: '검토와 변경 이력', type: '이력' },
  ],
  UI28: [
    { id: 'UI28-S01', name: '변경요청 목록과 사유', type: '목록 · 상세' },
    { id: 'UI28-S02', name: 'Revision과 정책 차이', type: '비교' },
    { id: 'UI28-S03', name: '변경 영향과 대상', type: '영향' },
    { id: 'UI28-S04', name: '검증 및 재승인', type: '승인' },
    { id: 'UI28-S05', name: '원천 반영과 후속 작업', type: '연계' },
    { id: 'UI28-S06', name: '감사와 완료 근거', type: '이력' },
  ],
  UI07: [
    { id: 'UI07-S01', name: '상품 목록과 기준정보', type: '목록 · 상세' },
    { id: 'UI07-S02', name: 'OfferingItem과 Feature 구성', type: '구성' },
    { id: 'UI07-S03', name: '상품 적용조건', type: '조건' },
    { id: 'UI07-S04', name: '의존 충돌과 등록 검증', type: '검증' },
    { id: 'UI07-S05', name: '판매와 사용 권리 연결', type: '권리' },
    { id: 'UI07-S06', name: '검토 승인과 출시 사용처', type: '승인' },
  ],
  UI21: [
    { id: 'UI21-S01', name: 'UPG와 VC 목록', type: '목록 · 상세' },
    { id: 'UI21-S02', name: '식별과 구성 기준', type: '구성' },
    { id: 'UI21-S03', name: '국가와 차량 코드 연결', type: '연결' },
    { id: 'UI21-S04', name: '조건과 구현 연결', type: '조건' },
    { id: 'UI21-S05', name: '원천 요청과 동기화', type: '연계' },
    { id: 'UI21-S06', name: '변경 검토와 이력', type: '이력' },
  ],
  UI22: [
    { id: 'UI22-S01', name: 'Structure 목록과 버전', type: '목록 · 상세' },
    { id: 'UI22-S02', name: '구성원과 계층 편집', type: '편집' },
    { id: 'UI22-S03', name: '조건과 호환성', type: '조건' },
    { id: 'UI22-S04', name: '구현 및 BOM 사용처', type: '영향' },
    { id: 'UI22-S05', name: '검토 발행과 원천 대사', type: '승인' },
    { id: 'UI22-S06', name: '변경 이력과 SW EO', type: '이력' },
  ],
  UI23: [
    { id: 'UI23-S01', name: '변경요청 목록', type: '목록 · 상세' },
    { id: 'UI23-S02', name: 'New Old 구성 비교', type: '비교' },
    { id: 'UI23-S03', name: 'Main A B 변경 내용', type: '근거' },
    { id: 'UI23-S04', name: '검토와 발행 요청', type: '승인' },
    { id: 'UI23-S05', name: 'BOM 반영 대사', type: '대사' },
    { id: 'UI23-S06', name: '이력과 재처리', type: '이력' },
  ],
  UI24: [
    { id: 'UI24-S01', name: '사양 목록과 Revision', type: '목록 · 상세' },
    { id: 'UI24-S02', name: 'HW와 기능 지원', type: '구성' },
    { id: 'UI24-S03', name: '국가 차종과 Trim', type: '조건' },
    { id: 'UI24-S04', name: 'Variant 조건행', type: '조건' },
    { id: 'UI24-S05', name: 'UPG VC와 적용 매핑', type: '연결' },
    { id: 'UI24-S06', name: '검증 승인과 원천 이력', type: '승인' },
  ],
  UI26: [
    { id: 'UI26-S01', name: '연계 작업 목록', type: '목록 · 상세' },
    { id: 'UI26-S02', name: '요청 결과와 오류', type: '결과' },
    { id: 'UI26-S03', name: '재처리 판단', type: '판정' },
    { id: 'UI26-S04', name: 'Capture와 원천 대사', type: '대사' },
    { id: 'UI26-S05', name: '취소 격리와 인계', type: '인계' },
    { id: 'UI26-S06', name: '작업 감사와 증적', type: '이력' },
  ],
  UI30: [
    { id: 'UI30-S01', name: '요구 원문과 검색', type: '목록 · 상세' },
    { id: 'UI30-S02', name: '설계와 화면 추적', type: '추적' },
    { id: 'UI30-S03', name: '속성과 관계 사전', type: '사전' },
    { id: 'UI30-S04', name: 'Unleash 반영과 호환성', type: '연계' },
    { id: 'UI30-S05', name: 'GAP 결정과 Backlog', type: '판정' },
    { id: 'UI30-S06', name: '추적 내보내기와 버전', type: '내보내기' },
  ],
};

export const areasOf = (screenId: string): CanonArea[] => CANON_AREAS[screenId] || [];

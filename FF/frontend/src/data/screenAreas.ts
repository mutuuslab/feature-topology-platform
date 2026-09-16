// 정본 화면 · 상세 영역 표 — AUTO-GENERATED. 직접 고치지 않는다.
//
// 생성기: FF/frontend/scripts/gen_screen_areas.py
// 원천: FP_UI_Menu_Map_v1_3.html 의 window.FP_SCREEN_DESIGN
// 기준: FP-DETAILED-1.1 · 2026-09-13 · 화면 30개 · 상세 영역 186개
//
// 이 표는 기준 패키지가 정의한 **화면 ID·화면 이름·상세 영역 ID·영역 이름·영역 성격**만 담는다.
// 영역의 작업 문장·인수 조건·요구사양 서술은 제품에 옮기지 않는다(제품 화면은 구현만 보여준다).

export interface ScreenAreaCanon {
  /** 상세 영역 ID (예: UI02-S01) */
  id: string;
  /** 정본 상세 영역 이름 */
  name: string;
  /** 영역 성격 코드 (예: table · approval · graph) */
  type: string;
  /** 배치 이름 (예: 목록과 상세 패널) */
  layout: string;
  /** 영역이 다루는 정본 객체 */
  object: string;
}

export interface ScreenCanon {
  /** 기준 화면 ID (UI01~UI30) */
  id: string;
  /** 정본 화면 이름 */
  name: string;
  /** 화면 종류 코드 */
  kind: string;
  /** 담당 역할 키 (SPEC_ROLES) */
  owner: string;
  /** 업무 그룹 ID (SPEC_GROUPS) */
  group: string;
  /** 대표 Plane */
  plane: string;
  /** Plane 소유 Core */
  planeCore: string;
  /** 필수 컬럼 — 목록 영역이 반드시 보여줘야 하는 열 */
  columns: string[];
  /** 업무 Lifecycle 상태 이름 */
  states: string[];
  /** 기본 상세 영역 ID */
  defaultArea: string;
  areas: ScreenAreaCanon[];
}

export const SCREEN_CANON: ScreenCanon[] = [
  {
    id: "UI01", name: "내 업무와 진행 현황", kind: "home",
    owner: "전체", group: "work",
    plane: "Governance+Monitoring", planeCore: "C37 현장 지원 포털",
    columns: ["기한", "업무", "대상과 버전", "진행 단계", "담당자", "막힌 이유"],
    states: ["배정 대기", "진행 중", "보완 요청", "지연", "완료"],
    defaultArea: "UI01-S01",
    areas: [
      { id: "UI01-S01", name: "내 업무 요약", type: "dashboard", layout: "업무 지표와 역조회", object: "WorkItem" },
      { id: "UI01-S02", name: "검토 대기", type: "approval", layout: "검토함과 승인 판단", object: "WorkItem" },
      { id: "UI01-S03", name: "협의와 수신 확인", type: "timeline", layout: "요청과 결과 타임라인", object: "WorkItem" },
      { id: "UI01-S04", name: "운영 인계와 미확인 차량", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "WorkItem" },
      { id: "UI01-S05", name: "알림과 저장한 보기", type: "dashboard", layout: "업무 지표와 역조회", object: "WorkItem" },
    ],
  },
  {
    id: "UI02", name: "Feature Registry", kind: "feature",
    owner: "author", group: "feature",
    plane: "Control", planeCore: "C01 Feature Registry",
    columns: ["Feature ID", "이름", "버전", "도메인", "상태", "담당자", "수정 시각"],
    states: ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "RETIRED"],
    defaultArea: "UI02-S01",
    areas: [
      { id: "UI02-S01", name: "기본정보와 책임", type: "form", layout: "단계형 입력과 상세", object: "FeatureVersion" },
      { id: "UI02-S02", name: "적용조건", type: "conditions", layout: "조건행과 검증 결과", object: "FeatureVersion" },
      { id: "UI02-S03", name: "관계와 원천", type: "graph", layout: "관계 그래프와 속성 패널", object: "FeatureVersion" },
      { id: "UI02-S04", name: "구현과 제어", type: "binding", layout: "구현 배치와 연결 표", object: "FeatureVersion" },
      { id: "UI02-S05", name: "품질과 제한", type: "evidence", layout: "증적 목록과 유효성", object: "FeatureVersion" },
      { id: "UI02-S06", name: "상품과 운영 연결", type: "links", layout: "객체 사용처와 이동", object: "FeatureVersion" },
      { id: "UI02-S07", name: "변경 및 승인 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "FeatureVersion" },
    ],
  },
  {
    id: "UI03", name: "Feature별 구현 구성", kind: "implementation",
    owner: "author", group: "config",
    plane: "Control", planeCore: "C03 Feature BOM · 구성·의존관계 관리",
    columns: ["구현 구성 ID", "Feature 버전", "Artifact 수", "SW Structure", "배치 노드", "검사 결과"],
    states: ["DRAFT", "INVALID", "VALIDATED", "APPROVED"],
    defaultArea: "UI03-S01",
    areas: [
      { id: "UI03-S01", name: "구현 구성 목록과 버전", type: "table", layout: "목록과 상세 패널", object: "ImplementationBOM" },
      { id: "UI03-S02", name: "SW HW와 Artifact 구성", type: "table", layout: "목록과 상세 패널", object: "ImplementationBOM" },
      { id: "UI03-S03", name: "UPG VC와 조건별 구현", type: "conditions", layout: "조건행과 검증 결과", object: "ImplementationBOM" },
      { id: "UI03-S04", name: "배치와 서비스 연결", type: "binding", layout: "구현 배치와 연결 표", object: "ImplementationBOM" },
      { id: "UI03-S05", name: "SDK와 ControlPoint 연결", type: "binding", layout: "구현 배치와 연결 표", object: "ImplementationBOM" },
      { id: "UI03-S06", name: "검증과 BOM 사용처", type: "evidence", layout: "증적 목록과 유효성", object: "ImplementationBOM" },
    ],
  },
  {
    id: "UI04", name: "Feature BOM 기준선", kind: "bom",
    owner: "author", group: "config",
    plane: "Control", planeCore: "C03 Feature BOM · 구성·의존관계 관리",
    columns: ["BOM ID", "버전", "Feature 수", "구성 Hash", "검사", "승인", "이전 기준선"],
    states: ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REVOKED"],
    defaultArea: "UI04-S01",
    areas: [
      { id: "UI04-S01", name: "기준선 목록과 상세", type: "table", layout: "목록과 상세 패널", object: "BOMBaseline" },
      { id: "UI04-S02", name: "Feature 구성원", type: "members", layout: "구성 계층과 멤버 표", object: "BOMBaseline" },
      { id: "UI04-S03", name: "구현 구성과 11개 영역", type: "members", layout: "구성 계층과 멤버 표", object: "BOMBaseline" },
      { id: "UI04-S04", name: "Master Configured Effective BOM", type: "diff", layout: "이전과 이후 비교", object: "BOMBaseline" },
      { id: "UI04-S05", name: "조건과 Topology 검증", type: "conditions", layout: "조건행과 검증 결과", object: "BOMBaseline" },
      { id: "UI04-S06", name: "기준선 승인과 이력", type: "approval", layout: "검토함과 승인 판단", object: "BOMBaseline" },
    ],
  },
  {
    id: "UI05", name: "Topology와 변경 영향", kind: "topology",
    owner: "author", group: "config",
    plane: "Control", planeCore: "C14 Feature Topology · Capability 평가",
    columns: ["Source", "관계", "Target", "고정 버전", "기준선", "영향 이유"],
    states: ["DRAFT", "INVALID", "VALIDATED", "STALE"],
    defaultArea: "UI05-S01",
    areas: [
      { id: "UI05-S01", name: "Topology 목록과 Snapshot", type: "graph", layout: "관계 그래프와 속성 패널", object: "TopologySnapshot" },
      { id: "UI05-S02", name: "연결관계 탐색", type: "graph", layout: "관계 그래프와 속성 패널", object: "TopologySnapshot" },
      { id: "UI05-S03", name: "관계 편집과 15종 사전", type: "graph", layout: "관계 그래프와 속성 패널", object: "TopologySnapshot" },
      { id: "UI05-S04", name: "조건과 제약 검증", type: "conditions", layout: "조건행과 검증 결과", object: "TopologySnapshot" },
      { id: "UI05-S05", name: "변경 영향과 경로 비교", type: "diff", layout: "이전과 이후 비교", object: "TopologySnapshot" },
      { id: "UI05-S06", name: "외부 도구와 차량 실행 연결", type: "binding", layout: "구현 배치와 연결 표", object: "TopologySnapshot" },
      { id: "UI05-S07", name: "가져오기와 정합성 이슈", type: "import", layout: "가져오기 단계와 오류 표", object: "TopologySnapshot" },
    ],
  },
  {
    id: "UI06", name: "검토함", kind: "task",
    owner: "approver", group: "work",
    plane: "Quality", planeCore: "C30 품질 기준 검증",
    columns: ["업무 ID", "대상과 Revision", "검토 단계", "기한", "요청자", "배정자", "미충족 기준"],
    states: ["OPEN", "CLAIMED", "RETURNED", "COMPLETED", "SUPERSEDED"],
    defaultArea: "UI06-S01",
    areas: [
      { id: "UI06-S01", name: "검토 요청함", type: "table", layout: "목록과 상세 패널", object: "ChangeSetVersion" },
      { id: "UI06-S02", name: "변경 차이와 영향", type: "diff", layout: "이전과 이후 비교", object: "ChangeSetVersion" },
      { id: "UI06-S03", name: "품질 검토", type: "evidence", layout: "증적 목록과 유효성", object: "ChangeSetVersion" },
      { id: "UI06-S04", name: "운영 승인", type: "approval", layout: "검토함과 승인 판단", object: "ChangeSetVersion" },
      { id: "UI06-S05", name: "보완과 재승인", type: "approval", layout: "검토함과 승인 판단", object: "ChangeSetVersion" },
      { id: "UI06-S06", name: "명령 진행과 승인 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "ChangeSetVersion" },
    ],
  },
  {
    id: "UI07", name: "Catalog 상품 구성", kind: "offer",
    owner: "commerce", group: "release",
    plane: "Control", planeCore: "C02 Feature Catalog",
    columns: ["상품 ID", "상품명", "버전", "BOM 기준선", "시장", "제공 방식", "발행 상태"],
    states: ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "WITHDRAWN"],
    defaultArea: "UI07-S01",
    areas: [
      { id: "UI07-S01", name: "상품 목록과 기준정보", type: "table", layout: "목록과 상세 패널", object: "OfferingVersion" },
      { id: "UI07-S02", name: "OfferingItem과 Feature 구성", type: "members", layout: "구성 계층과 멤버 표", object: "OfferingVersion" },
      { id: "UI07-S03", name: "상품 적용조건", type: "conditions", layout: "조건행과 검증 결과", object: "OfferingVersion" },
      { id: "UI07-S04", name: "의존 충돌과 등록 검증", type: "conditions", layout: "조건행과 검증 결과", object: "OfferingVersion" },
      { id: "UI07-S05", name: "판매와 사용 권리 연결", type: "entitlement", layout: "권리 원장과 유효성", object: "OfferingVersion" },
      { id: "UI07-S06", name: "검토 승인과 출시 사용처", type: "approval", layout: "검토함과 승인 판단", object: "OfferingVersion" },
    ],
  },
  {
    id: "UI08", name: "차량 적용 대상", kind: "target",
    owner: "operator", group: "release",
    plane: "Control", planeCore: "C15 적용 대상 선정 규칙",
    columns: ["차량 ID", "차종", "시장", "구성 일치", "권리", "연결", "선택과 제외 이유"],
    states: ["CANDIDATE", "ELIGIBLE", "INELIGIBLE", "UNKNOWN", "FROZEN"],
    defaultArea: "UI08-S01",
    areas: [
      { id: "UI08-S01", name: "대상 차량 목록", type: "table", layout: "목록과 상세 패널", object: "TargetSnapshot" },
      { id: "UI08-S02", name: "Context와 차량 조건", type: "conditions", layout: "조건행과 검증 결과", object: "TargetSnapshot" },
      { id: "UI08-S03", name: "Segment와 Cohort", type: "policy", layout: "정책 조건과 평가", object: "TargetSnapshot" },
      { id: "UI08-S04", name: "상품과 권리 적합성", type: "entitlement", layout: "권리 원장과 유효성", object: "TargetSnapshot" },
      { id: "UI08-S05", name: "대상 미리보기와 제외 사유", type: "conditions", layout: "조건행과 검증 결과", object: "TargetSnapshot" },
      { id: "UI08-S06", name: "TargetSnapshot 고정", type: "table", layout: "목록과 상세 패널", object: "TargetSnapshot" },
    ],
  },
  {
    id: "UI09", name: "상품 사용 권리", kind: "entitlement",
    owner: "commerce", group: "release",
    plane: "Control", planeCore: "C05 사용 권한 관리",
    columns: ["권리 ID", "차량", "상품 버전", "시작", "종료", "상태", "원천 주문"],
    states: ["ACTIVE", "EXPIRED", "REVOKED", "RECONCILE_PENDING"],
    defaultArea: "UI09-S01",
    areas: [
      { id: "UI09-S01", name: "권리 목록과 상세", type: "table", layout: "목록과 상세 패널", object: "Entitlement" },
      { id: "UI09-S02", name: "권리 부여", type: "entitlement", layout: "권리 원장과 유효성", object: "Entitlement" },
      { id: "UI09-S03", name: "만료와 철회", type: "entitlement", layout: "권리 원장과 유효성", object: "Entitlement" },
      { id: "UI09-S04", name: "중복 권리와 이전", type: "diff", layout: "이전과 이후 비교", object: "Entitlement" },
      { id: "UI09-S05", name: "운영 정책과 적용 연결", type: "entitlement", layout: "권리 원장과 유효성", object: "Entitlement" },
      { id: "UI09-S06", name: "권리 변경 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "Entitlement" },
    ],
  },
  {
    id: "UI10", name: "출시와 차량 적용", kind: "release",
    owner: "operator", group: "release",
    plane: "Control", planeCore: "C46 보안 배포 관리",
    columns: ["작업 ID", "상품 버전", "조치", "대상 수", "승인", "전달", "적용 확인", "현재 담당"],
    states: ["DRAFT", "IN_REVIEW", "APPROVED", "RUNNING", "PAUSED", "COMPLETED", "PARTIAL", "EXPIRED"],
    defaultArea: "UI10-S01",
    areas: [
      { id: "UI10-S01", name: "출시 목록과 기본정보", type: "table", layout: "목록과 상세 패널", object: "ReleaseVersion" },
      { id: "UI10-S02", name: "정책과 전략", type: "policy", layout: "정책 조건과 평가", object: "ReleaseVersion" },
      { id: "UI10-S03", name: "대상과 적용 범위", type: "conditions", layout: "조건행과 검증 결과", object: "ReleaseVersion" },
      { id: "UI10-S04", name: "검증과 운영 승인", type: "approval", layout: "검토함과 승인 판단", object: "ReleaseVersion" },
      { id: "UI10-S05", name: "발행 Manifest와 전달", type: "publication", layout: "발행 구성과 전달 단계", object: "ReleaseVersion" },
      { id: "UI10-S06", name: "Wave와 확대 제어", type: "waves", layout: "단계별 적용 현황", object: "ReleaseVersion" },
      { id: "UI10-S07", name: "결과와 Closed Loop", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "ReleaseVersion" },
      { id: "UI10-S08", name: "중단과 변경 복구", type: "recovery", layout: "대상 선택과 조치 확인", object: "ReleaseVersion" },
    ],
  },
  {
    id: "UI11", name: "차량 운영 현황", kind: "fleet",
    owner: "operator", group: "vehicle",
    plane: "Governance+Monitoring", planeCore: "C23 운영 데이터 수집",
    columns: ["출시", "대상", "확인 성공", "미확인", "불일치", "중지 유지", "최근 집계"],
    states: ["CURRENT", "STALE", "PARTIAL", "NO_DATA"],
    defaultArea: "UI11-S01",
    areas: [
      { id: "UI11-S01", name: "출시별 운영 개요", type: "dashboard", layout: "업무 지표와 역조회", object: "PublicationManifest" },
      { id: "UI11-S02", name: "Wave 진행", type: "waves", layout: "단계별 적용 현황", object: "PublicationManifest" },
      { id: "UI11-S03", name: "차량과 ECU 관측", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "PublicationManifest" },
      { id: "UI11-S04", name: "목표와 실제 차이", type: "diff", layout: "이전과 이후 비교", object: "PublicationManifest" },
      { id: "UI11-S05", name: "운영 지표와 알림", type: "dashboard", layout: "업무 지표와 역조회", object: "PublicationManifest" },
      { id: "UI11-S06", name: "장애와 인계 연결", type: "timeline", layout: "요청과 결과 타임라인", object: "PublicationManifest" },
    ],
  },
  {
    id: "UI12", name: "차량별 적용 상태", kind: "vehicle",
    owner: "operator", group: "vehicle",
    plane: "Vehicle", planeCore: "C16 차량 런타임 실행 모듈",
    columns: ["차량 ID", "요청 상태", "차량 상태", "현재 출시", "보고 시각", "신선도", "중지 사유"],
    states: ["PENDING", "CONFIRMED", "DIVERGED", "UNKNOWN", "BLOCKED"],
    defaultArea: "UI12-S01",
    areas: [
      { id: "UI12-S01", name: "차량 목록과 대상 정보", type: "table", layout: "목록과 상세 패널", object: "NodeObservation" },
      { id: "UI12-S02", name: "목표와 보고 상태", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "NodeObservation" },
      { id: "UI12-S03", name: "ECU와 서비스 구성", type: "binding", layout: "구현 배치와 연결 표", object: "NodeObservation" },
      { id: "UI12-S04", name: "SDK 평가와 결정 이유", type: "policy", layout: "정책 조건과 평가", object: "NodeObservation" },
      { id: "UI12-S05", name: "Guard와 안전 전이", type: "recovery", layout: "대상 선택과 조치 확인", object: "NodeObservation" },
      { id: "UI12-S06", name: "Cache와 SnapshotLease", type: "cache", layout: "런타임과 캐시 상태", object: "NodeObservation" },
      { id: "UI12-S07", name: "보고 신뢰성과 readback", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "NodeObservation" },
      { id: "UI12-S08", name: "이력과 복구 연결", type: "timeline", layout: "요청과 결과 타임라인", object: "NodeObservation" },
    ],
  },
  {
    id: "UI13", name: "장애와 복구", kind: "incident",
    owner: "operator", group: "vehicle",
    plane: "Governance+Monitoring", planeCore: "C49 이상 징후 대응",
    columns: ["장애 ID", "심각도", "Feature", "대상", "진행 상태", "담당자", "중지 미확인"],
    states: ["OPEN", "CONTAINING", "MITIGATED", "RESOLVED", "RECOVERING", "CLOSED"],
    defaultArea: "UI13-S01",
    areas: [
      { id: "UI13-S01", name: "장애 목록과 영향 범위", type: "table", layout: "목록과 상세 패널", object: "Incident" },
      { id: "UI13-S02", name: "긴급 차단 요청", type: "recovery", layout: "대상 선택과 조치 확인", object: "Incident" },
      { id: "UI13-S03", name: "ECU별 조치와 결과", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "Incident" },
      { id: "UI13-S04", name: "복구 조건 검토", type: "recovery", layout: "대상 선택과 조치 확인", object: "Incident" },
      { id: "UI13-S05", name: "선택 복구와 결과 확인", type: "recovery", layout: "대상 선택과 조치 확인", object: "Incident" },
      { id: "UI13-S06", name: "인계와 재발 방지", type: "timeline", layout: "요청과 결과 타임라인", object: "Incident" },
    ],
  },
  {
    id: "UI14", name: "감사와 변경 이력", kind: "audit",
    owner: "viewer", group: "quality",
    plane: "Governance+Monitoring", planeCore: "C12 감사 이력 관리",
    columns: ["시각", "행위자", "작업", "대상 버전", "명령 ID", "결과", "사유"],
    states: ["ACCEPTED", "REJECTED", "COMMITTED", "PENDING"],
    defaultArea: "UI14-S01",
    areas: [
      { id: "UI14-S01", name: "감사 이벤트 검색", type: "table", layout: "목록과 상세 패널", object: "AuditEvent" },
      { id: "UI14-S02", name: "변경 전후 비교", type: "diff", layout: "이전과 이후 비교", object: "AuditEvent" },
      { id: "UI14-S03", name: "명령과 결과 추적", type: "timeline", layout: "요청과 결과 타임라인", object: "AuditEvent" },
      { id: "UI14-S04", name: "승인과 권한 이력", type: "approval", layout: "검토함과 승인 판단", object: "AuditEvent" },
      { id: "UI14-S05", name: "보존과 내보내기", type: "table", layout: "목록과 상세 패널", object: "AuditEvent" },
    ],
  },
  {
    id: "UI15", name: "데이터 가져오기", kind: "import",
    owner: "author", group: "admin",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["행", "객체 종류", "ID", "버전", "검사", "필드 오류", "반영 여부"],
    states: ["UPLOADED", "INVALID", "READY", "STALE", "COMMITTED", "EXPIRED"],
    defaultArea: "UI15-S01",
    areas: [
      { id: "UI15-S01", name: "파일과 원천 선택", type: "import", layout: "가져오기 단계와 오류 표", object: "ImportCandidate" },
      { id: "UI15-S02", name: "Mapping과 버전", type: "import", layout: "가져오기 단계와 오류 표", object: "ImportCandidate" },
      { id: "UI15-S03", name: "Preview와 오류 수정", type: "import", layout: "가져오기 단계와 오류 표", object: "ImportCandidate" },
      { id: "UI15-S04", name: "후보 저장과 원자성", type: "import", layout: "가져오기 단계와 오류 표", object: "ImportCandidate" },
      { id: "UI15-S05", name: "승인 반영과 대사", type: "diff", layout: "이전과 이후 비교", object: "ImportCandidate" },
      { id: "UI15-S06", name: "이력과 재처리", type: "timeline", layout: "요청과 결과 타임라인", object: "ImportCandidate" },
    ],
  },
  {
    id: "UI16", name: "품질 기준과 검증 증적", kind: "evidence",
    owner: "quality", group: "quality",
    plane: "Quality", planeCore: "C30 품질 기준 검증",
    columns: ["증적 ID", "대상 Hash", "시험과 버전", "환경", "결과", "실행 시각", "검토 상태"],
    states: ["PENDING", "VALID", "INVALID", "EXPIRED", "UNKNOWN"],
    defaultArea: "UI16-S01",
    areas: [
      { id: "UI16-S01", name: "품질 Profile과 검증 대상", type: "evidence", layout: "증적 목록과 유효성", object: "QualityAssessment" },
      { id: "UI16-S02", name: "시험과 증적 등록", type: "evidence", layout: "증적 목록과 유효성", object: "QualityAssessment" },
      { id: "UI16-S03", name: "정책과 조건 검증", type: "policy", layout: "정책 조건과 평가", object: "QualityAssessment" },
      { id: "UI16-S04", name: "SDK와 호환성 시험", type: "evidence", layout: "증적 목록과 유효성", object: "QualityAssessment" },
      { id: "UI16-S05", name: "차량 및 안전 검증", type: "evidence", layout: "증적 목록과 유효성", object: "QualityAssessment" },
      { id: "UI16-S06", name: "Docker 실행 결과", type: "evidence", layout: "증적 목록과 유효성", object: "QualityAssessment" },
      { id: "UI16-S07", name: "품질 판정과 승인 연결", type: "approval", layout: "검토함과 승인 판단", object: "QualityAssessment" },
    ],
  },
  {
    id: "UI17", name: "사용자 범위와 권한", kind: "access",
    owner: "integrator", group: "admin",
    plane: "Governance+Monitoring", planeCore: "C11 RBAC",
    columns: ["사용자", "조직", "역할", "범위", "유효기간", "승인자", "상태"],
    states: ["ACTIVE", "PENDING", "EXPIRED", "REVOKED"],
    defaultArea: "UI17-S01",
    areas: [
      { id: "UI17-S01", name: "사용자와 역할", type: "table", layout: "목록과 상세 패널", object: "AccessPolicy" },
      { id: "UI17-S02", name: "범위와 권한", type: "access", layout: "역할과 범위 행렬", object: "AccessPolicy" },
      { id: "UI17-S03", name: "직무 분리와 대행", type: "access", layout: "역할과 범위 행렬", object: "AccessPolicy" },
      { id: "UI17-S04", name: "세션과 SSO 연결", type: "access", layout: "역할과 범위 행렬", object: "AccessPolicy" },
      { id: "UI17-S05", name: "서비스 자격과 키 참조", type: "access", layout: "역할과 범위 행렬", object: "AccessPolicy" },
      { id: "UI17-S06", name: "보존과 감사", type: "timeline", layout: "요청과 결과 타임라인", object: "AccessPolicy" },
    ],
  },
  {
    id: "UI18", name: "외부 시스템 연계", kind: "connector",
    owner: "integrator", group: "admin",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["시스템", "소유 데이터", "방향", "계약", "최근 성공", "상태", "미해결 수"],
    states: ["NOT_CONNECTED", "HEALTHY", "DEGRADED", "AUTH_EXPIRED"],
    defaultArea: "UI18-S01",
    areas: [
      { id: "UI18-S01", name: "연계 시스템 목록", type: "table", layout: "목록과 상세 패널", object: "ToolBinding" },
      { id: "UI18-S02", name: "Unleash 인스턴스", type: "binding", layout: "구현 배치와 연결 표", object: "ToolBinding" },
      { id: "UI18-S03", name: "도구와 Feature 바인딩", type: "binding", layout: "구현 배치와 연결 표", object: "ToolBinding" },
      { id: "UI18-S04", name: "Capture와 동기화 차이", type: "diff", layout: "이전과 이후 비교", object: "ToolBinding" },
      { id: "UI18-S05", name: "Context schema와 원천", type: "conditions", layout: "조건행과 검증 결과", object: "ToolBinding" },
      { id: "UI18-S06", name: "AAOS와 차량 연결", type: "binding", layout: "구현 배치와 연결 표", object: "ToolBinding" },
      { id: "UI18-S07", name: "발행과 관측 인터페이스", type: "publication", layout: "발행 구성과 전달 단계", object: "ToolBinding" },
      { id: "UI18-S08", name: "호환성과 자원 Profile", type: "binding", layout: "구현 배치와 연결 표", object: "ToolBinding" },
      { id: "UI18-S09", name: "연계 설정과 자동화 범위", type: "table", layout: "목록과 상세 패널", object: "ToolBinding" },
    ],
  },
  {
    id: "UI19", name: "Feature 제안", kind: "proposal",
    owner: "author", group: "feature",
    plane: "Control", planeCore: "C01 Feature Registry",
    columns: ["제안 ID", "제목", "신규·변경", "양식", "분류", "단계", "담당 조직", "기한"],
    states: ["DRAFT", "RECEIVED", "REVIEWING", "DECISION", "HANDOFF", "REJECTED"],
    defaultArea: "UI19-S01",
    areas: [
      { id: "UI19-S01", name: "제안 목록과 단계", type: "table", layout: "목록과 상세 패널", object: "FeatureProposal" },
      { id: "UI19-S02", name: "고객 가치와 근거", type: "form", layout: "단계형 입력과 상세", object: "FeatureProposal" },
      { id: "UI19-S03", name: "기술 검토와 적용 후보", type: "conditions", layout: "조건행과 검증 결과", object: "FeatureProposal" },
      { id: "UI19-S04", name: "협의와 개발 이관", type: "timeline", layout: "요청과 결과 타임라인", object: "FeatureProposal" },
      { id: "UI19-S05", name: "Feature 전환과 추적", type: "links", layout: "객체 사용처와 이동", object: "FeatureProposal" },
      { id: "UI19-S06", name: "검토와 변경 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "FeatureProposal" },
    ],
  },
  {
    id: "UI20", name: "SW ID와 버전", kind: "sw",
    owner: "author", group: "config",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["SW ID", "표준명", "버전", "컨트롤러", "원천", "협의 근거", "상태"],
    states: ["DRAFT", "REQUESTED", "APPROVED", "SUPERSEDED"],
    defaultArea: "UI20-S01",
    areas: [
      { id: "UI20-S01", name: "SW 목록과 식별", type: "table", layout: "목록과 상세 패널", object: "SWVersion" },
      { id: "UI20-S02", name: "버전과 Artifact", type: "table", layout: "목록과 상세 패널", object: "SWVersion" },
      { id: "UI20-S03", name: "신규 버전 요청", type: "form", layout: "단계형 입력과 상세", object: "SWVersion" },
      { id: "UI20-S04", name: "구조와 UPG 사용처", type: "graph", layout: "관계 그래프와 속성 패널", object: "SWVersion" },
      { id: "UI20-S05", name: "호환 조건과 증적", type: "evidence", layout: "증적 목록과 유효성", object: "SWVersion" },
      { id: "UI20-S06", name: "변경과 원천 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "SWVersion" },
    ],
  },
  {
    id: "UI21", name: "UPG와 UPG VC", kind: "upg",
    owner: "steward", group: "config",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["UPG", "그룹명", "System", "Component", "차종 UPG", "VC", "승인", "원천"],
    states: ["DRAFT", "IN_REVIEW", "APPROVED", "RETIRED"],
    defaultArea: "UI21-S01",
    areas: [
      { id: "UI21-S01", name: "UPG와 VC 목록", type: "table", layout: "목록과 상세 패널", object: "UPGVCVersion" },
      { id: "UI21-S02", name: "식별과 구성 기준", type: "members", layout: "구성 계층과 멤버 표", object: "UPGVCVersion" },
      { id: "UI21-S03", name: "국가와 차량 코드 연결", type: "conditions", layout: "조건행과 검증 결과", object: "UPGVCVersion" },
      { id: "UI21-S04", name: "조건과 구현 연결", type: "conditions", layout: "조건행과 검증 결과", object: "UPGVCVersion" },
      { id: "UI21-S05", name: "원천 요청과 동기화", type: "timeline", layout: "요청과 결과 타임라인", object: "UPGVCVersion" },
      { id: "UI21-S06", name: "변경 검토와 이력", type: "diff", layout: "이전과 이후 비교", object: "UPGVCVersion" },
    ],
  },
  {
    id: "UI22", name: "SW Structure", kind: "structure",
    owner: "author", group: "config",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["노드", "부모", "SW 정확 버전", "레벨", "수량", "UPG VC", "검사"],
    states: ["DRAFT", "INVALID", "VALIDATED", "FROZEN"],
    defaultArea: "UI22-S01",
    areas: [
      { id: "UI22-S01", name: "Structure 목록과 버전", type: "table", layout: "목록과 상세 패널", object: "SWStructureVersion" },
      { id: "UI22-S02", name: "구성원과 계층 편집", type: "members", layout: "구성 계층과 멤버 표", object: "SWStructureVersion" },
      { id: "UI22-S03", name: "조건과 호환성", type: "conditions", layout: "조건행과 검증 결과", object: "SWStructureVersion" },
      { id: "UI22-S04", name: "구현 및 BOM 사용처", type: "graph", layout: "관계 그래프와 속성 패널", object: "SWStructureVersion" },
      { id: "UI22-S05", name: "검토 발행과 원천 대사", type: "approval", layout: "검토함과 승인 판단", object: "SWStructureVersion" },
      { id: "UI22-S06", name: "변경 이력과 SW EO", type: "diff", layout: "이전과 이후 비교", object: "SWStructureVersion" },
    ],
  },
  {
    id: "UI23", name: "SW EO 변경관리", kind: "eo",
    owner: "steward", group: "config",
    plane: "Control", planeCore: "C32 Legacy 시스템 연계",
    columns: ["EO 요청", "공식 번호", "New·Old 구성", "협조 검토", "발행", "BOM ACK"],
    states: ["DRAFT", "IN_REVIEW", "APPROVED", "ISSUE_PENDING", "ISSUED", "ACK_PENDING", "ACKED"],
    defaultArea: "UI23-S01",
    areas: [
      { id: "UI23-S01", name: "변경요청 목록", type: "table", layout: "목록과 상세 패널", object: "EngineeringOrder" },
      { id: "UI23-S02", name: "New Old 구성 비교", type: "diff", layout: "이전과 이후 비교", object: "EngineeringOrder" },
      { id: "UI23-S03", name: "Main A B 변경 내용", type: "form", layout: "단계형 입력과 상세", object: "EngineeringOrder" },
      { id: "UI23-S04", name: "검토와 발행 요청", type: "approval", layout: "검토함과 승인 판단", object: "EngineeringOrder" },
      { id: "UI23-S05", name: "BOM 반영 대사", type: "diff", layout: "이전과 이후 비교", object: "EngineeringOrder" },
      { id: "UI23-S06", name: "이력과 재처리", type: "timeline", layout: "요청과 결과 타임라인", object: "EngineeringOrder" },
    ],
  },
  {
    id: "UI24", name: "제품사양과 HW Variant", kind: "spec",
    owner: "steward", group: "config",
    plane: "Control", planeCore: "C13 Variant 조건 관리",
    columns: ["사양 ID", "Revision", "차종", "공장", "시장", "옵션 조합", "검사"],
    states: ["DRAFT", "ALLOW", "DENY", "UNKNOWN"],
    defaultArea: "UI24-S01",
    areas: [
      { id: "UI24-S01", name: "사양 목록과 Revision", type: "table", layout: "목록과 상세 패널", object: "VehicleConfiguration" },
      { id: "UI24-S02", name: "HW와 기능 지원", type: "binding", layout: "구현 배치와 연결 표", object: "VehicleConfiguration" },
      { id: "UI24-S03", name: "국가 차종과 Trim", type: "conditions", layout: "조건행과 검증 결과", object: "VehicleConfiguration" },
      { id: "UI24-S04", name: "Variant 조건행", type: "conditions", layout: "조건행과 검증 결과", object: "VehicleConfiguration" },
      { id: "UI24-S05", name: "UPG VC와 적용 매핑", type: "graph", layout: "관계 그래프와 속성 패널", object: "VehicleConfiguration" },
      { id: "UI24-S06", name: "검증 승인과 원천 이력", type: "evidence", layout: "증적 목록과 유효성", object: "VehicleConfiguration" },
    ],
  },
  {
    id: "UI25", name: "협의와 개발 이관", kind: "handoff",
    owner: "coordinator", group: "work",
    plane: "Governance+Monitoring", planeCore: "C37 현장 지원 포털",
    columns: ["이관 ID", "제안과 Feature", "요청 조직", "수신 조직", "기한", "수신 확인", "막힌 이유"],
    states: ["DRAFT", "SENT", "ACCEPTED", "NEEDS_INFO", "OVERDUE", "CLOSED"],
    defaultArea: "UI25-S01",
    areas: [
      { id: "UI25-S01", name: "이관 요청 목록", type: "table", layout: "목록과 상세 패널", object: "HandoverRequest" },
      { id: "UI25-S02", name: "이관 내용과 필수 자료", type: "form", layout: "단계형 입력과 상세", object: "HandoverRequest" },
      { id: "UI25-S03", name: "수신 확인과 배정", type: "timeline", layout: "요청과 결과 타임라인", object: "HandoverRequest" },
      { id: "UI25-S04", name: "보완과 기술 검토", type: "evidence", layout: "증적 목록과 유효성", object: "HandoverRequest" },
      { id: "UI25-S05", name: "완료와 개발 추적", type: "links", layout: "객체 사용처와 이동", object: "HandoverRequest" },
    ],
  },
  {
    id: "UI26", name: "연계 작업과 재처리", kind: "job",
    owner: "integrator", group: "admin",
    plane: "Control", planeCore: "C33 데이터 동기화",
    columns: ["Job ID", "원천", "객체", "현재 단계", "시도 수", "다음 재시도", "오류", "담당"],
    states: ["PENDING", "ACK_WAIT", "RETRY_READY", "DEAD_LETTER", "SUCCEEDED", "CANCELLED"],
    defaultArea: "UI26-S01",
    areas: [
      { id: "UI26-S01", name: "연계 작업 목록", type: "table", layout: "목록과 상세 패널", object: "IntegrationJob" },
      { id: "UI26-S02", name: "요청 결과와 오류", type: "timeline", layout: "요청과 결과 타임라인", object: "IntegrationJob" },
      { id: "UI26-S03", name: "재처리 판단", type: "timeline", layout: "요청과 결과 타임라인", object: "IntegrationJob" },
      { id: "UI26-S04", name: "Capture와 원천 대사", type: "diff", layout: "이전과 이후 비교", object: "IntegrationJob" },
      { id: "UI26-S05", name: "취소 격리와 인계", type: "timeline", layout: "요청과 결과 타임라인", object: "IntegrationJob" },
      { id: "UI26-S06", name: "작업 감사와 증적", type: "timeline", layout: "요청과 결과 타임라인", object: "IntegrationJob" },
    ],
  },
  {
    id: "UI27", name: "운영 인계와 조치", kind: "handover",
    owner: "operator", group: "work",
    plane: "Governance+Monitoring", planeCore: "C37 현장 지원 포털",
    columns: ["인계 ID", "근무 범위", "미종결 장애", "미확인 작업", "수신자", "기한", "수신 상태"],
    states: ["DRAFT", "SENT", "ACKNOWLEDGED", "CLOSED"],
    defaultArea: "UI27-S01",
    areas: [
      { id: "UI27-S01", name: "인계 목록과 근무 범위", type: "table", layout: "목록과 상세 패널", object: "OperationsHandover" },
      { id: "UI27-S02", name: "미확인 차량과 장애", type: "closedloop", layout: "차량과 ECU 상태 대조", object: "OperationsHandover" },
      { id: "UI27-S03", name: "원천 오류와 연계 작업", type: "timeline", layout: "요청과 결과 타임라인", object: "OperationsHandover" },
      { id: "UI27-S04", name: "다음 조치와 수신 확인", type: "timeline", layout: "요청과 결과 타임라인", object: "OperationsHandover" },
      { id: "UI27-S05", name: "조치 완료와 이력", type: "timeline", layout: "요청과 결과 타임라인", object: "OperationsHandover" },
    ],
  },
  {
    id: "UI28", name: "변경요청과 Revision 비교", kind: "change",
    owner: "author", group: "feature",
    plane: "Quality", planeCore: "C43 변경 영향 검증",
    columns: ["CR ID", "변경 대상", "기준 Revision", "새 Revision", "영향", "상태", "담당"],
    states: ["DRAFT", "ASSESSED", "IN_REVIEW", "APPROVED", "IMPLEMENTED", "CLOSED"],
    defaultArea: "UI28-S01",
    areas: [
      { id: "UI28-S01", name: "변경요청 목록과 사유", type: "table", layout: "목록과 상세 패널", object: "ChangeRequest" },
      { id: "UI28-S02", name: "Revision과 정책 차이", type: "diff", layout: "이전과 이후 비교", object: "ChangeRequest" },
      { id: "UI28-S03", name: "변경 영향과 대상", type: "graph", layout: "관계 그래프와 속성 패널", object: "ChangeRequest" },
      { id: "UI28-S04", name: "검증 및 재승인", type: "approval", layout: "검토함과 승인 판단", object: "ChangeRequest" },
      { id: "UI28-S05", name: "원천 반영과 후속 작업", type: "timeline", layout: "요청과 결과 타임라인", object: "ChangeRequest" },
      { id: "UI28-S06", name: "감사와 완료 근거", type: "timeline", layout: "요청과 결과 타임라인", object: "ChangeRequest" },
    ],
  },
  {
    id: "UI29", name: "운영 기준과 지표", kind: "policy",
    owner: "operator", group: "admin",
    plane: "Quality", planeCore: "C30 품질 기준 검증",
    columns: ["Profile", "버전", "적용 대상", "필수 검토", "기간", "승인", "변경 영향"],
    states: ["DRAFT", "APPROVED", "EXPIRED"],
    defaultArea: "UI29-S01",
    areas: [
      { id: "UI29-S01", name: "검토 Profile 기준", type: "approval", layout: "검토함과 승인 판단", object: "OperatingProfile" },
      { id: "UI29-S02", name: "Context와 공통 코드", type: "conditions", layout: "조건행과 검증 결과", object: "OperatingProfile" },
      { id: "UI29-S03", name: "관측과 운영 지표", type: "dashboard", layout: "업무 지표와 역조회", object: "OperatingProfile" },
      { id: "UI29-S04", name: "Runtime 자원과 Cache 기준", type: "cache", layout: "런타임과 캐시 상태", object: "OperatingProfile" },
      { id: "UI29-S05", name: "보존과 감사 기준", type: "access", layout: "역할과 범위 행렬", object: "OperatingProfile" },
      { id: "UI29-S06", name: "운영 자동화와 유지보수", type: "dashboard", layout: "업무 지표와 역조회", object: "OperatingProfile" },
    ],
  },
  {
    id: "UI30", name: "요구사항과 설계 추적", kind: "trace",
    owner: "viewer", group: "quality",
    plane: "Quality", planeCore: "C45 안전 요구사항 추적",
    columns: ["원문 ID", "요구명", "출처", "화면", "설계", "시험 상태", "연결 판정"],
    states: ["SOURCE", "DESIGN_LINKED", "REVIEW_REQUIRED", "TEST_NOT_RUN"],
    defaultArea: "UI30-S01",
    areas: [
      { id: "UI30-S01", name: "요구 원문과 검색", type: "table", layout: "목록과 상세 패널", object: "TraceRecord" },
      { id: "UI30-S02", name: "설계와 화면 추적", type: "trace", layout: "추적성 행렬과 연결 탐색", object: "TraceRecord" },
      { id: "UI30-S03", name: "속성과 관계 사전", type: "dictionary", layout: "속성 사전과 입력 책임", object: "TraceRecord" },
      { id: "UI30-S04", name: "Unleash 반영과 호환성", type: "evidence", layout: "증적 목록과 유효성", object: "TraceRecord" },
      { id: "UI30-S05", name: "GAP 결정과 Backlog", type: "trace", layout: "추적성 행렬과 연결 탐색", object: "TraceRecord" },
      { id: "UI30-S06", name: "추적 내보내기와 버전", type: "trace", layout: "추적성 행렬과 연결 탐색", object: "TraceRecord" },
    ],
  },
];

/** 화면 ID → 정본 화면 */
export const SCREEN_CANON_BY_ID: Record<string, ScreenCanon> =
  Object.fromEntries(SCREEN_CANON.map(s => [s.id, s]));

/** 상세 영역 ID 전체 (정본 순서) */
export const SCREEN_AREA_IDS: string[] = SCREEN_CANON.flatMap(s => s.areas.map(a => a.id));

/** 상세 영역 ID → 영역 + 소속 화면 */
export const SCREEN_AREA_BY_ID: Record<string, ScreenAreaCanon & { screenId: string }> =
  Object.fromEntries(
    SCREEN_CANON.flatMap(s => s.areas.map(a => [a.id, { ...a, screenId: s.id } as ScreenAreaCanon & { screenId: string }])),
  );

/** 정본 상세 영역 총수 (186) */
export const SCREEN_AREA_TOTAL = 186;

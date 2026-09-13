// 자동 생성 파일 — 직접 수정하지 않는다. 생성: gen_planes.py
// 원천: 2026-09-13_산출물/appendices/model/FP_IA_Screen_Design_v1_1.json · planeAssignment
//       (FP_UI_Operations_v3_9.html · window.FP_DESIGN.cores[49] 공식 Plane/Core allocation)

/** 배정 출처 */
export const SPEC_PLANE_SOURCE = "FP_UI_Operations_v3_9.html · window.FP_DESIGN.cores[49] 공식 Plane과 Core allocation에서 도출";

/** 공식 4 Plane (순서 포함) */
export const SPEC_PLANE_NAMES: string[] = ["Control", "Quality", "Governance+Monitoring", "Vehicle"];

/** Plane 은 실행 책임의 구분이다. 업무 메뉴 7그룹은 탐색 구조이며 Plane 이 아니다(AR-04). */
export const SPEC_PLANE_RULE = "Plane은 실행 책임의 구분이다. 업무 메뉴 7그룹은 탐색 구조이며 Plane이 아니다(AR-04). 상세 영역은 소유 Core의 Plane을 따른다.";

/** 검증 → 운영 허가 → Control 발행 → Vehicle 평가·Guard → 실제 보고 */
export const SPEC_PLANE_FLOW = "검증 → 운영 허가 → Control 발행 → Vehicle 평가·Guard → 실제 보고";

/** 공유 기반(Knowledge Foundation) — 4 Plane 에 포함되지 않는다. */
export const SPEC_KNOWLEDGE_FOUNDATION = "공유 식별·정확 버전·관계·원천·추적의 공유 기반이며 다섯 번째 Plane이 아님";

/** Core ID → Plane (49건) */
export const SPEC_CORE_PLANE: Record<string, string> = {
  "C01": "Control",
  "C02": "Control",
  "C03": "Control",
  "C04": "Control",
  "C05": "Control",
  "C06": "Governance+Monitoring",
  "C07": "Quality",
  "C08": "Control",
  "C09": "Control",
  "C10": "Control",
  "C11": "Governance+Monitoring",
  "C12": "Governance+Monitoring",
  "C13": "Control",
  "C14": "Control",
  "C15": "Control",
  "C16": "Vehicle",
  "C17": "Vehicle",
  "C18": "Vehicle",
  "C19": "Quality",
  "C20": "Quality",
  "C21": "Governance+Monitoring",
  "C22": "Governance+Monitoring",
  "C23": "Governance+Monitoring",
  "C24": "Quality",
  "C25": "Governance+Monitoring",
  "C26": "Quality",
  "C27": "Control",
  "C28": "Quality",
  "C29": "Governance+Monitoring",
  "C30": "Quality",
  "C31": "Control",
  "C32": "Control",
  "C33": "Control",
  "C34": "Control",
  "C35": "Control",
  "C36": "Governance+Monitoring",
  "C37": "Governance+Monitoring",
  "C38": "Governance+Monitoring",
  "C39": "Quality",
  "C40": "Quality",
  "C41": "Quality",
  "C42": "Quality",
  "C43": "Quality",
  "C44": "Quality",
  "C45": "Quality",
  "C46": "Control",
  "C47": "Governance+Monitoring",
  "C48": "Governance+Monitoring",
  "C49": "Governance+Monitoring"
};

/** Plane → Core ID 목록 */
export const SPEC_PLANE_CORES: Record<string, string[]> = {
  "Control": [
    "C01",
    "C02",
    "C03",
    "C04",
    "C05",
    "C08",
    "C09",
    "C10",
    "C13",
    "C14",
    "C15",
    "C27",
    "C31",
    "C32",
    "C33",
    "C34",
    "C35",
    "C46"
  ],
  "Governance+Monitoring": [
    "C06",
    "C11",
    "C12",
    "C21",
    "C22",
    "C23",
    "C25",
    "C29",
    "C36",
    "C37",
    "C38",
    "C47",
    "C48",
    "C49"
  ],
  "Quality": [
    "C07",
    "C19",
    "C20",
    "C24",
    "C26",
    "C28",
    "C30",
    "C39",
    "C40",
    "C41",
    "C42",
    "C43",
    "C44",
    "C45"
  ],
  "Vehicle": [
    "C16",
    "C17",
    "C18"
  ]
};

/** Core ID → 표시명 (예: C16 차량 런타임 실행 모듈) */
export const SPEC_CORE_LABEL: Record<string, string> = {
  "C37": "C37 현장 지원 포털",
  "C01": "C01 Feature Registry",
  "C03": "C03 Feature BOM · 구성·의존관계 관리",
  "C14": "C14 Feature Topology · Capability 평가",
  "C30": "C30 품질 기준 검증",
  "C02": "C02 Feature Catalog",
  "C15": "C15 적용 대상 선정 규칙",
  "C05": "C05 사용 권한 관리",
  "C46": "C46 보안 배포 관리",
  "C23": "C23 운영 데이터 수집",
  "C16": "C16 차량 런타임 실행 모듈",
  "C49": "C49 이상 징후 대응",
  "C12": "C12 감사 이력 관리",
  "C32": "C32 Legacy 시스템 연계",
  "C11": "C11 RBAC",
  "C13": "C13 Variant 조건 관리",
  "C33": "C33 데이터 동기화",
  "C43": "C43 변경 영향 검증",
  "C45": "C45 안전 요구사항 추적"
};

/** 기준 화면 ID → Plane (30건). 상세 영역도 소유 Core 의 Plane 을 따른다. */
export const SPEC_SCREEN_PLANE: Record<string, string> = {
  "UI01": "Governance+Monitoring",
  "UI02": "Control",
  "UI03": "Control",
  "UI04": "Control",
  "UI05": "Control",
  "UI06": "Quality",
  "UI07": "Control",
  "UI08": "Control",
  "UI09": "Control",
  "UI10": "Control",
  "UI11": "Governance+Monitoring",
  "UI12": "Vehicle",
  "UI13": "Governance+Monitoring",
  "UI14": "Governance+Monitoring",
  "UI15": "Control",
  "UI16": "Quality",
  "UI17": "Governance+Monitoring",
  "UI18": "Control",
  "UI19": "Control",
  "UI20": "Control",
  "UI21": "Control",
  "UI22": "Control",
  "UI23": "Control",
  "UI24": "Control",
  "UI25": "Governance+Monitoring",
  "UI26": "Control",
  "UI27": "Governance+Monitoring",
  "UI28": "Quality",
  "UI29": "Quality",
  "UI30": "Quality"
};

/** 기준 화면 ID → 소유 Core 표시명 */
export const SPEC_SCREEN_PLANE_CORE: Record<string, string> = {
  "UI01": "C37 현장 지원 포털",
  "UI02": "C01 Feature Registry",
  "UI03": "C03 Feature BOM · 구성·의존관계 관리",
  "UI04": "C03 Feature BOM · 구성·의존관계 관리",
  "UI05": "C14 Feature Topology · Capability 평가",
  "UI06": "C30 품질 기준 검증",
  "UI07": "C02 Feature Catalog",
  "UI08": "C15 적용 대상 선정 규칙",
  "UI09": "C05 사용 권한 관리",
  "UI10": "C46 보안 배포 관리",
  "UI11": "C23 운영 데이터 수집",
  "UI12": "C16 차량 런타임 실행 모듈",
  "UI13": "C49 이상 징후 대응",
  "UI14": "C12 감사 이력 관리",
  "UI15": "C32 Legacy 시스템 연계",
  "UI16": "C30 품질 기준 검증",
  "UI17": "C11 RBAC",
  "UI18": "C32 Legacy 시스템 연계",
  "UI19": "C01 Feature Registry",
  "UI20": "C32 Legacy 시스템 연계",
  "UI21": "C32 Legacy 시스템 연계",
  "UI22": "C32 Legacy 시스템 연계",
  "UI23": "C32 Legacy 시스템 연계",
  "UI24": "C13 Variant 조건 관리",
  "UI25": "C37 현장 지원 포털",
  "UI26": "C33 데이터 동기화",
  "UI27": "C37 현장 지원 포털",
  "UI28": "C43 변경 영향 검증",
  "UI29": "C30 품질 기준 검증",
  "UI30": "C45 안전 요구사항 추적"
};

/** Plane → 기준 화면 ID 목록 */
export const SPEC_PLANE_SCREEN_IDS: Record<string, string[]> = {
  "Control": [
    "UI02",
    "UI03",
    "UI04",
    "UI05",
    "UI07",
    "UI08",
    "UI09",
    "UI10",
    "UI15",
    "UI18",
    "UI19",
    "UI20",
    "UI21",
    "UI22",
    "UI23",
    "UI24",
    "UI26"
  ],
  "Quality": [
    "UI06",
    "UI16",
    "UI28",
    "UI29",
    "UI30"
  ],
  "Governance+Monitoring": [
    "UI01",
    "UI11",
    "UI13",
    "UI14",
    "UI17",
    "UI25",
    "UI27"
  ],
  "Vehicle": [
    "UI12"
  ]
};

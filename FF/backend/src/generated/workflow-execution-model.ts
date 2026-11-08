// 생성 파일 — tools/workflow-sync.ts. 업무 건·산출물 실행 모델.
import type { WorkflowExecutionModel } from '@ff/contracts';
export const WORKFLOW_EXECUTION_MODEL: WorkflowExecutionModel = {
 "roles": [
  {
   "id": "R-FO",
   "name": "Feature Owner",
   "platformRoles": [
    "FEATURE_AUTHOR"
   ]
  },
  {
   "id": "R-REQ",
   "name": "요구 Owner",
   "platformRoles": [
    "FEATURE_APPROVER"
   ]
  },
  {
   "id": "R-SM",
   "name": "Safety Manager",
   "platformRoles": [
    "SAFETY_OFFICER"
   ]
  },
  {
   "id": "R-CSM",
   "name": "CSM",
   "platformRoles": [
    "SECURITY_OFFICER"
   ]
  },
  {
   "id": "R-REG",
   "name": "법규 담당",
   "platformRoles": [
    "REGULATORY_OWNER"
   ]
  },
  {
   "id": "R-TST",
   "name": "시험 조직",
   "platformRoles": [
    "GATE_JUDGE"
   ]
  },
  {
   "id": "R-QA",
   "name": "품질 조직",
   "platformRoles": [
    "GATE_JUDGE",
    "AUDITOR"
   ]
  },
  {
   "id": "R-OPS",
   "name": "운영 조직",
   "platformRoles": [
    "OPERATOR",
    "OPS_LEAD"
   ]
  },
  {
   "id": "R-ARC",
   "name": "아키텍트",
   "platformRoles": [
    "IMPLEMENTER"
   ]
  },
  {
   "id": "R-INT",
   "name": "통합 조직",
   "platformRoles": [
    "IMPLEMENTER"
   ]
  },
  {
   "id": "R-REL",
   "name": "Release Manager",
   "platformRoles": [
    "RELEASE_MANAGER"
   ]
  },
  {
   "id": "R-PUR",
   "name": "구매",
   "platformRoles": []
  },
  {
   "id": "R-LEG",
   "name": "법무",
   "platformRoles": []
  },
  {
   "id": "R-PKI",
   "name": "PKI 운영",
   "platformRoles": []
  },
  {
   "id": "R-DPO",
   "name": "데이터 보호 담당",
   "platformRoles": []
  },
  {
   "id": "R-PLM",
   "name": "기준정보 담당",
   "platformRoles": [
    "VARIANT_OWNER",
    "BOM_APPROVER"
   ]
  },
  {
   "id": "R-PDA",
   "name": "상품 기획",
   "platformRoles": [
    "PRODUCT_AUTHOR"
   ]
  },
  {
   "id": "R-PO",
   "name": "상품 Owner",
   "platformRoles": [
    "PRODUCT_APPROVER"
   ]
  },
  {
   "id": "R-RDA",
   "name": "Feature DB 관리자",
   "platformRoles": [
    "REFDB_ADMIN"
   ]
  },
  {
   "id": "R-DRV",
   "name": "도메인 검토자",
   "platformRoles": [
    "DOMAIN_REVIEWER"
   ]
  },
  {
   "id": "R-CE",
   "name": "SW 개발비 산정 작성자",
   "platformRoles": [
    "COST_ESTIMATOR"
   ]
  },
  {
   "id": "R-CA",
   "name": "SW 개발비 산정 승인자",
   "platformRoles": [
    "COST_APPROVER"
   ]
  },
  {
   "id": "R-CV",
   "name": "SW 개발비 산정 열람자",
   "platformRoles": [
    "COST_VIEWER"
   ]
  },
  {
   "id": "R-CBA",
   "name": "원가 기준 관리자",
   "platformRoles": [
    "COST_BASIS_ADMIN"
   ]
  },
  {
   "id": "R-SYS",
   "name": "시스템 관리자",
   "platformRoles": [
    "SYSTEM_ADMIN"
   ]
  }
 ],
 "personas": {
  "approver": [
   "R-REQ",
   "R-PO",
   "R-DRV",
   "R-CA",
   "R-CBA"
  ],
  "author": [
   "R-FO"
  ],
  "commerce": [
   "R-PDA"
  ],
  "coordinator": [
   "R-REL"
  ],
  "integrator": [
   "R-SM",
   "R-CSM",
   "R-ARC",
   "R-INT"
  ],
  "operator": [
   "R-OPS"
  ],
  "opslead": [
   "R-OPS"
  ],
  "productowner": [
   "R-PO"
  ],
  "quality": [
   "R-SM",
   "R-TST",
   "R-QA"
  ],
  "safety2": [
   "R-SM"
  ],
  "steward": [
   "R-REG",
   "R-PLM",
   "R-RDA"
  ],
  "sysadmin": [
   "R-SYS"
  ],
  "viewer": [
   "R-QA",
   "R-CE",
   "R-CV"
  ]
 },
 "processes": [
  {
   "id": "FPW.1",
   "name": "Feature 등록·분류",
   "products": [
    {
     "key": "WP-FEAT-PROPOSAL",
     "name": "Feature 제안·변경요청",
     "content": [
      "기능 목적과 사용자 가치, 대상 시장·차종",
      "관련 요구 ID(ALM)와 기존 Feature와의 관계",
      "희망 출시 시점과 판매 방식(구독·구매·체험)"
     ]
    },
    {
     "key": "WP-FEAT-REG",
     "name": "Feature 등록 기록",
     "content": [
      "Feature ID·Version(PROPOSED 0.1.0)·소유자·설명",
      "Flag 유형과 Release·Experiment Flag의 만료일·Retirement 계획",
      "관련 요구 ID와 판매 방식"
     ]
    },
    {
     "key": "WP-REF-LINK",
     "name": "Feature DB 기준 행 연결",
     "content": [
      "대표(PRIMARY) 기준 행 1개와 포함(INCLUDED) 행 ID, 연결 당시 Feature DB 발행 버전",
      "기준값으로 미리 채운 이름·설명·대표 ASIL·분류 태그·규제와 '수정됨' 표시",
      "자동 채움 출처(기준 행 열·카탈로그·규칙)와 칸별 결정(그대로·고침·사람이 채움), 누가·언제",
      "Feature 프로필(ISO/IEC 26580) — 카탈로그 위치·상위 feature, 선택 유형·변이성·결합 시점, 변이점",
      "대표 ASIL과 다른 ASIL을 고른 경우 변경 전후 값과 사유",
      "연결 행 상태 경고(검토 필요·폐기 예정·요청 중)와 대체 행 안내"
     ]
    },
    {
     "key": "WP-REF-ADD-REQ",
     "name": "Feature DB 추가 요청",
     "content": [
      "도메인·컴포넌트·영문/한글 기능명·T-shirt·대표 ASIL",
      "출처 ID 또는 근거 메모, 새 컴포넌트가 필요하면 3글자 약어 제안",
      "즉시 부여된 정식 형식 ID와 요청 중(PENDING) 상태, 추가 변경 요청 번호"
     ]
    },
    {
     "key": "WP-FEAT-SCOPE",
     "name": "대상 차량 사양·의존 관계",
     "content": [
      "적용 차종·Trim·시장과 지원 조건",
      "필요(REQUIRES)·배타(EXCLUDES) 의존 관계와 판정",
      "Topology에서 위험 전파 관계가 있는 Feature 목록"
     ]
    },
    {
     "key": "WP-SAFETY-PROFILE",
     "name": "안전 분류(네 축)",
     "content": [
      "F 등급과 판정 근거(위험 전파 관계 포함)",
      "비활성화 등급·Safe State·인계·감소 시간 프로파일",
      "Safety Manager 개인 서명과 확정 시각"
     ]
    },
    {
     "key": "WP-REG-CLASS",
     "name": "법규 등급 판정 기록",
     "content": [
      "시장별 의무 기능 해당 여부와 근거 조항",
      "의무 기능일 때 DC4·R2 지정과 원격 요청 거부 대상 표시"
     ]
    },
    {
     "key": "WP-G1-DECISION",
     "name": "G1 Decision Record",
     "content": [
      "판정(PASS·CONDITIONAL PASS·FAIL)과 근거 Evidence ID",
      "판정자 역할·서명·시각, 조건부 통과 시 기한과 책임자"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.1-A01",
     "name": "Feature 등록·초안 작성",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-ARC",
       "R-REQ"
      ],
      "I": [
       "R-SM",
       "R-RDA"
      ]
     },
     "inputs": [
      "WP-REFDB-RELEASE",
      "WP-FEAT-PROPOSAL"
     ],
     "outputs": [
      "WP-FEAT-REG",
      "WP-REF-LINK"
     ],
     "next": [
      "FPW.1-A02",
      "FPW.1-A03"
     ],
     "screens": [
      "/master/define",
      "/feature/propose",
      "/features",
      "/master/feature-db"
     ],
     "actions": [
      "createFeature",
      "createVersion",
      "updateDraft"
     ],
     "checks": [
      "Registry에 PROPOSED Version이 생기고 소유자가 지정되었다",
      "대표 기준 행이 정확히 1개이고 폐기 행이 없으며, 대표 ASIL과 다르면 변경 사유가 있다. 자동 채움 칸마다 출처와 결정이 이력에 남았다",
      "만료일이 필요한 Flag 유형에 만료일과 Retirement 계획이 비어 있지 않다"
     ]
    },
    {
     "id": "FPW.1-A02",
     "name": "대상 차량 사양·의존 등록",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-PLM"
      ],
      "A": "R-FO",
      "C": [
       "R-ARC"
      ],
      "I": [
       "R-SM"
      ]
     },
     "inputs": [
      "WP-FEAT-REG"
     ],
     "outputs": [
      "WP-FEAT-SCOPE"
     ],
     "next": [
      "FPW.1-A05"
     ],
     "screens": [
      "/variant-conditions",
      "/arch/topology",
      "/features/catalogue"
     ],
     "actions": [
      "createDependency"
     ],
     "checks": [
      "모든 대상 Variant가 기준정보에 존재하고 의존 판정이 미판정으로 남지 않았다",
      "하위 feature는 상위 feature 기준 행이 있고, 변이점이 공유 자산과 맞다"
     ]
    },
    {
     "id": "FPW.1-A03",
     "name": "안전 분류(네 축) 확정",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-FO",
       "R-ARC"
      ],
      "I": [
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-FEAT-REG",
      "WP-FEAT-SCOPE"
     ],
     "outputs": [
      "WP-SAFETY-PROFILE"
     ],
     "next": [
      "FPW.1-A04"
     ],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "updateSafetyProfile",
      "confirmSafetyProfile"
     ],
     "checks": [
      "네 축 중 빈 값이 없고 분류 확정 서명이 남았다",
      "F 등급 하향이면 재분석 Evidence가 연결되었다"
     ]
    },
    {
     "id": "FPW.1-A04",
     "name": "법규 의무 기능 판정",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-SAFETY-PROFILE",
      "WP-COMPLIANCE-PROFILE"
     ],
     "outputs": [
      "WP-REG-CLASS"
     ],
     "next": [
      "FPW.1-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "대상 시장마다 의무 기능 해당 여부가 기록되었다"
     ]
    },
    {
     "id": "FPW.1-A05",
     "name": "G1 등록·분류 판정",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-FO",
       "R-REG"
      ],
      "I": [
       "R-REQ",
       "R-PLM",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-FEAT-REG",
      "WP-REF-LINK",
      "WP-FEAT-SCOPE",
      "WP-SAFETY-PROFILE",
      "WP-REG-CLASS"
     ],
     "outputs": [
      "WP-G1-DECISION"
     ],
     "next": [],
     "screens": [
      "/features/:id/:ver",
      "/admin/approval"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다",
      "Feature 작성자와 판정자가 다른 사람이다",
      "요청 중(PENDING) 기준 행이 연결되어 있으면 조건부 통과 조건에 관리자 승인이 적혀 있다"
     ]
    },
    {
     "id": "FPW.1-A06",
     "name": "Feature DB 추가 요청",
     "processId": "FPW.1",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-DRV"
      ],
      "I": [
       "R-RDA"
      ]
     },
     "inputs": [
      "WP-FEAT-PROPOSAL",
      "WP-REFDB-RELEASE"
     ],
     "outputs": [
      "WP-REF-ADD-REQ"
     ],
     "next": [],
     "screens": [
      "/feature/propose"
     ],
     "actions": [
      "requestRefAdd"
     ],
     "checks": [
      "요청 중 행에 정식 형식 ID와 필수 정보가 있고 추가 변경 요청이 접수되었다",
      "관리자 승인 전에는 Feature 정의 승인(APPROVED) 전이가 막혀 있음을 Feature Owner가 안다"
     ]
    }
   ]
  },
  {
   "id": "FPW.2",
   "name": "HARA·변경 영향 판단",
   "products": [
    {
     "key": "WP-IMPACT-ANALYSIS",
     "name": "변경 영향 분석서",
     "content": [
      "이전 Version과 바뀐 Registry 속성·Topology 관계",
      "재-HARA 조건 해당 여부와 근거",
      "영향 받는 Feature·차량 사양·회귀 시험 범위"
     ]
    },
    {
     "key": "WP-HARA-TARA",
     "name": "HARA·TARA 결과",
     "content": [
      "Item 정의와 위험 사건·ASIL·Safety Goal",
      "TARA 결과를 받아 반영한 교차 검토 내용",
      "ADS Feature면 원격 종료 경로와 비활성화 등급 확인 결과"
     ]
    },
    {
     "key": "WP-TARA",
     "name": "TARA 결과",
     "content": [
      "위협 시나리오·공격 경로·위험 값",
      "보안 목표와 사이버보안 요구 후보",
      "Kill·활성화 명령 경로(봉투·명령 인증)의 위협 평가"
     ]
    },
    {
     "key": "WP-SOTIF-ANALYSIS",
     "name": "SOTIF 분석",
     "content": [
      "기능 사양과 성능 한계",
      "트리거 조건과 위험 시나리오 평가"
     ]
    },
    {
     "key": "WP-HOMOLOGATION-IMPACT",
     "name": "형식승인 영향 판단서",
     "content": [
      "영향 여부와 근거 조항, 대상 RXSWIN",
      "승인 기관 결정(개정·확장)이 필요한 경우 그 목록",
      "법규 담당 서명과 판단 시각"
     ]
    },
    {
     "key": "WP-G2-DECISION",
     "name": "G2 Decision Record",
     "content": [
      "판정과 근거 Evidence ID(HARA·TARA·SOTIF·영향 분석)",
      "Safety Manager 서명·시각, 조건부 통과 시 기한과 책임자"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.2-A01",
     "name": "재-HARA 조건 검출·영향 범위 산정",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-ARC",
       "R-FO",
       "R-PUR"
      ],
      "I": [
       "R-REQ",
       "R-TST"
      ]
     },
     "inputs": [
      "WP-G1-DECISION",
      "WP-FEAT-SCOPE",
      "WP-SAFETY-PROFILE",
      "WP-SUPPLIER-DIFF"
     ],
     "outputs": [
      "WP-IMPACT-ANALYSIS"
     ],
     "next": [
      "FPW.2-A02",
      "FPW.2-A06",
      "FPW.2-A03",
      "FPW.2-A04"
     ],
     "screens": [
      "/analysis/impact",
      "/arch/topology"
     ],
     "actions": [],
     "checks": [
      "재-HARA 조건 해당 여부가 근거와 함께 기록되었다",
      "영향 받는 Feature와 회귀 시험 범위가 산정되었다"
     ]
    },
    {
     "id": "FPW.2-A02",
     "name": "HARA 수행",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM",
       "R-ARC",
       "R-FO"
      ],
      "I": [
       "R-REQ",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-IMPACT-ANALYSIS"
     ],
     "outputs": [
      "WP-HARA-TARA"
     ],
     "next": [
      "FPW.2-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "TARA와의 교차 검토 기록이 HARA 결과에 남았다",
      "ADS Feature가 원격 종료 불가 등급으로 분류되지 않았다"
     ]
    },
    {
     "id": "FPW.2-A06",
     "name": "TARA 수행",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-SM",
       "R-ARC"
      ],
      "I": [
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-IMPACT-ANALYSIS"
     ],
     "outputs": [
      "WP-TARA"
     ],
     "next": [
      "FPW.2-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "위협 시나리오마다 위험 값과 보안 목표가 있다",
      "Kill·활성화 명령 경로가 평가 범위에 들어 있다"
     ]
    },
    {
     "id": "FPW.2-A03",
     "name": "SOTIF 분석 갱신",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-ARC"
      ],
      "A": "R-SM",
      "C": [
       "R-FO",
       "R-TST"
      ],
      "I": [
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-IMPACT-ANALYSIS"
     ],
     "outputs": [
      "WP-SOTIF-ANALYSIS"
     ],
     "next": [
      "FPW.2-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "SOTIF 분석의 대상 Version이 현재 Version과 같다"
     ]
    },
    {
     "id": "FPW.2-A04",
     "name": "형식승인 영향 1차 판단",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-SM",
       "R-FO"
      ],
      "I": [
       "R-REL"
      ]
     },
     "inputs": [
      "WP-IMPACT-ANALYSIS"
     ],
     "outputs": [
      "WP-HOMOLOGATION-IMPACT"
     ],
     "next": [
      "FPW.2-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "판단서에 법규 담당 서명과 대상 RXSWIN이 있다"
     ]
    },
    {
     "id": "FPW.2-A05",
     "name": "G2 HARA 영향 판정",
     "processId": "FPW.2",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM",
       "R-REG"
      ],
      "I": [
       "R-FO",
       "R-REQ",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-HARA-TARA",
      "WP-TARA",
      "WP-SOTIF-ANALYSIS",
      "WP-HOMOLOGATION-IMPACT",
      "WP-REF-LINK"
     ],
     "outputs": [
      "WP-G2-DECISION"
     ],
     "next": [],
     "screens": [
      "/features/:id/:ver",
      "/admin/approval"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
     ]
    }
   ]
  },
  {
   "id": "FPW.3",
   "name": "안전요구 확정",
   "products": [
    {
     "key": "WP-SAFETY-REQ",
     "name": "안전요구·추적 연결",
     "content": [
      "Safety Goal부터 기능·기술·SW 안전요구까지의 도출 관계",
      "비활성화 등급·경고·인계·감소 시간·Safe State·끝 상태·운전자 정보 요구",
      "요구별 검증 기준과 ALM 요구 ID"
     ]
    },
    {
     "key": "WP-TRACE-REPORT",
     "name": "추적성 점검 결과",
     "content": [
      "요구↔설계↔시험↔Baseline 양방향 연결 현황",
      "끊긴 연결과 조치 담당"
     ]
    },
    {
     "key": "WP-REQ-REVIEW",
     "name": "요구 검토 판정 기록",
     "content": [
      "요구 특성(검증 가능성·일관성·완전성) 검토 결과",
      "Requirement Gate 판정과 판정자 서명"
     ]
    },
    {
     "key": "WP-G3-DECISION",
     "name": "G3 Decision Record·정의 승인",
     "content": [
      "G3 판정과 근거 Evidence ID",
      "PROPOSED→APPROVED 전이 기록과 승인자(작성자와 다른 사람)"
     ]
    },
    {
     "key": "WP-IMPL-LINK",
     "name": "구현 연결(Function·SW·제어기)",
     "content": [
      "Function → SW ID·Version → 제어기(ECU) P/N 짝 — SW·ECU 기준정보에서 고른 값",
      "VERIFIED 전이의 필수 입력(functions·swIds·swVersions·ecuPnos)"
     ]
    },
    {
     "key": "WP-EXT-SYNC",
     "name": "외부 연계 동기화·충돌 처리 기록",
     "content": [
      "codeBeamer 요구·JIRA Epic·GitLab MR과 Feature Version의 연결·상태 대조 결과",
      "받은 함에서 거부된 외부 변경과 사유(권한·전이 규칙·계정 매핑)",
      "충돌마다 고른 값(플랫폼 값·외부 값)과 처리자·사유"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.3-A01",
     "name": "안전요구 도출·명세",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-REQ"
      ],
      "A": "R-REQ",
      "C": [
       "R-SM",
       "R-ARC"
      ],
      "I": [
       "R-TST",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-HARA-TARA",
      "WP-SOTIF-ANALYSIS",
      "WP-G2-DECISION"
     ],
     "outputs": [
      "WP-SAFETY-REQ"
     ],
     "next": [
      "FPW.3-A02"
     ],
     "screens": [
      "/trace/design",
      "/change/cr"
     ],
     "actions": [],
     "checks": [
      "모든 Safety Goal에 하나 이상의 안전요구가 있고 요구마다 검증 기준이 있다"
     ]
    },
    {
     "id": "FPW.3-A02",
     "name": "양방향 추적성 점검",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-REQ"
      ],
      "A": "R-REQ",
      "C": [
       "R-ARC",
       "R-TST"
      ],
      "I": [
       "R-SM"
      ]
     },
     "inputs": [
      "WP-SAFETY-REQ"
     ],
     "outputs": [
      "WP-TRACE-REPORT"
     ],
     "next": [
      "FPW.3-A03",
      "FPW.3-A05"
     ],
     "screens": [
      "/trace/design"
     ],
     "actions": [],
     "checks": [
      "F2 이상 Feature의 끊긴 연결이 0건이다"
     ]
    },
    {
     "id": "FPW.3-A03",
     "name": "요구 검토 판정 등록",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-REQ",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-SAFETY-REQ",
      "WP-TRACE-REPORT"
     ],
     "outputs": [
      "WP-REQ-REVIEW"
     ],
     "next": [
      "FPW.3-A04"
     ],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "검토자가 요구 작성자와 다른 조직이다"
     ]
    },
    {
     "id": "FPW.3-A05",
     "name": "구현 연결 입력",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-INT",
       "R-FO"
      ],
      "A": "R-INT",
      "C": [
       "R-ARC",
       "R-PLM"
      ],
      "I": [
       "R-REQ",
       "R-TST"
      ]
     },
     "inputs": [
      "WP-SAFETY-REQ"
     ],
     "outputs": [
      "WP-IMPL-LINK"
     ],
     "next": [
      "FPW.3-A06"
     ],
     "screens": [
      "/features/:id/:ver",
      "/master/artifacts",
      "/integration/connectors"
     ],
     "actions": [
      "updateDraft"
     ],
     "checks": [
      "VERIFIED 필수 입력(functions·swIds·swVersions·ecuPnos)이 모두 기준정보에 있는 짝이다"
     ]
    },
    {
     "id": "FPW.3-A06",
     "name": "외부 연계 동기화·충돌 해결",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-REQ",
       "R-FO"
      ],
      "I": [
       "R-SM"
      ]
     },
     "inputs": [
      "WP-IMPL-LINK"
     ],
     "outputs": [
      "WP-EXT-SYNC"
     ],
     "next": [
      "FPW.3-A04"
     ],
     "screens": [
      "/integration/connectors",
      "/features/:id/:ver"
     ],
     "actions": [
      "resolveExtConflict"
     ],
     "checks": [
      "열린 충돌이 0건이고 실패한 보낼 함 작업마다 조치 담당이 있다",
      "Feature Version의 codeBeamer 요구·JIRA Epic 상태가 플랫폼 Lifecycle과 맞다"
     ]
    },
    {
     "id": "FPW.3-A04",
     "name": "G3 판정·Feature 정의 승인",
     "processId": "FPW.3",
     "raci": {
      "R": [
       "R-REQ"
      ],
      "A": "R-REQ",
      "C": [
       "R-SM",
       "R-FO"
      ],
      "I": [
       "R-ARC",
       "R-PLM",
       "R-TST"
      ]
     },
     "inputs": [
      "WP-REQ-REVIEW",
      "WP-G1-DECISION",
      "WP-G2-DECISION",
      "WP-REF-LINK",
      "WP-IMPL-LINK"
     ],
     "outputs": [
      "WP-G3-DECISION"
     ],
     "next": [],
     "screens": [
      "/features/:id/:ver",
      "/admin/approval"
     ],
     "actions": [
      "transition"
     ],
     "checks": [
      "Feature Version이 APPROVED이고 승인자가 Feature 작성자와 다르다",
      "연결된 기준 행에 요청 중(PENDING)·폐기 행이 없다. 요청 중 행은 Feature DB 관리자 승인 뒤에만 전이한다"
     ]
    }
   ]
  },
  {
   "id": "FPW.4",
   "name": "안전 설계·정책 설계",
   "products": [
    {
     "key": "WP-SAFETY-DESIGN",
     "name": "안전 설계서",
     "content": [
      "FTTI 안의 차량 내 고장 감지(독립 센서 plausibility 등)와 Safety Guard 보고 경로",
      "원격 Kill을 안전기제에 넣지 않았다는 근거와 차량 내부 안전기제",
      "텔레메트리 도착 여부가 안전 판정에 영향을 주지 않는 구조",
      "Control Point와 Flag가 상속하는 ASIL"
     ]
    },
    {
     "key": "WP-TCL-RECORD",
     "name": "플랫폼 도구 신뢰도(TCL) 기록",
     "content": [
      "컴포넌트별 오류 출력 유형과 TI·TD·TCL",
      "TD1 주장 시 출력 유형별 검출 수단",
      "TCL2 이상 컴포넌트의 신뢰도 확보 방법"
     ]
    },
    {
     "key": "WP-POLICY",
     "name": "Flag 정책(검증·승인본)",
     "content": [
      "대상 규칙·Variant 조건·기본값과 개정 번호",
      "분야별 검증 8종 결과와 배포 안전성 판정",
      "승인자·정책 해시·승인 시각"
     ]
    },
    {
     "key": "WP-G4-DECISION",
     "name": "G4 Decision Record",
     "content": [
      "설계 적합성 판정과 근거 Evidence ID",
      "독립 검토자 서명과 아키텍트 책임 확인"
     ]
    },
    {
     "key": "WP-POLICY-CR",
     "name": "정책 근거 변경요청(CR) 연결",
     "content": [
      "정책 ID와 근거 JIRA 변경요청(CR) 키·상태",
      "JIRA에서 CR 승인·반려가 정책 결정으로 반영되거나 거부된 기록과 사유"
     ]
    },
    {
     "key": "WP-FLAG-PR-RESULT",
     "name": "Flag 코드 변경 검토·병합 기록",
     "content": [
      "대상 Feature Version·Flag와 저장소 PR",
      "기본값·호출 구조 검토와 검사 결과",
      "병합 상태·스캔 참조·담당과 시각"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.4-A01",
     "name": "차량 내 감시·안전기제 설계",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-ARC"
      ],
      "A": "R-ARC",
      "C": [
       "R-SM",
       "R-INT"
      ],
      "I": [
       "R-TST",
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-G3-DECISION",
      "WP-SAFETY-REQ"
     ],
     "outputs": [
      "WP-SAFETY-DESIGN"
     ],
     "next": [
      "FPW.4-A03"
     ],
     "screens": [
      "/master/control-points",
      "/trace/design"
     ],
     "actions": [],
     "checks": [
      "안전요구마다 설계 요소가 연결되었다",
      "원격 Kill이 안전기제로 쓰인 곳이 없다"
     ]
    },
    {
     "id": "FPW.4-A03",
     "name": "Flag 정책 작성·검증",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-ARC"
      ],
      "A": "R-ARC",
      "C": [
       "R-PLM",
       "R-FO"
      ],
      "I": [
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-SAFETY-DESIGN",
      "WP-FEAT-SCOPE"
     ],
     "outputs": [
      "WP-POLICY"
     ],
     "next": [
      "FPW.4-A06"
     ],
     "screens": [
      "/policies/new",
      "/policies",
      "/config/odd"
     ],
     "actions": [
      "createPolicy",
      "updatePolicy",
      "validatePolicy"
     ],
     "checks": [
      "최신 개정본의 분야별 검증이 모두 통과했다"
     ]
    },
    {
     "id": "FPW.4-A06",
     "name": "정책 근거 변경요청(CR) 연결",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-ARC"
      ],
      "I": [
       "R-REQ",
       "R-REL"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-POLICY-CR"
     ],
     "next": [
      "FPW.4-A04"
     ],
     "screens": [
      "/policies/:id",
      "/integration/connectors"
     ],
     "actions": [
      "linkPolicyChangeRequest"
     ],
     "checks": [
      "승인 대상 정책에 근거 CR이 연결되어 있고 CR 상태가 정책 결정과 맞다"
     ]
    },
    {
     "id": "FPW.4-A04",
     "name": "정책 승인",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-REQ"
      ],
      "A": "R-REQ",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-ARC",
       "R-REL"
      ]
     },
     "inputs": [
      "WP-POLICY"
     ],
     "outputs": [
      "WP-POLICY"
     ],
     "next": [
      "FPW.4-A05"
     ],
     "screens": [
      "/policies/:id"
     ],
     "actions": [
      "decidePolicy"
     ],
     "checks": [
      "승인자가 정책 작성자와 다르고 승인 해시가 최신 개정본과 같다"
     ]
    },
    {
     "id": "FPW.4-A02",
     "name": "플랫폼 도구 신뢰도 분류",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-ARC",
       "R-CSM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-SAFETY-REQ"
     ],
     "outputs": [
      "WP-TCL-RECORD"
     ],
     "next": [
      "FPW.4-A05"
     ],
     "screens": [
      "/arch/components"
     ],
     "actions": [],
     "checks": [
      "사용 컴포넌트 모두에 TCL과 확보 방법이 있다"
     ]
    },
    {
     "id": "FPW.4-A05",
     "name": "G4 설계 독립 검토·판정",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-ARC",
      "C": [
       "R-SM",
       "R-CSM"
      ],
      "I": [
       "R-TST",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-SAFETY-DESIGN",
      "WP-TCL-RECORD",
      "WP-POLICY"
     ],
     "outputs": [
      "WP-G4-DECISION"
     ],
     "next": [
      "FPW.4-A07"
     ],
     "screens": [
      "/features/:id/:ver",
      "/admin/approval"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "검토자가 설계·정책 작성자와 다른 조직이다",
      "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
     ]
    },
    {
     "id": "FPW.4-A07",
     "name": "Flag PR 검토·병합",
     "processId": "FPW.4",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-ARC",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-REL",
       "R-TST"
      ]
     },
     "inputs": [
      "WP-G4-DECISION"
     ],
     "outputs": [
      "WP-FLAG-PR-RESULT"
     ],
     "next": [],
     "screens": [
      "/flag-code",
      "/flag-code/flags/:flagKey"
     ],
     "actions": [
      "createFlagPr",
      "demoMergeFlagPr"
     ],
     "checks": [
      "해당 Version의 Flag가 모두 코드 연결 정상 또는 검토 중이다"
     ]
    }
   ]
  },
  {
   "id": "FPW.5",
   "name": "검증·V&V",
   "products": [
    {
     "key": "WP-VV-PLAN",
     "name": "검증 계획(독립성 수준)",
     "content": [
      "참조 ASIL과 확인 조치별 독립성 수준",
      "시험 수준(단위·HIL·차량)과 판정 기준",
      "시뮬레이션 도구 사용 범위와 도구 분류"
     ]
    },
    {
     "key": "WP-TEST-SPEC",
     "name": "시험 명세(시나리오·허용 조합)",
     "content": [
      "시나리오·ODD 정의와 Version",
      "Topology 의존·충돌로 정한 허용 조합과 covering array, 부정 시험",
      "결함 주입·LPC 장악 가정 시험 항목"
     ]
    },
    {
     "key": "WP-INTEGRATION-REC",
     "name": "통합 검증 기록",
     "content": [
      "협력사 SEooC 사용 가정과 통합 대상의 대조 결과",
      "CI/CD 변경 기록(IF-13)과 통합 빌드 식별"
     ]
    },
    {
     "key": "WP-TEST-RESULT",
     "name": "시험 결과",
     "content": [
      "등급별 시나리오(작동 중·비작동 중·운전자 개입·전원 주기) 결과",
      "결함 주입별 수렴 상태와 기대 결과 대조",
      "가상검증(CARLA) 실행 결과와 재현 정보"
     ]
    },
    {
     "key": "WP-G5-EVIDENCE",
     "name": "G5 시험 Evidence 묶음",
     "content": [
      "TMS에 제출된 시험 명세·결과와 Feature ID·Version 연결",
      "시험 재현 정보(환경·도구·입력·Version)"
     ]
    },
    {
     "key": "WP-G5-DECISION",
     "name": "G5 Decision Record",
     "content": [
      "판정과 근거 Evidence ID, 독립 V&V 서명",
      "미해결 결함과 잔여 위험 수용 근거"
     ]
    },
    {
     "key": "WP-FLAG-RECON-RESULT",
     "name": "Flag 코드 대사·예외 확인 기록",
     "content": [
      "대상 Version·검사 판·스캔 해시",
      "불일치 항목과 조치 결과",
      "예외가 있으면 범위·결정·만료 참조"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.5-A01",
     "name": "독립성 수준·검증 계획 확정",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-TST",
       "R-QA"
      ],
      "I": [
       "R-FO",
       "R-INT"
      ]
     },
     "inputs": [
      "WP-G4-DECISION",
      "WP-SAFETY-PROFILE",
      "WP-SAFETY-REQ"
     ],
     "outputs": [
      "WP-VV-PLAN"
     ],
     "next": [
      "FPW.5-A02",
      "FPW.5-A03"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "확인 조치마다 독립성 수준과 수행 주체가 지정되었다"
     ]
    },
    {
     "id": "FPW.5-A02",
     "name": "시나리오·허용 조합 정의",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-TST"
      ],
      "A": "R-TST",
      "C": [
       "R-ARC",
       "R-SM"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-VV-PLAN",
      "WP-FEAT-SCOPE"
     ],
     "outputs": [
      "WP-TEST-SPEC"
     ],
     "next": [
      "FPW.5-A04"
     ],
     "screens": [
      "/arch/topology",
      "/validations"
     ],
     "actions": [],
     "checks": [
      "모든 시나리오에 Version이 있고 허용 조합 정의가 Topology와 일치한다"
     ]
    },
    {
     "id": "FPW.5-A03",
     "name": "통합 시험·SEooC 가정 확인",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-ARC",
       "R-TST",
       "R-SM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-VV-PLAN",
      "WP-INTAKE-RESULT"
     ],
     "outputs": [
      "WP-INTEGRATION-REC"
     ],
     "next": [
      "FPW.5-A07"
     ],
     "screens": [
      "/master/artifacts"
     ],
     "actions": [
      "registerChangeRecord"
     ],
     "checks": [
      "모든 SEooC 가정이 충족 또는 조치 중으로 기록되었다"
     ]
    },
    {
     "id": "FPW.5-A04",
     "name": "비활성화·결함 주입 시험 수행",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-TST"
      ],
      "A": "R-TST",
      "C": [
       "R-INT",
       "R-SM"
      ],
      "I": [
       "R-QA",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-TEST-SPEC",
      "WP-INTEGRATION-REC",
      "WP-POLICY"
     ],
     "outputs": [
      "WP-TEST-RESULT"
     ],
     "next": [
      "FPW.5-A05"
     ],
     "screens": [
      "/validations/virtual"
     ],
     "actions": [
      "runVirtual"
     ],
     "checks": [
      "시험 명세의 모든 항목에 결과가 있고 실패 항목은 결함으로 등록되었다"
     ]
    },
    {
     "id": "FPW.5-A07",
     "name": "Flag 코드 연결 확인",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-TST"
      ],
      "I": [
       "R-FO",
       "R-REL"
      ]
     },
     "inputs": [
      "WP-INTEGRATION-REC"
     ],
     "outputs": [
      "WP-FLAG-RECON-RESULT"
     ],
     "next": [
      "FPW.5-A04"
     ],
     "screens": [
      "/flag-code/reconcile",
      "/integration/code-scans"
     ],
     "actions": [
      "rescanFlagRepository",
      "requestFlagGateWaiver"
     ],
     "checks": [
      "출시 관문의 Flag 코드 연결 판정이 통과 또는 승인된 해제다"
     ]
    },
    {
     "id": "FPW.5-A05",
     "name": "시험 Evidence 연결·TMS 제출",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-TST"
      ],
      "A": "R-TST",
      "C": [
       "R-INT"
      ],
      "I": [
       "R-QA",
       "R-SM"
      ]
     },
     "inputs": [
      "WP-TEST-RESULT",
      "WP-TEST-SPEC"
     ],
     "outputs": [
      "WP-G5-EVIDENCE"
     ],
     "next": [
      "FPW.5-A06"
     ],
     "screens": [
      "/verify/evidence",
      "/verify/safety-case"
     ],
     "actions": [
      "submitTms"
     ],
     "checks": [
      "제출한 모든 시험이 Feature Version에 연결되고 재현 정보가 비어 있지 않다"
     ]
    },
    {
     "id": "FPW.5-A06",
     "name": "G5 V&V 판정",
     "processId": "FPW.5",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-TST",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-FO",
       "R-REL",
       "R-ARC"
      ]
     },
     "inputs": [
      "WP-G5-EVIDENCE",
      "WP-VV-PLAN"
     ],
     "outputs": [
      "WP-G5-DECISION"
     ],
     "next": [],
     "screens": [
      "/verify/evidence",
      "/admin/approval"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "판정자가 시험 수행·통합 담당과 다른 조직이다",
      "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
     ]
    }
   ]
  },
  {
   "id": "FPW.6",
   "name": "서명 배포",
   "products": [
    {
     "key": "WP-BASELINE-REQ",
     "name": "Baseline 확정 요청",
     "content": [
      "포함 Feature Version·정책 개정본·Artifact 목록",
      "요청자와 요청 사유"
     ]
    },
    {
     "key": "WP-RELEASE-BASELINE",
     "name": "출시 Baseline",
     "content": [
      "확정된 BOM 구성(Feature·SW·Variant)과 해시",
      "승인자(요청자와 다른 사람)·승인 시각"
     ]
    },
    {
     "key": "WP-SUMS-RECORD",
     "name": "SUMS 업데이트 기록",
     "content": [
      "대상 RXSWIN과 형식승인 영향 평가 결과",
      "사용자 고지 내용과 시장별 보존 기간"
     ]
    },
    {
     "key": "WP-SIGNED-PACKAGE",
     "name": "서명 배포 패키지",
     "content": [
      "정책·설정 Artifact와 서명, 대상 해시",
      "결합된 SBOM과 패키지 식별자"
     ]
    },
    {
     "key": "WP-OTA-GATE",
     "name": "OTA Gate 판정 기록",
     "content": [
      "R156 사전조건·대상·호환성 확인 결과",
      "판정자 서명과 시각"
     ]
    },
    {
     "key": "WP-G6-DECISION",
     "name": "G6 배포 기록",
     "content": [
      "서버 배포(평가 기준 전환) 시각과 게시본 ID",
      "Unleash 동기화 결과(flag·전략·환경)",
      "Release Manager 판정과 근거 Evidence ID"
     ]
    },
    {
     "key": "WP-REPO-CONNECTION",
     "name": "코드 저장소 연결·변경 기록",
     "content": [
      "저장소·패키지·기본 브랜치와 스캔 설정",
      "webhook·서명 검증의 상태와 실패 조치",
      "변경 사유·권한 있는 수행자·시각"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.6-A01",
     "name": "출시 Baseline 확정 요청",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-REL",
       "R-ARC"
      ],
      "I": [
       "R-PLM"
      ]
     },
     "inputs": [
      "WP-G5-DECISION",
      "WP-POLICY"
     ],
     "outputs": [
      "WP-BASELINE-REQ"
     ],
     "next": [
      "FPW.6-A02"
     ],
     "screens": [
      "/baselines"
     ],
     "actions": [
      "requestBaseline"
     ],
     "checks": [
      "요청에 포함 Version·정책 개정본·Artifact가 빠짐없이 있다"
     ]
    },
    {
     "id": "FPW.6-A02",
     "name": "출시 Baseline 확정 승인",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-PLM"
      ],
      "A": "R-PLM",
      "C": [
       "R-REL"
      ],
      "I": [
       "R-FO",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-BASELINE-REQ"
     ],
     "outputs": [
      "WP-RELEASE-BASELINE"
     ],
     "next": [
      "FPW.6-A03",
      "FPW.6-A04"
     ],
     "screens": [
      "/baselines",
      "/config/compat"
     ],
     "actions": [
      "decideBaseline"
     ],
     "checks": [
      "승인자가 요청자와 다르고 Baseline 해시가 고정되었다"
     ]
    },
    {
     "id": "FPW.6-A03",
     "name": "SUMS 기록·형식승인 확인",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-REL"
      ],
      "I": [
       "R-FO",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-RELEASE-BASELINE",
      "WP-HOMOLOGATION-IMPACT"
     ],
     "outputs": [
      "WP-SUMS-RECORD"
     ],
     "next": [
      "FPW.6-A05"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "SUMS 기록에 RXSWIN·영향 평가·고지 내용·보존 기간이 있다"
     ]
    },
    {
     "id": "FPW.6-A04",
     "name": "서명 패키지 작성·SBOM 결합",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-REL",
      "C": [
       "R-PKI",
       "R-CSM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RELEASE-BASELINE"
     ],
     "outputs": [
      "WP-SIGNED-PACKAGE"
     ],
     "next": [
      "FPW.6-A05"
     ],
     "screens": [
      "/deployments",
      "/master/artifacts"
     ],
     "actions": [
      "registerChangeRecord"
     ],
     "checks": [
      "패키지 서명이 배포 용도 키로 검증되고 SBOM이 결합되었다"
     ]
    },
    {
     "id": "FPW.6-A05",
     "name": "OTA Gate 판정 등록",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-REL",
      "C": [
       "R-REG",
       "R-CSM"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-SIGNED-PACKAGE",
      "WP-SUMS-RECORD"
     ],
     "outputs": [
      "WP-OTA-GATE"
     ],
     "next": [
      "FPW.6-A06"
     ],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "판정 근거에 서명 검증·SUMS 기록 ID가 있다"
     ]
    },
    {
     "id": "FPW.6-A06",
     "name": "G6 서명 배포 실행",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-REL"
      ],
      "A": "R-REL",
      "C": [
       "R-OPS"
      ],
      "I": [
       "R-FO",
       "R-SM",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-OTA-GATE",
      "WP-RELEASE-BASELINE"
     ],
     "outputs": [
      "WP-G6-DECISION"
     ],
     "next": [
      "FPW.6-A07"
     ],
     "screens": [
      "/deployments",
      "/integration/connectors",
      "/ops/ota-installs",
      "/deployments/campaigns/:id"
     ],
     "actions": [
      "deployPolicy",
      "syncUnleash"
     ],
     "checks": [
      "게시본 ID와 Unleash 동기화 결과가 G6 배포 기록에 있다"
     ]
    },
    {
     "id": "FPW.6-A07",
     "name": "코드 저장소 연결 관리",
     "processId": "FPW.6",
     "raci": {
      "R": [
       "R-REL"
      ],
      "A": "R-REL",
      "C": [
       "R-INT"
      ],
      "I": [
       "R-ARC"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-REPO-CONNECTION"
     ],
     "next": [],
     "screens": [
      "/integration/code-repositories",
      "/integration/code-repositories/:repoId",
      "/integration/code-scans"
     ],
     "actions": [
      "createFlagRepository",
      "updateFlagRepository"
     ],
     "checks": [
      "연결 저장소의 webhook이 정상이고 최근 스캔이 서명 확인됐다"
     ]
    }
   ]
  },
  {
   "id": "FPW.7",
   "name": "출시·활성화·단계적 확대",
   "products": [
    {
     "key": "WP-CANARY-PLAN",
     "name": "Canary·Shadow 판정 기준",
     "content": [
      "Cohort별 차량 수·관측 기간·허용 차이·중단 기준",
      "Shadow 출력이 제어기에 전달되지 않는다는 확인"
     ]
    },
    {
     "key": "WP-EXPERIMENT-PLAN",
     "name": "실험 계획",
     "content": [
      "실험 목적·지표·기간과 대상 Cohort",
      "F2 이상이면 Shadow 방식과 비간섭 입증 근거"
     ]
    },
    {
     "key": "WP-SAFETY-CASE",
     "name": "Safety Case·SOTIF 출시 근거",
     "content": [
      "주장·논거·증거와 고유 식별자(규칙 ID·시험 ID 재사용)",
      "ISO 21448 출시 기준 충족 근거와 잔여 위험"
     ]
    },
    {
     "key": "WP-SC-REVIEW",
     "name": "Safety Case 독립 검토 기록",
     "content": [
      "검토자 자격·검토 기간·대상 Version(Safety Case·도구·ADS)",
      "검토 방법·재현한 증거·공백과 불확실 영역·개선 조치"
     ]
    },
    {
     "key": "WP-PRODUCT",
     "name": "상품 구성안",
     "content": [
      "상품에 포함되는 Feature와 판매 방식(구독·구매·체험)",
      "구성 검증 결과와 체험 제안 조건"
     ]
    },
    {
     "key": "WP-PRODUCT-APPROVAL",
     "name": "상품 구성 승인 기록",
     "content": [
      "구성 승인자(상품 작성자와 다른 사람)와 시각"
     ]
    },
    {
     "key": "WP-ACTIVATION-PRECHECK",
     "name": "활성화 조건 확인서",
     "content": [
      "형식승인 기관 결정 여부와 근거",
      "시장별 사용자 고지·확인 준비와 '작동 중이 아닐 때 효력' 조건"
     ]
    },
    {
     "key": "WP-G7-DECISION",
     "name": "G7 Decision Record",
     "content": [
      "출시·활성화 판정과 근거 Evidence ID(SOTIF·Safety Case·Canary 기준)",
      "Safety Manager 판정 서명, Feature Owner 출시 책임 확인"
     ]
    },
    {
     "key": "WP-RELEASE-SIGNOFF",
     "name": "Release Sign-off 기록",
     "content": [
      "Feature Owner 개인 서명·서명 시각·소유 조직",
      "서명 시점의 G8·G9 판정 기록 ID(다시 판정되면 효력 없음)"
     ]
    },
    {
     "key": "WP-RELEASE-RECORD",
     "name": "출시 전이 기록",
     "content": [
      "VERIFIED→RELEASED 전이 시각과 수행자"
     ]
    },
    {
     "key": "WP-PRODUCT-RELEASE",
     "name": "상품 고객 출시 기록",
     "content": [
      "고객 출시 승인자(구성 승인자와 다른 사람)와 시각"
     ]
    },
    {
     "key": "WP-ROLLOUT-RECORD",
     "name": "단계적 확대 기록",
     "content": [
      "Cohort 단계별 적용 시각·관측 결과",
      "확대·중단 결정과 근거"
     ]
    },
    {
     "key": "WP-FLAG-WAIVER",
     "name": "출시 차단 해제 결정 기록",
     "content": [
      "해제 대상 Flag·요청 당시 대사 상태·사유·만료",
      "요청자와 다른 결정자의 개인 서명·시각(F2 이상은 Safety Manager 포함)"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.7-A01",
     "name": "Canary·Shadow 판정 기준 정의",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM",
       "R-TST"
      ],
      "I": [
       "R-FO",
       "R-REL"
      ]
     },
     "inputs": [
      "WP-SAFETY-PROFILE",
      "WP-G6-DECISION"
     ],
     "outputs": [
      "WP-CANARY-PLAN"
     ],
     "next": [
      "FPW.7-A08"
     ],
     "screens": [
      "/activation/decide",
      "/policies/:id"
     ],
     "actions": [],
     "checks": [
      "모든 단계에 관측 기간·허용 차이·중단 기준이 있다"
     ]
    },
    {
     "id": "FPW.7-A13",
     "name": "출시 차단 해제 결정",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-REQ"
      ],
      "A": "R-REQ",
      "C": [
       "R-SM",
       "R-FO"
      ],
      "I": [
       "R-REL",
       "R-INT"
      ]
     },
     "inputs": [
      "WP-INTEGRATION-REC"
     ],
     "outputs": [
      "WP-FLAG-WAIVER"
     ],
     "next": [
      "FPW.7-A12"
     ],
     "screens": [
      "/flag-code/reconcile"
     ],
     "actions": [
      "decideFlagGateWaiver"
     ],
     "checks": [
      "요청자와 결정자가 다른 사람이다"
     ]
    },
    {
     "id": "FPW.7-A02",
     "name": "효과 실험 계획 등록",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-SM",
       "R-OPS"
      ],
      "I": [
       "R-REL"
      ]
     },
     "inputs": [
      "WP-SAFETY-PROFILE"
     ],
     "outputs": [
      "WP-EXPERIMENT-PLAN"
     ],
     "next": [
      "FPW.7-A08"
     ],
     "screens": [
      "/experiments"
     ],
     "actions": [
      "createExperiment"
     ],
     "checks": [
      "F2 이상 Feature에 Experiment Flag 실험이 등록되지 않았다"
     ]
    },
    {
     "id": "FPW.7-A03",
     "name": "Safety Case·SOTIF 근거 정리",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-FO",
       "R-TST"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-SOTIF-ANALYSIS",
      "WP-G5-EVIDENCE",
      "WP-HARA-TARA"
     ],
     "outputs": [
      "WP-SAFETY-CASE"
     ],
     "next": [
      "FPW.7-A04"
     ],
     "screens": [
      "/verify/evidence",
      "/verify/compliance",
      "/verify/safety-case"
     ],
     "actions": [],
     "checks": [
      "모든 주장에 논거와 증거가 하나 이상 있다"
     ]
    },
    {
     "id": "FPW.7-A04",
     "name": "Safety Case 독립 검토",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-SM",
      "C": [
       "R-TST"
      ],
      "I": [
       "R-FO",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-SAFETY-CASE"
     ],
     "outputs": [
      "WP-SC-REVIEW"
     ],
     "next": [
      "FPW.7-A08"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "검토 기록에 자격·기간·Version·방법·재현 증거·공백이 모두 있다"
     ]
    },
    {
     "id": "FPW.7-A05",
     "name": "상품 구성 작성",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-PDA"
      ],
      "A": "R-PDA",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-PO"
      ]
     },
     "inputs": [
      "WP-G6-DECISION"
     ],
     "outputs": [
      "WP-PRODUCT"
     ],
     "next": [
      "FPW.7-A06"
     ],
     "screens": [
      "/products/new",
      "/entitlements",
      "/products/bill-of-features",
      "/products/configurator"
     ],
     "actions": [
      "createProduct",
      "validateComposition",
      "checkBillOfFeatures",
      "offerTrials"
     ],
     "checks": [
      "구성 검증 결과에 충돌이 없다"
     ]
    },
    {
     "id": "FPW.7-A06",
     "name": "상품 구성 승인",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-PO"
      ],
      "A": "R-PO",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-PDA"
      ]
     },
     "inputs": [
      "WP-PRODUCT"
     ],
     "outputs": [
      "WP-PRODUCT-APPROVAL"
     ],
     "next": [
      "FPW.7-A08"
     ],
     "screens": [
      "/products/:id/:ver"
     ],
     "actions": [
      "productTransition"
     ],
     "checks": [
      "구성 승인자가 상품 작성자와 다르다",
      "카탈로그 제약 위반(선행·배타·대안 중복)이 없다"
     ]
    },
    {
     "id": "FPW.7-A07",
     "name": "형식승인·사용자 고지 확인",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-LEG",
       "R-FO"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-HOMOLOGATION-IMPACT",
      "WP-SUMS-RECORD"
     ],
     "outputs": [
      "WP-ACTIVATION-PRECHECK"
     ],
     "next": [
      "FPW.7-A08"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "활성화 조건 확인서에 기관 결정·고지 준비·효력 조건이 모두 있다"
     ]
    },
    {
     "id": "FPW.7-A08",
     "name": "G7 출시·활성화 판정",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-FO",
      "C": [
       "R-OPS",
       "R-REG"
      ],
      "I": [
       "R-REL",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-CANARY-PLAN",
      "WP-EXPERIMENT-PLAN",
      "WP-SC-REVIEW",
      "WP-PRODUCT-APPROVAL",
      "WP-ACTIVATION-PRECHECK"
     ],
     "outputs": [
      "WP-G7-DECISION"
     ],
     "next": [
      "FPW.7-A13"
     ],
     "screens": [
      "/activation/decide",
      "/admin/approval"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
     ]
    },
    {
     "id": "FPW.7-A12",
     "name": "Release Sign-off(출시 책임 확인)",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-REL",
       "R-PO"
      ]
     },
     "inputs": [
      "WP-G7-DECISION",
      "WP-CANARY-PLAN",
      "WP-SC-REVIEW"
     ],
     "outputs": [
      "WP-RELEASE-SIGNOFF"
     ],
     "next": [
      "FPW.7-A09"
     ],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "signRelease"
     ],
     "checks": [
      "서명이 현재 G8·G9 판정 기록에 묶여 유효하다"
     ]
    },
    {
     "id": "FPW.7-A09",
     "name": "출시 전이",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-REL"
      ],
      "A": "R-REL",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-OPS",
       "R-PO"
      ]
     },
     "inputs": [
      "WP-G7-DECISION",
      "WP-RELEASE-SIGNOFF"
     ],
     "outputs": [
      "WP-RELEASE-RECORD"
     ],
     "next": [
      "FPW.7-A10",
      "FPW.7-A11"
     ],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "transition"
     ],
     "checks": [
      "Feature Version이 RELEASED이고 전이 수행자가 기록되었다"
     ]
    },
    {
     "id": "FPW.7-A10",
     "name": "상품 고객 출시 승인",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-PO"
      ],
      "A": "R-PO",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-PDA",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-RELEASE-RECORD",
      "WP-PRODUCT-APPROVAL"
     ],
     "outputs": [
      "WP-PRODUCT-RELEASE"
     ],
     "next": [],
     "screens": [
      "/products/:id/:ver"
     ],
     "actions": [
      "productTransition"
     ],
     "checks": [
      "고객 출시 승인자가 구성 승인자와 다르다"
     ]
    },
    {
     "id": "FPW.7-A11",
     "name": "Canary 활성화·단계적 확대",
     "processId": "FPW.7",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM",
       "R-REL"
      ],
      "I": [
       "R-FO",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RELEASE-RECORD",
      "WP-CANARY-PLAN"
     ],
     "outputs": [
      "WP-ROLLOUT-RECORD"
     ],
     "next": [],
     "screens": [
      "/activation/decide",
      "/fleet/live",
      "/features/:id/:ver",
      "/notifications"
     ],
     "actions": [
      "stageRollout"
     ],
     "checks": [
      "단계마다 관측 결과와 확대·중단 결정이 기록되었다"
     ]
    }
   ]
  },
  {
   "id": "FPW.8",
   "name": "운영·긴급 차단·복원",
   "products": [
    {
     "key": "WP-ANOMALY-CASE",
     "name": "이상 징후 건",
     "content": [
      "이상 징후 출처(운행 지표·장애·VOC·SOTIF 트리거)와 대상 Feature Version",
      "영향 차량 수·지역·Variant와 확인 결과"
     ]
    },
    {
     "key": "WP-KILL-PLAN",
     "name": "차단 판단서",
     "content": [
      "사유 분류(SAFETY·SECURITY·REGULATORY·COMMERCIAL·OPERATIONAL)와 유효 등급",
      "대상 범위와 24시간 누적 상한 대조 결과",
      "대량 원격 종료 계획(단계·순서) 적용 여부"
     ]
    },
    {
     "key": "WP-RECALL-BASIS",
     "name": "리콜·봉쇄 근거",
     "content": [
      "리콜 번호 또는 봉쇄 결정 근거와 시장",
      "시장별 보고 기한과 보고 책임자"
     ]
    },
    {
     "key": "WP-KILL-REQ",
     "name": "긴급 차단 요청",
     "content": [
      "대상 Feature Version·차량 범위·사유 분류와 리콜·봉쇄 근거 참조",
      "요청자와 요청 시각"
     ]
    },
    {
     "key": "WP-KILL-DECISION",
     "name": "차단 승인 기록",
     "content": [
      "서로 다른 승인자 2명의 개인 서명과 역할",
      "게이트 판정(등급·대상 상한) 결과와 발행 명령 ID"
     ]
    },
    {
     "key": "WP-KILL-TRACE",
     "name": "차단 적용 추적표",
     "content": [
      "차량별 전달·적용 상태(유효한 상태 보고와 영속 저장 확인 기준)",
      "기한 초과 미적용 차량과 연결된 이상 징후 건",
      "대기 상한 초과 경보와 상위 대응 기록"
     ]
    },
    {
     "key": "WP-POST-REVIEW",
     "name": "긴급 권한 사후 검토 기록",
     "content": [
      "검토자(요청자·승인자 제외)와 검토 시각(24시간 이내)",
      "사유·범위·절차 준수 판단과 개선 조치"
     ]
    },
    {
     "key": "WP-RESTORE-REQ",
     "name": "복원 요청",
     "content": [
      "원인 분석·수정 내용과 재검증 Evidence 참조",
      "복원 대상 범위와 Canary Cohort"
     ]
    },
    {
     "key": "WP-RESTORE-DECISION",
     "name": "복원 승인 기록",
     "content": [
      "차단 승인자와 겹치지 않는 승인자 2명의 개인 서명",
      "게이트 판정과 복원 게시 ID"
     ]
    },
    {
     "key": "WP-RESTORE-ROLLOUT",
     "name": "단계적 복원 관측 기록",
     "content": [
      "Cohort 단계별 확대 시각과 관측 결과",
      "중단 기준 충족 여부와 재차단 여부"
     ]
    },
    {
     "key": "WP-DRILL-REPORT",
     "name": "드릴 결과·G8 판정",
     "content": [
      "시험 Cohort의 전달 시간·적용률·보고 정확도",
      "분기 운영 점검 결과와 G8 판정 서명"
     ]
    },
    {
     "key": "WP-FLAG-EVAL-INVESTIGATION",
     "name": "Flag 평가 이상 조사 기록",
     "content": [
      "영향 Flag·Version·차량과 관측 기간",
      "폴백·서명·평가 오류와 대조한 게시본·회신",
      "원인·조치·차단 또는 재배포 인계"
     ]
    },
    {
     "key": "WP-RBK-REQ",
     "name": "정책 롤백 요청·계획",
     "content": [
      "현재 배포 ID·복구 정책 버전·전 범위·수동 사유 또는 자동 조건",
      "미리보기 검증과 지정 승인대상자"
     ]
    },
    {
     "key": "WP-RBK-DEC",
     "name": "정책 롤백 승인 기록",
     "content": [
      "지정 승인대상자와 요청자 분리",
      "승인/반려 사유·범위·복구 기준 및 판정 시각"
     ]
    },
    {
     "key": "WP-RBK-EXEC",
     "name": "정책 롤백 실행 추적",
     "content": [
      "실행 직전 재검증·실행자·현재 배포 변화 확인",
      "새 서명 게시본 ID·전송·실패 및 원본 배포 연결"
     ]
    },
    {
     "key": "WP-RBK-CLOSE",
     "name": "정책 롤백 적용 확인",
     "content": [
      "대상 분모·차량별 ACK/READBACK·적용·거부·미회신",
      "재시도·기한초과·완료 또는 미해결 인계 근거"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.8-A12",
     "name": "Flag 평가 이상 확인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-INT"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-FLAG-EVAL-INVESTIGATION"
     ],
     "next": [
      "FPW.8-A01"
     ],
     "screens": [
      "/ops/flag-evaluations"
     ],
     "actions": [],
     "checks": [
      "폴백 급증 Flag마다 원인과 조치가 기록됐다"
     ]
    },
    {
     "id": "FPW.8-A01",
     "name": "이상 징후 확인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-QA",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-G7-DECISION",
      "WP-ROLLOUT-RECORD",
      "WP-KPI-PLAN",
      "WP-G5-EVIDENCE"
     ],
     "outputs": [
      "WP-ANOMALY-CASE"
     ],
     "next": [
      "FPW.8-A02"
     ],
     "screens": [
      "/ops/anomalies",
      "/ops/safety-kpi",
      "/ops/incidents",
      "/ops/incident-reports/:id",
      "/ops/feature-health",
      "/ops/feature-health/:findingId",
      "/ops/collection",
      "/integration/datalake"
     ],
     "actions": [
      "acknowledgeAnomaly",
      "dismissAnomaly",
      "createIncident"
     ],
     "checks": [
      "이상 징후 건에 출처·대상 Version·영향 범위가 기록되었다",
      "기한이 지난 조치 필요 점검 결과가 담당자 검토함에 있다"
     ]
    },
    {
     "id": "FPW.8-A02",
     "name": "차단 필요성·범위 판단",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM",
       "R-REG",
       "R-OPS"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-ANOMALY-CASE",
      "WP-SAFETY-PROFILE",
      "WP-VEX-DECISION"
     ],
     "outputs": [
      "WP-KILL-PLAN"
     ],
     "next": [
      "FPW.8-A03"
     ],
     "screens": [
      "/ops/kill"
     ],
     "actions": [
      "gatePreview"
     ],
     "checks": [
      "사유 분류·유효 등급·범위·누적 상한 대조가 차단 판단서에 있다"
     ]
    },
    {
     "id": "FPW.8-A03",
     "name": "리콜·봉쇄 근거 연계",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-SM",
       "R-LEG"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-KILL-PLAN"
     ],
     "outputs": [
      "WP-RECALL-BASIS"
     ],
     "next": [
      "FPW.8-A04"
     ],
     "screens": [
      "/ops/incident-reports"
     ],
     "actions": [],
     "checks": [
      "안전 차단 요청에 붙일 리콜·봉쇄 근거 ID가 있다(근거가 없으면 게이트가 차단한다)"
     ]
    },
    {
     "id": "FPW.8-A04",
     "name": "긴급 차단 요청",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-CSM",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-KILL-PLAN",
      "WP-RECALL-BASIS"
     ],
     "outputs": [
      "WP-KILL-REQ"
     ],
     "next": [
      "FPW.8-A05"
     ],
     "screens": [
      "/ops/kill"
     ],
     "actions": [
      "issueKill"
     ],
     "checks": [
      "요청이 접수되어 승인 대기 상태가 되었다"
     ]
    },
    {
     "id": "FPW.8-A05",
     "name": "긴급 차단 2인 승인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-SM",
       "R-CSM"
      ],
      "A": "R-SM",
      "C": [
       "R-REG"
      ],
      "I": [
       "R-OPS",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-KILL-REQ",
      "WP-KILL-PLAN"
     ],
     "outputs": [
      "WP-KILL-DECISION"
     ],
     "next": [
      "FPW.8-A06",
      "FPW.8-A07"
     ],
     "screens": [
      "/ops/kill"
     ],
     "actions": [
      "approveKill",
      "rejectKill"
     ],
     "checks": [
      "서로 다른 2명의 승인 서명이 있고 요청자는 승인자에 없다"
     ]
    },
    {
     "id": "FPW.8-A07",
     "name": "긴급 권한 사후 검토",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-QA",
      "C": [
       "R-CSM",
       "R-REG"
      ],
      "I": [
       "R-SM",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-KILL-REQ",
      "WP-KILL-DECISION"
     ],
     "outputs": [
      "WP-POST-REVIEW"
     ],
     "next": [],
     "screens": [
      "/audit/oversight"
     ],
     "actions": [
      "recordKillPostReview"
     ],
     "checks": [
      "검토 기록이 24시간 안에 있고 검토자가 요청자·승인자와 다르다"
     ]
    },
    {
     "id": "FPW.8-A06",
     "name": "차단 전달·적용 추적",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM"
      ],
      "I": [
       "R-QA",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-KILL-DECISION"
     ],
     "outputs": [
      "WP-KILL-TRACE"
     ],
     "next": [
      "FPW.8-A08"
     ],
     "screens": [
      "/fleet/live",
      "/deployments"
     ],
     "actions": [
      "acknowledgeAnomaly"
     ],
     "checks": [
      "기한 초과 미적용 차량마다 연결된 이상 징후 건이 있다"
     ]
    },
    {
     "id": "FPW.8-A08",
     "name": "원인 조치·복원 요청",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM",
       "R-FO",
       "R-TST"
      ],
      "I": [
       "R-REG"
      ]
     },
     "inputs": [
      "WP-KILL-TRACE",
      "WP-G5-EVIDENCE"
     ],
     "outputs": [
      "WP-RESTORE-REQ"
     ],
     "next": [
      "FPW.8-A09"
     ],
     "screens": [
      "/ops/kill"
     ],
     "actions": [
      "requestRestore"
     ],
     "checks": [
      "복원 요청에 재검증 Evidence 참조와 Canary Cohort가 있다"
     ]
    },
    {
     "id": "FPW.8-A09",
     "name": "복원 2인 승인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-SM",
       "R-QA"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM"
      ],
      "I": [
       "R-OPS",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-RESTORE-REQ",
      "WP-KILL-DECISION"
     ],
     "outputs": [
      "WP-RESTORE-DECISION"
     ],
     "next": [
      "FPW.8-A10"
     ],
     "screens": [
      "/ops/kill"
     ],
     "actions": [
      "approveRestore",
      "rejectRestore"
     ],
     "checks": [
      "복원 승인자 중 직전 차단 승인자가 없다"
     ]
    },
    {
     "id": "FPW.8-A10",
     "name": "단계적 복원·관측",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM",
       "R-REL"
      ],
      "I": [
       "R-FO",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RESTORE-DECISION"
     ],
     "outputs": [
      "WP-RESTORE-ROLLOUT"
     ],
     "next": [],
     "screens": [
      "/fleet/live"
     ],
     "actions": [
      "stageRollout"
     ],
     "checks": [
      "단계마다 관측 결과와 확대·중단 결정이 기록되었다"
     ]
    },
    {
     "id": "FPW.8-A11",
     "name": "분기 드릴·G8 운영 판정",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SM",
       "R-QA"
      ],
      "I": [
       "R-FO",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-KILL-TRACE",
      "WP-POST-REVIEW"
     ],
     "outputs": [
      "WP-DRILL-REPORT"
     ],
     "next": [],
     "screens": [
      "/ops/kill",
      "/audit"
     ],
     "actions": [],
     "checks": [
      "분기마다 드릴 결과와 G8 판정이 있다"
     ]
    },
    {
     "id": "FPW.8-A13",
     "name": "정책 롤백 요청·계획",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-REL",
       "R-SM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-RBK-REQ"
     ],
     "next": [
      "FPW.8-A14"
     ],
     "screens": [
      "/ops/rollback",
      "/policies/:id"
     ],
     "actions": [
      "previewRollback",
      "createRollbackRequest",
      "createRollbackPlan"
     ],
     "checks": [
      "현재 배포가 바뀌면 낡은 요청으로 실행하지 않는다",
      "정책 전 범위를 덮지 못하거나 SW 버전 실행 위임이 미확정이면 보류한다"
     ]
    },
    {
     "id": "FPW.8-A14",
     "name": "정책 롤백 독립 승인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-REL"
      ],
      "I": [
       "R-OPS",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RBK-REQ"
     ],
     "outputs": [
      "WP-RBK-DEC"
     ],
     "next": [
      "FPW.8-A15"
     ],
     "screens": [
      "/ops/rollback"
     ],
     "actions": [
      "decideRollbackRequest",
      "decideRollbackPlan"
     ],
     "checks": [
      "요청자 자기 승인과 지정되지 않은 사람의 승인이 차단된다",
      "자동 계획 승인도 승인된 조건·범위를 넘지 않는다"
     ]
    },
    {
     "id": "FPW.8-A15",
     "name": "롤백 재검증·실행",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-REL",
       "R-SM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RBK-DEC"
     ],
     "outputs": [
      "WP-RBK-EXEC"
     ],
     "next": [
      "FPW.8-A16"
     ],
     "screens": [
      "/ops/rollback",
      "/deployments/:id"
     ],
     "actions": [
      "executeRollbackRequest"
     ],
     "checks": [
      "승인 후 상태·키·기준이 달라지면 재검증에서 차단된다",
      "실행 응답을 차량 적용 완료로 간주하지 않는다"
     ]
    },
    {
     "id": "FPW.8-A16",
     "name": "롤백 적용·미회신 확인",
     "processId": "FPW.8",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-REL"
      ],
      "I": [
       "R-SM",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-RBK-EXEC"
     ],
     "outputs": [
      "WP-RBK-CLOSE"
     ],
     "next": [],
     "screens": [
      "/ops/rollback",
      "/deployments/:id",
      "/fleet/vehicles/:vin"
     ],
     "actions": [],
     "checks": [
      "수신 ACK와 적용 READBACK을 구분한다",
      "누락 데이터는 대상 0 또는 성공으로 표시하지 않는다"
     ]
    }
   ]
  },
  {
   "id": "FPW.9",
   "name": "사후 검토·Flag Retirement",
   "products": [
    {
     "key": "WP-QUALITY-FEEDBACK",
     "name": "품질 피드백 기록",
     "content": [
      "이상·복원·드릴에서 나온 개선 항목과 담당",
      "시나리오 저장소에 추가한 트리거 조건과 재평가 대상"
     ]
    },
    {
     "key": "WP-RETIRE-REQ",
     "name": "Flag Retirement 요청",
     "content": [
      "Retirement 사유(만료·대체·폐기)와 다음 정기 릴리스 예정일",
      "영향 받는 차량·Variant와 구 Version 잔존 여부"
     ]
    },
    {
     "key": "WP-RETIRE-APPROVAL",
     "name": "Retirement 승인 기록",
     "content": [
      "승인자(F2 이상은 Safety Manager 포함)와 시각",
      "삭제 기한(승인 후 6개월 또는 다음 정기 릴리스 중 이른 시점)"
     ]
    },
    {
     "key": "WP-RETIRE-LOG",
     "name": "Retirement 단계 기록",
     "content": [
      "코드·설정·시험 삭제 단계별 완료 시각",
      "상태 보고로 확인한 구 Version 잔존 차량 수"
     ]
    },
    {
     "key": "WP-RETIRE-CLOSE",
     "name": "Lifecycle 종료 기록",
     "content": [
      "DEPRECATED·RETIRED 전이 시각",
      "Flag ID 재사용 금지 표시와 Catalog 퇴역 결과"
     ]
    },
    {
     "key": "WP-FLAG-REMOVAL-SCAN",
     "name": "Flag 제거 검토·스캔 결과",
     "content": [
      "Retirement 승인·제거 PR·병합 참조",
      "최종 값 분기 검토와 정적 분석 결과",
      "참조 잔존 수·마지막 스캔·수행자와 시각"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.9-A01",
     "name": "운영 결과 품질 피드백 수용",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-QA",
      "C": [
       "R-SM",
       "R-TST"
      ],
      "I": [
       "R-FO",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-DRILL-REPORT",
      "WP-RESTORE-ROLLOUT"
     ],
     "outputs": [
      "WP-QUALITY-FEEDBACK"
     ],
     "next": [],
     "screens": [
      "/quality/feedback"
     ],
     "actions": [
      "acceptFeedback"
     ],
     "checks": [
      "수용한 피드백마다 담당과 반영 대상(시나리오·Version)이 있다"
     ]
    },
    {
     "id": "FPW.9-A02",
     "name": "Flag Retirement 요청",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-REL",
       "R-INT"
      ],
      "I": [
       "R-SM",
       "R-REQ"
      ]
     },
     "inputs": [
      "WP-FEAT-REG"
     ],
     "outputs": [
      "WP-RETIRE-REQ"
     ],
     "next": [
      "FPW.9-A03"
     ],
     "screens": [
      "/flag-retirements"
     ],
     "actions": [
      "requestFlagRetirement"
     ],
     "checks": [
      "Retirement 요청에 사유와 영향 범위가 있다"
     ]
    },
    {
     "id": "FPW.9-A03",
     "name": "Flag Retirement 승인",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-REQ",
       "R-SM"
      ],
      "A": "R-REQ",
      "C": [
       "R-FO",
       "R-REL"
      ],
      "I": [
       "R-INT",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-RETIRE-REQ"
     ],
     "outputs": [
      "WP-RETIRE-APPROVAL"
     ],
     "next": [
      "FPW.9-A04"
     ],
     "screens": [
      "/flag-retirements"
     ],
     "actions": [
      "approveFlagRetirement"
     ],
     "checks": [
      "승인자가 요청자와 다르고 F2 이상에 Safety Manager 승인이 있다"
     ]
    },
    {
     "id": "FPW.9-A04",
     "name": "코드·설정·시험 삭제 기록",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-INT",
       "R-TST"
      ],
      "I": [
       "R-REL"
      ]
     },
     "inputs": [
      "WP-RETIRE-APPROVAL"
     ],
     "outputs": [
      "WP-RETIRE-LOG"
     ],
     "next": [
      "FPW.9-A06"
     ],
     "screens": [
      "/flag-retirements"
     ],
     "actions": [
      "recordFlagRetirementStep"
     ],
     "checks": [
      "Retirement 단계가 순서대로 모두 기록되고 잔존 차량이 0이다"
     ]
    },
    {
     "id": "FPW.9-A06",
     "name": "Flag 제거 PR 병합",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-FO",
      "C": [
       "R-TST"
      ],
      "I": [
       "R-REL"
      ]
     },
     "inputs": [
      "WP-RETIRE-LOG"
     ],
     "outputs": [
      "WP-FLAG-REMOVAL-SCAN"
     ],
     "next": [
      "FPW.9-A05"
     ],
     "screens": [
      "/flag-code/lifecycle",
      "/flag-retirements"
     ],
     "actions": [
      "createFlagRemovalPr",
      "recordFlagRetirementStep"
     ],
     "checks": [
      "제거 PR 병합 뒤 스캔에서 해당 Flag 참조가 0건이다"
     ]
    },
    {
     "id": "FPW.9-A05",
     "name": "Lifecycle 종료 전이",
     "processId": "FPW.9",
     "raci": {
      "R": [
       "R-REL"
      ],
      "A": "R-REL",
      "C": [
       "R-FO"
      ],
      "I": [
       "R-PO",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-RETIRE-LOG"
     ],
     "outputs": [
      "WP-RETIRE-CLOSE"
     ],
     "next": [],
     "screens": [
      "/features/:id/:ver"
     ],
     "actions": [
      "transition"
     ],
     "checks": [
      "Lifecycle이 RETIRED이고 Flag ID 재사용 금지 표시가 있다"
     ]
    }
   ]
  },
  {
   "id": "FPW.10",
   "name": "협력사 관리",
   "products": [
    {
     "key": "WP-SUPPLIER-CANDIDATE",
     "name": "협력사 후보·공급 범위",
     "content": [
      "후보 협력사와 공급할 SW·서비스 범위(LPC, Safety Guard, 시험 도구, 운영 서비스)",
      "ADS 관련 여부와 대상 시장"
     ]
    },
    {
     "key": "WP-SUPPLIER-ASSESS",
     "name": "협력사 역량 평가 결과",
     "content": [
      "ASPICE·사이버보안 평가 결과와 Feature Flag 특화 평가 질문 결과",
      "ADS 협력사의 SMS 역량 평가, 부족 항목의 개선 계획과 기한"
     ]
    },
    {
     "key": "WP-DIA",
     "name": "DIA·CIA 계약 부속서",
     "content": [
      "인용한 보고서 Version과 적용 장, RASIC, Gate별 납품물",
      "시간 예산 부속서, 결함·변경 통지 기한, 현장 지원 SLA",
      "당국 보고·리콜 판단을 위한 안전 정보 제공 범위와 기한"
     ]
    },
    {
     "key": "WP-SUPPLIER-DIFF",
     "name": "기존 구현 차이 보고",
     "content": [
      "재사용·인수한 Feature Flag 구현과 보고서 요구의 차이",
      "차이별 위험과 보완 계획"
     ]
    },
    {
     "key": "WP-CONFIRMATION-PLAN",
     "name": "확인 조치 계획",
     "content": [
      "협력사 범위의 확인 검토·감사·기능안전 평가와 수행자",
      "수행자 독립성 수준과 근거"
     ]
    },
    {
     "key": "WP-INTAKE-RESULT",
     "name": "입고 검사 결과",
     "content": [
      "검사 항목(IN-01~IN-12)별 OEM 환경 재실행 결과",
      "Gate별 합격 판정과 Supplier Gate 기록",
      "Safety Manual 사용 가정(AoU) 목록"
     ]
    },
    {
     "key": "WP-ORIGIN-RECORD",
     "name": "공급망 원산지 기록",
     "content": [
      "구성요소별 개발 주체·국가·소유·통제 속성(SBOM 연계)",
      "미국 시장 적합성 선언 근거와 10년 보존 위치"
     ]
    },
    {
     "key": "WP-EOL-RECORD",
     "name": "EOL 프로비저닝 검증 기록",
     "content": [
      "Feature별 초기 기록 쓰기와 프로비저닝 표식 설정 결과",
      "표식이 있는 ECU의 기록 누락 시 동작 확인 결과"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.10-A01",
     "name": "계약 전 협력사 역량 확인",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-PUR",
      "C": [
       "R-CSM",
       "R-SM"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-SUPPLIER-CANDIDATE"
     ],
     "outputs": [
      "WP-SUPPLIER-ASSESS"
     ],
     "next": [
      "FPW.10-A02"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "계약 전에 평가 결과와 부족 항목의 개선 계획이 있다"
     ]
    },
    {
     "id": "FPW.10-A02",
     "name": "DIA·CIA 체결",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-PUR",
       "R-REG"
      ],
      "A": "R-PUR",
      "C": [
       "R-LEG",
       "R-SM",
       "R-CSM",
       "R-QA"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-SUPPLIER-ASSESS"
     ],
     "outputs": [
      "WP-DIA"
     ],
     "next": [
      "FPW.10-A03",
      "FPW.10-A04"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "일곱 항목과 안전 정보 제공 조항이 모두 계약에 있다"
     ]
    },
    {
     "id": "FPW.10-A03",
     "name": "확인 조치 독립성 지정",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-QA"
      ],
      "I": [
       "R-PUR"
      ]
     },
     "inputs": [
      "WP-DIA"
     ],
     "outputs": [
      "WP-CONFIRMATION-PLAN"
     ],
     "next": [
      "FPW.10-A06"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "확인 조치마다 독립성을 만족하는 수행자가 지정되었다"
     ]
    },
    {
     "id": "FPW.10-A04",
     "name": "공급망 원산지 속성 관리",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-PUR"
      ],
      "A": "R-PUR",
      "C": [
       "R-CSM",
       "R-REG"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-DIA"
     ],
     "outputs": [
      "WP-ORIGIN-RECORD"
     ],
     "next": [
      "FPW.10-A06"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "대상 구성요소 모두에 원산지 속성이 있다"
     ]
    },
    {
     "id": "FPW.10-A05",
     "name": "기존 구현 진단",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-QA"
      ],
      "A": "R-QA",
      "C": [
       "R-ARC",
       "R-INT"
      ],
      "I": [
       "R-SM"
      ]
     },
     "inputs": [
      "WP-SUPPLIER-ASSESS"
     ],
     "outputs": [
      "WP-SUPPLIER-DIFF"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "차이 보고가 G2 영향 분석의 입력으로 등록되었다"
     ]
    },
    {
     "id": "FPW.10-A06",
     "name": "Gate별 납품물 입고 검사",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-QA",
       "R-TST"
      ],
      "A": "R-QA",
      "C": [
       "R-INT",
       "R-SM"
      ],
      "I": [
       "R-PUR"
      ]
     },
     "inputs": [
      "WP-DIA",
      "WP-CONFIRMATION-PLAN"
     ],
     "outputs": [
      "WP-INTAKE-RESULT"
     ],
     "next": [
      "FPW.10-A07"
     ],
     "screens": [
      "/supplier/portal"
     ],
     "actions": [
      "judgeGate"
     ],
     "checks": [
      "모든 검사 항목이 OEM 환경에서 재실행되었다",
      "판정 결과가 Supplier Gate 기록에 있다"
     ]
    },
    {
     "id": "FPW.10-A07",
     "name": "EOL 프로비저닝 검증",
     "processId": "FPW.10",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-TST",
       "R-PLM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-INTAKE-RESULT"
     ],
     "outputs": [
      "WP-EOL-RECORD"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "대상 ECU 모두 표식과 초기 기록이 확인되었다"
     ]
    }
   ]
  },
  {
   "id": "FPW.11",
   "name": "보안·키·취약점 관리",
   "products": [
    {
     "key": "WP-KEY-REGISTER",
     "name": "서명 키 대장",
     "content": [
      "용도별 키(활성화·차단·복원·정책 서명) 계층과 HSM 보관 위치",
      "승인 서명 기준 수와 긴급 절차",
      "교체 주기와 교체 이력"
     ]
    },
    {
     "key": "WP-KEY-INCIDENT",
     "name": "키 사고 대응 기록",
     "content": [
      "유출·오사용 징후, 영향 차량 범위",
      "key epoch 상향 시각과 대상 차량"
     ]
    },
    {
     "key": "WP-VEX-DECISION",
     "name": "VEX 판정·대응 결정",
     "content": [
      "취약점별 영향 Feature·차량(SBOM 대조)과 VEX 상태",
      "위험도와 대응(보안 사유 차단·업데이트)·CSMS 대응 기한"
     ]
    },
    {
     "key": "WP-CSMS-EVIDENCE",
     "name": "CSMS Evidence·R155 보고",
     "content": [
      "TARA·보안 요구·시험·모니터링 결과의 Evidence 목록",
      "승인 기관 보고 내용과 제출 시각"
     ]
    },
    {
     "key": "WP-OSS-PROGRAM",
     "name": "OSS 관리 프로그램 기록",
     "content": [
      "라이선스(ISO/IEC 5230)·보안(ISO/IEC 18974) 프로그램 운영 결과",
      "구성요소별 라이선스 의무 이행 상태"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.11-A01",
     "name": "서명 키 계층·HSM 운영",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-PKI"
      ],
      "A": "R-CSM",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-REL",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-HARA-TARA"
     ],
     "outputs": [
      "WP-KEY-REGISTER"
     ],
     "next": [
      "FPW.11-A02"
     ],
     "screens": [
      "/admin/security"
     ],
     "actions": [],
     "checks": [
      "키마다 용도·보관 위치·교체 주기가 대장에 있다"
     ]
    },
    {
     "id": "FPW.11-A02",
     "name": "키 교체 플랫폼 기록",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-PKI",
       "R-SM"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-KEY-REGISTER"
     ],
     "outputs": [
      "WP-KEY-REGISTER"
     ],
     "next": [],
     "screens": [
      "/admin/security"
     ],
     "actions": [
      "rotateKey"
     ],
     "checks": [
      "이전 키가 검증 전용으로 남고 대장이 갱신되었다"
     ]
    },
    {
     "id": "FPW.11-A03",
     "name": "키 유출 대응·epoch 상향",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-PKI",
       "R-SM"
      ],
      "I": [
       "R-OPS",
       "R-REG"
      ]
     },
     "inputs": [
      "WP-KEY-REGISTER"
     ],
     "outputs": [
      "WP-KEY-INCIDENT"
     ],
     "next": [
      "FPW.11-A05"
     ],
     "screens": [
      "/admin/security"
     ],
     "actions": [
      "bumpEpoch"
     ],
     "checks": [
      "epoch 상향 대상과 시각이 기록되었다"
     ]
    },
    {
     "id": "FPW.11-A04",
     "name": "취약점 영향 특정·대응 결정",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-OPS",
       "R-SM",
       "R-INT"
      ],
      "I": [
       "R-REL"
      ]
     },
     "inputs": [
      "WP-ORIGIN-RECORD",
      "WP-RELEASE-BASELINE"
     ],
     "outputs": [
      "WP-VEX-DECISION"
     ],
     "next": [
      "FPW.11-A05"
     ],
     "screens": [
      "/admin/security"
     ],
     "actions": [
      "recordVex"
     ],
     "checks": [
      "공지된 취약점마다 VEX 판정과 대응 기한이 있다"
     ]
    },
    {
     "id": "FPW.11-A06",
     "name": "OSS 라이선스·보안 프로그램 운영",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-LEG"
      ],
      "A": "R-LEG",
      "C": [
       "R-CSM",
       "R-PUR"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-ORIGIN-RECORD"
     ],
     "outputs": [
      "WP-OSS-PROGRAM"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "모든 OSS 구성요소의 의무 이행 상태가 기록되었다"
     ]
    },
    {
     "id": "FPW.11-A05",
     "name": "CSMS Evidence·R155 보고",
     "processId": "FPW.11",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-REG"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-HARA-TARA",
      "WP-VEX-DECISION",
      "WP-KEY-INCIDENT"
     ],
     "outputs": [
      "WP-CSMS-EVIDENCE"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "보고 내용의 각 항목이 Evidence ID로 연결되었다"
     ]
    }
   ]
  },
  {
   "id": "FPW.12",
   "name": "운영 데이터·데이터 보호",
   "products": [
    {
     "key": "WP-KPI-PLAN",
     "name": "운행 감시 지표·경보 기준",
     "content": [
      "Safety Case 주장과 연결한 운행 감시 지표",
      "지표별 경보 기준과 데이터 범주"
     ]
    },
    {
     "key": "WP-CONTEXT-REVIEW",
     "name": "평가 컨텍스트 속성 검토 기록",
     "content": [
      "허용 속성(가명 차량 ID 등)과 금지 속성 목록",
      "금지 속성 거부 시험 결과"
     ]
    },
    {
     "key": "WP-DATA-TRANSFER",
     "name": "데이터 국외 이전 심사 기록",
     "content": [
      "중요 데이터 식별 결과와 현지 처리 위치",
      "이전 경로별 심사 방식(안전 평가·표준 계약·인증)"
     ]
    },
    {
     "key": "WP-DATA-ACCESS",
     "name": "데이터 접근 요청·계약 근거 기록",
     "content": [
      "요청자·대상 차량·제공한 Feature 상태·이력",
      "OEM 비개인 데이터 이용 계약 근거 문서 ID"
     ]
    },
    {
     "key": "WP-RETENTION-LOG",
     "name": "보존·삭제 기록",
     "content": [
      "범주별 삭제 건수와 시각",
      "열린 Incident·이상 건에 연결되어 보류한 데이터"
     ]
    },
    {
     "key": "WP-PRIVACY-REVIEW",
     "name": "개인정보 목적·근거 검토",
     "content": [
      "처리 목적·최소 항목·정보주체·동의 또는 적법 근거의 원본 참조",
      "접근·보존·국외 이전 제한·검토 담당자·미확정 사항"
     ]
    },
    {
     "key": "WP-PRIVACY-REQ",
     "name": "정보주체 처리 요청",
     "content": [
      "검증된 요청자·대상 사용자/차량과 요청 종류",
      "대상 저장소·미리 집계한 행·요청 사유와 요청자"
     ]
    },
    {
     "key": "WP-PRIVACY-RESULT",
     "name": "정보주체 처리 결과",
     "content": [
      "요청자와 다른 실행자·근거·처리/거절 시각",
      "내보내기 또는 삭제/가명화 결과·Lake 위임 상태·감사 체인 보존"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.12-A01",
     "name": "운행 감시 지표·경보 기준 기록",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-OPS",
       "R-DPO"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-SAFETY-CASE"
     ],
     "outputs": [
      "WP-KPI-PLAN"
     ],
     "next": [],
     "screens": [
      "/ops/safety-kpi"
     ],
     "actions": [
      "recordSafetyKpiPlan"
     ],
     "checks": [
      "지표마다 경보 기준과 데이터 범주가 있다"
     ]
    },
    {
     "id": "FPW.12-A03",
     "name": "중국 데이터 현지 처리·이전 심사",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-LEG"
      ],
      "A": "R-LEG",
      "C": [
       "R-DPO",
       "R-REG"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-KPI-PLAN"
     ],
     "outputs": [
      "WP-DATA-TRANSFER"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "모든 국외 이전 경로에 심사 방식과 결과가 있다"
     ]
    },
    {
     "id": "FPW.12-A04",
     "name": "EU 데이터 접근 요청 처리",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-LEG",
       "R-DPO"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-KPI-PLAN"
     ],
     "outputs": [
      "WP-DATA-ACCESS"
     ],
     "next": [],
     "screens": [
      "/admin/data"
     ],
     "actions": [
      "createDataAccessRequest",
      "recordDataActContractBasis"
     ],
     "checks": [
      "요청마다 제공 내용과 계약 근거가 기록되었다"
     ]
    },
    {
     "id": "FPW.12-A02",
     "name": "평가 컨텍스트 개인정보 검토",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-DPO"
      ],
      "A": "R-DPO",
      "C": [
       "R-ARC",
       "R-LEG"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [
      "WP-POLICY"
     ],
     "outputs": [
      "WP-CONTEXT-REVIEW"
     ],
     "next": [],
     "screens": [
      "/integration/openfeature"
     ],
     "actions": [],
     "checks": [
      "금지 속성 거부 시험이 통과했다"
     ]
    },
    {
     "id": "FPW.12-A05",
     "name": "보존 기간 경과 데이터 삭제",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-DPO",
       "R-OPS"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-KPI-PLAN"
     ],
     "outputs": [
      "WP-RETENTION-LOG"
     ],
     "next": [],
     "screens": [
      "/admin/data"
     ],
     "actions": [
      "retentionSweep"
     ],
     "checks": [
      "삭제 기록에 범주별 건수와 보류 사유가 있다"
     ]
    },
    {
     "id": "FPW.12-A06",
     "name": "처리 목적·근거 검토",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-DPO"
      ],
      "A": "R-DPO",
      "C": [
       "R-LEG",
       "R-CSM"
      ],
      "I": [
       "R-OPS"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-PRIVACY-REVIEW"
     ],
     "next": [
      "FPW.12-A07"
     ],
     "screens": [
      "/admin/data"
     ],
     "actions": [],
     "checks": [
      "화면 조회나 데모 값으로 동의 획득을 대신하지 않는다",
      "적용 시장과 실제 검토 근거를 식별한다"
     ]
    },
    {
     "id": "FPW.12-A07",
     "name": "정보주체 요청 접수",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-DPO",
       "R-LEG"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-PRIVACY-REVIEW"
     ],
     "outputs": [
      "WP-PRIVACY-REQ"
     ],
     "next": [
      "FPW.12-A08"
     ],
     "screens": [
      "/admin/data"
     ],
     "actions": [
      "createPrivacyRequest"
     ],
     "checks": [
      "대상 식별자와 목적을 무단 확대하지 않는다",
      "요청 접수를 실제 삭제 완료로 표시하지 않는다"
     ]
    },
    {
     "id": "FPW.12-A08",
     "name": "정보주체 독립 처리",
     "processId": "FPW.12",
     "raci": {
      "R": [
       "R-CSM"
      ],
      "A": "R-CSM",
      "C": [
       "R-DPO"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-PRIVACY-REQ"
     ],
     "outputs": [
      "WP-PRIVACY-RESULT"
     ],
     "next": [],
     "screens": [
      "/admin/data"
     ],
     "actions": [
      "privacyExport",
      "executePrivacyRequest",
      "rejectPrivacyRequest"
     ],
     "checks": [
      "삭제·가명화 요청자 자기 실행이 차단된다",
      "Lake 요청 전송과 외부 삭제 완료를 구분한다"
     ]
    }
   ]
  },
  {
   "id": "FPW.13",
   "name": "규정·Compliance Profile 관리",
   "products": [
    {
     "key": "WP-REG-SOURCES",
     "name": "법규·표준 원문",
     "content": [
      "시장별 법규 최종 법문과 발효·적용일",
      "표준 판과 개정 예고"
     ]
    },
    {
     "key": "WP-STANDARD-EDITIONS",
     "name": "표준 판 고정 기록(Safety Plan)",
     "content": [
      "ISO 26262·ISO 21448·ISO/SAE 21434의 적용 판",
      "정식 발행 전 개정 요구를 Gate 판정 기준에서 뺀다는 표시"
     ]
    },
    {
     "key": "WP-COMPLIANCE-PROFILE",
     "name": "시장별 Compliance Profile",
     "content": [
      "시장별 적용 법규·의무 기능·필수 Evidence·게이트 파라미터",
      "ADS 규정의 국내 도입·발효 상태와 최종 법문 대조 결과",
      "Profile 버전과 갱신 이력, '검증 필요' 항목과 해소 기한"
     ]
    },
    {
     "key": "WP-SYSTEM-DESCRIPTION",
     "name": "원격 종료 시스템 설명",
     "content": [
      "원격 종료·복원 방법과 발동 사유·승인자·긴급 권한·해제 기준",
      "시장별 차이와 운영 절차(FPW.8)와의 대응"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.13-A01",
     "name": "표준 판 고정",
     "processId": "FPW.13",
     "raci": {
      "R": [
       "R-SM"
      ],
      "A": "R-SM",
      "C": [
       "R-CSM",
       "R-REG"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-REG-SOURCES"
     ],
     "outputs": [
      "WP-STANDARD-EDITIONS"
     ],
     "next": [
      "FPW.13-A02"
     ],
     "screens": [],
     "actions": [],
     "checks": [
      "Safety Plan에 세 표준의 적용 판이 적혀 있다"
     ]
    },
    {
     "id": "FPW.13-A02",
     "name": "Compliance Profile 정의",
     "processId": "FPW.13",
     "raci": {
      "R": [
       "R-REG"
      ],
      "A": "R-REG",
      "C": [
       "R-SM",
       "R-CSM",
       "R-LEG"
      ],
      "I": [
       "R-FO",
       "R-OPS"
      ]
     },
     "inputs": [
      "WP-STANDARD-EDITIONS",
      "WP-REG-SOURCES"
     ],
     "outputs": [
      "WP-COMPLIANCE-PROFILE"
     ],
     "next": [
      "FPW.13-A04"
     ],
     "screens": [
      "/verify/compliance"
     ],
     "actions": [],
     "checks": [
      "대상 시장마다 Profile 버전이 있고 ADS 조항의 대조 결과가 있다"
     ]
    },
    {
     "id": "FPW.13-A03",
     "name": "분기 법규 감시·Profile 갱신",
     "processId": "FPW.13",
     "raci": {
      "R": [
       "R-REG",
       "R-SM",
       "R-CSM"
      ],
      "A": "R-REG",
      "C": [
       "R-LEG"
      ],
      "I": [
       "R-FO",
       "R-OPS",
       "R-QA"
      ]
     },
     "inputs": [
      "WP-REG-SOURCES",
      "WP-COMPLIANCE-PROFILE"
     ],
     "outputs": [
      "WP-COMPLIANCE-PROFILE"
     ],
     "next": [],
     "screens": [
      "/verify/compliance",
      "/trace/ads"
     ],
     "actions": [],
     "checks": [
      "분기 점검 기록과 Profile 새 버전(또는 무변경 확인)이 있다"
     ]
    },
    {
     "id": "FPW.13-A04",
     "name": "원격 종료 시스템 설명 작성",
     "processId": "FPW.13",
     "raci": {
      "R": [
       "R-REG",
       "R-OPS"
      ],
      "A": "R-REG",
      "C": [
       "R-SM",
       "R-CSM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-COMPLIANCE-PROFILE",
      "WP-DRILL-REPORT"
     ],
     "outputs": [
      "WP-SYSTEM-DESCRIPTION"
     ],
     "next": [],
     "screens": [],
     "actions": [],
     "checks": [
      "시스템 설명과 FPW.8 운영 절차의 승인자·기준이 일치한다"
     ]
    }
   ]
  },
  {
   "id": "FPW.14",
   "name": "Feature DB 운영",
   "products": [
    {
     "key": "WP-REF-CHANGE-REQ",
     "name": "기준 행 변경 요청",
     "content": [
      "요청 종류(추가·수정·폐기 예정·폐기)와 대상 기준 행 ID",
      "필드별 변경 전후 값과 사유·1차 출처 위치",
      "이 행을 쓰는 FF Feature와 진행 중 산정 과제 목록(영향 표시)"
     ]
    },
    {
     "key": "WP-REF-REVIEW",
     "name": "자동 점검·도메인 검토 기록",
     "content": [
      "등록 기준 점검 결과(통과·보완 필요·필수 정보 누락) 항목별 표시",
      "도메인 검토자 의견(동의·보완·반대)과 근거",
      "검토자가 요청자와 다른 사람이라는 확인"
     ]
    },
    {
     "key": "WP-REF-DECISION",
     "name": "변경 승인·반려 기록",
     "content": [
      "승인·반려 판정과 사유, 판정자와 시각",
      "승인된 필드 차이의 적용 결과(발행 대기 표시)",
      "반려된 추가 요청의 요청 중 행(발행 때 폐기·알림 대상)"
     ]
    },
    {
     "key": "WP-REFDB-RELEASE",
     "name": "Feature DB 발행본",
     "content": [
      "발행 번호(v1.4 등)와 묶인 승인 요청 목록",
      "요청 중 행의 확정 상태(활성·검토 필요, 반려된 추가 요청은 폐기와 사유)와 알림 받은 Feature Owner",
      "전체 기준 행 정규화 해시와 상태별 행 수",
      "품질 지표(출처 없는 행·근거 확인 12개월 경과 행·규모 근거 D 비중·발행 대기 요청 수)",
      "분류 체계(도메인·클러스터·컴포넌트)와 출처 목록"
     ]
    },
    {
     "key": "WP-REF-SOURCE-REVIEW",
     "name": "출처 정기 점검 기록",
     "content": [
      "다음 점검일이 지난 출처와 점검 결과(변경 없음·개정 있음)",
      "개정이 있는 출처에서 나온 후속 변경 요청 대상 행",
      "출처별 새 다음 점검일"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.14-A01",
     "name": "변경 요청 작성",
     "processId": "FPW.14",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-ARC"
      ],
      "I": [
       "R-RDA",
       "R-DRV"
      ]
     },
     "inputs": [
      "WP-REF-LINK"
     ],
     "outputs": [
      "WP-REF-CHANGE-REQ"
     ],
     "next": [
      "FPW.14-A02"
     ],
     "screens": [
      "/master/feature-db/:refId"
     ],
     "actions": [
      "createRefChange"
     ],
     "checks": [
      "변경 요청에 필드별 변경 전후 값과 사유·출처가 있다",
      "폐기 예정·폐기 요청에 대체 행 또는 대체 없음 사유가 있다"
     ]
    },
    {
     "id": "FPW.14-A02",
     "name": "자동 점검·도메인 검토",
     "processId": "FPW.14",
     "raci": {
      "R": [
       "R-DRV"
      ],
      "A": "R-DRV",
      "C": [
       "R-SM"
      ],
      "I": [
       "R-RDA",
       "R-FO"
      ]
     },
     "inputs": [
      "WP-REF-CHANGE-REQ",
      "WP-REF-ADD-REQ"
     ],
     "outputs": [
      "WP-REF-REVIEW"
     ],
     "next": [
      "FPW.14-A03"
     ],
     "screens": [
      "/master/feature-db/changes/:id",
      "/master/feature-db/changes"
     ],
     "actions": [
      "reviewRefChange"
     ],
     "checks": [
      "검토 의견이 비어 있지 않고 검토자가 요청자와 다른 사람이다",
      "필수 정보 누락 항목이 남아 있지 않다"
     ]
    },
    {
     "id": "FPW.14-A03",
     "name": "변경 승인·반려",
     "processId": "FPW.14",
     "raci": {
      "R": [
       "R-RDA"
      ],
      "A": "R-RDA",
      "C": [
       "R-DRV"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-REF-CHANGE-REQ",
      "WP-REF-ADD-REQ",
      "WP-REF-REVIEW"
     ],
     "outputs": [
      "WP-REF-DECISION"
     ],
     "next": [
      "FPW.14-A04"
     ],
     "screens": [
      "/master/feature-db/changes/:id",
      "/master/feature-db/changes"
     ],
     "actions": [
      "decideRefChange"
     ],
     "checks": [
      "승인자가 요청자와도, 그 요청의 도메인 검토자와도 다른 사람이고 판정 사유가 있다",
      "승인된 변경은 발행 전까지 발행 대기로 표시되어 등록 화면에 반영되지 않았다"
     ]
    },
    {
     "id": "FPW.14-A04",
     "name": "Feature DB 버전 발행",
     "processId": "FPW.14",
     "raci": {
      "R": [
       "R-RDA"
      ],
      "A": "R-RDA",
      "C": [],
      "I": [
       "R-FO",
       "R-DRV",
       "R-PLM"
      ]
     },
     "inputs": [
      "WP-REF-DECISION"
     ],
     "outputs": [
      "WP-REFDB-RELEASE"
     ],
     "next": [],
     "screens": [
      "/master/feature-db/changes"
     ],
     "actions": [
      "publishRefRelease"
     ],
     "checks": [
      "발행 번호·묶인 요청 목록·정규화 해시가 발행 기록에 있다",
      "발행 대기 요청 수가 0이다",
      "반려된 추가 요청의 요청 중 행이 남아 있지 않다"
     ]
    },
    {
     "id": "FPW.14-A05",
     "name": "출처 정기 점검",
     "processId": "FPW.14",
     "raci": {
      "R": [
       "R-RDA"
      ],
      "A": "R-RDA",
      "C": [
       "R-REG",
       "R-DRV"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-REFDB-RELEASE"
     ],
     "outputs": [
      "WP-REF-SOURCE-REVIEW"
     ],
     "next": [],
     "screens": [
      "/master/feature-db"
     ],
     "actions": [
      "recordSourceReview"
     ],
     "checks": [
      "기한이 지난 출처마다 점검 결과와 새 다음 점검일이 있다"
     ]
    }
   ]
  },
  {
   "id": "FPW.15",
   "name": "SW 개발비·원가 기준 관리",
   "products": [
    {
     "key": "WP-COST-SCOPE",
     "name": "산정 범위·과제",
     "content": [
      "대상 Feature/버전·기준 행·작성자",
      "차량/시장·포함/제외·가정과 과제 설정"
     ]
    },
    {
     "key": "WP-COST-BASIS",
     "name": "발행 원가 기준",
     "content": [
      "단가·계수·통화·근거 출처와 버전",
      "초안과 발행자·사유·적용 시점"
     ]
    },
    {
     "key": "WP-COST-CALC",
     "name": "산정 입력·계산 결과",
     "content": [
      "줄별 규모·공수·MBD 입력과 근거",
      "계산 오류·합계·적용 기준 버전"
     ]
    },
    {
     "key": "WP-COST-REVIEW",
     "name": "산정 검토·승인 기록",
     "content": [
      "검토 체크·제출·승인/반려 사유와 사람·시각",
      "승인 스냅샷과 개정 관계"
     ]
    },
    {
     "key": "WP-COST-SHARE",
     "name": "산정 결과 공유 기록",
     "content": [
      "열람/내보내기 대상·권한·버전",
      "내보내기 감사 기록과 공유 제한"
     ]
    },
    {
     "key": "WP-COST-ACTUAL",
     "name": "실적·오차 검토",
     "content": [
      "승인 뒤 실적 공수·출처·편차",
      "교정 제안과 다음 기준 개정의 채택/보류 근거"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.15-A01",
     "name": "산정 범위 설정",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CE"
      ],
      "A": "R-CE",
      "C": [
       "R-FO",
       "R-PUR"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [
      "WP-REF-LINK"
     ],
     "outputs": [
      "WP-COST-SCOPE"
     ],
     "next": [
      "FPW.15-A03"
     ],
     "screens": [
      "/procurement/sw-cost",
      "/procurement/sw-cost/:estId"
     ],
     "actions": [
      "costProjectCreate",
      "costFeatureAdd",
      "costProjectUpdate"
     ],
     "checks": [
      "대상과 가정이 과제 설정에 남는다"
     ]
    },
    {
     "id": "FPW.15-A02",
     "name": "원가 기준 발행",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CBA"
      ],
      "A": "R-CBA",
      "C": [
       "R-CE",
       "R-PUR"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-COST-BASIS"
     ],
     "next": [],
     "screens": [
      "/procurement/sw-cost/basis"
     ],
     "actions": [
      "costBasisDraft",
      "costBasisPublish"
     ],
     "checks": [
      "과거 승인 산정은 발행 전 스냅샷을 유지한다",
      "기준 버전과 변경 사유가 남는다"
     ]
    },
    {
     "id": "FPW.15-A03",
     "name": "공수·규모 입력",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CE"
      ],
      "A": "R-CE",
      "C": [
       "R-ARC",
       "R-INT"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [
      "WP-COST-SCOPE",
      "WP-COST-BASIS"
     ],
     "outputs": [
      "WP-COST-CALC"
     ],
     "next": [
      "FPW.15-A04"
     ],
     "screens": [
      "/procurement/sw-cost/:estId"
     ],
     "actions": [
      "costLineUpdate",
      "costMbdPut"
     ],
     "checks": [
      "필수 입력 오류가 해소되거나 보류 사유가 남는다",
      "줄별 입력과 계산 기준을 재현할 수 있다"
     ]
    },
    {
     "id": "FPW.15-A04",
     "name": "산정 검토 요청",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CE"
      ],
      "A": "R-CE",
      "C": [
       "R-PUR"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [
      "WP-COST-CALC"
     ],
     "outputs": [
      "WP-COST-REVIEW"
     ],
     "next": [
      "FPW.15-A05"
     ],
     "screens": [
      "/procurement/sw-cost/:estId"
     ],
     "actions": [
      "costCheckPut",
      "costTransition"
     ],
     "checks": [
      "제출과 미해결 항목이 기록된다"
     ]
    },
    {
     "id": "FPW.15-A05",
     "name": "산정 승인·반려",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CA"
      ],
      "A": "R-CA",
      "C": [
       "R-PUR"
      ],
      "I": [
       "R-CE",
       "R-CV"
      ]
     },
     "inputs": [
      "WP-COST-REVIEW",
      "WP-COST-CALC"
     ],
     "outputs": [
      "WP-COST-REVIEW"
     ],
     "next": [
      "FPW.15-A06"
     ],
     "screens": [
      "/procurement/sw-cost/:estId"
     ],
     "actions": [
      "costCheckPut",
      "costTransition"
     ],
     "checks": [
      "자기 작성 과제의 승인이 차단된다",
      "판정자·사유와 승인 스냅샷이 추적된다"
     ]
    },
    {
     "id": "FPW.15-A06",
     "name": "승인 결과 열람·공유",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CV"
      ],
      "A": "R-PUR",
      "C": [
       "R-CE"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [
      "WP-COST-REVIEW"
     ],
     "outputs": [
      "WP-COST-SHARE"
     ],
     "next": [],
     "screens": [
      "/procurement/sw-cost",
      "/procurement/sw-cost/:estId"
     ],
     "actions": [],
     "checks": [
      "조회가 작성·승인 권한으로 확대되지 않는다",
      "공유한 버전과 대상이 식별된다"
     ]
    },
    {
     "id": "FPW.15-A07",
     "name": "실적·교정 검토",
     "processId": "FPW.15",
     "raci": {
      "R": [
       "R-CE"
      ],
      "A": "R-CBA",
      "C": [
       "R-PUR"
      ],
      "I": [
       "R-CA"
      ]
     },
     "inputs": [
      "WP-COST-REVIEW"
     ],
     "outputs": [
      "WP-COST-ACTUAL"
     ],
     "next": [],
     "screens": [
      "/procurement/sw-cost/:estId",
      "/procurement/sw-cost/basis"
     ],
     "actions": [
      "costActualPut"
     ],
     "checks": [
      "실적 입력이 승인 금액을 소급 변경하지 않는다",
      "교정 제안은 기준 개정 전 자동 적용되지 않는다"
     ]
    }
   ]
  },
  {
   "id": "FPW.16",
   "name": "플랫폼 접근·운영·복구",
   "products": [
    {
     "key": "WP-ACCESS-CHANGE",
     "name": "계정 상태 변경 기록",
     "content": [
      "입퇴사·전보 근거·대상 계정·변경 사유",
      "비활성/재활성 결과·실행자·시각·미확인 상태"
     ]
    },
    {
     "key": "WP-OWNER-HANDOVER",
     "name": "기록 소유자 이관",
     "content": [
      "부재/비활성 원소유자·새 적격 소유자·대상 기록",
      "이관 사유·전후 소유자·내용/버전/상태 보존 확인"
     ]
    },
    {
     "key": "WP-PLATFORM-OPS",
     "name": "플랫폼 운영 점검",
     "content": [
      "서버 운영 설정의 변경 승인 근거·연결 상태",
      "관측 지표·장애·담당자와 외부 운영 증거"
     ]
    },
    {
     "key": "WP-RECOVERY-DRILL",
     "name": "백업·복구 점검 기록",
     "content": [
      "백업 범위·식별자·보관 정책과 복구 절차",
      "격리된 복구 실행 시각·정합성·복구 시간·미해결 항목"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.16-A01",
     "name": "계정 상태 변경",
     "processId": "FPW.16",
     "raci": {
      "R": [
       "R-SYS"
      ],
      "A": "R-SYS",
      "C": [
       "R-CSM"
      ],
      "I": [
       "R-QA",
       "R-OPS"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-ACCESS-CHANGE"
     ],
     "next": [
      "FPW.16-A02"
     ],
     "screens": [
      "/admin/iam"
     ],
     "actions": [
      "deactivateAccount",
      "reactivateAccount"
     ],
     "checks": [
      "미확인 또는 실패 응답을 변경 완료로 기록하지 않는다",
      "계정 상태 기록이 역할 부여 권한으로 확대되지 않는다"
     ]
    },
    {
     "id": "FPW.16-A02",
     "name": "부재 소유자 이관",
     "processId": "FPW.16",
     "raci": {
      "R": [
       "R-SYS"
      ],
      "A": "R-SYS",
      "C": [
       "R-REG"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-ACCESS-CHANGE"
     ],
     "outputs": [
      "WP-OWNER-HANDOVER"
     ],
     "next": [],
     "screens": [
      "/admin/iam",
      "/verify/compliance"
     ],
     "actions": [
      "transferComplianceRuleOwner"
     ],
     "checks": [
      "활성 소유자의 기록이나 부적격 새 소유자 이관이 차단된다",
      "기록 본문을 고치지 않고 소유권만 변경한다"
     ]
    },
    {
     "id": "FPW.16-A03",
     "name": "운영 설정·상태 점검",
     "processId": "FPW.16",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SYS",
       "R-CSM"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-PLATFORM-OPS"
     ],
     "next": [],
     "screens": [
      "/admin/settings",
      "/events",
      "/notifications/rules"
     ],
     "actions": [],
     "checks": [
      "개발 PC 설정을 원격 운영 확인 근거로 쓰지 않는다",
      "관측 실패와 미확인 연결은 정상 완료와 구분한다"
     ]
    },
    {
     "id": "FPW.16-A04",
     "name": "백업·복구 점검",
     "processId": "FPW.16",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-SYS",
       "R-CSM",
       "R-DPO"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-PLATFORM-OPS"
     ],
     "outputs": [
      "WP-RECOVERY-DRILL"
     ],
     "next": [],
     "screens": [
      "/admin/settings"
     ],
     "actions": [],
     "checks": [
      "계획서 존재만으로 복구 성공을 판정하지 않는다",
      "실제 실행 환경과 증거 위치가 기록된다"
     ]
    }
   ]
  },
  {
   "id": "FPW.17",
   "name": "기준정보·공유 자산·연계 품질",
   "products": [
    {
     "key": "WP-MASTER-VALUES",
     "name": "기준 값 관리 기록",
     "content": [
      "판매국·지역·차종·트림 코드와 상위 관계",
      "등록/사용 중지 사유·영향 기록과 새 선택지 제외"
     ]
    },
    {
     "key": "WP-ASSET-TRACE",
     "name": "구조·공유 자산 추적",
     "content": [
      "ECU·SW·Function·Feature·제어점·UPG 연결",
      "공유 자산 영향 범위·EO 변경 근거·누락 관계"
     ]
    },
    {
     "key": "WP-DATA-QUALITY",
     "name": "데이터 사전 점검",
     "content": [
      "점검 범위·오류·경고와 원천 소유자",
      "수정 또는 예외 사유·재점검 결과"
     ]
    },
    {
     "key": "WP-INTEGRATION-RECON",
     "name": "연계·대사 처리 기록",
     "content": [
      "연계 시스템·주소 참조·변환 규칙 버전",
      "보낸/받은 함·충돌·거부·재시도 결과와 원천 책임"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.17-A01",
     "name": "차량·시장 기준 관리",
     "processId": "FPW.17",
     "raci": {
      "R": [
       "R-PLM"
      ],
      "A": "R-PLM",
      "C": [
       "R-FO",
       "R-REG"
      ],
      "I": [
       "R-INT"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-MASTER-VALUES"
     ],
     "next": [
      "FPW.17-A02"
     ],
     "screens": [
      "/master/reference-values"
     ],
     "actions": [
      "createReferenceValue",
      "retireReferenceValue"
     ],
     "checks": [
      "하위 기준 값이 올바른 상위 코드에 연결된다",
      "기존 차량·Feature 이력을 소급 삭제하지 않는다"
     ]
    },
    {
     "id": "FPW.17-A02",
     "name": "구조·공유 자산 검토",
     "processId": "FPW.17",
     "raci": {
      "R": [
       "R-ARC"
      ],
      "A": "R-ARC",
      "C": [
       "R-INT",
       "R-PLM"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-MASTER-VALUES"
     ],
     "outputs": [
      "WP-ASSET-TRACE"
     ],
     "next": [
      "FPW.17-A03"
     ],
     "screens": [
      "/master/taxonomy",
      "/master/upg",
      "/master/structure",
      "/features/shared-assets",
      "/change/eo"
     ],
     "actions": [],
     "checks": [
      "공유 자산 한 곳의 변경이 영향을 주는 Feature를 식별한다",
      "조회 결과를 원천 구조의 변경 완료로 간주하지 않는다"
     ]
    },
    {
     "id": "FPW.17-A03",
     "name": "사전 품질 점검",
     "processId": "FPW.17",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-PLM",
       "R-ARC"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-ASSET-TRACE"
     ],
     "outputs": [
      "WP-DATA-QUALITY"
     ],
     "next": [],
     "screens": [
      "/precheck",
      "/trace/coverage"
     ],
     "actions": [],
     "checks": [
      "점검 범위와 미해결 오류의 담당자가 있다",
      "커버리지 비율만으로 설계 일관성이나 안전 승인을 대신하지 않는다"
     ]
    },
    {
     "id": "FPW.17-A04",
     "name": "외부 연계 대사",
     "processId": "FPW.17",
     "raci": {
      "R": [
       "R-INT"
      ],
      "A": "R-INT",
      "C": [
       "R-ARC",
       "R-REL"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-DATA-QUALITY"
     ],
     "outputs": [
      "WP-INTEGRATION-RECON"
     ],
     "next": [],
     "screens": [
      "/integration/connectors"
     ],
     "actions": [
      "resolveExtConflict",
      "drainExtSync"
     ],
     "checks": [
      "외부 상태를 플랫폼 Guard를 우회하여 덮어쓰지 않는다",
      "재전송 요청과 외부 반영 완료를 구분한다"
     ]
    },
    {
     "id": "FPW.17-A05",
     "name": "생산·Legacy 대사",
     "processId": "FPW.17",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-PLM",
       "R-INT"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [
      "WP-MASTER-VALUES",
      "WP-DATA-QUALITY"
     ],
     "outputs": [
      "WP-INTEGRATION-RECON"
     ],
     "next": [],
     "screens": [
      "/integration/sync",
      "/integration/legacy",
      "/field",
      "/baselines/eol"
     ],
     "actions": [
      "runSync",
      "importPlantOrders",
      "translateLegacy"
     ],
     "checks": [
      "Legacy 경로가 F2 이상 제한을 우회하지 않는다",
      "변환 계획과 실차 적용 결과를 구분한다"
     ]
    }
   ]
  },
  {
   "id": "FPW.18",
   "name": "운영 분석·상품 개선",
   "products": [
    {
     "key": "WP-ANALYSIS-SCOPE",
     "name": "분석 목적·데이터 검토",
     "content": [
      "목적·모집단·기간·데이터 범주와 처리 근거",
      "가명화·접근·보존 및 국외 이전 검토와 미확정 사항"
     ]
    },
    {
     "key": "WP-OPS-ANALYSIS",
     "name": "운영·전환 분석 결과",
     "content": [
      "쿼리·기간·분모·누락·출처와 결과",
      "품질·사용·체험 수락/전환 지표와 해석 한계"
     ]
    },
    {
     "key": "WP-IMPROVEMENT-HANDOFF",
     "name": "상품·품질 개선 인계",
     "content": [
      "가설·우선순위·고객/안전/보안 영향",
      "담당 부서·검증 방법·후속 Feature/정책/상품 요청 참조"
     ]
    }
   ],
   "activities": [
    {
     "id": "FPW.18-A01",
     "name": "분석 목적·데이터 검토",
     "processId": "FPW.18",
     "raci": {
      "R": [
       "R-PDA"
      ],
      "A": "R-PDA",
      "C": [
       "R-DPO",
       "R-LEG",
       "R-OPS"
      ],
      "I": [
       "R-QA"
      ]
     },
     "inputs": [],
     "outputs": [
      "WP-ANALYSIS-SCOPE"
     ],
     "next": [
      "FPW.18-A02"
     ],
     "screens": [
      "/data/workbench",
      "/biz/trials"
     ],
     "actions": [],
     "checks": [
      "접근 가능하다는 이유만으로 새로운 이용 목적을 허용하지 않는다",
      "외부 검토의 담당자와 근거가 식별된다"
     ]
    },
    {
     "id": "FPW.18-A02",
     "name": "운영·품질 데이터 분석",
     "processId": "FPW.18",
     "raci": {
      "R": [
       "R-OPS"
      ],
      "A": "R-OPS",
      "C": [
       "R-QA",
       "R-TST"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-ANALYSIS-SCOPE"
     ],
     "outputs": [
      "WP-OPS-ANALYSIS"
     ],
     "next": [
      "FPW.18-A03"
     ],
     "screens": [
      "/data/workbench",
      "/ops/telemetry",
      "/fleet/map",
      "/fleet/vehicles",
      "/fleet/vehicles/:vin"
     ],
     "actions": [],
     "checks": [
      "수신 없음과 정상 0건을 구분한다",
      "차량 회신과 실제 적용 근거를 구분한다"
     ]
    },
    {
     "id": "FPW.18-A03",
     "name": "체험·전환 분석",
     "processId": "FPW.18",
     "raci": {
      "R": [
       "R-PDA"
      ],
      "A": "R-PDA",
      "C": [
       "R-PO",
       "R-DPO"
      ],
      "I": [
       "R-FO"
      ]
     },
     "inputs": [
      "WP-ANALYSIS-SCOPE"
     ],
     "outputs": [
      "WP-OPS-ANALYSIS"
     ],
     "next": [
      "FPW.18-A04"
     ],
     "screens": [
      "/biz/trials",
      "/products",
      "/entitlements"
     ],
     "actions": [],
     "checks": [
      "제안 수와 수락 수 및 구매 수를 혼동하지 않는다",
      "상관관계만으로 인과 효과를 확정하지 않는다"
     ]
    },
    {
     "id": "FPW.18-A04",
     "name": "개선 과제 인계",
     "processId": "FPW.18",
     "raci": {
      "R": [
       "R-FO"
      ],
      "A": "R-FO",
      "C": [
       "R-PDA",
       "R-QA",
       "R-SM",
       "R-CSM"
      ],
      "I": [
       "R-PO"
      ]
     },
     "inputs": [
      "WP-OPS-ANALYSIS"
     ],
     "outputs": [
      "WP-IMPROVEMENT-HANDOFF"
     ],
     "next": [],
     "screens": [
      "/data/workbench",
      "/products"
     ],
     "actions": [],
     "checks": [
      "분석 결과만으로 승인·배포·활성화하지 않는다",
      "개선 과제와 근거 및 책임자가 연결된다"
     ]
    }
   ]
  }
 ]
};

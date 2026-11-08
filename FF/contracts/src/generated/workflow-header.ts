// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowDoc } from '../rules/workflows';
export const WORKFLOW_HEADER: Omit<WorkflowDoc, 'processes'> = {
 "schema": 1,
 "referenceModel": {
  "id": "FFP-BRM",
  "title": "Feature Platform 업무 레퍼런스 모델",
  "version": "0.3.0",
  "status": "draft",
  "scope": "기존 14개 부서의 Feature 생애주기와 플랫폼 지원 업무. 조직 가정안이며 실제 조직 승인과 외부 수행 증거는 별도다.",
  "benchmark": {
   "title": "Automotive SPICE Process Assessment / Reference Model",
   "version": "4.0",
   "url": "https://vda-qmc.de/wp-content/uploads/2023/12/Automotive-SPICE-PAM-v40.pdf"
  }
 },
 "note": "docs/65-workflows/scripts/build_json.py가 모델(model/*.yaml)에서 만든다. 손으로 고치지 않는다.",
 "roles": [
  {
   "id": "R-FO",
   "name": "Feature Owner",
   "en": "Feature Owner",
   "desc": "Feature의 대상·분류·출시 판단을 책임진다. Feature와 정책 초안을 작성한다.",
   "platformRoles": [
    "FEATURE_AUTHOR"
   ]
  },
  {
   "id": "R-REQ",
   "name": "요구 Owner",
   "en": "Requirement Owner",
   "desc": "안전요구를 확정하고 Feature 정의(G1~G3 묶음)를 승인한다.",
   "platformRoles": [
    "FEATURE_APPROVER"
   ]
  },
  {
   "id": "R-SM",
   "name": "Safety Manager",
   "en": "Safety Manager (FSM)",
   "desc": "안전 분류·HARA·Safety Case를 책임지고 F2 이상 Kill·복원을 승인한다.",
   "platformRoles": [
    "SAFETY_OFFICER"
   ]
  },
  {
   "id": "R-CSM",
   "name": "CSM",
   "en": "Cybersecurity Manager",
   "desc": "TARA·보안 Incident·취약점 대응과 보안 사유 Kill을 책임진다.",
   "platformRoles": [
    "SECURITY_OFFICER"
   ]
  },
  {
   "id": "R-REG",
   "name": "법규 담당",
   "en": "Regulatory Owner",
   "desc": "형식승인 영향 판단·Compliance Profile·리콜 연계를 책임진다.",
   "platformRoles": [
    "REGULATORY_OWNER"
   ]
  },
  {
   "id": "R-TST",
   "name": "시험 조직",
   "en": "Test Organization",
   "desc": "시험 명세·실행·Evidence 제출과 독립 V&V를 수행한다.",
   "platformRoles": [
    "GATE_JUDGE"
   ]
  },
  {
   "id": "R-QA",
   "name": "품질 조직",
   "en": "Quality Organization",
   "desc": "독립 검토·Gate 판정 확인·감사·품질 피드백을 수행한다.",
   "platformRoles": [
    "GATE_JUDGE",
    "AUDITOR"
   ]
  },
  {
   "id": "R-OPS",
   "name": "운영 조직",
   "en": "Operations Organization",
   "desc": "운행 감시·이상 징후 대응·긴급 차단 요청·드릴을 수행한다. 운영 리더는 차단·복원 승인에 참여한다.",
   "platformRoles": [
    "OPERATOR",
    "OPS_LEAD"
   ]
  },
  {
   "id": "R-ARC",
   "name": "아키텍트",
   "en": "Architect",
   "desc": "안전 설계·정책·Control Point·차량 내 감시 구조를 설계한다.",
   "platformRoles": [
    "IMPLEMENTER"
   ]
  },
  {
   "id": "R-INT",
   "name": "통합 조직",
   "en": "Integration Organization",
   "desc": "차량 SW·협력사 컴포넌트 통합과 변경 기록, EOL 프로비저닝을 수행한다.",
   "platformRoles": [
    "IMPLEMENTER"
   ]
  },
  {
   "id": "R-REL",
   "name": "Release Manager",
   "en": "Release Manager",
   "desc": "서명 배포·Lifecycle 출시 전이를 수행하고, 단계적 확대는 운영 조직과 협의한다.",
   "platformRoles": [
    "RELEASE_MANAGER"
   ]
  },
  {
   "id": "R-PUR",
   "name": "구매",
   "en": "Purchasing",
   "desc": "협력사 선정·DIA/CIA 계약·공급망 원산지 관리를 수행한다.",
   "platformRoles": []
  },
  {
   "id": "R-LEG",
   "name": "법무",
   "en": "Legal",
   "desc": "소비자법·데이터 이전·OSS 라이선스 검토를 수행한다.",
   "platformRoles": []
  },
  {
   "id": "R-PKI",
   "name": "PKI 운영",
   "en": "PKI Operations",
   "desc": "서명 키·인증서 수명주기와 HSM 정책을 운영한다.",
   "platformRoles": []
  },
  {
   "id": "R-DPO",
   "name": "데이터 보호 담당",
   "en": "Data Protection Officer",
   "desc": "개인정보·위치·주행 데이터의 수집 범위와 보존을 검토한다.",
   "platformRoles": []
  },
  {
   "id": "R-PLM",
   "name": "기준정보 담당",
   "en": "PLM Master Data Steward",
   "desc": "차량 사양·Variant·BOM 기준선을 관리하고 확정을 승인한다.",
   "platformRoles": [
    "VARIANT_OWNER",
    "BOM_APPROVER"
   ]
  },
  {
   "id": "R-PDA",
   "name": "상품 기획",
   "en": "Product Author",
   "desc": "Feature Catalog 상품 구성과 체험 제안을 작성한다.",
   "platformRoles": [
    "PRODUCT_AUTHOR"
   ]
  },
  {
   "id": "R-PO",
   "name": "상품 Owner",
   "en": "Product Owner",
   "desc": "상품 구성과 고객 출시를 승인한다.",
   "platformRoles": [
    "PRODUCT_APPROVER"
   ]
  },
  {
   "id": "R-RDA",
   "name": "Feature DB 관리자",
   "en": "Feature DB Administrator",
   "desc": "Feature DB 기준 행 변경 요청을 최종 승인하고 버전을 발행하며, 분류·출처와 정기 점검 일정을 관리한다.",
   "platformRoles": [
    "REFDB_ADMIN"
   ]
  },
  {
   "id": "R-DRV",
   "name": "도메인 검토자",
   "en": "Domain Reviewer",
   "desc": "담당 도메인 기준 행의 변경 요청에 동의·보완·반대 의견을 준다.",
   "platformRoles": [
    "DOMAIN_REVIEWER"
   ]
  },
  {
   "id": "R-CE",
   "name": "SW 개발비 산정 작성자",
   "en": "Cost Estimator",
   "desc": "Feature를 담아 SW 개발비 산정 과제를 만들고 줄 입력·과제 설정을 채워 승인을 요청한다.",
   "platformRoles": [
    "COST_ESTIMATOR"
   ]
  },
  {
   "id": "R-CA",
   "name": "SW 개발비 산정 승인자",
   "en": "Cost Approver",
   "desc": "제출된 산정 과제를 검토해 승인하거나 반려한다. 자기가 만든 과제는 승인하지 않는다(SOD-16).",
   "platformRoles": [
    "COST_APPROVER"
   ]
  },
  {
   "id": "R-CV",
   "name": "SW 개발비 산정 열람자",
   "en": "Cost Viewer",
   "desc": "산정 과제의 금액·단가를 포함한 결과를 열람한다.",
   "platformRoles": [
    "COST_VIEWER"
   ]
  },
  {
   "id": "R-CBA",
   "name": "원가 기준 관리자",
   "en": "Cost Basis Administrator",
   "desc": "단가·계수 표의 새 버전을 만들고 발행한다. 발행해도 이미 승인된 산정 결과는 바뀌지 않는다.",
   "platformRoles": [
    "COST_BASIS_ADMIN"
   ]
  },
  {
   "id": "R-SYS",
   "name": "시스템 관리자",
   "en": "System Administrator",
   "desc": "퇴사·전보한 계정을 비활성으로 기록하고, 소유자가 없거나 비활성인 기록의 소유자를 담당 역할의 다른 계정으로 옮긴다. 기록 내용은 고치지 않는다.",
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
 "gateCrosswalk": [
  {
   "report": "G1",
   "platform": [
    "G1",
    "G3"
   ],
   "approvalActions": []
  },
  {
   "report": "G2",
   "platform": [
    "G7"
   ],
   "approvalActions": []
  },
  {
   "report": "G3",
   "platform": [
    "G2"
   ],
   "approvalActions": []
  },
  {
   "report": "G4",
   "platform": [
    "G4",
    "G7"
   ],
   "approvalActions": []
  },
  {
   "report": "G5",
   "platform": [
    "G5",
    "G6"
   ],
   "approvalActions": []
  },
  {
   "report": "G6",
   "platform": [
    "G8"
   ],
   "approvalActions": []
  },
  {
   "report": "G7",
   "platform": [
    "G9"
   ],
   "approvalActions": [
    "signRelease"
   ]
  },
  {
   "report": "G8",
   "platform": [],
   "approvalActions": []
  }
 ],
 "departments": [
  {
   "id": "DEP-PDP",
   "name": "상품기획팀",
   "en": "Product Planning",
   "desc": "Feature를 소유하고 대상·분류·출시를 판단한다. 상품 구성과 체험 제안을 만들고 고객 출시를 승인한다.",
   "workspace": "studio",
   "roles": [
    "R-FO",
    "R-PDA",
    "R-PO"
   ],
   "personas": [
    "author",
    "commerce",
    "approver",
    "productowner"
   ],
   "activities": [
    {
     "id": "FPW.1-A01",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A02",
     "process": "FPW.1",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A03",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A04",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A06",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A01",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A02",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A03",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A04",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A01",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A03",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A05",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A06",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A04",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A03",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A06",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A07",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A01",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A04",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A07",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A01",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A02",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A03",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A06",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A01",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A13",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A02",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A03",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A04",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A05",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A06",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A07",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A12",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A09",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A10",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A11",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A12",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A01",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A02",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A06",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A08",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A09",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A10",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A11",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A01",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A02",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A03",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A04",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A06",
     "process": "FPW.9",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A05",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A01",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A02",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A03",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A04",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A05",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A06",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A01",
     "process": "FPW.15",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A01",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A02",
     "process": "FPW.17",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A01",
     "process": "FPW.18",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A02",
     "process": "FPW.18",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A03",
     "process": "FPW.18",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A04",
     "process": "FPW.18",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/policies/:id",
     "/baselines",
     "/experiments",
     "/products/new",
     "/entitlements",
     "/products/bill-of-features",
     "/products/configurator",
     "/products/:id/:ver",
     "/activation/decide",
     "/admin/approval",
     "/flag-retirements",
     "/flag-code/lifecycle",
     "/master/feature-db/:refId",
     "/data/workbench",
     "/biz/trials",
     "/products"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/validations/virtual",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/verify/evidence",
     "/config/compat",
     "/deployments",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/verify/compliance",
     "/verify/safety-case",
     "/fleet/live",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/kill",
     "/audit",
     "/quality/feedback",
     "/trace/ads",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId",
     "/master/reference-values",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/fleet/vehicles/:vin"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.1-A01",
      "to": "FPW.1-A02",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.1-A01",
      "to": "FPW.1-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.3-A05",
      "to": "FPW.3-A06",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.4-A06",
      "to": "FPW.4-A04",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.6-A01",
      "to": "FPW.6-A02",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.7-A02",
      "to": "FPW.7-A08",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.7-A06",
      "to": "FPW.7-A08",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.7-A12",
      "to": "FPW.7-A09",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.9-A02",
      "to": "FPW.9-A03",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.9-A02",
      "to": "FPW.9-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.9-A04",
      "to": "FPW.9-A06",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.14-A01",
      "to": "FPW.14-A02",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.18-A01",
      "to": "FPW.18-A02",
      "department": "DEP-OPS"
     }
    ],
    "in": [
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A05",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.4-A03",
      "to": "FPW.4-A06",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.7-A13",
      "to": "FPW.7-A12",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.7-A09",
      "to": "FPW.7-A10",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.9-A03",
      "to": "FPW.9-A04",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.9-A03",
      "to": "FPW.9-A04",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.18-A02",
      "to": "FPW.18-A03",
      "department": "DEP-OPS"
     }
    ]
   }
  },
  {
   "id": "DEP-SE",
   "name": "시스템엔지니어링팀",
   "en": "Systems Engineering",
   "desc": "안전요구를 확정하고 Feature 정의를 승인한다. Control Point·안전 설계의 적합성을 책임지고, 담당 도메인의 Feature DB 변경 요청을 검토한다.",
   "workspace": "console",
   "roles": [
    "R-REQ",
    "R-ARC",
    "R-DRV"
   ],
   "personas": [
    "approver",
    "integrator"
   ],
   "activities": [
    {
     "id": "FPW.1-A01",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A02",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A03",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A06",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A01",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A02",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A06",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A03",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A01",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A02",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A03",
     "process": "FPW.3",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A05",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A06",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A04",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A01",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A03",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A06",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A04",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A02",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A07",
     "process": "FPW.4",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A02",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A03",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A01",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A07",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A13",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A02",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A03",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A05",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A02",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A01",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A02",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A03",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A04",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A05",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A06",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A03",
     "process": "FPW.15",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A02",
     "process": "FPW.17",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A03",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A04",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/trace/design",
     "/change/cr",
     "/features/:id/:ver",
     "/admin/approval",
     "/master/control-points",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/policies/:id",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/flag-retirements",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/analysis/impact",
     "/master/artifacts",
     "/integration/connectors",
     "/arch/components",
     "/validations",
     "/verify/evidence",
     "/baselines",
     "/integration/code-repositories",
     "/integration/code-repositories/:repoId",
     "/integration/code-scans",
     "/integration/openfeature",
     "/master/feature-db/:refId",
     "/procurement/sw-cost/:estId",
     "/precheck",
     "/trace/coverage"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.2-A03",
      "to": "FPW.2-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A03",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A05",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A05",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.4-A03",
      "to": "FPW.4-A06",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.4-A04",
      "to": "FPW.4-A05",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A13",
      "to": "FPW.7-A12",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.9-A03",
      "to": "FPW.9-A04",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.14-A02",
      "to": "FPW.14-A03",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.17-A02",
      "to": "FPW.17-A03",
      "department": "DEP-INT"
     }
    ],
    "in": [
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.3-A03",
      "to": "FPW.3-A04",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.3-A06",
      "to": "FPW.3-A04",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.4-A06",
      "to": "FPW.4-A04",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.7-A08",
      "to": "FPW.7-A13",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.9-A02",
      "to": "FPW.9-A03",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.14-A01",
      "to": "FPW.14-A02",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.17-A01",
      "to": "FPW.17-A02",
      "department": "DEP-PLM"
     }
    ]
   }
  },
  {
   "id": "DEP-INT",
   "name": "SW통합·릴리스팀",
   "en": "SW Integration & Release",
   "desc": "통합 빌드와 Baseline·출시 묶음을 관리하고 출시 전이를 실행한다.",
   "workspace": "console",
   "roles": [
    "R-INT",
    "R-REL"
   ],
   "personas": [
    "coordinator",
    "integrator"
   ],
   "activities": [
    {
     "id": "FPW.2-A04",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A05",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A06",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A01",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A06",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A04",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A07",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A01",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A02",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A03",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A04",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A07",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A05",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A01",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A02",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A03",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A04",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A05",
     "process": "FPW.6",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A06",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A07",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A01",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A13",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A02",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A12",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A09",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A11",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A12",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A10",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A13",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A14",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A15",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A16",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A02",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A03",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A04",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A06",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A05",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A01",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A04",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A05",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A06",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A07",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A01",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A04",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A06",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A02",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A03",
     "process": "FPW.15",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A01",
     "process": "FPW.17",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A02",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A03",
     "process": "FPW.17",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A04",
     "process": "FPW.17",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A05",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/deployments",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/integration/code-repositories",
     "/integration/code-repositories/:repoId",
     "/flag-code/lifecycle",
     "/flag-retirements",
     "/precheck",
     "/trace/coverage"
    ],
    "reference": [
     "/master/control-points",
     "/trace/design",
     "/policies/:id",
     "/arch/topology",
     "/validations",
     "/validations/virtual",
     "/verify/evidence",
     "/verify/safety-case",
     "/admin/approval",
     "/baselines",
     "/config/compat",
     "/activation/decide",
     "/experiments",
     "/fleet/live",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/rollback",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/supplier/portal",
     "/supplier/deliveries",
     "/admin/security",
     "/integration/openfeature",
     "/procurement/sw-cost/:estId",
     "/master/reference-values",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.3-A06",
      "to": "FPW.3-A04",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.5-A07",
      "to": "FPW.5-A04",
      "department": "DEP-VAL"
     },
     {
      "from": "FPW.6-A04",
      "to": "FPW.6-A05",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A09",
      "to": "FPW.7-A10",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.7-A09",
      "to": "FPW.7-A11",
      "department": "DEP-OPS"
     }
    ],
    "in": [
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A05",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.3-A05",
      "to": "FPW.3-A06",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.4-A05",
      "to": "FPW.4-A07",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.5-A01",
      "to": "FPW.5-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.6-A02",
      "to": "FPW.6-A04",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.6-A05",
      "to": "FPW.6-A06",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A12",
      "to": "FPW.7-A09",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.9-A04",
      "to": "FPW.9-A06",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.10-A06",
      "to": "FPW.10-A07",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.10-A06",
      "to": "FPW.10-A07",
      "department": "DEP-VAL"
     },
     {
      "from": "FPW.17-A02",
      "to": "FPW.17-A03",
      "department": "DEP-SE"
     }
    ]
   }
  },
  {
   "id": "DEP-PLM",
   "name": "PLM·기준정보팀",
   "en": "PLM & Master Data",
   "desc": "차량 사양·Variant·BOM 기준선을 관리하고 확정을 승인한다. Feature DB 기준 행 변경을 승인하고 버전을 발행한다.",
   "workspace": "console",
   "roles": [
    "R-PLM",
    "R-RDA"
   ],
   "personas": [
    "steward"
   ],
   "activities": [
    {
     "id": "FPW.1-A01",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A02",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A06",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A05",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A04",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A03",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A01",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A02",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A07",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A01",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A02",
     "process": "FPW.14",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A03",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A04",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A05",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A06",
     "process": "FPW.14",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A01",
     "process": "FPW.17",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A02",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A03",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A05",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/variant-conditions",
     "/arch/topology",
     "/features/catalogue",
     "/baselines",
     "/config/compat",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/master/reference-values"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/features/:id/:ver",
     "/admin/approval",
     "/master/artifacts",
     "/integration/connectors",
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope",
     "/master/feature-db/:refId",
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo",
     "/precheck",
     "/trace/coverage",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.1-A02",
      "to": "FPW.1-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.6-A02",
      "to": "FPW.6-A03",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.6-A02",
      "to": "FPW.6-A04",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.17-A01",
      "to": "FPW.17-A02",
      "department": "DEP-SE"
     }
    ],
    "in": [
     {
      "from": "FPW.1-A01",
      "to": "FPW.1-A02",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.6-A01",
      "to": "FPW.6-A02",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.14-A02",
      "to": "FPW.14-A03",
      "department": "DEP-SE"
     }
    ]
   }
  },
  {
   "id": "DEP-FS",
   "name": "기능안전팀",
   "en": "Functional Safety",
   "desc": "안전 분류·HARA·Safety Case를 책임지고 Gate 판정과 긴급 차단·복원 승인을 한다.",
   "workspace": "review",
   "roles": [
    "R-SM"
   ],
   "personas": [
    "quality",
    "safety2",
    "integrator"
   ],
   "activities": [
    {
     "id": "FPW.1-A01",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A02",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A03",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A04",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A01",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A02",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A06",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A03",
     "process": "FPW.2",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A04",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A01",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A02",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A03",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A06",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A04",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A01",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A04",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A02",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A01",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A02",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A03",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A04",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A05",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A06",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A01",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A13",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A02",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A03",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A04",
     "process": "FPW.7",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A12",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A11",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A01",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A02",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A03",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A04",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A05",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A07",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A06",
     "process": "FPW.8",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A08",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A09",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A10",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A11",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A13",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A14",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A15",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A16",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A01",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A02",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A03",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A01",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A03",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A05",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A06",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A01",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A02",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A03",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A04",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A01",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A01",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A04",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A02",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A04",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/admin/approval",
     "/analysis/impact",
     "/arch/topology",
     "/arch/components",
     "/verify/evidence",
     "/verify/compliance",
     "/verify/safety-case",
     "/activation/decide",
     "/ops/kill",
     "/fleet/live",
     "/deployments",
     "/ops/rollback",
     "/flag-retirements",
     "/ops/safety-kpi",
     "/trace/ads"
    ],
    "reference": [
     "/master/define",
     "/feature/propose",
     "/features",
     "/master/feature-db",
     "/master/taxonomy/levels",
     "/variant-conditions",
     "/features/catalogue",
     "/trace/design",
     "/change/cr",
     "/integration/connectors",
     "/master/control-points",
     "/policies/:id",
     "/validations",
     "/master/artifacts",
     "/validations/virtual",
     "/deployments/software",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/flag-code/reconcile",
     "/experiments",
     "/notifications",
     "/ops/anomalies",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/incident-reports",
     "/audit/oversight",
     "/audit",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/quality/feedback",
     "/supplier/portal",
     "/supplier/deliveries",
     "/admin/security",
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes",
     "/data/workbench",
     "/products"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.1-A03",
      "to": "FPW.1-A04",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A06",
      "department": "DEP-CS"
     },
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A03",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A04",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.4-A02",
      "to": "FPW.4-A05",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.5-A01",
      "to": "FPW.5-A02",
      "department": "DEP-VAL"
     },
     {
      "from": "FPW.5-A01",
      "to": "FPW.5-A03",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.7-A03",
      "to": "FPW.7-A04",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A08",
      "to": "FPW.7-A13",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.8-A02",
      "to": "FPW.8-A03",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A06",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A07",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.8-A09",
      "to": "FPW.8-A10",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A14",
      "to": "FPW.8-A15",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.9-A03",
      "to": "FPW.9-A04",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.10-A03",
      "to": "FPW.10-A06",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.10-A03",
      "to": "FPW.10-A06",
      "department": "DEP-VAL"
     },
     {
      "from": "FPW.13-A01",
      "to": "FPW.13-A02",
      "department": "DEP-HOM"
     }
    ],
    "in": [
     {
      "from": "FPW.1-A01",
      "to": "FPW.1-A03",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.1-A02",
      "to": "FPW.1-A05",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.1-A04",
      "to": "FPW.1-A05",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.2-A06",
      "to": "FPW.2-A05",
      "department": "DEP-CS"
     },
     {
      "from": "FPW.2-A03",
      "to": "FPW.2-A05",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.2-A04",
      "to": "FPW.2-A05",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.7-A01",
      "to": "FPW.7-A08",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.7-A02",
      "to": "FPW.7-A08",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.7-A04",
      "to": "FPW.7-A08",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A06",
      "to": "FPW.7-A08",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.7-A07",
      "to": "FPW.7-A08",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.8-A01",
      "to": "FPW.8-A02",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A04",
      "to": "FPW.8-A05",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A08",
      "to": "FPW.8-A09",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A13",
      "to": "FPW.8-A14",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.9-A02",
      "to": "FPW.9-A03",
      "department": "DEP-PDP"
     },
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A03",
      "department": "DEP-PUR"
     },
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A03",
      "department": "DEP-HOM"
     }
    ]
   }
  },
  {
   "id": "DEP-CS",
   "name": "차량사이버보안팀",
   "en": "Vehicle Cybersecurity",
   "desc": "TARA·보안 검토를 하고 긴급 차단 2인 승인과 키 교체 기록을 맡는다.",
   "workspace": "review",
   "roles": [
    "R-CSM"
   ],
   "personas": [
    "integrator"
   ],
   "activities": [
    {
     "id": "FPW.2-A02",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A06",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A02",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A04",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A05",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A02",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A04",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A05",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A07",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A06",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A09",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A01",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A04",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A01",
     "process": "FPW.11",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A02",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A03",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A04",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A06",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A05",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A06",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A07",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A08",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A01",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A04",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A01",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A03",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A04",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A04",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/ops/kill",
     "/admin/security",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads"
    ],
    "reference": [
     "/features/:id/:ver",
     "/admin/approval",
     "/arch/components",
     "/deployments",
     "/master/artifacts",
     "/deployments/software",
     "/audit/oversight",
     "/fleet/live",
     "/admin/iam",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/data/workbench",
     "/products"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.2-A06",
      "to": "FPW.2-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A06",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A07",
      "department": "DEP-QA"
     }
    ],
    "in": [
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A06",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A04",
      "to": "FPW.8-A05",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.11-A01",
      "to": "FPW.11-A02",
      "department": "DEP-ITSEC"
     },
     {
      "from": "FPW.12-A06",
      "to": "FPW.12-A07",
      "department": "DEP-DPO"
     }
    ]
   }
  },
  {
   "id": "DEP-HOM",
   "name": "법규인증팀",
   "en": "Homologation & Regulatory",
   "desc": "시장별 법규·형식승인·사용자 고지를 확인하고 Compliance Profile과 긴급 권한 사후 검토를 맡는다.",
   "workspace": "review",
   "roles": [
    "R-REG"
   ],
   "personas": [
    "steward"
   ],
   "activities": [
    {
     "id": "FPW.1-A04",
     "process": "FPW.1",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A02",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A04",
     "process": "FPW.2",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A02",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A03",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A05",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A04",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A07",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A02",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A03",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A04",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A05",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A07",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A08",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A11",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A04",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A03",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A05",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A03",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A04",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A05",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A01",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A04",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.14-A05",
     "process": "FPW.14",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A02",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A01",
     "process": "FPW.17",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/ops/incident-reports",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads"
    ],
    "reference": [
     "/features/:id/:ver",
     "/admin/approval",
     "/baselines",
     "/config/compat",
     "/activation/decide",
     "/ops/kill",
     "/audit/oversight",
     "/audit",
     "/admin/security",
     "/master/feature-db",
     "/admin/iam",
     "/master/reference-values"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.1-A04",
      "to": "FPW.1-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.2-A04",
      "to": "FPW.2-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.6-A03",
      "to": "FPW.6-A05",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.7-A07",
      "to": "FPW.7-A08",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A03",
      "to": "FPW.8-A04",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A04",
      "department": "DEP-PUR"
     },
     {
      "from": "FPW.13-A02",
      "to": "FPW.13-A04",
      "department": "DEP-OPS"
     }
    ],
    "in": [
     {
      "from": "FPW.1-A03",
      "to": "FPW.1-A04",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.2-A01",
      "to": "FPW.2-A04",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.6-A02",
      "to": "FPW.6-A03",
      "department": "DEP-PLM"
     },
     {
      "from": "FPW.8-A02",
      "to": "FPW.8-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.10-A01",
      "to": "FPW.10-A02",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.13-A01",
      "to": "FPW.13-A02",
      "department": "DEP-FS"
     }
    ]
   }
  },
  {
   "id": "DEP-VAL",
   "name": "시험·검증팀",
   "en": "Test & Validation",
   "desc": "독립 V&V를 계획·실행하고 검증 Gate를 판정한다.",
   "workspace": "review",
   "roles": [
    "R-TST"
   ],
   "personas": [
    "quality"
   ],
   "activities": [
    {
     "id": "FPW.2-A01",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A03",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A01",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A02",
     "process": "FPW.3",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A05",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A04",
     "process": "FPW.3",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A01",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A07",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A01",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A02",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A03",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A04",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A07",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A05",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A01",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A03",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A04",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A08",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A01",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A04",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A06",
     "process": "FPW.9",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A06",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A07",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A02",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/arch/topology",
     "/validations",
     "/validations/virtual",
     "/verify/evidence",
     "/verify/safety-case",
     "/admin/approval",
     "/supplier/portal",
     "/supplier/deliveries"
    ],
    "reference": [
     "/analysis/impact",
     "/trace/design",
     "/change/cr",
     "/features/:id/:ver",
     "/master/artifacts",
     "/integration/connectors",
     "/master/control-points",
     "/flag-code",
     "/flag-code/flags/:flagKey",
     "/flag-code/reconcile",
     "/integration/code-scans",
     "/activation/decide",
     "/policies/:id",
     "/verify/compliance",
     "/ops/kill",
     "/quality/feedback",
     "/flag-retirements",
     "/flag-code/lifecycle",
     "/data/workbench",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/fleet/vehicles/:vin"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.5-A05",
      "to": "FPW.5-A06",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.10-A06",
      "to": "FPW.10-A07",
      "department": "DEP-INT"
     }
    ],
    "in": [
     {
      "from": "FPW.5-A01",
      "to": "FPW.5-A02",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.5-A07",
      "to": "FPW.5-A04",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.10-A03",
      "to": "FPW.10-A06",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.10-A04",
      "to": "FPW.10-A06",
      "department": "DEP-PUR"
     }
    ]
   }
  },
  {
   "id": "DEP-QA",
   "name": "품질팀",
   "en": "Quality",
   "desc": "독립 검토자로서 설계·Safety Case를 검토하고 Evidence와 감사 이력을 확인한다.",
   "workspace": "review",
   "roles": [
    "R-QA"
   ],
   "personas": [
    "quality",
    "viewer"
   ],
   "activities": [
    {
     "id": "FPW.1-A05",
     "process": "FPW.1",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.2-A05",
     "process": "FPW.2",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.3-A03",
     "process": "FPW.3",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A02",
     "process": "FPW.4",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.4-A05",
     "process": "FPW.4",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A01",
     "process": "FPW.5",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A03",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A04",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A05",
     "process": "FPW.5",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.5-A06",
     "process": "FPW.5",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A04",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A05",
     "process": "FPW.6",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A06",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A03",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A04",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A11",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A01",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A05",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A07",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A06",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A09",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A10",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A11",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A13",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A14",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A15",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A16",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A01",
     "process": "FPW.9",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A01",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A03",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A05",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A06",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A07",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A05",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A01",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A05",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A07",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A08",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A01",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A04",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A01",
     "process": "FPW.16",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A02",
     "process": "FPW.16",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A03",
     "process": "FPW.16",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A04",
     "process": "FPW.16",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A03",
     "process": "FPW.17",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A04",
     "process": "FPW.17",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A05",
     "process": "FPW.17",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A01",
     "process": "FPW.18",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A02",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A04",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/features/:id/:ver",
     "/admin/approval",
     "/verify/evidence",
     "/audit/oversight",
     "/ops/kill",
     "/quality/feedback",
     "/supplier/portal",
     "/supplier/deliveries"
    ],
    "reference": [
     "/arch/components",
     "/master/artifacts",
     "/validations/virtual",
     "/verify/safety-case",
     "/deployments",
     "/deployments/software",
     "/integration/connectors",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/verify/compliance",
     "/activation/decide",
     "/fleet/live",
     "/notifications",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/audit",
     "/ops/rollback",
     "/policies/:id",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/admin/data",
     "/trace/ads",
     "/admin/iam",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/precheck",
     "/trace/coverage",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol",
     "/data/workbench",
     "/biz/trials",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles",
     "/products"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.3-A03",
      "to": "FPW.3-A04",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.4-A05",
      "to": "FPW.4-A07",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.6-A05",
      "to": "FPW.6-A06",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.7-A04",
      "to": "FPW.7-A08",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A09",
      "to": "FPW.8-A10",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.10-A01",
      "to": "FPW.10-A02",
      "department": "DEP-PUR"
     },
     {
      "from": "FPW.10-A01",
      "to": "FPW.10-A02",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.10-A06",
      "to": "FPW.10-A07",
      "department": "DEP-INT"
     }
    ],
    "in": [
     {
      "from": "FPW.3-A02",
      "to": "FPW.3-A03",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.4-A04",
      "to": "FPW.4-A05",
      "department": "DEP-SE"
     },
     {
      "from": "FPW.4-A02",
      "to": "FPW.4-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.5-A05",
      "to": "FPW.5-A06",
      "department": "DEP-VAL"
     },
     {
      "from": "FPW.6-A03",
      "to": "FPW.6-A05",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.6-A04",
      "to": "FPW.6-A05",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.7-A03",
      "to": "FPW.7-A04",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A07",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A07",
      "department": "DEP-CS"
     },
     {
      "from": "FPW.8-A08",
      "to": "FPW.8-A09",
      "department": "DEP-OPS"
     },
     {
      "from": "FPW.10-A03",
      "to": "FPW.10-A06",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.10-A04",
      "to": "FPW.10-A06",
      "department": "DEP-PUR"
     }
    ]
   }
  },
  {
   "id": "DEP-OPS",
   "name": "OTA·서비스운영팀",
   "en": "OTA & Service Operations",
   "desc": "차량 운행을 관제하고 이상 징후에 대응하며 긴급 차단·복원을 요청하고 단계적 확대를 실행한다.",
   "workspace": "control",
   "roles": [
    "R-OPS"
   ],
   "personas": [
    "operator",
    "opslead"
   ],
   "activities": [
    {
     "id": "FPW.6-A03",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A05",
     "process": "FPW.6",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.6-A06",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A01",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A02",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A07",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A08",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A09",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A10",
     "process": "FPW.7",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.7-A11",
     "process": "FPW.7",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A12",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A01",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A02",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A03",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A04",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A05",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A07",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A06",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A08",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A09",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A10",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A11",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A13",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A14",
     "process": "FPW.8",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A15",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A16",
     "process": "FPW.8",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A01",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A03",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.9-A05",
     "process": "FPW.9",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.11-A01",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A02",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A03",
     "process": "FPW.11",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A04",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A01",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A03",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A04",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A05",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A06",
     "process": "FPW.12",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A04",
     "process": "FPW.13",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A01",
     "process": "FPW.16",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A03",
     "process": "FPW.16",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A04",
     "process": "FPW.16",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.17-A05",
     "process": "FPW.17",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A01",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A02",
     "process": "FPW.18",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/activation/decide",
     "/policies/:id",
     "/fleet/live",
     "/features/:id/:ver",
     "/notifications",
     "/ops/flag-evaluations",
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake",
     "/ops/kill",
     "/deployments",
     "/audit",
     "/ops/rollback",
     "/deployments/:id",
     "/fleet/vehicles/:vin",
     "/admin/settings",
     "/events",
     "/notifications/rules",
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol",
     "/data/workbench",
     "/ops/telemetry",
     "/fleet/map",
     "/fleet/vehicles"
    ],
    "reference": [
     "/deployments/software",
     "/integration/connectors",
     "/ops/ota-installs",
     "/deployments/campaigns/:id",
     "/experiments",
     "/admin/approval",
     "/products/:id/:ver",
     "/ops/incident-reports",
     "/audit/oversight",
     "/quality/feedback",
     "/flag-retirements",
     "/admin/security",
     "/admin/data",
     "/verify/compliance",
     "/trace/ads",
     "/admin/iam",
     "/biz/trials"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.7-A01",
      "to": "FPW.7-A08",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A01",
      "to": "FPW.8-A02",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A04",
      "to": "FPW.8-A05",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A04",
      "to": "FPW.8-A05",
      "department": "DEP-CS"
     },
     {
      "from": "FPW.8-A08",
      "to": "FPW.8-A09",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A08",
      "to": "FPW.8-A09",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.8-A13",
      "to": "FPW.8-A14",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.18-A02",
      "to": "FPW.18-A03",
      "department": "DEP-PDP"
     }
    ],
    "in": [
     {
      "from": "FPW.7-A09",
      "to": "FPW.7-A11",
      "department": "DEP-INT"
     },
     {
      "from": "FPW.8-A03",
      "to": "FPW.8-A04",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A06",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A05",
      "to": "FPW.8-A06",
      "department": "DEP-CS"
     },
     {
      "from": "FPW.8-A09",
      "to": "FPW.8-A10",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.8-A09",
      "to": "FPW.8-A10",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.8-A14",
      "to": "FPW.8-A15",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.13-A02",
      "to": "FPW.13-A04",
      "department": "DEP-HOM"
     },
     {
      "from": "FPW.18-A01",
      "to": "FPW.18-A02",
      "department": "DEP-PDP"
     }
    ]
   }
  },
  {
   "id": "DEP-ITSEC",
   "name": "Feature 관제실",
   "en": "Feature Control Center",
   "desc": "HSM·KMS에서 서명 키를 생성·순환·폐기한다(플랫폼 밖 업무 — 플랫폼에서는 조회). 플랫폼 계정 상태와 소유자가 없는 기록의 소유자 이관을 맡는다.",
   "workspace": "control",
   "roles": [
    "R-PKI",
    "R-SYS"
   ],
   "personas": [
    "sysadmin"
   ],
   "activities": [
    {
     "id": "FPW.6-A04",
     "process": "FPW.6",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.11-A01",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A02",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A03",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A01",
     "process": "FPW.16",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A02",
     "process": "FPW.16",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A03",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A04",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/admin/security",
     "/admin/iam",
     "/verify/compliance"
    ],
    "reference": [
     "/deployments",
     "/master/artifacts",
     "/deployments/software",
     "/admin/settings",
     "/events",
     "/notifications/rules"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.11-A01",
      "to": "FPW.11-A02",
      "department": "DEP-CS"
     }
    ],
    "in": []
   }
  },
  {
   "id": "DEP-PUR",
   "name": "구매팀",
   "en": "Procurement",
   "desc": "협력사 계약·납품 조건을 관리하고 Feature별 SW 개발비를 산정·승인하며 단가·계수 표를 관리한다.",
   "workspace": "portal",
   "roles": [
    "R-PUR",
    "R-CE",
    "R-CA",
    "R-CV",
    "R-CBA"
   ],
   "personas": [
    "viewer",
    "approver"
   ],
   "activities": [
    {
     "id": "FPW.2-A01",
     "process": "FPW.2",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A01",
     "process": "FPW.10",
     "part": "A",
     "parts": [
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A03",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A04",
     "process": "FPW.10",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.10-A06",
     "process": "FPW.10",
     "part": "I",
     "parts": [
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A06",
     "process": "FPW.11",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A01",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A02",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A03",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A04",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A05",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A06",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.15-A07",
     "process": "FPW.15",
     "part": "R",
     "parts": [
      "R",
      "A",
      "C",
      "I"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId",
     "/procurement/sw-cost/basis"
    ],
    "reference": [
     "/analysis/impact",
     "/arch/topology",
     "/supplier/portal",
     "/supplier/deliveries"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A03",
      "department": "DEP-FS"
     },
     {
      "from": "FPW.10-A04",
      "to": "FPW.10-A06",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.10-A04",
      "to": "FPW.10-A06",
      "department": "DEP-VAL"
     }
    ],
    "in": [
     {
      "from": "FPW.10-A01",
      "to": "FPW.10-A02",
      "department": "DEP-QA"
     },
     {
      "from": "FPW.10-A02",
      "to": "FPW.10-A04",
      "department": "DEP-HOM"
     }
    ]
   }
  },
  {
   "id": "DEP-LEG",
   "name": "법무팀",
   "en": "Legal",
   "desc": "데이터 이용·고객 고지·계약 근거를 검토하고 의견을 준다.",
   "workspace": "portal",
   "roles": [
    "R-LEG"
   ],
   "personas": [
    "viewer"
   ],
   "activities": [
    {
     "id": "FPW.7-A07",
     "process": "FPW.7",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.8-A03",
     "process": "FPW.8",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": true
    },
    {
     "id": "FPW.10-A02",
     "process": "FPW.10",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.11-A06",
     "process": "FPW.11",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A03",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A04",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A02",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A06",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A07",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A02",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.13-A03",
     "process": "FPW.13",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A01",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [],
    "reference": [
     "/ops/incident-reports",
     "/admin/data",
     "/integration/openfeature",
     "/verify/compliance",
     "/trace/ads",
     "/data/workbench",
     "/biz/trials"
    ]
   },
   "handoffs": {
    "out": [],
    "in": []
   }
  },
  {
   "id": "DEP-DPO",
   "name": "개인정보보호팀",
   "en": "Data Protection",
   "desc": "운영 데이터의 개인정보 처리 근거·보존·삭제를 검토한다.",
   "workspace": "portal",
   "roles": [
    "R-DPO"
   ],
   "personas": [
    "viewer"
   ],
   "activities": [
    {
     "id": "FPW.12-A01",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A03",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A04",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A02",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A05",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A06",
     "process": "FPW.12",
     "part": "R",
     "parts": [
      "R",
      "A"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A07",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.12-A08",
     "process": "FPW.12",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.16-A04",
     "process": "FPW.16",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A01",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    },
    {
     "id": "FPW.18-A03",
     "process": "FPW.18",
     "part": "C",
     "parts": [
      "C"
     ],
     "firstScope": false
    }
   ],
   "screens": {
    "primary": [
     "/integration/openfeature",
     "/admin/data"
    ],
    "reference": [
     "/ops/safety-kpi",
     "/admin/settings",
     "/data/workbench",
     "/biz/trials",
     "/products",
     "/entitlements"
    ]
   },
   "handoffs": {
    "out": [
     {
      "from": "FPW.12-A06",
      "to": "FPW.12-A07",
      "department": "DEP-CS"
     }
    ],
    "in": []
   }
  }
 ],
 "departmentScope": {
  "first": [
   "FPW.1",
   "FPW.2",
   "FPW.3",
   "FPW.4",
   "FPW.5",
   "FPW.6",
   "FPW.7",
   "FPW.8",
   "FPW.9"
  ],
  "note": "핵심 생애주기(FPW.1~9)의 기존 검토 범위를 보존한다. 지원 업무(FPW.10~18)를 포함한 레퍼런스 정의는 조직 검토 전 초안이며 실제 수행·승인은 별도 근거로 확인한다.",
  "demoNotes": [
   "긴급 차단 2인 승인은 기능안전 + 차량사이버보안이다(2026-11-04 사용자 결정). 플랫폼 권한은 운영 리더(OPS_LEAD)의 승인도 허용한다 — 데모 계정 opslead(배포 및 모니터링)가 운영 리더 몫을 맡는다(12계정·겸직 0건, 2026-11-05).",
   "복원 2인 승인은 직전 차단 승인자와 다른 사람이어야 한다(SOD-09). 데모에서 차단을 quality(FSM)+integrator(CSM)가 승인하면 복원은 safety2(두 번째 FSM, 표준 검토함)+opslead 또는 다른 CSM이 맡는다(2026-11-05).",
   "고객 출시 승인(FPW.7-A10)은 구성 승인자와 다른 사람이다(SOD-04). 데모 계정 productowner(기획팀, PRODUCT_APPROVER)가 출시를 승인하고 approver는 구성 승인만 한다(2026-11-05).",
   "Feature DB 관리자(REFDB_ADMIN)는 데모 계정 steward 한 명, 도메인 검토자(DOMAIN_REVIEWER)는 approver 한 명뿐이다(2026-11-04). 요청자 ≠ 검토자 ≠ 승인자를 사람 단위로 강제하므로 데모에서 steward가 낸 변경·추가 요청은 승인할 사람이 없고, approver가 낸 요청은 검토할 사람이 없다 — 데모 흐름은 다른 계정(author 등)이 요청한다."
  ]
 },
 "departmentSod": [
  {
   "sod": "SOD-03",
   "department": "DEP-PDP",
   "first": "FPW.7-A05",
   "second": "FPW.7-A06",
   "note": "상품 작성자는 자기 상품을 승인하지 않는다"
  },
  {
   "sod": "SOD-04",
   "department": "DEP-PDP",
   "first": "FPW.7-A06",
   "second": "FPW.7-A10",
   "note": "구성 승인자와 고객 출시 승인자는 다른 사람이다"
  },
  {
   "sod": "SOD-05",
   "department": "DEP-SE",
   "first": "FPW.4-A03",
   "second": "FPW.4-A04",
   "note": "정책 작성자는 자기 정책을 승인하지 않는다"
  },
  {
   "sod": "SOD-09",
   "department": "DEP-FS",
   "first": "FPW.8-A05",
   "second": "FPW.8-A09",
   "note": "복원 승인자는 직전 차단 승인자와 다른 사람이다"
  }
 ],
 "workspaces": [
  "studio",
  "review",
  "console",
  "control",
  "portal"
 ]
};

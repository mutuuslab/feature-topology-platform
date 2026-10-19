// 생성 파일 — tools/workflow-sync.ts가 docs/65-workflows/out/workflows.json에서 만든다. 손으로 고치지 않는다(workflow:check가 잡는다).
import type { WorkflowIndexDoc } from '@ff/contracts';

export const WORKFLOW_INDEX: WorkflowIndexDoc = {
 "schema": 1,
 "personas": {
  "approver": [
   "R-REQ",
   "R-PO"
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
  "quality": [
   "R-SM",
   "R-TST",
   "R-QA"
  ],
  "steward": [
   "R-REG",
   "R-PLM"
  ],
  "viewer": [
   "R-QA"
  ]
 },
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
  }
 ],
 "processes": [
  {
   "id": "FPW.1",
   "name": "Feature 등록·분류"
  },
  {
   "id": "FPW.2",
   "name": "HARA·변경 영향 판단"
  },
  {
   "id": "FPW.3",
   "name": "안전요구 확정"
  },
  {
   "id": "FPW.4",
   "name": "안전 설계·정책 설계"
  },
  {
   "id": "FPW.5",
   "name": "검증·V&V"
  },
  {
   "id": "FPW.6",
   "name": "서명 배포"
  },
  {
   "id": "FPW.7",
   "name": "출시·활성화·단계적 확대"
  },
  {
   "id": "FPW.8",
   "name": "운영·긴급 차단·복원"
  },
  {
   "id": "FPW.9",
   "name": "사후 검토·Flag Retirement"
  },
  {
   "id": "FPW.10",
   "name": "협력사 관리"
  },
  {
   "id": "FPW.11",
   "name": "보안·키·취약점 관리"
  },
  {
   "id": "FPW.12",
   "name": "운영 데이터·데이터 보호"
  },
  {
   "id": "FPW.13",
   "name": "규정·Compliance Profile 관리"
  }
 ],
 "activities": [
  {
   "id": "FPW.1-A01",
   "processId": "FPW.1",
   "processName": "Feature 등록·분류",
   "name": "Feature 등록·초안 작성",
   "trigger": null,
   "gateDecision": null,
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
     "R-SM"
    ]
   },
   "next": [
    "FPW.1-A02",
    "FPW.1-A03"
   ],
   "screens": [
    "/master/define",
    "/feature/propose",
    "/features"
   ],
   "actions": [
    "createFeature",
    "createVersion",
    "updateDraft"
   ],
   "anchor": "feature-form",
   "slaHours": 48
  },
  {
   "id": "FPW.1-A02",
   "processId": "FPW.1",
   "processName": "Feature 등록·분류",
   "name": "대상 차량 사양·의존 등록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.1-A05"
   ],
   "screens": [
    "/variant-conditions",
    "/arch/topology"
   ],
   "actions": [
    "createDependency"
   ],
   "anchor": "variant-conditions",
   "slaHours": 24
  },
  {
   "id": "FPW.1-A03",
   "processId": "FPW.1",
   "processName": "Feature 등록·분류",
   "name": "안전 분류(네 축) 확정",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": "safety-tab",
   "slaHours": 48
  },
  {
   "id": "FPW.1-A04",
   "processId": "FPW.1",
   "processName": "Feature 등록·분류",
   "name": "법규 의무 기능 판정",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.1-A05"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.1-A05",
   "processId": "FPW.1",
   "processName": "Feature 등록·분류",
   "name": "G1 등록·분류 판정",
   "trigger": null,
   "gateDecision": "G1",
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
   "next": [],
   "screens": [
    "/features/:id/:ver",
    "/admin/approval"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.2-A01",
   "processId": "FPW.2",
   "processName": "HARA·변경 영향 판단",
   "name": "재-HARA 조건 검출·영향 범위 산정",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-SM"
    ],
    "A": "R-SM",
    "C": [
     "R-ARC",
     "R-FO"
    ],
    "I": [
     "R-REQ",
     "R-TST"
    ]
   },
   "next": [
    "FPW.2-A02",
    "FPW.2-A03",
    "FPW.2-A04"
   ],
   "screens": [
    "/analysis/impact",
    "/arch/topology"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.2-A02",
   "processId": "FPW.2",
   "processName": "HARA·변경 영향 판단",
   "name": "HARA·TARA 공동 수행",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-SM",
     "R-CSM"
    ],
    "A": "R-SM",
    "C": [
     "R-ARC",
     "R-FO"
    ],
    "I": [
     "R-REQ",
     "R-REG"
    ]
   },
   "next": [
    "FPW.2-A05"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.2-A03",
   "processId": "FPW.2",
   "processName": "HARA·변경 영향 판단",
   "name": "SOTIF 분석 갱신",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-FO"
    ],
    "A": "R-SM",
    "C": [
     "R-ARC",
     "R-TST"
    ],
    "I": [
     "R-REQ"
    ]
   },
   "next": [
    "FPW.2-A05"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.2-A04",
   "processId": "FPW.2",
   "processName": "HARA·변경 영향 판단",
   "name": "형식승인 영향 1차 판단",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.2-A05"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.2-A05",
   "processId": "FPW.2",
   "processName": "HARA·변경 영향 판단",
   "name": "G2 HARA 영향 판정",
   "trigger": null,
   "gateDecision": "G2",
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
   "next": [],
   "screens": [
    "/features/:id/:ver",
    "/admin/approval"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.3-A01",
   "processId": "FPW.3",
   "processName": "안전요구 확정",
   "name": "안전요구 도출·명세",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.3-A02"
   ],
   "screens": [
    "/trace/design",
    "/change/cr"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.3-A02",
   "processId": "FPW.3",
   "processName": "안전요구 확정",
   "name": "양방향 추적성 점검",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.3-A03"
   ],
   "screens": [
    "/trace/design"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.3-A03",
   "processId": "FPW.3",
   "processName": "안전요구 확정",
   "name": "요구 검토 판정 등록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.3-A04"
   ],
   "screens": [
    "/features/:id/:ver"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.3-A04",
   "processId": "FPW.3",
   "processName": "안전요구 확정",
   "name": "G3 판정·Feature 정의 승인",
   "trigger": null,
   "gateDecision": "G3",
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
   "next": [],
   "screens": [
    "/features/:id/:ver",
    "/admin/approval"
   ],
   "actions": [
    "transition"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.4-A01",
   "processId": "FPW.4",
   "processName": "안전 설계·정책 설계",
   "name": "차량 내 감시·안전기제 설계",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.4-A03"
   ],
   "screens": [
    "/master/control-points",
    "/trace/design"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.4-A02",
   "processId": "FPW.4",
   "processName": "안전 설계·정책 설계",
   "name": "플랫폼 도구 신뢰도 분류",
   "trigger": "설계 착수 또는 사용 플랫폼 컴포넌트 변경",
   "gateDecision": null,
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
   "next": [
    "FPW.4-A05"
   ],
   "screens": [
    "/arch/components"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.4-A03",
   "processId": "FPW.4",
   "processName": "안전 설계·정책 설계",
   "name": "Flag 정책 작성·검증",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.4-A04"
   ],
   "screens": [
    "/policies/new",
    "/policies"
   ],
   "actions": [
    "createPolicy",
    "updatePolicy",
    "validatePolicy"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.4-A04",
   "processId": "FPW.4",
   "processName": "안전 설계·정책 설계",
   "name": "정책 승인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.4-A05"
   ],
   "screens": [
    "/policies/:id"
   ],
   "actions": [
    "decidePolicy"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.4-A05",
   "processId": "FPW.4",
   "processName": "안전 설계·정책 설계",
   "name": "G4 설계 독립 검토·판정",
   "trigger": null,
   "gateDecision": "G4",
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
   "next": [],
   "screens": [
    "/features/:id/:ver",
    "/admin/approval"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.5-A01",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "독립성 수준·검증 계획 확정",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.5-A02",
    "FPW.5-A03"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.5-A02",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "시나리오·허용 조합 정의",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.5-A04"
   ],
   "screens": [
    "/arch/topology",
    "/validations"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.5-A03",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "통합 시험·SEooC 가정 확인",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-INT"
    ],
    "A": "R-INT",
    "C": [
     "R-ARC",
     "R-TST"
    ],
    "I": [
     "R-QA"
    ]
   },
   "next": [
    "FPW.5-A04"
   ],
   "screens": [
    "/master/artifacts"
   ],
   "actions": [
    "registerChangeRecord"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.5-A04",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "비활성화·결함 주입 시험 수행",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.5-A05"
   ],
   "screens": [
    "/validations/virtual"
   ],
   "actions": [
    "runVirtual"
   ],
   "anchor": "virtual-run",
   "slaHours": 24
  },
  {
   "id": "FPW.5-A05",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "시험 Evidence 연결·TMS 제출",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.5-A06"
   ],
   "screens": [
    "/verify/evidence"
   ],
   "actions": [
    "submitTms"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.5-A06",
   "processId": "FPW.5",
   "processName": "검증·V&V",
   "name": "G5 V&V 판정",
   "trigger": null,
   "gateDecision": "G5",
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
   "next": [],
   "screens": [
    "/verify/evidence",
    "/admin/approval"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.6-A01",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "출시 Baseline 확정 요청",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.6-A02"
   ],
   "screens": [
    "/baselines"
   ],
   "actions": [
    "requestBaseline"
   ],
   "anchor": null,
   "slaHours": 24
  },
  {
   "id": "FPW.6-A02",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "출시 Baseline 확정 승인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.6-A03",
    "FPW.6-A04"
   ],
   "screens": [
    "/baselines"
   ],
   "actions": [
    "decideBaseline"
   ],
   "anchor": "baseline-approve",
   "slaHours": 24
  },
  {
   "id": "FPW.6-A03",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "SUMS 기록·형식승인 확인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.6-A05"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.6-A04",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "서명 패키지 작성·SBOM 결합",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.6-A05",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "OTA Gate 판정 등록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.6-A06"
   ],
   "screens": [
    "/features/:id/:ver"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.6-A06",
   "processId": "FPW.6",
   "processName": "서명 배포",
   "name": "G6 서명 배포 실행",
   "trigger": null,
   "gateDecision": "G6",
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
   "next": [],
   "screens": [
    "/deployments",
    "/integration/connectors"
   ],
   "actions": [
    "deployPolicy",
    "syncUnleash"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A01",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "Canary·Shadow 판정 기준 정의",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.7-A08"
   ],
   "screens": [
    "/activation/decide"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A02",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "효과 실험 계획 등록",
   "trigger": "출시 효과를 실험으로 비교해야 할 때",
   "gateDecision": null,
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
   "next": [
    "FPW.7-A08"
   ],
   "screens": [
    "/experiments"
   ],
   "actions": [
    "createExperiment"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A03",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "Safety Case·SOTIF 근거 정리",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
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
   "next": [
    "FPW.7-A04"
   ],
   "screens": [
    "/verify/evidence",
    "/verify/compliance"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A04",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "Safety Case 독립 검토",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.7-A08"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A05",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "상품 구성 작성",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
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
   "next": [
    "FPW.7-A06"
   ],
   "screens": [
    "/products/new",
    "/entitlements"
   ],
   "actions": [
    "createProduct",
    "validateComposition",
    "offerTrials"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A06",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "상품 구성 승인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.7-A08"
   ],
   "screens": [
    "/products/:id/:ver"
   ],
   "actions": [
    "productTransition"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A07",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "형식승인·사용자 고지 확인",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
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
   "next": [
    "FPW.7-A08"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A08",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "G7 출시·활성화 판정",
   "trigger": null,
   "gateDecision": "G7",
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
   "next": [
    "FPW.7-A12"
   ],
   "screens": [
    "/activation/decide",
    "/admin/approval"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A12",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "Release Sign-off(출시 책임 확인)",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.7-A09"
   ],
   "screens": [
    "/features/:id/:ver"
   ],
   "actions": [
    "signRelease"
   ],
   "anchor": "release-signoff",
   "slaHours": 24
  },
  {
   "id": "FPW.7-A09",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "출시 전이",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A10",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "상품 고객 출시 승인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/products/:id/:ver"
   ],
   "actions": [
    "productTransition"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.7-A11",
   "processId": "FPW.7",
   "processName": "출시·활성화·단계적 확대",
   "name": "Canary 활성화·단계적 확대",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/activation/decide",
    "/fleet/live"
   ],
   "actions": [
    "stageRollout"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A01",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "이상 징후 확인",
   "trigger": "운행 감시 경보, 장애·VOC 접수, SOTIF 트리거 발견",
   "gateDecision": null,
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
   "next": [
    "FPW.8-A02"
   ],
   "screens": [
    "/ops/anomalies",
    "/ops/safety-kpi",
    "/ops/incidents"
   ],
   "actions": [
    "acknowledgeAnomaly",
    "dismissAnomaly",
    "createIncident"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A02",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "차단 필요성·범위 판단",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.8-A03"
   ],
   "screens": [
    "/ops/kill"
   ],
   "actions": [
    "gatePreview"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A03",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "리콜·봉쇄 근거 연계",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.8-A04"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A04",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "긴급 차단 요청",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.8-A05"
   ],
   "screens": [
    "/ops/kill"
   ],
   "actions": [
    "issueKill"
   ],
   "anchor": "kill-request",
   "slaHours": 2
  },
  {
   "id": "FPW.8-A05",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "긴급 차단 2인 승인",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": "kill-approve",
   "slaHours": 2
  },
  {
   "id": "FPW.8-A06",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "차단 전달·적용 추적",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": "vehicle-status-v2",
   "slaHours": 4
  },
  {
   "id": "FPW.8-A07",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "긴급 권한 사후 검토",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-REG"
    ],
    "A": "R-QA",
    "C": [
     "R-CSM"
    ],
    "I": [
     "R-SM",
     "R-OPS"
    ]
   },
   "next": [],
   "screens": [
    "/audit/oversight"
   ],
   "actions": [
    "recordKillPostReview"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A08",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "원인 조치·복원 요청",
   "trigger": "원인 수정과 재검증 Evidence 확보",
   "gateDecision": null,
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-SM",
    "C": [
     "R-FO",
     "R-TST"
    ],
    "I": [
     "R-REG"
    ]
   },
   "next": [
    "FPW.8-A09"
   ],
   "screens": [
    "/ops/kill"
   ],
   "actions": [
    "requestRestore"
   ],
   "anchor": "kill-restore",
   "slaHours": 4
  },
  {
   "id": "FPW.8-A09",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "복원 2인 승인",
   "trigger": null,
   "gateDecision": null,
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
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.8-A10",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "단계적 복원·관측",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/fleet/live"
   ],
   "actions": [
    "stageRollout"
   ],
   "anchor": "vehicle-status-v2",
   "slaHours": 24
  },
  {
   "id": "FPW.8-A11",
   "processId": "FPW.8",
   "processName": "운영·긴급 차단·복원",
   "name": "분기 드릴·G8 운영 판정",
   "trigger": "분기 정기 일정",
   "gateDecision": "G8",
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
   "next": [],
   "screens": [
    "/ops/kill",
    "/audit"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.9-A01",
   "processId": "FPW.9",
   "processName": "사후 검토·Flag Retirement",
   "name": "운영 결과 품질 피드백 수용",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/quality/feedback"
   ],
   "actions": [
    "acceptFeedback"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.9-A02",
   "processId": "FPW.9",
   "processName": "사후 검토·Flag Retirement",
   "name": "Flag Retirement 요청",
   "trigger": "Flag 만료 30일 전 알림, 기능 대체·폐기 결정",
   "gateDecision": null,
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
   "next": [
    "FPW.9-A03"
   ],
   "screens": [
    "/flag-retirements"
   ],
   "actions": [
    "requestFlagRetirement"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.9-A03",
   "processId": "FPW.9",
   "processName": "사후 검토·Flag Retirement",
   "name": "Flag Retirement 승인",
   "trigger": null,
   "gateDecision": null,
   "raci": {
    "R": [
     "R-REQ",
     "R-SM"
    ],
    "A": "R-FO",
    "C": [
     "R-REL"
    ],
    "I": [
     "R-INT",
     "R-OPS"
    ]
   },
   "next": [
    "FPW.9-A04"
   ],
   "screens": [
    "/flag-retirements"
   ],
   "actions": [
    "approveFlagRetirement"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.9-A04",
   "processId": "FPW.9",
   "processName": "사후 검토·Flag Retirement",
   "name": "코드·설정·시험 삭제 기록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.9-A05"
   ],
   "screens": [
    "/flag-retirements"
   ],
   "actions": [
    "recordFlagRetirementStep"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.9-A05",
   "processId": "FPW.9",
   "processName": "사후 검토·Flag Retirement",
   "name": "Lifecycle 종료 전이",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/features/:id/:ver"
   ],
   "actions": [
    "transition"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A01",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "계약 전 협력사 역량 확인",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.10-A02"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A02",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "DIA·CIA 체결",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.10-A03",
    "FPW.10-A04"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A03",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "확인 조치 독립성 지정",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.10-A06"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A04",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "공급망 원산지 속성 관리",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.10-A06"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A05",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "기존 구현 진단",
   "trigger": "기존 Feature Flag 구현의 재사용·인수 결정",
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A06",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "Gate별 납품물 입고 검사",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.10-A07"
   ],
   "screens": [
    "/supplier/portal"
   ],
   "actions": [
    "judgeGate"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.10-A07",
   "processId": "FPW.10",
   "processName": "협력사 관리",
   "name": "EOL 프로비저닝 검증",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A01",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "서명 키 계층·HSM 운영",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.11-A02"
   ],
   "screens": [
    "/admin/security"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A02",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "키 교체 플랫폼 기록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/admin/security"
   ],
   "actions": [
    "rotateKey"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A03",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "키 유출 대응·epoch 상향",
   "trigger": "키 유출·오사용 징후",
   "gateDecision": null,
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
   "next": [
    "FPW.11-A05"
   ],
   "screens": [
    "/admin/security"
   ],
   "actions": [
    "bumpEpoch"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A04",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "취약점 영향 특정·대응 결정",
   "trigger": "새 취약점 공지",
   "gateDecision": null,
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
   "next": [
    "FPW.11-A05"
   ],
   "screens": [
    "/admin/security"
   ],
   "actions": [
    "recordVex"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A05",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "CSMS Evidence·R155 보고",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.11-A06",
   "processId": "FPW.11",
   "processName": "보안·키·취약점 관리",
   "name": "OSS 라이선스·보안 프로그램 운영",
   "trigger": "OSS 구성요소 추가·변경",
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.12-A01",
   "processId": "FPW.12",
   "processName": "운영 데이터·데이터 보호",
   "name": "운행 감시 지표·경보 기준 기록",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/ops/safety-kpi"
   ],
   "actions": [
    "recordSafetyKpiPlan"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.12-A02",
   "processId": "FPW.12",
   "processName": "운영 데이터·데이터 보호",
   "name": "평가 컨텍스트 개인정보 검토",
   "trigger": "정책 작성·변경으로 평가 컨텍스트가 바뀔 때",
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/integration/openfeature"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.12-A03",
   "processId": "FPW.12",
   "processName": "운영 데이터·데이터 보호",
   "name": "중국 데이터 현지 처리·이전 심사",
   "trigger": "중국 시장 출시 또는 국외 조회 요청",
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.12-A04",
   "processId": "FPW.12",
   "processName": "운영 데이터·데이터 보호",
   "name": "EU 데이터 접근 요청 처리",
   "trigger": "EU 차량 사용자·제3자 데이터 접근 요청",
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/admin/data"
   ],
   "actions": [
    "createDataAccessRequest",
    "recordDataActContractBasis"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.12-A05",
   "processId": "FPW.12",
   "processName": "운영 데이터·데이터 보호",
   "name": "보존 기간 경과 데이터 삭제",
   "trigger": "정기 보존 기간 점검",
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/admin/data"
   ],
   "actions": [
    "retentionSweep"
   ],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.13-A01",
   "processId": "FPW.13",
   "processName": "규정·Compliance Profile 관리",
   "name": "표준 판 고정",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.13-A02"
   ],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.13-A02",
   "processId": "FPW.13",
   "processName": "규정·Compliance Profile 관리",
   "name": "Compliance Profile 정의",
   "trigger": null,
   "gateDecision": null,
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
   "next": [
    "FPW.13-A04"
   ],
   "screens": [
    "/verify/compliance"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.13-A03",
   "processId": "FPW.13",
   "processName": "규정·Compliance Profile 관리",
   "name": "분기 법규 감시·Profile 갱신",
   "trigger": "분기 정기 점검",
   "gateDecision": null,
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
   "next": [],
   "screens": [
    "/verify/compliance"
   ],
   "actions": [],
   "anchor": null,
   "slaHours": null
  },
  {
   "id": "FPW.13-A04",
   "processId": "FPW.13",
   "processName": "규정·Compliance Profile 관리",
   "name": "원격 종료 시스템 설명 작성",
   "trigger": null,
   "gateDecision": null,
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
   "next": [],
   "screens": [],
   "actions": [],
   "anchor": null,
   "slaHours": null
  }
 ]
};

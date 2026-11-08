// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.7",
 "name": "출시·활성화·단계적 확대",
 "en": "Release, Activation & Staged Rollout",
 "group": "생애주기",
 "gates": [
  "G7"
 ],
 "ref": "표준 보고서 6.1절 G7, 6장 FFG-LCY-009·010, 12장 FFG-TST-010, 14장(SOTIF), 3장(ADS Safety Case), 5장 FFG-CLS-006",
 "purpose": "배포된 Feature Version을 차량 안에서 효력을 내도록 허가한다. SOTIF 출시 기준과 Safety Case 독립 검토, Canary·Shadow 판정 기준, 상품 구성 승인, 형식승인·사용자 고지 조건을 확인한 뒤 Canary Cohort부터 단계적으로 넓힌다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "Canary·Shadow 판정 기준과 실험 계획이 안전 등급에 맞게 정해진다."
  },
  {
   "id": "O2",
   "text": "SOTIF 출시 근거와 Safety Case가 정리되고 편향 없는 검토자가 검토한다."
  },
  {
   "id": "O3",
   "text": "상품 구성이 작성자와 다른 승인자에게 승인되고 고객 출시는 다시 다른 승인자가 승인한다."
  },
  {
   "id": "O4",
   "text": "형식승인·사용자 고지 조건을 확인한 G7 판정과 출시 전이가 남는다."
  },
  {
   "id": "O5",
   "text": "효력이 Canary Cohort부터 관측 기준을 만족할 때만 넓어진다."
  },
  {
   "id": "O6",
   "text": "기한부 예외는 요청자와 다른 두 사람이 승인하고 기록된 제한 범위만 열며 만료되면 이전 정책 상태로 돌아간다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.7.BP1",
   "name": "Canary·Shadow 판정 기준 정의",
   "definition": "안전 분류와 배포 범위를 기준으로 Canary 단계·관측 기간·중단 기준을 사전에 정한다. 단계 간 확대 조건을 합의하고 Shadow의 비간섭 검증 범위를 명시한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-CANARY-PLAN",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP2",
   "name": "출시 차단 해제 결정",
   "definition": "출시 차단 해제 요청의 현재 불일치·범위·근거·만료를 검토한다. 요청자와 다른 결정자가 제한된 예외를 승인하거나 반려하고 만료 뒤 원래 차단이 다시 적용되는지 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A13"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-FLAG-WAIVER",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP3",
   "name": "효과 실험 계획 등록",
   "definition": "확인할 효과와 지표·대상·기간을 정하여 실험을 계획한다. 안전 관련 기능에 허용되는 방식과 비간섭 근거를 확인하고 승인 범위 내 실행 시점을 관계자와 맞춘다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A02"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-EXPERIMENT-PLAN",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP4",
   "name": "Safety Case·SOTIF 근거 정리",
   "definition": "안전 주장과 잔여 위험을 현재 Version의 분석·검증 근거에 연결한다. 주장·논거·증거의 공백을 확인할 수 있도록 Safety Case를 구성하고 독립 검토에 넘긴다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A03"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-SAFETY-CASE",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP5",
   "name": "Safety Case 독립 검토",
   "definition": "적격한 독립 검토자가 Safety Case의 주장과 증거를 검토하고 일부 근거를 재현한다. 적용 범위·불확실성·발견 사항과 조치 책임을 기록하여 출시 판단에 제공한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A04"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-SC-REVIEW",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP6",
   "name": "상품 구성 작성",
   "definition": "판매할 기능·구성·조건을 상품으로 정의하고 의존·배타·카탈로그 제약을 검증한다. 적합한 차량의 체험 범위를 계획하고 검증되지 않은 구성은 초안으로 구분한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A05"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRODUCT",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP7",
   "name": "상품 구성 승인",
   "definition": "상품 작성과 분리된 책임자가 구성·판매 조건·카탈로그 제약을 검토한다. 구성 승인 또는 반려의 사유를 남기고 고객 출시 승인과의 사람 분리를 유지한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A06"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRODUCT-APPROVAL",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP8",
   "name": "형식승인·사용자 고지 확인",
   "definition": "기관 결정과 시장별 고지·효력 조건이 활성화 범위에 맞는지 확인한다. 기능 작동 중 변경이 허용되지 않는 조건을 명시하여 출시·활성화 판단에 제공한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A07"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-ACTIVATION-PRECHECK",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP9",
   "name": "G7 출시·활성화 판정",
   "definition": "Safety Case 검토·Canary 기준·고지·활성화 조건을 모아 출시 준비를 판단한다. AI·모델을 포함한 변경 관리 근거를 확인하고 필요한 Gate 판정과 출시 책임 확인을 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A08"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-G7-DECISION",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP10",
   "name": "Release Sign-off(출시 책임 확인)",
   "definition": "현재 Gate 판정과 안전 근거·Canary 계획을 확인한 Feature 책임자가 출시 책임을 명시적으로 확인한다. 서명을 당시 판정 기록에 묶고 근거 판정이 바뀌면 서명의 효력을 다시 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A12"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-RELEASE-SIGNOFF",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP11",
   "name": "출시 전이",
   "definition": "현재 OTA·운영 판정과 유효한 출시 책임 서명을 확인하여 출시 전이를 수행한다. 수행자·시각·결과를 기록하고 실패 또는 보완이 필요한 경우 해당 개발·검토 단계로 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A09"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-RELEASE-RECORD",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP12",
   "name": "상품 고객 출시 승인",
   "definition": "구성 승인과 구분된 책임자가 고객 제공 준비와 상품 출시 조건을 검토한다. 고객 출시 결정을 기록하고 상품기획·운영에 제공 범위와 후속 체험 절차를 전달한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A10"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRODUCT-RELEASE",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP13",
   "name": "Canary 활성화·단계적 확대",
   "definition": "승인된 Canary 범위에서 활성화를 시작하고 단계별 관측 결과를 평가한다. 사전 조건을 만족할 때만 확대하며 중단 기준에 해당하면 확대를 멈추고 이상 대응으로 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A11"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-ROLLOUT-RECORD",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.7.BP14",
   "name": "기한부 예외 승인·제한 적용·원복",
   "definition": "예외 요청의 대상 검사와 잔여 리스크를 확인하고 요청자와 다른 두 사람이 기간과 제한 범위를 승인한다. 원래 Gate 판정을 보존하면서 승인 범위에만 적용하고 만료·회수 시 이전 정책 상태로 원복한 근거를 기록한다.",
   "notes": [],
   "activityIds": [
    "FPW.7-A14",
    "FPW.7-A15"
   ],
   "outcomes": [
    "O6"
   ],
   "evidence": [
    {
     "workProduct": "WP-EXCEPTION-RECORD",
     "outcomes": [
      "O6"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-TST-010",
  "FFG-LCY-009",
  "FFG-CLS-006",
  "FFG-SOT-004",
  "FFG-SOT-005",
  "FFG-ADS-008",
  "FFG-ADS-012",
  "FFG-GEN-006",
  "FFG-LCY-010",
  "FFG-LCY-001"
 ],
 "entry": [
  "G6 배포가 끝나 서버에 정책이 게시되었다(차량 내 효력 없음)"
 ],
 "exit": [
  "G7 판정과 VERIFIED→RELEASED 전이가 남았다",
  "Canary 관측 결과에 따라 확대 또는 중단 결정이 기록되었다"
 ],
 "workProducts": [
  {
   "key": "WP-CANARY-PLAN",
   "name": "Canary·Shadow 판정 기준",
   "en": "Canary / Shadow Criteria",
   "kind": "output",
   "retained": false,
   "content": [
    "Cohort별 차량 수·관측 기간·허용 차이·중단 기준",
    "Shadow 출력이 제어기에 전달되지 않는다는 확인"
   ]
  },
  {
   "key": "WP-EXPERIMENT-PLAN",
   "name": "실험 계획",
   "en": "Experiment Plan",
   "kind": "output",
   "retained": false,
   "content": [
    "실험 목적·지표·기간과 대상 Cohort",
    "F2 이상이면 Shadow 방식과 비간섭 입증 근거"
   ]
  },
  {
   "key": "WP-SAFETY-CASE",
   "name": "Safety Case·SOTIF 출시 근거",
   "en": "Safety Case & SOTIF Release Argument",
   "kind": "output",
   "retained": false,
   "content": [
    "주장·논거·증거와 고유 식별자(규칙 ID·시험 ID 재사용)",
    "ISO 21448 출시 기준 충족 근거와 잔여 위험"
   ]
  },
  {
   "key": "WP-SC-REVIEW",
   "name": "Safety Case 독립 검토 기록",
   "en": "Safety Case Independent Review",
   "kind": "output",
   "retained": false,
   "content": [
    "검토자 자격·검토 기간·대상 Version(Safety Case·도구·ADS)",
    "검토 방법·재현한 증거·공백과 불확실 영역·개선 조치"
   ]
  },
  {
   "key": "WP-PRODUCT",
   "name": "상품 구성안",
   "en": "Product Composition",
   "kind": "output",
   "retained": false,
   "content": [
    "상품에 포함되는 Feature와 판매 방식(구독·구매·체험)",
    "구성 검증 결과와 체험 제안 조건"
   ]
  },
  {
   "key": "WP-PRODUCT-APPROVAL",
   "name": "상품 구성 승인 기록",
   "en": "Product Composition Approval",
   "kind": "output",
   "retained": false,
   "content": [
    "구성 승인자(상품 작성자와 다른 사람)와 시각"
   ]
  },
  {
   "key": "WP-ACTIVATION-PRECHECK",
   "name": "활성화 조건 확인서",
   "en": "Activation Precheck",
   "kind": "output",
   "retained": false,
   "content": [
    "형식승인 기관 결정 여부와 근거",
    "시장별 사용자 고지·확인 준비와 '작동 중이 아닐 때 효력' 조건"
   ]
  },
  {
   "key": "WP-G7-DECISION",
   "name": "G7 Decision Record",
   "en": "G7 Decision Record",
   "kind": "output",
   "retained": false,
   "content": [
    "출시·활성화 판정과 근거 Evidence ID(SOTIF·Safety Case·Canary 기준)",
    "Safety Manager 판정 서명, Feature Owner 출시 책임 확인"
   ]
  },
  {
   "key": "WP-RELEASE-SIGNOFF",
   "name": "Release Sign-off 기록",
   "en": "Release Sign-off",
   "kind": "output",
   "retained": false,
   "content": [
    "Feature Owner 개인 서명·서명 시각·소유 조직",
    "서명 시점의 G8·G9 판정 기록 ID(다시 판정되면 효력 없음)"
   ]
  },
  {
   "key": "WP-RELEASE-RECORD",
   "name": "출시 전이 기록",
   "en": "Release Transition Record",
   "kind": "output",
   "retained": false,
   "content": [
    "VERIFIED→RELEASED 전이 시각과 수행자"
   ]
  },
  {
   "key": "WP-PRODUCT-RELEASE",
   "name": "상품 고객 출시 기록",
   "en": "Product Customer Release",
   "kind": "output",
   "retained": true,
   "content": [
    "고객 출시 승인자(구성 승인자와 다른 사람)와 시각"
   ]
  },
  {
   "key": "WP-ROLLOUT-RECORD",
   "name": "단계적 확대 기록",
   "en": "Staged Rollout Record",
   "kind": "output",
   "retained": false,
   "content": [
    "Cohort 단계별 적용 시각·관측 결과",
    "확대·중단 결정과 근거"
   ]
  },
  {
   "key": "WP-FLAG-WAIVER",
   "name": "출시 차단 해제 결정 기록",
   "en": "Flag Release Gate Waiver Decision",
   "kind": "output",
   "retained": true,
   "content": [
    "해제 대상 Flag·요청 당시 대사 상태·사유·만료",
    "요청자와 다른 결정자의 개인 서명·시각(F2 이상은 Safety Manager 포함)"
   ]
  },
  {
   "key": "WP-EXCEPTION-RECORD",
   "name": "예외 승인 기록",
   "en": "Exception Approval Record",
   "kind": "output",
   "retained": false,
   "content": [
    "요청자·긴급 사유·대상 Feature·적용 기간·우회할 검사 또는 PENDING Gate·제한 조건·완료 예정일·잔여 리스크",
    "두 승인자의 승인·지정 만료 일시(반려 사유), 적용한 배포와 이전 상태, 만료·회수 원복 메시지"
   ]
  }
 ],
 "activities": [
  {
   "id": "FPW.7-A01",
   "name": "Canary·Shadow 판정 기준 정의",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-TST-010",
    "FFG-LCY-009"
   ],
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
   "steps": [
    "F2 이상 Feature는 Canary Cohort에서 시작하도록 단계별 차량 수와 관측 기간을 정한다",
    "단계마다 허용 차이와 중단 기준을 사전에 적고 Safety Manager와 합의한다",
    "Shadow를 쓰면 출력이 제어기로 가지 않는 구성인지 시험 조직과 확인한다"
   ],
   "checks": [
    "모든 단계에 관측 기간·허용 차이·중단 기준이 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/activation/decide",
     "/policies/:id"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A08"
   ]
  },
  {
   "id": "FPW.7-A13",
   "name": "출시 차단 해제 결정",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [
    "FPW.5-A07"
   ],
   "outcomes": [
    "O1"
   ],
   "rules": [],
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
   "steps": [
    "해제 요청의 사유·만료·요청 당시 대사 상태를 확인한다",
    "F2 이상이면 Safety Manager의 의견을 받는다",
    "개인 서명으로 승인 또는 반려하고 만료 뒤 다시 막히는 것을 확인한다"
   ],
   "checks": [
    "요청자와 결정자가 다른 사람이다"
   ],
   "platform": {
    "actions": [
     "decideFlagGateWaiver"
    ],
    "screens": [
     "/flag-code/reconcile"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A12"
   ]
  },
  {
   "id": "FPW.7-A14",
   "name": "예외 요청(임시 우회·Gate 예외)",
   "trigger": "긴급 상황에서 배포 검사나 PENDING 출시 Gate를 기한부로 비켜 가야 할 때",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O6"
   ],
   "rules": [
    "FFG-LCY-002"
   ],
   "raci": {
    "R": [
     "R-REL"
    ],
    "A": "R-REL",
    "C": [
     "R-OPS",
     "R-FO"
    ],
    "I": [
     "R-SM"
    ]
   },
   "inputs": [
    "WP-CANARY-PLAN"
   ],
   "outputs": [
    "WP-EXCEPTION-RECORD"
   ],
   "steps": [
    "긴급 사유·적용 기간·우회할 검사(또는 PENDING Gate)와 제한 조건(제한 배포·Pilot·Shadow)을 적어 요청한다",
    "Gate 예외는 완료 예정일과 잔여 리스크를 함께 적는다",
    "서명·무결성, 긴급 차단 2인 승인, 직무 분리, 멈추기는 예외로 요청할 수 없다"
   ],
   "checks": [
    "적용 기간이 있고 우회 불가 항목이 없다"
   ],
   "platform": {
    "actions": [
     "createExceptionPolicy"
    ],
    "screens": [
     "/verify/exceptions",
     "/policies/:id"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A15"
   ]
  },
  {
   "id": "FPW.7-A15",
   "name": "예외 승인·만료 원복 확인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [
    "FPW.7-A14"
   ],
   "outcomes": [
    "O6"
   ],
   "rules": [
    "FFG-LCY-002"
   ],
   "raci": {
    "R": [
     "R-SM",
     "R-OPS"
    ],
    "A": "R-SM",
    "C": [
     "R-FO"
    ],
    "I": [
     "R-REL",
     "R-QA"
    ]
   },
   "inputs": [
    "WP-EXCEPTION-RECORD"
   ],
   "outputs": [
    "WP-EXCEPTION-RECORD"
   ],
   "steps": [
    "요청자가 아닌 두 사람(서로 다른 승인자)이 만료 일시를 정해 승인하거나 사유를 적어 반려한다",
    "두 번째 승인 뒤 기록된 제한 범위까지만 배포되는지 확인한다",
    "만료되면 플랫폼이 이전 정책 상태로 되돌리고 원복을 알린다. 더 일찍 끝내야 하면 회수한다"
   ],
   "checks": [
    "요청자와 두 승인자가 모두 다른 사람이다",
    "만료 일시가 있고 Gate 판정은 PENDING 그대로다"
   ],
   "platform": {
    "actions": [
     "decideExceptionPolicy",
     "revokeExceptionPolicy"
    ],
    "screens": [
     "/verify/exceptions"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": []
  },
  {
   "id": "FPW.7-A02",
   "name": "효과 실험 계획 등록",
   "trigger": "출시 효과를 실험으로 비교해야 할 때",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-CLS-006"
   ],
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
   "steps": [
    "실험 목적·지표·기간·Cohort를 정한다",
    "F2 이상 Feature면 Experiment Flag 대신 Shadow 방식으로 바꾸고 비간섭 입증 계획을 붙인다",
    "실험을 등록하고 Release Manager에게 시작 시점을 알린다"
   ],
   "checks": [
    "F2 이상 Feature에 Experiment Flag 실험이 등록되지 않았다"
   ],
   "platform": {
    "actions": [
     "createExperiment"
    ],
    "screens": [
     "/experiments"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A08"
   ]
  },
  {
   "id": "FPW.7-A03",
   "name": "Safety Case·SOTIF 근거 정리",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-SOT-004",
    "FFG-ADS-008"
   ],
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
   "steps": [
    "F2 이상 Feature의 ISO 21448 출시 기준 충족 근거와 잔여 위험을 정리한다",
    "Safety Case의 주장마다 논거를, 논거마다 증거를 두고 규칙 ID·시험 ID를 식별자로 붙인다",
    "정리한 Safety Case를 독립 검토에 넘긴다"
   ],
   "checks": [
    "모든 주장에 논거와 증거가 하나 이상 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/verify/evidence",
     "/verify/compliance",
     "/verify/safety-case"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A04"
   ]
  },
  {
   "id": "FPW.7-A04",
   "name": "Safety Case 독립 검토",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [
    "FPW.7-A03"
   ],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-ADS-012"
   ],
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
   "steps": [
    "Safety Case를 만들지 않은 검토자가 검토 자격과 대상 Version(Safety Case·도구·ADS)을 기록한다",
    "증거 일부를 다시 실행해 재현하고, 공백과 불확실한 영역을 적는다",
    "발견사항의 개선 조치와 담당을 기록해 Safety Manager에게 넘긴다"
   ],
   "checks": [
    "검토 기록에 자격·기간·Version·방법·재현 증거·공백이 모두 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A08"
   ]
  },
  {
   "id": "FPW.7-A05",
   "name": "상품 구성 작성",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "상품에 넣을 Feature와 판매 방식을 정해 상품을 등록한다",
    "구성 검증으로 Feature 간 의존·배타 충돌이 없는지 확인한다. PASS일 때 등록하고, FAIL은 결과를 확인한 뒤 초안으로만 등록한다",
    "Bill-of-Features 점검으로 카탈로그 제약(기준 행 선행·배타, 하위 feature의 상위, 대안 중복)을 보고, 제품 구성기로 켜질 Flag·SW를 미리 본다",
    "체험 제안 조건(대상·기간)을 정한다. 대상은 범위 안 고객 차량만이고 시뮬레이터 차량은 뺀다"
   ],
   "checks": [
    "구성 검증 결과에 충돌이 없다"
   ],
   "platform": {
    "actions": [
     "createProduct",
     "validateComposition",
     "checkBillOfFeatures",
     "offerTrials"
    ],
    "screens": [
     "/products/new",
     "/entitlements",
     "/products/bill-of-features",
     "/products/configurator"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A06"
   ]
  },
  {
   "id": "FPW.7-A06",
   "name": "상품 구성 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "상품 작성자가 아닌 상품 Owner가 구성과 판매 조건을 검토한다",
    "상품 화면의 Bill-of-Features에서 카탈로그 제약 위반을 확인한다 — 위반이 있으면 구성 승인이 막히므로 작성자에게 구성 보완을 돌려보낸다",
    "승인하면 구성 승인 전이를 하고, 반려하면 사유를 남긴다",
    "고객 출시 승인은 구성 승인자와 다른 사람이 하도록 승인 후보를 지정한다"
   ],
   "checks": [
    "구성 승인자가 상품 작성자와 다르다",
    "카탈로그 제약 위반(선행·배타·대안 중복)이 없다"
   ],
   "platform": {
    "actions": [
     "productTransition"
    ],
    "screens": [
     "/products/:id/:ver"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A08"
   ]
  },
  {
   "id": "FPW.7-A07",
   "name": "형식승인·사용자 고지 확인",
   "trigger": "G6 배포 완료",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-GEN-006",
    "FFG-LCY-010"
   ],
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
   "steps": [
    "형식승인 영향이 있는 변경이면 승인 기관의 개정·확장 결정이 나왔는지 확인한다",
    "시장 Profile이 요구하는 사용자 고지·확인 문구와 절차가 준비되었는지 확인한다",
    "F2 이상 Feature의 활성화가 기능 작동 중이 아닐 때만 효력을 내는지 확인한다"
   ],
   "checks": [
    "활성화 조건 확인서에 기관 결정·고지 준비·효력 조건이 모두 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A08"
   ]
  },
  {
   "id": "FPW.7-A08",
   "name": "G7 출시·활성화 판정",
   "trigger": null,
   "gateDecision": "G7",
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-SOT-005",
    "FFG-SOT-004",
    "FFG-LCY-001"
   ],
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
   "steps": [
    "SOTIF 출시 근거·Safety Case 검토·Canary 기준·활성화 조건이 모두 있는지 확인하고 하나라도 없으면 FAIL로 판정한다",
    "AI·ML 모델을 쓰는 Feature면 데이터·모델 수명주기 요구를 확인하고 모델 교체가 새 Version으로 관리되는지 본다",
    "Safety Manager가 Operations Gate에 판정을 등록하고, Feature Owner에게 Release Sign-off를 요청한다"
   ],
   "checks": [
    "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
   ],
   "platform": {
    "actions": [
     "judgeGate"
    ],
    "screens": [
     "/activation/decide",
     "/admin/approval"
    ],
    "gates": [
     "G9"
    ],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A13"
   ]
  },
  {
   "id": "FPW.7-A12",
   "name": "Release Sign-off(출시 책임 확인)",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-LCY-001"
   ],
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
   "steps": [
    "G8·G9 판정과 Safety Case 검토·Canary 기준을 확인한다",
    "Feature 상세에서 사유를 적고 개인 서명으로 출시 책임을 확인한다",
    "G8·G9가 다시 판정되면 이전 서명은 효력이 없으므로 다시 서명한다"
   ],
   "checks": [
    "서명이 현재 G8·G9 판정 기록에 묶여 유효하다"
   ],
   "platform": {
    "actions": [
     "signRelease"
    ],
    "screens": [
     "/features/:id/:ver"
    ],
    "gates": [],
    "anchor": "release-signoff",
    "ui": {
     "fields": [
      "reason"
     ],
     "buttons": [
      "signRelease"
     ]
    }
   },
   "slaHours": 24,
   "next": [
    "FPW.7-A09"
   ]
  },
  {
   "id": "FPW.7-A09",
   "name": "출시 전이",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [],
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
   "steps": [
    "OTA·Operations Gate PASS와 유효한 Release Sign-off를 확인하고 Lifecycle을 VERIFIED에서 RELEASED로 전이한다",
    "전이 결과를 운영 조직과 상품 Owner에게 알린다",
    "판정이 FAIL이면 개발 단계로 되돌리는 전이를 하고 사유를 남긴다"
   ],
   "checks": [
    "Feature Version이 RELEASED이고 전이 수행자가 기록되었다"
   ],
   "platform": {
    "actions": [
     "transition"
    ],
    "screens": [
     "/features/:id/:ver"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.7-A10",
    "FPW.7-A11"
   ]
  },
  {
   "id": "FPW.7-A10",
   "name": "상품 고객 출시 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "구성 승인자가 아닌 상품 Owner가 고객 출시를 승인한다. 데모에서는 approver가 구성을, productowner가 고객 출시를 승인한다",
    "구성 승인자에게는 화면이 출시 승인 버튼을 미리 막고 이유를 보인다. 서버도 같은 사람의 승인을 거부한다",
    "출시한 상품은 상세에서 체험 제안으로 이어진다",
    "출시 승인 결과를 상품 기획과 운영 조직에 알린다"
   ],
   "checks": [
    "고객 출시 승인자가 구성 승인자와 다르다"
   ],
   "platform": {
    "actions": [
     "productTransition"
    ],
    "screens": [
     "/products/:id/:ver"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": []
  },
  {
   "id": "FPW.7-A11",
   "name": "Canary 활성화·단계적 확대",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [
    "FFG-LCY-009",
    "FFG-TST-010"
   ],
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
   "steps": [
    "승인 범위 안에서 Canary Cohort부터 활성화를 적용한다",
    "관측 기간 동안 중단 기준을 감시하고 만족할 때만 다음 Cohort로 넓힌다",
    "중단 기준에 걸리면 확대를 멈추고 이상 징후 대응(FPW.8)으로 넘긴다"
   ],
   "checks": [
    "단계마다 관측 결과와 확대·중단 결정이 기록되었다"
   ],
   "platform": {
    "actions": [
     "stageRollout"
    ],
    "screens": [
     "/activation/decide",
     "/fleet/live",
     "/features/:id/:ver",
     "/notifications"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": []
  }
 ],
 "layout": {
  "width": 2206,
  "height": 882,
  "lanes": [
   {
    "role": "R-OPS",
    "label": "운영 조직",
    "x": 0,
    "y": 0,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-REQ",
    "label": "요구 Owner",
    "x": 0,
    "y": 98,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-REL",
    "label": "Release Manager",
    "x": 0,
    "y": 196,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-SM",
    "label": "Safety Manager",
    "x": 0,
    "y": 294,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-FO",
    "label": "Feature Owner",
    "x": 0,
    "y": 392,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-QA",
    "label": "품질 조직",
    "x": 0,
    "y": 490,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-PDA",
    "label": "상품 기획",
    "x": 0,
    "y": 588,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-PO",
    "label": "상품 Owner",
    "x": 0,
    "y": 686,
    "w": 2206,
    "h": 98
   },
   {
    "role": "R-REG",
    "label": "법규 담당",
    "x": 0,
    "y": 784,
    "w": 2206,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.7-A01",
    "kind": "action",
    "label": "Canary·Shadow 판정 기준 정의",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A11",
    "kind": "action",
    "label": "Canary 활성화·단계적 확대",
    "x": 1878,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A13",
    "kind": "action",
    "label": "출시 차단 해제 결정",
    "x": 1038,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A14",
    "kind": "action",
    "label": "예외 요청(임시 우회·Gate 예외)",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A09",
    "kind": "action",
    "label": "출시 전이",
    "x": 1598,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A15",
    "kind": "action",
    "label": "예외 승인·만료 원복 확인",
    "x": 478,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A03",
    "kind": "action",
    "label": "Safety Case·SOTIF 근거 정리",
    "x": 198,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A08",
    "kind": "action",
    "label": "G7 출시·활성화 판정",
    "x": 758,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A02",
    "kind": "action",
    "label": "효과 실험 계획 등록",
    "x": 478,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A12",
    "kind": "action",
    "label": "Release Sign-off(출시 책임 확인)",
    "x": 1318,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A04",
    "kind": "action",
    "label": "Safety Case 독립 검토",
    "x": 478,
    "y": 506,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A05",
    "kind": "action",
    "label": "상품 구성 작성",
    "x": 198,
    "y": 604,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A06",
    "kind": "action",
    "label": "상품 구성 승인",
    "x": 478,
    "y": 702,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A10",
    "kind": "action",
    "label": "상품 고객 출시 승인",
    "x": 1878,
    "y": 702,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A07",
    "kind": "action",
    "label": "형식승인·사용자 고지 확인",
    "x": 478,
    "y": 800,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S2",
    "kind": "start",
    "label": "긴급 상황에서 배포 검사나 PENDING 출시 Gate를 기한부로 비켜 가야 할 때",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S3",
    "kind": "start",
    "label": "출시 효과를 실험으로 비교해야 할 때",
    "x": 426,
    "y": 432,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S4",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 146,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S5",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 146,
    "y": 628,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S6",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 426,
    "y": 824,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E1",
    "kind": "end",
    "label": "종료",
    "x": 680,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E2",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 726,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E3",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.7-S1",
    "to": "FPW.7-A01",
    "kind": "start",
    "points": [
     [
      164,
      49
     ],
     [
      198,
      49
     ]
    ]
   },
   {
    "from": "FPW.7-S2",
    "to": "FPW.7-A14",
    "kind": "trigger",
    "points": [
     [
      164,
      245
     ],
     [
      198,
      245
     ]
    ]
   },
   {
    "from": "FPW.7-S3",
    "to": "FPW.7-A02",
    "kind": "trigger",
    "points": [
     [
      444,
      441
     ],
     [
      478,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-S4",
    "to": "FPW.7-A03",
    "kind": "trigger",
    "points": [
     [
      164,
      343
     ],
     [
      198,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-S5",
    "to": "FPW.7-A05",
    "kind": "trigger",
    "points": [
     [
      164,
      637
     ],
     [
      198,
      637
     ]
    ]
   },
   {
    "from": "FPW.7-S6",
    "to": "FPW.7-A07",
    "kind": "trigger",
    "points": [
     [
      444,
      833
     ],
     [
      478,
      833
     ]
    ]
   },
   {
    "from": "FPW.7-A01",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      746,
      49
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A13",
    "to": "FPW.7-A12",
    "kind": "flow",
    "points": [
     [
      1226,
      147
     ],
     [
      1306,
      147
     ],
     [
      1306,
      441
     ],
     [
      1318,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-A14",
    "to": "FPW.7-A15",
    "kind": "flow",
    "points": [
     [
      386,
      245
     ],
     [
      466,
      245
     ],
     [
      466,
      343
     ],
     [
      478,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A02",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      441
     ],
     [
      746,
      441
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A03",
    "to": "FPW.7-A04",
    "kind": "flow",
    "points": [
     [
      386,
      343
     ],
     [
      466,
      343
     ],
     [
      466,
      539
     ],
     [
      478,
      539
     ]
    ]
   },
   {
    "from": "FPW.7-A04",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      539
     ],
     [
      746,
      539
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A05",
    "to": "FPW.7-A06",
    "kind": "flow",
    "points": [
     [
      386,
      637
     ],
     [
      466,
      637
     ],
     [
      466,
      735
     ],
     [
      478,
      735
     ]
    ]
   },
   {
    "from": "FPW.7-A06",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      735
     ],
     [
      746,
      735
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A07",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      833
     ],
     [
      746,
      833
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A08",
    "to": "FPW.7-A13",
    "kind": "flow",
    "points": [
     [
      946,
      343
     ],
     [
      1026,
      343
     ],
     [
      1026,
      147
     ],
     [
      1038,
      147
     ]
    ]
   },
   {
    "from": "FPW.7-A12",
    "to": "FPW.7-A09",
    "kind": "flow",
    "points": [
     [
      1506,
      441
     ],
     [
      1586,
      441
     ],
     [
      1586,
      245
     ],
     [
      1598,
      245
     ]
    ]
   },
   {
    "from": "FPW.7-A09",
    "to": "FPW.7-A10",
    "kind": "flow",
    "points": [
     [
      1786,
      245
     ],
     [
      1866,
      245
     ],
     [
      1866,
      735
     ],
     [
      1878,
      735
     ]
    ]
   },
   {
    "from": "FPW.7-A09",
    "to": "FPW.7-A11",
    "kind": "flow",
    "points": [
     [
      1786,
      245
     ],
     [
      1866,
      245
     ],
     [
      1866,
      49
     ],
     [
      1878,
      49
     ]
    ]
   },
   {
    "from": "FPW.7-A15",
    "to": "FPW.7-E1",
    "kind": "end",
    "points": [
     [
      666,
      343
     ],
     [
      680,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A10",
    "to": "FPW.7-E2",
    "kind": "end",
    "points": [
     [
      2066,
      735
     ],
     [
      2080,
      735
     ]
    ]
   },
   {
    "from": "FPW.7-A11",
    "to": "FPW.7-E3",
    "kind": "end",
    "points": [
     [
      2066,
      49
     ],
     [
      2080,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    746,
    343
   ],
   [
    746,
    441
   ],
   [
    746,
    539
   ],
   [
    746,
    735
   ]
  ]
 },
 "departmentLayout": {
  "width": 2206,
  "height": 776,
  "lanes": [
   {
    "department": "DEP-OPS",
    "label": "OTA·서비스운영팀",
    "x": 0,
    "y": 0,
    "w": 2206,
    "h": 98
   },
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 98,
    "w": 2206,
    "h": 98
   },
   {
    "department": "DEP-INT",
    "label": "SW통합·릴리스팀",
    "x": 0,
    "y": 196,
    "w": 2206,
    "h": 98
   },
   {
    "department": "DEP-FS",
    "label": "기능안전팀",
    "x": 0,
    "y": 294,
    "w": 2206,
    "h": 98
   },
   {
    "department": "DEP-PDP",
    "label": "상품기획팀",
    "x": 0,
    "y": 392,
    "w": 2206,
    "h": 188
   },
   {
    "department": "DEP-QA",
    "label": "품질팀",
    "x": 0,
    "y": 580,
    "w": 2206,
    "h": 98
   },
   {
    "department": "DEP-HOM",
    "label": "법규인증팀",
    "x": 0,
    "y": 678,
    "w": 2206,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.7-A01",
    "kind": "action",
    "label": "Canary·Shadow 판정 기준 정의",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A11",
    "kind": "action",
    "label": "Canary 활성화·단계적 확대",
    "x": 1878,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A13",
    "kind": "action",
    "label": "출시 차단 해제 결정",
    "x": 1038,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A14",
    "kind": "action",
    "label": "예외 요청(임시 우회·Gate 예외)",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A09",
    "kind": "action",
    "label": "출시 전이",
    "x": 1598,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A15",
    "kind": "action",
    "label": "예외 승인·만료 원복 확인",
    "x": 478,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A03",
    "kind": "action",
    "label": "Safety Case·SOTIF 근거 정리",
    "x": 198,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A08",
    "kind": "action",
    "label": "G7 출시·활성화 판정",
    "x": 758,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A02",
    "kind": "action",
    "label": "효과 실험 계획 등록",
    "x": 478,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A05",
    "kind": "action",
    "label": "상품 구성 작성",
    "x": 198,
    "y": 498,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A06",
    "kind": "action",
    "label": "상품 구성 승인",
    "x": 478,
    "y": 498,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A12",
    "kind": "action",
    "label": "Release Sign-off(출시 책임 확인)",
    "x": 1318,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A10",
    "kind": "action",
    "label": "상품 고객 출시 승인",
    "x": 1878,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A04",
    "kind": "action",
    "label": "Safety Case 독립 검토",
    "x": 478,
    "y": 596,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-A07",
    "kind": "action",
    "label": "형식승인·사용자 고지 확인",
    "x": 478,
    "y": 694,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.7-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S2",
    "kind": "start",
    "label": "긴급 상황에서 배포 검사나 PENDING 출시 Gate를 기한부로 비켜 가야 할 때",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S3",
    "kind": "start",
    "label": "출시 효과를 실험으로 비교해야 할 때",
    "x": 426,
    "y": 432,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S4",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 146,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S5",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 146,
    "y": 522,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-S6",
    "kind": "start",
    "label": "G6 배포 완료",
    "x": 426,
    "y": 718,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E1",
    "kind": "end",
    "label": "종료",
    "x": 680,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E2",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 432,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.7-E3",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.7-S1",
    "to": "FPW.7-A01",
    "kind": "start",
    "points": [
     [
      164,
      49
     ],
     [
      198,
      49
     ]
    ]
   },
   {
    "from": "FPW.7-S2",
    "to": "FPW.7-A14",
    "kind": "trigger",
    "points": [
     [
      164,
      245
     ],
     [
      198,
      245
     ]
    ]
   },
   {
    "from": "FPW.7-S3",
    "to": "FPW.7-A02",
    "kind": "trigger",
    "points": [
     [
      444,
      441
     ],
     [
      478,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-S4",
    "to": "FPW.7-A03",
    "kind": "trigger",
    "points": [
     [
      164,
      343
     ],
     [
      198,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-S5",
    "to": "FPW.7-A05",
    "kind": "trigger",
    "points": [
     [
      164,
      531
     ],
     [
      198,
      531
     ]
    ]
   },
   {
    "from": "FPW.7-S6",
    "to": "FPW.7-A07",
    "kind": "trigger",
    "points": [
     [
      444,
      727
     ],
     [
      478,
      727
     ]
    ]
   },
   {
    "from": "FPW.7-A01",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      746,
      49
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A13",
    "to": "FPW.7-A12",
    "kind": "flow",
    "points": [
     [
      1226,
      147
     ],
     [
      1306,
      147
     ],
     [
      1306,
      441
     ],
     [
      1318,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-A14",
    "to": "FPW.7-A15",
    "kind": "flow",
    "points": [
     [
      386,
      245
     ],
     [
      466,
      245
     ],
     [
      466,
      343
     ],
     [
      478,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A02",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      441
     ],
     [
      746,
      441
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A03",
    "to": "FPW.7-A04",
    "kind": "flow",
    "points": [
     [
      386,
      343
     ],
     [
      466,
      343
     ],
     [
      466,
      629
     ],
     [
      478,
      629
     ]
    ]
   },
   {
    "from": "FPW.7-A04",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      629
     ],
     [
      746,
      629
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A05",
    "to": "FPW.7-A06",
    "kind": "flow",
    "points": [
     [
      386,
      531
     ],
     [
      478,
      531
     ]
    ]
   },
   {
    "from": "FPW.7-A06",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      531
     ],
     [
      746,
      531
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A07",
    "to": "FPW.7-A08",
    "kind": "flow",
    "points": [
     [
      666,
      727
     ],
     [
      746,
      727
     ],
     [
      746,
      343
     ],
     [
      758,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A08",
    "to": "FPW.7-A13",
    "kind": "flow",
    "points": [
     [
      946,
      343
     ],
     [
      1026,
      343
     ],
     [
      1026,
      147
     ],
     [
      1038,
      147
     ]
    ]
   },
   {
    "from": "FPW.7-A12",
    "to": "FPW.7-A09",
    "kind": "flow",
    "points": [
     [
      1506,
      441
     ],
     [
      1586,
      441
     ],
     [
      1586,
      245
     ],
     [
      1598,
      245
     ]
    ]
   },
   {
    "from": "FPW.7-A09",
    "to": "FPW.7-A10",
    "kind": "flow",
    "points": [
     [
      1786,
      245
     ],
     [
      1866,
      245
     ],
     [
      1866,
      441
     ],
     [
      1878,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-A09",
    "to": "FPW.7-A11",
    "kind": "flow",
    "points": [
     [
      1786,
      245
     ],
     [
      1866,
      245
     ],
     [
      1866,
      49
     ],
     [
      1878,
      49
     ]
    ]
   },
   {
    "from": "FPW.7-A15",
    "to": "FPW.7-E1",
    "kind": "end",
    "points": [
     [
      666,
      343
     ],
     [
      680,
      343
     ]
    ]
   },
   {
    "from": "FPW.7-A10",
    "to": "FPW.7-E2",
    "kind": "end",
    "points": [
     [
      2066,
      441
     ],
     [
      2080,
      441
     ]
    ]
   },
   {
    "from": "FPW.7-A11",
    "to": "FPW.7-E3",
    "kind": "end",
    "points": [
     [
      2066,
      49
     ],
     [
      2080,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    746,
    343
   ],
   [
    746,
    441
   ],
   [
    746,
    531
   ],
   [
    746,
    629
   ]
  ]
 }
};

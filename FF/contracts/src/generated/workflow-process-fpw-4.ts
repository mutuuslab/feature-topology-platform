// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.4",
 "name": "안전 설계·정책 설계",
 "en": "Safety Design & Policy Design",
 "group": "생애주기",
 "gates": [
  "G4"
 ],
 "ref": "표준 보고서 6.1절 G4, 6장 FFG-LCY-006, 7.7절 FFG-DEAC-001, 8장(정책·TCL), 13장 FFG-TEL-007",
 "purpose": "안전요구를 차량 내 감시·Safety Guard 동작·플랫폼 정책과 Control Point 설계로 구현하고, 정책을 분야별로 검증·승인한 뒤 독립 검토자가 설계 적합성(G4)을 판정하게 한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "F2 이상 Feature의 고장 대응이 차량 내부 감시와 안전기제로 설계된다."
  },
  {
   "id": "O2",
   "text": "플랫폼 컴포넌트의 도구 신뢰도(TCL)와 확보 방법이 정해진다."
  },
  {
   "id": "O3",
   "text": "Flag 정책이 작성·검증되고 작성자가 아닌 승인자가 승인한다."
  },
  {
   "id": "O4",
   "text": "독립 검토로 G4 설계 판정이 남는다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.4.BP1",
   "name": "차량 내 감시·안전기제 설계",
   "definition": "안전요구를 차량 내부의 감시·Guard·안전 기제와 제어점 설계에 할당한다. 차량의 시간 예산 안에서 동작할 경로와 원격 요청·늦은 관측의 경계를 분리하여 요구와 설계의 대응을 보존한다.",
   "notes": [
    "원격 통신이나 플랫폼 화면을 차량의 FTTI 안 안전 기제의 대체로 정의하지 않는다."
   ],
   "activityIds": [
    "FPW.4-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-SAFETY-DESIGN",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP2",
   "name": "Flag 정책 작성·검증",
   "definition": "적용 대상·Variant·기본값을 명시한 정책을 작성하고 현재 개정본을 분야별 검증으로 평가한다. 수정으로 근거가 달라지면 재검증하여 승인 대상 내용과 결과를 일치시킨다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-POLICY",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP3",
   "name": "정책 근거 변경요청(CR) 연결",
   "definition": "정책 변경의 이유와 범위를 외부 변경요청에 연결하여 의사결정의 근거를 추적한다. 외부 결정의 반영 여부와 거부 사유를 확인하고 플랫폼 정책 상태와 불일치를 해소한다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A06"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-POLICY-CR",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP4",
   "name": "정책 승인",
   "definition": "최신 정책 내용의 해시와 검증 결과를 확인하여 승인 또는 반려를 결정한다. 작성자와 구분된 승인자가 결정 근거를 남기고 수정이 필요한 경우 작성자에게 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-POLICY",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP5",
   "name": "플랫폼 도구 신뢰도 분류",
   "definition": "플랫폼 도구의 오류 출력과 검출 수단을 분석하여 신뢰도 분류와 확보 방법을 결정한다. 사용 범위와 분류 근거를 기록하고 필요한 확인 활동을 Safety Plan에 반영한다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-TCL-RECORD",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP6",
   "name": "G4 설계 독립 검토·판정",
   "definition": "설계·정책·인터페이스가 안전요구를 충족하는지 독립적으로 검토한다. 발견 사항과 근거를 기록하고 설계 책임자의 확인 및 판정 결과에 따라 수정·재검토를 관리한다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A05"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-G4-DECISION",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.4.BP7",
   "name": "Flag PR 검토·병합",
   "definition": "승인된 Version의 Flag 코드 변경을 검토하고 기본값·호출 구조·검사 결과를 확인한다. 병합 결과와 코드 연결 상태를 추적하여 정의와 구현이 어긋난 채 후속 출시로 넘어가지 않게 한다.",
   "notes": [],
   "activityIds": [
    "FPW.4-A07"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-FLAG-PR-RESULT",
     "outcomes": [
      "O3"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-LCY-006",
  "FFG-DEAC-001",
  "FFG-TEL-007",
  "FFG-PLT-013",
  "FFG-CLS-002",
  "FFG-LCY-001"
 ],
 "entry": [
  "Feature Version이 APPROVED이고 안전요구가 추적 연결되어 있다"
 ],
 "exit": [
  "설계서·정책이 승인되고 정책 해시가 고정되었다",
  "G4 Decision Record가 독립 검토자 판정으로 남았다"
 ],
 "workProducts": [
  {
   "key": "WP-SAFETY-DESIGN",
   "name": "안전 설계서",
   "en": "Safety Design Specification",
   "kind": "output",
   "retained": false,
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
   "en": "Tool Confidence Record",
   "kind": "output",
   "retained": false,
   "content": [
    "컴포넌트별 오류 출력 유형과 TI·TD·TCL",
    "TD1 주장 시 출력 유형별 검출 수단",
    "TCL2 이상 컴포넌트의 신뢰도 확보 방법"
   ]
  },
  {
   "key": "WP-POLICY",
   "name": "Flag 정책(검증·승인본)",
   "en": "Flag Policy",
   "kind": "output",
   "retained": false,
   "content": [
    "대상 규칙·Variant 조건·기본값과 개정 번호",
    "분야별 검증 8종 결과와 배포 안전성 판정",
    "승인자·정책 해시·승인 시각"
   ]
  },
  {
   "key": "WP-G4-DECISION",
   "name": "G4 Decision Record",
   "en": "G4 Decision Record",
   "kind": "output",
   "retained": false,
   "content": [
    "설계 적합성 판정과 근거 Evidence ID",
    "독립 검토자 서명과 아키텍트 책임 확인"
   ]
  },
  {
   "key": "WP-POLICY-CR",
   "name": "정책 근거 변경요청(CR) 연결",
   "en": "Policy Change Request Link",
   "kind": "output",
   "retained": true,
   "content": [
    "정책 ID와 근거 JIRA 변경요청(CR) 키·상태",
    "JIRA에서 CR 승인·반려가 정책 결정으로 반영되거나 거부된 기록과 사유"
   ]
  },
  {
   "key": "WP-FLAG-PR-RESULT",
   "name": "Flag 코드 변경 검토·병합 기록",
   "en": "Flag 코드 변경 검토·병합 기록",
   "kind": "output",
   "retained": true,
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
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-LCY-006",
    "FFG-DEAC-001",
    "FFG-TEL-007",
    "FFG-CLS-002"
   ],
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
   "steps": [
    "F2 이상 Feature가 FTTI 안에서 자기 고장을 감지해 Safety Guard에 보고하는 감시 구조를 설계한다",
    "원격 Kill은 FTTI 밖의 요청 경로로만 두고 FTTI 안의 대응은 차량 내부 안전기제로 설계한다",
    "텔레메트리가 늦거나 오지 않아도 차량 안전 판정이 바뀌지 않게 데이터 경로를 분리한다",
    "안전 거동을 바꾸는 Flag와 전달 경로가 사용 SW의 최고 ASIL을 상속하도록 Control Point를 정의한다"
   ],
   "checks": [
    "안전요구마다 설계 요소가 연결되었다",
    "원격 Kill이 안전기제로 쓰인 곳이 없다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/master/control-points",
     "/trace/design"
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
    "FPW.4-A03"
   ]
  },
  {
   "id": "FPW.4-A03",
   "name": "Flag 정책 작성·검증",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-CLS-002"
   ],
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
   "steps": [
    "대상 규칙·Variant 조건·기본값을 정책으로 작성한다",
    "정책에 브랜드·적용 지역 코드·법규 룰의 조회 조건을 연결하고 Feature Owner가 변경 근거와 개정 이력을 확인한다. 이 메타데이터 연결 자체를 배포 승인이나 차량 적용으로 보지 않는다",
    "분야별 검증 8종을 실행해 배포 안전성 판정을 받는다",
    "수정하면 새 개정본이 되므로 다시 검증한다"
   ],
   "checks": [
    "최신 개정본의 분야별 검증이 모두 통과했다"
   ],
   "platform": {
    "actions": [
     "createPolicy",
     "updatePolicy",
     "validatePolicy",
     "createPolicyGlobalScope",
     "updatePolicyGlobalScope"
    ],
    "screens": [
     "/policies/new",
     "/policies",
     "/config/odd",
     "/policies/global-scope"
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
    "FPW.4-A06"
   ]
  },
  {
   "id": "FPW.4-A06",
   "name": "정책 근거 변경요청(CR) 연결",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "정책 상세의 변경요청 패널에서 근거 JIRA 변경요청(CR) 키를 골라 정책에 연결한다. 근거 CR이 없으면 JIRA에 만든 뒤 연결한다",
    "외부 연계 현황에서 CR 상태와 연결된 정책·Feature Version을 확인한다",
    "승인자에게 CR을 알린다. JIRA에서 CR을 승인·반려해도 검증 GO 정책이고 정책 승인 권한이 있는 매핑된 계정일 때만 정책 결정으로 반영된다",
    "거부되어 CR 상태가 되돌아가면 받은 함의 사유를 CR 담당에게 알리고 플랫폼에서 승인하도록 안내한다"
   ],
   "checks": [
    "승인 대상 정책에 근거 CR이 연결되어 있고 CR 상태가 정책 결정과 맞다"
   ],
   "platform": {
    "actions": [
     "linkPolicyChangeRequest"
    ],
    "screens": [
     "/policies/:id",
     "/integration/connectors"
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
    "FPW.4-A04"
   ]
  },
  {
   "id": "FPW.4-A04",
   "name": "정책 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "승인 대상 개정본의 해시와 배포 안전성 판정(GO)을 확인한다",
    "정책 작성자가 아닌 사람이 승인 또는 반려한다",
    "반려하면 사유를 남겨 아키텍트에게 돌려보낸다"
   ],
   "checks": [
    "승인자가 정책 작성자와 다르고 승인 해시가 최신 개정본과 같다"
   ],
   "platform": {
    "actions": [
     "decidePolicy"
    ],
    "screens": [
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
    "FPW.4-A05"
   ]
  },
  {
   "id": "FPW.4-A02",
   "name": "플랫폼 도구 신뢰도 분류",
   "trigger": "설계 착수 또는 사용 플랫폼 컴포넌트 변경",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-PLT-013"
   ],
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
   "steps": [
    "이 Feature가 쓰는 플랫폼 컴포넌트마다 오류 출력 유형과 TI·TD를 정해 TCL을 기록한다",
    "TD1은 출력 유형별 검출 수단을 지정할 수 있을 때만 주장하고, 서명 서비스에는 쓰지 않는다",
    "TCL2 이상 컴포넌트의 신뢰도 확보 방법을 Safety Plan에 넣는다"
   ],
   "checks": [
    "사용 컴포넌트 모두에 TCL과 확보 방법이 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/arch/components"
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
    "FPW.4-A05"
   ]
  },
  {
   "id": "FPW.4-A05",
   "name": "G4 설계 독립 검토·판정",
   "trigger": null,
   "gateDecision": "G4",
   "independentOf": [
    "FPW.4-A01",
    "FPW.4-A03"
   ],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-LCY-001"
   ],
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
   "steps": [
    "설계·정책·인터페이스가 안전요구를 충족하는지 설계 작성자와 다른 검토자가 확인한다",
    "판정을 플랫폼 Control Gate와 Safety/Security Gate에 개인 서명으로 등록한다",
    "아키텍트가 판정에 대한 설계 책임을 확인하고, FAIL이면 수정 항목을 설계로 돌려보낸다"
   ],
   "checks": [
    "검토자가 설계·정책 작성자와 다른 조직이다",
    "Decision Record에 판정·근거 Evidence·판정자 역할·시각이 모두 있다"
   ],
   "platform": {
    "actions": [
     "judgeGate"
    ],
    "screens": [
     "/features/:id/:ver",
     "/admin/approval"
    ],
    "gates": [
     "G4",
     "G7"
    ],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.4-A07"
   ]
  },
  {
   "id": "FPW.4-A07",
   "name": "Flag PR 검토·병합",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-LCY-011"
   ],
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
   "steps": [
    "Feature Version 승인 뒤 FF가 연 Flag PR에서 상수·호출 뼈대와 기본값 OFF를 확인한다",
    "기능 분기를 구현하고 FF Flag 검사가 통과한 뒤 병합한다",
    "PR 생성이 실패했으면 Flag 코드 연결 화면에서 PR 다시 만들기를 요청한다"
   ],
   "checks": [
    "해당 Version의 Flag가 모두 코드 연결 정상 또는 검토 중이다"
   ],
   "platform": {
    "actions": [
     "createFlagPr",
     "demoMergeFlagPr"
    ],
    "screens": [
     "/flag-code",
     "/flag-code/flags/:flagKey"
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
  "width": 1926,
  "height": 588,
  "lanes": [
   {
    "role": "R-ARC",
    "label": "아키텍트",
    "x": 0,
    "y": 0,
    "w": 1926,
    "h": 98
   },
   {
    "role": "R-FO",
    "label": "Feature Owner",
    "x": 0,
    "y": 98,
    "w": 1926,
    "h": 98
   },
   {
    "role": "R-REQ",
    "label": "요구 Owner",
    "x": 0,
    "y": 196,
    "w": 1926,
    "h": 98
   },
   {
    "role": "R-SM",
    "label": "Safety Manager",
    "x": 0,
    "y": 294,
    "w": 1926,
    "h": 98
   },
   {
    "role": "R-QA",
    "label": "품질 조직",
    "x": 0,
    "y": 392,
    "w": 1926,
    "h": 98
   },
   {
    "role": "R-INT",
    "label": "통합 조직",
    "x": 0,
    "y": 490,
    "w": 1926,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.4-A01",
    "kind": "action",
    "label": "차량 내 감시·안전기제 설계",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A03",
    "kind": "action",
    "label": "Flag 정책 작성·검증",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A06",
    "kind": "action",
    "label": "정책 근거 변경요청(CR) 연결",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A04",
    "kind": "action",
    "label": "정책 승인",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A02",
    "kind": "action",
    "label": "플랫폼 도구 신뢰도 분류",
    "x": 1038,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A05",
    "kind": "action",
    "label": "G4 설계 독립 검토·판정",
    "x": 1318,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A07",
    "kind": "action",
    "label": "Flag PR 검토·병합",
    "x": 1598,
    "y": 506,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.4-S2",
    "kind": "start",
    "label": "설계 착수 또는 사용 플랫폼 컴포넌트 변경",
    "x": 986,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.4-E1",
    "kind": "end",
    "label": "종료",
    "x": 1800,
    "y": 530,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.4-S1",
    "to": "FPW.4-A01",
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
    "from": "FPW.4-S2",
    "to": "FPW.4-A02",
    "kind": "trigger",
    "points": [
     [
      1004,
      343
     ],
     [
      1038,
      343
     ]
    ]
   },
   {
    "from": "FPW.4-A01",
    "to": "FPW.4-A03",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      478,
      49
     ]
    ]
   },
   {
    "from": "FPW.4-A03",
    "to": "FPW.4-A06",
    "kind": "flow",
    "points": [
     [
      666,
      49
     ],
     [
      746,
      49
     ],
     [
      746,
      147
     ],
     [
      758,
      147
     ]
    ]
   },
   {
    "from": "FPW.4-A06",
    "to": "FPW.4-A04",
    "kind": "flow",
    "points": [
     [
      946,
      147
     ],
     [
      1026,
      147
     ],
     [
      1026,
      245
     ],
     [
      1038,
      245
     ]
    ]
   },
   {
    "from": "FPW.4-A04",
    "to": "FPW.4-A05",
    "kind": "flow",
    "points": [
     [
      1226,
      245
     ],
     [
      1306,
      245
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
    "from": "FPW.4-A02",
    "to": "FPW.4-A05",
    "kind": "flow",
    "points": [
     [
      1226,
      343
     ],
     [
      1306,
      343
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
    "from": "FPW.4-A05",
    "to": "FPW.4-A07",
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
      539
     ],
     [
      1598,
      539
     ]
    ]
   },
   {
    "from": "FPW.4-A07",
    "to": "FPW.4-E1",
    "kind": "end",
    "points": [
     [
      1786,
      539
     ],
     [
      1800,
      539
     ]
    ]
   }
  ],
  "joins": [
   [
    1306,
    343
   ]
  ]
 },
 "departmentLayout": {
  "width": 1926,
  "height": 490,
  "lanes": [
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 0,
    "w": 1926,
    "h": 98
   },
   {
    "department": "DEP-PDP",
    "label": "상품기획팀",
    "x": 0,
    "y": 98,
    "w": 1926,
    "h": 98
   },
   {
    "department": "DEP-FS",
    "label": "기능안전팀",
    "x": 0,
    "y": 196,
    "w": 1926,
    "h": 98
   },
   {
    "department": "DEP-QA",
    "label": "품질팀",
    "x": 0,
    "y": 294,
    "w": 1926,
    "h": 98
   },
   {
    "department": "DEP-INT",
    "label": "SW통합·릴리스팀",
    "x": 0,
    "y": 392,
    "w": 1926,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.4-A01",
    "kind": "action",
    "label": "차량 내 감시·안전기제 설계",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A03",
    "kind": "action",
    "label": "Flag 정책 작성·검증",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A04",
    "kind": "action",
    "label": "정책 승인",
    "x": 1038,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A06",
    "kind": "action",
    "label": "정책 근거 변경요청(CR) 연결",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A02",
    "kind": "action",
    "label": "플랫폼 도구 신뢰도 분류",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A05",
    "kind": "action",
    "label": "G4 설계 독립 검토·판정",
    "x": 1318,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-A07",
    "kind": "action",
    "label": "Flag PR 검토·병합",
    "x": 1598,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.4-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.4-S2",
    "kind": "start",
    "label": "설계 착수 또는 사용 플랫폼 컴포넌트 변경",
    "x": 986,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.4-E1",
    "kind": "end",
    "label": "종료",
    "x": 1800,
    "y": 432,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.4-S1",
    "to": "FPW.4-A01",
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
    "from": "FPW.4-S2",
    "to": "FPW.4-A02",
    "kind": "trigger",
    "points": [
     [
      1004,
      245
     ],
     [
      1038,
      245
     ]
    ]
   },
   {
    "from": "FPW.4-A01",
    "to": "FPW.4-A03",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      478,
      49
     ]
    ]
   },
   {
    "from": "FPW.4-A03",
    "to": "FPW.4-A06",
    "kind": "flow",
    "points": [
     [
      666,
      49
     ],
     [
      746,
      49
     ],
     [
      746,
      147
     ],
     [
      758,
      147
     ]
    ]
   },
   {
    "from": "FPW.4-A06",
    "to": "FPW.4-A04",
    "kind": "flow",
    "points": [
     [
      946,
      147
     ],
     [
      1026,
      147
     ],
     [
      1026,
      49
     ],
     [
      1038,
      49
     ]
    ]
   },
   {
    "from": "FPW.4-A04",
    "to": "FPW.4-A05",
    "kind": "flow",
    "points": [
     [
      1226,
      49
     ],
     [
      1306,
      49
     ],
     [
      1306,
      343
     ],
     [
      1318,
      343
     ]
    ]
   },
   {
    "from": "FPW.4-A02",
    "to": "FPW.4-A05",
    "kind": "flow",
    "points": [
     [
      1226,
      245
     ],
     [
      1306,
      245
     ],
     [
      1306,
      343
     ],
     [
      1318,
      343
     ]
    ]
   },
   {
    "from": "FPW.4-A05",
    "to": "FPW.4-A07",
    "kind": "flow",
    "points": [
     [
      1506,
      343
     ],
     [
      1586,
      343
     ],
     [
      1586,
      441
     ],
     [
      1598,
      441
     ]
    ]
   },
   {
    "from": "FPW.4-A07",
    "to": "FPW.4-E1",
    "kind": "end",
    "points": [
     [
      1786,
      441
     ],
     [
      1800,
      441
     ]
    ]
   }
  ],
  "joins": [
   [
    1306,
    245
   ]
  ]
 }
};

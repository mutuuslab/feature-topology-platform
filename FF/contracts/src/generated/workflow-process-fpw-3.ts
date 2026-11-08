// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.3",
 "name": "안전요구 확정",
 "en": "Safety Requirements Baseline",
 "group": "생애주기",
 "gates": [
  "G3"
 ],
 "ref": "표준 보고서 6.1절 G3, 6장 FFG-LCY-004·005, 16장(ASPICE SYS.2·SWE.1)",
 "purpose": "HARA 결과로부터 검증 가능한 안전요구를 확정하고, Safety Goal부터 출시 Baseline까지 끊김 없이 추적되게 한 뒤, Feature 정의(G1~G3)를 승인해 개발 단계로 넘긴다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "비활성화 동작을 포함한 안전요구가 Safety Goal에서 도출된다."
  },
  {
   "id": "O2",
   "text": "F2 이상 Feature의 안전요구가 양방향으로 빠짐없이 추적된다."
  },
  {
   "id": "O3",
   "text": "요구 검토가 판정되고 Feature 정의가 승인되어 APPROVED로 전이된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.3.BP1",
   "name": "안전요구 도출·명세",
   "definition": "안전 목표와 영향 분석을 검증 가능한 기능·기술·SW 안전요구로 구체화한다. 종료 동작과 시간·운전자 정보 등 필요한 조건을 명시하고 요구 ID와 검증 기준을 관리한다.",
   "notes": [],
   "activityIds": [
    "FPW.3-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-SAFETY-REQ",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.3.BP2",
   "name": "양방향 추적성 점검",
   "definition": "안전 목표부터 요구·설계·시험·Baseline까지 추적 연결과 내용의 일관성을 양방향으로 확인한다. 공백의 조치 담당과 기한을 정하고 해결되지 않은 안전 관련 공백을 판정에 반영한다.",
   "notes": [
    "연결선이 존재하는 것만으로 요구와 결과의 내용이 일치한다고 판정하지 않는다."
   ],
   "activityIds": [
    "FPW.3-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-TRACE-REPORT",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.3.BP3",
   "name": "요구 검토 판정 등록",
   "definition": "요구의 완전성·일관성·검증 가능성을 작성과 구분된 관점에서 검토한다. 발견 사항의 보완과 재검토를 추적하고 요구 검토 판정을 근거와 함께 기록한다.",
   "notes": [],
   "activityIds": [
    "FPW.3-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-REQ-REVIEW",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.3.BP4",
   "name": "구현 연결 입력",
   "definition": "요구를 구현할 기능·SW Version·제어기 부품의 조합을 기준정보에서 식별한다. 정확한 짝을 Feature Version과 외부 개발 항목에 연결하고 연결이 빠졌거나 확정 구성이 다른 경우 보완 경로를 정한다.",
   "notes": [],
   "activityIds": [
    "FPW.3-A05"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-IMPL-LINK",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.3.BP5",
   "name": "외부 연계 동기화·충돌 해결",
   "definition": "요구·Epic·변경요청·개발 상태의 동기화 결과를 확인하고 충돌의 원인과 주인을 식별한다. 선택한 해결 근거와 재시도 결과를 기록하며 외부 상태 변경에도 플랫폼 권한과 전이 규칙을 적용한다.",
   "notes": [
    "외부 시스템의 상태 수신은 플랫폼 승인 가드를 생략하는 수단이 아니다."
   ],
   "activityIds": [
    "FPW.3-A06"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-EXT-SYNC",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.3.BP6",
   "name": "G3 판정·Feature 정의 승인",
   "definition": "등록·영향 분석·요구 검토와 기준 연결의 승인 준비 상태를 확인한다. 작성자와 다른 승인자가 현재 근거로 정의 승인 여부를 결정하고 후속 설계·구현 작업을 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.3-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-G3-DECISION",
     "outcomes": [
      "O3"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-LCY-004",
  "FFG-LCY-005",
  "FFG-LCY-012"
 ],
 "entry": [
  "G2 판정이 PASS이고 HARA·TARA·SOTIF 결과가 현재 Version 기준이다"
 ],
 "exit": [
  "안전요구가 Feature Version에 연결되고 추적 단절이 없다",
  "G3 판정과 정의 승인(PROPOSED→APPROVED)이 남았다"
 ],
 "workProducts": [
  {
   "key": "WP-SAFETY-REQ",
   "name": "안전요구·추적 연결",
   "en": "Safety Requirements & Trace",
   "kind": "output",
   "retained": false,
   "content": [
    "Safety Goal부터 기능·기술·SW 안전요구까지의 도출 관계",
    "비활성화 등급·경고·인계·감소 시간·Safe State·끝 상태·운전자 정보 요구",
    "요구별 검증 기준과 ALM 요구 ID"
   ]
  },
  {
   "key": "WP-TRACE-REPORT",
   "name": "추적성 점검 결과",
   "en": "Traceability Check Report",
   "kind": "output",
   "retained": false,
   "content": [
    "요구↔설계↔시험↔Baseline 양방향 연결 현황",
    "끊긴 연결과 조치 담당"
   ]
  },
  {
   "key": "WP-REQ-REVIEW",
   "name": "요구 검토 판정 기록",
   "en": "Requirement Review Record",
   "kind": "output",
   "retained": false,
   "content": [
    "요구 특성(검증 가능성·일관성·완전성) 검토 결과",
    "Requirement Gate 판정과 판정자 서명"
   ]
  },
  {
   "key": "WP-G3-DECISION",
   "name": "G3 Decision Record·정의 승인",
   "en": "G3 Decision Record & Definition Approval",
   "kind": "output",
   "retained": false,
   "content": [
    "G3 판정과 근거 Evidence ID",
    "PROPOSED→APPROVED 전이 기록과 승인자(작성자와 다른 사람)"
   ]
  },
  {
   "key": "WP-IMPL-LINK",
   "name": "구현 연결(Function·SW·제어기)",
   "en": "Implementation Link",
   "kind": "output",
   "retained": false,
   "content": [
    "Function → SW ID·Version → 제어기(ECU) P/N 짝 — SW·ECU 기준정보에서 고른 값",
    "VERIFIED 전이의 필수 입력(functions·swIds·swVersions·ecuPnos)"
   ]
  },
  {
   "key": "WP-EXT-SYNC",
   "name": "외부 연계 동기화·충돌 처리 기록",
   "en": "ALM Sync & Conflict Record",
   "kind": "output",
   "retained": true,
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
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-LCY-005",
    "FFG-LCY-012"
   ],
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
   "steps": [
    "Safety Goal별로 기능·기술 안전요구를 도출하고 SW에 할당된 요구를 SW 안전요구로 나눈다",
    "F2 이상 Feature는 비활성화 등급·경고·인계·감소 시간·Safe State·끝 상태·운전자 정보를 요구로 쓴다",
    "안전 관련 Flag·파라미터·임계값 변경은 소스 변경이 없어도 변경요청과 영향 분석을 붙인다",
    "요구마다 검증 기준을 적고 ALM 요구 ID로 등록한다"
   ],
   "checks": [
    "모든 Safety Goal에 하나 이상의 안전요구가 있고 요구마다 검증 기준이 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/trace/design",
     "/change/cr"
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
    "FPW.3-A02"
   ]
  },
  {
   "id": "FPW.3-A02",
   "name": "양방향 추적성 점검",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-LCY-004"
   ],
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
   "steps": [
    "요구·안전 추적 화면에서 Safety Goal→요구→설계→시험→Baseline 연결을 양방향으로 확인한다",
    "끊긴 연결마다 조치 담당과 기한을 지정한다",
    "F2 이상 Feature에 연결되지 않은 요구가 남아 있으면 판정 요청을 보류한다"
   ],
   "checks": [
    "F2 이상 Feature의 끊긴 연결이 0건이다"
   ],
   "platform": {
    "actions": [],
    "screens": [
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
    "FPW.3-A03",
    "FPW.3-A05"
   ]
  },
  {
   "id": "FPW.3-A03",
   "name": "요구 검토 판정 등록",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [
    "FPW.3-A01"
   ],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-LCY-001"
   ],
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
   "steps": [
    "요구 특성(검증 가능성·일관성·완전성)을 체크리스트로 검토한다",
    "결과를 플랫폼 Requirement Gate에 판정으로 등록한다",
    "결함이 있으면 요구 Owner에게 돌려보내고 재검토 일정을 잡는다"
   ],
   "checks": [
    "검토자가 요구 작성자와 다른 조직이다"
   ],
   "platform": {
    "actions": [
     "judgeGate"
    ],
    "screens": [
     "/features/:id/:ver"
    ],
    "gates": [
     "G2"
    ],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": null,
   "next": [
    "FPW.3-A04"
   ]
  },
  {
   "id": "FPW.3-A05",
   "name": "구현 연결 입력",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "정의 승인 전에 Feature 설계 담당 또는 SW 통합 담당이 PROPOSED 초안에서 Function → SW·Version → 제어기 P/N을 SW·ECU 기준정보에서 골라 연결한다",
    "Feature 상세 → 초안 수정 → 구현 연결에서 입력한다. 서버는 기준정보에 없는 짝을 거부한다",
    "승인된 Version에 구현 연결이 빠져 있으면 새 Version에서 넣고 정의 승인을 다시 받는다",
    "외부 연계 현황에서 codeBeamer 요구·JIRA Epic·GitLab MR이 이 Version에 연결되고 상태가 맞는지 확인한다"
   ],
   "checks": [
    "VERIFIED 필수 입력(functions·swIds·swVersions·ecuPnos)이 모두 기준정보에 있는 짝이다"
   ],
   "platform": {
    "actions": [
     "updateDraft"
    ],
    "screens": [
     "/features/:id/:ver",
     "/master/artifacts",
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
    "FPW.3-A06"
   ]
  },
  {
   "id": "FPW.3-A06",
   "name": "외부 연계 동기화·충돌 해결",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "외부 연계 현황의 연계 동기화 탭에서 이 Version의 codeBeamer 요구·JIRA Epic 연결과 받은 함·보낼 함·열린 충돌을 확인한다",
    "codeBeamer 요구가 개정되어 G2 재검토 표시가 붙었으면 요구 담당과 안전 담당에게 재검토를 요청한다",
    "JIRA에서 들어온 Epic·변경요청 상태 변경이 거부되었으면 받은 함의 사유(권한·전이 규칙·계정 매핑)를 외부 담당에게 알린다",
    "실패한 보낼 함 작업은 연결 설정·워크플로 전이·권한 원인을 고치고 다음 재시도에서 보내졌는지 확인한다",
    "충돌은 플랫폼 값 다시 보내기와 외부 값 다시 시도 중 하나를 사유와 함께 고른다. 외부 값은 플랫폼 가드를 다시 거친다",
    "정의 승인 뒤에도 외부 요구 개정·상태 변경·충돌이 생기면 같은 확인을 다시 한다"
   ],
   "checks": [
    "열린 충돌이 0건이고 실패한 보낼 함 작업마다 조치 담당이 있다",
    "Feature Version의 codeBeamer 요구·JIRA Epic 상태가 플랫폼 Lifecycle과 맞다"
   ],
   "platform": {
    "actions": [
     "resolveExtConflict"
    ],
    "screens": [
     "/integration/connectors",
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
    "FPW.3-A04"
   ]
  },
  {
   "id": "FPW.3-A04",
   "name": "G3 판정·Feature 정의 승인",
   "trigger": null,
   "gateDecision": "G3",
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-LCY-001",
    "FFG-LCY-002"
   ],
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
   "steps": [
    "G1·G2·Requirement Gate 판정이 모두 PASS(또는 기한 있는 조건부)인지 확인하고 하나라도 없으면 승인하지 않는다",
    "판정 근거를 정리해 G3 판정을 남긴다",
    "Lifecycle을 PROPOSED에서 APPROVED로 전이한다. 작성자는 이 전이를 할 수 없다",
    "승인 서랍이 구현 연결 미입력을 경고한다(막지는 않는다) — 빠졌으면 승인 대신 보완을 요청할 수 있다",
    "아키텍트와 기준정보 담당에게 설계·Control Point 작업 시작을 알린다"
   ],
   "checks": [
    "Feature Version이 APPROVED이고 승인자가 Feature 작성자와 다르다",
    "연결된 기준 행에 요청 중(PENDING)·폐기 행이 없다. 요청 중 행은 Feature DB 관리자 승인 뒤에만 전이한다"
   ],
   "platform": {
    "actions": [
     "transition"
    ],
    "screens": [
     "/features/:id/:ver",
     "/admin/approval"
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
  "width": 1646,
  "height": 294,
  "lanes": [
   {
    "role": "R-REQ",
    "label": "요구 Owner",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-QA",
    "label": "품질 조직",
    "x": 0,
    "y": 98,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-INT",
    "label": "통합 조직",
    "x": 0,
    "y": 196,
    "w": 1646,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.3-A01",
    "kind": "action",
    "label": "안전요구 도출·명세",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A02",
    "kind": "action",
    "label": "양방향 추적성 점검",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A04",
    "kind": "action",
    "label": "G3 판정·Feature 정의 승인",
    "x": 1318,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A03",
    "kind": "action",
    "label": "요구 검토 판정 등록",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A05",
    "kind": "action",
    "label": "구현 연결 입력",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A06",
    "kind": "action",
    "label": "외부 연계 동기화·충돌 해결",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.3-E1",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.3-S1",
    "to": "FPW.3-A01",
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
    "from": "FPW.3-A01",
    "to": "FPW.3-A02",
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
    "from": "FPW.3-A02",
    "to": "FPW.3-A03",
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
    "from": "FPW.3-A02",
    "to": "FPW.3-A05",
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
      245
     ],
     [
      758,
      245
     ]
    ]
   },
   {
    "from": "FPW.3-A03",
    "to": "FPW.3-A04",
    "kind": "flow",
    "points": [
     [
      946,
      147
     ],
     [
      1306,
      147
     ],
     [
      1306,
      49
     ],
     [
      1318,
      49
     ]
    ]
   },
   {
    "from": "FPW.3-A05",
    "to": "FPW.3-A06",
    "kind": "flow",
    "points": [
     [
      946,
      245
     ],
     [
      1038,
      245
     ]
    ]
   },
   {
    "from": "FPW.3-A06",
    "to": "FPW.3-A04",
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
      49
     ],
     [
      1318,
      49
     ]
    ]
   },
   {
    "from": "FPW.3-A04",
    "to": "FPW.3-E1",
    "kind": "end",
    "points": [
     [
      1506,
      49
     ],
     [
      1520,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    1306,
    147
   ]
  ]
 },
 "departmentLayout": {
  "width": 1646,
  "height": 294,
  "lanes": [
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 98
   },
   {
    "department": "DEP-QA",
    "label": "품질팀",
    "x": 0,
    "y": 98,
    "w": 1646,
    "h": 98
   },
   {
    "department": "DEP-INT",
    "label": "SW통합·릴리스팀",
    "x": 0,
    "y": 196,
    "w": 1646,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.3-A01",
    "kind": "action",
    "label": "안전요구 도출·명세",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A02",
    "kind": "action",
    "label": "양방향 추적성 점검",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A04",
    "kind": "action",
    "label": "G3 판정·Feature 정의 승인",
    "x": 1318,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A03",
    "kind": "action",
    "label": "요구 검토 판정 등록",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A05",
    "kind": "action",
    "label": "구현 연결 입력",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-A06",
    "kind": "action",
    "label": "외부 연계 동기화·충돌 해결",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.3-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.3-E1",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.3-S1",
    "to": "FPW.3-A01",
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
    "from": "FPW.3-A01",
    "to": "FPW.3-A02",
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
    "from": "FPW.3-A02",
    "to": "FPW.3-A03",
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
    "from": "FPW.3-A02",
    "to": "FPW.3-A05",
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
      245
     ],
     [
      758,
      245
     ]
    ]
   },
   {
    "from": "FPW.3-A03",
    "to": "FPW.3-A04",
    "kind": "flow",
    "points": [
     [
      946,
      147
     ],
     [
      1306,
      147
     ],
     [
      1306,
      49
     ],
     [
      1318,
      49
     ]
    ]
   },
   {
    "from": "FPW.3-A05",
    "to": "FPW.3-A06",
    "kind": "flow",
    "points": [
     [
      946,
      245
     ],
     [
      1038,
      245
     ]
    ]
   },
   {
    "from": "FPW.3-A06",
    "to": "FPW.3-A04",
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
      49
     ],
     [
      1318,
      49
     ]
    ]
   },
   {
    "from": "FPW.3-A04",
    "to": "FPW.3-E1",
    "kind": "end",
    "points": [
     [
      1506,
      49
     ],
     [
      1520,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    1306,
    147
   ]
  ]
 }
};

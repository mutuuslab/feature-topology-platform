// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.17",
 "name": "기준정보·공유 자산·연계 품질",
 "en": "Master Data Shared Assets and Integration Quality",
 "group": "지원",
 "gates": [],
 "ref": "업무 레퍼런스 모델 요구(WF-REFERENCE-REQUIREMENTS)·현행 플랫폼 계약/화면; 조직 검토 전 초안",
 "purpose": "차량·시장 기준 값과 SW 구조·공유 자산의 출처 및 영향 관계를 관리하고 사전 점검과 외부 연계 대사를 통해 일관된 식별자와 버전으로 후속 업무에 인계한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "차종·시장·사양 기준 값의 유효 범위와 사용 중지 영향이 식별된다."
  },
  {
   "id": "O2",
   "text": "ECU·SW·Function·Feature·공유 자산 및 EO 변경의 추적 관계가 검토된다."
  },
  {
   "id": "O3",
   "text": "사전 점검 오류와 외부 연계 충돌이 원소유자 규칙에 따라 처리되고 대사 근거가 보존된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.17.BP1",
   "name": "차량·시장 기준 관리",
   "definition": "판매국·지역·차종·트림의 식별자와 상위 관계를 관리하고 신규 사용 가능 여부를 통제한다. 사용 중지와 기존 기록 삭제를 분리하여 과거 추적을 보존한다.",
   "notes": [],
   "activityIds": [
    "FPW.17-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-MASTER-VALUES",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.17.BP2",
   "name": "구조·공유 자산 검토",
   "definition": "SW 구조·사양·제어점과 공유 자산의 생산자 및 소비 Feature를 대조하여 변경 영향을 식별한다. 플랫폼 조회와 외부 PLM·ALM 원천 수정의 책임을 구분한다.",
   "notes": [],
   "activityIds": [
    "FPW.17-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-ASSET-TRACE",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.17.BP3",
   "name": "사전 품질 점검",
   "definition": "데이터 사전 점검과 추적 커버리지에서 후속 업무를 막는 오류를 식별하고 원소유자에게 인계한다. 링크 존재 여부와 의미 일관성을 구분하여 점검 결과를 기록한다.",
   "notes": [],
   "activityIds": [
    "FPW.17-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-DATA-QUALITY",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.17.BP4",
   "name": "외부 연계 대사",
   "definition": "ALM·JIRA·GitLab 등 연계의 대기·실패·충돌을 원소유자 규칙으로 조정하고 양측 결과를 대사한다. 외부 반영 요청과 실제 반영 완료를 별도 증거로 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.17-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-INTEGRATION-RECON",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.17.BP5",
   "name": "생산·Legacy 대사",
   "definition": "공장·Legacy 시스템의 주문·사양·코딩과 SDV 기준을 대사하고 원천 식별자와 변환 결과를 보존한다. 단순 변환 계획이나 전송 성공을 차량 적용 완료로 보고하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.17-A05"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-INTEGRATION-RECON",
     "outcomes": [
      "O3"
     ]
    }
   ]
  }
 ],
 "rules": [],
 "entry": [
  "외부 원천 시스템과 데이터 소유자 및 식별자 체계가 식별되어 있다"
 ],
 "exit": [
  "적용 기준과 미해결 품질 항목이 후속 등록·설계·출고 업무에 인계된다"
 ],
 "workProducts": [
  {
   "key": "WP-MASTER-VALUES",
   "name": "기준 값 관리 기록",
   "en": "Reference Value Maintenance",
   "kind": "output",
   "retained": false,
   "content": [
    "판매국·지역·차종·트림 코드와 상위 관계",
    "등록/사용 중지 사유·영향 기록과 새 선택지 제외"
   ]
  },
  {
   "key": "WP-ASSET-TRACE",
   "name": "구조·공유 자산 추적",
   "en": "Structure and Shared Asset Trace",
   "kind": "output",
   "retained": false,
   "content": [
    "ECU·SW·Function·Feature·제어점·UPG 연결",
    "공유 자산 영향 범위·EO 변경 근거·누락 관계"
   ]
  },
  {
   "key": "WP-DATA-QUALITY",
   "name": "데이터 사전 점검",
   "en": "Data Precheck Result",
   "kind": "output",
   "retained": false,
   "content": [
    "점검 범위·오류·경고와 원천 소유자",
    "수정 또는 예외 사유·재점검 결과"
   ]
  },
  {
   "key": "WP-INTEGRATION-RECON",
   "name": "연계·대사 처리 기록",
   "en": "Integration Reconciliation",
   "kind": "output",
   "retained": true,
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
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [],
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
   "steps": [
    "원천 코드와 상위 판매국·차종 및 중복 여부를 확인한다",
    "근거에 따라 기준 값을 등록하거나 사용 중지한다",
    "사용 중지의 기존 기록 보존과 신규 선택지 제외를 확인한다"
   ],
   "checks": [
    "하위 기준 값이 올바른 상위 코드에 연결된다",
    "기존 차량·Feature 이력을 소급 삭제하지 않는다"
   ],
   "platform": {
    "actions": [
     "createReferenceValue",
     "retireReferenceValue"
    ],
    "screens": [
     "/master/reference-values"
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
    "FPW.17-A02"
   ]
  },
  {
   "id": "FPW.17-A02",
   "name": "구조·공유 자산 검토",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "ECU·SW·Function·Feature와 UPG 및 제어점 연결을 조회한다",
    "공유 자산을 사용하는 Feature와 EO 변경의 영향 범위를 대조한다",
    "누락·불일치와 설계 또는 원천 시스템의 변경 요청을 기록한다"
   ],
   "checks": [
    "공유 자산 한 곳의 변경이 영향을 주는 Feature를 식별한다",
    "조회 결과를 원천 구조의 변경 완료로 간주하지 않는다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/master/taxonomy",
     "/master/upg",
     "/master/structure",
     "/features/shared-assets",
     "/change/eo"
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
    "FPW.17-A03"
   ]
  },
  {
   "id": "FPW.17-A03",
   "name": "사전 품질 점검",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "등록·설계·출고에 사용할 데이터 범위를 식별한다",
    "사전 점검과 추적 커버리지에서 오류·누락·경고를 확인한다",
    "원천 담당자에게 수정을 요청하고 재점검 결과 또는 승인된 보류 근거를 남긴다"
   ],
   "checks": [
    "점검 범위와 미해결 오류의 담당자가 있다",
    "커버리지 비율만으로 설계 일관성이나 안전 승인을 대신하지 않는다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/precheck",
     "/trace/coverage"
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
   "id": "FPW.17-A04",
   "name": "외부 연계 대사",
   "trigger": "연계 실패·충돌 또는 정기 대사",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "원천 소유자 규칙과 외부 요구·변경·배포 식별자 연결을 확인한다",
    "보낸 함·받은 함·충돌과 거부 원인을 대조한다",
    "허용된 재전송 또는 충돌 처리를 실행하고 실제 반영 결과를 확인한다"
   ],
   "checks": [
    "외부 상태를 플랫폼 Guard를 우회하여 덮어쓰지 않는다",
    "재전송 요청과 외부 반영 완료를 구분한다"
   ],
   "platform": {
    "actions": [
     "resolveExtConflict",
     "drainExtSync"
    ],
    "screens": [
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
   "next": []
  },
  {
   "id": "FPW.17-A05",
   "name": "생산·Legacy 대사",
   "trigger": "공장 인수·Legacy 연계",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "대상 공장·차량과 옵션 코드 및 변환 규칙을 확인한다",
    "허용된 동기화·주문 가져오기 또는 코딩 변환을 수행한다",
    "출고 구성·수신 상태와 실패 사유를 대조해 현장 담당자에게 인계한다"
   ],
   "checks": [
    "Legacy 경로가 F2 이상 제한을 우회하지 않는다",
    "변환 계획과 실차 적용 결과를 구분한다"
   ],
   "platform": {
    "actions": [
     "runSync",
     "importPlantOrders",
     "translateLegacy"
    ],
    "screens": [
     "/integration/sync",
     "/integration/legacy",
     "/field",
     "/baselines/eol"
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
  "width": 1086,
  "height": 392,
  "lanes": [
   {
    "role": "R-PLM",
    "label": "기준정보 담당",
    "x": 0,
    "y": 0,
    "w": 1086,
    "h": 98
   },
   {
    "role": "R-ARC",
    "label": "아키텍트",
    "x": 0,
    "y": 98,
    "w": 1086,
    "h": 98
   },
   {
    "role": "R-INT",
    "label": "통합 조직",
    "x": 0,
    "y": 196,
    "w": 1086,
    "h": 98
   },
   {
    "role": "R-OPS",
    "label": "운영 조직",
    "x": 0,
    "y": 294,
    "w": 1086,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.17-A01",
    "kind": "action",
    "label": "차량·시장 기준 관리",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A02",
    "kind": "action",
    "label": "구조·공유 자산 검토",
    "x": 478,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A03",
    "kind": "action",
    "label": "사전 품질 점검",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A04",
    "kind": "action",
    "label": "외부 연계 대사",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A05",
    "kind": "action",
    "label": "생산·Legacy 대사",
    "x": 198,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-S2",
    "kind": "start",
    "label": "연계 실패·충돌 또는 정기 대사",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-S3",
    "kind": "start",
    "label": "공장 인수·Legacy 연계",
    "x": 146,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E1",
    "kind": "end",
    "label": "종료",
    "x": 960,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 334,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.17-S1",
    "to": "FPW.17-A01",
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
    "from": "FPW.17-S2",
    "to": "FPW.17-A04",
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
    "from": "FPW.17-S3",
    "to": "FPW.17-A05",
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
    "from": "FPW.17-A01",
    "to": "FPW.17-A02",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      466,
      49
     ],
     [
      466,
      147
     ],
     [
      478,
      147
     ]
    ]
   },
   {
    "from": "FPW.17-A02",
    "to": "FPW.17-A03",
    "kind": "flow",
    "points": [
     [
      666,
      147
     ],
     [
      746,
      147
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
    "from": "FPW.17-A03",
    "to": "FPW.17-E1",
    "kind": "end",
    "points": [
     [
      946,
      245
     ],
     [
      960,
      245
     ]
    ]
   },
   {
    "from": "FPW.17-A04",
    "to": "FPW.17-E2",
    "kind": "end",
    "points": [
     [
      386,
      245
     ],
     [
      400,
      245
     ]
    ]
   },
   {
    "from": "FPW.17-A05",
    "to": "FPW.17-E3",
    "kind": "end",
    "points": [
     [
      386,
      343
     ],
     [
      400,
      343
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 1086,
  "height": 392,
  "lanes": [
   {
    "department": "DEP-PLM",
    "label": "PLM·기준정보팀",
    "x": 0,
    "y": 0,
    "w": 1086,
    "h": 98
   },
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 98,
    "w": 1086,
    "h": 98
   },
   {
    "department": "DEP-INT",
    "label": "SW통합·릴리스팀",
    "x": 0,
    "y": 196,
    "w": 1086,
    "h": 98
   },
   {
    "department": "DEP-OPS",
    "label": "OTA·서비스운영팀",
    "x": 0,
    "y": 294,
    "w": 1086,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.17-A01",
    "kind": "action",
    "label": "차량·시장 기준 관리",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A02",
    "kind": "action",
    "label": "구조·공유 자산 검토",
    "x": 478,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A03",
    "kind": "action",
    "label": "사전 품질 점검",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A04",
    "kind": "action",
    "label": "외부 연계 대사",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-A05",
    "kind": "action",
    "label": "생산·Legacy 대사",
    "x": 198,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.17-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-S2",
    "kind": "start",
    "label": "연계 실패·충돌 또는 정기 대사",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-S3",
    "kind": "start",
    "label": "공장 인수·Legacy 연계",
    "x": 146,
    "y": 334,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E1",
    "kind": "end",
    "label": "종료",
    "x": 960,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.17-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 334,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.17-S1",
    "to": "FPW.17-A01",
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
    "from": "FPW.17-S2",
    "to": "FPW.17-A04",
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
    "from": "FPW.17-S3",
    "to": "FPW.17-A05",
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
    "from": "FPW.17-A01",
    "to": "FPW.17-A02",
    "kind": "flow",
    "points": [
     [
      386,
      49
     ],
     [
      466,
      49
     ],
     [
      466,
      147
     ],
     [
      478,
      147
     ]
    ]
   },
   {
    "from": "FPW.17-A02",
    "to": "FPW.17-A03",
    "kind": "flow",
    "points": [
     [
      666,
      147
     ],
     [
      746,
      147
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
    "from": "FPW.17-A03",
    "to": "FPW.17-E1",
    "kind": "end",
    "points": [
     [
      946,
      245
     ],
     [
      960,
      245
     ]
    ]
   },
   {
    "from": "FPW.17-A04",
    "to": "FPW.17-E2",
    "kind": "end",
    "points": [
     [
      386,
      245
     ],
     [
      400,
      245
     ]
    ]
   },
   {
    "from": "FPW.17-A05",
    "to": "FPW.17-E3",
    "kind": "end",
    "points": [
     [
      386,
      343
     ],
     [
      400,
      343
     ]
    ]
   }
  ],
  "joins": []
 }
};

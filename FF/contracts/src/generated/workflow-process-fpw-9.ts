// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.9",
 "name": "사후 검토·Flag Retirement",
 "en": "Post-Operation Review & Flag Retirement",
 "group": "생애주기",
 "gates": [],
 "ref": "표준 보고서 6.5절(Retirement), 5장 FFG-CLS-008, 6장 FFG-LCY-011, 14장 FFG-SOT-003, 3장 FFG-ADS-010",
 "purpose": "운영 중 드러난 이상·복원 결과를 품질 피드백으로 되돌려 시나리오와 다음 Version에 반영하고, 만료되었거나 대체된 Flag를 승인된 Retirement 절차로 처리해 코드·설정·시험을 정리한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "운영 결과와 새 트리거 조건이 품질 피드백으로 수용되어 시나리오와 다음 Version에 반영된다."
  },
  {
   "id": "O2",
   "text": "Flag Retirement가 요청자와 다른 승인자의 승인을 받는다."
  },
  {
   "id": "O3",
   "text": "Retirement 대상 Flag의 코드·설정·시험이 기한 안에 삭제되고 Lifecycle이 종료된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.9.BP1",
   "name": "운영 결과 품질 피드백 수용",
   "definition": "드릴·복원 관측·이상 조사 결과에서 반복 문제와 개선 항목을 식별한다. 수용한 피드백을 담당자·후속 Version·시험 시나리오에 연결하여 반영과 효과를 추적한다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-QUALITY-FEEDBACK",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.9.BP2",
   "name": "Flag Retirement 요청",
   "definition": "만료가 다가오거나 종료할 Flag의 연장 또는 Retirement 필요성을 검토한다. 영향 차량·구 Version 잔존과 예정 릴리스를 확인하고 종료 사유와 범위를 명시한 요청을 제출한다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-RETIRE-REQ",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.9.BP3",
   "name": "Flag Retirement 승인",
   "definition": "요청자와 구분된 책임자가 영향·안전 조건과 종료 계획을 검토한다. 필요한 독립 승인을 확보하고 삭제 기한·조건과 후속 책임을 통합·기획에 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A03"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-RETIRE-APPROVAL",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.9.BP4",
   "name": "코드·설정·시험 삭제 기록",
   "definition": "승인된 Retirement 범위의 코드·설정·시험 제거와 차량 잔존을 단계별로 확인한다. 각 단계의 근거를 기록하고 잔존 및 후속 조건이 해소되어야 종료 단계를 닫는다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-RETIRE-LOG",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.9.BP5",
   "name": "Flag 제거 PR 병합",
   "definition": "승인된 Flag 제거 변경을 검토하고 최종 값 분기와 병합 결과를 확인한다. 정적 분석·대사 결과를 보존하여 코드 참조가 제거되었는지 판단한다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A06"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-FLAG-REMOVAL-SCAN",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.9.BP6",
   "name": "Lifecycle 종료 전이",
   "definition": "신규 사용 중지와 최종 종료의 조건을 구분하여 Lifecycle을 전이한다. Retirement 근거·수행 기록·ID 재사용 금지를 보존하고 상품 구성에 종료 사실을 반영하도록 전달한다.",
   "notes": [],
   "activityIds": [
    "FPW.9-A05"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-RETIRE-CLOSE",
     "outcomes": [
      "O3"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-SOT-003",
  "FFG-CLS-008",
  "FFG-LCY-011",
  "FFG-ADS-010"
 ],
 "entry": [
  "분기 드릴·복원 결과 또는 Flag 만료 알림이 있다"
 ],
 "exit": [
  "수용한 품질 피드백이 시나리오 저장소와 개선 과제에 연결되었다",
  "Retirement된 Flag의 삭제 단계가 모두 기록되고 Lifecycle이 RETIRED가 되었다"
 ],
 "workProducts": [
  {
   "key": "WP-QUALITY-FEEDBACK",
   "name": "품질 피드백 기록",
   "en": "Quality Feedback Record",
   "kind": "output",
   "retained": true,
   "content": [
    "이상·복원·드릴에서 나온 개선 항목과 담당",
    "시나리오 저장소에 추가한 트리거 조건과 재평가 대상"
   ]
  },
  {
   "key": "WP-RETIRE-REQ",
   "name": "Flag Retirement 요청",
   "en": "Flag Retirement Request",
   "kind": "output",
   "retained": false,
   "content": [
    "Retirement 사유(만료·대체·폐기)와 다음 정기 릴리스 예정일",
    "영향 받는 차량·Variant와 구 Version 잔존 여부"
   ]
  },
  {
   "key": "WP-RETIRE-APPROVAL",
   "name": "Retirement 승인 기록",
   "en": "Retirement Approval",
   "kind": "output",
   "retained": false,
   "content": [
    "승인자(F2 이상은 Safety Manager 포함)와 시각",
    "삭제 기한(승인 후 6개월 또는 다음 정기 릴리스 중 이른 시점)"
   ]
  },
  {
   "key": "WP-RETIRE-LOG",
   "name": "Retirement 단계 기록",
   "en": "Retirement Step Log",
   "kind": "output",
   "retained": false,
   "content": [
    "코드·설정·시험 삭제 단계별 완료 시각",
    "상태 보고로 확인한 구 Version 잔존 차량 수"
   ]
  },
  {
   "key": "WP-RETIRE-CLOSE",
   "name": "Lifecycle 종료 기록",
   "en": "Lifecycle Closure",
   "kind": "output",
   "retained": true,
   "content": [
    "DEPRECATED·RETIRED 전이 시각",
    "Flag ID 재사용 금지 표시와 Catalog 퇴역 결과"
   ]
  },
  {
   "key": "WP-FLAG-REMOVAL-SCAN",
   "name": "Flag 제거 검토·스캔 결과",
   "en": "Flag 제거 검토·스캔 결과",
   "kind": "output",
   "retained": true,
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
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-SOT-003"
   ],
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
   "steps": [
    "분기 드릴·복원 관측·이상 징후 결과에서 개선 항목을 추린다",
    "텔레메트리와 사고 데이터에서 찾은 트리거 조건·오용을 시험 조직에 넘겨 시나리오 저장소에 추가하게 한다",
    "품질 피드백을 수용하고 다음 Version 개선 과제로 Feature Owner에게 연결한다"
   ],
   "checks": [
    "수용한 피드백마다 담당과 반영 대상(시나리오·Version)이 있다"
   ],
   "platform": {
    "actions": [
     "acceptFeedback"
    ],
    "screens": [
     "/quality/feedback"
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
   "id": "FPW.9-A02",
   "name": "Flag Retirement 요청",
   "trigger": "Flag 만료 30일 전 알림, 기능 대체·폐기 결정",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-CLS-008"
   ],
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
   "steps": [
    "만료 알림을 받은 Release·Experiment Flag의 연장 또는 Retirement를 정한다",
    "Retirement면 사유·영향 차량·다음 정기 릴리스 예정일을 적어 요청한다",
    "구 Version이 남은 차량이 있는지 Fleet 적용 현황으로 확인해 요청에 붙인다"
   ],
   "checks": [
    "Retirement 요청에 사유와 영향 범위가 있다"
   ],
   "platform": {
    "actions": [
     "requestFlagRetirement"
    ],
    "screens": [
     "/flag-retirements"
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
    "FPW.9-A03"
   ]
  },
  {
   "id": "FPW.9-A03",
   "name": "Flag Retirement 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-ADS-010"
   ],
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
   "steps": [
    "요청자가 아닌 요구 Owner가 Retirement를 승인하고, F2 이상이면 Safety Manager도 승인한다",
    "ADS Feature를 폐기하는 경우 영구 비활성화·명령 키 폐기·Catalog 퇴역을 승인 조건으로 단다",
    "승인 후 삭제 기한을 정해 Feature Owner와 통합 조직에 알린다"
   ],
   "checks": [
    "승인자가 요청자와 다르고 F2 이상에 Safety Manager 승인이 있다"
   ],
   "platform": {
    "actions": [
     "approveFlagRetirement"
    ],
    "screens": [
     "/flag-retirements"
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
    "FPW.9-A04"
   ]
  },
  {
   "id": "FPW.9-A04",
   "name": "코드·설정·시험 삭제 기록",
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
   "steps": [
    "삭제 기한 안에 해당 Flag의 차량 SW 코드·설정·시험을 지우도록 통합 조직과 계획을 세운다",
    "단계마다 완료 조건을 확인하고 Retirement 단계로 기록한다",
    "구 Version이 남은 차량은 상태 보고로 잔존이 0이 된 것을 확인한 뒤 마지막 단계를 닫는다"
   ],
   "checks": [
    "Retirement 단계가 순서대로 모두 기록되고 잔존 차량이 0이다"
   ],
   "platform": {
    "actions": [
     "recordFlagRetirementStep"
    ],
    "screens": [
     "/flag-retirements"
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
    "FPW.9-A06"
   ]
  },
  {
   "id": "FPW.9-A06",
   "name": "Flag 제거 PR 병합",
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
   "steps": [
    "Retirement가 승인된 Flag의 제거 PR을 Flag 수명 관리에서 연다",
    "최종 값 분기만 남기고 병합한 뒤 대사가 정상(코드 0)인지 확인한다",
    "4단계 기록에 정적 분석 근거로 마지막 스캔을 남긴다"
   ],
   "checks": [
    "제거 PR 병합 뒤 스캔에서 해당 Flag 참조가 0건이다"
   ],
   "platform": {
    "actions": [
     "createFlagRemovalPr",
     "recordFlagRetirementStep"
    ],
    "screens": [
     "/flag-code/lifecycle",
     "/flag-retirements"
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
    "FPW.9-A05"
   ]
  },
  {
   "id": "FPW.9-A05",
   "name": "Lifecycle 종료 전이",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
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
   "steps": [
    "Feature Version을 DEPRECATED로 전이해 신규 사용을 막는다",
    "Retirement 단계가 모두 끝나면 RETIRED로 전이한다",
    "Flag ID를 재사용 금지로 남기고 상품 Owner에게 Catalog 반영을 알린다"
   ],
   "checks": [
    "Lifecycle이 RETIRED이고 Flag ID 재사용 금지 표시가 있다"
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
   "next": []
  }
 ],
 "layout": {
  "width": 1646,
  "height": 490,
  "lanes": [
   {
    "role": "R-QA",
    "label": "품질 조직",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-FO",
    "label": "Feature Owner",
    "x": 0,
    "y": 98,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-REQ",
    "label": "요구 Owner",
    "x": 0,
    "y": 196,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-INT",
    "label": "통합 조직",
    "x": 0,
    "y": 294,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-REL",
    "label": "Release Manager",
    "x": 0,
    "y": 392,
    "w": 1646,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.9-A01",
    "kind": "action",
    "label": "운영 결과 품질 피드백 수용",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A02",
    "kind": "action",
    "label": "Flag Retirement 요청",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A04",
    "kind": "action",
    "label": "코드·설정·시험 삭제 기록",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A03",
    "kind": "action",
    "label": "Flag Retirement 승인",
    "x": 478,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A06",
    "kind": "action",
    "label": "Flag 제거 PR 병합",
    "x": 1038,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A05",
    "kind": "action",
    "label": "Lifecycle 종료 전이",
    "x": 1318,
    "y": 408,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-S2",
    "kind": "start",
    "label": "Flag 만료 30일 전 알림, 기능 대체·폐기 결정",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-E2",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 432,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.9-S1",
    "to": "FPW.9-A01",
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
    "from": "FPW.9-S2",
    "to": "FPW.9-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      147
     ],
     [
      198,
      147
     ]
    ]
   },
   {
    "from": "FPW.9-A02",
    "to": "FPW.9-A03",
    "kind": "flow",
    "points": [
     [
      386,
      147
     ],
     [
      466,
      147
     ],
     [
      466,
      245
     ],
     [
      478,
      245
     ]
    ]
   },
   {
    "from": "FPW.9-A03",
    "to": "FPW.9-A04",
    "kind": "flow",
    "points": [
     [
      666,
      245
     ],
     [
      746,
      245
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
    "from": "FPW.9-A04",
    "to": "FPW.9-A06",
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
      343
     ],
     [
      1038,
      343
     ]
    ]
   },
   {
    "from": "FPW.9-A06",
    "to": "FPW.9-A05",
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
    "from": "FPW.9-A01",
    "to": "FPW.9-E1",
    "kind": "end",
    "points": [
     [
      386,
      49
     ],
     [
      400,
      49
     ]
    ]
   },
   {
    "from": "FPW.9-A05",
    "to": "FPW.9-E2",
    "kind": "end",
    "points": [
     [
      1506,
      441
     ],
     [
      1520,
      441
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 1646,
  "height": 392,
  "lanes": [
   {
    "department": "DEP-QA",
    "label": "품질팀",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 98
   },
   {
    "department": "DEP-PDP",
    "label": "상품기획팀",
    "x": 0,
    "y": 98,
    "w": 1646,
    "h": 98
   },
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 196,
    "w": 1646,
    "h": 98
   },
   {
    "department": "DEP-INT",
    "label": "SW통합·릴리스팀",
    "x": 0,
    "y": 294,
    "w": 1646,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.9-A01",
    "kind": "action",
    "label": "운영 결과 품질 피드백 수용",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A02",
    "kind": "action",
    "label": "Flag Retirement 요청",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A04",
    "kind": "action",
    "label": "코드·설정·시험 삭제 기록",
    "x": 758,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A03",
    "kind": "action",
    "label": "Flag Retirement 승인",
    "x": 478,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A06",
    "kind": "action",
    "label": "Flag 제거 PR 병합",
    "x": 1038,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-A05",
    "kind": "action",
    "label": "Lifecycle 종료 전이",
    "x": 1318,
    "y": 310,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.9-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-S2",
    "kind": "start",
    "label": "Flag 만료 30일 전 알림, 기능 대체·폐기 결정",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.9-E2",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 334,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.9-S1",
    "to": "FPW.9-A01",
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
    "from": "FPW.9-S2",
    "to": "FPW.9-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      147
     ],
     [
      198,
      147
     ]
    ]
   },
   {
    "from": "FPW.9-A02",
    "to": "FPW.9-A03",
    "kind": "flow",
    "points": [
     [
      386,
      147
     ],
     [
      466,
      147
     ],
     [
      466,
      245
     ],
     [
      478,
      245
     ]
    ]
   },
   {
    "from": "FPW.9-A03",
    "to": "FPW.9-A04",
    "kind": "flow",
    "points": [
     [
      666,
      245
     ],
     [
      746,
      245
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
    "from": "FPW.9-A04",
    "to": "FPW.9-A06",
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
      343
     ],
     [
      1038,
      343
     ]
    ]
   },
   {
    "from": "FPW.9-A06",
    "to": "FPW.9-A05",
    "kind": "flow",
    "points": [
     [
      1226,
      343
     ],
     [
      1318,
      343
     ]
    ]
   },
   {
    "from": "FPW.9-A01",
    "to": "FPW.9-E1",
    "kind": "end",
    "points": [
     [
      386,
      49
     ],
     [
      400,
      49
     ]
    ]
   },
   {
    "from": "FPW.9-A05",
    "to": "FPW.9-E2",
    "kind": "end",
    "points": [
     [
      1506,
      343
     ],
     [
      1520,
      343
     ]
    ]
   }
  ],
  "joins": []
 }
};

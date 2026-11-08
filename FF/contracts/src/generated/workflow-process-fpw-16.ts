// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.16",
 "name": "플랫폼 접근·운영·복구",
 "en": "Platform Access Operations and Recovery",
 "group": "지원",
 "gates": [],
 "ref": "업무 레퍼런스 모델 요구(WF-REFERENCE-REQUIREMENTS)·현행 플랫폼 계약/화면; 조직 검토 전 초안",
 "purpose": "업무 수행자의 접근 상태와 기록 소유권을 통제하고 플랫폼 운영·복구 근거를 보존하여 담당자 변경 또는 서비스 장애 중에도 권한 범위를 넘지 않는 업무 연속성을 유지한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "계정 상태 변경의 근거·책임자와 영향 업무가 식별되고 계정 상태가 확인된다."
  },
  {
   "id": "O2",
   "text": "소유자가 없거나 비활성인 기록만 적격 담당자에게 이관되고 내용·버전·상태는 유지된다."
  },
  {
   "id": "O3",
   "text": "운영 설정·관측·백업 및 복구 점검 근거와 미해결 장애가 인계된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.16.BP1",
   "name": "계정 상태 변경",
   "definition": "근거가 있는 계정의 비활성·재활성을 기록하고 실제 응답 및 감사 이력을 확인한다. 이 활동은 계정 상태 통제이며 임의 역할 부여나 모든 업무 데이터 편집을 허용하지 않는다.",
   "notes": [
    "정적 미리보기의 로컬 모의 처리와 실제 IdP·서버 상태 변경은 별도 검증 대상이다."
   ],
   "activityIds": [
    "FPW.16-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-ACCESS-CHANGE",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.16.BP2",
   "name": "부재 소유자 이관",
   "definition": "소유자가 없거나 비활성인 컴플라이언스 룰의 책임을 적격한 담당 계정에 인계한다. 이관과 내용 변경을 분리하고 원소유자 상태·새 소유자의 담당 역할·사유를 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.16-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-OWNER-HANDOVER",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.16.BP3",
   "name": "운영 설정·상태 점검",
   "definition": "설정·이벤트·관측 자료를 사용하여 플랫폼의 연결과 서비스 상태를 점검하고 장애 대응을 인계한다. 서버 설정 변경은 승인된 운영 환경의 절차로 수행하며 브라우저 조회 권한을 서버 관리자 권한으로 간주하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.16-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-PLATFORM-OPS",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.16.BP4",
   "name": "백업·복구 점검",
   "definition": "서비스·데이터·감사 기록의 복구 가능성을 격리된 실행으로 점검하고 결과와 미해결 위험을 보존한다. 플랫폼 화면은 근거를 참조하는 곳이며 외부 인프라 백업이나 재해 복구를 자동 실행한 것으로 표시하지 않는다.",
   "notes": [
    "백업·복원은 승인된 서버/DB 운영 절차에서 수행한다. 이 업무 모델을 등록해도 백업이 생성되거나 복구 승인이 발생하지 않는다."
   ],
   "activityIds": [
    "FPW.16-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-RECOVERY-DRILL",
     "outcomes": [
      "O3"
     ]
    }
   ]
  }
 ],
 "rules": [],
 "entry": [
  "기존 IAM·외부 IdP의 책임 경계와 운영 담당자가 식별되어 있다"
 ],
 "exit": [
  "접근 변경·이관 사유와 변경 결과가 남는다",
  "운영 점검과 복구 증거를 실제 실행 여부와 구분하여 인계한다"
 ],
 "workProducts": [
  {
   "key": "WP-ACCESS-CHANGE",
   "name": "계정 상태 변경 기록",
   "en": "Account Status Change",
   "kind": "output",
   "retained": false,
   "content": [
    "입퇴사·전보 근거·대상 계정·변경 사유",
    "비활성/재활성 결과·실행자·시각·미확인 상태"
   ]
  },
  {
   "key": "WP-OWNER-HANDOVER",
   "name": "기록 소유자 이관",
   "en": "Record Ownership Handover",
   "kind": "output",
   "retained": true,
   "content": [
    "부재/비활성 원소유자·새 적격 소유자·대상 기록",
    "이관 사유·전후 소유자·내용/버전/상태 보존 확인"
   ]
  },
  {
   "key": "WP-PLATFORM-OPS",
   "name": "플랫폼 운영 점검",
   "en": "Platform Operations Check",
   "kind": "output",
   "retained": false,
   "content": [
    "서버 운영 설정의 변경 승인 근거·연결 상태",
    "관측 지표·장애·담당자와 외부 운영 증거"
   ]
  },
  {
   "key": "WP-RECOVERY-DRILL",
   "name": "백업·복구 점검 기록",
   "en": "Backup and Recovery Check",
   "kind": "output",
   "retained": true,
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
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [],
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
   "steps": [
    "입퇴사·전보 근거와 대상 계정 및 영향 업무를 확인한다",
    "자기 계정을 제외하고 사유를 적어 비활성 또는 재활성 처리를 수행한다",
    "응답 상태와 감사 이력을 확인하고 권한 변경이 필요한 사항은 외부 IdP 담당자에게 인계한다"
   ],
   "checks": [
    "미확인 또는 실패 응답을 변경 완료로 기록하지 않는다",
    "계정 상태 기록이 역할 부여 권한으로 확대되지 않는다"
   ],
   "platform": {
    "actions": [
     "deactivateAccount",
     "reactivateAccount"
    ],
    "screens": [
     "/admin/iam"
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
    "FPW.16-A02"
   ]
  },
  {
   "id": "FPW.16-A02",
   "name": "부재 소유자 이관",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "원소유자가 없거나 비활성인 기록과 미결 업무를 확인한다",
    "기록 담당 역할을 가진 새 계정을 지정하고 이관 사유를 적는다",
    "소유자 이관 뒤 기록 내용·버전·상태와 감사 흔적이 보존됐는지 확인한다"
   ],
   "checks": [
    "활성 소유자의 기록이나 부적격 새 소유자 이관이 차단된다",
    "기록 본문을 고치지 않고 소유권만 변경한다"
   ],
   "platform": {
    "actions": [
     "transferComplianceRuleOwner"
    ],
    "screens": [
     "/admin/iam",
     "/verify/compliance"
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
   "id": "FPW.16-A03",
   "name": "운영 설정·상태 점검",
   "trigger": "정기 점검 또는 장애",
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
   "steps": [
    "현재 운영 모드와 연결 대상 및 설정 변경 근거를 확인한다",
    "설정·상태 화면과 운영 환경의 관측 자료로 연결·오류·보존 상태를 점검한다",
    "비밀 값을 본문에 옮기지 않고 장애와 담당자 및 후속 조치를 기록한다"
   ],
   "checks": [
    "개발 PC 설정을 원격 운영 확인 근거로 쓰지 않는다",
    "관측 실패와 미확인 연결은 정상 완료와 구분한다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/admin/settings",
     "/events",
     "/notifications/rules"
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
   "id": "FPW.16-A04",
   "name": "백업·복구 점검",
   "trigger": "복구 훈련 또는 사고 복구",
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
   "steps": [
    "운영 환경의 백업 범위·보관 정책과 복구 책임자를 확인한다",
    "승인된 격리 환경에서 복구 절차를 실행하고 데이터 및 감사 연속성을 대조한다",
    "실측 시간·검증 결과·미실행 항목을 구분해 기록하고 개선을 인계한다"
   ],
   "checks": [
    "계획서 존재만으로 복구 성공을 판정하지 않는다",
    "실제 실행 환경과 증거 위치가 기록된다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/admin/settings"
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
  "width": 806,
  "height": 286,
  "lanes": [
   {
    "role": "R-SYS",
    "label": "시스템 관리자",
    "x": 0,
    "y": 0,
    "w": 806,
    "h": 98
   },
   {
    "role": "R-OPS",
    "label": "운영 조직",
    "x": 0,
    "y": 98,
    "w": 806,
    "h": 188
   }
  ],
  "nodes": [
   {
    "id": "FPW.16-A01",
    "kind": "action",
    "label": "계정 상태 변경",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A02",
    "kind": "action",
    "label": "부재 소유자 이관",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A03",
    "kind": "action",
    "label": "운영 설정·상태 점검",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A04",
    "kind": "action",
    "label": "백업·복구 점검",
    "x": 198,
    "y": 204,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-S2",
    "kind": "start",
    "label": "정기 점검 또는 장애",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-S3",
    "kind": "start",
    "label": "복구 훈련 또는 사고 복구",
    "x": 146,
    "y": 228,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E1",
    "kind": "end",
    "label": "종료",
    "x": 680,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 228,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.16-S1",
    "to": "FPW.16-A01",
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
    "from": "FPW.16-S2",
    "to": "FPW.16-A03",
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
    "from": "FPW.16-S3",
    "to": "FPW.16-A04",
    "kind": "trigger",
    "points": [
     [
      164,
      237
     ],
     [
      198,
      237
     ]
    ]
   },
   {
    "from": "FPW.16-A01",
    "to": "FPW.16-A02",
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
    "from": "FPW.16-A02",
    "to": "FPW.16-E1",
    "kind": "end",
    "points": [
     [
      666,
      49
     ],
     [
      680,
      49
     ]
    ]
   },
   {
    "from": "FPW.16-A03",
    "to": "FPW.16-E2",
    "kind": "end",
    "points": [
     [
      386,
      147
     ],
     [
      400,
      147
     ]
    ]
   },
   {
    "from": "FPW.16-A04",
    "to": "FPW.16-E3",
    "kind": "end",
    "points": [
     [
      386,
      237
     ],
     [
      400,
      237
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 806,
  "height": 286,
  "lanes": [
   {
    "department": "DEP-ITSEC",
    "label": "IT인프라·보안운영팀",
    "x": 0,
    "y": 0,
    "w": 806,
    "h": 98
   },
   {
    "department": "DEP-OPS",
    "label": "OTA·서비스운영팀",
    "x": 0,
    "y": 98,
    "w": 806,
    "h": 188
   }
  ],
  "nodes": [
   {
    "id": "FPW.16-A01",
    "kind": "action",
    "label": "계정 상태 변경",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A02",
    "kind": "action",
    "label": "부재 소유자 이관",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A03",
    "kind": "action",
    "label": "운영 설정·상태 점검",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-A04",
    "kind": "action",
    "label": "백업·복구 점검",
    "x": 198,
    "y": 204,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.16-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-S2",
    "kind": "start",
    "label": "정기 점검 또는 장애",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-S3",
    "kind": "start",
    "label": "복구 훈련 또는 사고 복구",
    "x": 146,
    "y": 228,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E1",
    "kind": "end",
    "label": "종료",
    "x": 680,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.16-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 228,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.16-S1",
    "to": "FPW.16-A01",
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
    "from": "FPW.16-S2",
    "to": "FPW.16-A03",
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
    "from": "FPW.16-S3",
    "to": "FPW.16-A04",
    "kind": "trigger",
    "points": [
     [
      164,
      237
     ],
     [
      198,
      237
     ]
    ]
   },
   {
    "from": "FPW.16-A01",
    "to": "FPW.16-A02",
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
    "from": "FPW.16-A02",
    "to": "FPW.16-E1",
    "kind": "end",
    "points": [
     [
      666,
      49
     ],
     [
      680,
      49
     ]
    ]
   },
   {
    "from": "FPW.16-A03",
    "to": "FPW.16-E2",
    "kind": "end",
    "points": [
     [
      386,
      147
     ],
     [
      400,
      147
     ]
    ]
   },
   {
    "from": "FPW.16-A04",
    "to": "FPW.16-E3",
    "kind": "end",
    "points": [
     [
      386,
      237
     ],
     [
      400,
      237
     ]
    ]
   }
  ],
  "joins": []
 }
};

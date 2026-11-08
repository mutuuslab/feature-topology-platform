// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.14",
 "name": "Feature DB 운영",
 "en": "Feature DB Operation",
 "group": "지원",
 "gates": [],
 "ref": "Feature DB 설계(30-95) 6.4절(추가 요청), 8장(운영 — 변경 요청·도메인 검토·승인·버전 발행·정기 점검)",
 "purpose": "Feature 등록의 원천인 Feature DB 기준 행을 변경 요청으로만 바꾸고, 등록 기준 자동 점검과 담당 도메인 검토를 거쳐 Feature DB 관리자가 승인한 변경을 번호 붙은 버전으로 발행해 모든 등록 화면이 같은 기준을 쓰게 한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "기준 행의 추가·수정·폐기 예정·폐기가 필드 단위 차이를 가진 변경 요청으로 남는다."
  },
  {
   "id": "O2",
   "text": "변경 요청마다 등록 기준 자동 점검 결과와 담당 도메인 검토 의견이 남는다."
  },
  {
   "id": "O3",
   "text": "요청자·검토자와 다른 사람이 근거를 남기고 변경을 승인·반려한다."
  },
  {
   "id": "O4",
   "text": "승인된 변경이 정규화 해시가 기록된 발행 버전으로 묶여 등록 화면에 반영되고"
  },
  {
   "id": "O5",
   "text": "출처마다 다음 점검일이 관리되고 기한이 지난 출처가 점검된다."
  },
  {
   "id": "O6",
   "text": "플랫폼 분류 노드의 수준·상위·Feature 배치와 변경 이력이 발행 원본과 구분되어 보존된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.14.BP1",
   "name": "변경 요청 작성",
   "definition": "기준 기능의 변경 종류·필드·근거 출처와 대체 방안을 명시한 요청을 작성한다. 영향을 받는 Feature와 산정 과제를 확인하고 변경 판단에 필요한 정보를 제공한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-REF-CHANGE-REQ",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.14.BP2",
   "name": "자동 점검·도메인 검토",
   "definition": "자동 점검과 담당 도메인의 검토로 식별·출처·규모·관계의 타당성을 확인한다. 누락·반대·보완 사항과 안전 등급 변경 의견을 기록하고 요청자와 검토자의 분리를 유지한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-REF-REVIEW",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.14.BP3",
   "name": "변경 승인·반려",
   "definition": "요청과 점검·도메인 의견을 함께 검토하여 변경 승인 또는 반려를 결정한다. 작성·검토와 분리된 관리자가 사유를 남기고 발행 전 대기 상태를 명확히 한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-REF-DECISION",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.14.BP4",
   "name": "Feature DB 버전 발행",
   "definition": "승인된 변경을 발행 단위로 묶어 품질 상태·발행 노트·정규화 해시를 기록한다. 상태 확정과 영향 사용자 통지를 확인하여 등록·산정이 같은 발행판을 참조하도록 한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A04"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-REFDB-RELEASE",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.14.BP5",
   "name": "출처 정기 점검",
   "definition": "점검 기한과 출처의 개정 여부를 확인하여 기준 기능에 미치는 영향을 평가한다. 필요한 도메인·법규 검토를 요청하고 점검 결과·후속 변경·다음 기한을 보존한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A05"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-REF-SOURCE-REVIEW",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.14.BP6",
   "name": "플랫폼 분류 계층 관리",
   "definition": "발행 원본과 플랫폼 확장 분류를 구분하여 수준·상위·배치 정합성을 유지한다. 노드 변경 근거와 삭제 묘비를 보존하고 Feature 등록 담당자가 같은 경로를 참조하도록 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.14-A06"
   ],
   "outcomes": [
    "O6"
   ],
   "evidence": [
    {
     "workProduct": "WP-PLATFORM-TAXONOMY",
     "outcomes": [
      "O6"
     ]
    }
   ]
  }
 ],
 "rules": [],
 "entry": [
  "Feature DB 첫 발행본(엑셀 1회 이전 v1.3)이 설치되어 있다",
  "Feature DB 관리자와 도메인별 검토자가 계정에 지정되어 있다"
 ],
 "exit": [
  "승인된 변경이 새 발행 버전에 묶이고 전체 정규화 해시가 기록되었다",
  "반려되어 폐기된 요청 중 행에 연결된 Feature의 Feature Owner가 알림을 받았다",
  "다음 점검일이 지난 출처가 남아 있지 않다"
 ],
 "workProducts": [
  {
   "key": "WP-REF-CHANGE-REQ",
   "name": "기준 행 변경 요청",
   "en": "Reference Change Request",
   "kind": "output",
   "retained": false,
   "content": [
    "요청 종류(추가·수정·폐기 예정·폐기)와 대상 기준 행 ID",
    "필드별 변경 전후 값과 사유·1차 출처 위치",
    "이 행을 쓰는 FF Feature와 진행 중 산정 과제 목록(영향 표시)"
   ]
  },
  {
   "key": "WP-REF-REVIEW",
   "name": "자동 점검·도메인 검토 기록",
   "en": "Automated Check & Domain Review Record",
   "kind": "output",
   "retained": false,
   "content": [
    "등록 기준 점검 결과(통과·보완 필요·필수 정보 누락) 항목별 표시",
    "도메인 검토자 의견(동의·보완·반대)과 근거",
    "검토자가 요청자와 다른 사람이라는 확인"
   ]
  },
  {
   "key": "WP-REF-DECISION",
   "name": "변경 승인·반려 기록",
   "en": "Reference Change Decision",
   "kind": "output",
   "retained": false,
   "content": [
    "승인·반려 판정과 사유, 판정자와 시각",
    "승인된 필드 차이의 적용 결과(발행 대기 표시)",
    "반려된 추가 요청의 요청 중 행(발행 때 폐기·알림 대상)"
   ]
  },
  {
   "key": "WP-REFDB-RELEASE",
   "name": "Feature DB 발행본",
   "en": "Feature DB Release",
   "kind": "output",
   "retained": false,
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
   "en": "Source Periodic Review Record",
   "kind": "output",
   "retained": true,
   "content": [
    "다음 점검일이 지난 출처와 점검 결과(변경 없음·개정 있음)",
    "개정이 있는 출처에서 나온 후속 변경 요청 대상 행",
    "출처별 새 다음 점검일"
   ]
  },
  {
   "key": "WP-PLATFORM-TAXONOMY",
   "name": "플랫폼 분류 계층 기록",
   "en": "Platform Taxonomy Record",
   "kind": "output",
   "retained": true,
   "content": [
    "노드 ID·명칭·L0~L5 수준·한 단계 위 상위 노드와 참조한 Feature DB 발행판",
    "등록·명칭 수정·삭제 사유와 담당자·시각, 삭제 ID 묘비와 재사용 금지 결과",
    "하위 노드·배치 Feature 점검 및 Feature별 분류 경로, 원본 발행 분류와의 경계"
   ]
  }
 ],
 "activities": [
  {
   "id": "FPW.14-A01",
   "name": "변경 요청 작성",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
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
   "steps": [
    "Feature DB 상세에서 바꿀 기준 행을 열고 요청 종류(추가·수정·폐기 예정·폐기)를 고른다",
    "바꿀 필드의 새 값과 사유, 근거가 되는 1차 출처 위치를 적는다",
    "출처 정기 점검에서 넘어온 개정 대상 행이면 그 점검 기록을 사유에 인용한다",
    "영향 표시에서 이 행을 쓰는 Feature와 진행 중 산정 과제를 확인하고, 대표 ASIL·T-shirt 변경이면 재계산 필요를 알린다",
    "폐기 예정·폐기 요청이면 대체 행을 함께 지정한다"
   ],
   "checks": [
    "변경 요청에 필드별 변경 전후 값과 사유·출처가 있다",
    "폐기 예정·폐기 요청에 대체 행 또는 대체 없음 사유가 있다"
   ],
   "platform": {
    "actions": [
     "createRefChange"
    ],
    "screens": [
     "/master/feature-db/:refId"
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
    "FPW.14-A02"
   ]
  },
  {
   "id": "FPW.14-A02",
   "name": "자동 점검·도메인 검토",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "자동 점검 결과에서 ID 형식·필수 정보·출처·규모 근거·중복·선행 관계 항목을 확인한다",
    "필수 정보 누락은 요청자에게 보완을 요청하고, 그 밖의 실패 항목은 보완 필요로 표시한다",
    "담당 도메인의 기준으로 변경 내용을 검토해 동의·보완·반대 의견과 근거를 남긴다",
    "대표 ASIL을 바꾸는 요청이면 Safety Manager 의견을 받아 함께 적는다"
   ],
   "checks": [
    "검토 의견이 비어 있지 않고 검토자가 요청자와 다른 사람이다",
    "필수 정보 누락 항목이 남아 있지 않다"
   ],
   "platform": {
    "actions": [
     "reviewRefChange"
    ],
    "screens": [
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 72,
   "next": [
    "FPW.14-A03"
   ]
  },
  {
   "id": "FPW.14-A03",
   "name": "변경 승인·반려",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "변경 요청·자동 점검 결과·도메인 검토 의견을 함께 보고 승인 또는 반려를 정한다",
    "마지막 검토 의견이 반대·보완이면 승인하지 않고, 반려하거나 요청자에게 보완을 맡긴다",
    "판정 사유를 남긴다 — 요청 중 행의 상태 확정(활성·검토 필요·폐기)과 연결 Feature 알림은 다음 발행 때 이루어진다"
   ],
   "checks": [
    "승인자가 요청자와도, 그 요청의 도메인 검토자와도 다른 사람이고 판정 사유가 있다",
    "승인된 변경은 발행 전까지 발행 대기로 표시되어 등록 화면에 반영되지 않았다"
   ],
   "platform": {
    "actions": [
     "decideRefChange"
    ],
    "screens": [
     "/master/feature-db/changes/:id",
     "/master/feature-db/changes"
    ],
    "gates": [],
    "anchor": null,
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 72,
   "next": [
    "FPW.14-A04"
   ]
  },
  {
   "id": "FPW.14-A04",
   "name": "Feature DB 버전 발행",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [],
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
   "steps": [
    "발행 대기인 승인 요청을 모아 다음 발행 번호로 묶는다",
    "품질 지표(상태 미입력·출처 없는 행·12개월 경과 행)를 확인하고 발행 노트에 적는다",
    "발행해 전체 정규화 해시를 기록하고 등록 화면이 새 버전을 쓰는지 확인한다",
    "승인된 추가 요청의 요청 중 행이 활성(근거 부족이면 검토 필요)이 되고, 반려된 추가 요청의 요청 중 행이 폐기와 사유로 확정되었는지 확인한다",
    "폐기로 확정된 행에 연결된 Feature의 Feature Owner에게 다른 행으로 다시 연결하라는 알림이 갔는지 확인한다",
    "바뀐 기준 행을 쓰는 Feature에 '기준 행이 바뀜' 표시가 붙었는지 확인한다"
   ],
   "checks": [
    "발행 번호·묶인 요청 목록·정규화 해시가 발행 기록에 있다",
    "발행 대기 요청 수가 0이다",
    "반려된 추가 요청의 요청 중 행이 남아 있지 않다"
   ],
   "platform": {
    "actions": [
     "publishRefRelease"
    ],
    "screens": [
     "/master/feature-db/changes"
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
   "id": "FPW.14-A05",
   "name": "출처 정기 점검",
   "trigger": "출처의 다음 점검일 도래(Feature DB 화면 알림)",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [],
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
   "steps": [
    "기한이 지난 출처(AUTOSAR·VSS·ISO·UN 규정·Euro NCAP 등) 목록을 Feature DB 화면 알림에서 연다",
    "출처마다 새 판·개정 여부를 확인하고, 규정 출처는 법규 담당 의견을 받는다",
    "개정이 기준 행에 영향을 주면 해당 행의 변경 요청이 나오도록 담당 도메인 검토자에게 넘긴다",
    "점검 결과와 새 다음 점검일을 기록한다"
   ],
   "checks": [
    "기한이 지난 출처마다 점검 결과와 새 다음 점검일이 있다"
   ],
   "platform": {
    "actions": [
     "recordSourceReview"
    ],
    "screens": [
     "/master/feature-db"
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
   "id": "FPW.14-A06",
   "name": "플랫폼 분류 계층 관리",
   "trigger": "Feature DB 발행 또는 플랫폼 분류 확장·수정 요청",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O6"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-RDA"
    ],
    "A": "R-RDA",
    "C": [
     "R-FO",
     "R-ARC",
     "R-PLM"
    ],
    "I": [
     "R-DRV"
    ]
   },
   "inputs": [
    "WP-REFDB-RELEASE"
   ],
   "outputs": [
    "WP-PLATFORM-TAXONOMY"
   ],
   "steps": [
    "발행 원본의 도메인·클러스터·컴포넌트를 조회하고 필요한 플랫폼 노드의 수준과 상위를 확인한다",
    "플랫폼 노드를 등록하거나 명칭·설명을 수정한다. 상위는 정확히 한 단계 위여야 한다",
    "삭제 전 하위 노드와 배치 Feature가 없는지 확인하고 삭제 사유와 재사용 금지 묘비를 보존한다",
    "Feature 등록 담당자에게 같은 수준의 배치 후보와 L0부터의 경로를 인계한다"
   ],
   "checks": [
    "발행 원본 분류는 직접 수정하지 않았고 원본 변경은 Feature DB 변경 요청으로 처리했다",
    "노드 ID 재사용·잘못된 상위·하위 또는 배치가 있는 노드 삭제가 거부된다"
   ],
   "platform": {
    "actions": [
     "createTaxonomyNode",
     "updateTaxonomyNode",
     "deleteTaxonomyNode"
    ],
    "screens": [
     "/master/taxonomy/levels"
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
  "width": 1366,
  "height": 384,
  "lanes": [
   {
    "role": "R-FO",
    "label": "Feature Owner",
    "x": 0,
    "y": 0,
    "w": 1366,
    "h": 98
   },
   {
    "role": "R-DRV",
    "label": "도메인 검토자",
    "x": 0,
    "y": 98,
    "w": 1366,
    "h": 98
   },
   {
    "role": "R-RDA",
    "label": "Feature DB 관리자",
    "x": 0,
    "y": 196,
    "w": 1366,
    "h": 188
   }
  ],
  "nodes": [
   {
    "id": "FPW.14-A01",
    "kind": "action",
    "label": "변경 요청 작성",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A02",
    "kind": "action",
    "label": "자동 점검·도메인 검토",
    "x": 478,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A03",
    "kind": "action",
    "label": "변경 승인·반려",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A04",
    "kind": "action",
    "label": "Feature DB 버전 발행",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A05",
    "kind": "action",
    "label": "출처 정기 점검",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A06",
    "kind": "action",
    "label": "플랫폼 분류 계층 관리",
    "x": 198,
    "y": 302,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-S2",
    "kind": "start",
    "label": "출처의 다음 점검일 도래(Feature DB 화면 알림)",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-S3",
    "kind": "start",
    "label": "Feature DB 발행 또는 플랫폼 분류 확장·수정 요청",
    "x": 146,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E1",
    "kind": "end",
    "label": "종료",
    "x": 1240,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 326,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.14-S1",
    "to": "FPW.14-A01",
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
    "from": "FPW.14-S2",
    "to": "FPW.14-A05",
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
    "from": "FPW.14-S3",
    "to": "FPW.14-A06",
    "kind": "trigger",
    "points": [
     [
      164,
      335
     ],
     [
      198,
      335
     ]
    ]
   },
   {
    "from": "FPW.14-A01",
    "to": "FPW.14-A02",
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
    "from": "FPW.14-A02",
    "to": "FPW.14-A03",
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
    "from": "FPW.14-A03",
    "to": "FPW.14-A04",
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
    "from": "FPW.14-A04",
    "to": "FPW.14-E1",
    "kind": "end",
    "points": [
     [
      1226,
      245
     ],
     [
      1240,
      245
     ]
    ]
   },
   {
    "from": "FPW.14-A05",
    "to": "FPW.14-E2",
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
    "from": "FPW.14-A06",
    "to": "FPW.14-E3",
    "kind": "end",
    "points": [
     [
      386,
      335
     ],
     [
      400,
      335
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 1366,
  "height": 384,
  "lanes": [
   {
    "department": "DEP-PDP",
    "label": "상품기획팀",
    "x": 0,
    "y": 0,
    "w": 1366,
    "h": 98
   },
   {
    "department": "DEP-SE",
    "label": "시스템엔지니어링팀",
    "x": 0,
    "y": 98,
    "w": 1366,
    "h": 98
   },
   {
    "department": "DEP-PLM",
    "label": "PLM·기준정보팀",
    "x": 0,
    "y": 196,
    "w": 1366,
    "h": 188
   }
  ],
  "nodes": [
   {
    "id": "FPW.14-A01",
    "kind": "action",
    "label": "변경 요청 작성",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A02",
    "kind": "action",
    "label": "자동 점검·도메인 검토",
    "x": 478,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A03",
    "kind": "action",
    "label": "변경 승인·반려",
    "x": 758,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A04",
    "kind": "action",
    "label": "Feature DB 버전 발행",
    "x": 1038,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A05",
    "kind": "action",
    "label": "출처 정기 점검",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-A06",
    "kind": "action",
    "label": "플랫폼 분류 계층 관리",
    "x": 198,
    "y": 302,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.14-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-S2",
    "kind": "start",
    "label": "출처의 다음 점검일 도래(Feature DB 화면 알림)",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-S3",
    "kind": "start",
    "label": "Feature DB 발행 또는 플랫폼 분류 확장·수정 요청",
    "x": 146,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E1",
    "kind": "end",
    "label": "종료",
    "x": 1240,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.14-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 326,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.14-S1",
    "to": "FPW.14-A01",
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
    "from": "FPW.14-S2",
    "to": "FPW.14-A05",
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
    "from": "FPW.14-S3",
    "to": "FPW.14-A06",
    "kind": "trigger",
    "points": [
     [
      164,
      335
     ],
     [
      198,
      335
     ]
    ]
   },
   {
    "from": "FPW.14-A01",
    "to": "FPW.14-A02",
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
    "from": "FPW.14-A02",
    "to": "FPW.14-A03",
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
    "from": "FPW.14-A03",
    "to": "FPW.14-A04",
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
    "from": "FPW.14-A04",
    "to": "FPW.14-E1",
    "kind": "end",
    "points": [
     [
      1226,
      245
     ],
     [
      1240,
      245
     ]
    ]
   },
   {
    "from": "FPW.14-A05",
    "to": "FPW.14-E2",
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
    "from": "FPW.14-A06",
    "to": "FPW.14-E3",
    "kind": "end",
    "points": [
     [
      386,
      335
     ],
     [
      400,
      335
     ]
    ]
   }
  ],
  "joins": []
 }
};

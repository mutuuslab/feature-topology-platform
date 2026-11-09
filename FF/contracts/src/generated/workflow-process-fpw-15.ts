// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.15",
 "name": "SW 개발비·원가 기준 관리",
 "en": "Software Cost and Cost Basis Management",
 "group": "지원",
 "gates": [],
 "ref": "업무 레퍼런스 모델 요구(WF-REFERENCE-REQUIREMENTS)·현행 플랫폼 계약/화면; 조직 검토 전 초안",
 "purpose": "Feature·기준 행·적용 범위를 산정 근거로 고정하고 공수·계수·단가의 출처와 검토 책임을 분리하여 재현 가능한 SW 개발비를 산정하며, 승인 결과를 보존한 채 실적을 다음 원가 기준 개정에 반영한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "산정 대상과 Feature·기준 행 버전, 제외 범위 및 가정이 식별된다."
  },
  {
   "id": "O2",
   "text": "공수·MBD 작업·계수·단가 버전과 계산 오류가 검토되어 산정 결과가 재현된다."
  },
  {
   "id": "O3",
   "text": "작성자와 다른 승인자가 검토한 제출·승인·반려 이력이 남고 승인 스냅샷이 보존된다."
  },
  {
   "id": "O4",
   "text": "금액 열람 권한을 지켜 승인 결과가 공유되며 실적 오차가 다음 기준 개정의 근거가 된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.15.BP1",
   "name": "산정 범위 설정",
   "definition": "산정 과제의 목적·범위·책임을 정하고 산정 대상 Feature와 기준 행을 특정 버전으로 식별한다. 구입 계약 확정이나 Feature 출시 승인과 구분한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-SCOPE",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP2",
   "name": "원가 기준 발행",
   "definition": "단가와 계수의 출처·적용 조건을 관리하고 개정된 값을 번호가 있는 새 기준으로 발행한다. 발행이 과거 승인 과제의 금액을 바꾸지 않도록 승인 스냅샷과 분리한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-BASIS",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP3",
   "name": "공수·규모 입력",
   "definition": "Feature별 규모·공수·재사용과 MBD 작업을 출처에 따라 입력하고 계산 오류·합계를 검토한다. 자동 채운 값도 추정 가정으로 확인하며 산정 금액을 사업 승인으로 취급하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A03"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-CALC",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP4",
   "name": "산정 검토 요청",
   "definition": "재현 가능한 산정 입력과 검토 체크를 갖춰 독립 승인자에게 제출한다. 제출 응답만으로 승인되었다고 표시하지 않고 과제의 실제 상태와 보완 요구를 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A04"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-REVIEW",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP5",
   "name": "산정 승인·반려",
   "definition": "작성자와 다른 승인자가 산정 근거와 불확실성을 검토해 승인 또는 반려한다. 승인 뒤 입력 변경은 개정 절차로 분리하고 같은 과제의 승인 증거를 덮어쓰지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A05"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-REVIEW",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP6",
   "name": "승인 결과 열람·공유",
   "definition": "금액 열람 권한을 가진 사람이 승인 결과와 가정을 조회하고 허용된 범위로 공유한다. 열람자는 산정 입력이나 승인 상태를 바꾸지 않으며 내보내기 감사와 전달 제한을 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A06"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-SHARE",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP7",
   "name": "실적·교정 검토",
   "definition": "승인 이후 실적을 별도 기록하여 추정 오차를 분석하고 단가·계수 개정의 근거를 제시한다. 제안의 수용은 새 기준 발행에서 결정하며 과거 승인 결과와 구분한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A07"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-ACTUAL",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.15.BP8",
   "name": "구매 견적·변경·대안 검토",
   "definition": "Feature DB 기준 산정과 구매 여섯 검토 유형을 연결한다. 원문·범위·공수·가격·MCU 비교와 독립 의견·비용 승인을 추적하고 기준 변경 뒤 재승인한다. 승인 원문을 인계 자료로 준비하되 회사 계약 체결·지급과 구분한다.",
   "notes": [],
   "activityIds": [
    "FPW.15-A08"
   ],
   "outcomes": [
    "O2",
    "O3",
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-COST-PURCHASING",
     "outcomes": [
      "O2",
      "O3",
      "O4"
     ]
    }
   ]
  }
 ],
 "rules": [],
 "entry": [
  "발행된 Feature DB 기준 행과 산정 담당자가 식별되어 있다",
  "산정 역할과 금액 열람 권한이 기존 IAM에 부여되어 있다"
 ],
 "exit": [
  "승인 또는 반려 결과와 계산 기준 버전이 추적된다",
  "승인된 과거 금액을 덮어쓰지 않고 실적과 새 기준 버전이 분리된다"
 ],
 "workProducts": [
  {
   "key": "WP-COST-SCOPE",
   "name": "산정 범위·과제",
   "en": "Cost Scope and Project",
   "kind": "output",
   "retained": false,
   "content": [
    "Feature DB 기준 행·발행 버전·선택 연결 Feature·작성자",
    "차량/시장·포함/제외·가정과 과제 설정"
   ]
  },
  {
   "key": "WP-COST-BASIS",
   "name": "발행 원가 기준",
   "en": "Published Cost Basis",
   "kind": "output",
   "retained": false,
   "content": [
    "단가·계수·통화·근거 출처와 버전",
    "초안과 발행자·사유·적용 시점"
   ]
  },
  {
   "key": "WP-COST-CALC",
   "name": "산정 입력·계산 결과",
   "en": "Cost Calculation",
   "kind": "output",
   "retained": false,
   "content": [
    "줄별 규모·공수·MBD 입력과 근거",
    "계산 오류·합계·적용 기준 버전"
   ]
  },
  {
   "key": "WP-COST-REVIEW",
   "name": "산정 검토·승인 기록",
   "en": "Cost Review and Decision",
   "kind": "output",
   "retained": false,
   "content": [
    "검토 체크·제출·승인/반려 사유와 사람·시각",
    "승인 스냅샷과 개정 관계"
   ]
  },
  {
   "key": "WP-COST-SHARE",
   "name": "산정 결과 공유 기록",
   "en": "Cost Disclosure Record",
   "kind": "output",
   "retained": true,
   "content": [
    "열람/내보내기 대상·권한·버전",
    "내보내기 감사 기록과 공유 제한"
   ]
  },
  {
   "key": "WP-COST-ACTUAL",
   "name": "실적·오차 검토",
   "en": "Cost Actuals and Calibration",
   "kind": "output",
   "retained": true,
   "content": [
    "승인 뒤 실적 공수·출처·편차",
    "교정 제안과 다음 기준 개정의 채택/보류 근거"
   ]
  },
  {
   "key": "WP-COST-PURCHASING",
   "name": "구매 검토·승인 인계 묶음",
   "en": "Procurement review and approved handoff package",
   "kind": "output",
   "retained": true,
   "content": [
    "구매 05·12·13·15·21·23의 견적 범위·공수 단가·변경 청구·요구 연결·가격·MCU 비교와 근거 원문 SHA-256",
    "Feature DB·계수 표·과제 기준 지문과 미확정·비적용·확정 0을 구별한 계산 결과",
    "작성자와 다른 기술 의견·Terms 근거 확인·독립 비용 승인 및 개정 이력",
    "승인 원문 지문을 가진 PREPARED 인계 자료이며 회사 계약 체결·지급은 별도 절차"
   ]
  }
 ],
 "activities": [
  {
   "id": "FPW.15-A01",
   "name": "산정 범위 설정",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [],
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
   "steps": [
    "발행된 Feature DB 기준 행을 먼저 선택하고 출처·버전을 확인한다",
    "실제 연결된 등록 Feature는 선택해 연결하고 차량·시장·포함·제외·가정을 확인한다",
    "자동 채운 과제명·산정 입력과 책임자 및 계수 표 발행 버전을 확인한다"
   ],
   "checks": [
    "대상과 가정이 과제 설정에 남는다"
   ],
   "platform": {
    "actions": [
     "costProjectCreate",
     "costReferenceAdd",
     "costReferenceUpdate",
     "costProjectUpdate"
    ],
    "screens": [
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId"
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
    "FPW.15-A03"
   ]
  },
  {
   "id": "FPW.15-A02",
   "name": "원가 기준 발행",
   "trigger": "원가 기준 개정 필요",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "현행 단가·계수와 출처 및 통화를 확인한다",
    "변경 항목을 새 기준 초안으로 작성한다",
    "사유를 적어 새 기준 버전을 발행하고 적용 대상을 알린다"
   ],
   "checks": [
    "과거 승인 산정은 발행 전 스냅샷을 유지한다",
    "기준 버전과 변경 사유가 남는다"
   ],
   "platform": {
    "actions": [
     "costBasisDraft",
     "costBasisPublish"
    ],
    "screens": [
     "/procurement/sw-cost/basis"
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
   "id": "FPW.15-A03",
   "name": "공수·규모 입력",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
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
   "steps": [
    "기준 행별 수량·사양과 선택한 Feature의 실제 연결 범위를 확인한다",
    "규모·복잡도·재사용과 MBD 작업별 공수 근거를 입력한다",
    "오류와 합계를 계산해 기준 버전 및 제외 항목을 재확인한다"
   ],
   "checks": [
    "필수 입력 오류가 해소되거나 보류 사유가 남는다",
    "줄별 입력과 계산 기준을 재현할 수 있다"
   ],
   "platform": {
    "actions": [
     "costLineUpdate",
     "costMbdPut"
    ],
    "screens": [
     "/procurement/sw-cost/:estId"
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
    "FPW.15-A04"
   ]
  },
  {
   "id": "FPW.15-A04",
   "name": "산정 검토 요청",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "범위·기준 버전·계산 오류와 검토 체크를 확인한다",
    "불확실한 가정과 제외 항목을 검토 설명에 남긴다",
    "제출 전이를 요청하고 제출 상태와 시각을 확인한다"
   ],
   "checks": [
    "제출과 미해결 항목이 기록된다"
   ],
   "platform": {
    "actions": [
     "costCheckPut",
     "costTransition"
    ],
    "screens": [
     "/procurement/sw-cost/:estId"
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
    "FPW.15-A05"
   ]
  },
  {
   "id": "FPW.15-A05",
   "name": "산정 승인·반려",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [],
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
   "steps": [
    "작성자와 자신이 다른 사람인지 확인한다",
    "범위·공수·단가와 검토 체크를 근거로 승인 또는 반려를 판단한다",
    "사유를 남겨 전이하고 승인 스냅샷 또는 보완 요청을 확인한다"
   ],
   "checks": [
    "자기 작성 과제의 승인이 차단된다",
    "판정자·사유와 승인 스냅샷이 추적된다"
   ],
   "platform": {
    "actions": [
     "costCheckPut",
     "costTransition"
    ],
    "screens": [
     "/procurement/sw-cost/:estId"
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
    "FPW.15-A06"
   ]
  },
  {
   "id": "FPW.15-A06",
   "name": "승인 결과 열람·공유",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [],
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
   "steps": [
    "자신의 금액 열람 권한과 공유 목적을 확인한다",
    "승인 버전과 금액·가정을 조회하고 필요하면 허용된 내보내기를 사용한다",
    "내보내기 감사와 전달 범위를 확인하고 승인 원본을 보존한다"
   ],
   "checks": [
    "조회가 작성·승인 권한으로 확대되지 않는다",
    "공유한 버전과 대상이 식별된다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/procurement/sw-cost",
     "/procurement/sw-cost/:estId"
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
   "id": "FPW.15-A07",
   "name": "실적·교정 검토",
   "trigger": "승인 뒤 실적 확보",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [],
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
   "steps": [
    "승인된 기준 버전과 실적 공수의 수집 범위를 확인한다",
    "실적과 출처를 기록하고 산정 오차 및 교정 제안을 검토한다",
    "다음 기준 개정에 반영할 항목과 보류 사유를 기준 관리자에게 전달한다"
   ],
   "checks": [
    "실적 입력이 승인 금액을 소급 변경하지 않는다",
    "교정 제안은 기준 개정 전 자동 적용되지 않는다"
   ],
   "platform": {
    "actions": [
     "costActualPut"
    ],
    "screens": [
     "/procurement/sw-cost/:estId",
     "/procurement/sw-cost/basis"
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
   "id": "FPW.15-A08",
   "name": "구매 견적·변경·대안 검토",
   "trigger": "견적 범위·변경 청구·가격 또는 MCU 대안 검토가 필요한 경우",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2",
    "O3",
    "O4"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-CE"
    ],
    "A": "R-CA",
    "C": [
     "R-INT",
     "R-CBA",
     "R-PUR"
    ],
    "I": [
     "R-CV"
    ]
   },
   "inputs": [
    "WP-COST-CALC",
    "WP-COST-BASIS"
   ],
   "outputs": [
    "WP-COST-PURCHASING"
   ],
   "steps": [
    "Feature DB 기준 행과 발행 계수·과제 버전을 확인하고 실제 연결 요구·출처를 자동 채운다",
    "공급사와 지역을 구분해 동등 요구·작업·시험 범위를 비교하고 실제 작업 유형에 맞는 공수·단가·환산 출처를 확인한다",
    "변경 전 승인 기준·변경 요구·작업·청구·계약 포함 여부와 인정 제안을 나누고 중복 수행 비용을 검토한다",
    "라이선스의 과금·차종·파생·유지보수·재사용 Terms와 원계약의 고정비·회수·물량·가격 인상 요인을 확인한다",
    "같은 ECU 전체를 MCU 대안에 배정해 공통비를 한 번만 합산하고 물량별 총액·손익분기 및 비재무 제약을 비교한다",
    "원문 SHA·미확정을 보존해 독립 기술 의견·Terms 근거 확인·비용 승인을 받고 기준 변경 때 재산정·재승인한 PREPARED 인계 자료를 준비한다"
   ],
   "checks": [
    "서로 다른 실제 사람의 작성·기술 의견·비용 승인과 금액 비공개 투영이 유지된다",
    "원문 훼손·동시 수정·오래된 기준과 미확정 값은 검토 완료를 막는다",
    "인계 준비를 회사 계약 체결·구매 승인·지급 완료로 표시하지 않는다"
   ],
   "platform": {
    "actions": [
     "costReviewCreate",
     "costReviewUpdate",
     "costReviewAction"
    ],
    "screens": [
     "/procurement/sw-cost/:estId"
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
  "height": 572,
  "lanes": [
   {
    "role": "R-CE",
    "label": "SW 개발비 산정 작성자",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 278
   },
   {
    "role": "R-CBA",
    "label": "원가 기준 관리자",
    "x": 0,
    "y": 278,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-CA",
    "label": "SW 개발비 산정 승인자",
    "x": 0,
    "y": 376,
    "w": 1646,
    "h": 98
   },
   {
    "role": "R-CV",
    "label": "SW 개발비 산정 열람자",
    "x": 0,
    "y": 474,
    "w": 1646,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.15-A01",
    "kind": "action",
    "label": "산정 범위 설정",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A03",
    "kind": "action",
    "label": "공수·규모 입력",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A04",
    "kind": "action",
    "label": "산정 검토 요청",
    "x": 758,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A07",
    "kind": "action",
    "label": "실적·교정 검토",
    "x": 198,
    "y": 106,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A08",
    "kind": "action",
    "label": "구매 견적·변경·대안 검토",
    "x": 198,
    "y": 196,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A02",
    "kind": "action",
    "label": "원가 기준 발행",
    "x": 198,
    "y": 294,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A05",
    "kind": "action",
    "label": "산정 승인·반려",
    "x": 1038,
    "y": 392,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A06",
    "kind": "action",
    "label": "승인 결과 열람·공유",
    "x": 1318,
    "y": 490,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S2",
    "kind": "start",
    "label": "원가 기준 개정 필요",
    "x": 146,
    "y": 318,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S3",
    "kind": "start",
    "label": "승인 뒤 실적 확보",
    "x": 146,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S4",
    "kind": "start",
    "label": "견적 범위·변경 청구·가격 또는 MCU 대안 검토가 필요한 경우",
    "x": 146,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 318,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E2",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 514,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E4",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 220,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.15-S1",
    "to": "FPW.15-A01",
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
    "from": "FPW.15-S2",
    "to": "FPW.15-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      327
     ],
     [
      198,
      327
     ]
    ]
   },
   {
    "from": "FPW.15-S3",
    "to": "FPW.15-A07",
    "kind": "trigger",
    "points": [
     [
      164,
      139
     ],
     [
      198,
      139
     ]
    ]
   },
   {
    "from": "FPW.15-S4",
    "to": "FPW.15-A08",
    "kind": "trigger",
    "points": [
     [
      164,
      229
     ],
     [
      198,
      229
     ]
    ]
   },
   {
    "from": "FPW.15-A01",
    "to": "FPW.15-A03",
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
    "from": "FPW.15-A03",
    "to": "FPW.15-A04",
    "kind": "flow",
    "points": [
     [
      666,
      49
     ],
     [
      758,
      49
     ]
    ]
   },
   {
    "from": "FPW.15-A04",
    "to": "FPW.15-A05",
    "kind": "flow",
    "points": [
     [
      946,
      49
     ],
     [
      1026,
      49
     ],
     [
      1026,
      425
     ],
     [
      1038,
      425
     ]
    ]
   },
   {
    "from": "FPW.15-A05",
    "to": "FPW.15-A06",
    "kind": "flow",
    "points": [
     [
      1226,
      425
     ],
     [
      1306,
      425
     ],
     [
      1306,
      523
     ],
     [
      1318,
      523
     ]
    ]
   },
   {
    "from": "FPW.15-A02",
    "to": "FPW.15-E1",
    "kind": "end",
    "points": [
     [
      386,
      327
     ],
     [
      400,
      327
     ]
    ]
   },
   {
    "from": "FPW.15-A06",
    "to": "FPW.15-E2",
    "kind": "end",
    "points": [
     [
      1506,
      523
     ],
     [
      1520,
      523
     ]
    ]
   },
   {
    "from": "FPW.15-A07",
    "to": "FPW.15-E3",
    "kind": "end",
    "points": [
     [
      386,
      139
     ],
     [
      400,
      139
     ]
    ]
   },
   {
    "from": "FPW.15-A08",
    "to": "FPW.15-E4",
    "kind": "end",
    "points": [
     [
      386,
      229
     ],
     [
      400,
      229
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 1646,
  "height": 368,
  "lanes": [
   {
    "department": "DEP-PUR",
    "label": "구매팀",
    "x": 0,
    "y": 0,
    "w": 1646,
    "h": 368
   }
  ],
  "nodes": [
   {
    "id": "FPW.15-A01",
    "kind": "action",
    "label": "산정 범위 설정",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A02",
    "kind": "action",
    "label": "원가 기준 발행",
    "x": 198,
    "y": 106,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A03",
    "kind": "action",
    "label": "공수·규모 입력",
    "x": 478,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A04",
    "kind": "action",
    "label": "산정 검토 요청",
    "x": 758,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A05",
    "kind": "action",
    "label": "산정 승인·반려",
    "x": 1038,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A06",
    "kind": "action",
    "label": "승인 결과 열람·공유",
    "x": 1318,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A07",
    "kind": "action",
    "label": "실적·교정 검토",
    "x": 198,
    "y": 196,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-A08",
    "kind": "action",
    "label": "구매 견적·변경·대안 검토",
    "x": 198,
    "y": 286,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.15-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S2",
    "kind": "start",
    "label": "원가 기준 개정 필요",
    "x": 146,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S3",
    "kind": "start",
    "label": "승인 뒤 실적 확보",
    "x": 146,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-S4",
    "kind": "start",
    "label": "견적 범위·변경 청구·가격 또는 MCU 대안 검토가 필요한 경우",
    "x": 146,
    "y": 310,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E2",
    "kind": "end",
    "label": "종료",
    "x": 1520,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.15-E4",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 310,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.15-S1",
    "to": "FPW.15-A01",
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
    "from": "FPW.15-S2",
    "to": "FPW.15-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      139
     ],
     [
      198,
      139
     ]
    ]
   },
   {
    "from": "FPW.15-S3",
    "to": "FPW.15-A07",
    "kind": "trigger",
    "points": [
     [
      164,
      229
     ],
     [
      198,
      229
     ]
    ]
   },
   {
    "from": "FPW.15-S4",
    "to": "FPW.15-A08",
    "kind": "trigger",
    "points": [
     [
      164,
      319
     ],
     [
      198,
      319
     ]
    ]
   },
   {
    "from": "FPW.15-A01",
    "to": "FPW.15-A03",
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
    "from": "FPW.15-A03",
    "to": "FPW.15-A04",
    "kind": "flow",
    "points": [
     [
      666,
      49
     ],
     [
      758,
      49
     ]
    ]
   },
   {
    "from": "FPW.15-A04",
    "to": "FPW.15-A05",
    "kind": "flow",
    "points": [
     [
      946,
      49
     ],
     [
      1038,
      49
     ]
    ]
   },
   {
    "from": "FPW.15-A05",
    "to": "FPW.15-A06",
    "kind": "flow",
    "points": [
     [
      1226,
      49
     ],
     [
      1318,
      49
     ]
    ]
   },
   {
    "from": "FPW.15-A02",
    "to": "FPW.15-E1",
    "kind": "end",
    "points": [
     [
      386,
      139
     ],
     [
      400,
      139
     ]
    ]
   },
   {
    "from": "FPW.15-A06",
    "to": "FPW.15-E2",
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
   },
   {
    "from": "FPW.15-A07",
    "to": "FPW.15-E3",
    "kind": "end",
    "points": [
     [
      386,
      229
     ],
     [
      400,
      229
     ]
    ]
   },
   {
    "from": "FPW.15-A08",
    "to": "FPW.15-E4",
    "kind": "end",
    "points": [
     [
      386,
      319
     ],
     [
      400,
      319
     ]
    ]
   }
  ],
  "joins": []
 }
};

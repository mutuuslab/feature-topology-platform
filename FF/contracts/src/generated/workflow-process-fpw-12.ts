// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.12",
 "name": "운영 데이터·데이터 보호",
 "en": "Operational Data & Data Protection",
 "group": "지원",
 "gates": [],
 "ref": "표준 보고서 13장(텔레메트리·데이터), 11장 FFG-OFT-003",
 "purpose": "운행 감시에 쓰는 데이터의 범주·접근·보존을 정하고, 평가 컨텍스트에 개인정보가 들어가지 않게 하며, 시장별 데이터 이전·접근권·보존 의무를 지킨다. 처리 목적과 동의 또는 적법 근거를 검토하고 정보주체 요청의 독립 처리와 감사 연속성을 확인한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "운행 중 감시 지표와 경보 기준이 Safety Case에 맞춰 기록된다."
  },
  {
   "id": "O2",
   "text": "Flag 평가 컨텍스트에서 개인정보·위치·주행 상태가 배제된다."
  },
  {
   "id": "O3",
   "text": "중국 데이터는 현지 처리되고 국외 이전은 심사를 거친다."
  },
  {
   "id": "O4",
   "text": "EU 사용자·제3자 데이터 접근 요청과 OEM 이용 계약 근거가 처리·기록된다."
  },
  {
   "id": "O5",
   "text": "범주별 보존 기간이 지난 데이터가 삭제되고 기록된다."
  },
  {
   "id": "O6",
   "text": "개인정보 처리 목적·동의 또는 적법 근거·보존·접근 범위가 검토되고 미확정 사항이 식별된다."
  },
  {
   "id": "O7",
   "text": "정보주체 내보내기·삭제/가명화 요청과 독립 실행·거절 결과가 감사 연속성을 보존하며 추적된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.12.BP1",
   "name": "운행 감시 지표·경보 기준 기록",
   "definition": "Safety Case와 연결되는 운행 감시 목적과 지표·경보 기준을 정한다. 데이터 범주·접근·보존 조건을 기록하고 운영 담당자가 기준에 따라 감시하도록 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-KPI-PLAN",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP2",
   "name": "중국 데이터 현지 처리·이전 심사",
   "definition": "적용 시장의 데이터 범주와 처리·조회·이전 경로를 식별한다. 법무가 정한 심사 방식과 결과를 기록하고 허용되지 않거나 미확정인 경로를 운영 범위에서 구분한다.",
   "notes": [
    "이 업무 정의는 특정 법규의 현재 적용 여부나 국외 이전 승인을 대신하지 않는다."
   ],
   "activityIds": [
    "FPW.12-A03"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-DATA-TRANSFER",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP3",
   "name": "EU 데이터 접근 요청 처리",
   "definition": "요청자의 권한과 대상 차량·제공 범위를 확인하여 데이터 접근 요청을 처리한다. 동의·공유·이용 계약의 근거와 실제 제공 결과를 기록해 요청과 처리를 추적한다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A04"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-DATA-ACCESS",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP4",
   "name": "평가 컨텍스트 개인정보 검토",
   "definition": "평가 목적과 컨텍스트 속성을 검토하여 가명 식별과 금지 정보의 경계를 확인한다. 평가 이전의 거부 시험과 검토 근거를 보존하고 부적절한 수집·사용을 보완하도록 한다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A02"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-CONTEXT-REVIEW",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP5",
   "name": "보존 기간 경과 데이터 삭제",
   "definition": "데이터 범주별로 정해진 보존·삭제 조건과 조사 보류 사유를 확인한다. 대상과 예외를 구분하여 처리를 수행하고 삭제 건수·보류·책임을 기록한다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A05"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-RETENTION-LOG",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP6",
   "name": "처리 목적·근거 검토",
   "definition": "개인정보의 목적·최소 항목·동의 또는 적법 근거와 보존·접근·이전 제한을 검토하여 실행 담당자에게 인계한다. 이 레퍼런스 정의는 고객 동의 수집이나 법률 적합성 승인을 생성하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A06"
   ],
   "outcomes": [
    "O6"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRIVACY-REVIEW",
     "outcomes": [
      "O6"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP7",
   "name": "정보주체 요청 접수",
   "definition": "정보주체 요청의 신원·대상·목적을 확인하고 저장소별 처리 범위를 집계하여 요청을 기록한다. 내보내기·삭제·가명화와 보존 예외를 구분해 실제 실행 또는 거절 판단에 인계한다.",
   "notes": [],
   "activityIds": [
    "FPW.12-A07"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRIVACY-REQ",
     "outcomes": [
      "O7"
     ]
    }
   ]
  },
  {
   "id": "FPW.12.BP8",
   "name": "정보주체 독립 처리",
   "definition": "허용된 내보내기와 삭제·가명화 또는 거절을 근거에 따라 수행하고 결과를 확인한다. 삭제·가명화는 요청자와 다른 보안 담당자가 실행하며 가명화 후 감사 연속성과 외부 Lake 미완료 상태를 보존한다.",
   "notes": [
    "같은 조직 역할의 서로 다른 사람이 요청·실행을 맡는다. 문서의 RACI만으로 사람 분리를 충족했다고 판정하지 않는다."
   ],
   "activityIds": [
    "FPW.12-A08"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-PRIVACY-RESULT",
     "outcomes": [
      "O7"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-OFT-003",
  "FFG-TEL-005",
  "FFG-TEL-006",
  "FFG-TEL-008",
  "FFG-TEL-001"
 ],
 "entry": [
  "Feature가 운영 데이터 수집 범위에 등록되어 있다"
 ],
 "exit": [
  "감시 지표·데이터 범주·보존 기간이 정해지고 접근·이전·삭제 기록이 남았다"
 ],
 "workProducts": [
  {
   "key": "WP-KPI-PLAN",
   "name": "운행 감시 지표·경보 기준",
   "en": "Safety KPI Plan",
   "kind": "output",
   "retained": false,
   "content": [
    "Safety Case 주장과 연결한 운행 감시 지표",
    "지표별 경보 기준과 데이터 범주"
   ]
  },
  {
   "key": "WP-CONTEXT-REVIEW",
   "name": "평가 컨텍스트 속성 검토 기록",
   "en": "Evaluation Context Review",
   "kind": "output",
   "retained": true,
   "content": [
    "허용 속성(가명 차량 ID 등)과 금지 속성 목록",
    "금지 속성 거부 시험 결과"
   ]
  },
  {
   "key": "WP-DATA-TRANSFER",
   "name": "데이터 국외 이전 심사 기록",
   "en": "Cross-border Transfer Assessment",
   "kind": "output",
   "retained": true,
   "content": [
    "중요 데이터 식별 결과와 현지 처리 위치",
    "이전 경로별 심사 방식(안전 평가·표준 계약·인증)"
   ]
  },
  {
   "key": "WP-DATA-ACCESS",
   "name": "데이터 접근 요청·계약 근거 기록",
   "en": "Data Access & Contract Basis",
   "kind": "output",
   "retained": true,
   "content": [
    "요청자·대상 차량·제공한 Feature 상태·이력",
    "OEM 비개인 데이터 이용 계약 근거 문서 ID"
   ]
  },
  {
   "key": "WP-RETENTION-LOG",
   "name": "보존·삭제 기록",
   "en": "Retention & Deletion Log",
   "kind": "output",
   "retained": true,
   "content": [
    "범주별 삭제 건수와 시각",
    "열린 Incident·이상 건에 연결되어 보류한 데이터"
   ]
  },
  {
   "key": "WP-PRIVACY-REVIEW",
   "name": "개인정보 목적·근거 검토",
   "en": "Privacy Purpose and Basis Review",
   "kind": "output",
   "retained": false,
   "content": [
    "처리 목적·최소 항목·정보주체·동의 또는 적법 근거의 원본 참조",
    "접근·보존·국외 이전 제한·검토 담당자·미확정 사항"
   ]
  },
  {
   "key": "WP-PRIVACY-REQ",
   "name": "정보주체 처리 요청",
   "en": "Data Subject Request",
   "kind": "output",
   "retained": false,
   "content": [
    "검증된 요청자·대상 사용자/차량과 요청 종류",
    "대상 저장소·미리 집계한 행·요청 사유와 요청자"
   ]
  },
  {
   "key": "WP-PRIVACY-RESULT",
   "name": "정보주체 처리 결과",
   "en": "Data Subject Request Result",
   "kind": "output",
   "retained": true,
   "content": [
    "요청자와 다른 실행자·근거·처리/거절 시각",
    "내보내기 또는 삭제/가명화 결과·Lake 위임 상태·감사 체인 보존"
   ]
  }
 ],
 "activities": [
  {
   "id": "FPW.12-A01",
   "name": "운행 감시 지표·경보 기준 기록",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-TEL-001"
   ],
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
   "inputs": [
    "WP-SAFETY-CASE"
   ],
   "outputs": [
    "WP-KPI-PLAN"
   ],
   "steps": [
    "Safety Case 주장과 연결되는 운행 감시 지표를 고른다",
    "지표마다 경보 기준과 데이터 범주(목적별 접근 권한·보존 기간)를 정한다",
    "기준을 추가 기록으로 남기고 운영 조직에 감시를 맡긴다"
   ],
   "checks": [
    "지표마다 경보 기준과 데이터 범주가 있다"
   ],
   "platform": {
    "actions": [
     "recordSafetyKpiPlan"
    ],
    "screens": [
     "/ops/safety-kpi"
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
   "id": "FPW.12-A03",
   "name": "중국 데이터 현지 처리·이전 심사",
   "trigger": "중국 시장 출시 또는 국외 조회 요청",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-TEL-005"
   ],
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
   "inputs": [
    "WP-KPI-PLAN"
   ],
   "outputs": [
    "WP-DATA-TRANSFER"
   ],
   "steps": [
    "텔레메트리·OTA 데이터 중 중요 데이터를 식별하고 현지 처리 위치를 정한다",
    "국외 이전(국외 조회 포함) 경로마다 안전 평가·표준 계약·인증 중 하나를 거친다",
    "심사 결과를 기록하고 운영 조직에 허용 경로를 알린다"
   ],
   "checks": [
    "모든 국외 이전 경로에 심사 방식과 결과가 있다"
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
   "next": []
  },
  {
   "id": "FPW.12-A04",
   "name": "EU 데이터 접근 요청 처리",
   "trigger": "EU 차량 사용자·제3자 데이터 접근 요청",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-TEL-006"
   ],
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
   "inputs": [
    "WP-KPI-PLAN"
   ],
   "outputs": [
    "WP-DATA-ACCESS"
   ],
   "steps": [
    "요청자와 대상 차량을 확인하고 Feature 상태·이력 데이터를 제공한다",
    "제3자 공유 요청이면 사용자 동의와 공유 절차를 확인한다",
    "OEM이 비개인 데이터를 쓰는 경우 법무가 검토한 이용 계약 근거 문서 ID를 등록한다"
   ],
   "checks": [
    "요청마다 제공 내용과 계약 근거가 기록되었다"
   ],
   "platform": {
    "actions": [
     "createDataAccessRequest",
     "recordDataActContractBasis"
    ],
    "screens": [
     "/admin/data"
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
   "id": "FPW.12-A02",
   "name": "평가 컨텍스트 개인정보 검토",
   "trigger": "정책 작성·변경으로 평가 컨텍스트가 바뀔 때",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-OFT-003"
   ],
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
   "inputs": [
    "WP-POLICY"
   ],
   "outputs": [
    "WP-CONTEXT-REVIEW"
   ],
   "steps": [
    "정책의 targeting key가 가명 차량 ID인지 확인한다",
    "위치·운전자 식별·연락처·차량 동적 상태가 평가 컨텍스트에 들어가지 않는지 검토한다",
    "금지 속성이 들어오면 평가 전에 거부되는지 시험 결과를 확인한다"
   ],
   "checks": [
    "금지 속성 거부 시험이 통과했다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/integration/openfeature"
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
   "id": "FPW.12-A05",
   "name": "보존 기간 경과 데이터 삭제",
   "trigger": "정기 보존 기간 점검",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [
    "FFG-TEL-008"
   ],
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
   "inputs": [
    "WP-KPI-PLAN"
   ],
   "outputs": [
    "WP-RETENTION-LOG"
   ],
   "steps": [
    "데이터 범주별 보존 기간이 지난 행을 찾는다",
    "열린 Incident·이상 건에 연결된 데이터는 삭제에서 제외한다",
    "삭제를 실행하고 범주별 삭제 기록을 남긴다"
   ],
   "checks": [
    "삭제 기록에 범주별 건수와 보류 사유가 있다"
   ],
   "platform": {
    "actions": [
     "retentionSweep"
    ],
    "screens": [
     "/admin/data"
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
   "id": "FPW.12-A06",
   "name": "처리 목적·근거 검토",
   "trigger": "새 처리 목적 또는 처리 범위 변경",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O6"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-DPO"
    ],
    "A": "R-DPO",
    "C": [
     "R-LEG",
     "R-CSM"
    ],
    "I": [
     "R-OPS"
    ]
   },
   "inputs": [],
   "outputs": [
    "WP-PRIVACY-REVIEW"
   ],
   "steps": [
    "수집·이용 목적과 최소 데이터 및 정보주체 범위를 식별한다",
    "동의 또는 적용 가능한 처리 근거의 원본과 보존·접근·이전 제한을 법무와 검토한다",
    "확정된 범위와 미확정 항목을 보안·운영 담당자에게 인계한다"
   ],
   "checks": [
    "화면 조회나 데모 값으로 동의 획득을 대신하지 않는다",
    "적용 시장과 실제 검토 근거를 식별한다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/admin/data"
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
    "FPW.12-A07"
   ]
  },
  {
   "id": "FPW.12-A07",
   "name": "정보주체 요청 접수",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-CSM"
    ],
    "A": "R-CSM",
    "C": [
     "R-DPO",
     "R-LEG"
    ],
    "I": [
     "R-QA"
    ]
   },
   "inputs": [
    "WP-PRIVACY-REVIEW"
   ],
   "outputs": [
    "WP-PRIVACY-REQ"
   ],
   "steps": [
    "요청 주체와 대상 사용자·차량 및 처리 목적을 확인한다",
    "개인정보 목록에서 대상 저장소와 예상 행 및 보존 예외를 확인한다",
    "내보내기 또는 삭제·가명화 요청과 사유를 기록하고 독립 실행자에게 인계한다"
   ],
   "checks": [
    "대상 식별자와 목적을 무단 확대하지 않는다",
    "요청 접수를 실제 삭제 완료로 표시하지 않는다"
   ],
   "platform": {
    "actions": [
     "createPrivacyRequest"
    ],
    "screens": [
     "/admin/data"
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
    "FPW.12-A08"
   ]
  },
  {
   "id": "FPW.12-A08",
   "name": "정보주체 독립 처리",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-CSM"
    ],
    "A": "R-CSM",
    "C": [
     "R-DPO"
    ],
    "I": [
     "R-QA"
    ]
   },
   "inputs": [
    "WP-PRIVACY-REQ"
   ],
   "outputs": [
    "WP-PRIVACY-RESULT"
   ],
   "steps": [
    "삭제·가명화 실행자는 요청자와 다른 사람인지 확인한다",
    "보존 예외와 목적을 검토하여 허용된 내보내기·실행 또는 사유 있는 거절을 수행한다",
    "처리 행·Lake 위임 상태와 감사 체인을 확인하고 미완료 항목을 인계한다"
   ],
   "checks": [
    "삭제·가명화 요청자 자기 실행이 차단된다",
    "Lake 요청 전송과 외부 삭제 완료를 구분한다"
   ],
   "platform": {
    "actions": [
     "privacyExport",
     "executePrivacyRequest",
     "rejectPrivacyRequest"
    ],
    "screens": [
     "/admin/data"
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
  "height": 670,
  "lanes": [
   {
    "role": "R-SM",
    "label": "Safety Manager",
    "x": 0,
    "y": 0,
    "w": 1086,
    "h": 98
   },
   {
    "role": "R-LEG",
    "label": "법무",
    "x": 0,
    "y": 98,
    "w": 1086,
    "h": 98
   },
   {
    "role": "R-REG",
    "label": "법규 담당",
    "x": 0,
    "y": 196,
    "w": 1086,
    "h": 188
   },
   {
    "role": "R-DPO",
    "label": "데이터 보호 담당",
    "x": 0,
    "y": 384,
    "w": 1086,
    "h": 188
   },
   {
    "role": "R-CSM",
    "label": "CSM",
    "x": 0,
    "y": 572,
    "w": 1086,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.12-A01",
    "kind": "action",
    "label": "운행 감시 지표·경보 기준 기록",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A03",
    "kind": "action",
    "label": "중국 데이터 현지 처리·이전 심사",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A04",
    "kind": "action",
    "label": "EU 데이터 접근 요청 처리",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A05",
    "kind": "action",
    "label": "보존 기간 경과 데이터 삭제",
    "x": 198,
    "y": 302,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A02",
    "kind": "action",
    "label": "평가 컨텍스트 개인정보 검토",
    "x": 198,
    "y": 400,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A06",
    "kind": "action",
    "label": "처리 목적·근거 검토",
    "x": 198,
    "y": 490,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A07",
    "kind": "action",
    "label": "정보주체 요청 접수",
    "x": 478,
    "y": 588,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A08",
    "kind": "action",
    "label": "정보주체 독립 처리",
    "x": 758,
    "y": 588,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S2",
    "kind": "start",
    "label": "중국 시장 출시 또는 국외 조회 요청",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S3",
    "kind": "start",
    "label": "EU 차량 사용자·제3자 데이터 접근 요청",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S4",
    "kind": "start",
    "label": "정책 작성·변경으로 평가 컨텍스트가 바뀔 때",
    "x": 146,
    "y": 424,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S5",
    "kind": "start",
    "label": "정기 보존 기간 점검",
    "x": 146,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S6",
    "kind": "start",
    "label": "새 처리 목적 또는 처리 범위 변경",
    "x": 146,
    "y": 514,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E4",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 424,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E5",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E6",
    "kind": "end",
    "label": "종료",
    "x": 960,
    "y": 612,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.12-S1",
    "to": "FPW.12-A01",
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
    "from": "FPW.12-S2",
    "to": "FPW.12-A03",
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
    "from": "FPW.12-S3",
    "to": "FPW.12-A04",
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
    "from": "FPW.12-S4",
    "to": "FPW.12-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      433
     ],
     [
      198,
      433
     ]
    ]
   },
   {
    "from": "FPW.12-S5",
    "to": "FPW.12-A05",
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
    "from": "FPW.12-S6",
    "to": "FPW.12-A06",
    "kind": "trigger",
    "points": [
     [
      164,
      523
     ],
     [
      198,
      523
     ]
    ]
   },
   {
    "from": "FPW.12-A06",
    "to": "FPW.12-A07",
    "kind": "flow",
    "points": [
     [
      386,
      523
     ],
     [
      466,
      523
     ],
     [
      466,
      621
     ],
     [
      478,
      621
     ]
    ]
   },
   {
    "from": "FPW.12-A07",
    "to": "FPW.12-A08",
    "kind": "flow",
    "points": [
     [
      666,
      621
     ],
     [
      758,
      621
     ]
    ]
   },
   {
    "from": "FPW.12-A01",
    "to": "FPW.12-E1",
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
    "from": "FPW.12-A03",
    "to": "FPW.12-E2",
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
    "from": "FPW.12-A04",
    "to": "FPW.12-E3",
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
    "from": "FPW.12-A02",
    "to": "FPW.12-E4",
    "kind": "end",
    "points": [
     [
      386,
      433
     ],
     [
      400,
      433
     ]
    ]
   },
   {
    "from": "FPW.12-A05",
    "to": "FPW.12-E5",
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
   },
   {
    "from": "FPW.12-A08",
    "to": "FPW.12-E6",
    "kind": "end",
    "points": [
     [
      946,
      621
     ],
     [
      960,
      621
     ]
    ]
   }
  ],
  "joins": []
 },
 "departmentLayout": {
  "width": 1086,
  "height": 670,
  "lanes": [
   {
    "department": "DEP-FS",
    "label": "기능안전팀",
    "x": 0,
    "y": 0,
    "w": 1086,
    "h": 98
   },
   {
    "department": "DEP-LEG",
    "label": "법무팀",
    "x": 0,
    "y": 98,
    "w": 1086,
    "h": 98
   },
   {
    "department": "DEP-HOM",
    "label": "법규인증팀",
    "x": 0,
    "y": 196,
    "w": 1086,
    "h": 188
   },
   {
    "department": "DEP-DPO",
    "label": "개인정보보호팀",
    "x": 0,
    "y": 384,
    "w": 1086,
    "h": 188
   },
   {
    "department": "DEP-CS",
    "label": "차량사이버보안팀",
    "x": 0,
    "y": 572,
    "w": 1086,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.12-A01",
    "kind": "action",
    "label": "운행 감시 지표·경보 기준 기록",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A03",
    "kind": "action",
    "label": "중국 데이터 현지 처리·이전 심사",
    "x": 198,
    "y": 114,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A04",
    "kind": "action",
    "label": "EU 데이터 접근 요청 처리",
    "x": 198,
    "y": 212,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A05",
    "kind": "action",
    "label": "보존 기간 경과 데이터 삭제",
    "x": 198,
    "y": 302,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A02",
    "kind": "action",
    "label": "평가 컨텍스트 개인정보 검토",
    "x": 198,
    "y": 400,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A06",
    "kind": "action",
    "label": "처리 목적·근거 검토",
    "x": 198,
    "y": 490,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A07",
    "kind": "action",
    "label": "정보주체 요청 접수",
    "x": 478,
    "y": 588,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-A08",
    "kind": "action",
    "label": "정보주체 독립 처리",
    "x": 758,
    "y": 588,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.12-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S2",
    "kind": "start",
    "label": "중국 시장 출시 또는 국외 조회 요청",
    "x": 146,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S3",
    "kind": "start",
    "label": "EU 차량 사용자·제3자 데이터 접근 요청",
    "x": 146,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S4",
    "kind": "start",
    "label": "정책 작성·변경으로 평가 컨텍스트가 바뀔 때",
    "x": 146,
    "y": 424,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S5",
    "kind": "start",
    "label": "정기 보존 기간 점검",
    "x": 146,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-S6",
    "kind": "start",
    "label": "새 처리 목적 또는 처리 범위 변경",
    "x": 146,
    "y": 514,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E1",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E2",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 138,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 236,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E4",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 424,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E5",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 326,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.12-E6",
    "kind": "end",
    "label": "종료",
    "x": 960,
    "y": 612,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.12-S1",
    "to": "FPW.12-A01",
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
    "from": "FPW.12-S2",
    "to": "FPW.12-A03",
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
    "from": "FPW.12-S3",
    "to": "FPW.12-A04",
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
    "from": "FPW.12-S4",
    "to": "FPW.12-A02",
    "kind": "trigger",
    "points": [
     [
      164,
      433
     ],
     [
      198,
      433
     ]
    ]
   },
   {
    "from": "FPW.12-S5",
    "to": "FPW.12-A05",
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
    "from": "FPW.12-S6",
    "to": "FPW.12-A06",
    "kind": "trigger",
    "points": [
     [
      164,
      523
     ],
     [
      198,
      523
     ]
    ]
   },
   {
    "from": "FPW.12-A06",
    "to": "FPW.12-A07",
    "kind": "flow",
    "points": [
     [
      386,
      523
     ],
     [
      466,
      523
     ],
     [
      466,
      621
     ],
     [
      478,
      621
     ]
    ]
   },
   {
    "from": "FPW.12-A07",
    "to": "FPW.12-A08",
    "kind": "flow",
    "points": [
     [
      666,
      621
     ],
     [
      758,
      621
     ]
    ]
   },
   {
    "from": "FPW.12-A01",
    "to": "FPW.12-E1",
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
    "from": "FPW.12-A03",
    "to": "FPW.12-E2",
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
    "from": "FPW.12-A04",
    "to": "FPW.12-E3",
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
    "from": "FPW.12-A02",
    "to": "FPW.12-E4",
    "kind": "end",
    "points": [
     [
      386,
      433
     ],
     [
      400,
      433
     ]
    ]
   },
   {
    "from": "FPW.12-A05",
    "to": "FPW.12-E5",
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
   },
   {
    "from": "FPW.12-A08",
    "to": "FPW.12-E6",
    "kind": "end",
    "points": [
     [
      946,
      621
     ],
     [
      960,
      621
     ]
    ]
   }
  ],
  "joins": []
 }
};

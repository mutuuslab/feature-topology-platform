// 생성 파일 — tools/workflow-sync.ts. 원천은 docs/65-workflows/model/*.yaml; 손으로 고치지 않는다.
import type { WorkflowProcess } from '../rules/workflows';
export const PROCESS: WorkflowProcess = {
 "id": "FPW.8",
 "name": "운영·긴급 차단·복원",
 "en": "Operation, Kill & Restore",
 "group": "생애주기",
 "gates": [
  "G8"
 ],
 "ref": "표준 보고서 7장(비활성화·복원), 8.x FFG-PLT-005·016, 14장 FFG-SEC-003·004, 6.1절 G8",
 "purpose": "출시된 Feature를 운행 중 감시하고, 이상 징후가 안전·보안·법규 위험으로 확인되면 2인 승인을 거친 긴급 차단을 발행해 차량별 적용을 확인한 뒤, 원인을 해소하고 다른 승인자의 승인으로 단계적으로 복원한다. 정책 복구가 필요하면 복구 기준·전 범위·독립 승인을 재검증하여 롤백하고 차량별 적용과 미회신을 추적한다.",
 "outcomes": [
  {
   "id": "O1",
   "text": "운행 중 이상 징후가 접수·확인되고 차단 필요성과 범위가 판단된다."
  },
  {
   "id": "O2",
   "text": "긴급 차단이 리콜·봉쇄 근거와 서로 다른 2인의 승인을 갖춰 발행된다."
  },
  {
   "id": "O3",
   "text": "차량별 차단 전달·적용이 추적되고 미적용 차량이 후속 조치로 넘어간다."
  },
  {
   "id": "O4",
   "text": "긴급 권한 사용이 24시간 안에 독립 검토된다."
  },
  {
   "id": "O5",
   "text": "원인 해소 뒤 차단 승인자와 다른 승인자의 승인으로 단계적으로 복원된다."
  },
  {
   "id": "O6",
   "text": "정기 드릴로 차단·복원 능력이 측정되고 G8 운영 판정이 남는다."
  },
  {
   "id": "O7",
   "text": "정책 롤백의 복구 기준·범위·독립 승인·실행 재검증과 차량별 적용·미회신 결과가 추적된다."
  }
 ],
 "basePractices": [
  {
   "id": "FPW.8.BP1",
   "name": "Flag 평가 이상 확인",
   "definition": "평가 오류·기본값 폴백·서명 이상을 식별하여 코드·배포·차량 회신과 대조한다. 원인·영향·조치를 기록하고 필요한 차단 또는 재배포 판단에 근거를 제공한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A12"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-FLAG-EVAL-INVESTIGATION",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP2",
   "name": "이상 징후 확인",
   "definition": "운행 관측·경보·VOC에서 이상 징후와 영향 기능·차량을 식별한다. 데이터 신선도와 사실의 범위를 확인하고 조사·조치·효과 확인 또는 기각의 근거와 책임을 추적한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A01"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-ANOMALY-CASE",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP3",
   "name": "차단 필요성·범위 판단",
   "definition": "이상 징후의 사유와 설계된 종료 동작에 따라 차단 필요성과 유효 범위를 판단한다. 누적 상한·대량 종료 계획과 게이트 결과를 확인하여 승인에 필요한 차단 계획을 마련한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A02"
   ],
   "outcomes": [
    "O1"
   ],
   "evidence": [
    {
     "workProduct": "WP-KILL-PLAN",
     "outcomes": [
      "O1"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP4",
   "name": "리콜·봉쇄 근거 연계",
   "definition": "안전 차단의 근거가 되는 리콜·봉쇄 결정과 시장별 보고 책임·기한을 확인한다. 검증 가능한 근거 ID를 요청 담당자에게 전달하고 불충분한 근거는 보완하도록 한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A03"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-RECALL-BASIS",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP5",
   "name": "긴급 차단 요청",
   "definition": "확정한 대상·사유·범위와 리콜 또는 봉쇄 근거를 갖추어 긴급 차단을 요청한다. 명시적 확인과 요청·승인자 분리를 유지하며 승인 대기 결과를 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A04"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-KILL-REQ",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP6",
   "name": "긴급 차단 2인 승인",
   "definition": "필요한 역할의 서로 다른 승인자가 차단의 근거·범위·상한을 독립적으로 검토한다. 개인 서명을 수집하고 최종 게이트와 발행 명령을 확인하여 승인과 발행의 연결을 보존한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A05"
   ],
   "outcomes": [
    "O2"
   ],
   "evidence": [
    {
     "workProduct": "WP-KILL-DECISION",
     "outcomes": [
      "O2"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP7",
   "name": "긴급 권한 사후 검토",
   "definition": "긴급 권한 사용의 사유·범위·절차 준수를 요청·승인에 참여하지 않은 검토자가 기한 내 확인한다. 개선 항목과 책임을 한 번의 독립 검토 기록으로 보존한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A07"
   ],
   "outcomes": [
    "O4"
   ],
   "evidence": [
    {
     "workProduct": "WP-POST-REVIEW",
     "outcomes": [
      "O4"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP8",
   "name": "차단 전달·적용 추적",
   "definition": "게시 명령의 전달과 실제 차량 적용을 유효한 보고 근거로 구분하여 추적한다. 기한 초과·불일치 차량을 식별하고 연결된 이상 건과 상위 대응 결정을 관리한다.",
   "notes": [
    "전송 수락이나 OTA 전달 통보만으로 차량의 적용 완료를 선언하지 않는다."
   ],
   "activityIds": [
    "FPW.8-A06"
   ],
   "outcomes": [
    "O3"
   ],
   "evidence": [
    {
     "workProduct": "WP-KILL-TRACE",
     "outcomes": [
      "O3"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP9",
   "name": "원인 조치·복원 요청",
   "definition": "원인을 조치하고 재검증 근거를 확보한 뒤 차단 해제 범위와 관측 단계를 요청한다. 이전 차단 승인자와의 분리를 유지하고 복원 승인에 필요한 근거와 Cohort를 명시한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A08"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-RESTORE-REQ",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP10",
   "name": "복원 2인 승인",
   "definition": "직전 차단 승인에 참여하지 않은 승인자들이 복원 근거·범위·재검증을 독립적으로 검토한다. 요구되는 서명과 게이트를 만족한 복원 게시본을 확인하고 판단을 보존한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A09"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-RESTORE-DECISION",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP11",
   "name": "단계적 복원·관측",
   "definition": "승인 범위의 차단 해제를 Canary부터 적용하고 회신과 관측 결과를 확인한다. 정상 활성화는 차량 자체 시험·ODD·Guard의 별도 조건에 따르며 관측 기준을 만족할 때만 복원 범위를 넓힌다.",
   "notes": [
    "복원 명령의 차단 해제(INACTIVE)는 기능을 즉시 ACTIVE로 만드는 명령이 아니다."
   ],
   "activityIds": [
    "FPW.8-A10"
   ],
   "outcomes": [
    "O5"
   ],
   "evidence": [
    {
     "workProduct": "WP-RESTORE-ROLLOUT",
     "outcomes": [
      "O5"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP12",
   "name": "분기 드릴·G8 운영 판정",
   "definition": "시험 범위에서 차단·복원 드릴을 수행하여 전달·적용·보고의 정확성을 확인한다. 분기 운영 근거와 독립 검토 의견을 모아 개선 사항과 운영 판정을 기록한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A11"
   ],
   "outcomes": [
    "O6"
   ],
   "evidence": [
    {
     "workProduct": "WP-DRILL-REPORT",
     "outcomes": [
      "O6"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP13",
   "name": "정책 롤백 요청·계획",
   "definition": "현재 배포와 복구 기준 정책을 식별하고 대상 전 범위·조건·승인대상자를 가진 롤백 요청 또는 계획을 작성한다. 긴급 차단 해제와 정책 버전 복구를 구분하며 SW 바이너리 롤백을 임의 실행하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A13"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-RBK-REQ",
     "outcomes": [
      "O7"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP14",
   "name": "정책 롤백 독립 승인",
   "definition": "요청자와 다른 지정 승인대상자가 복구 기준·범위·조건을 검토하여 승인 또는 반려한다. 조직 역할의 참여만으로 승인되지 않으며 해당 요청의 실제 승인 이력을 확인한다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A14"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-RBK-DEC",
     "outcomes": [
      "O7"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP15",
   "name": "롤백 재검증·실행",
   "definition": "승인된 수동 요청을 실행하거나 승인된 자동 계획의 조건 충족 실행을 확인한다. 실행 직전의 현재 배포·검증·운영 승인·서명과 적용 가능성을 재확인하고 새 서명 게시본을 원본 배포에 연결한다.",
   "notes": [
    "자동 실행은 기존 서버의 승인 계획·조건 판정 경로에 따른다. 업무 체크를 완료해도 자동 롤백이 발생하지 않는다."
   ],
   "activityIds": [
    "FPW.8-A15"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-RBK-EXEC",
     "outcomes": [
      "O7"
     ]
    }
   ]
  },
  {
   "id": "FPW.8.BP16",
   "name": "롤백 적용·미회신 확인",
   "definition": "새 롤백 게시본의 동일 대상 집합을 기준으로 전달과 실제 적용을 구분해 추적한다. 거부·미회신·기한초과는 재시도 및 미해결 위험으로 남기고 운영 화면의 성공 표지만으로 종결하지 않는다.",
   "notes": [],
   "activityIds": [
    "FPW.8-A16"
   ],
   "outcomes": [
    "O7"
   ],
   "evidence": [
    {
     "workProduct": "WP-RBK-CLOSE",
     "outcomes": [
      "O7"
     ]
    }
   ]
  }
 ],
 "rules": [
  "FFG-TEL-009",
  "FFG-ADS-011",
  "FFG-SEC-003",
  "FFG-DEAC-010",
  "FFG-PLT-005",
  "FFG-SEC-004",
  "FFG-DEAC-013",
  "FFG-PLT-016",
  "FFG-DEAC-008",
  "FFG-LCY-009",
  "FFG-DEAC-012"
 ],
 "entry": [
  "Feature Version이 RELEASED이고 운행 중 감시 지표와 경보 기준이 등록되어 있다",
  "차단·복원 승인 후보자의 개인 서명 수단이 발급되어 있다"
 ],
 "exit": [
  "발행한 차단마다 차량별 적용 결과·사후 검토·복원 또는 유지 결정이 기록되었다",
  "분기 드릴 결과와 G8 운영 판정이 남았다"
 ],
 "workProducts": [
  {
   "key": "WP-ANOMALY-CASE",
   "name": "이상 징후 건",
   "en": "Anomaly Case",
   "kind": "output",
   "retained": false,
   "content": [
    "이상 징후 출처(운행 지표·장애·VOC·SOTIF 트리거)와 대상 Feature Version",
    "영향 차량 수·지역·Variant와 확인 결과"
   ]
  },
  {
   "key": "WP-KILL-PLAN",
   "name": "차단 판단서",
   "en": "Kill Decision Basis",
   "kind": "output",
   "retained": false,
   "content": [
    "사유 분류(SAFETY·SECURITY·REGULATORY·COMMERCIAL·OPERATIONAL)와 유효 등급",
    "대상 범위와 24시간 누적 상한 대조 결과",
    "대량 원격 종료 계획(단계·순서) 적용 여부"
   ]
  },
  {
   "key": "WP-RECALL-BASIS",
   "name": "리콜·봉쇄 근거",
   "en": "Recall / Containment Basis",
   "kind": "output",
   "retained": false,
   "content": [
    "리콜 번호 또는 봉쇄 결정 근거와 시장",
    "시장별 보고 기한과 보고 책임자"
   ]
  },
  {
   "key": "WP-KILL-REQ",
   "name": "긴급 차단 요청",
   "en": "Kill Request",
   "kind": "output",
   "retained": false,
   "content": [
    "대상 Feature Version·차량 범위·사유 분류와 리콜·봉쇄 근거 참조",
    "요청자와 요청 시각"
   ]
  },
  {
   "key": "WP-KILL-DECISION",
   "name": "차단 승인 기록",
   "en": "Kill Approval Record",
   "kind": "output",
   "retained": false,
   "content": [
    "서로 다른 승인자 2명의 개인 서명과 역할",
    "게이트 판정(등급·대상 상한) 결과와 발행 명령 ID"
   ]
  },
  {
   "key": "WP-KILL-TRACE",
   "name": "차단 적용 추적표",
   "en": "Kill Delivery Trace",
   "kind": "output",
   "retained": false,
   "content": [
    "차량별 전달·적용 상태(유효한 상태 보고와 영속 저장 확인 기준)",
    "기한 초과 미적용 차량과 연결된 이상 징후 건",
    "대기 상한 초과 경보와 상위 대응 기록"
   ]
  },
  {
   "key": "WP-POST-REVIEW",
   "name": "긴급 권한 사후 검토 기록",
   "en": "Emergency Use Post Review",
   "kind": "output",
   "retained": false,
   "content": [
    "검토자(요청자·승인자 제외)와 검토 시각(24시간 이내)",
    "사유·범위·절차 준수 판단과 개선 조치"
   ]
  },
  {
   "key": "WP-RESTORE-REQ",
   "name": "복원 요청",
   "en": "Restore Request",
   "kind": "output",
   "retained": false,
   "content": [
    "원인 분석·수정 내용과 재검증 Evidence 참조",
    "복원 대상 범위와 Canary Cohort"
   ]
  },
  {
   "key": "WP-RESTORE-DECISION",
   "name": "복원 승인 기록",
   "en": "Restore Approval Record",
   "kind": "output",
   "retained": false,
   "content": [
    "차단 승인자와 겹치지 않는 승인자 2명의 개인 서명",
    "게이트 판정과 복원 게시 ID"
   ]
  },
  {
   "key": "WP-RESTORE-ROLLOUT",
   "name": "단계적 복원 관측 기록",
   "en": "Staged Restore Record",
   "kind": "output",
   "retained": false,
   "content": [
    "Cohort 단계별 확대 시각과 관측 결과",
    "중단 기준 충족 여부와 재차단 여부"
   ]
  },
  {
   "key": "WP-DRILL-REPORT",
   "name": "드릴 결과·G8 판정",
   "en": "Drill Report & G8 Decision",
   "kind": "output",
   "retained": false,
   "content": [
    "시험 Cohort의 전달 시간·적용률·보고 정확도",
    "분기 운영 점검 결과와 G8 판정 서명"
   ]
  },
  {
   "key": "WP-FLAG-EVAL-INVESTIGATION",
   "name": "Flag 평가 이상 조사 기록",
   "en": "Flag 평가 이상 조사 기록",
   "kind": "output",
   "retained": true,
   "content": [
    "영향 Flag·Version·차량과 관측 기간",
    "폴백·서명·평가 오류와 대조한 게시본·회신",
    "원인·조치·차단 또는 재배포 인계"
   ]
  },
  {
   "key": "WP-RBK-REQ",
   "name": "정책 롤백 요청·계획",
   "en": "Policy Rollback Request and Plan",
   "kind": "output",
   "retained": false,
   "content": [
    "현재 배포 ID·복구 정책 버전·전 범위·수동 사유 또는 자동 조건",
    "미리보기 검증과 지정 승인대상자"
   ]
  },
  {
   "key": "WP-RBK-DEC",
   "name": "정책 롤백 승인 기록",
   "en": "Policy Rollback Decision",
   "kind": "output",
   "retained": false,
   "content": [
    "지정 승인대상자와 요청자 분리",
    "승인/반려 사유·범위·복구 기준 및 판정 시각"
   ]
  },
  {
   "key": "WP-RBK-EXEC",
   "name": "정책 롤백 실행 추적",
   "en": "Policy Rollback Execution",
   "kind": "output",
   "retained": false,
   "content": [
    "실행 직전 재검증·실행자·현재 배포 변화 확인",
    "새 서명 게시본 ID·전송·실패 및 원본 배포 연결"
   ]
  },
  {
   "key": "WP-RBK-CLOSE",
   "name": "정책 롤백 적용 확인",
   "en": "Policy Rollback Application Review",
   "kind": "output",
   "retained": true,
   "content": [
    "대상 분모·차량별 ACK/READBACK·적용·거부·미회신",
    "재시도·기한초과·완료 또는 미해결 인계 근거"
   ]
  }
 ],
 "activities": [
  {
   "id": "FPW.8-A12",
   "name": "Flag 평가 이상 확인",
   "trigger": "평가 모니터링에서 기본값 폴백·서명 오류가 늘어난다",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-OPS",
    "C": [
     "R-INT"
    ],
    "I": [
     "R-FO"
    ]
   },
   "inputs": [],
   "outputs": [
    "WP-FLAG-EVAL-INVESTIGATION"
   ],
   "steps": [
    "평가 모니터링에서 기본값 폴백·서명 오류·오류 수가 늘어난 Flag를 찾는다",
    "차량 회신과 게시본을 대조해 원인이 배포·서명·차량 중 어디인지 가른다",
    "필요하면 긴급 차단 또는 재배포 절차로 넘긴다"
   ],
   "checks": [
    "폴백 급증 Flag마다 원인과 조치가 기록됐다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/ops/flag-evaluations"
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
    "FPW.8-A01"
   ]
  },
  {
   "id": "FPW.8-A01",
   "name": "이상 징후 확인",
   "trigger": "운행 감시 경보, 장애·VOC 접수, SOTIF 트리거 발견",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-TEL-009"
   ],
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
   "inputs": [
    "WP-G7-DECISION",
    "WP-ROLLOUT-RECORD",
    "WP-KPI-PLAN",
    "WP-G5-EVIDENCE"
   ],
   "outputs": [
    "WP-ANOMALY-CASE"
   ],
   "steps": [
    "운행 중 감시 지표와 장애·VOC를 확인해 이상 징후 건을 연다",
    "대상 Feature Version과 영향 차량 범위를 Fleet 적용 현황에서 확인한다",
    "안전·보안 영향이 의심되면 즉시 Safety Manager(보안은 CSM)에게 넘긴다",
    "확인 결과 이상이 아니면 사유를 남기고 이상 건을 기각한다",
    "운영 점검(동작·문제·개선·위험 4축)의 조치 필요 점검 결과를 확인하고 조치 연결·효과 확인까지 이어 간다",
    "Data Lake 지표가 신선도 기준을 넘으면 그 지표로 판단하지 않고 데이터 계약·수집 정책을 확인한다"
   ],
   "checks": [
    "이상 징후 건에 출처·대상 Version·영향 범위가 기록되었다",
    "기한이 지난 조치 필요 점검 결과가 담당자 검토함에 있다"
   ],
   "platform": {
    "actions": [
     "acknowledgeAnomaly",
     "dismissAnomaly",
     "createIncident"
    ],
    "screens": [
     "/ops/anomalies",
     "/ops/safety-kpi",
     "/ops/incidents",
     "/ops/incident-reports/:id",
     "/ops/feature-health",
     "/ops/feature-health/:findingId",
     "/ops/collection",
     "/integration/datalake"
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
    "FPW.8-A02"
   ]
  },
  {
   "id": "FPW.8-A02",
   "name": "차단 필요성·범위 판단",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O1"
   ],
   "rules": [
    "FFG-ADS-011",
    "FFG-SEC-003"
   ],
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
   "inputs": [
    "WP-ANOMALY-CASE",
    "WP-SAFETY-PROFILE",
    "WP-VEX-DECISION"
   ],
   "outputs": [
    "WP-KILL-PLAN"
   ],
   "steps": [
    "사유를 분류하고 Feature의 설계 비활성화 등급에서 유효 등급을 정한다",
    "대상 범위를 24시간 누적 상한과 대조하고, 넘으면 CSM 추가 승인과 단계적 실행을 계획한다",
    "ADS 기능이나 대량 대상이면 대량 원격 종료 계획에 따라 단계와 순서를 정한다",
    "게이트 미리보기로 요청이 판정을 통과할지 확인한다"
   ],
   "checks": [
    "사유 분류·유효 등급·범위·누적 상한 대조가 차단 판단서에 있다"
   ],
   "platform": {
    "actions": [
     "gatePreview"
    ],
    "screens": [
     "/ops/kill"
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
    "FPW.8-A03"
   ]
  },
  {
   "id": "FPW.8-A03",
   "name": "리콜·봉쇄 근거 연계",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-DEAC-010"
   ],
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
   "inputs": [
    "WP-KILL-PLAN"
   ],
   "outputs": [
    "WP-RECALL-BASIS"
   ],
   "steps": [
    "결함을 완화하는 F2 이상 안전 차단이면 시장별 리콜 번호나 봉쇄 결정 근거를 확보한다",
    "시장별 보고 기한을 정하고 보고 책임자를 지정한다",
    "근거 ID를 운영 조직에 넘겨 차단 요청에 붙이게 한다"
   ],
   "checks": [
    "안전 차단 요청에 붙일 리콜·봉쇄 근거 ID가 있다(근거가 없으면 게이트가 차단한다)"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/ops/incident-reports"
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
    "FPW.8-A04"
   ]
  },
  {
   "id": "FPW.8-A04",
   "name": "긴급 차단 요청",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-PLT-005"
   ],
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
   "inputs": [
    "WP-KILL-PLAN",
    "WP-RECALL-BASIS"
   ],
   "outputs": [
    "WP-KILL-REQ"
   ],
   "steps": [
    "긴급 차단 화면에서 대상·범위·사유를 입력하고 확인 문구를 직접 입력해 요청한다",
    "리콜·봉쇄 근거 ID를 요청에 붙인다",
    "요청자는 같은 명령의 승인자로 지정하지 않는다"
   ],
   "checks": [
    "요청이 접수되어 승인 대기 상태가 되었다"
   ],
   "platform": {
    "actions": [
     "issueKill"
    ],
    "screens": [
     "/ops/kill"
    ],
    "gates": [],
    "anchor": "kill-request",
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 2,
   "next": [
    "FPW.8-A05"
   ]
  },
  {
   "id": "FPW.8-A05",
   "name": "긴급 차단 2인 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O2"
   ],
   "rules": [
    "FFG-PLT-005",
    "FFG-SEC-003"
   ],
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
   "inputs": [
    "WP-KILL-REQ",
    "WP-KILL-PLAN"
   ],
   "outputs": [
    "WP-KILL-DECISION"
   ],
   "steps": [
    "승인자 2명이 각자 개인 서명으로 승인한다. F2 이상 안전·보안 차단에는 Safety Manager가 반드시 포함된다",
    "누적 상한을 넘는 요청이면 Safety Manager와 CSM이 함께 승인한다",
    "두 번째 승인 뒤 게이트 판정 결과와 발행 명령 ID를 확인한다"
   ],
   "checks": [
    "서로 다른 2명의 승인 서명이 있고 요청자는 승인자에 없다"
   ],
   "platform": {
    "actions": [
     "approveKill",
     "rejectKill"
    ],
    "screens": [
     "/ops/kill"
    ],
    "gates": [],
    "anchor": "kill-approve",
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 2,
   "next": [
    "FPW.8-A06",
    "FPW.8-A07"
   ]
  },
  {
   "id": "FPW.8-A07",
   "name": "긴급 권한 사후 검토",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O4"
   ],
   "rules": [
    "FFG-PLT-016"
   ],
   "raci": {
    "R": [
     "R-QA"
    ],
    "A": "R-QA",
    "C": [
     "R-CSM",
     "R-REG"
    ],
    "I": [
     "R-SM",
     "R-OPS"
    ]
   },
   "inputs": [
    "WP-KILL-REQ",
    "WP-KILL-DECISION"
   ],
   "outputs": [
    "WP-POST-REVIEW"
   ],
   "steps": [
    "차단 발행 후 24시간 안에 요청자·승인자가 아닌 검토자가 사유·범위·절차 준수를 검토한다",
    "검토 결과와 개선 조치를 사후 검토 기록으로 한 번 남긴다",
    "미흡 사항은 품질 조직이 개선 과제로 등록한다"
   ],
   "checks": [
    "검토 기록이 24시간 안에 있고 검토자가 요청자·승인자와 다르다"
   ],
   "platform": {
    "actions": [
     "recordKillPostReview"
    ],
    "screens": [
     "/audit/oversight"
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
   "id": "FPW.8-A06",
   "name": "차단 전달·적용 추적",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O3"
   ],
   "rules": [
    "FFG-SEC-004",
    "FFG-DEAC-013"
   ],
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
   "inputs": [
    "WP-KILL-DECISION"
   ],
   "outputs": [
    "WP-KILL-TRACE"
   ],
   "steps": [
    "차량별 전달·적용 상태를 유효한 상태 보고와 영속 저장 확인으로만 '적용'으로 본다",
    "기한 안에 적용되지 않은 차량은 이상 징후 건으로 넘긴다",
    "대기 상한 초과 경보가 오면 Safety Manager가 상위 대응을 정한다"
   ],
   "checks": [
    "기한 초과 미적용 차량마다 연결된 이상 징후 건이 있다"
   ],
   "platform": {
    "actions": [
     "acknowledgeAnomaly"
    ],
    "screens": [
     "/fleet/live",
     "/deployments"
    ],
    "gates": [],
    "anchor": "vehicle-status-v2",
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 4,
   "next": [
    "FPW.8-A08"
   ]
  },
  {
   "id": "FPW.8-A08",
   "name": "원인 조치·복원 요청",
   "trigger": "원인 수정과 재검증 Evidence 확보",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [
    "FFG-DEAC-008"
   ],
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-OPS",
    "C": [
     "R-SM",
     "R-FO",
     "R-TST"
    ],
    "I": [
     "R-REG"
    ]
   },
   "inputs": [
    "WP-KILL-TRACE",
    "WP-G5-EVIDENCE"
   ],
   "outputs": [
    "WP-RESTORE-REQ"
   ],
   "steps": [
    "원인 분석과 수정(정책·SW·운행 조건 축소)을 마치고 재검증 Evidence가 G5 근거로 제출되었는지 확인한다",
    "복원 범위와 시작 Canary Cohort를 정해 복원을 요청한다",
    "직전 차단 승인자를 복원 승인 후보에서 뺀다"
   ],
   "checks": [
    "복원 요청에 재검증 Evidence 참조와 Canary Cohort가 있다"
   ],
   "platform": {
    "actions": [
     "requestRestore"
    ],
    "screens": [
     "/ops/kill"
    ],
    "gates": [],
    "anchor": "kill-restore",
    "ui": {
     "fields": [],
     "buttons": [
      "requestRestore"
     ]
    }
   },
   "slaHours": 4,
   "next": [
    "FPW.8-A09"
   ]
  },
  {
   "id": "FPW.8-A09",
   "name": "복원 2인 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [
    "FFG-DEAC-008",
    "FFG-PLT-005"
   ],
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
   "inputs": [
    "WP-RESTORE-REQ",
    "WP-KILL-DECISION"
   ],
   "outputs": [
    "WP-RESTORE-DECISION"
   ],
   "steps": [
    "직전 차단을 승인하지 않은 승인자 2명이 개인 서명으로 승인한다. F2 이상은 Safety Manager가 포함된다",
    "플랫폼 감사 원장이 차단 승인자와의 중복을 판정하므로 거부되면 다른 승인자로 다시 승인한다",
    "두 번째 승인 뒤 게이트 판정과 복원 게시 ID를 확인한다"
   ],
   "checks": [
    "복원 승인자 중 직전 차단 승인자가 없다"
   ],
   "platform": {
    "actions": [
     "approveRestore",
     "rejectRestore"
    ],
    "screens": [
     "/ops/kill"
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
    "FPW.8-A10"
   ]
  },
  {
   "id": "FPW.8-A10",
   "name": "단계적 복원·관측",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O5"
   ],
   "rules": [
    "FFG-LCY-009"
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
    "WP-RESTORE-DECISION"
   ],
   "outputs": [
    "WP-RESTORE-ROLLOUT"
   ],
   "steps": [
    "Canary Cohort부터 차단 해제를 적용하고 차량이 INACTIVE 상태로 복귀했는지 확인한다. 재활성화는 정상 활성화 Guard·ODD·자체 시험 조건을 별도로 확인한다",
    "사전에 정한 관측 기간 동안 중단 기준을 감시하고 만족할 때만 다음 Cohort로 넓힌다",
    "이상이 보이면 확대를 멈추고 다시 차단 판단(A02)으로 넘긴다"
   ],
   "checks": [
    "단계마다 관측 결과와 확대·중단 결정이 기록되었다"
   ],
   "platform": {
    "actions": [
     "stageRollout"
    ],
    "screens": [
     "/fleet/live"
    ],
    "gates": [],
    "anchor": "vehicle-status-v2",
    "ui": {
     "fields": [],
     "buttons": []
    }
   },
   "slaHours": 24,
   "next": []
  },
  {
   "id": "FPW.8-A11",
   "name": "분기 드릴·G8 운영 판정",
   "trigger": "분기 정기 일정",
   "gateDecision": "G8",
   "independentOf": [],
   "outcomes": [
    "O6"
   ],
   "rules": [
    "FFG-DEAC-012"
   ],
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
   "inputs": [
    "WP-KILL-TRACE",
    "WP-POST-REVIEW"
   ],
   "outputs": [
    "WP-DRILL-REPORT"
   ],
   "steps": [
    "시험 Cohort로 차단·복원 드릴을 수행해 전달 시간·적용률·보고 정확도를 잰다",
    "분기 차단 건의 추적표·사후 검토 결과와 드릴 결과를 묶어 운영 상태를 점검한다",
    "Safety Manager·품질 조직의 의견을 받아 G8 운영 판정을 남긴다"
   ],
   "checks": [
    "분기마다 드릴 결과와 G8 판정이 있다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/ops/kill",
     "/audit"
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
   "id": "FPW.8-A13",
   "name": "정책 롤백 요청·계획",
   "trigger": "정책 복구 필요 또는 자동 복구 계획 수립",
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-OPS",
    "C": [
     "R-REL",
     "R-SM"
    ],
    "I": [
     "R-QA"
    ]
   },
   "inputs": [],
   "outputs": [
    "WP-RBK-REQ"
   ],
   "steps": [
    "현재 배포 ID와 같은 flag의 이전 배포 정책 및 복구 가능 근거를 확인한다",
    "전 대상 범위와 사유 또는 자동 조건을 정해 미리보기를 검증한다",
    "지정 승인대상자를 넣어 요청 또는 계획을 만들고 기준 배포를 고정한다"
   ],
   "checks": [
    "현재 배포가 바뀌면 낡은 요청으로 실행하지 않는다",
    "정책 전 범위를 덮지 못하거나 SW 버전 실행 위임이 미확정이면 보류한다"
   ],
   "platform": {
    "actions": [
     "previewRollback",
     "createRollbackRequest",
     "createRollbackPlan"
    ],
    "screens": [
     "/ops/rollback",
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
    "FPW.8-A14"
   ]
  },
  {
   "id": "FPW.8-A14",
   "name": "정책 롤백 독립 승인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-SM"
    ],
    "A": "R-SM",
    "C": [
     "R-REL"
    ],
    "I": [
     "R-OPS",
     "R-QA"
    ]
   },
   "inputs": [
    "WP-RBK-REQ"
   ],
   "outputs": [
    "WP-RBK-DEC"
   ],
   "steps": [
    "자신이 지정 승인대상자이며 요청자와 다른 사람인지 확인한다",
    "복구 기준·적용 범위·조건과 안전 영향을 검토한다",
    "사유를 남겨 승인 또는 반려하고 후속 실행자에게 결과를 알린다"
   ],
   "checks": [
    "요청자 자기 승인과 지정되지 않은 사람의 승인이 차단된다",
    "자동 계획 승인도 승인된 조건·범위를 넘지 않는다"
   ],
   "platform": {
    "actions": [
     "decideRollbackRequest",
     "decideRollbackPlan"
    ],
    "screens": [
     "/ops/rollback"
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
    "FPW.8-A15"
   ]
  },
  {
   "id": "FPW.8-A15",
   "name": "롤백 재검증·실행",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-OPS",
    "C": [
     "R-REL",
     "R-SM"
    ],
    "I": [
     "R-QA"
    ]
   },
   "inputs": [
    "WP-RBK-DEC"
   ],
   "outputs": [
    "WP-RBK-EXEC"
   ],
   "steps": [
    "승인된 요청 또는 계획과 현재 배포의 일치 여부를 확인한다",
    "복구 기준의 검증·운영 승인·서명·현재 적용 가능성을 다시 확인한다",
    "허용된 실행을 수행하고 새 게시본 및 실행 이력을 연결한다"
   ],
   "checks": [
    "승인 후 상태·키·기준이 달라지면 재검증에서 차단된다",
    "실행 응답을 차량 적용 완료로 간주하지 않는다"
   ],
   "platform": {
    "actions": [
     "executeRollbackRequest"
    ],
    "screens": [
     "/ops/rollback",
     "/deployments/:id"
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
    "FPW.8-A16"
   ]
  },
  {
   "id": "FPW.8-A16",
   "name": "롤백 적용·미회신 확인",
   "trigger": null,
   "gateDecision": null,
   "independentOf": [],
   "outcomes": [
    "O7"
   ],
   "rules": [],
   "raci": {
    "R": [
     "R-OPS"
    ],
    "A": "R-OPS",
    "C": [
     "R-REL"
    ],
    "I": [
     "R-SM",
     "R-QA"
    ]
   },
   "inputs": [
    "WP-RBK-EXEC"
   ],
   "outputs": [
    "WP-RBK-CLOSE"
   ],
   "steps": [
    "현재 롤백 게시본과 대상 차량 분모를 고정한다",
    "차량별 수신·적용·거부·기한초과를 확인하고 허용된 재시도를 수행한다",
    "모든 적용 완료 또는 미해결 차량·위험·담당자를 기록해 인계한다"
   ],
   "checks": [
    "수신 ACK와 적용 READBACK을 구분한다",
    "누락 데이터는 대상 0 또는 성공으로 표시하지 않는다"
   ],
   "platform": {
    "actions": [],
    "screens": [
     "/ops/rollback",
     "/deployments/:id",
     "/fleet/vehicles/:vin"
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
  "width": 3046,
  "height": 662,
  "lanes": [
   {
    "role": "R-OPS",
    "label": "운영 조직",
    "x": 0,
    "y": 0,
    "w": 3046,
    "h": 368
   },
   {
    "role": "R-SM",
    "label": "Safety Manager",
    "x": 0,
    "y": 368,
    "w": 3046,
    "h": 98
   },
   {
    "role": "R-REG",
    "label": "법규 담당",
    "x": 0,
    "y": 466,
    "w": 3046,
    "h": 98
   },
   {
    "role": "R-QA",
    "label": "품질 조직",
    "x": 0,
    "y": 564,
    "w": 3046,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.8-A12",
    "kind": "action",
    "label": "Flag 평가 이상 확인",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A01",
    "kind": "action",
    "label": "이상 징후 확인",
    "x": 478,
    "y": 106,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A04",
    "kind": "action",
    "label": "긴급 차단 요청",
    "x": 1318,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A06",
    "kind": "action",
    "label": "차단 전달·적용 추적",
    "x": 1878,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A08",
    "kind": "action",
    "label": "원인 조치·복원 요청",
    "x": 2158,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A10",
    "kind": "action",
    "label": "단계적 복원·관측",
    "x": 2718,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A11",
    "kind": "action",
    "label": "분기 드릴·G8 운영 판정",
    "x": 198,
    "y": 196,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A13",
    "kind": "action",
    "label": "정책 롤백 요청·계획",
    "x": 198,
    "y": 286,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A15",
    "kind": "action",
    "label": "롤백 재검증·실행",
    "x": 758,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A16",
    "kind": "action",
    "label": "롤백 적용·미회신 확인",
    "x": 1038,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A02",
    "kind": "action",
    "label": "차단 필요성·범위 판단",
    "x": 758,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A05",
    "kind": "action",
    "label": "긴급 차단 2인 승인",
    "x": 1598,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A09",
    "kind": "action",
    "label": "복원 2인 승인",
    "x": 2438,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A14",
    "kind": "action",
    "label": "정책 롤백 독립 승인",
    "x": 478,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A03",
    "kind": "action",
    "label": "리콜·봉쇄 근거 연계",
    "x": 1038,
    "y": 482,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A07",
    "kind": "action",
    "label": "긴급 권한 사후 검토",
    "x": 1878,
    "y": 580,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S2",
    "kind": "start",
    "label": "운행 감시 경보, 장애·VOC 접수, SOTIF 트리거 발견",
    "x": 426,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S3",
    "kind": "start",
    "label": "분기 정기 일정",
    "x": 146,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S4",
    "kind": "start",
    "label": "정책 복구 필요 또는 자동 복구 계획 수립",
    "x": 146,
    "y": 310,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E1",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 604,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E2",
    "kind": "end",
    "label": "종료",
    "x": 2920,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E4",
    "kind": "end",
    "label": "종료",
    "x": 1240,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.8-S1",
    "to": "FPW.8-A12",
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
    "from": "FPW.8-S2",
    "to": "FPW.8-A01",
    "kind": "trigger",
    "points": [
     [
      444,
      139
     ],
     [
      478,
      139
     ]
    ]
   },
   {
    "from": "FPW.8-S3",
    "to": "FPW.8-A11",
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
    "from": "FPW.8-S4",
    "to": "FPW.8-A13",
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
    "from": "FPW.8-A12",
    "to": "FPW.8-A01",
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
      139
     ],
     [
      478,
      139
     ]
    ]
   },
   {
    "from": "FPW.8-A01",
    "to": "FPW.8-A02",
    "kind": "flow",
    "points": [
     [
      666,
      139
     ],
     [
      746,
      139
     ],
     [
      746,
      417
     ],
     [
      758,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A02",
    "to": "FPW.8-A03",
    "kind": "flow",
    "points": [
     [
      946,
      417
     ],
     [
      1026,
      417
     ],
     [
      1026,
      515
     ],
     [
      1038,
      515
     ]
    ]
   },
   {
    "from": "FPW.8-A03",
    "to": "FPW.8-A04",
    "kind": "flow",
    "points": [
     [
      1226,
      515
     ],
     [
      1306,
      515
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
    "from": "FPW.8-A04",
    "to": "FPW.8-A05",
    "kind": "flow",
    "points": [
     [
      1506,
      49
     ],
     [
      1586,
      49
     ],
     [
      1586,
      417
     ],
     [
      1598,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A05",
    "to": "FPW.8-A06",
    "kind": "flow",
    "points": [
     [
      1786,
      417
     ],
     [
      1866,
      417
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
    "from": "FPW.8-A05",
    "to": "FPW.8-A07",
    "kind": "flow",
    "points": [
     [
      1786,
      417
     ],
     [
      1866,
      417
     ],
     [
      1866,
      613
     ],
     [
      1878,
      613
     ]
    ]
   },
   {
    "from": "FPW.8-A06",
    "to": "FPW.8-A08",
    "kind": "flow",
    "points": [
     [
      2066,
      49
     ],
     [
      2158,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A08",
    "to": "FPW.8-A09",
    "kind": "flow",
    "points": [
     [
      2346,
      49
     ],
     [
      2426,
      49
     ],
     [
      2426,
      417
     ],
     [
      2438,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A09",
    "to": "FPW.8-A10",
    "kind": "flow",
    "points": [
     [
      2626,
      417
     ],
     [
      2706,
      417
     ],
     [
      2706,
      49
     ],
     [
      2718,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A13",
    "to": "FPW.8-A14",
    "kind": "flow",
    "points": [
     [
      386,
      319
     ],
     [
      466,
      319
     ],
     [
      466,
      417
     ],
     [
      478,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A14",
    "to": "FPW.8-A15",
    "kind": "flow",
    "points": [
     [
      666,
      417
     ],
     [
      746,
      417
     ],
     [
      746,
      49
     ],
     [
      758,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A15",
    "to": "FPW.8-A16",
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
    "from": "FPW.8-A07",
    "to": "FPW.8-E1",
    "kind": "end",
    "points": [
     [
      2066,
      613
     ],
     [
      2080,
      613
     ]
    ]
   },
   {
    "from": "FPW.8-A10",
    "to": "FPW.8-E2",
    "kind": "end",
    "points": [
     [
      2906,
      49
     ],
     [
      2920,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A11",
    "to": "FPW.8-E3",
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
    "from": "FPW.8-A16",
    "to": "FPW.8-E4",
    "kind": "end",
    "points": [
     [
      1226,
      49
     ],
     [
      1240,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    466,
    139
   ]
  ]
 },
 "departmentLayout": {
  "width": 3046,
  "height": 662,
  "lanes": [
   {
    "department": "DEP-OPS",
    "label": "OTA·서비스운영팀",
    "x": 0,
    "y": 0,
    "w": 3046,
    "h": 368
   },
   {
    "department": "DEP-FS",
    "label": "기능안전팀",
    "x": 0,
    "y": 368,
    "w": 3046,
    "h": 98
   },
   {
    "department": "DEP-HOM",
    "label": "법규인증팀",
    "x": 0,
    "y": 466,
    "w": 3046,
    "h": 98
   },
   {
    "department": "DEP-QA",
    "label": "품질팀",
    "x": 0,
    "y": 564,
    "w": 3046,
    "h": 98
   }
  ],
  "nodes": [
   {
    "id": "FPW.8-A12",
    "kind": "action",
    "label": "Flag 평가 이상 확인",
    "x": 198,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A01",
    "kind": "action",
    "label": "이상 징후 확인",
    "x": 478,
    "y": 106,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A04",
    "kind": "action",
    "label": "긴급 차단 요청",
    "x": 1318,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A06",
    "kind": "action",
    "label": "차단 전달·적용 추적",
    "x": 1878,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A08",
    "kind": "action",
    "label": "원인 조치·복원 요청",
    "x": 2158,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A10",
    "kind": "action",
    "label": "단계적 복원·관측",
    "x": 2718,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A11",
    "kind": "action",
    "label": "분기 드릴·G8 운영 판정",
    "x": 198,
    "y": 196,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A13",
    "kind": "action",
    "label": "정책 롤백 요청·계획",
    "x": 198,
    "y": 286,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A15",
    "kind": "action",
    "label": "롤백 재검증·실행",
    "x": 758,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A16",
    "kind": "action",
    "label": "롤백 적용·미회신 확인",
    "x": 1038,
    "y": 16,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A02",
    "kind": "action",
    "label": "차단 필요성·범위 판단",
    "x": 758,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A05",
    "kind": "action",
    "label": "긴급 차단 2인 승인",
    "x": 1598,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A09",
    "kind": "action",
    "label": "복원 2인 승인",
    "x": 2438,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A14",
    "kind": "action",
    "label": "정책 롤백 독립 승인",
    "x": 478,
    "y": 384,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A03",
    "kind": "action",
    "label": "리콜·봉쇄 근거 연계",
    "x": 1038,
    "y": 482,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-A07",
    "kind": "action",
    "label": "긴급 권한 사후 검토",
    "x": 1878,
    "y": 580,
    "w": 188,
    "h": 66
   },
   {
    "id": "FPW.8-S1",
    "kind": "start",
    "label": "시작",
    "x": 146,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S2",
    "kind": "start",
    "label": "운행 감시 경보, 장애·VOC 접수, SOTIF 트리거 발견",
    "x": 426,
    "y": 130,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S3",
    "kind": "start",
    "label": "분기 정기 일정",
    "x": 146,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-S4",
    "kind": "start",
    "label": "정책 복구 필요 또는 자동 복구 계획 수립",
    "x": 146,
    "y": 310,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E1",
    "kind": "end",
    "label": "종료",
    "x": 2080,
    "y": 604,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E2",
    "kind": "end",
    "label": "종료",
    "x": 2920,
    "y": 40,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E3",
    "kind": "end",
    "label": "종료",
    "x": 400,
    "y": 220,
    "w": 18,
    "h": 18
   },
   {
    "id": "FPW.8-E4",
    "kind": "end",
    "label": "종료",
    "x": 1240,
    "y": 40,
    "w": 18,
    "h": 18
   }
  ],
  "edges": [
   {
    "from": "FPW.8-S1",
    "to": "FPW.8-A12",
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
    "from": "FPW.8-S2",
    "to": "FPW.8-A01",
    "kind": "trigger",
    "points": [
     [
      444,
      139
     ],
     [
      478,
      139
     ]
    ]
   },
   {
    "from": "FPW.8-S3",
    "to": "FPW.8-A11",
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
    "from": "FPW.8-S4",
    "to": "FPW.8-A13",
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
    "from": "FPW.8-A12",
    "to": "FPW.8-A01",
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
      139
     ],
     [
      478,
      139
     ]
    ]
   },
   {
    "from": "FPW.8-A01",
    "to": "FPW.8-A02",
    "kind": "flow",
    "points": [
     [
      666,
      139
     ],
     [
      746,
      139
     ],
     [
      746,
      417
     ],
     [
      758,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A02",
    "to": "FPW.8-A03",
    "kind": "flow",
    "points": [
     [
      946,
      417
     ],
     [
      1026,
      417
     ],
     [
      1026,
      515
     ],
     [
      1038,
      515
     ]
    ]
   },
   {
    "from": "FPW.8-A03",
    "to": "FPW.8-A04",
    "kind": "flow",
    "points": [
     [
      1226,
      515
     ],
     [
      1306,
      515
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
    "from": "FPW.8-A04",
    "to": "FPW.8-A05",
    "kind": "flow",
    "points": [
     [
      1506,
      49
     ],
     [
      1586,
      49
     ],
     [
      1586,
      417
     ],
     [
      1598,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A05",
    "to": "FPW.8-A06",
    "kind": "flow",
    "points": [
     [
      1786,
      417
     ],
     [
      1866,
      417
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
    "from": "FPW.8-A05",
    "to": "FPW.8-A07",
    "kind": "flow",
    "points": [
     [
      1786,
      417
     ],
     [
      1866,
      417
     ],
     [
      1866,
      613
     ],
     [
      1878,
      613
     ]
    ]
   },
   {
    "from": "FPW.8-A06",
    "to": "FPW.8-A08",
    "kind": "flow",
    "points": [
     [
      2066,
      49
     ],
     [
      2158,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A08",
    "to": "FPW.8-A09",
    "kind": "flow",
    "points": [
     [
      2346,
      49
     ],
     [
      2426,
      49
     ],
     [
      2426,
      417
     ],
     [
      2438,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A09",
    "to": "FPW.8-A10",
    "kind": "flow",
    "points": [
     [
      2626,
      417
     ],
     [
      2706,
      417
     ],
     [
      2706,
      49
     ],
     [
      2718,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A13",
    "to": "FPW.8-A14",
    "kind": "flow",
    "points": [
     [
      386,
      319
     ],
     [
      466,
      319
     ],
     [
      466,
      417
     ],
     [
      478,
      417
     ]
    ]
   },
   {
    "from": "FPW.8-A14",
    "to": "FPW.8-A15",
    "kind": "flow",
    "points": [
     [
      666,
      417
     ],
     [
      746,
      417
     ],
     [
      746,
      49
     ],
     [
      758,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A15",
    "to": "FPW.8-A16",
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
    "from": "FPW.8-A07",
    "to": "FPW.8-E1",
    "kind": "end",
    "points": [
     [
      2066,
      613
     ],
     [
      2080,
      613
     ]
    ]
   },
   {
    "from": "FPW.8-A10",
    "to": "FPW.8-E2",
    "kind": "end",
    "points": [
     [
      2906,
      49
     ],
     [
      2920,
      49
     ]
    ]
   },
   {
    "from": "FPW.8-A11",
    "to": "FPW.8-E3",
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
    "from": "FPW.8-A16",
    "to": "FPW.8-E4",
    "kind": "end",
    "points": [
     [
      1226,
      49
     ],
     [
      1240,
      49
     ]
    ]
   }
  ],
  "joins": [
   [
    466,
    139
   ]
  ]
 }
};

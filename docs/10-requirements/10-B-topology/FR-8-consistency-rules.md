---
id: FR-8
type: requirement
title: "Consistency Rules — 12종 자동 품질 게이트"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 8
standards: [OMG-DMN, ISO/IEC/IEEE-29148]
traces:
  implemented_by: [RULE-R01, RULE-R02, RULE-R03, RULE-R04, RULE-R05, RULE-R06, RULE-R07, RULE-R08, RULE-R09, RULE-R10, RULE-R11, RULE-R12]
  realized_in_screen: [SCR-220, SCR-221]
  verified_by: [TC-008]
  depends_on: [FR-7]
last_updated: 2026-06-05
---

# FR-8 · Consistency Rules — 12종 자동 품질 게이트

## 1. 개요
누락·충돌·승인 누수를 차단하는 자동 품질 게이트 12종. 등록·수정·승인·배포·Baseline 변경·API 변경 이벤트에 평가된다.

## 2. 명세 — 12 Rules (4 그룹)
| 그룹 | ID | 규칙 |
|---|---|---|
| A. Required Link | R01 | L2 Feature → ≥1 Requirement |
| | R02 | L2 Feature → Owner 필수 |
| | R03 | Released → ≥1 Test Evidence |
| B. Runtime/Deploy | R04 | Runtime Control → Safe Default 필수 |
| | R05 | Policy-only → Rollback Plan 필수 |
| | R07 | Variant Rule 없으면 Production 활성화 불가 |
| C. Supplier/Change | R06 | Supplier 구현 → Supplier Function ID 연결 |
| | R11 | API Contract 변경 → 영향 Feature 자동 산출 |
| | R12 | BOM Baseline 변경 → ChangeSet 기록 |
| D. Safety/Sec/Lifecycle | R08 | Safety Impact → Safety Gate 통과 |
| | R09 | Security Impact → Security Gate 통과 |
| | R10 | Deprecated → 신규 Control Point 생성 차단 |

상세 결정표 → [[40-10-consistency-rules]] (사이클 22~23).

## 3. 업무 규칙
- 각 룰은 severity(blocking/warning), trigger, scope, condition, action, gate를 가진다.
- 위반은 Consistency Rule Console(SCR-220) Violation Inbox에 표시된다.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Released 전환 시 Test Evidence 누락 차단 (R03)
  Given FEAT-X가 Verified 상태이고 Test Evidence가 없다
  When Released로 전환하려 한다
  Then 전환이 차단되고 R03 위반이 Violation Inbox에 등록된다
```

## 5. 데이터 / 화면
RULE-R01~R12 · SCR-220 Console, SCR-221 Violation Detail.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S14) |

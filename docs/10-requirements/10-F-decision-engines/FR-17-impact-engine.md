---
id: FR-17
type: requirement
title: "Impact Analysis Engine"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [OMG-DMN, ISO/IEC/IEEE-29148]
traces: { implemented_by: [ENG-IMPACT], realized_in_screen: [SCR-300], verified_by: [TC-017], depends_on: [FR-6] }
last_updated: 2026-06-05
---

# FR-17 · Impact Analysis Engine

## 1. 개요
변경 대상에서 Topology Graph를 탐색해 영향 범위를 계산(변경 누락 방지·사전 영향도 산출).

## 2. 명세
- **입력:** Feature/SWC/API/ECU/Policy 변경 대상 + change_type.
- **출력:** Impacted Features·Requirements·SWCs·ECUs·APIs·Variants·Tests·Suppliers + Deployment Impact + Safety/Security.
- 상세 알고리즘 → [[40-20-engine-impact]] (사이클 24).

## 3. 업무 규칙
- RULE-R11: API Contract 변경 시 영향 Feature 자동 산출.
- "Create CR from impact"로 변경관리 연계(SCR-410).

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: API v1.4→v1.5 영향 산출
  Given API-BDC-POLICY-CONTROL을 v1.4→v1.5(optional field add) 변경 대상으로 입력한다
  When Impact를 실행한다
  Then Impacted Features=2(FEAT-BDC-001,FEAT-BODY-001), SWCs=1, Suppliers=1, Tests=3 이 산출된다
```

## 5. 데이터 / 화면
ENG-IMPACT · SCR-300 Impact Center.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18,S31) |

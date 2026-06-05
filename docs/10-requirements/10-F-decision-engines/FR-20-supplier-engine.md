---
id: FR-20
type: requirement
title: "Supplier Responsibility Engine"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [OMG-ReqIF-1.2, OpenAPI-3.2.0]
traces: { implemented_by: [ENG-SUPPLIER], realized_in_screen: [SCR-330], verified_by: [TC-020], depends_on: [FR-26] }
last_updated: 2026-06-05
---

# FR-20 · Supplier Responsibility Engine

## 1. 개요
Feature → Supplier Function → SWC/API 경로로 책임 범위와 계약 Gap을 산출(협력사 책임 경계 명확화·Release Package 검증).

## 2. 명세
- **입력:** Feature ID·Supplier Function·SWC·API/Signal/DTC Mapping.
- **출력:** Supplier Scope·Acceptance Criteria·Contract Gap·Test Evidence Status.
- 상세 → [[40-50-engine-supplier]] (사이클 27).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: 협력사 책임 범위 산출
  Given FEAT-BDC-001이 SUP-BDC-A(BDC_FUNC_032)에 realized_by 된다
  When Supplier 엔진을 실행한다
  Then Supplier Scope=SUP-BDC-A, Contract Gap=none, Evidence Status가 표시된다
```

## 4. 데이터 / 화면
ENG-SUPPLIER · SCR-330, SCR-711.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18,S32) |

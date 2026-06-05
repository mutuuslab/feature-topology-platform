---
id: FR-14
type: requirement
title: "Verification Scope — 검증범위 자동 도출"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 10
standards: [ISO/IEC/IEEE-29148, ISO-26262]
traces:
  implemented_by: [ENG-VERIFY, ENT-TESTCASE, ENT-TESTEVIDENCE]
  realized_in_screen: [SCR-310]
  verified_by: [TC-014]
  depends_on: [FR-13]
last_updated: 2026-06-05
---

# FR-14 · Verification Scope — 검증범위 자동 도출

## 1. 개요
Feature 조건을 조합하여 필수 Test Scope·Missing Evidence·Release Gate를 자동 산출한다(과소/과잉 검증 방지).

## 2. 명세 — Feature 조건 → 필수 검증
| Feature 조건 | 필수 검증 |
|---|---|
| Runtime Control | Policy Apply/Fail/Rollback |
| Variant Rule | 적용/비적용 차량 조건 |
| Supplier Function | Supplier Integration Test |
| Safety Impact | Safe Default/Degraded |
| Security Impact | Authorization/Integrity |
| OTA 연계 | Binary 또는 Policy-only 배포 |
| Telemetry | Event/Audit/DTC |

산출 규칙: BOM + Variant + Control + Safety/Security + Supplier 조건 조합 → 필수 Test Scope·Missing Evidence·Release Gate.

## 3. 업무 규칙
- 출력: Mandatory Tests·Missing Evidence·Coverage Gap·Quality Gate Result.
- 결과는 Release Readiness Verification Gate(G5) 입력.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Runtime Control Feature의 필수 검증 도출
  Given FEAT-BDC-001이 Runtime Control이고 Variant Rule이 있다
  When 검증범위를 도출한다
  Then Policy Apply/Fail/Rollback + 적용/비적용 차량 테스트가 Mandatory로 산출되고
    And OTA-RB-002 미완이면 Missing Evidence로 표시된다
```

## 5. 데이터 / 화면
ENG-VERIFY, ENT-TESTCASE/TESTEVIDENCE · SCR-310, SCR-510(G5).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S16) |

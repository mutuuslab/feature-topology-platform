---
id: FR-18
type: requirement
title: "Verification Scope Engine"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO/IEC/IEEE-29148, ISO-26262]
traces: { implemented_by: [ENG-VERIFY], realized_in_screen: [SCR-310], verified_by: [TC-018], depends_on: [FR-14] }
last_updated: 2026-06-05
---

# FR-18 · Verification Scope Engine

## 1. 개요
Variant·Control·Safety 조건에 따라 필수 테스트와 증적 Gap을 도출(과소/과잉 검증 방지·Gate 자동화). FR-14의 엔진 구현.

## 2. 명세
- **입력:** Feature Dependency·Variant Rule·Runtime Control·Safety/Security Impact·OTA Type.
- **출력:** Mandatory Tests·Missing Evidence·Coverage Gap·Quality Gate Result.
- 상세 → [[40-30-engine-verification-scope]] (사이클 25).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: 미완 증적 Gap 산출
  Given FEAT-BDC-001의 HIL-BDC-001 완료, OTA-RB-002 미완
  When 검증범위를 도출한다
  Then Missing Evidence=[OTA-RB-002], Verification Gate=PENDING
```

## 4. 데이터 / 화면
ENG-VERIFY · SCR-310.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18) |

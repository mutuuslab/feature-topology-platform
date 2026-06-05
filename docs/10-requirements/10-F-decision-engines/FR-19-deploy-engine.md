---
id: FR-19
type: requirement
title: "Deployment Decision Engine"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO-24089, OMG-DMN]
traces: { implemented_by: [ENG-DEPLOY], realized_in_screen: [SCR-320], verified_by: [TC-019], depends_on: [FR-13] }
last_updated: 2026-06-05
---

# FR-19 · Deployment Decision Engine

## 1. 개요
변경 유형을 분석해 Binary OTA / Policy-only / Calibration Update를 구분(불필요한 Binary OTA 제거). FR-13의 엔진 구현.

## 2. 명세
- **입력:** SWC/API/Policy/Variant/Calibration 변경.
- **출력:** Deploy Type·Required Gates·Rollback Test·Manual Review 필요 여부.
- 상세 → [[40-40-engine-deployment-decision]] (사이클 26).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: SWC 변경 없음 → Policy-only
  Given 변경이 Policy 조건만이고 SWC/API/ECU 변경이 없다
  When 배포방식 엔진을 실행한다
  Then Deploy Type=Policy-only, Required Gates=[Policy,Variant,Rollback,Telemetry]
```

## 4. 데이터 / 화면
ENG-DEPLOY · SCR-320.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18) |

---
id: FR-29
type: requirement
title: "Impact Analysis Center UI"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO/IEC/IEEE-29148]
traces: { satisfies: [FR-17], realized_in_screen: [SCR-300], verified_by: [TC-029] }
last_updated: 2026-06-05
---

# FR-29 · Impact Analysis Center UI

## 1. 개요
변경 대상을 입력하면 Topology 기반 영향 범위를 산출·시각화하는 화면.

## 2. 명세
- UI 요소: Change Target·Impact Graph·Scope Filter·Confidence·Export·Create CR.
- 출력: Impacted Feature·SWC·ECU·API·Test·Supplier + Deployment/Safety/Security Impact.

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: 영향 요약 표시
  Given API-BDC-POLICY v1.4→v1.5 변경을 입력한다
  When Run Impact
  Then 좌측 traversal 그래프 + 우측 Impact Summary(2 Features·1 SWC·1 ECU·1 Supplier·3 Tests·4 Variants)
```

## 4. 데이터 / 화면
SCR-300. 상세 → 사이클 38.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S19,S31) |

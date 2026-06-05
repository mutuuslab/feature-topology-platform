---
id: FR-30
type: requirement
title: "Release Readiness Center UI"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO-26262, ISO/SAE-21434]
traces: { satisfies: [FR-22], implemented_by: [GATE-G1, GATE-G2, GATE-G3, GATE-G4, GATE-G5, GATE-G6, GATE-G7, GATE-G8, GATE-G9], realized_in_screen: [SCR-510], verified_by: [TC-030] }
last_updated: 2026-06-05
---

# FR-30 · Release Readiness Center UI

## 1. 개요
Production 활성화 전 9개 Gate 통과 여부와 Gap을 확인하는 화면.

## 2. 명세
- UI 요소: Gate Matrix(9)·Evidence Status·Approver·Blocking Issue·Re-evaluate·Request Approval·Release.
- 출력: PASS/PENDING/FAIL·Missing Evidence·Release Decision(HOLD/RELEASE).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: HOLD 시 Release 비활성
  Given 9 Gate 중 1개가 PENDING 이다
  When Release Readiness Center를 본다
  Then 결정 배너=HOLD, Release 버튼 비활성, 해당 Gate에 fix 링크
```

## 4. 데이터 / 화면
GATE-G1~G9 · SCR-510. 상세 → 사이클 40.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S25) |

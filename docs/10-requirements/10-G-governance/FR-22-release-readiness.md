---
id: FR-22
type: requirement
title: "Release Readiness — 9 Gates"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO-26262, ISO/SAE-21434, ISO-24089]
traces: { implemented_by: [GATE-G1, GATE-G2, GATE-G3, GATE-G4, GATE-G5, GATE-G6, GATE-G7, GATE-G8, GATE-G9], realized_in_screen: [SCR-510], verified_by: [TC-022], depends_on: [FR-21] }
last_updated: 2026-06-05
---

# FR-22 · Release Readiness — 9 Gates

## 1. 개요
Production 활성화는 9개 Gate 통과 상태가 Feature Baseline에 기록된 후에만 허용한다.

## 2. 명세 — 9 Gates
G1 Feature · G2 Requirement · G3 Variant · G4 Control · G5 Verification · G6 Supplier · G7 Safety/Security · G8 OTA · G9 Operations. 각 PASS/PENDING/FAIL + Evidence·Approver·Blocking Issue. 집계 = HOLD/RELEASE. 상세 → [[40-70-release-readiness-gates]] (사이클 29).

## 3. 업무 규칙
- 하나라도 FAIL/PENDING → HOLD, Release 비활성.
- 전부 PASS → RELEASE 가능(`deploy` verb).

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 8/9 PASS, Verification PENDING → HOLD
  Given FEAT-BDC-001이 G5(Verification)=PENDING(OTA-RB-002 미완), 나머지 8개 PASS
  When Release Readiness를 평가한다
  Then 결정=HOLD, 조건="OTA Rollback Test 완료 후 재평가"
```

## 5. 데이터 / 화면
GATE-G1~G9 · SCR-510 Release Readiness Center.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S25) |

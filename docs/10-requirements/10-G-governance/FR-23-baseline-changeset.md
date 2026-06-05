---
id: FR-23
type: requirement
title: "Baseline & ChangeSet"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [OMG-ReqIF-1.2, ISO/IEC/IEEE-29148]
traces: { implemented_by: [ENT-FEATUREBOM, RULE-R12], realized_in_screen: [SCR-420, SCR-421, SCR-422], verified_by: [TC-023], depends_on: [FR-3] }
last_updated: 2026-06-05
---

# FR-23 · Baseline & ChangeSet

## 1. 개요
Feature BOM 변경은 반드시 ChangeSet으로 기록하고, Baseline 간 비교로 영향도를 추적한다.

## 2. 명세
- **ChangeSet:** ADD/MODIFY/REMOVE × 11 BOM 영역. 예 v1.0→v1.1: ADD 5건·MODIFY 2건.
- **Baseline Diff:** 버전 간 side-by-side/inline 비교.
- ADD/MODIFY 발생 시 Impact Analysis 자동 트리거(RULE-R12, RULE-R11).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: Baseline 변경 → 자동 Impact
  Given FEAT-BDC-001 BOM이 v1.0에서 5 ADD·2 MODIFY 된다
  When ChangeSet을 커밋한다
  Then Baseline v1.1이 생성되고 Impact Analysis가 자동 트리거된다
```

## 4. 데이터 / 화면
ENT-FEATUREBOM · SCR-420 ChangeSet, SCR-421 Baseline Diff, SCR-422 Timeline.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S40) |

---
id: FR-21
type: requirement
title: "Feature Lifecycle — 6 상태·전이 가드"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO-24089, ISO/IEC/IEEE-29148]
traces: { implemented_by: [LCS-PROPOSED, LCS-APPROVED, LCS-DEVELOPING, LCS-VERIFIED, LCS-RELEASED, LCS-RETIRED], realized_in_screen: [SCR-610, SCR-101], verified_by: [TC-021] }
last_updated: 2026-06-05
---

# FR-21 · Feature Lifecycle — 6 상태·전이 가드

## 1. 개요
Feature는 생애주기 상태와 Governance Rule을 함께 관리. **Released 상태에서만 Production ON**.

## 2. 명세 — 상태 & 전이
`Proposed → Approved → Developing → Verified → Released → Retired`
전이 가드: Gate 통과 + Owner 승인 + ChangeSet 기록 + Baseline 갱신 + Evidence 연결. Lifecycle Event = Audit 대상. 상태기계 상세 → [[40-60-lifecycle-state-machine]] (사이클 28).

## 3. 업무 규칙
- 다음 상태 전이는 전제 조건 모두 충족 시에만.
- Released → Evidence(검증·Telemetry) 없이 운영 방치 금지.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Gate 미통과 시 Released 전이 차단
  Given FEAT-BDC-001이 Verification Gate=PENDING 이다
  When Released로 전이하려 한다
  Then 전이가 차단되고 blocking 사유가 표시된다(HOLD)
```

## 5. 데이터 / 화면
LCS-* · SCR-610, SCR-101(상태 드롭다운).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S26) |

---
id: FR-11
type: requirement
title: "Runtime State — 실차 평가 결과 상태"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 9
standards: [OpenFeature, ISO-24089]
traces:
  implemented_by: [ENT-TELEMETRYEVENT]
  realized_in_screen: [SCR-620]
  verified_by: [TC-011]
  depends_on: [FR-10]
last_updated: 2026-06-05
---

# FR-11 · Runtime State — 실차 평가 결과 상태

## 1. 개요
차량 내 평가 결과를 상태로 관리한다.

## 2. 명세 — 상태 집합
`enabled · disabled · degraded · blocked · policy_apply_fail · rollback_required` (+ telemetry_event).
차량 내부 평가 3중 Guard: Capability Check → Vehicle State Check → Auth Check (→ FR-12).

## 3. 업무 규칙
- 모든 Runtime State 전이는 Telemetry Event로 수집되어 Feature ID에 귀속.
- policy_apply_fail/rollback_required는 Alert Rule·Incident 트리거(FR-15/16).

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 정책 적용 실패 시 상태 전이
  Given 차량이 Policy 수신 후 ECU version mismatch를 만난다
  When 평가가 실패한다
  Then Runtime State=policy_apply_fail, Telemetry Event 수집, Safe Default 적용
```

## 5. 데이터 / 화면
ENT-TELEMETRYEVENT · SCR-620 Ops Dashboard, SCR-630 Telemetry Explorer.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S37) |

---
id: FR-12
type: requirement
title: "활성화 판단 — Variant ∧ Control ∧ Runtime"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 9
standards: [OpenFeature, Unleash]
traces:
  implemented_by: [ENT-VARIANTRULE, ENT-CONTROLPOINT]
  realized_in_screen: [SCR-610, SCR-650]
  verified_by: [TC-012]
  depends_on: [FR-9, FR-10, FR-11]
last_updated: 2026-06-05
---

# FR-12 · 활성화 판단 — Variant ∧ Control ∧ Runtime

## 1. 개요
세 판단을 결합한 최종 활성화 규칙과 차량 내부 평가 흐름을 정의한다.

## 2. 명세 — 판단 규칙
```
IF Variant=PASS AND Control Gate=ALLOW AND Runtime Context=VALID
THEN Feature = ON
ELSE Feature = OFF / SAFE DEFAULT / ROLLBACK
```
차량 내부 평가 흐름(6단계): Policy 수신 → Capability Check → Vehicle State Check → Auth Check → Flag 평가 → 실행/차단(실패 시 Safe Default).

## 3. 업무 규칙
- 3중 Guard(Capability·Vehicle State·Auth) 모두 통과해야 활성화.
- 이 분리가 **Binary OTA vs Policy-only**를 가르는 기준.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 모든 조건 충족 시 ON
  Given Variant=PASS, Control=ALLOW, Runtime=VALID
  When 활성화를 평가한다
  Then Feature=ON, 실패 시 Safe Default=disabled
```

## 5. 데이터 / 화면
ENT-VARIANTRULE, ENT-CONTROLPOINT · SCR-610, SCR-650.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S37) |

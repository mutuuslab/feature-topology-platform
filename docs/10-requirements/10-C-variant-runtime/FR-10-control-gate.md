---
id: FR-10
type: requirement
title: "Control Gate — 운영시점 활성화"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 9
standards: [OpenFeature, Unleash]
traces:
  implemented_by: [ENT-CONTROLPOINT]
  realized_in_screen: [SCR-141, SCR-610]
  verified_by: [TC-010]
  depends_on: [FR-9]
last_updated: 2026-06-05
---

# FR-10 · Control Gate — 운영시점 활성화

## 1. 개요
"지금 이 Feature를 **활성화할 것인가**?"를 판단하는 **운영시점 조건** 게이트.

## 2. 명세
- 조건: Policy Rule/Targeting · Rollout %/Cohort · Entitlement/Auth · Kill-switch 상태 · Safe Default/Rollback.
- Control Point 유형: Policy/Flag/Parameter/Kill/Safe Default (`CP-{FEATURE}-{TYPE}`).

## 3. 업무 규칙
- **R04:** Runtime Control은 Safe Default 필수. **R05:** Policy-only는 Rollback Plan 필수.
- Control 변경만으로 SWC/API 변경 없으면 Policy-only 배포 후보(→ FR-13).

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Kill-switch ON 시 활성화 차단
  Given FEAT-BDC-001의 Control Gate에서 Kill-switch=ON 이다
  When 활성화를 평가한다
  Then Feature=OFF, Safe Default(disabled) 적용
```

## 5. 데이터 / 화면
ENT-CONTROLPOINT · SCR-141 Control Point Catalog, SCR-610 Policy Lifecycle, SCR-101(Control 탭).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15) |

---
id: SCR-XXX
type: screen
title: "화면명 / Screen Name"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 0
traces:
  satisfies: []          # 이 화면이 실현하는 FR
  implemented_by: []     # 렌더하는 엔티티
  depends_on: []
  verified_by: []
uses_diagram: []
rbac:
  visible_to: []
  edit: []
last_updated: 2026-06-05
---

# SCR-XXX · 화면명 / Screen Name

```yaml
# ── SCREEN SPEC (machine-readable) ──
id: SCR-XXX
group: G#                 # 사이드바 그룹
source: PPT(Sxx) | NEW
personas: [P1..P7, Admin]
permissions: { view: "", edit: "", action: "<verb>" }
entry_points: [SB, BC, QA, DL, GS]
deep_link: "/path/{id}"
data:
  - { bind: "", entity: "ENT-...", fr: "FR-#" }
states: [default, empty, loading, error, no-permission, partial]
telemetry:
  - { event: "", when: "" }
related: [SCR-XXX]
```

## 1. 목적 & 컨텍스트 / Purpose & Context
## 2. 페르소나 & 권한 / Persona & Permissions
## 3. 진입점 & 딥링크 / Entry Points & Deep-linking
## 4. 레이아웃 / Layout (ASCII wireframe)
```
┌─ ... ─┐
└───────┘
```
| 영역 | 내용 |
|---|---|

## 5. 컴포넌트 / Components
| 컴포넌트 | 타입 | 동작 |
|---|---|---|

## 6. 데이터 바인딩 / Data Bindings (→ FR / Entity)
## 7. 상호작용 / Interactions (click·hover·keyboard·drag)
## 8. 상태 / States (empty·loading·error·no-permission·partial)
## 9. 검증 / Validations (필드·정합성 룰 hook·blocking)
## 10. 관련 화면 / Related Screens
## 11. 텔레메트리 / Analytics Events
## 변경 이력 / Change History

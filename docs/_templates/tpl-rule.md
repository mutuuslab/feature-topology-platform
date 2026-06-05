---
id: RULE-Rxx
type: rule
title: "정합성 규칙명 / Consistency Rule"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 0
standards: [OMG-DMN, ISO/IEC/IEEE-29148]
traces:
  satisfies: [FR-8]
  implemented_by: []
  realized_in_screen: [SCR-220]
  verified_by: []
  depends_on: []
last_updated: 2026-06-05
---

# RULE-Rxx · 정합성 규칙명 / Consistency Rule

## 1. 개요 / Overview
무엇을 막는 규칙인가 (누락·충돌·승인 누수 등).

## 2. 규칙 정의 / Rule Definition (DMN-style)
```yaml
rule: RULE-Rxx
category: "Required Link | Runtime/Deploy | Supplier/Change | Safety/Security/Lifecycle"
trigger: [register, modify, approve, deploy, baseline-change, api-change]
scope: "<적용 대상 표현식>"
condition: "<위반 판정 조건>"
severity: blocking | warning
action: "block | warn"
message: "사용자 메시지"
gate: GATE-Gx        # 연계 게이트(있으면)
```

## 3. 트리거 시점 / Trigger Points
| 이벤트 | 평가 여부 |
|---|---|

## 4. 위반 처리 / Violation Handling
- 표시: Consistency Rule Console(SCR-220) Violation Inbox
- 해소 경로:

## 5. 다이어그램 / Diagram
![flow](../90-diagrams/flowchart/...)

## 6. 예시 / Example (FEAT-BDC-001)
## 변경 이력 / Change History

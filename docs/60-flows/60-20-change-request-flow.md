---
id: FLW-CHANGE-REQUEST
type: flow
title: "CR & ChangeSet→자동 Impact 플로"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 44
traces:
  satisfies: [FR-17, FR-18, FR-19, FR-20, FR-23]
  realized_in_screen: [SCR-410, SCR-340, SCR-341, SCR-421, SCR-300]
  verified_by: [TC-017, TC-023]
uses_diagram: [DIAG-SEQ-DEPLOY-DECISION]
last_updated: 2026-06-05
---

# CR & ChangeSet→자동 Impact 플로

## (ii) CR 파이프라인
| # | 화면 | 행동 | 반응 |
|---|---|---|---|
| 1 | SCR-101 | QA `Create CR` | SCR-410 Wizard |
| 2 | SCR-410 | Define(target/type) | step 검증 |
| 3 | SCR-410 | Topology Lookup | 영향 미리보기(SCR-300 재사용) |
| 4 | SCR-410 | Run Decisions | Impact/Verify/Deploy/Supplier 자동 |
| 5 | SCR-341 | Review Report | 통합 DecisionReport |
| 6 | SCR-410 | Submit | SCR-A20 승인자 라우팅 |

```mermaid
sequenceDiagram
  actor U as P2/P3
  participant CR as CR Wizard
  participant TG as Topology
  participant E as 4 Engines
  participant R as DecisionReport
  participant A as Approver
  U->>CR: Define
  CR->>TG: Lookup
  TG->>E: Impact→Verify→Deploy→Supplier
  E->>R: 통합 Report(Policy-only,4 Gates)
  U->>A: Submit
  A-->>U: Approve/Reject
```

## (vii) ChangeSet→Baseline Diff→자동 Impact
```mermaid
flowchart LR
  A[BOM Edit Save] --> B[ChangeSet ADD/MODIFY]
  B --> C[Baseline Diff v1.0↔v1.1]
  C --> D[RULE-R12 자동 Impact]
  D --> E[Impact Center prefilled]
```

---
id: FLW-RELEASE-READINESS
type: flow
title: "Release Readiness & Variant 작성 플로"
status: draft
version: 0.1.0
owner: verification-safety
cycle: 45
traces:
  satisfies: [FR-22, FR-9, FR-13]
  realized_in_screen: [SCR-510, SCR-220]
  verified_by: [TC-022]
uses_diagram: [DIAG-FLW-GATES]
last_updated: 2026-06-05
---

# Release Readiness & Variant 작성 플로

## (iii) Release Readiness 9-Gate
```mermaid
flowchart TD
  A[Readiness Center SCR-510] --> B[Evaluate 9 Gates]
  B --> C{All PASS?}
  C -->|No| D[HOLD + blocking links]
  D --> E[Fix evidence/gate]
  E --> B
  C -->|Yes| F[RELEASE enabled]
  F --> G[Lifecycle→Released + Baseline 기록]
```
BDC 예시: 8 PASS, ⑤Verification PENDING(OTA-RB-002) → HOLD → 완료 후 재평가 → RELEASE.

## (iv) Variant 규칙 작성→Export to Policy
```mermaid
flowchart LR
  A[Variant Matrix] --> B[Rule Builder IF/AND/THEN]
  B --> C[Capability + Conflict Check]
  C -->|0 conflict| D[Cohort Preview]
  D --> E[Export to Runtime Policy]
  E --> F[Policy Lifecycle: Draft]
```
Variant(구조) → Export → Control(운영) 분리 유지. `deploy` verb.

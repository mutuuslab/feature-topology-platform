---
id: ENG-DEPLOY
type: engine
title: "배포방식 판단 엔진 / Deployment Decision Engine"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 26
standards: [ISO-24089, OMG-DMN-1.5]
traces:
  satisfies: [FR-19, FR-13]
  realized_in_screen: [SCR-320]
  verified_by: [TC-019]
  depends_on: [ENG-IMPACT]
last_updated: 2026-06-05
---

# 배포방식 판단 엔진 / Deployment Decision Engine

## 1. I/O 계약
```yaml
engine: ENG-DEPLOY
input: { change_types: list[SWC,API,ECU,Policy,Variant,Calibration] }
output: { deploy_type: enum[Binary,Policy-only,Calibration,Manual], required_gates:[], rollback_test: bool, manual_review: bool, confidence: enum }
```

## 2. 결정표 (hit policy: FIRST)
```yaml
rules:
  - { when: "SWC∈Δ or API∈Δ or ECU∈Δ", then: "Binary OTA" }
  - { when: "Policy∈Δ or Variant∈Δ (only)", then: "Policy-only" }
  - { when: "Calibration∈Δ (only)", then: "Calibration Update" }
default: "Manual Review"
```
Policy-only 추가 조건: SWC 변경 없음 ∧ API Contract 변경 없음 ∧ Runtime Context 추가 없음 ∧ Rollback 정의됨 → confidence High.

## 3. Flowchart
```mermaid
flowchart TD
  D[Change Δ] --> Q1{SWC/API/ECU?}
  Q1 -->|yes| B[Binary OTA]
  Q1 -->|no| Q2{Policy/Variant only?}
  Q2 -->|yes| P[Policy-only]
  Q2 -->|no| Q3{Calibration only?}
  Q3 -->|yes| C[Calibration Update]
  Q3 -->|no| M[Manual Review]
```

## 4. 예시 (Targeting Rule만 변경)
SWC/API 변경 없음 → **Policy-only**, Required Gates=[Policy,Variant,Rollback,Telemetry], confidence High. (PPT S20,S21)

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S16,S18) |

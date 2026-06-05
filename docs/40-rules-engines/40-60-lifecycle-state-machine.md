---
id: LCS-PROPOSED
type: lifecycle
title: "라이프사이클·CR·Runtime 상태기계 / State Machines"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 28
standards: [ISO-24089, OMG-BPMN-2.0.2]
traces:
  satisfies: [FR-21]
  realized_in_screen: [SCR-610, SCR-101, SCR-400]
  verified_by: [TC-021]
uses_diagram: [DIAG-STA-LIFECYCLE, DIAG-STA-CR, DIAG-STA-RUNTIME]
last_updated: 2026-06-05
---

# 라이프사이클 · CR · Runtime 상태기계

## 1. Feature Lifecycle (6 상태)
전이 가드 = Gate 통과 + Owner 승인 + ChangeSet 기록 + Baseline 갱신 + Evidence 연결.
```mermaid
stateDiagram-v2
  [*] --> Proposed
  Proposed --> Approved: Owner 승인 + R01/R02 PASS
  Approved --> Developing: 구현 착수
  Developing --> Verified: 검증 완료 + Evidence
  Verified --> Released: 9 Gate PASS + Baseline 기록
  Released --> Retired: 폐기/대체(replaces)
  Released --> Developing: 변경(CR) 재개
  Retired --> [*]
```
**Released 상태에서만 Production ON.**

## 2. Change Request (CR) 상태
```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Analyzed: Topology Lookup + Impact
  Analyzed --> Reviewed: Decision Engines 실행
  Reviewed --> Approved: 승인자 승인
  Reviewed --> Rejected
  Approved --> Implemented
  Implemented --> Closed
  Rejected --> [*]
  Closed --> [*]
```

## 3. Runtime State
```mermaid
stateDiagram-v2
  [*] --> disabled
  disabled --> enabled: Variant PASS ∧ Control ALLOW ∧ Runtime VALID
  enabled --> degraded: 부분 장애 (degrades_to)
  enabled --> policy_apply_fail: 적용 실패
  policy_apply_fail --> blocked
  blocked --> rollback_required
  rollback_required --> disabled: Safe Default / Rollback
  degraded --> enabled: 복구
```

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S26,S37) |

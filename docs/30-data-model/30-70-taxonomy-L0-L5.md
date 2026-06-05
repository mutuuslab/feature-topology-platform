---
id: ARC-TAXONOMY
type: entity
title: "Taxonomy L0~L5 / Level Hierarchy"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 20
standards: [FODA, OMG-SysML-2.0]
traces:
  satisfies: [FR-2]
  implemented_by: [ENT-TAXONOMYNODE]
  realized_in_screen: [SCR-110, SCR-111]
  verified_by: [TC-002]
last_updated: 2026-06-05
---

# Taxonomy L0~L5 / Level Hierarchy

## 1. 계층 (기준 = L2)
| Level | 관리 목적 | Object | 필수 연결 | 배포 대상 |
|---|---|---|---|---|
| L0 | Domain/Capability | TaxonomyNode | L1 | ✗ |
| L1 | Customer/Business | Feature Cluster | L2 | ✗ |
| **L2** | **Vehicle/System (기준)** | Feature Master | Requirement·Variant·Test | ✓ 기준 |
| L3 | Software Feature | Feature/SupplierFunction | SWC·ECU·Supplier | ✓ |
| L4 | Policy/Flag/Parameter | ControlPoint | Policy·Safe Default | (제어) |
| L5 | Code/Signal/Logic | Implementation Item | API·Signal·DTC | (구현) |

## 2. Boundary & Governance
- L0/L1: 분류·상품가치, DeploymentUnit 직접 연결 금지(T-004).
- L2: 요구사항·검증·Variant·Gate 기준 단위.
- L3: 구현·협력사 책임, L2와 trace 필요(T-003).
- L4/L5: Control/Implementation Artifact (Feature 아님).

## 3. Mermaid (Body Comfort 예시)
```mermaid
flowchart TB
  L0[L0 Body Comfort] --> L1[L1 Remote Door Lock]
  L1 --> L2[L2 Remote Door Lock Command]
  L2 --> L3[L3 BDC Door Lock Policy Control]
  L3 --> L4["L4 bdc.door_lock.remote_enable"]
  L4 --> L5[L5 DoorLockState]
```

## 4. Consistency (T-001~T-004) → [[FR-2-taxonomy]]
## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S9) |

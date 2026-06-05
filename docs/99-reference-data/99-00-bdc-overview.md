---
id: REF-BDC
type: reference
title: "BDC 레퍼런스 케이스 / FEAT-BDC-001"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 50
traces:
  satisfies: [FR-1, FR-5, FR-8, FR-17, FR-22]
  implemented_by: [ENT-FEATURE, EDG-REQUIRES, RULE-R11, ENG-IMPACT, GATE-G5]
  uses_diagram: [DIAG-FLW-BDC]
  verified_by: [TC-050]
last_updated: 2026-06-05
---

# BDC 레퍼런스 케이스 / FEAT-BDC-001 (BDC Policy Control)

전체 모델(18 Entity·10 Edge·12 Rule·4 Engine·9 Gate)을 실제로 행사하는 worked example.
데이터 → [99-10-bdc-topology.yaml](99-10-bdc-topology.yaml).

## 핵심 시나리오 (PPT S20–21)
**Targeting Rule 변경(SWC/API 무변경) → Policy-only.**
- Impact: 2 Features·1 SWC·1 Supplier·3 Tests.
- Deploy: Policy-only(High) — SWC/API 변경 없음·Rollback 정의됨.
- Readiness: 8/9 PASS, ⑤Verification PENDING(OTA-RB-002) → **HOLD**.
- 운영: 98.7% activation, 실패 시 Safe Default=disabled.

## 검증 매핑 (cycle 52 추적성)
| 모델 요소 | BDC 행사 |
|---|---|
| 18 Entity | bom + control + verification + operation 전 영역 |
| 10 Edge | parent_of/requires/excludes/fallback_to/replaces (5종 직접 + 나머지 확장 가능) |
| 12 Rule | rules_exercised 참조 (R01~R12) |
| 4 Engine | decision_report (Impact/Verify/Deploy/Supplier) |
| 9 Gate | readiness (8 PASS·1 PENDING) |

## Topology
![BDC Topology](../90-diagrams/class/DIAG-FLW-BDC.mmd)

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S10,S20,S21,S25,S31) |

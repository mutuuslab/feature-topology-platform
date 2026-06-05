---
id: FR-7
type: requirement
title: "Metamodel — 18 Entity / 4 Group"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 8
standards: [OMG-SysML-2.0, OMG-ReqIF-1.2]
traces:
  implemented_by: [ENT-FEATURE, ENT-BOMITEM, ENT-VARIANTRULE, ENT-CONTROLPOINT]
  realized_in_screen: [SCR-230]
  verified_by: [TC-007]
last_updated: 2026-06-05
---

# FR-7 · Metamodel — 18 Entity / 4 Group

## 1. 개요
Feature 중심 데이터 구조를 18 Entity / 4 Group으로 정의하고, 대표 Relationship으로 연결한다. (Registry의 데이터 설계도)

## 2. 명세 — 18 Entity / 4 Group
- **기준정보(5):** TaxonomyNode, FeatureBOM, BOMItem, Requirement, Feature
- **Architecture & Interface(5):** SWComponent, ECU, APIService, Signal, DTC
- **Control & Deployment(4):** VariantRule, ControlPoint, DeploymentUnit, RollbackPlan
- **Verification & Operations(4):** TestCase, TestEvidence, SupplierFunction, TelemetryEvent

대표 Relationship: derives · implemented_by · uses_api · applies_to · controlled_by · deployed_as · verified_by · realized_by · emits_event.

## 3. 업무 규칙
- 모든 엔티티는 Feature ID로 연결 가능해야 한다.
- 상세 스키마는 [[30-00-metamodel-overview]] (사이클 13~17).

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 메타모델 뷰어에서 엔티티 관계 조회
  Given Metamodel Viewer를 연다
  When ENT-FEATURE를 선택한다
  Then 연결된 관계(implemented_by→SWComponent 등)와 그룹이 표시된다
```

## 5. 데이터 / 화면
ENT-* (18) · SCR-230 Metamodel Viewer.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S14) |

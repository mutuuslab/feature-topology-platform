---
id: ENT-FEATURE
type: entity
title: "기준정보 엔티티 / Master Entities (5)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 14
standards: [OMG-SysML-2.0, OMG-ReqIF-1.2, ISO/IEC/IEEE-29148]
traces:
  satisfies: [FR-1, FR-2, FR-3, FR-7]
  realized_in_screen: [SCR-101, SCR-110, SCR-120, SCR-130]
  verified_by: [TC-007]
  depends_on: []
uses_diagram: [DIAG-ERD-METAMODEL]
last_updated: 2026-06-05
---

# 기준정보 엔티티 / Master Entities

대표 엔티티: **ENT-FEATURE** (+ ENT-TAXONOMYNODE, ENT-FEATUREBOM, ENT-BOMITEM, ENT-REQUIREMENT).

## ENT-TAXONOMYNODE
```yaml
entity: TaxonomyNode
group: master
attributes:
  - { name: id, type: id, pk: true, pattern: "TAX-{LEVEL}-{NNN}" }
  - { name: level, type: enum, values: [L0,L1,L2,L3,L4,L5], required: true }
  - { name: parent_id, type: id_ref }
  - { name: display_name, type: string, required: true }
  - { name: node_type, type: enum, values: [Domain,Cluster,FeatureMaster,SWFeature,ControlPoint,ImplItem] }
constraints: ["T-001..T-004 (FR-2)"]
```

## ENT-FEATURE  (핵심)
```yaml
entity: Feature
group: master
attributes:
  - { name: id, type: id, pk: true, pattern: "FEAT-{DOMAIN}-{NNN}", required: true }
  - { name: level, type: enum, values: [L0,L1,L2,L3,L4,L5], required: true, note: "기준=L2" }
  - { name: display_name, type: string, required: true, note: "고객/차량 관점" }
  - { name: internal_alias, type: map, note: "조직별 명칭" }
  - { name: owner_org, type: id_ref, required: true }
  - { name: source, type: string }
  - { name: lifecycle, type: enum, values: [Proposed,Approved,Developing,Verified,Released,Retired], required: true }
  - { name: safety_level, type: enum, values: [QM,ASIL-A,ASIL-B,ASIL-C,ASIL-D] }
  - { name: security_level, type: enum, values: [Low,Medium,High] }
  - { name: deploy_type, type: enum, values: [Binary,Policy-only,Calibration,Manual,TBD] }
  - { name: applicability_ref, type: id_ref, note: "→ VariantRule" }
  - { name: verification_method, type: list }
  - { name: baseline_ver, type: string }
relationships: [parent_of, child_of, composed_of, requires, excludes, overrides, fallback_to,
                degrades_to, replaces, duplicates, derives, implemented_by, uses_api,
                applies_to, controlled_by, deployed_as, verified_by, realized_by, emits_event]
indexes: [id, domain, lifecycle, owner_org]
constraints: ["RULE-R01,R02,R03,R07 (FR-8)"]
```

## ENT-FEATUREBOM
```yaml
entity: FeatureBOM
group: master
attributes:
  - { name: id, type: id, pk: true, pattern: "BOM-{FEATURE}" }
  - { name: feature_id, type: id_ref, required: true }
  - { name: baseline_ver, type: string, required: true }
  - { name: areas, type: list, note: "11 영역" }
constraints: ["변경 시 ChangeSet 생성 (RULE-R12)"]
```

## ENT-BOMITEM
```yaml
entity: BOMItem
group: master
attributes:
  - { name: bom_item_id, type: id, pk: true }
  - { name: feature_id, type: id_ref, required: true }
  - { name: domain, type: enum, values: [Requirement,Architecture,Interface,Variant,Control,Deployment,Verification,Supplier,SafetySecurity,Operation,FeatureMaster] }
  - { name: artifact_type, type: string }
  - { name: artifact_id, type: id_ref, note: "원천 ID (복제 금지)" }
  - { name: source_system, type: string }
  - { name: owner_team, type: id_ref }
  - { name: supplier_id, type: id_ref }
  - { name: relationship_type, type: string }
  - { name: direction, type: enum, values: [in,out,bi] }
  - { name: criticality, type: enum, values: [low,med,high] }
  - { name: variant_scope, type: string }
  - { name: lifecycle_status, type: enum }
  - { name: baseline_ver, type: string }
  - { name: evidence_uri, type: uri }
  - { name: verification_status, type: enum, values: [none,partial,passed,failed] }
  - { name: last_sync_at, type: datetime }
```

## ENT-REQUIREMENT
```yaml
entity: Requirement
group: master
attributes:
  - { name: id, type: id, pk: true, pattern: "{SYS|SWE|SEC|FUN|NFR}-{DOMAIN}-{NNN}" }
  - { name: kind, type: enum, values: [SYS,SWE,SEC,FUN,NFR] }
  - { name: text, type: string }
  - { name: source_system, type: string, note: "예: Codebeamer" }
  - { name: reqif_ref, type: uri }
relationships: [derives]
```

## 예시 (FEAT-BDC-001)
```yaml
id: FEAT-BDC-001
level: L2
display_name: "BDC Policy Control"
owner_org: "Body Platform Team"
lifecycle: Approved
safety_level: QM
security_level: Medium
deploy_type: Policy-only
```

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S8,S9,S10,S14) |

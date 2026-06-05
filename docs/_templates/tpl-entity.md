---
id: ENT-XXX
type: entity
title: "엔티티명 / EntityName"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 0
traces:
  satisfies: [FR-7]
  implemented_by: []
  realized_in_screen: []
  verified_by: []
  depends_on: []
uses_diagram: [DIAG-ERD-METAMODEL]
last_updated: 2026-06-05
---

# ENT-XXX · 엔티티명 / EntityName

## 1. 개요 / Overview
이 엔티티가 무엇을 표현하는가 (1~2문장).

## 2. 그룹 / Group
`master | arch-if | control-deploy | verify-ops`

## 3. 속성 / Attributes
```yaml
entity: EntityName
group: <group>
attributes:
  - { name: id, type: id, pk: true, required: true, pattern: "..." }
  - { name: <attr>, type: <string|int|float|bool|enum|datetime|uri|id_ref|list|map>,
      required: <bool>, values: [...], default: <...>, note: "" }
indexes: []
constraints: []     # 엔티티 수준 불변식
```

## 4. 관계 / Relationships
| 관계(REL/EDG) | 대상 엔티티 | 방향 | 카디널리티 |
|---|---|---|---|

## 5. 정합성 규칙 연계 / Consistency Rules
| RULE-Rxx | 적용 내용 |
|---|---|

## 6. 다이어그램 / Diagrams
![ERD](../90-diagrams/erd/...)

## 7. 화면 매핑 / Screen Mapping
## 8. 예시 / Example (FEAT-BDC-001 기준)
```yaml
```
## 변경 이력 / Change History

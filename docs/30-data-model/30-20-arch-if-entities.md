---
id: ENT-SWCOMPONENT
type: entity
title: "Architecture & Interface 엔티티 (5)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 15
standards: [OMG-SysML-2.0, AUTOSAR-Adaptive, OpenAPI-3.2.0]
traces:
  satisfies: [FR-7]
  realized_in_screen: [SCR-140, SCR-101]
  verified_by: [TC-007]
  depends_on: [ENT-FEATURE]
last_updated: 2026-06-05
---

# Architecture & Interface 엔티티

## ENT-SWCOMPONENT
```yaml
entity: SWComponent
group: arch-if
attributes:
  - { name: id, type: id, pk: true, pattern: "SWC-{DOMAIN}-{NAME}" }
  - { name: display_name, type: string }
  - { name: ecu_id, type: id_ref }
  - { name: supplier_id, type: id_ref }
  - { name: version, type: string }
relationships: [implemented_by(inv), deployed_on→ECU]
```

## ENT-ECU
```yaml
entity: ECU
group: arch-if
attributes:
  - { name: id, type: id, pk: true, pattern: "ECU-{NAME}" }
  - { name: display_name, type: string }
  - { name: hw_generation, type: string, note: "예: Gen3" }
  - { name: capability_manifest, type: map }
```

## ENT-APISERVICE
```yaml
entity: APIService
group: arch-if
attributes:
  - { name: id, type: id, pk: true, pattern: "API-{DOMAIN}-{NAME}" }
  - { name: contract_uri, type: uri, note: "OpenAPI 3.2 / Protobuf" }
  - { name: version, type: string, note: "예: v1.4" }
  - { name: breaking, type: bool, note: "구조 변경 여부 — Deploy 판단 입력" }
relationships: [uses_api(inv), exposes→Signal, reports→DTC]
constraints: ["API Contract 변경 → RULE-R11 자동 Impact"]
```

## ENT-SIGNAL
```yaml
entity: Signal
group: arch-if
attributes:
  - { name: id, type: id, pk: true, pattern: "SIG-{NAME}" }
  - { name: bus, type: enum, values: [CAN,LIN,Ethernet,SOME/IP] }
  - { name: api_field, type: string }
```

## ENT-DTC
```yaml
entity: DTC
group: arch-if
attributes:
  - { name: id, type: id, pk: true, pattern: "DTC-{NAME}" }
  - { name: diagnostic_event, type: string }
  - { name: telemetry_map, type: id_ref }
```

## 예시 (FEAT-BDC-001)
SWC-BDC-ADAPTER → ECU-BDC · API-BDC-POLICY-CONTROL v1.4 · SIG-DOOR-LOCK · DTC-BDC-POLICY-FAIL.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S10,S14) |

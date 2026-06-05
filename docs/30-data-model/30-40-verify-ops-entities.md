---
id: ENT-TESTEVIDENCE
type: entity
title: "Verification & Operations 엔티티 (4)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 17
standards: [ISO/IEC/IEEE-29148, ISO-26262, MQTT-5.0]
traces:
  satisfies: [FR-7, FR-14, FR-15, FR-26]
  realized_in_screen: [SCR-500, SCR-620, SCR-711]
  verified_by: [TC-007]
  depends_on: [ENT-FEATURE]
last_updated: 2026-06-05
---

# Verification & Operations 엔티티

## ENT-TESTCASE
```yaml
entity: TestCase
group: verify-ops
attributes:
  - { name: id, type: id, pk: true, pattern: "{HIL|OTA|TEL|...}-{DOMAIN}-{NNN}" }
  - { name: method, type: enum, values: [HIL,SIL,OTA-Rollback,Telemetry,Integration,Unit] }
  - { name: mandatory_for, type: list, note: "조건→필수 검증 (FR-14)" }
```

## ENT-TESTEVIDENCE
```yaml
entity: TestEvidence
group: verify-ops
attributes:
  - { name: id, type: id, pk: true }
  - { name: test_case_id, type: id_ref, required: true }
  - { name: result, type: enum, values: [pass,fail,pending] }
  - { name: coverage, type: float }
  - { name: evidence_uri, type: uri }
constraints: ["RULE-R03: Released → ≥1 Evidence"]
```

## ENT-SUPPLIERFUNCTION
```yaml
entity: SupplierFunction
group: verify-ops
attributes:
  - { name: id, type: id, pk: true, note: "예: BDC_FUNC_032" }
  - { name: supplier_id, type: id_ref, required: true, note: "예: SUP-BDC-A" }
  - { name: oem_feature_id, type: id_ref, required: true, note: "Feature Mapping" }
  - { name: swc_id, type: id_ref }
  - { name: acceptance_criteria, type: string }
  - { name: contract_gap, type: string }
relationships: [realized_by(inv), implements→SWComponent]
constraints: ["RULE-R06: Supplier 구현 → Supplier Function ID 필수"]
```

## ENT-TELEMETRYEVENT
```yaml
entity: TelemetryEvent
group: verify-ops
attributes:
  - { name: id, type: id, pk: true }
  - { name: feature_id, type: id_ref, required: true, note: "Feature ID 귀속" }
  - { name: event_type, type: enum, values: [POLICY_APPLY_SUCCESS,POLICY_APPLY_FAIL,POLICY_ROLLBACK,DELAY] }
  - { name: cohort, type: string }
  - { name: reason, type: string }
  - { name: ts, type: datetime }
  - { name: transport, type: enum, values: [MQTT,REST] }
relationships: [emits_event(inv)]
```

## 예시 (FEAT-BDC-001)
HIL-BDC-001(pass)·OTA-RB-002(pending)·TEL-BDC-001 · SUP-BDC-A/BDC_FUNC_032 · EVT POLICY_APPLY_SUCCESS(98.7%).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S10,S17,S32) |

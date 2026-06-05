---
id: INT-SUPPLIER-PKG
type: integration
title: "Supplier API Release Package (10항목)"
status: draft
version: 0.1.0
owner: supplier-liaison
cycle: 48
standards: [OpenAPI-3.2.0, OMG-ReqIF-1.2, ISO-26262, ISO/SAE-21434]
traces:
  satisfies: [FR-26]
  implemented_by: [ENT-SUPPLIERFUNCTION]
  realized_in_screen: [SCR-710, SCR-711]
  verified_by: [TC-026]
last_updated: 2026-06-05
---

# Supplier API Release Package (10항목)

## 1. 구성 (10 Item)
```yaml
package:
  1_api_contract:        { format: [OpenAPI-3.2, Protobuf], required: true }
  2_human_doc:           { dev guide·변경이력·예시 }
  3_feature_mapping:     { supplier_function_id: BDC_FUNC_032, oem_feature_id: FEAT-BDC-001 }
  4_capability_manifest: { hw_sw_ecu 지원 버전 }
  5_variant_compat:      { 차종·지역·트림·연식 }
  6_diagnostics:         { DTC·Telemetry Event·진단 시나리오 }
  7_safety_security:     { asil, cybersecurity_claim, cert }
  8_sdk_stub_mock:       { stub·mock server·sample }
  9_test_evidence:       { unit·integration·coverage }
  10_release_note:       { migration·breaking changes }
```

## 2. 연결 경로 (PPT S32)
OEM Feature ID → Supplier Function ID → Supplier SWC → ECU → API/Signal/DTC → Test Evidence → Acceptance Criteria(API Contract 준수).

## 3. Gate 연계
10항목 검증 → Supplier Gate(GATE-G6). 미완 시 불통과. RULE-R06(Supplier Function ID 필수).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S32) |

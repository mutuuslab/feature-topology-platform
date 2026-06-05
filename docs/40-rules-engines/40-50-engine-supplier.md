---
id: ENG-SUPPLIER
type: engine
title: "협력사 책임 분석 엔진 + 파이프라인 / Supplier Engine + Pipeline"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 27
standards: [OMG-ReqIF-1.2, OpenAPI-3.2.0]
traces:
  satisfies: [FR-20, FR-26]
  realized_in_screen: [SCR-330, SCR-340, SCR-341]
  verified_by: [TC-020]
  depends_on: [ENT-SUPPLIERFUNCTION]
uses_diagram: [DIAG-SEQ-DEPLOY-DECISION, DIAG-FLW-DECISION-PIPELINE]
last_updated: 2026-06-05
---

# 협력사 책임 분석 엔진 + 의사결정 파이프라인

## 1. Supplier 엔진 I/O
```yaml
engine: ENG-SUPPLIER
input: { feature_id, supplier_function, swc, api_signal_dtc_mapping }
output: { supplier_scope, acceptance_criteria, contract_gap, test_evidence_status }
```
경로: Feature → realized_by → SupplierFunction → implements → SWComponent → uses_api.

## 2. 의사결정 파이프라인 (4 엔진 통합)
```mermaid
sequenceDiagram
  participant CR as ChangeRequest
  participant TL as TopologyLookup
  participant I as ENG-IMPACT
  participant V as ENG-VERIFY
  participant D as ENG-DEPLOY
  participant S as ENG-SUPPLIER
  participant R as DecisionReport
  CR->>TL: target, change_type
  TL->>I: impacted set
  I->>V: impacted features/variants
  V->>D: verification scope
  D->>S: deploy type, gates
  S->>R: supplier scope
  R-->>CR: 통합 DecisionReport (5 산출물)
```

## 3. DecisionReport (산출)
Impact Report + Test Scope + Deploy Decision + Supplier Report → 단일 문서. Attach to CR, Export, Submit for Approval (SCR-341).

## 4. 예시 (FEAT-BDC-001)
Supplier Scope=SUP-BDC-A · Contract Gap=none · Evidence 2/2 · API Contract 영향 없음. (PPT S20,S32)

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18,S32) |

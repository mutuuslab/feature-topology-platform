---
id: FR-3
type: requirement
title: "Feature BOM — 11영역·공통 Schema·품질 규칙"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 7
standards: [ISO/IEC/IEEE-29148, OMG-ReqIF-1.2, OMG-SysML-2.0]
traces:
  implemented_by: [ENT-FEATUREBOM, ENT-BOMITEM, RULE-R12]
  realized_in_screen: [SCR-120]
  verified_by: [TC-003]
  depends_on: [FR-1]
last_updated: 2026-06-05
---

# FR-3 · Feature BOM — 11영역·공통 Schema·품질 규칙

## 1. 개요
Feature BOM은 Feature ID 기준으로 **11개 Artifact 영역**을 수집·정규화·Baseline화하여 Topology Graph와 Decision Engine의 입력으로 사용하는 기준정보 모델. **원천 데이터를 복제하지 않고 ID·링크 보유**.

## 2. 명세 — 11개 영역
| # | 영역 | 내용 |
|---|---|---|
| 1 | Feature Master | ID·Name·Level·Owner·Lifecycle |
| 2 | Requirement | System/SW/Safety/Security |
| 3 | Architecture | SWC/ECU |
| 4 | Interface | API/Signal/DTC |
| 5 | Variant | 차종/지역/HW/SW |
| 6 | Control | Policy/Flag |
| 7 | Deployment | Binary/Policy Package |
| 8 | Verification | Test Evidence |
| 9 | Supplier | Supplier Function |
| 10 | Safety/Security | ASIL/Cybersec |
| 11 | Operation | Telemetry/Audit |

## 3. BOM Item 공통 Schema
`BOM Item = Source Artifact Pointer + Relationship Metadata`
| 그룹 | 필드 |
|---|---|
| Key | feature_id, bom_item_id, domain |
| Artifact | artifact_type, artifact_id, display_name |
| Ownership | source_system, owner_team, supplier_id |
| Relation | relationship_type, direction, criticality |
| Scope | variant_scope, lifecycle_status, baseline_ver |
| Evidence | evidence_uri, verification_status, last_sync_at |

## 4. 업무 규칙 (BOM 품질)
- **R1:** L2 Feature는 최소 1개 Requirement와 Owner 필수.
- **R2:** Runtime Control은 Safe Default와 Rollback Plan 필수.
- **R3:** Policy-only는 SWC/API 변경 없음 + 검증 증적 필요.
- **R4:** Released는 Test Evidence와 Telemetry/Audit 연결 필수.
- 변경 시 ChangeSet + Baseline Diff 생성(→ RULE-R12, FR-23).

## 5. 인수 기준 (Gherkin)
```gherkin
Scenario: BOM 변경 시 ChangeSet 자동 생성
  Given FEAT-BDC-001의 BOM에 Requirement "SEC-POLICY-004"를 추가한다
  When 저장한다
  Then ChangeSet 항목 "ADD/Requirement/SEC-POLICY-004"가 기록되고
    And RULE-R12에 의해 Baseline Diff와 Impact 분석이 트리거된다
```

## 6. 데이터 / 화면
ENT-FEATUREBOM, ENT-BOMITEM · SCR-120 BOM Editor, SCR-101(BOM 탭).

## 7. 표준
29148(requirement info items) · ReqIF 1.2 · SysML 2.0.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S10) |

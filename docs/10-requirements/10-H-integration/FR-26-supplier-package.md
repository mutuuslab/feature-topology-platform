---
id: FR-26
type: requirement
title: "Supplier API Release Package — 10 항목"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [OpenAPI-3.2.0, OMG-ReqIF-1.2, ISO/IEC/IEEE-29148]
traces: { implemented_by: [INT-SUPPLIER-PKG, ENT-SUPPLIERFUNCTION], realized_in_screen: [SCR-710, SCR-711], verified_by: [TC-026], depends_on: [FR-20] }
last_updated: 2026-06-05
---

# FR-26 · Supplier API Release Package — 10 항목

## 1. 개요
협력사는 API/사양을 문서가 아니라 **Feature ID 기반의 검증 가능한 계약 패키지(10항목)**로 배포한다.

## 2. 명세 — 10 항목
1 API Contract(OpenAPI/Protobuf) · 2 Human Documentation · 3 Feature Mapping(Supplier↔OEM ID) · 4 Capability Manifest(HW/SW/ECU) · 5 Variant Compatibility · 6 Diagnostics/Telemetry(DTC/Event) · 7 Safety/Security(ASIL/CS claim) · 8 SDK/Stub/Mock · 9 Test Evidence · 10 Release Note(Migration/Breaking).

연결 경로: OEM Feature ID → Supplier Function ID → SWC → ECU → API/Signal/DTC → Test Evidence → Acceptance Criteria.

## 3. 업무 규칙
- 10항목 검증 결과가 Supplier Gate(G6) 입력.
- RULE-R06: Supplier 구현은 Supplier Function ID 연결 필수.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 미완 항목 시 Supplier Gate 불통과
  Given 패키지의 Variant Compatibility, Test Evidence가 partial 이다
  When 패키지를 검증한다
  Then Supplier Gate=불통과(2 items incomplete)
```

## 4. 데이터 / 화면
INT-SUPPLIER-PKG, ENT-SUPPLIERFUNCTION · SCR-710 Intake, SCR-711 Detail.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S32) |

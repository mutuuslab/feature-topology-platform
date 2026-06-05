---
id: FR-28
type: requirement
title: "Feature Detail UI — 11 탭"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO/IEC/IEEE-29148, OMG-ReqIF-1.2]
traces: { satisfies: [FR-1, FR-2, FR-3], implemented_by: [ENT-FEATURE], realized_in_screen: [SCR-101], verified_by: [TC-028] }
last_updated: 2026-06-05
---

# FR-28 · Feature Detail UI — 11 탭

## 1. 개요
Feature ID 기준으로 Taxonomy·BOM·Topology·검증·운영을 통합 조회/관리하는 11탭 화면.

## 2. 명세 — 11 탭
Summary · Taxonomy · BOM · Topology · Variants · Control · Deploy · Verify · Supplier · Ops · History.
+ Traceability Health(Requirement/Test/Supplier/Variant/Rollback/Telemetry) + Quick Actions(Run Impact·Derive Verification·Deployment Decision·Create CR) + Warnings.

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: Traceability Health 경고
  Given FEAT-BDC-001의 Test 3/4, Telemetry partial 이다
  When Feature Detail을 연다
  Then Health에 Test ⚠, Telemetry ⚠가 표시되고 Warnings 배너가 나온다
```

## 4. 데이터 / 화면
ENT-FEATURE(+연결 전 엔티티) · SCR-101. 탭별 상세 → 사이클 36.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S33) |

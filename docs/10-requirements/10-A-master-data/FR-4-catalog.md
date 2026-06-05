---
id: FR-4
type: requirement
title: "Feature Catalog — 검색·필터·Health·집계"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 7
standards: [ISO/IEC/IEEE-29148, OpenFeature]
traces:
  implemented_by: [ENT-FEATURE]
  realized_in_screen: [SCR-100]
  verified_by: [TC-004]
  depends_on: [FR-1]
last_updated: 2026-06-05
---

# FR-4 · Feature Catalog — 검색·필터·Health·집계

## 1. 개요
사용자가 가장 먼저 접하는 화면. 전체 Feature를 검색·필터하고 traceability health/totals를 한눈에 파악.

## 2. 명세
- **검색:** 디바운스 텍스트 검색(Feature ID/Name).
- **필터(8):** Domain·Level·Lifecycle·Owner·Supplier·ECU·Deploy Type·Safety.
- **컬럼:** Display ID·Name·Level·Domain·Owner·Lifecycle·Deploy·Health.
- **Health(n/6):** Requirement·Test·Supplier·Variant·Rollback·Telemetry 충족 차원 수. <4 ✗ / 4–5 ⚠ / 6 ✓.
- **집계 strip:** Total·Approved·Developing·Released·Missing Traceability (클릭 시 사전필터 뷰).

## 3. 업무 규칙
- BR: 저장된 뷰(Saved Views)는 URL 파라미터로 복원·공유 가능(딥링크).
- BR: 대량 작업(Run Impact/Export/Lifecycle)은 해당 verb 권한 필요.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Domain 필터로 목록 좁히기
  Given Catalog에 247개 Feature가 있다
  When Domain=Body 필터를 적용한다
  Then Body 도메인 Feature만 표시되고 URL에 domain=Body가 반영된다
  And 집계 strip이 필터 결과 기준으로 갱신된다
```

## 5. 데이터 / 화면
ENT-FEATURE · SCR-100. 행 클릭 → SCR-101.

## 6. 표준
29148(요구사항 속성) · OpenFeature(상태 개념).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S35) |

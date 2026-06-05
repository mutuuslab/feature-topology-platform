---
id: FR-27
type: requirement
title: "Dashboard / Catalog UI"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [ISO/IEC/IEEE-29148, OpenFeature]
traces: { satisfies: [FR-4], realized_in_screen: [SCR-010, SCR-100], verified_by: [TC-027] }
last_updated: 2026-06-05
---

# FR-27 · Dashboard / Catalog UI

## 1. 개요
전체 Feature 상태와 traceability health를 한눈에 확인하는 대시보드/카탈로그 UI.

## 2. 명세
- **Dashboard(역할별):** KPI 타일·내 작업·알림(7 페르소나 프리셋, SCR-010).
- **Catalog:** 검색·필터·Lifecycle·Owner·Deploy Type·Health(SCR-100).
- 출력: Missing Traceability·High Risk Change·OTA Summary.

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: 역할별 기본 대시보드
  Given P7(운영) 사용자로 로그인한다
  When 홈에 진입한다
  Then Ops Dashboard가 기본 랜딩으로 표시된다
```

## 4. 데이터 / 화면
SCR-010 Role Home, SCR-100 Catalog.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S19,S35) |

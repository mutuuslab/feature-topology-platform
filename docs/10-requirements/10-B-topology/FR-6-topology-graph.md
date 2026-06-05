---
id: FR-6
type: requirement
title: "Topology Graph — 관계 그래프·5 산출물"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 8
standards: [OMG-SysML-2.0, ISO/IEC/IEEE-29148]
traces:
  implemented_by: [ENG-IMPACT, ENG-VERIFY, ENG-DEPLOY, ENG-SUPPLIER]
  realized_in_screen: [SCR-200]
  verified_by: [TC-006]
  depends_on: [FR-5, FR-7]
last_updated: 2026-06-05
---

# FR-6 · Topology Graph — 관계 그래프·5 산출물

## 1. 개요
Feature ID를 중심으로 BOM 구성요소와 Relationship Edge를 연결한 관계 그래프를 시각화·탐색하고, 변경 의사결정 5가지를 계산한다.

## 2. 명세
- **그래프 시각화:** Feature 중심 노드(Requirement·Architecture·Interface·Variant·Supplier·Control·Verification·Deployment·Operations 클러스터) + 10 Edge.
- **탐색:** pan/zoom·layout(radial/hierarchical/force)·node/edge 필터·focus-depth(1~3 hop)·search-to-center·export.
- **5 산출물:** 영향도·검증범위·배포방식·책임범위·복구경로 (→ [[00-30-five-outputs]]).

## 3. 업무 규칙
- 모든 변경 요청은 Topology Graph Query로 시작(설계원칙).
- 그래프는 ASoT 데이터의 읽기 뷰; 편집은 SCR-210 Edge Editor 경유.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 중심 Feature에서 3-hop 영향 탐색
  Given FEAT-BDC-001을 중심으로 그래프를 연다
  When focus-depth=2, edge-filter=requires/implemented_by 로 본다
  Then 2-hop 이내 영향 노드만 강조 표시된다
```

## 5. 데이터 / 화면
(graph projection) · SCR-200, SCR-101(Topology 탭).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S12) |

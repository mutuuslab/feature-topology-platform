---
id: DS-COMPONENTS
type: design-system
title: "컴포넌트 인벤토리 / Component Inventory"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 49
traces:
  satisfies: [FR-27, FR-28, FR-29, FR-30]
last_updated: 2026-06-05
---

# 컴포넌트 인벤토리 / Component Inventory

| 컴포넌트 | 용도 | 주요 화면 |
|---|---|---|
| DataTable | 정렬·필터·저장뷰·대량작업·density·페이지네이션 | SCR-100,400,500,910 |
| FacetFilterBar | 다중 facet 칩 필터 | SCR-100 |
| StatusBadge / HealthBadge | Lifecycle/Gate/Deploy/Health(n/6) 시맨틱 | 전역 |
| GraphCanvas (Cytoscape) | 토폴로지·임팩트 그래프, layout/filter/depth | SCR-200,300 |
| EdgeInspector | 엣지 6그룹 속성 편집(슬라이드오버) | SCR-210 |
| GateMatrix | 9 Gate 카드(PASS/PENDING/FAIL)·확장 | SCR-510 |
| DiffViewer | Baseline side-by-side/inline diff(ADD/MOD/REMOVE) | SCR-421 |
| Wizard/Stepper | 5-step CR·7-criteria 등록 | SCR-410,130 |
| SidePanel (PAT-RPANEL) | 미리보기·quick-edit | 전역 |
| QuickActionsBar (PAT-QA) | Run Impact·Verify·Deploy·Create CR | SCR-101 등 |
| KPITile | 대시보드 지표 | SCR-010,620 |
| RuleBuilder | IF/AND/THEN 조건식·conflict·cohort | SCR-220(Variant) |
| TimeSeriesChart | telemetry 성공률 | SCR-620,630 |
| KanbanBoard | Policy Lifecycle·CR | SCR-610,400 |
| ConfirmDestructive | type-to-confirm(Kill/Rollback) | SCR-650 |
| Empty/Loading/Error/NoPerm (PAT-*) | 상태 패턴 | 전역 |

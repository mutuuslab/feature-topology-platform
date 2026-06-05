---
id: SCR-200
type: screen
title: "관계/토폴로지 화면군 / Topology Screens (G2)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 37
traces:
  satisfies: [FR-5, FR-6, FR-7, FR-8, FR-29]
  implemented_by: [EDG-REQUIRES, RULE-R01]
  realized_in_screen: [SCR-101, SCR-300]
  verified_by: [TC-005, TC-008]
  uses_diagram: [DIAG-FLW-BDC]
last_updated: 2026-06-05
---

# 관계/토폴로지 화면군 / Topology Screens (G2)

## SCR-200 · Topology Graph (P, S12)
```
┌ 관계 ▸ Graph ─ Center: FEAT-BDC-001 ───────[Layout▾][Filter▾][Depth:2][Fit][⤓]┐
│ Legend: ─parent_of ⇢requires ⊘excludes ⤴overrides ↩fallback_to ↓degrades ⇄replaces│
│        [Requirement]──derives──▶( FEAT-BDC-001 )◀──implemented_by──[SWC/ECU]      │
│   [FEAT-BODY-001]◀─parent_of────┤  BDC Policy   ├──requires──▶[FEAT-RUNTIME-001]  │
│   [FEAT-MANUAL-001]◀─excludes────┤   Control L2  │                                 │
│   [POLICY-BDC-PREV]◀─fallback_to─┤              ├──replaces──▶[FEAT-BDC-002]       │
│                                  └──────────────┘   (+미니맵)                      │
├───────────────────────────────────────────────────────────────────────────────┤
│ Selected: requires→FEAT-RUNTIME-001 [criticality:high][Edit edge ✎ → SCR-210]    │
└───────────────────────────────────────────────────────────────────────────────┘
```
- 컴포넌트: 캔버스(pan/zoom)·layout(radial/hierarchical/force)·node/edge 필터·depth(1~3)·search-to-center·export PNG/SVG·미니맵. node ctx: Open Detail / Run Impact / Add edge. edge click→inspector(6그룹 속성).
- 상태: empty("관계 없음 — Add edge")/loading/partial(unsynced grey).

## SCR-210 · Edge Editor (N, S11)
- 우측 슬라이드오버: source/target·relationship_type(10)·6그룹 속성. 저장 시 실시간 EQ1~EQ4 검증, 순환(EQ1) 시 차단.

## SCR-220 · Consistency Rule Console (N, S14)
```
┌ 관계 ▸ Consistency Rules ───────────────[Run All][Violation Inbox 7]┐
│ Rule Catalog (12)            │ Violation Inbox                       │
│ A 001✅ 002❗1 003❗1          │ ❗002 FEAT-SEAT-001 Owner 미지정       │
│ B 004✅ 005✅ 007⚠1          │ ❗003 FEAT-CONN-001 Released w/o Evid  │
│ C 006 011 012                │ ⚠007 Variant 없음→prod block          │
│ D 008 009 010                │ [Assign][Open Feature][Resolve]        │
└──────────────────────────────┴───────────────────────────────────────┘
```
- 12룰 그룹 A~D·Run All·Violation Inbox(triage)·필터(severity/rule/domain). → SCR-221.

## SCR-221 · Violation Detail (N)
- 단일 위반: 영향 엔티티·근거 룰·fix 액션·assignee.

## SCR-230 · Metamodel Viewer (N, S14)
- 18 엔티티/4 그룹/관계 참조 다이어그램(읽기). DIAG-ERD-METAMODEL 임베드.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S11,S12,S14) |

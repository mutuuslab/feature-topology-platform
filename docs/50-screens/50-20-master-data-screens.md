---
id: SCR-101
type: screen
title: "기준정보 화면군 / Master Data Screens (G1)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 36
traces:
  satisfies: [FR-1, FR-2, FR-3, FR-4, FR-28]
  implemented_by: [ENT-FEATURE, ENT-TAXONOMYNODE, ENT-BOMITEM, ENT-CONTROLPOINT]
  realized_in_screen: [SCR-300, SCR-510]
  verified_by: [TC-028]
last_updated: 2026-06-05
---

# 기준정보 화면군 / Master Data Screens (G1)

## SCR-100 · Feature Catalog (P, S35)
```
┌ 기준정보 ▸ Catalog ─────────────────────────────[+ Feature ▾][⋮ Bulk][Saved▾]┐
│ 🔍 Search...  [Domain▾][Level▾][Lifecycle▾][Owner▾][Supplier▾][ECU▾][Deploy▾][Safety▾]│
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐ Display ID   │ Name              │Lv│Domain│Owner   │Lifecycle │Deploy   │Health│
│ ☐ FEAT-BDC-001 │ BDC Policy Control│L2│Body  │Body    │Approved  │Policy   │ 5/6 ⚠│
│ ☐ FEAT-ADAS-001│ AEB Emergency     │L2│ADAS  │ADAS    │Released  │Binary   │ 6/6 ✓│
├───────────────────────────────────────────────────────────────────────────────┤
│ Total 247 · Approved 89 · Developing 52 · Released 78 · Missing Trace 28        │
└───────────────────────────────────────────────────────────────────────────────┘
```
- 8 facet 필터·정렬·저장뷰·density·행 hover→우측 미리보기(PAT-RPANEL)·대량작업(verb gated)·Health n/6.
- 상태: empty/no-results/loading(skeleton)/partial(telemetry stale→`?`).
- 텔레메트리: `catalog_search/filter/row_open/bulk`. → 행 클릭 SCR-101.

## SCR-101 · Feature Detail — 11 탭 (P, S33)
헤더: `FEAT-BDC-001 BDC Policy Control [Status: Approved▾] ★ [⋮]` + 탭바 + 우측 sticky Quick Actions/Traceability Health/Warnings.
| 탭 | 핵심 내용 | →FR |
|---|---|---|
| Summary | Level·Domain·Owner·Deploy·Safety·Security·Supplier·Variant 요약(inline edit) | FR-1 |
| Taxonomy | L0→L5 breadcrumb·parent/child·T-001~004 배지·"Open Browser" | FR-2 |
| BOM | 11영역 표(공통 schema)·R1~R4 배지·"Edit BOM"→SCR-120 | FR-3 |
| Topology | 미니 그래프·엣지 리스트·"Open full graph"→SCR-200 | FR-5,6 |
| Variants | 적용 매트릭스 미리보기·"Rule Builder" | FR-9 |
| Control | Control Points·Safe Default·Variant≠Control 노트 | FR-10 |
| Deploy | 현 deploy type·DeploymentUnit·"Deployment Decision"→SCR-320 | FR-13 |
| Verify | 검증 방법·coverage 3/4·Missing·"Derive Verification"→SCR-310 | FR-14 |
| Supplier | SUP-BDC-A·BDC_FUNC_032·contract gap·package 상태 | FR-20,26 |
| Ops | activation %·failure·rollback·recent events·"Ops Dashboard"→SCR-620 | FR-15 |
| History | 버전 타임라인·ChangeSet·audit | FR-23,24 |
- Quick Actions(PAT-QA): Run Impact·Derive Verification·Deployment Decision·Create CR (verb gated).
- Traceability Health: Requirement 2✓·Test 3/4⚠·Supplier✓·Variant✓·Rollback✓·Telemetry⚠.
- Warnings 배너: "Test Coverage 75%·Telemetry partial — Gate 미통과 항목 존재".
- 상태: 탭별 독립 error·partial(stale)·no-permission(edit→PAT-NOPERM).

## SCR-110/111 · Taxonomy Browser / Editor (N)
- Browser: L0~L5 트리·레벨 경계·node 상세. Editor: 노드 생성/이동·ID 규칙·T-001~004 실시간 검증(차단).

## SCR-120 · BOM Editor (P, S10)
- 11영역 탭·BOM Item 공통 schema 편집·evidence 링크·저장 시 ChangeSet 생성(RULE-R12)·R1~R4 배지.

## SCR-130 · Feature Definition Wizard (P, S8)
4-step: Candidate→7 Criteria(Evidence 토글)→필수 속성→등록 결정. ≥4+필수속성 → Feature / 미달 → BOM 하위/보류. → SCR-101.

## SCR-140 · Artifact Catalog (N) / SCR-141 · Control Point Catalog (N)
- 140: Requirement/SWC/ECU/API/Signal/DTC 포인터 브라우즈. 141: Policy/Flag/Param/Kill/Safe 레지스트리(CP-{FEATURE}-{TYPE}).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S8,S9,S10,S33,S35) |

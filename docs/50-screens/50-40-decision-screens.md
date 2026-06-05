---
id: SCR-300
type: screen
title: "의사결정 화면군 / Decision Screens (G3)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 38
traces:
  satisfies: [FR-17, FR-18, FR-19, FR-20, FR-29]
  implemented_by: [ENG-IMPACT, ENG-VERIFY, ENG-DEPLOY, ENG-SUPPLIER]
  realized_in_screen: [SCR-410]
  verified_by: [TC-017, TC-019]
last_updated: 2026-06-05
---

# 의사결정 화면군 / Decision Screens (G3)

## SCR-300 · Impact Analysis Center (P, S19/S31)
```
┌ 의사결정 ▸ Impact ──────────────────────────────────[Export ⤓][Create CR]┐
│ Change Target: [API-BDC-POLICY-CONTROL▾]  Type: [v1.4→v1.5 Optional add▾]  │
│ [▶ Run Impact]                                       Confidence: ████░ High │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Traversal Graph (path 강조)    │ Impact Summary                              │
│ API──uses_api→FEAT-BDC-001     │ Features 2 · SWCs 1 · ECUs 1 · Suppliers 1 │
│   ├implemented_by→SWC-ADAPTER  │ Tests 3 · Variants 4                        │
│   ├realized_by→SUP-BDC-A       │ Deployment: Policy-only 가능                │
│   └verified_by→3 tests         │ Safety/Security: QM / Sec Medium 재검토     │
└───────────────────────────────┴────────────────────────────────────────────┘
결론: Optional field 추가 → 구조변경 아님 → Policy-only. 3 Test 재실행 + Supplier 호환성.
```
- 컴포넌트: change-target/type picker·Run(`run-engine`)·traversal graph·summary 표·scope filter·confidence·Export·"Create CR from impact"→SCR-410. 상태: pre-run empty·running(progress)·error·partial.

## SCR-310 · Verification Scope (P, S16/S18)
- 입력 Feature 조건 → Mandatory Tests·Missing Evidence·Coverage Gap·Gate Result. "Send to Readiness"(G5).

## SCR-320 · Deployment Decision (P, S16/S20)
- 변경유형 체크 → Binary/Policy-only/Calibration/Manual + Confidence + Required Gates + Rollback Test. Policy-only 근거 4체크 표시.

## SCR-330 · Supplier Scope (P, S18/S32)
- Feature→Supplier Function→SWC/API 경로 → Supplier Scope·Acceptance·Contract Gap·Evidence Status.

## SCR-340 · Decision Center (N, S18)
```
┌ 의사결정 ▸ Decision Center ─ FEAT-BDC-001 / CR-2026-0142 ──────────────┐
│ Pipeline: Change→Lookup→①Impact→②Verify→③Deploy→④Supplier→Report       │
│ [Run ①][Run ②][Run ③][Run ④][Run All ▶]                                │
└──────────────────────────────────────────────────────────────────────┘
```

## SCR-341 · DecisionReport Viewer (N)
- 4 엔진 통합 리포트(①~④ 요약)·[Attach to CR][Export PDF][Submit for Approval].

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S18,S19,S31,S32) |

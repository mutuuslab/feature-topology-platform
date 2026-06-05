---
id: SCR-410
type: screen
title: "변경관리 화면군 / Change Mgmt Screens (G4)"
status: draft
version: 0.1.0
owner: governance
cycle: 39
traces:
  satisfies: [FR-23, FR-24, FR-21]
  implemented_by: [RULE-R12]
  realized_in_screen: [SCR-300, SCR-341]
  verified_by: [TC-023]
last_updated: 2026-06-05
---

# 변경관리 화면군 / Change Mgmt Screens (G4)

## SCR-400 · CR List (N)
- 전체 CR: status(Draft/Analyzed/Reviewed/Approved/Implemented/Closed)·owner·risk·영향 규모. 필터/저장뷰.

## SCR-401 · CR Detail (N)
- 단일 CR: 연결 DecisionReport·영향 set·gates·승인 이력·코멘트. 상태기계([[40-60-lifecycle-state-machine]]).

## SCR-410 · CR Wizard (5-step) (N)
```
[1 Define]→[2 Topology Lookup]→[3 Run Decisions]→[4 Review Report]→[5 Submit]
 ●─────────●──────────────────◐────────────────○──────────────○
```
1 Define(title/type/target/change_type) → 2 Lookup(영향 미리보기, SCR-300 재사용) → 3 Run(Impact/Verify/Deploy/Supplier 자동) → 4 Review(SCR-341 임베드) → 5 Submit(SCR-A20 승인자 라우팅). 각 step validation gate(FAIL 룰 시 advance 차단).

## SCR-420 · ChangeSet List (P, S40)
- ADD/MODIFY/REMOVE × 11영역 항목. 색상 코딩. "View Impact"(RULE-R12 자동 트리거 배너).

## SCR-421 · Baseline Diff (P, S40)
```
┌ 변경관리 ▸ Baseline Diff ─ FEAT-BDC-001 ─ v1.0 ↔ v1.1 ──────────────────┐
│ ➕ADD  Requirement   SEC-POLICY-004                                       │
│ ➕ADD  Architecture  SWC-POLICY-EVALUATOR / ECU-CCU                        │
│ ✏MOD  Variant       KR → KR/EU                                            │
│ ➕ADD  Control       POLICY-BDC-KILL-SWITCH                                │
│ ✏MOD  Supplier      API Contract v1.4 → v1.5                              │
├──────────────────────────────────────────────────────────────────────────┤
│ ADD 5 · MODIFY 2 → ⚡ Impact 자동 트리거 [View Impact →]                    │
└──────────────────────────────────────────────────────────────────────────┘
```
- side-by-side/inline 토글·버전 picker.

## SCR-422 · Version Timeline (N)
- Feature별 Baseline 연대기·각 시점 diff·audit 연결. (Feature Detail History 탭에서도 진입)

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S40) |

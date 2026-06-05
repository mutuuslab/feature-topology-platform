---
id: SCR-510
type: screen
title: "검증 화면군 / Verification Screens (G5)"
status: draft
version: 0.1.0
owner: verification-safety
cycle: 40
traces:
  satisfies: [FR-14, FR-22, FR-30]
  implemented_by: [GATE-G1, GATE-G5, ENT-TESTEVIDENCE]
  realized_in_screen: [SCR-310]
  verified_by: [TC-022]
  uses_diagram: [DIAG-FLW-GATES]
last_updated: 2026-06-05
---

# 검증 화면군 / Verification Screens (G5)

## SCR-500 · Test Evidence Manager (N)
- TestCase/TestEvidence 관리·coverage·result(pass/fail/pending) 필터. Feature별 검증 현황.

## SCR-501 · Evidence Detail (N)
- 단일 증적: result·coverage·evidence_uri·연결 TestCase/Feature.

## SCR-510 · Release Readiness Center — 9 Gate (P, S25)
```
┌ 검증 ▸ Release Readiness ─ FEAT-BDC-001 ──────────────── 8/9 PASS  [HOLD]┐
│ ①Feature ✅  ②Requirement ✅  ③Variant ✅  ④Control ✅                     │
│ ⑤Verification 🟠PENDING — OTA Rollback Test 완료 필요                       │
│ ⑥Supplier ✅  ⑦Safety/Security ✅  ⑧OTA ✅  ⑨Operations ✅                  │
├──────────────────────────────────────────────────────────────────────────┤
│ 🔴 Production 활성화 보류(HOLD) — OTA-RB-002 완료 후 ⑤ 재평가               │
│ [Re-evaluate] [Request Approval]   (Release 버튼: 전부 PASS + deploy verb) │
└──────────────────────────────────────────────────────────────────────────┘
```
- 9 Gate 카드(확장→evidence/approver/blocking·fix 링크 e.g. ⑤→SCR-500)·집계 배너(HOLD/RELEASE)·Re-evaluate(`run-engine`)·Request Approval(SCR-A20·ASIL escalation)·Release(`deploy`+all PASS).
- 상태: FAIL→red HOLD/Release 비활성·all PASS→green RELEASE·per-gate loading·no-permission.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S25) |

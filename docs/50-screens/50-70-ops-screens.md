---
id: SCR-620
type: screen
title: "배포·운영 화면군 / Deploy & Ops Screens (G6)"
status: draft
version: 0.1.0
owner: operations-sre
cycle: 41
traces:
  satisfies: [FR-13, FR-15, FR-16]
  implemented_by: [ENT-TELEMETRYEVENT, ENT-ROLLBACKPLAN, ENT-DEPLOYMENTUNIT]
  realized_in_screen: [SCR-510]
  verified_by: [TC-016]
last_updated: 2026-06-05
---

# 배포·운영 화면군 / Deploy & Ops Screens (G6)

## SCR-600/601 · OTA Campaign Manager / Detail (N)
- 캠페인 목록(Binary/Policy)·rollout %·cohort. Detail: 단계 rollout 5→20→100, cohort, guard.

## SCR-610 · Policy Lifecycle Board (P, S37)
- Draft→Review→Approved→Deployed→Monitored 칸반. 카드=정책 버전·승인자·rollout.

## SCR-620 · Operations Dashboard (P, S17)
```
┌ 배포·운영 ▸ Operations ─ FEAT-BDC-001 ──────────────────────────────────┐
│ Activation 98.7% │ Policy Apply 12/10K Fail │ Rollback 3 │ Runtime enabled│
├──────────────────────────────────────────┬──────────────────────────────┤
│ Recent Events                             │ Actions                       │
│ ✅POLICY_APPLY_SUCCESS pilot_kr_01         │ [Open Incident][Rollback]     │
│ ❌POLICY_APPLY_FAIL ECU version mismatch   │ [Export Audit][Update Topology]│
│ ↩POLICY_ROLLBACK previous stable          │ [Kill Switch →]               │
│ [Telemetry Explorer →]                    │ Alert: 실패율>10% (armed)      │
└──────────────────────────────────────────┴──────────────────────────────┘
```
- 6 운영추적(Runtime/Telemetry/DTC/Audit/Alert/Incident). Rollback(`rollback`)·Kill(`kill`) gated. Event-to-Action.

## SCR-630 · Telemetry Explorer (N)
- Feature/cohort별 이벤트 쿼리·시계열·성공률·필터(MQTT 수집).

## SCR-640/641 · Incident Manager / Detail (N, S17)
- Field issue/VOC를 Feature ID 연결. Detail: root cause·연결 CR/rollback·timeline.

## SCR-650 · Kill Switch Console (P, S41/S43)
```
┌ 배포·운영 ▸ Kill Switch ─ FEAT-BDC-001 ──────────── ⚠ DESTRUCTIVE ───────┐
│ Current: enabled · 98.7% · Cohort all (142,300)                          │
│ 🔴 KILL — Safe Default: disabled · Scope[All▾] · Reason[____]            │
│ Type "FEAT-BDC-001" to confirm: [________]            [ EXECUTE KILL ]    │
│ Staged Recovery: ○5% → ○20% → ○100%   [Begin]  (guard: telemetry ≥임계)  │
│ Audit: 모든 액션 기록(actor/time/reason)                                  │
└──────────────────────────────────────────────────────────────────────────┘
```
- 2-phase: Kill(type-to-confirm + `kill`, Safe Default 적용) / Staged recovery(단계 guard, abort/auto-rollback). FR-16.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S17,S37,S41,S43) |

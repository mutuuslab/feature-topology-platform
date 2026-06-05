---
id: FLW-KILLSWITCH
type: flow
title: "Kill Switch → Safe Default → 단계 복구 플로"
status: draft
version: 0.1.0
owner: operations-sre
cycle: 45
traces:
  satisfies: [FR-16, FR-15]
  realized_in_screen: [SCR-650, SCR-620]
  verified_by: [TC-016]
uses_diagram: [DIAG-SEQ-KILLSWITCH]
last_updated: 2026-06-05
---

# Kill Switch → Safe Default → 단계 복구 플로 (QW-2)

## 클릭 시나리오
| # | 화면 | 행동 | 반응 |
|---|---|---|---|
| 1 | SCR-620 | 이상 감지(실패율 3%→15%) | Alert→Incident |
| 2 | SCR-650 | Kill 진입·type-confirm·EXECUTE | 전체 차량 즉시 비활성화 |
| 3 | — | Safe Default 적용 | disabled 복귀·안전 확인 |
| 4 | SCR-641 | 원인 분석(Audit) | ECU FW mismatch |
| 5 | SCR-610 | Policy 수정·재배포 | Draft→Deployed |
| 6 | SCR-650 | 단계 복구 5→20→100 | 단계 guard(telemetry 임계) |

```mermaid
flowchart LR
  A[Telemetry Alert 실패율↑] --> B[Kill Switch Console]
  B --> C[Confirm + EXECUTE KILL]
  C --> D[Safe Default disabled]
  D --> E[Audit 원인분석: FW mismatch]
  E --> F[Policy 수정 재배포]
  F --> G[5% --guard--> 20% --guard--> 100%]
  G --> H[Telemetry 정상]
```

## Demo 구현 항목 (PoC, S41)
CCS→HPVC 정책 전달(REST→MQTT) · Jetson Feature Evaluator · `/cmd/kill-switch` MQTT · ECU 기본값 복귀(CAN) · Dashboard 실시간 · CCS 5/20/100 단계 제어.

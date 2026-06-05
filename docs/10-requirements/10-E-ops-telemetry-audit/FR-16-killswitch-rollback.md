---
id: FR-16
type: requirement
title: "Kill Switch / Rollback — 즉시 비활성화·단계 복구"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 11
standards: [OpenFeature, Unleash, ISO-24089]
traces:
  implemented_by: [ENT-ROLLBACKPLAN, ENT-CONTROLPOINT]
  realized_in_screen: [SCR-650]
  verified_by: [TC-016]
  depends_on: [FR-15]
last_updated: 2026-06-05
---

# FR-16 · Kill Switch / Rollback — 즉시 비활성화·단계 복구

## 1. 개요
Feature에 긴급 문제 발생 시 Kill Switch로 즉시 비활성화하고, Safe Default 적용 후 점진 복구한다.

## 2. 명세 — 6단계 시나리오
1. 정상 운영 → 2. 이상 감지(Telemetry Alert, 실패율 급증·DTC) → 3. Kill Switch 발동(수동/자동, 전체 차량 즉시 비활성화) → 4. Safe Default 적용(disabled, 안전 상태 확인) → 5. 원인 분석·수정(Audit 기반) → 6. 점진 복구(5%→20%→100%, Telemetry 정상 확인).

## 3. 업무 규칙
- Kill 실행은 type-to-confirm + `kill` verb(이중 게이트). Rollback은 `rollback` verb.
- 단계 복구는 각 단계 사이 Telemetry 성공률 임계 충족(guard) 시에만 다음 단계.
- 모든 액션(actor/time/reason) 감사 로그.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Kill 후 단계 복구 guard
  Given FEAT-BDC-001이 Kill 되어 Safe Default(disabled) 다
  And Policy가 수정·재배포되었다
  When 5% 복구를 시작한다
  Then Telemetry 성공률이 임계 이상일 때만 20%로 진행된다
```

## 5. 데이터 / 화면
ENT-ROLLBACKPLAN, ENT-CONTROLPOINT · SCR-650 Kill Switch Console.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S41,S43) |

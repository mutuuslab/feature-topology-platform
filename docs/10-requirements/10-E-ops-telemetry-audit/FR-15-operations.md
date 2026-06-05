---
id: FR-15
type: requirement
title: "Operations / Telemetry / Audit — 추적 6종·Event-to-Action"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 11
standards: [OpenFeature, ISO-24089, MQTT-5.0]
traces:
  implemented_by: [ENT-TELEMETRYEVENT, ENT-DTC]
  realized_in_screen: [SCR-620, SCR-630, SCR-640, SCR-910]
  verified_by: [TC-015]
last_updated: 2026-06-05
---

# FR-15 · Operations / Telemetry / Audit — 추적 6종·Event-to-Action

## 1. 개요
실차 운영 상태를 관측하고 이벤트를 증적화하며, 이상 발생 시 즉시 복구 액션으로 연결한다.

## 2. 명세 — 운영 추적 6종
| 항목 | 관리 목적 |
|---|---|
| Runtime State | enabled/disabled/degraded/blocked 추적 |
| Telemetry Event | 정책 적용 성공/실패·rollback·지연 수집 |
| DTC/Diagnostic | ECU 오류·센서 이상·진단 이벤트 연결 |
| Audit Log | 정책 변경자·시간·승인·배포 이력 |
| Alert Rule | 실패율 증가·rollback 증가·정책 지연 감지 |
| Incident | Field Issue·VOC·장애 Ticket과 Feature 연결 |

**Event-to-Action Loop:** Runtime(Evaluate) → Telemetry(Collect) → Alert(Detect) → Incident(Open) → Rollback/Kill Switch → Topology(Update).

## 3. 업무 규칙
- 모든 운영 데이터는 Feature ID 기준 저장 → Release 후에도 검증 증적·변경 이력 연결.
- 운영 데이터는 단순 지표가 아니라 Topology 갱신·복구 트리거 증적.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: 실패율 급증 시 Alert→Incident
  Given Alert Rule "실패율>10%"가 armed 다
  When 실패율이 3%→15%로 증가한다
  Then Alert이 발생하고 Incident가 FEAT-BDC-001에 연결되어 Open 된다
```

## 5. 데이터 / 화면
ENT-TELEMETRYEVENT, ENT-DTC · SCR-620/630/640/910.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S17) |

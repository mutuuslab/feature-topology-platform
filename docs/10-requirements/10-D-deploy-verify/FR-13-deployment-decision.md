---
id: FR-13
type: requirement
title: "Deployment Decision — 배포방식 판단"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 10
standards: [ISO-24089, UNECE-R156, OpenFeature]
traces:
  implemented_by: [ENG-DEPLOY, ENT-DEPLOYMENTUNIT]
  realized_in_screen: [SCR-320]
  verified_by: [TC-013]
last_updated: 2026-06-05
---

# FR-13 · Deployment Decision — 배포방식 판단

## 1. 개요
변경 유형을 분석해 배포 방식(Binary OTA / Policy-only / Calibration Update / Manual Review)을 자동 판단한다.

## 2. 명세 — 변경유형 → 배포방식
| 변경 유형 | 배포 방식 |
|---|---|
| SWC 코드 변경 | Binary OTA |
| ECU Adapter 변경 | Binary OTA + 통합 검증 |
| API/Signal/DTC 변경 | Binary OTA + Supplier |
| Targeting/Policy Rule 변경 | Policy-only Deploy |
| Variant Rule 변경 | Policy-only/Config |
| Calibration 변경 | Calibration Update |
| 긴급 기능 차단 | Policy-only Emergency |

Decision Rule: `IF SWC/API/ECU→Binary OTA; ELIF Policy/Variant→Policy-only; ELIF Calibration→Calibration Update; ELSE Manual Review`.

## 3. 업무 규칙
- Policy-only 판단 조건: SWC 변경 없음 + API Contract 변경 없음 + Runtime Context 추가 없음 + Rollback 정의됨.
- 출력: Deploy Type · Required Gates · Rollback Test · Manual Review 필요 여부.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: Targeting Rule만 변경 → Policy-only
  Given FEAT-BDC-001에서 Targeting Rule만 변경되고 SWC/API 변경이 없다
  When 배포방식을 판단한다
  Then Deploy Type=Policy-only, Confidence=High, Binary OTA 불필요
```

## 5. 데이터 / 화면
ENG-DEPLOY, ENT-DEPLOYMENTUNIT · SCR-320, SCR-101(Deploy 탭).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S16) |

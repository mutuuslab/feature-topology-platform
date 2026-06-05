---
id: FR-25
type: requirement
title: "외부 도구 연동 — ALM/PLM/FF/OTA"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 12
standards: [OMG-ReqIF-1.2, OpenAPI-3.2.0, OpenFeature, ISO-24089]
traces: { implemented_by: [INT-CODEBEAMER, INT-PLM, INT-UNLEASH, INT-OTA, INT-MQTT], realized_in_screen: [SCR-800, SCR-801, SCR-810], verified_by: [TC-025] }
last_updated: 2026-06-05
---

# FR-25 · 외부 도구 연동 — ALM/PLM/FF/OTA

## 1. 개요
ALM(Codebeamer)·PLM·Feature Flag(Unleash)·OTA·Test DB·Supplier Portal과 REST/Webhook으로 양방향 동기화하고 Audit Log를 수집한다. Feature ID 기반.

## 2. 명세
- 커넥터별 프로토콜/인증/필드 매핑/동기화 주기/충돌 해소. 상세 → 사이클 47.
- outbox 패턴으로 외부 장애를 코어 트랜잭션과 격리(NFR-3).

## 3. 인수 기준 (Gherkin)
```gherkin
Scenario: Codebeamer 요구사항 동기화
  Given Codebeamer 커넥터가 구성되어 있다
  When SYS-BODY-001 요구사항이 변경된다
  Then Webhook으로 수신되어 FEAT-BDC-001의 Requirement 링크가 갱신되고 Sync Log에 기록된다
```

## 4. 데이터 / 화면
INT-* · SCR-800 Connector Hub, SCR-810 Sync Logs.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S7,S13,S38) |

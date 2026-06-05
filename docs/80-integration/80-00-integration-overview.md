---
id: INT-OVERVIEW
type: integration
title: "연동 개요 / Integration Overview"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 47
standards: [OMG-ReqIF-1.2, OpenAPI-3.2.0, OpenFeature, ISO-24089, MQTT-5.0]
traces:
  satisfies: [FR-25]
  implemented_by: [INT-CODEBEAMER, INT-PLM, INT-UNLEASH, INT-OTA, INT-MQTT]
  realized_in_screen: [SCR-800, SCR-810]
  verified_by: [TC-025]
last_updated: 2026-06-05
---

# 연동 개요 / Integration Overview

## 1. 원칙
Feature ID 공통 Key·양방향 sync·outbox(코어 격리)·모든 sync Audit. 대체 아님, 연결.

## 2. 커넥터 매트릭스
| INT | 시스템 | 프로토콜 | 방향 | 표준 | 핵심 매핑 |
|---|---|---|---|---|---|
| INT-CODEBEAMER | ALM | REST + ReqIF 1.2 | bi | ReqIF | Requirement↔BOM(Requirement 영역) |
| INT-PLM | PLM | REST | in | — | Part/Config↔Variant·Architecture |
| INT-UNLEASH | Feature Flag | Admin/Client API + OpenFeature provider | bi | OpenFeature | ControlPoint↔Flag/Strategy, Variant→Policy export |
| INT-OTA | OTA 플랫폼 | REST/Webhook | bi | ISO 24089/R156 | DeploymentUnit↔Campaign, RxSWIN 증적 |
| INT-MQTT | 차량 EventBus | MQTT 5.0(retained+QoS1/2) | in | OASIS MQTT | TelemetryEvent 수집, 정책 배포 |

## 3. 동기화·충돌
- source-of-record 우선·timestamp·conflict 큐(SCR-810).
- outbox 패턴으로 외부 장애가 코어 트랜잭션 차단 안 함(NFR-3).

## 4. 상세
[[80-60-supplier-api-package]] · API 계약 [[80-90-api-contracts]].

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S7,S13,S38,S39) |

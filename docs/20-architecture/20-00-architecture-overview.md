---
id: ARC-OVERVIEW
type: architecture
title: "아키텍처 개요 (C4) / Architecture Overview"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 30
standards: [MBSE-ASoT, OMG-SysML-2.0]
traces:
  satisfies: [FR-6, FR-25, NFR-3, NFR-5]
  uses_diagram: [DIAG-C4-CONTEXT, DIAG-C4-CONTAINER]
last_updated: 2026-06-05
---

# 아키텍처 개요 (C4) / Architecture Overview

## 1. System Context (C4 L1) — ASoT 경계
```mermaid
flowchart TB
  subgraph FT["Feature Topology Registry (ASoT)"]
    R[Registry · Engines · Rules · UI]
  end
  ALM[Codebeamer ALM] <-->|ReqIF/REST| R
  PLM[PLM] <-->|REST| R
  FF[Unleash / OpenFeature] <-->|API| R
  OTA[OTA 플랫폼] <-->|REST/Webhook| R
  SUP[Supplier Portal] <-->|Package/OpenAPI| R
  TEL[차량/MQTT Telemetry] -->|events| R
  USERS[7 페르소나] --> R
```
ASoT는 원천을 대체하지 않고 Feature ID로 **연결·정합성·의사결정** 계층 추가.

## 2. Container (C4 L2) — 4 레이어 (PPT S13)
```mermaid
flowchart TB
  UI["UI/API Layer<br/>Catalog·Detail·Topology·Impact·Readiness·External API"]
  ENG["Engine Layer<br/>Impact·Verify·Deploy·Supplier·Consistency"]
  DATA["Data/Graph Layer<br/>Feature·BOM·Edge·Baseline·Variant·ControlPoint·Evidence"]
  INT["Integration Layer<br/>ALM·PLM·FF·OTA·Test DB·Supplier (양방향 sync·Audit)"]
  UI --> ENG --> DATA
  ENG --> INT
  INT --> DATA
```

## 3. 1차 구현 권고 (대안 A)
PostgreSQL(SoR) + Apache AGE(그래프) 단일 ACID + 모듈러 모놀리스(NestJS) + React/Cytoscape UI. 그래프/룰/런타임을 인터페이스로 추상화 → 대안 B(Neo4j·DMN·이벤트드리븐) 진화. (계획 §11)

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S13) |

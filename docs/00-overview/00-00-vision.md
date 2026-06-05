---
id: OVERVIEW-VISION
type: overview
title: "비전 / Vision"
status: approved
version: 1.0.0
owner: governance
cycle: 4
standards: [MBSE-ASoT, ISO/IEC/IEEE-29148]
traces:
  satisfies: []
  depends_on: []
last_updated: 2026-06-05
---

# 비전 / Vision

## 1. 한 문장 / One-liner
> **Feature Topology**는 현대자동차 SDV의 모든 Feature를 **Feature ID 하나로 묶어**, 기능 변경의
> **영향도·검증범위·배포방식·책임범위·복구경로를 사전에 자동 계산**하는 운영 기준정보 체계(ASoT)다.

## 2. 문제 (Why)
SDV에서 Feature 기준정보가 ALM·PLM·Feature Flag·OTA·운영 도구에 **분산**되어:
1. **기준정보 분산** — 같은 기능을 조직마다 다른 ID로 관리(공통 Key 부재)
2. **Traceability 단절** — 요구사항→SW→검증→운영 연결 약함(링크 누락 위험)
3. **운영 의사결정 리스크** — 배포·검증·복구 판단이 회의·경험에 의존(품질·안전 리스크)

## 3. 해결 (What)
Feature ID를 공통 Key로 요구사항·SWC·ECU·API·Variant·Policy·Test·Supplier·Telemetry를
**Typed Edge로 연결**하고, 그 위에서 **Decision Engine**이 변경 판단을 자동화한다.

## 4. 설계 원칙
1. 모든 Artifact는 Feature ID로 연결된다.
2. 변경 요청은 Topology Graph Query로 시작한다.
3. Release 판단은 Gate Evidence와 Rollback 경로를 포함한다.
4. **Flag ≠ Feature**, **Variant ≠ Control**, **Policy-only ≠ Binary OTA**.
5. Released Feature는 Evidence(검증·Telemetry) 연결 없이 운영하지 않는다.

## 5. 기대 효과 (목표치 — PoC/Baseline 검증 전)
영향도 분석 95%↓ · 검증 누락 90%↓ · 배포 판단 90%↓ · 불필요 Binary OTA 85%↓ · Feature 중복 80%↓.
(정량치는 Mutuus Lab 가설, 실측 검증 필요)

## 6. 범위 경계
→ [[00-10-scope-and-non-goals]] · 핵심 개념 → [[00-20-concept-feature-topology]] · 5 산출물 → [[00-30-five-outputs]]

---
출처/근거: PPT S1,S6,S22,S27,S34 · Mutuus Lab Feature Topology 설계안 · MBSE ASoT.

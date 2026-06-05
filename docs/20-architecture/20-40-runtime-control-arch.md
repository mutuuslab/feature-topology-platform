---
id: ARC-RUNTIME
type: architecture
title: "런타임 제어 & 배포 토폴로지 아키텍처"
status: draft
version: 0.1.0
owner: variant-deploy-manager
cycle: 32
standards: [OpenFeature, Unleash, MQTT-5.0, AUTOSAR-Adaptive, ISO-24089]
traces:
  satisfies: [FR-9, FR-10, FR-11, FR-12, FR-16]
  uses_diagram: [DIAG-CLS-VARIANT-CONTROL]
last_updated: 2026-06-05
---

# 런타임 제어 & 배포 토폴로지 아키텍처

## 1. 3-레이어 활성화 (Variant ≠ Control ≠ Runtime)
```mermaid
flowchart LR
  V["Variant Filter<br/>(구조적 적용가능성)"] --> C["Control Gate<br/>(운영시점 활성화)"] --> RS["Runtime State<br/>(실차 결과)"]
```
`ON ⟺ Variant=PASS ∧ Control=ALLOW ∧ Runtime=VALID`.

## 2. 차량 내부 3중 Guard
Policy 수신(MQTT retained) → Capability Check → Vehicle State Check → Auth Check → Flag 평가(OpenFeature) → 실행/Safe Default.

## 3. 배포 토폴로지 (PoC ↔ 양산)
- PoC: CCS(Mock Server) → HPVC(Jetson Orin, Feature Evaluator) → GCS(RPi5) → ECU(STM32). REST(서버↔차량) + MQTT(차량 내부 EventBus).
- 양산 타깃: AUTOSAR Adaptive UCM(업데이트) + SOME/IP-SD(서비스 디스커버리). (갭 — 추가 사양 필요)

## 4. 배포 방식 분리
Binary OTA(SWC/API/ECU) vs Policy-only(Unleash policy 배포, 바이너리 무변경) vs Calibration. (→ [[40-40-engine-deployment-decision]])

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S37,S39) |

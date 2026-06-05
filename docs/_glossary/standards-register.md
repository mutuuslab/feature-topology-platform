---
id: STANDARDS-REGISTER
type: glossary
title: "표준 등록부 / Standards Register"
status: approved
version: 1.0.0
owner: governance
cycle: 3
last_updated: 2026-06-05
---

# 표준 등록부 / Standards Register

본 설계가 인용·준수하는 외부 표준/규제/도구. (웹 검증 완료 — 버전 플래그 포함)

## 요구사항·MBSE
| 표준 | 버전/상태 | 본 시스템과의 매핑 |
|---|---|---|
| ISO/IEC/IEEE 29148 | **2018** (현행) | 요구사항 정보항목·속성·추적성 근간. FR 명세 형식 |
| OMG SysML | **v2.0** (2025-07 정식 채택, KerML 1.0 기반, REST/HTTP API) | MBSE 모델·기계가독 추적성. "beta 아님" |
| OMG ReqIF | **1.2** | 요구사항 교환(Codebeamer/DOORS 라운드트립). INT-CODEBEAMER |
| MBSE ASoT | 개념(표준 아님) | 플랫폼의 핵심 명제(Authoritative Source of Truth) |
| FODA / Feature Modeling | Kang et al. 1990 | requires/excludes 등 cross-tree 제약 → Typed Edge + SAT 만족성 |

## 소프트웨어 업데이트·기능안전·보안
| 표준 | 버전/상태 | 매핑 |
|---|---|---|
| ISO 24089 | **2023** (Amd 1:2024) ⚠️ "ISO/SAE 24089" 오기 주의 — ISO 단독 | SW 업데이트 엔지니어링. OTA Gate·배포 증적 |
| UNECE R156 | 발효(WP.29) | **SUMS**(SW Update Mgmt System) 법규. RxSWIN·배포 증적 — OTA/Operations Gate |
| UNECE R155 | 발효(WP.29) | **CSMS**(Cyber Security Mgmt System). Security Gate |
| ISO 26262 | **2018** (2nd ed) | 기능안전·ASIL A~D. Safety Gate (단, "Safety Gate"는 관행 용어) |
| ISO/SAE 21434 | **2021** | 자동차 사이버보안 엔지니어링·TARA. R155의 엔지니어링 실체 |
| Uptane | (OTA 보안 프레임워크) | Binary OTA 무결성 증적 (갭 — 사이클 47 반영) |

## 의사결정·API·런타임
| 표준/도구 | 버전/상태 | 매핑 |
|---|---|---|
| OMG DMN | **1.5** 정식 (1.6 beta) | Consistency Rule·Decision Engine 결정표 |
| OMG BPMN | **2.0.2** (=ISO/IEC 19510, "3.0" 없음) | 승인/라이프사이클 워크플로 |
| OpenAPI | **3.2.0** (2025-09 실재 — 가짜 아님; QUERY·tag 계층·스트리밍) | Supplier API 계약·REST 명세 |
| OpenFeature (CNCF) | 현행 | 벤더중립 Flag 추상화(Evaluation Context·Provider·Hooks·Tracking) |
| Unleash | 현행 | Feature Flag 플랫폼(strategy·constraint·segment·kill-switch·Edge). ⚠️ ASIL 미인증 → QM 한정 |
| MQTT (OASIS) | **5.0** (3.1.1 병존) | 정책 배포(retained+QoS1/2)·Telemetry. In-vehicle EventBus |
| AUTOSAR Adaptive | 현행 | 실제 배포 타깃 레이어(UCM·SOME/IP-SD) — 갭, 사이클 32/47 |

## 개념 정합성 (업계 타당 확인)
- `Flag ≠ Feature` — Flag는 제어점, Feature는 능력. OpenFeature/Unleash 일치.
- `Variant ≠ Control` — 구조적 적용 vs 운영시점 활성. Unleash variant/strategy와 일치.
- `Policy-only ≠ Binary OTA` — 릴리스/배포 분리. SDV/OTA 실무와 일치.

## 미반영 갭(해당 사이클에서 보강)
UNECE R155/R156·RxSWIN 매핑(C33), AUTOSAR Adaptive UCM/SOME/IP-SD(C32/47), Uptane(C47), FODA SAT/BDD 만족성(C23), RBAC/승인 워크플로(C43), 도구 연동 필드 매핑(C47/48).

---
출처/근거: 웹 검증(2026-01 기준) · ISO/OMG/UNECE/OpenAPI/CNCF 공식 문서.

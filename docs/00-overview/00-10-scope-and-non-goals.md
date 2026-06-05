---
id: OVERVIEW-SCOPE
type: overview
title: "범위 & Non-Goals / Scope & Non-Goals"
status: approved
version: 1.0.0
owner: governance
cycle: 4
last_updated: 2026-06-05
---

# 범위 & Non-Goals / Scope & Non-Goals

## 1. In Scope (포함)
- Feature 기준정보 관리: Definition·Taxonomy(L0~L5)·BOM(11영역)·Catalog
- 관계 모델: 10 Typed Edge·18 Entity Metamodel·12 Consistency Rule·Topology Graph
- Variant/Control/Runtime 분리 모델
- 4 Decision Engine(Impact·Verification·Deploy·Supplier) + DecisionReport
- 거버넌스: Lifecycle 6상태·9 Release Readiness Gate·Baseline/ChangeSet·Audit
- 운영 관측: Telemetry·Incident·Kill Switch·Rollback (Feature ID 귀속)
- 외부 도구 연동(Codebeamer/PLM/Unleash/OTA/MQTT)·Supplier API Release Package
- 전체 UI(60 화면)·RBAC·승인 워크플로

## 2. Non-Goals (제외 — 명시적)
| 비목표 | 이유 / 경계 |
|---|---|
| ALM 대체 | 요구사항·테스트 관리는 Codebeamer가 수행. Feature Topology는 **연결**만 |
| PLM 대체 | 부품·제품 구성 관리는 PLM. Feature ID로 참조 |
| Feature Flag 런타임 엔진 대체 | 런타임 ON/OFF·Rollout은 Unleash/OpenFeature. Topology는 Control Point를 **기준정보로 격상** 관리 |
| OTA 배포 실행기 대체 | 실제 패키지 전송은 OTA 플랫폼. Topology는 **배포방식 판단·증적** |
| 원천 데이터 복제 | BOM은 원천 ID·링크만 보유, 데이터 사본 보관 안 함 |
| 차량 내 실시간 안전 제어 | 실차 안전 로직은 ECU/AUTOSAR. 비안전(QM) 정책 활성화 계층만 |

## 3. 전제 (Assumptions)
- Feature ID가 전 조직 공통 Key로 합의·채택된다.
- 외부 도구가 REST/Webhook/ReqIF 연동 인터페이스를 제공한다.
- 안전등급(ASIL) Feature는 별도 승인 프로세스를 거친다.

## 4. 포지셔닝
→ [[00-90-standards-landscape]] (도구 비교) · ASoT 경계는 [[20-00-architecture-overview]](사이클 30)에서 C4로 상세화.

---
출처/근거: PPT S6,S7,S13,S22,S38 · 표준 register.

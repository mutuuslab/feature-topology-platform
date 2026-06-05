---
id: GLOSSARY
type: glossary
title: "핵심 용어집 / Glossary"
status: approved
version: 1.0.0
owner: feature-architect
cycle: 3
standards: [ISO/IEC/IEEE-29148, OpenFeature, OMG-ReqIF-1.2]
last_updated: 2026-06-05
---

# 핵심 용어집 / Glossary (KO / EN)

| 용어 | 정의 |
|---|---|
| **Feature** | 고객/차량 동작 관점에서 식별 가능한 기능 단위. 요구사항·검증·배포·책임을 독립 관리. (Flag/Parameter/Signal/DTC는 Feature가 아닌 하위 Artifact) |
| **Feature Taxonomy** | Feature를 L0~L5로 분류·계층화하는 체계. **기준 Feature = L2 (Vehicle/System Feature)** |
| **Feature BOM** | Feature 실현을 위한 **11개 영역**의 구성 목록(요구사항~운영). 원천을 복제하지 않고 ID·링크 보유 |
| **Feature Modeling** | Feature 간 논리 관계를 **Typed Edge**(parent_of/requires/excludes/fallback_to 등 10종)로 정의 |
| **Feature Topology** | BOM 구성요소 + Relationship Edge + Decision Context를 연결한 **Feature 중심 관계 그래프** |
| **Topology Registry** | Taxonomy·BOM·Modeling·Topology를 저장·조회·분석하는 **Source of Truth (ASoT)** |
| **ASoT** | Authoritative Source of Truth — 모든 이해관계자가 참조하는 단일 권위 저장소. 변경 자동 전파·추적성 |
| **Feature ID** | 7개 조직(기획·시스템·SW·검증·OTA·협력사·운영)의 서로 다른 명칭을 잇는 **공통 Key** |
| **Variant Rule** | Feature가 어떤 **구조적 조건**(차종·지역·트림·HW/SW)에 적용 가능한지 정의 (적용 가능성) |
| **Control Point** | Feature를 제어하는 Policy·Flag·Parameter·Kill-switch·Safe Default (**운영시점 활성화**) |
| **Variant ≠ Control** | Variant=적용 가능한 차량(구조적), Control=현재 활성화 조건(운영시점). 이 분리가 Policy-only를 가능케 함 |
| **Runtime State** | 실차 평가 결과 상태: enabled/disabled/degraded/blocked/policy_apply_fail/rollback_required |
| **Policy-only Deploy** | SWC/API 변경 없이 **정책 조건만** 배포 (Binary OTA 불필요) |
| **Binary OTA** | 새 바이너리/이미지를 배포하는 방식 (SWC/API/ECU 변경 시) |
| **Kill Switch** | 긴급 상황에 Feature를 **즉시 비활성화**하는 제어 메커니즘 |
| **Safe Default** | Policy 평가 실패/오프라인 시 적용되는 기본 안전 상태 |
| **Rollback Plan** | 문제 발생 시 이전 안정 상태로 복구하는 **사전 정의 절차** |
| **Release Readiness** | Production 활성화 전 **9개 Gate** 통과 여부를 점검하는 자동 검증 체계 |
| **Gate** | 데이터 품질/배포 준비 검문 지점. PASS / PENDING / FAIL |
| **Consistency Rule** | 누락·충돌·승인 누수를 차단하는 **12종 자동 품질 게이트** |
| **Impact Analysis** | Feature 변경 시 Topology를 탐색해 영향 전체 범위를 자동 산출 |
| **Verification Scope** | Feature 조건 조합으로 필수 Test·Missing Evidence·Coverage Gap을 자동 도출 |
| **Decision Engine** | Topology 기반으로 영향도·검증·배포·협력사 책임을 자동 판단하는 엔진(4종) |
| **DecisionReport** | 4 엔진 결과(Impact+Verify+Deploy+Supplier)를 통합한 단일 의사결정 산출물 |
| **ChangeSet** | BOM 변경의 ADD/MODIFY/REMOVE 기록 단위. Baseline Diff·자동 Impact 트리거 |
| **Baseline** | 특정 시점의 Feature BOM 스냅샷 (버전) |
| **Supplier Function** | 협력사 ECU/SW 기능 식별자 (예: BDC_FUNC_032). OEM Feature ID와 매핑 |
| **Supplier API Release Package** | 협력사가 문서 대신 배포하는 **Feature ID 기반 검증 가능 계약 패키지(10항목)** |
| **Telemetry Event** | 정책 적용 성공/실패·rollback·지연 등 실차 운영 이벤트 (Feature ID 귀속) |
| **Lifecycle** | Proposed→Approved→Developing→Verified→Released→Retired |
| **L2 기준 Feature** | 요구사항·검증·Variant·Gate의 기준 단위 (Vehicle/System Feature) |

---
출처/근거: PPT S30 Glossary · ISO/IEC/IEEE 29148:2018 · OpenFeature Glossary · OMG ReqIF 1.2 · Mutuus Lab 용어 정의.
관련: [[standards-register]] · [[abbreviations]]

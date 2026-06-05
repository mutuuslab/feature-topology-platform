---
id: FR-1
type: requirement
title: "Feature Definition — 등록 단위·7 Criteria·제외 기준"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 7
standards: [ISO/IEC/IEEE-29148, OMG-SysML-2.0, OpenFeature]
traces:
  satisfies: []
  refines: []
  implemented_by: [ENT-FEATURE, RULE-R01, RULE-R02]
  realized_in_screen: [SCR-130, SCR-100, SCR-101]
  verified_by: [TC-001]
  depends_on: [FR-2]
rbac:
  visible_to: [requirements-engineer, feature-architect, governance]
  edit: [requirements-engineer]
last_updated: 2026-06-05
---

# FR-1 · Feature Definition — 등록 단위·7 Criteria·제외 기준

## 1. 개요 / Overview
시스템은 후보 항목을 **Feature / BOM 하위요소 / 제외 대상**으로 분류하는 등록 판단 기능을 제공한다.
Feature = *고객/차량 동작 관점에서 식별 가능하고, 요구사항·구현·검증·배포·활성화·운영·책임을 독립 관리해야 하는 기능 단위*.

## 2. 목적 & 범위 / Purpose & Scope
- 포함: 등록 판단 Flow, 7 Criteria 평가, 최소 속성 검증, 등록 결정, 제외 항목 분류.
- 제외: Flag/Parameter/Signal/DTC는 Feature가 아니라 하위 Artifact로 분류(아래 4절).

## 3. 행위자 / Actors
| 페르소나 | 역할 |
|---|---|
| P1 기획 | 후보(고객 기능명) 제안 |
| P2 시스템 | 시스템 요구·SW 기능 후보 등록 |
| Governance | 등록 승인 |

## 4. 명세 / Specification

### 4.1 등록 판단 Flow (4단계)
1. **Candidate 수집** — 고객 기능명·시스템 요구·SW 기능·Flag·Signal 후보.
2. **7 Criteria 평가** — Evidence 유무로 판단(점수 아님).
3. **필수 속성 확인** — Owner·Source·Verification·Applicability·Lifecycle 존재.
4. **등록 결정** — Feature 등록 / BOM 하위요소 분류 / 보류·제외.

### 4.2 7가지 판단 기준 (Pass Signal)
| # | 기준 | Pass Signal |
|---|---|---|
| 1 | 고객/차량 가치 | 고객 인지 또는 차량 동작 변경 |
| 2 | 요구사항화 가능 | 입력·출력·조건·예외 명세 가능 |
| 3 | 독립 검증 가능 | 독립 Test Case/검증 조건 존재 |
| 4 | 적용 조건 존재 | 차종·지역·트림·HW/SW 차이 |
| 5 | 배포/활성화 제어 | OTA·Policy-only·Kill-switch 대상 |
| 6 | Owner 지정 가능 | 개발·검증·운영·협력사 책임 지정 |
| 7 | 운영 모니터링 필요 | Telemetry·DTC·Audit 관측 필요 |

### 4.3 최소 속성 (등록 시 필수)
`Feature ID · Level · Owner · Source · Requirement Link · Verification Method · Applicability · Lifecycle`

### 4.4 Feature가 아닌 항목의 분류 (제외 기준)
| 후보 | 등록 위치 | 예시 |
|---|---|---|
| Flag | Control Point | `enable_xxx` |
| Parameter | Parameter Catalog | Threshold |
| Signal/API Field | Interface BOM | CAN/API Field |
| DTC/Event | Telemetry Mapping | Diagnostic Event |
| Internal Function | SWC 내부 설계 | private method |
| if 조건문 | Code Logic | static analysis |

## 5. 업무 규칙 / Business Rules
- **BR-1 (Registration Rule):** 7기준 중 **4개 이상** + Owner/Verification/Applicability 정의 시 Feature 후보 등록.
- **BR-2 (Granularity):** 기준 Feature = L2 / L3 = 구현·협력사 단위 / L4 Flag·Parameter = Control Point.
- **BR-3:** 등록 직후 RULE-R01(≥1 Requirement)·R02(Owner) 평가, 초기 상태 = Proposed.

## 6. 인수 기준 / Acceptance Criteria (Gherkin)
```gherkin
Scenario: 4개 이상 기준 충족 시 Feature 등록
  Given 후보 "BDC Policy Control"이 7기준 중 6개를 충족하고
    And Owner·Verification·Applicability가 정의되었다
  When 등록 결정을 실행한다
  Then "FEAT-BDC-001"이 Lifecycle=Proposed 로 생성된다
    And RULE-R02(Owner) 가 PASS 다

Scenario: 기준 미달 후보는 BOM 하위요소로 분류
  Given 후보 "enable_bdc_remote"가 Flag 성격이다
  When 등록 결정을 실행한다
  Then Feature로 등록되지 않고 Control Point 후보로 분류된다
```

## 7. 데이터 / Data
| 엔티티 | 용도 |
|---|---|
| ENT-FEATURE | 등록 대상 |
| ENT-CONTROLPOINT | 제외된 Flag 귀속 |
| ENT-REQUIREMENT | Requirement Link |

## 8. 화면 매핑 / Screen Mapping
| 화면 | 역할 |
|---|---|
| SCR-130 Feature Definition Wizard | 7-criteria 등록 |
| SCR-100 Catalog | 등록 결과 목록 |
| SCR-101 Feature Detail | 등록 후 상세 |

## 9. 표준 참조 / Standards
ISO/IEC/IEEE 29148(요구사항 정보항목) · OMG SysML 2.0 · OpenFeature(Flag≠Feature).

## 10. 미해결 / Open Questions
- 보류(Hold) 상태의 재평가 주기?

## 변경 이력 / Change History
| 버전 | 일자 | 내용 |
|---|---|---|
| 0.1.0 | 2026-06-05 | 초안 (PPT S8 기반) |

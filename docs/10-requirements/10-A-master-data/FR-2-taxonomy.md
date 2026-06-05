---
id: FR-2
type: requirement
title: "Feature Taxonomy — L0~L5·L2 기준·ID 규칙"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 7
standards: [ISO/IEC/IEEE-29148, OMG-SysML-2.0, FODA]
traces:
  implemented_by: [ENT-TAXONOMYNODE, ENT-FEATURE]
  realized_in_screen: [SCR-110, SCR-111]
  verified_by: [TC-002]
  depends_on: [FR-1]
last_updated: 2026-06-05
---

# FR-2 · Feature Taxonomy — L0~L5·L2 기준·ID 규칙

## 1. 개요
Taxonomy는 Feature ID의 의미·소유·검증·배포 경계를 고정하여 Topology Graph의 Parent/Child와 영향도 분석 단위를 일관되게 만든다. **기준 Feature = L2**.

## 2. 명세 — Level 설계
| Level | 관리 목적 | Registry Object | 필수 연결 |
|---|---|---|---|
| L0 | Domain/Capability | TaxonomyNode | L1 child |
| L1 | Customer/Business Feature | Feature Cluster | L2 child |
| **L2** | **Vehicle/System Feature (기준)** | Feature Master | Requirement·Variant·Test |
| L3 | Software Feature | Feature/Supplier Function | SWC·ECU·Supplier |
| L4 | Policy/Flag/Parameter | ControlPoint | Policy·Safe Default |
| L5 | Code/Signal/Internal Logic | Implementation Item | API·Signal·DTC |

예시(Body Comfort): L0 Body Comfort → L1 Remote Door Lock → L2 Remote Door Lock Command → L3 BDC Door Lock Policy Control → L4 `bdc.door_lock.remote_enable` → L5 DoorLockState.

## 3. ID / Naming Rule
- L2 Feature: `FEAT-{DOMAIN}-{NNN}` (예 FEAT-BDC-001)
- L3 SW Feature: `FEAT-{DOMAIN}-{SW}-{NNN}`
- L4 Control Point: `CP-{FEATURE}-{TYPE}`
- DisplayName = 고객/차량 관점, InternalAlias = 조직별 명칭 매핑.

## 4. 업무 규칙 (Taxonomy Consistency)
- **T-001:** L2 Feature는 Parent L1과 최소 1 Requirement를 가져야 함.
- **T-002:** L4 Control Point는 반드시 L2/L3 Feature에 귀속.
- **T-003:** L3 Feature는 SWC/ECU/Supplier 중 1개 이상 연결.
- **T-004:** L0/L1은 DeploymentUnit으로 직접 연결 금지.

## 5. 인수 기준 (Gherkin)
```gherkin
Scenario: L4 Control Point는 상위 Feature 귀속 필수 (T-002)
  Given Control Point "CP-BDC-001-POLICY"를 생성한다
  When 귀속 L2/L3 Feature를 지정하지 않는다
  Then 저장이 차단되고 T-002 위반 메시지가 표시된다
```

## 6. 데이터 / 화면
ENT-TAXONOMYNODE, ENT-FEATURE · SCR-110 Browser, SCR-111 Editor.

## 7. 표준
FODA(계층·cross-tree) · SysML 2.0 · 29148.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S9) |

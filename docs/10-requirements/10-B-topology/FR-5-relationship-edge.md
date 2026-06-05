---
id: FR-5
type: requirement
title: "Relationship Edge — 10종 Typed Edge"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 8
standards: [FODA, OMG-SysML-2.0, ISO/IEC/IEEE-29148]
traces:
  implemented_by: [EDG-PARENT-OF, EDG-REQUIRES, EDG-EXCLUDES, EDG-OVERRIDES, EDG-FALLBACK-TO, EDG-DEGRADES-TO, EDG-REPLACES, EDG-DUPLICATES, EDG-COMPOSED-OF, EDG-CHILD-OF, RULE-EQ1, RULE-EQ2, RULE-EQ3, RULE-EQ4]
  realized_in_screen: [SCR-210, SCR-200]
  verified_by: [TC-005]
  depends_on: [FR-7]
last_updated: 2026-06-05
---

# FR-5 · Relationship Edge — 10종 Typed Edge

## 1. 개요
Feature 간 논리 관계를 **타입·방향·조건·상태를 가진 데이터(Typed Edge)** 로 정의해 Graph Traversal·Gate Check·Change Impact를 자동화한다. (자유 텍스트 금지)

## 2. 명세 — 10종 Edge
| 구분 | Edge | 의미/검증 목적 |
|---|---|---|
| 구조 | parent_of / child_of | 상·하위 분해, L0~L5 정합성 |
| 구조 | composed_of | 복합 Feature를 하위 단위로 구성 |
| 의존 | requires | 활성화 선행조건, 종속 동반 검증 |
| 충돌 | excludes | 동시 활성 금지, Variant/Policy 충돌 차단 |
| 우선 | overrides | Kill-switch/긴급정책 상위 우선 |
| 복구 | fallback_to | 정책 실패 시 이전 안정 상태 복귀 |
| 저하 | degrades_to | 장애 시 저하/safe behavior |
| 전환 | replaces | Legacy 대체·migration trace |
| 정리 | duplicates | 유사/중복 후보 탐지 |

## 3. Edge 공통 Schema (6 그룹)
Identity(edge_id,source_id,target_id,relationship_type) · Semantics(direction,cardinality,criticality,relation_group) · Condition(variant_scope,policy_condition,lifecycle_status) · Governance(owner_team,source_system,approval_state,baseline_ver) · Analysis(impact_weight,gate_rule,evidence_link,confidence) · Runtime(priority,safe_default,fallback_target,timeout). → 상세 [[30-60-feature-edges]].

## 4. 업무 규칙 (Edge 품질)
- **RULE-EQ1 No Cycle:** parent_of/requires 순환 금지.
- **RULE-EQ2 Dependency Gate:** requires 대상은 Approved/Released.
- **RULE-EQ3 Conflict Gate:** excludes/overrides 충돌 시 배포 차단.
- **RULE-EQ4 Recovery Gate:** Runtime Control은 fallback_to 또는 Safe Default 필요.

## 5. 인수 기준 (Gherkin)
```gherkin
Scenario: requires 순환 차단 (EQ1)
  Given FEAT-A requires FEAT-B, FEAT-B requires FEAT-C 가 있다
  When FEAT-C requires FEAT-A 엣지를 추가하려 한다
  Then 저장이 차단되고 "순환(No Cycle) 위반"이 표시된다
```

## 6. 데이터 / 화면
EDG-* · SCR-210 Edge Editor, SCR-200 Graph.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S11) |

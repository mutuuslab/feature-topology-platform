---
id: ENT-CONTROLPOINT
type: entity
title: "Control & Deployment 엔티티 (4)"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 16
standards: [OpenFeature, Unleash, ISO-24089]
traces:
  satisfies: [FR-7, FR-9, FR-10, FR-13, FR-16]
  realized_in_screen: [SCR-141, SCR-600, SCR-650]
  verified_by: [TC-007]
  depends_on: [ENT-FEATURE]
last_updated: 2026-06-05
---

# Control & Deployment 엔티티

## ENT-VARIANTRULE
```yaml
entity: VariantRule
group: control-deploy
attributes:
  - { name: id, type: id, pk: true, pattern: "VAR-{FEATURE}-{NNN}" }
  - { name: feature_id, type: id_ref, required: true }
  - { name: condition, type: string, note: "IF region IN[...] AND ... THEN allowed/blocked" }
  - { name: dimensions, type: list, note: "platform,region,model_year,trim,hw_gen,sw_ver" }
  - { name: result, type: enum, values: [allowed, blocked] }
constraints: ["RULE-R07: 없으면 Production 불가"]
```

## ENT-CONTROLPOINT  (핵심)
```yaml
entity: ControlPoint
group: control-deploy
attributes:
  - { name: id, type: id, pk: true, pattern: "CP-{FEATURE}-{TYPE}" }
  - { name: type, type: enum, values: [POLICY,FLAG,PARAM,KILL,SAFE], required: true }
  - { name: feature_id, type: id_ref, required: true, note: "L2/L3 귀속 (T-002)" }
  - { name: targeting, type: string }
  - { name: rollout_pct, type: int, range: "0..100" }
  - { name: cohort, type: string }
  - { name: kill_switch_state, type: enum, values: [ON,OFF] }
  - { name: safe_default, type: string, required: true, note: "RULE-R04" }
  - { name: rollback_plan_id, type: id_ref }
constraints: ["RULE-R04 Safe Default 필수", "RULE-R10 Deprecated 시 신규 생성 차단"]
```

## ENT-DEPLOYMENTUNIT
```yaml
entity: DeploymentUnit
group: control-deploy
attributes:
  - { name: id, type: id, pk: true, pattern: "DEP-{FEATURE}-{NNN}" }
  - { name: deploy_type, type: enum, values: [Binary,Policy-only,Calibration,Manual] }
  - { name: package_ref, type: uri, note: "예: PKG-POLICY-BDC-2027" }
  - { name: rollout_stages, type: list, default: [5,20,100] }
```

## ENT-ROLLBACKPLAN
```yaml
entity: RollbackPlan
group: control-deploy
attributes:
  - { name: id, type: id, pk: true, pattern: "RB-{FEATURE}-{NNN}" }
  - { name: target_state, type: string, note: "previous stable" }
  - { name: trigger, type: enum, values: [manual,auto] }
  - { name: guard, type: string, note: "단계 복구 telemetry 임계" }
constraints: ["RULE-R05 Policy-only → 필수", "RULE-EQ4 Recovery Gate"]
```

## 예시 (FEAT-BDC-001)
POLICY-BDC-ENABLE · CP-BDC-001-KILL · Safe Default=disabled · DEP Policy-only · RB→previous stable policy.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S16,S40) |

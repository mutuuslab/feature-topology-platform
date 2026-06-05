---
id: ARC-ID-KEY
type: entity
title: "Feature ID / Key 스킴"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 20
standards: [OMG-ReqIF-1.2]
traces:
  satisfies: [FR-1, FR-2]
  verified_by: [TC-002]
last_updated: 2026-06-05
---

# Feature ID / Key 스킴 (도메인 데이터)

> 문서 추적성 ID(FR-/ENT-/SCR-…)와 **별개**. 여기서는 차량 도메인 데이터의 ID 규칙.

## 1. 패턴
```yaml
id_rules:
  domains: [BDC, BODY, ADAS, CONN, SEAT, LIGHT, PARK, RUNTIME, MANUAL, POLICY]  # 확장 registry
  patterns:
    L2_feature:    "FEAT-{DOMAIN}-{NNN}"        # FEAT-BDC-001
    L3_sw_feature: "FEAT-{DOMAIN}-{SW}-{NNN}"    # FEAT-BDC-EVAL-001
    control_point: "CP-{FEATURE}-{TYPE}"         # CP-BDC-001-POLICY ; TYPE∈{POLICY,FLAG,PARAM,KILL,SAFE}
    requirement:   "{KIND}-{DOMAIN}-{NNN}"       # SYS-BODY-001 ; KIND∈{SYS,SWE,SEC,FUN,NFR}
    swc:           "SWC-{DOMAIN}-{NAME}"          # SWC-BDC-ADAPTER
    ecu:           "ECU-{NAME}"                   # ECU-BDC
    api:           "API-{DOMAIN}-{NAME}"          # API-BDC-POLICY-CONTROL
    test:          "{HIL|OTA|TEL}-{DOMAIN}-{NNN}" # HIL-BDC-001
    package:       "PKG-{TYPE}-{DOMAIN}-{YEAR}"   # PKG-POLICY-BDC-2027
```

## 2. Display vs Internal
- `display_name` — 고객/차량 관점 (한글). `internal_alias` — 조직별 명칭 매핑.
- 7개 조직의 서로 다른 명칭이 **하나의 Feature ID**로 수렴(PPT S36).

## 3. 공통 Key 원칙
Feature ID = 요구사항·SWC·ECU·API·Variant·Policy·Test·Supplier·Telemetry의 외부 참조키.

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S9,S36) |

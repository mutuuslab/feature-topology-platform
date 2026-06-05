---
id: FR-9
type: requirement
title: "Variant Filter — 구조적 적용가능성"
status: draft
version: 0.1.0
owner: requirements-engineer
cycle: 9
standards: [OpenFeature, FODA]
traces:
  implemented_by: [ENT-VARIANTRULE]
  realized_in_screen: [SCR-220, SCR-101]
  verified_by: [TC-009]
last_updated: 2026-06-05
---

# FR-9 · Variant Filter — 구조적 적용가능성

## 1. 개요
"이 Feature가 이 차량에 **적용 가능한가**?"를 판단하는 **구조적 조건** 필터. Control(운영시점)과 분리되어야 Policy-only 운영이 가능하다.

## 2. 명세
- 판단 차원: Platform/차종 · Region/Market · Model Year/Trim · HW Generation · SW Version/Capability.
- Variant Matrix + Rule Builder(조건식)·Capability Check·Conflict Detection·Cohort Preview·Export to Policy.
- 결과: Allowed / Blocked.

예시 Rule:
```
IF region IN [KR,EU] AND modelYear>=2027 AND trim IN [Premium]
   AND bdc.hw.generation==Gen3 AND bdc.sw.version>=3.2.0
THEN allowed ELSE blocked
```

## 3. 업무 규칙
- **R07 연계:** Variant Rule이 없으면 Production 활성화 불가.
- Variant는 구조적, Control은 운영시점 — 혼동 금지.

## 4. 인수 기준 (Gherkin)
```gherkin
Scenario: US 지역 차량은 Blocked
  Given FEAT-BDC-001의 Variant Rule이 region IN [KR,EU]를 요구한다
  When region=US 차량을 평가한다
  Then applicability=Blocked 이다
```

## 5. 데이터 / 화면
ENT-VARIANTRULE · SCR-220(Variant Matrix), SCR-101(Variants 탭).

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S15,S29) |

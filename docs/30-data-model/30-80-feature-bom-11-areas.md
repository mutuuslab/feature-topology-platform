---
id: ARC-BOM-AREAS
type: entity
title: "Feature BOM 11 영역 / 11 BOM Areas"
status: draft
version: 0.1.0
owner: feature-architect
cycle: 20
standards: [ISO/IEC/IEEE-29148, OMG-ReqIF-1.2]
traces:
  satisfies: [FR-3]
  implemented_by: [ENT-FEATUREBOM, ENT-BOMITEM]
  realized_in_screen: [SCR-120]
  verified_by: [TC-003]
last_updated: 2026-06-05
---

# Feature BOM 11 영역 / 11 BOM Areas

## 1. 11 영역 (4 카테고리)
| 카테고리 | 영역 | 대표 Artifact |
|---|---|---|
| Feature 기준정보 | 1 Feature Master | ID·Name·Level·Owner·Lifecycle |
| Engineering Artifact | 2 Requirement | SYS/SWE/SEC |
| | 3 Architecture | SWC/ECU |
| | 4 Interface | API/Signal/DTC |
| Applicability & Control | 5 Variant | 차종/지역/HW/SW |
| | 6 Control | Policy/Flag |
| | 7 Deployment | Binary/Policy Package |
| Assurance & Operations | 8 Verification | Test Evidence |
| | 9 Supplier | Supplier Function |
| | 10 Safety/Security | ASIL/Cybersec |
| | 11 Operation | Telemetry/Audit |

## 2. FEAT-BDC-001 적용 예시
```yaml
feature: FEAT-BDC-001
areas:
  requirement: [SYS-BODY-001, SWE-BDC-010, SEC-POLICY-004]
  architecture: [ECU-BDC, ECU-CCU, SWC-BDC-ADAPTER]
  interface: [API-BDC-POLICY, SIG-DOOR-LOCK, DTC-BDC-FAIL]
  variant: ["KR/EU", "MY2027+", "Premium", "Gen3", "SW>=3.2"]
  control: [POLICY-BDC-ENABLE, KILL-SWITCH, "Safe:disabled"]
  verification: [HIL-BDC-001, OTA-RB-002, TEL-BDC-001]
  supplier: [SUP-BDC-A, BDC_FUNC_032]
  operation: [TEL-BDC-001, "Audit Log"]
```

## 3. BOM 품질 규칙
R1 L2→≥1 Requirement+Owner · R2 Runtime→Safe Default+Rollback · R3 Policy-only→SWC/API 변경없음+증적 · R4 Released→Test Evidence+Telemetry. (→ [[FR-3-feature-bom]])

## 변경 이력
| 0.1.0 | 2026-06-05 | 초안 (PPT S10) |
